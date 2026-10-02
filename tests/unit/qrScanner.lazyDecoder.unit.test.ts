import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import QRCode from 'qrcode';
import {
  parseQrLinkedDeviceSessionPayloadV5,
  serializeQrLinkedDeviceSessionPayloadV5,
} from '../../packages/shared-ts/src/device-linking/parsers';
import { base64UrlEncode } from '../../packages/shared-ts/src/utils/base64';
import { injectImportMap } from '../setup/bootstrap';
import { TEST_BROWSER_IMPORTS } from '../setup/importMap';

const QR_CAMERA_HOOK_PATH = '/_test-sdk/esm/react/hooks/useQRCamera.js';
const LINK_SESSION_ID = 'link-session:lazy-decoder';
const PUBLIC_KEY_B64U = base64UrlEncode(new Uint8Array(32).fill(4));

// The installed jsqr build is UMD. Serving it as a module keeps the decoder real while the
// test counts what the page asks for and how many frames it hands over.
const JSQR_MODULE_SOURCE = [
  'var module = { exports: {} }; var exports = module.exports;',
  fs.readFileSync(createRequire(import.meta.url).resolve('jsqr'), 'utf8'),
  'const decode = module.exports.default;',
  'export default function countingDecode(...args) {',
  '  globalThis.__qrDecodeCalls = (globalThis.__qrDecodeCalls || 0) + 1;',
  '  return decode(...args);',
  '}',
].join('\n');

type DecoderRoute = {
  requests: () => number;
  release: () => void;
};

async function routeDecoder(page: Page, mode: 'serve' | 'fail' | 'hold'): Promise<DecoderRoute> {
  let requests = 0;
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(TEST_BROWSER_IMPORTS.jsqr, async (route) => {
    requests += 1;
    if (mode === 'fail') {
      await route.abort('failed');
      return;
    }
    if (mode === 'hold') await held;
    await route.fulfill({ contentType: 'text/javascript', body: JSQR_MODULE_SOURCE });
  });
  return { requests: () => requests, release };
}

async function linkQrImage(): Promise<string> {
  const now = Date.now();
  const payload = parseQrLinkedDeviceSessionPayloadV5({
    version: 'v5',
    purpose: 'linked_device_lane_creation',
    linkSessionId: LINK_SESSION_ID,
    linkPublicKeyB64u: PUBLIC_KEY_B64U,
    devicePublicKeyB64u: PUBLIC_KEY_B64U,
    requestedPermission: {
      kind: 'delegated_wallet_authority_v1',
      permissions: ['sign', 'link_devices'],
    },
    targetFactor: { kind: 'passkey_prf' },
    issuedAtMs: now - 1_000,
    expiresAtMs: now + 600_000,
  });
  return await QRCode.toDataURL(serializeQrLinkedDeviceSessionPayloadV5(payload), {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 640,
  });
}

/**
 * Mounts a component that uses the hook, in front of a camera whose picture is a canvas
 * showing `image` (or nothing). Leaves `window.__scanner` to drive and observe it.
 */
async function mountScanner(page: Page, image: string | null): Promise<void> {
  await page.evaluate(
    async ({ hookPath, image }) => {
      const React = await import('react');
      const ReactDOM = await import('react-dom');
      const ReactDOMClient = await import('react-dom/client');
      const { useQRCamera } = await import(hookPath);

      const picture = document.createElement('canvas');
      picture.width = 640;
      picture.height = 640;
      const context = picture.getContext('2d');
      if (!context) throw new Error('2D canvas unavailable');
      const code = new Image();
      if (image) {
        code.src = image;
        await code.decode();
      }
      const paint = (): void => {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, picture.width, picture.height);
        if (image) context.drawImage(code, 0, 0, picture.width, picture.height);
        requestAnimationFrame(paint);
      };
      paint();

      const tracks: MediaStreamTrack[] = [];
      const state = {
        cameraRequests: 0,
        detected: [] as string[],
        errors: [] as { message: string; code: unknown }[],
        tracks,
        shownError: (): string => document.querySelector('[data-error]')?.textContent ?? '',
        open: (_isOpen: boolean): void => {},
        unmount: (): void => {},
      };
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          enumerateDevices: async () => [],
          getUserMedia: async () => {
            state.cameraRequests += 1;
            const stream = picture.captureStream(30);
            tracks.push(...stream.getTracks());
            return stream;
          },
        },
      });

      function Scanner(props: { isOpen: boolean }) {
        const camera = useQRCamera({
          isOpen: props.isOpen,
          onQRDetected: (qrData: { linkSessionId: string }) => {
            state.detected.push(String(qrData.linkSessionId));
          },
          onError: (error: Error & { code?: unknown }) => {
            state.errors.push({ message: error.message, code: error.code });
          },
        });
        return React.createElement(
          'div',
          null,
          React.createElement('video', { ref: camera.videoRef, muted: true, playsInline: true }),
          React.createElement('p', { 'data-error': '' }, camera.error ?? ''),
        );
      }

      const mount = document.createElement('div');
      document.body.appendChild(mount);
      const root = ReactDOMClient.createRoot(mount);
      state.open = (isOpen) => {
        ReactDOM.flushSync(() => root.render(React.createElement(Scanner, { isOpen })));
      };
      state.unmount = () => {
        ReactDOM.flushSync(() => root.unmount());
      };
      state.open(false);
      (window as unknown as { __scanner: typeof state }).__scanner = state;
    },
    { hookPath: QR_CAMERA_HOOK_PATH, image },
  );
}

type ScannerSnapshot = {
  cameraRequests: number;
  detected: string[];
  errors: { message: string; code: unknown }[];
  liveTracks: number;
  decodeCalls: number;
  shownError: string;
};

async function scannerSnapshot(page: Page): Promise<ScannerSnapshot> {
  return await page.evaluate(() => {
    const state = (window as any).__scanner;
    return {
      cameraRequests: state.cameraRequests,
      detected: state.detected.slice(),
      errors: state.errors.slice(),
      liveTracks: state.tracks.filter((track: MediaStreamTrack) => track.readyState === 'live')
        .length,
      decodeCalls: (globalThis as any).__qrDecodeCalls ?? 0,
      shownError: state.shownError(),
    };
  });
}

test.describe('QR scanner decoder loading', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
    await injectImportMap(page);
  });

  test('loads the decoder when a scan starts and decodes the first camera frame', async ({
    page,
  }) => {
    const decoder = await routeDecoder(page, 'serve');
    await mountScanner(page, await linkQrImage());

    await page.waitForTimeout(300);
    expect(decoder.requests()).toBe(0);
    expect((await scannerSnapshot(page)).cameraRequests).toBe(0);

    await page.evaluate(() => (window as any).__scanner.open(true));
    await expect
      .poll(async () => (await scannerSnapshot(page)).detected)
      .toEqual([LINK_SESSION_ID]);

    const scanned = await scannerSnapshot(page);
    expect(decoder.requests()).toBe(1);
    expect(scanned.cameraRequests).toBe(1);
    expect(scanned.decodeCalls).toBe(1);
    expect(scanned.errors).toEqual([]);
    expect(scanned.liveTracks).toBe(0);
  });

  test('reports the missing package without opening the camera when the decoder fails to load', async ({
    page,
  }) => {
    const decoder = await routeDecoder(page, 'fail');
    await mountScanner(page, null);

    await page.evaluate(() => (window as any).__scanner.open(true));
    await expect.poll(async () => (await scannerSnapshot(page)).errors.length).toBe(1);

    const failed = await scannerSnapshot(page);
    expect(decoder.requests()).toBe(1);
    expect(failed.errors).toEqual([
      {
        message: 'Device-link QR scanning requires the optional jsqr package',
        code: 'UNSUPPORTED',
      },
    ]);
    expect(failed.shownError).toBe('Device-link QR scanning requires the optional jsqr package');
    expect(failed.cameraRequests).toBe(0);
    expect(failed.detected).toEqual([]);
  });

  test('unmounting while the decoder loads opens no camera and reports nothing', async ({
    page,
  }) => {
    const decoder = await routeDecoder(page, 'hold');
    await mountScanner(page, await linkQrImage());

    await page.evaluate(() => (window as any).__scanner.open(true));
    await expect.poll(() => decoder.requests()).toBe(1);
    await page.evaluate(() => (window as any).__scanner.unmount());
    decoder.release();
    await page.waitForTimeout(500);

    const unmounted = await scannerSnapshot(page);
    expect(unmounted.cameraRequests).toBe(0);
    expect(unmounted.decodeCalls).toBe(0);
    expect(unmounted.detected).toEqual([]);
    expect(unmounted.errors).toEqual([]);
  });

  test('unmounting during a scan stops the camera and the decode loop', async ({ page }) => {
    await routeDecoder(page, 'serve');
    await mountScanner(page, null);

    await page.evaluate(() => (window as any).__scanner.open(true));
    await expect.poll(async () => (await scannerSnapshot(page)).decodeCalls).toBeGreaterThan(2);
    expect((await scannerSnapshot(page)).liveTracks).toBe(1);

    await page.evaluate(() => (window as any).__scanner.unmount());
    const stopped = await scannerSnapshot(page);
    await page.waitForTimeout(300);
    const later = await scannerSnapshot(page);

    expect(stopped.liveTracks).toBe(0);
    expect(later.decodeCalls).toBe(stopped.decodeCalls);
    expect(later.detected).toEqual([]);
    expect(later.errors).toEqual([]);
  });
});

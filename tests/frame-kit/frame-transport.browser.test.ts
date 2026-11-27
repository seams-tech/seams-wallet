import { expect, test } from '@playwright/test';
import {
  APP_ORIGIN,
  FRAME_ORIGIN,
  OTHER_ORIGIN,
  echoFrame,
  openFrameKitApp,
} from './harness';

type ConnectResult =
  | { readonly kind: 'connected'; readonly reply: unknown }
  | { readonly kind: 'failed'; readonly code: string; readonly frameVersion: string | null };

type ConnectInput = {
  readonly url: string;
  readonly version?: string;
  readonly timeoutMs?: number;
  readonly abortAfterMs?: number;
};

/** Runs in the app page: makes a frame of `url`, connects to it and sends one ping. */
async function connect(options: ConnectInput): Promise<ConnectResult> {
  const { url } = options;
  const { createFrame, connectFrame, FrameConnectError } = globalThis.frameKit;
  const frame = createFrame(document.body, { url, title: 'Test frame', permissions: [] });
  const abort = new AbortController();
  if (options.abortAfterMs !== undefined) setTimeout(() => abort.abort(), options.abortAfterMs);
  try {
    const connection = await connectFrame(frame, {
      protocol: { name: 'frame-kit-test', version: options.version ?? '1' },
      timeoutMs: options.timeoutMs ?? 4000,
      signal: abort.signal,
    });
    const reply = await new Promise((resolve) => {
      connection.port.onmessage = (event) => resolve(event.data);
      connection.port.postMessage({ type: 'ping', requestId: 'r1' });
    });
    return { kind: 'connected', reply };
  } catch (error) {
    if (!(error instanceof FrameConnectError)) throw error;
    return { kind: 'failed', code: error.code, frameVersion: error.frameVersion };
  }
}

test.describe('frame transport', () => {
  test('a frame that allows the page gives it a port', async ({ page }) => {
    await openFrameKitApp(page, { echo: echoFrame() });
    const result = await page.evaluate(connect, { url: `${FRAME_ORIGIN}/echo` });
    expect(result).toEqual({
      kind: 'connected',
      reply: { type: 'pong', requestId: 'r1', parentOrigin: APP_ORIGIN },
    });
  });

  test('the allow attribute names only the frame origin, for each permission asked', async ({
    page,
  }) => {
    await openFrameKitApp(page);
    const allow = await page.evaluate((url) => {
      const frame = globalThis.frameKit.createFrame(document.body, {
        url,
        title: 'Account',
        permissions: ['passkeys', 'payment'],
      });
      return frame.getAttribute('allow');
    }, `${FRAME_ORIGIN}/echo`);
    expect(allow).toBe(
      [
        `publickey-credentials-get ${FRAME_ORIGIN}`,
        `publickey-credentials-create ${FRAME_ORIGIN}`,
        `payment ${FRAME_ORIGIN}`,
      ].join('; '),
    );
  });

  test('a frame of another version refuses, and the error names its version', async ({
    page,
  }) => {
    await openFrameKitApp(page, { echo: echoFrame({ version: '2' }) });
    const result = await page.evaluate(connect, { url: `${FRAME_ORIGIN}/echo` });
    expect(result).toEqual({ kind: 'failed', code: 'version_mismatch', frameVersion: '2' });
  });

  test('a page that the frame does not allow gets no answer', async ({ page }) => {
    await openFrameKitApp(page, { echo: echoFrame({ allowed: [OTHER_ORIGIN] }) });
    const result = await page.evaluate(connect, { url: `${FRAME_ORIGIN}/echo`, timeoutMs: 1500 });
    expect(result).toEqual({ kind: 'failed', code: 'timeout', frameVersion: null });
  });

  test('a frame that moved to another origin never gets a port', async ({ page }) => {
    const redirect = `<!doctype html><script>location.replace(${JSON.stringify(
      `${OTHER_ORIGIN}/echo`,
    )});</script>`;
    await openFrameKitApp(page, { echo: echoFrame(), redirect });
    const result = await page.evaluate(connect, { url: `${FRAME_ORIGIN}/redirect`, timeoutMs: 1500 });
    expect(result).toEqual({ kind: 'failed', code: 'timeout', frameVersion: null });
  });

  test('the frame accepts one connection only', async ({ page }) => {
    await openFrameKitApp(page, { echo: echoFrame() });
    const result = await page.evaluate(async (url) => {
      const { createFrame, connectFrame, FrameConnectError } = globalThis.frameKit;
      const protocol = { name: 'frame-kit-test', version: '1' };
      const frame = createFrame(document.body, { url, title: 'Test frame', permissions: [] });
      const first = await connectFrame(frame, { protocol });
      const second = await connectFrame(frame, { protocol, timeoutMs: 1000 }).then(
        () => 'connected',
        (error: unknown) => (error instanceof FrameConnectError ? error.code : 'unexpected'),
      );
      const connections = await new Promise((resolve) => {
        first.port.onmessage = (event) => resolve(event.data.connections);
        first.port.postMessage({ type: 'count', requestId: 'r2' });
      });
      return { second, connections };
    }, `${FRAME_ORIGIN}/echo`);
    expect(result).toEqual({ second: 'timeout', connections: 1 });
  });

  test('the connection closes when the frame loads another document', async ({ page }) => {
    await openFrameKitApp(page, { echo: echoFrame() });
    const closed = await page.evaluate(async (url) => {
      const { createFrame, connectFrame } = globalThis.frameKit;
      const frame = createFrame(document.body, { url, title: 'Test frame', permissions: [] });
      const connection = await connectFrame(frame, {
        protocol: { name: 'frame-kit-test', version: '1' },
      });
      const whenClosed = new Promise<boolean>((resolve) => connection.onClosed(() => resolve(true)));
      frame.src = `${url}?again`;
      return whenClosed;
    }, `${FRAME_ORIGIN}/echo`);
    expect(closed).toBe(true);
  });

  test('an abort ends the attempt', async ({ page }) => {
    await openFrameKitApp(page, { echo: echoFrame({ allowed: [] }) });
    const result = await page.evaluate(connect, { url: `${FRAME_ORIGIN}/echo`, abortAfterMs: 300 });
    expect(result).toEqual({ kind: 'failed', code: 'aborted', frameVersion: null });
  });
});

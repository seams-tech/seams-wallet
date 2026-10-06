import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';

const output = resolve('.artifacts/r153/region-settings-browser');
const bundle = await build({
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  tsconfig: 'packages/wallet/tsconfig.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'tsx',
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { WalletRegionSection } from "./packages/wallet/src/react/components/AccountMenuButton/WalletRegionSection";
      const walletId = "settings-wallet.testnet";
      let intent = null;
      let calls = [];
      let status = null;
      async function get() {
        return {
          ok: true,
          placement: {
            state: "settled",
            region: "US",
            generation: 1,
            nextMoveAtMs: 0,
          },
        };
      }
      async function getLastMoveRequest() {
        return intent;
      }
      async function getMove() {
        if (status === null) return { ok: false, code: "transport_unavailable" };
        return { ok: true, status };
      }
      async function move(request) {
        intent = request;
        calls.push(structuredClone(request));
        if (calls.length === 1) return { ok: false, code: "transport_unavailable" };
        advance("copying");
        return { ok: true, status };
      }
      export function advance(stage) {
        status = {
          state: "moving",
          move: {
            moveId: intent.moveId,
            sourceRegion: "US",
            destinationRegion: intent.destinationRegion,
            sourceGeneration: 1,
            destinationGeneration: 2,
            admittedAtMs: 1000,
            nextMoveAtMs: 2000,
            progress: {
              state: stage === "blocked" ? "copying" : stage,
              availability: stage === "cleanup" ? "active" : "paused",
              execution:
                stage === "blocked"
                  ? { state: "blocked", code: "receipt_conflict" }
                  : { state: "running" },
            },
          },
        };
      }
      export function evidence() {
        return { calls };
      }
      class Fixture extends React.Component {
        state = { available: false, locked: false };
        availability = (available) => this.setState({ available });
        lock = () => this.setState({ locked: true });
        render() {
          return (
            <main className="seams-settings-main">
              <h1>Wallet region</h1>
              <button type="button" disabled={!this.state.available}>
                Export keys
              </button>
              <button type="button" onClick={this.lock}>
                Lock wallet
              </button>
              {this.state.locked ? (
                <p>Wallet locked</p>
              ) : (
                <WalletRegionSection
                  walletId={walletId}
                  placement={{ get, getLastMoveRequest, getMove, move }}
                  onAvailability={this.availability}
                />
              )}
            </main>
          );
        }
      }
      createRoot(document.getElementById("root")).render(<Fixture />);
    `,
  },
});
const source = bundle.outputFiles[0].text;
const css = await readFile(
  'packages/wallet/src/react/components/AccountMenuButton/WalletSettingsLayout.css',
  'utf8',
);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.route('https://wallet.example.test/**', serve.bind(null, source, css));
  await page.goto('https://wallet.example.test/');
  await expect(page.getByText('Current region:')).toContainText('United States');
  await expect(page.getByRole('button', { name: 'Move wallet', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export keys' })).toBeEnabled();
  await page.getByLabel('Destination region').selectOption('APAC');
  await expect(
    page.getByText('Moving your wallet ends signing sessions on all devices.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Move wallet', exact: true }).press('Enter');
  await expect(page.getByRole('alert')).toContainText('Reconnecting');
  await expect(page.getByRole('button', { name: 'Export keys' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry same move' }).click();
  await expect(page.getByRole('status')).toHaveText('Transferring wallet data');
  const evidence = await page.evaluate(readEvidence);
  assert.equal(evidence.calls.length, 2);
  assert.deepEqual(evidence.calls[0], evidence.calls[1]);
  assert.equal(evidence.calls[0].destinationRegion, 'APAC');
  await page.evaluate(advance, 'blocked');
  await expect(page.getByRole('status')).toContainText('needs service recovery');
  await page.evaluate(advance, 'cleanup');
  await expect(page.getByRole('status')).toContainText('Source cleanup continues');
  await expect(page.getByRole('button', { name: 'Export keys' })).toBeDisabled();
  await expect(
    page.getByText('Lock this wallet, then unlock it again before signing.'),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  assert.equal(await page.evaluate(fitsViewport), true);
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: resolve(output, 'activation-awaiting-unlock.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Lock wallet' }).click();
  await expect(page.getByText('Wallet locked', { exact: true })).toBeVisible();
  await writeFile(
    resolve(output, 'evidence.json'),
    JSON.stringify(
      {
        scope:
          'Production region settings component in Chromium. Placement, authentication, lock and surrounding action gating use a UI fixture.',
        bundleSha256: createHash('sha256').update(source).digest('hex'),
        nativeRegionSelectionAndEnterSubmission: true,
        sameRegionHasNoMove: true,
        exactRetryAfterUnknownOutcome: true,
        availabilityCallbackBlocksActionsThroughCleanup: true,
        blockedStageVisible: true,
        activationPromptsFreshUnlock: true,
        localLockAvailable: true,
        narrowViewportFits: true,
      },
      null,
      2,
    ),
  );
  console.log('Wallet region settings browser journey passed');
} finally {
  await browser.close();
}

async function serve(source, css, route) {
  const path = new URL(route.request().url()).pathname;
  if (path === '/probe.js') {
    await route.fulfill({ contentType: 'text/javascript', body: source });
    return;
  }
  if (path === '/style.css') {
    await route.fulfill({ contentType: 'text/css', body: css });
    return;
  }
  await route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/probe.js"></script></body></html>',
  });
}
async function readEvidence() {
  return (await import('/probe.js')).evidence();
}
async function advance(stage) {
  (await import('/probe.js')).advance(stage);
}
function fitsViewport() {
  return document.documentElement.scrollWidth <= window.innerWidth;
}

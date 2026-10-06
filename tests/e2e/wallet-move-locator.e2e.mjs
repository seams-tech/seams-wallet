import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';

const output = resolve('.artifacts/r153/move-locator-browser');
const bundle = await build({
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  tsconfig: 'packages/wallet/tsconfig.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
      import { observeWalletOwnershipGeneration } from "./packages/wallet/src/core/indexedDB/seamsWalletDB/walletOwnershipGeneration";
      import { createWalletHostPlacementCommands } from "./packages/wallet/src/SeamsWeb/walletIframe/host/createPlacementCommands";
      import {
        configureIndexedDB,
        IndexedDBManager,
      } from "./packages/wallet/src/core/indexedDB";
      configureIndexedDB({ mode: "wallet" });
      const walletId = "locator-wallet.testnet";
      const intent = {
        walletId,
        moveId: "wmove_" + "L".repeat(43),
        destinationRegion: "APAC",
        expectedGeneration: 1,
      };
      let authentication = { kind: "signed_out" };
      let requests = 0;
      let resumed = false;
      let completed = false;
      function readAuthentication() {
        return authentication;
      }
      async function request(input) {
        requests += 1;
        if (!resumed) return { status: input.method === "GET" ? 404 : 503, body: {} };
        if (input.method !== "GET" || !input.canonicalPath.includes(intent.moveId))
          throw new Error("Resume changed the move");
        if (completed)
          return {
            status: 200,
            body: {
              state: "completed",
              moveId: intent.moveId,
              sourceRegion: "US",
              destinationRegion: "APAC",
              sourceGeneration: 1,
              destinationGeneration: 2,
              admittedAtMs: 1000,
              completedAtMs: 2000,
            },
          };
        return {
          status: 200,
          body: {
            state: "moving",
            move: {
              moveId: intent.moveId,
              sourceRegion: "US",
              destinationRegion: "APAC",
              sourceGeneration: 1,
              destinationGeneration: 2,
              admittedAtMs: 1000,
              nextMoveAtMs: 2000,
              progress: {
                state: "copying",
                availability: "paused",
                execution: { state: "running" },
              },
            },
          },
        };
      }
      function unexpectedPrompt() {
        throw new Error("Reconnect must not prompt");
      }
      async function lockWallet() {
        authentication = { kind: 'signed_out' };
      }
      const placement = createWalletHostPlacementCommands({
        lockWallet,
        managementRequest: { request },
        readAuthentication,
        signingEngine: {
          getAuthenticationCredentialsSerialized: unexpectedPrompt,
          requestEmailOtpEnrollmentConfirmation: unexpectedPrompt,
        },
      });
      export async function submit() {
        authentication = { kind: "authenticated", walletId };
        return placement.move(intent);
      }
      export async function locked() {
        authentication = { kind: "signed_out" };
        const before = requests;
        const locator = await placement.getLastMoveRequest(walletId);
        const status = await placement.getMove(walletId, intent.moveId);
        const otherWallet = await placement.getLastMoveRequest(
          "other-wallet.testnet",
        );
        return { locator, status, otherWallet, networkCalls: requests - before };
      }
      export async function resume() {
        resumed = true;
        authentication = { kind: "authenticated", walletId };
        const locator = await placement.getLastMoveRequest(walletId);
        const result = await placement.move(locator);
        return { result, requests };
      }
      export async function generation() {
        return IndexedDBManager.getAppState(
          "wallet_ownership_generation:" + walletId,
        );
      }
      export async function historical() {
        await observeWalletOwnershipGeneration(walletId, 3);
        completed = true;
        const result = await placement.getMove(walletId, intent.moveId);
        return { result, generation: await generation() };
      }
      export async function corrupt() {
        await IndexedDBManager.setAppState("wallet_move_request:" + walletId, {
          ...intent,
          credential: "must-not-be-accepted",
        });
        try {
          await placement.getLastMoveRequest(walletId);
          return false;
        } catch {
          return true;
        }
      }
    `,
  },
});
const source = bundle.outputFiles[0].text;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route('https://wallet.example.test/**', serve.bind(null, source));
  await page.goto('https://wallet.example.test/');
  assert.deepEqual(await page.evaluate(submit), { ok: false, code: 'transport_unavailable' });
  const beforeReload = await page.evaluate(locked);
  assert.equal(beforeReload.networkCalls, 0);
  assert.equal(beforeReload.otherWallet, null);
  assert.deepEqual(beforeReload.status, { ok: false, code: 'wallet_unlock_required' });
  assert.deepEqual(Object.keys(beforeReload.locator).sort(), [
    'destinationRegion',
    'expectedGeneration',
    'moveId',
    'walletId',
  ]);
  await page.reload();
  assert.deepEqual(await page.evaluate(locked), beforeReload);
  const resumed = await page.evaluate(resume);
  assert.equal(resumed.result.ok, true);
  assert.equal(resumed.result.status.move.moveId, beforeReload.locator.moveId);
  assert.equal(resumed.requests, 1);
  assert.equal(await page.evaluate(generation), 2);
  const historical = await page.evaluate(readHistorical);
  assert.equal(historical.result.ok, true);
  assert.equal(historical.result.status.state, 'completed');
  assert.equal(historical.generation, 3);
  assert.equal(await page.evaluate(corrupt), true);
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, 'evidence.json'),
    JSON.stringify(
      {
        scope:
          'Production host commands and real Chromium IndexedDB across reload. Server responses and authentication state are simulated.',
        bundleSha256: createHash('sha256').update(source).digest('hex'),
        uncertainSubmissionRetainsExactIntent: true,
        lockedReadExposesLocatorWithoutNetworkOrCredential: true,
        reloadPreservesLocator: true,
        moveReadAdvancesAcceptedGeneration: true,
        historicalMoveReadCannotLowerGeneration: true,
        resumeReadsSameMoveWithoutPrompt: true,
        otherWalletIsolated: true,
        unexpectedStoredFieldsRejected: true,
      },
      null,
      2,
    ),
  );
  console.log('Wallet move locator browser journey passed');
} finally {
  await browser.close();
}

async function serve(source, route) {
  if (new URL(route.request().url()).pathname === '/probe.js') {
    await route.fulfill({ contentType: 'text/javascript', body: source });
    return;
  }
  await route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Wallet move reconnect</title>',
  });
}
async function submit() {
  return (await import('/probe.js')).submit();
}
async function locked() {
  return (await import('/probe.js')).locked();
}
async function resume() {
  return (await import('/probe.js')).resume();
}
async function corrupt() {
  return (await import('/probe.js')).corrupt();
}

async function generation() {
  return (await import('/probe.js')).generation();
}
async function readHistorical() {
  return (await import('/probe.js')).historical();
}

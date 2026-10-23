import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type TestInfo } from '@playwright/test';
import {
  custodyEnvelopeBindingJsonV1,
  parsePasskeyCustodyEnvelopeRecord,
} from '@shared/passkey-custody/custodyEnvelope';
import { base64UrlDecode } from '@shared/utils/base64';
import { requireRecord } from '@shared/utils/validation';
import {
  initSync,
  passkey_custody_open_wallet_seed_v1,
} from '../../../wasm/near_signer/pkg/wasm_signer_worker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('VoiceID custody reseals in Rust and matches the Wallet envelope wire', runJourney);

async function runJourney({ page }: { page: unknown }, testInfo: TestInfo): Promise<void> {
  void page;
  const reportPath = testInfo.outputPath('voiceid-custody-journey.json');
  execFileSync(
    'cargo',
    [
      'run',
      '--offline',
      '--manifest-path',
      'crates/signer-core/Cargo.toml',
      '--features',
      'passkey-custody',
      '--example',
      'voiceid_custody_journey',
      '--',
      reportPath,
    ],
    { cwd: ROOT, timeout: 120_000 },
  );
  const report = requireRecord(JSON.parse(await readFile(reportPath, 'utf8')), 'VoiceID report');
  expect(report.status).toBe('passed');
  const envelope = parsePasskeyCustodyEnvelopeRecord(report.envelope);
  expect(envelope.factor.kind).toBe('voiceid');
  if (typeof report.bindingJson !== 'string') {
    throw new Error('Rust VoiceID binding JSON is missing');
  }
  expect(custodyEnvelopeBindingJsonV1(envelope)).toBe(report.bindingJson);
  initSync({
    module: await readFile(path.join(ROOT, 'wasm/near_signer/pkg/wasm_signer_worker_bg.wasm')),
  });
  const factorSecret = new Uint8Array(32).fill(11);
  try {
    const handle = passkey_custody_open_wallet_seed_v1(
      factorSecret,
      report.bindingJson,
      base64UrlDecode(envelope.nonceB64u),
      envelope.sealedCustodySecretB64u,
      envelope.aadHashB64u,
      envelope.ciphertextDigestB64u,
    );
    handle.destroy();
  } finally {
    factorSecret.fill(0);
  }
  const wrongSecret = new Uint8Array(32).fill(7);
  let wrongSecretOpened = false;
  try {
    const handle = passkey_custody_open_wallet_seed_v1(
      wrongSecret,
      report.bindingJson,
      base64UrlDecode(envelope.nonceB64u),
      envelope.sealedCustodySecretB64u,
      envelope.aadHashB64u,
      envelope.ciphertextDigestB64u,
    );
    handle.destroy();
    wrongSecretOpened = true;
  } catch {
    wrongSecretOpened = false;
  } finally {
    wrongSecret.fill(0);
  }
  expect(wrongSecretOpened).toBe(false);
  await writeFile(reportPath, `${JSON.stringify({ ...report, browserWasmOpen: true }, null, 2)}\n`);
  await testInfo.attach('voiceid-custody-journey.json', {
    path: reportPath,
    contentType: 'application/json',
  });
}

import { expect, test, type Page } from '@playwright/test';
import { build, type Plugin } from 'esbuild';
import path from 'node:path';
import {
  RECORDS_VOICE_METHOD_ID,
  RECORDS_WALLET_ID,
  authMethodRecordsV2,
  credentialId,
  localAuthMethodRecordsV1,
  recordsAuthority,
} from './authMethodRecords';
import type { AuthStoreRows, IndexedDbProbeInput } from './indexedDbProbe';
import { committedRecordFixture, readRecordFixture } from './recordFixtures';

/* The auth records of the wallet origin's IndexedDB database, as today's writers make them:
   method rows V1 and V2, the profile with its NEAR pivot, the selection, and the VoiceID
   app-state records. The account origin keeps this origin, so the new code must read these
   rows in place (audit rows 3.2 to 3.8). */

type IndexedDbProbe = typeof import('./indexedDbProbe');
declare global {
  interface Window {
    __conformanceRecords: IndexedDbProbe;
  }
}

const ROOT = path.resolve(import.meta.dirname, '../../..');
const PROBE_PATH = '/__conformance-records.js';
const NEAR_ACCOUNT_ID = 'conformance-records.testnet';
const NEAR_CREDENTIAL_ID_B64U = credentialId(63);

/* The VoiceID package loads its speech model through @seams/voice-capture. The records need
   only the template parser, so the model class is replaced by an empty one. */
const voiceCaptureStub: Plugin = {
  name: 'voice-capture-stub',
  setup(builder) {
    builder.onResolve({ filter: /^@seams\/voice-capture$/u }, () => ({
      path: 'voice-capture',
      namespace: 'conformance-stub',
    }));
    builder.onLoad({ filter: /.*/u, namespace: 'conformance-stub' }, () => ({
      contents: 'export class BrowserInferenceModel {}',
      loader: 'js',
    }));
  },
};

const probeSource = build({
  entryPoints: [path.join(import.meta.dirname, 'indexedDbProbe.ts')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  loader: { '.css': 'empty' },
  plugins: [voiceCaptureStub],
  tsconfig: path.join(ROOT, 'tests/tsconfig.wallet-browser.json'),
}).then((result) => result.outputFiles[0]!.text);

async function probeInput(): Promise<IndexedDbProbeInput> {
  const { authority, authMethod } = await recordsAuthority;
  return {
    authority,
    founderMethod: authMethod,
    methodsV2: (await authMethodRecordsV2(authMethod)).filter(
      (record) => record.kind !== 'voiceid' && record !== authMethod,
    ),
    methodsV1: localAuthMethodRecordsV1(authMethod),
    voiceMethodId: RECORDS_VOICE_METHOD_ID,
    nearAccountId: NEAR_ACCOUNT_ID,
    nearCredentialIdB64u: NEAR_CREDENTIAL_ID_B64U,
    voiceSeed: Array.from({ length: 192 }, (_, index) => ((index * 37) % 101) / 101 - 0.4),
  };
}

async function openProbe(page: Page): Promise<void> {
  const source = await probeSource;
  await page.route(`**${PROBE_PATH}`, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: source }),
  );
  await page.clock.setFixedTime(new Date('2026-11-18T00:00:00.000Z'));
  await page.goto('/');
  await page.evaluate(async (probePath) => {
    window.__conformanceRecords = await import(probePath);
  }, PROBE_PATH);
}

test('today writes the IndexedDB auth rows of the committed fixture', async ({ page }) => {
  await openProbe(page);
  const written = await page.evaluate(
    (input) => window.__conformanceRecords.writeAuthRecords(input),
    await probeInput(),
  );
  expect(written).toEqual(await committedRecordFixture('indexeddb-auth-rows', written));
});

test('today reads each IndexedDB auth row of the committed fixture', async ({ page }) => {
  await openProbe(page);
  const input = await probeInput();
  const reads = await page.evaluate(
    ([probeInput, rows]) => window.__conformanceRecords.readAuthRecords(probeInput, rows),
    [input, await readRecordFixture<AuthStoreRows>('indexeddb-auth-rows')] as const,
  );
  expect(reads).toMatchObject({
    profile: { profileId: RECORDS_WALLET_ID, nearProvisioning: { status: 'near_ready' } },
    lastProfileState: { profileId: RECORDS_WALLET_ID, activeSignerSlot: 1 },
    selections: [
      {
        walletId: RECORDS_WALLET_ID,
        walletAuthMethodId: input.founderMethod.walletAuthMethodId,
        lockGeneration: 1,
        lockState: 'unlocked',
      },
    ],
    voiceEnabled: false,
    voiceEnrollment: {
      kind: 'browser_voiceid_enrollment_v2',
      generation: 'generation-fixture',
      revision: 0,
      baseline: 192,
      adaptation: { kind: 'baseline' },
    },
    importableBaseline: 192,
    microphone: { kind: 'device', deviceId: 'microphone-fixture' },
  });
  const kindsAndStatuses = (records: readonly { kind: string; status: string }[]) =>
    records.map((record) => `${record.kind}:${record.status}`).sort();
  expect(kindsAndStatuses(reads.methodsV1)).toEqual(kindsAndStatuses(input.methodsV1));
  expect(reads.methodsV2).toEqual(
    expect.arrayContaining([input.founderMethod, ...input.methodsV2]),
  );
  expect(kindsAndStatuses(reads.projectionsV2.map((projection) => projection.record))).toEqual(
    kindsAndStatuses(reads.methodsV2),
  );
});

/* A passkey registered through a NEAR-account flow is stored under the NEAR profile. A
   NEAR-ready wallet profile still finds it through its provisioning record (audit row 3.3). */
test('a NEAR-ready wallet profile finds the passkey stored under its NEAR profile', async ({
  page,
}) => {
  await openProbe(page);
  const reads = await page.evaluate(
    ([probeInput, rows]) => window.__conformanceRecords.readAuthRecords(probeInput, rows),
    [await probeInput(), await readRecordFixture<AuthStoreRows>('indexeddb-auth-rows')] as const,
  );
  expect(reads.nearPasskey).toMatchObject({
    profileId: `near-profile:${NEAR_ACCOUNT_ID}`,
    credentialId: NEAR_CREDENTIAL_ID_B64U,
  });
  expect(reads.walletPasskeys.map((record) => record.credentialId)).toContain(
    NEAR_CREDENTIAL_ID_B64U,
  );
});

test('a VoiceID device record keeps its keys in this origin and binds its factor to it', async ({
  page,
}) => {
  await openProbe(page);
  const device = await page.evaluate(
    ([walletId, methodId]) => window.__conformanceRecords.inspectVoiceIdDevice(walletId, methodId),
    [RECORDS_WALLET_ID, String(RECORDS_VOICE_METHOD_ID)] as const,
  );
  expect(device).toEqual(await committedRecordFixture('voiceid-device-record', device));
  expect(device).toMatchObject({
    privateKey: { type: 'private', extractable: false, algorithm: 'Ed25519' },
    wrappingKey: { type: 'secret', extractable: false, algorithm: 'AES-GCM' },
    deviceKeyIdIsPublicKeyDigest: true,
    readBack: true,
    factorBytes: 32,
    aadOpensWithOwnOrigin: true,
    aadOpensWithOtherOrigin: false,
    misfiled: 'VoiceID device belongs to another wallet method.',
  });
});

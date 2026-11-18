/* Runs in the page. The record checks bundle this module with today's IndexedDB code, write
   the auth records through today's writers, and read stored rows back through today's
   readers. The rows go to Node as JSON: bytes become {"$bytes": "<base64url>"}. */
import { IndexedDBManager, SEAMS_WALLET_STORES as stores } from '@/core/indexedDB';
import type { LocalWalletAuthMethodRecord } from '@/core/indexedDB';
import { buildNearProfileId } from '@/core/accountData/near/profileId';
import { toAccountId } from '@/core/types/accountIds';
import {
  availabilityKey,
  readAuthMethodEnabled,
  writeAuthMethodEnabled,
} from '@/core/authMethods/availability';
import {
  createBrowserVoiceDevice,
  deviceKey,
  openBrowserVoiceFactor,
  readBrowserVoiceDevice,
} from '@/core/authMethods/voiceId/deviceStore';
import {
  readVoiceMicrophonePreference,
  saveVoiceMicrophonePreference,
} from '@/core/authMethods/voiceId/microphonePreference';
import {
  commitVoiceEnrollment,
  readImportableVoiceBaseline,
  readVoiceEnrollment,
} from '@voiceid/browser/enrollmentStore';
import { normalizeVoiceVector, VOICE_MODEL_ID } from '@voiceid/browser/model';
import { parseWalletSessionId } from '@shared/authorization/capabilityKinds';
import type { ActiveWalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { sha256DigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseWalletAuthMethodId,
  parseWalletId,
  type WalletAuthMethodId,
} from '@shared/utils/domainIds';
import { requireParsed } from '@shared/passkey-custody/primitives';
import { isPlainObject } from '@shared/utils/validation';
import {
  buildWalletAuthMethodRecordV2,
  type ActivePasskeyWalletAuthMethodRecordV2,
  type WalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';

export type IndexedDbProbeInput = {
  readonly authority: ActiveWalletAuthorityV1;
  readonly founderMethod: ActivePasskeyWalletAuthMethodRecordV2;
  readonly methodsV2: readonly WalletAuthMethodRecordV2[];
  readonly methodsV1: readonly LocalWalletAuthMethodRecord[];
  readonly voiceMethodId: WalletAuthMethodId;
  readonly nearAccountId: string;
  readonly nearCredentialIdB64u: string;
  readonly voiceSeed: readonly number[];
};

/** The auth stores of the one wallet database, as rows. */
export type AuthStoreRows = Record<(typeof AUTH_STORES)[number], unknown[]>;

const AUTH_STORES = [
  stores.wallets,
  stores.walletAuthMethods,
  stores.walletSelections,
  stores.appState,
] as const;

/** Stable stand-ins for the random device key, enrollment generation and revision. */
const FIXED_DEVICE_PUBLIC_KEY_B64U = base64UrlEncode(new Uint8Array(32).fill(61));
const FIXED_GENERATION = 'generation-fixture';
const FIXED_REVISION = 'revision-fixture';

function toJsonValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return { $bytes: base64UrlEncode(value) };
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
}

function fromJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromJsonValue);
  if (!isPlainObject(value)) return value;
  if (typeof value.$bytes === 'string' && Object.keys(value).length === 1) {
    return base64UrlDecode(value.$bytes);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromJsonValue(item)]));
}

function voiceScope(input: IndexedDbProbeInput, deviceKeyId: DigestB64u) {
  return {
    walletId: input.authority.walletId,
    authorityId: input.authority.authorityId,
    walletAuthMethodId: input.voiceMethodId,
    deviceKeyId,
  };
}

async function writeVoiceIdRecords(input: IndexedDbProbeInput) {
  const walletId = input.authority.walletId;
  const device = await createBrowserVoiceDevice(walletId, input.voiceMethodId);
  await commitVoiceEnrollment({
    kind: 'activate',
    scope: voiceScope(input, device.deviceKeyId),
    signal: new AbortController().signal,
    guard: {
      target: 'activating',
      sessionMethodId: input.founderMethod.walletAuthMethodId,
      walletSessionId: requireParsed(parseWalletSessionId('wallet-session:records'), 'id'),
      lockGeneration: 1,
      expiresAtMs: Date.now() + 60_000,
      availabilityRevision: 'initial',
    },
    snapshot: { kind: 'missing' },
    baseline: normalizeVoiceVector(input.voiceSeed),
  });
  await IndexedDBManager.upsertWalletAuthMethodV2(
    buildWalletAuthMethodRecordV2({
      version: 'wallet_auth_method_v2',
      walletAuthMethodId: input.voiceMethodId,
      walletId,
      walletAuthorityId: input.authority.authorityId,
      kind: 'voiceid',
      status: 'active',
      deviceKeyId: device.deviceKeyId,
      devicePublicKeyB64u: device.publicKeyB64u,
      createdAtMs: 600,
      updatedAtMs: 600,
      activatedAtMs: 600,
    }),
  );
  await writeAuthMethodEnabled(walletId, input.voiceMethodId, false);
  await saveVoiceMicrophonePreference({ kind: 'device', deviceId: 'microphone-fixture' });
  // No code writes the v1 enrollment today; only the importer reads it.
  await IndexedDBManager.setAppState('voiceid-browser-enrollment-v1', {
    kind: 'browser_voiceid_enrollment_v1',
    model: VOICE_MODEL_ID,
    template: normalizeVoiceVector([...input.voiceSeed].reverse()),
  });
  return device;
}

/** Writes every auth record through today's writers and returns the stored rows. */
export async function writeAuthRecords(input: IndexedDbProbeInput): Promise<AuthStoreRows> {
  const walletId = input.authority.walletId;
  const nearProfileId = buildNearProfileId(toAccountId(input.nearAccountId));
  await IndexedDBManager.upsertProfile({
    profileId: walletId,
    nearProvisioning: { status: 'near_ready', updatedAtMs: 300, nearAccountId: input.nearAccountId },
  });
  await IndexedDBManager.persistFoundingWalletAuthority({
    authority: input.authority,
    authMethod: input.founderMethod,
  });
  for (const record of input.methodsV2) await IndexedDBManager.upsertWalletAuthMethodV2(record);
  for (const record of input.methodsV1) await IndexedDBManager.upsertWalletAuthMethod(record);
  // A NEAR-account flow stores its passkey under the NEAR profile, not the wallet profile.
  await IndexedDBManager.upsertProfile({ profileId: nearProfileId });
  await IndexedDBManager.upsertProfileAuthenticator({
    profileId: nearProfileId,
    signerSlot: 1,
    credentialId: input.nearCredentialIdB64u,
    credentialPublicKey: new Uint8Array(65).fill(62),
    transports: ['internal'],
    name: 'Records passkey',
    registered: '2026-11-18T00:00:00.000Z',
    syncedAt: '2026-11-18T00:00:00.000Z',
  });
  await IndexedDBManager.setLastProfileState({ profileId: walletId, activeSignerSlot: 1 });
  await IndexedDBManager.advanceWalletLockGeneration({ walletId, lockedAtMs: 400 });
  await IndexedDBManager.markWalletSelectionUnlocked({
    walletId,
    walletAuthMethodId: input.founderMethod.walletAuthMethodId,
    unlockedAtMs: 500,
  });
  const device = await writeVoiceIdRecords(input);
  const database = await IndexedDBManager.seamsWalletDB.getDB();
  const rows: Record<string, unknown[]> = {};
  for (const store of AUTH_STORES) {
    rows[store] = (await database.getAll(store)).filter(
      (row) => !(isPlainObject(row) && row.key === deviceKey(walletId, input.voiceMethodId)),
    );
  }
  const enrollment = await readVoiceEnrollment(voiceScope(input, device.deviceKeyId));
  const revision = await IndexedDBManager.getAppState<{ revision: string }>(
    availabilityKey(walletId, input.voiceMethodId),
  );
  const fixedDeviceKeyId = await sha256DigestB64u(base64UrlDecode(FIXED_DEVICE_PUBLIC_KEY_B64U));
  const json = JSON.stringify(toJsonValue(rows))
    .replaceAll(device.publicKeyB64u, FIXED_DEVICE_PUBLIC_KEY_B64U)
    .replaceAll(device.deviceKeyId, fixedDeviceKeyId)
    .replaceAll(enrollment?.generation ?? FIXED_GENERATION, FIXED_GENERATION)
    .replaceAll(revision?.revision ?? FIXED_REVISION, FIXED_REVISION);
  return JSON.parse(json);
}

/** Stores the given rows as they are, then reads them through today's readers. */
export async function readAuthRecords(input: IndexedDbProbeInput, rows: AuthStoreRows) {
  const database = await IndexedDBManager.seamsWalletDB.getDB();
  for (const store of AUTH_STORES) {
    for (const row of rows[store]) await database.put(store, fromJsonValue(row));
  }
  const walletId = input.authority.walletId;
  const deviceKeyId = await sha256DigestB64u(base64UrlDecode(FIXED_DEVICE_PUBLIC_KEY_B64U));
  const enrollment = await readVoiceEnrollment(voiceScope(input, deviceKeyId));
  const reads = {
    profile: await IndexedDBManager.getProfile(walletId),
    lastProfileState: await IndexedDBManager.getLastProfileState(),
    methodsV1: await IndexedDBManager.listWalletAuthMethodsForWallet(walletId),
    methodsV2: await IndexedDBManager.listWalletAuthMethodsV2ForWallet(walletId),
    projectionsV2: await IndexedDBManager.listLocalWalletAuthMethodProjectionsV2ForWallet(walletId),
    walletPasskeys: await IndexedDBManager.listWalletPasskeyAuthenticators(walletId),
    nearPasskey: await IndexedDBManager.getWalletPasskeyAuthenticator({
      walletId,
      credentialId: input.nearCredentialIdB64u,
    }),
    selections: await IndexedDBManager.listWalletSelections(),
    voiceEnabled: await readAuthMethodEnabled(walletId, input.voiceMethodId),
    voiceEnrollment: enrollment && { ...enrollment, baseline: enrollment.baseline.length },
    importableBaseline: (await readImportableVoiceBaseline())?.length ?? null,
    microphone: await readVoiceMicrophonePreference(),
  };
  // Typed as read; the bytes in the passkey rows arrive as {"$bytes": "<base64url>"}.
  return toJsonValue(reads) as typeof reads;
}

function publicKeyDigest(stored: Record<string, unknown>): Promise<DigestB64u> {
  return sha256DigestB64u(base64UrlDecode(String(stored.publicKeyB64u)));
}

function describeKey(key: unknown) {
  if (!(key instanceof CryptoKey)) return null;
  const { type, extractable, usages } = key;
  return { type, extractable, algorithm: key.algorithm.name, usages: [...usages].sort() };
}

/**
 * Creates a VoiceID device record and describes what is stored. The record holds CryptoKeys,
 * which no fixture file can copy, so the check keeps their description and proves the AAD.
 */
export async function inspectVoiceIdDevice(walletId: string, methodId: string) {
  const id = requireParsed(parseWalletId(walletId), 'walletId');
  const method = requireParsed(parseWalletAuthMethodId(methodId), 'walletAuthMethodId');
  const otherMethod = requireParsed(parseWalletAuthMethodId(`${methodId}-other`), 'otherMethod');
  const created = await createBrowserVoiceDevice(id, method);
  const stored = await IndexedDBManager.getAppState<Record<string, unknown>>(deviceKey(id, method));
  if (!stored) throw new Error('VoiceID device record was not stored');
  const read = await readBrowserVoiceDevice(id, method);
  const factor = read && (await openBrowserVoiceFactor(read));
  const decryptWith = async (origin: string) => {
    const aad = JSON.stringify([
      'seams-voiceid-browser-factor-v1',
      origin,
      walletId,
      methodId,
      created.deviceKeyId,
    ]);
    try {
      return new Uint8Array(
        await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: created.nonce, additionalData: new TextEncoder().encode(aad) },
          created.wrappingKey,
          created.ciphertext,
        ),
      );
    } catch {
      return null;
    }
  };
  const sameOrigin = await decryptWith(location.origin);
  const otherOrigin = await decryptWith('https://other.example.test');
  // A record copied under another method's key must not be accepted for that method.
  await IndexedDBManager.setAppState(deviceKey(id, otherMethod), stored);
  const misfiled = await readBrowserVoiceDevice(id, otherMethod).then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  return {
    appStateKey: deviceKey(id, method),
    fields: Object.keys(stored).sort(),
    kind: stored.kind,
    walletId: stored.walletId,
    walletAuthMethodId: stored.walletAuthMethodId,
    privateKey: describeKey(stored.privateKey),
    wrappingKey: describeKey(stored.wrappingKey),
    nonceBytes: stored.nonce instanceof Uint8Array ? stored.nonce.length : null,
    ciphertextBytes: stored.ciphertext instanceof ArrayBuffer ? stored.ciphertext.byteLength : null,
    publicKeyBytes: base64UrlDecode(String(stored.publicKeyB64u)).length,
    deviceKeyIdIsPublicKeyDigest: stored.deviceKeyId === (await publicKeyDigest(stored)),
    readBack: read?.publicKeyB64u === created.publicKeyB64u,
    factorBytes: factor?.length ?? null,
    aadOpensWithOwnOrigin:
      sameOrigin !== null && factor !== null && base64UrlEncode(sameOrigin) === base64UrlEncode(factor),
    aadOpensWithOtherOrigin: otherOrigin !== null,
    misfiled,
  };
}

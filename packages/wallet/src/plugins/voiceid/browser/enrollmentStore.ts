import type { IDBPTransaction } from 'idb';
import { IndexedDBManager } from '@/core/indexedDB';
import { SEAMS_WALLET_STORES as stores } from '@/core/indexedDB/schemaNames';
import {
  parseWalletAuthMethodV2StorageRow,
  parseWalletAuthorityStorageRow,
  parseWalletSelectionStorageRow,
} from '@/core/indexedDB/seamsWalletDB/repositories';
import type { WalletId, WalletAuthMethodId, WalletAuthorityId } from '@shared/utils/domainIds';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { WalletSessionId } from '@shared/authorization/capabilityKinds';
import { requireRecord, isFiniteNumber, isPlainObject } from '@shared/utils/validation';
import {
  normalizeVoiceVector,
  voiceSimilarity,
  VOICE_MODEL_ID,
  VOICE_MATCH_THRESHOLD,
} from './model';
import { deviceKey, readBrowserVoiceDevice, type BrowserVoiceDevice } from './deviceStore';
import {
  availabilityKey,
  parseStoredAuthMethodAvailability,
} from '@/core/authMethods/availability';
import type { ConfirmedVoiceChange } from '../activation/ownerConfirmation';
import {
  buildDelegatedWalletAuthorityV1,
  buildFullOwnerPermissionsV1,
  sameDelegatedWalletAuthorityV1,
} from '@shared/authorization/delegatedAuthority';

const OLD_ENROLLMENT_KEY = 'voiceid-browser-enrollment-v1';
export const MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const MAX_USES = 32;
const SUPPLEMENT_WEIGHT = 0.2;
const MINIMUM_BASELINE_COSINE = 0.98;
const MAX_RECORD_BYTES = 32_768;
const transactionStores = [
  stores.appState,
  stores.walletSelections,
  stores.walletAuthMethods,
  stores.walletAuthorities,
];
type EnrollmentTransaction = IDBPTransaction<unknown, string[], 'readwrite'>;

export type VoiceEnrollmentScope = Readonly<{
  walletId: WalletId;
  authorityId: WalletAuthorityId;
  walletAuthMethodId: WalletAuthMethodId;
  deviceKeyId: DigestB64u;
}>;

export type VoiceEnrollment = Readonly<{
  kind: 'browser_voiceid_enrollment_v2';
  scope: VoiceEnrollmentScope;
  model: string;
  generation: string;
  revision: number;
  baseline: readonly number[];
  adaptation:
    | {
        readonly kind: 'baseline';
        readonly samples?: never;
        readonly expiresAtMs?: never;
        readonly remainingUses?: never;
      }
    | {
        readonly kind: 'adapted';
        readonly samples: readonly (readonly number[])[];
        readonly expiresAtMs: number;
        readonly remainingUses: number;
      };
}>;

export type VoiceEnrollmentSnapshot =
  | { readonly kind: 'missing'; readonly enrollment?: never }
  | { readonly kind: 'present'; readonly enrollment: VoiceEnrollment };

export type VoiceOwnerGuard = Readonly<{
  ownerMethodId: WalletAuthMethodId;
  walletSessionId: WalletSessionId;
  lockGeneration: number;
  expiresAtMs: number;
  availabilityRevision: string;
  target: 'activating' | 'enrolled';
}>;

export function voiceEnrollmentScope(
  device: BrowserVoiceDevice,
  authorityId: WalletAuthorityId,
): VoiceEnrollmentScope {
  return {
    walletId: device.walletId,
    walletAuthMethodId: device.walletAuthMethodId,
    deviceKeyId: device.deviceKeyId,
    authorityId,
  };
}

export async function resolveVoiceEnrollmentScope(
  walletId: WalletId,
  methodId: WalletAuthMethodId,
): Promise<VoiceEnrollmentScope> {
  const method = await IndexedDBManager.getWalletAuthMethodV2(methodId);
  const device = await readBrowserVoiceDevice(walletId, methodId);
  if (
    !method ||
    method.kind !== 'voiceid' ||
    method.status !== 'active' ||
    method.walletId !== walletId ||
    !device ||
    method.deviceKeyId !== device.deviceKeyId
  )
    throw new Error('VoiceID is unavailable for this wallet method.');
  return voiceEnrollmentScope(device, method.walletAuthorityId);
}

function enrollmentKey(scope: VoiceEnrollmentScope): string {
  const identity = [scope.walletId, scope.authorityId, scope.walletAuthMethodId, scope.deviceKeyId];
  return `voiceid-browser-enrollment-v2:${identity.map(encodeURIComponent).join(':')}`;
}

function vector(raw: unknown): number[] {
  if (!Array.isArray(raw) || !raw.every(isFiniteNumber))
    throw new Error('VoiceID template is invalid.');
  const normalized = normalizeVoiceVector(raw);
  for (let index = 0; index < raw.length; index += 1) {
    if (Math.abs(raw[index] - normalized[index]) > 1e-6)
      throw new Error('VoiceID template is not normalized.');
  }
  return raw.slice();
}

function parseEnrollment(raw: unknown, scope: VoiceEnrollmentScope): VoiceEnrollment | null {
  if (raw === undefined) return null;
  const record = requireRecord(raw, 'VoiceID enrollment');
  const storedScope = requireRecord(record.scope, 'VoiceID enrollment scope');
  if (
    record.kind !== 'browser_voiceid_enrollment_v2' ||
    storedScope.walletId !== scope.walletId ||
    storedScope.authorityId !== scope.authorityId ||
    storedScope.walletAuthMethodId !== scope.walletAuthMethodId ||
    storedScope.deviceKeyId !== scope.deviceKeyId ||
    typeof record.generation !== 'string' ||
    !record.generation ||
    typeof record.revision !== 'number' ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0
  )
    throw new Error('VoiceID enrollment identity is invalid.');
  if (record.model !== VOICE_MODEL_ID) return null;
  const baseline = vector(record.baseline);
  let adaptation: VoiceEnrollment['adaptation'] = { kind: 'baseline' };
  // Supplemental data is disposable. A corrupt baseline always fails above.
  try {
    const candidate = requireRecord(record.adaptation, 'VoiceID improvements');
    if (
      candidate.kind === 'adapted' &&
      Array.isArray(candidate.samples) &&
      candidate.samples.length === 3 &&
      typeof candidate.expiresAtMs === 'number' &&
      Number.isSafeInteger(candidate.expiresAtMs) &&
      candidate.expiresAtMs > Date.now() &&
      candidate.expiresAtMs <= Date.now() + MAX_AGE_MS &&
      typeof candidate.remainingUses === 'number' &&
      Number.isSafeInteger(candidate.remainingUses) &&
      candidate.remainingUses > 0 &&
      candidate.remainingUses <= MAX_USES
    ) {
      const samples = candidate.samples.map(vector);
      requireBoundedSamples(baseline, samples);
      adaptation = {
        kind: 'adapted',
        samples,
        expiresAtMs: candidate.expiresAtMs,
        remainingUses: candidate.remainingUses,
      };
    }
  } catch {
    adaptation = { kind: 'baseline' };
  }
  return {
    kind: 'browser_voiceid_enrollment_v2',
    scope,
    model: VOICE_MODEL_ID,
    generation: record.generation,
    revision: record.revision,
    baseline,
    adaptation,
  };
}

function effectiveTemplate(
  baseline: readonly number[],
  samples: readonly (readonly number[])[],
): number[] {
  const mean = new Array<number>(192).fill(0);
  for (const sample of samples) {
    for (let index = 0; index < mean.length; index += 1)
      mean[index] += sample[index] / samples.length;
  }
  const supplement = normalizeVoiceVector(mean);
  for (let index = 0; index < mean.length; index += 1) {
    mean[index] = (1 - SUPPLEMENT_WEIGHT) * baseline[index] + SUPPLEMENT_WEIGHT * supplement[index];
  }
  return normalizeVoiceVector(mean);
}

function requireBoundedSamples(
  baseline: readonly number[],
  samples: readonly (readonly number[])[],
): void {
  if (samples.length !== 3)
    throw new Error('Record three samples before saving voice improvements.');
  for (const sample of samples) {
    if (voiceSimilarity(baseline, sample) < VOICE_MATCH_THRESHOLD)
      throw new Error(
        'This sample differs from your original voice. Try again or re-record your enrollment.',
      );
  }
  if (voiceSimilarity(baseline, effectiveTemplate(baseline, samples)) < MINIMUM_BASELINE_COSINE) {
    throw new Error(
      'These samples differ too much from your original voice. Re-record your enrollment instead.',
    );
  }
}

export async function readVoiceEnrollment(
  scope: VoiceEnrollmentScope,
): Promise<VoiceEnrollment | null> {
  const database = await IndexedDBManager.seamsWalletDB.getDB();
  const transaction = database.transaction(stores.appState, 'readwrite');
  try {
    const row = await transaction.store.get(enrollmentKey(scope));
    let enrollment = parseEnrollment(row?.value, scope);
    if (
      enrollment?.adaptation.kind === 'baseline' &&
      JSON.stringify(row?.value?.adaptation) !== JSON.stringify(enrollment.adaptation)
    ) {
      enrollment = copyEnrollment(enrollment, { kind: 'baseline' });
      await transaction.store.put({ key: enrollmentKey(scope), value: enrollment });
    }
    await transaction.done;
    return enrollment;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* Transaction already completed. */
    }
    await transaction.done.catch(ignoreAbort);
    throw error;
  }
}

export async function readImportableVoiceBaseline(): Promise<readonly number[] | null> {
  const raw = await IndexedDBManager.getAppState(OLD_ENROLLMENT_KEY);
  if (raw === undefined) return null;
  const record = requireRecord(raw, 'Previous VoiceID enrollment');
  if (record.kind !== 'browser_voiceid_enrollment_v1' || record.model !== VOICE_MODEL_ID)
    return null;
  return vector(record.template);
}

async function assertLifecycle(
  transaction: EnrollmentTransaction,
  scope: VoiceEnrollmentScope,
  guard: VoiceOwnerGuard | null,
): Promise<void> {
  const selection = parseWalletSelectionStorageRow(
    await transaction.objectStore(stores.walletSelections).get(scope.walletId),
  );
  const authority = parseWalletAuthorityStorageRow(
    await transaction.objectStore(stores.walletAuthorities).get(scope.authorityId),
  );
  const methodRow: unknown = await transaction
    .objectStore(stores.walletAuthMethods)
    .get(scope.walletAuthMethodId);
  const method = parseWalletAuthMethodV2StorageRow(methodRow);
  if (methodRow !== undefined && !method) throw new Error('VoiceID method storage is invalid.');
  if (
    !authority ||
    authority.record.state !== 'active' ||
    authority.record.walletId !== scope.walletId
  ) {
    throw new Error('VoiceID authority changed. Start again.');
  }
  if (
    method &&
    (method.record.kind !== 'voiceid' ||
      method.record.status !== 'active' ||
      method.record.walletId !== scope.walletId ||
      method.record.walletAuthorityId !== scope.authorityId ||
      method.record.deviceKeyId !== scope.deviceKeyId)
  )
    throw new Error('VoiceID method is unavailable.');
  if ((guard === null || guard.target === 'enrolled') && !method)
    throw new Error('VoiceID method is unavailable.');
  const device = await transaction
    .objectStore(stores.appState)
    .get(deviceKey(scope.walletId, scope.walletAuthMethodId));
  if (device?.value?.deviceKeyId !== scope.deviceKeyId)
    throw new Error('VoiceID device changed. Start again.');
  const availabilityRow = await transaction
    .objectStore(stores.appState)
    .get(availabilityKey(scope.walletId, scope.walletAuthMethodId));
  const availability = parseStoredAuthMethodAvailability(availabilityRow?.value);
  if (!availability.enabled) throw new Error('VoiceID is turned off.');
  if (guard) {
    if (
      !sameDelegatedWalletAuthorityV1(
        buildDelegatedWalletAuthorityV1({ permissions: authority.record.permissions }),
        buildDelegatedWalletAuthorityV1({ permissions: buildFullOwnerPermissionsV1() }),
      )
    )
      throw new Error('Full owner authority is required to change VoiceID enrollment.');
    const owner = parseWalletAuthMethodV2StorageRow(
      await transaction.objectStore(stores.walletAuthMethods).get(guard.ownerMethodId),
    );
    if (
      guard.expiresAtMs <= Date.now() ||
      availability.revision !== guard.availabilityRevision ||
      !selection ||
      selection.record.lockState !== 'unlocked' ||
      selection.record.lockGeneration !== guard.lockGeneration ||
      selection.record.walletAuthMethodId !== guard.ownerMethodId ||
      !owner ||
      owner.record.status !== 'active' ||
      owner.record.kind === 'voiceid' ||
      owner.record.walletId !== scope.walletId ||
      owner.record.walletAuthorityId !== scope.authorityId
    ) {
      throw new Error('The owner session changed or expired. Start again.');
    }
  }
}

export async function assertVoiceOwner(
  scope: VoiceEnrollmentScope,
  guard: VoiceOwnerGuard,
): Promise<void> {
  const database = await IndexedDBManager.seamsWalletDB.getDB();
  const transaction = database.transaction(transactionStores, 'readwrite');
  try {
    await assertLifecycle(transaction, scope, guard);
    await transaction.done;
  } catch (error) {
    abortCommit(transaction);
    await transaction.done.catch(ignoreAbort);
    throw error;
  }
}

function ignoreAbort(): void {}

export type VoiceTemplateAccess =
  | { readonly kind: 'active'; readonly scope: VoiceEnrollmentScope; readonly owner?: never }
  | {
      readonly kind: 'activation';
      readonly scope: VoiceEnrollmentScope;
      readonly owner: VoiceOwnerGuard;
    };

export async function takeVoiceTemplate(
  access: VoiceTemplateAccess,
  signal: AbortSignal,
): Promise<number[]> {
  const scope = access.scope;
  const guard = access.kind === 'activation' ? access.owner : null;
  if (guard && guard.target !== 'activating')
    throw new Error('VoiceID activation requires its owner scope.');
  const database = await IndexedDBManager.seamsWalletDB.getDB();
  const transaction = database.transaction(transactionStores, 'readwrite');
  try {
    await assertLifecycle(transaction, scope, guard);
    const store = transaction.objectStore(stores.appState);
    const row = await store.get(enrollmentKey(scope));
    const enrollment = parseEnrollment(row?.value, scope);
    if (!enrollment)
      throw new Error(
        'Unlock with a passkey, then open Manage voice to import or record your enrollment.',
      );
    signal.throwIfAborted();
    const adaptation = enrollment.adaptation;
    const template =
      adaptation.kind === 'adapted'
        ? effectiveTemplate(enrollment.baseline, adaptation.samples)
        : [...enrollment.baseline];
    if (adaptation.kind === 'adapted') {
      const next = copyEnrollment(
        enrollment,
        adaptation.remainingUses === 1
          ? { kind: 'baseline' }
          : {
              kind: 'adapted',
              samples: adaptation.samples,
              expiresAtMs: adaptation.expiresAtMs,
              remainingUses: adaptation.remainingUses - 1,
            },
      );
      await store.put({ key: enrollmentKey(scope), value: next });
    } else if (JSON.stringify(row?.value?.adaptation) !== JSON.stringify(enrollment.adaptation)) {
      await store.put({
        key: enrollmentKey(scope),
        value: copyEnrollment(enrollment, { kind: 'baseline' }),
      });
    }
    await transaction.done;
    signal.throwIfAborted();
    return template;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* Transaction already completed. */
    }
    await transaction.done.catch(ignoreAbort);
    throw error;
  }
}

function copyEnrollment(
  enrollment: VoiceEnrollment,
  adaptation: VoiceEnrollment['adaptation'],
): VoiceEnrollment {
  return {
    kind: 'browser_voiceid_enrollment_v2',
    scope: enrollment.scope,
    model: enrollment.model,
    generation: enrollment.generation,
    revision: enrollment.revision + 1,
    baseline: enrollment.baseline,
    adaptation,
  };
}

export type VoiceEnrollmentChange =
  | {
      readonly kind: 'activate';
      readonly baseline: readonly number[];
      readonly samples?: never;
      readonly confirmation?: never;
    }
  | {
      readonly kind: 'replace' | 'import';
      readonly baseline: readonly number[];
      readonly samples?: never;
      readonly confirmation: ConfirmedVoiceChange;
    }
  | {
      readonly kind: 'improve';
      readonly samples: readonly (readonly number[])[];
      readonly baseline?: never;
      readonly confirmation: ConfirmedVoiceChange;
    }
  | {
      readonly kind: 'reset';
      readonly samples?: never;
      readonly baseline?: never;
      readonly confirmation: ConfirmedVoiceChange;
    };

export async function commitVoiceEnrollment(
  scope: VoiceEnrollmentScope,
  guard: VoiceOwnerGuard,
  snapshot: VoiceEnrollmentSnapshot,
  change: VoiceEnrollmentChange,
  signal: AbortSignal,
): Promise<void> {
  let next: VoiceEnrollment;
  if (change.kind === 'activate') {
    if (guard.target !== 'activating' || snapshot.kind !== 'missing')
      throw new Error('VoiceID activation cannot replace an enrollment.');
  } else {
    await change.confirmation.consume(scope, guard, snapshot, change.kind, signal);
  }
  if (change.kind === 'import' && (guard.target !== 'enrolled' || snapshot.kind !== 'missing')) {
    throw new Error('Import requires an existing method without a scoped enrollment.');
  }
  if (change.kind === 'replace' || change.kind === 'activate' || change.kind === 'import') {
    next = {
      kind: 'browser_voiceid_enrollment_v2',
      scope,
      model: VOICE_MODEL_ID,
      generation: crypto.randomUUID(),
      revision: 0,
      baseline: vector(change.baseline),
      adaptation: { kind: 'baseline' },
    };
  } else {
    if (snapshot.kind !== 'present') throw new Error('Record or import your original voice first.');
    if (change.kind === 'improve') {
      requireBoundedSamples(snapshot.enrollment.baseline, change.samples);
      next = copyEnrollment(snapshot.enrollment, {
        kind: 'adapted',
        samples: change.samples,
        expiresAtMs: Date.now() + MAX_AGE_MS,
        remainingUses: MAX_USES,
      });
    } else {
      next = copyEnrollment(snapshot.enrollment, { kind: 'baseline' });
    }
  }
  if (new TextEncoder().encode(JSON.stringify(next)).length > MAX_RECORD_BYTES)
    throw new Error('VoiceID enrollment exceeds its storage limit.');
  const database = await IndexedDBManager.seamsWalletDB.getDB();
  signal.throwIfAborted();
  const transaction = database.transaction(transactionStores, 'readwrite');
  const abort = abortCommit.bind(null, transaction);
  signal.addEventListener('abort', abort, { once: true });
  try {
    await assertLifecycle(transaction, scope, guard);
    const store = transaction.objectStore(stores.appState);
    const current = parseEnrollment((await store.get(enrollmentKey(scope)))?.value, scope);
    if (
      snapshot.kind === 'missing'
        ? current !== null
        : !current ||
          current.generation !== snapshot.enrollment.generation ||
          current.revision !== snapshot.enrollment.revision
    ) {
      throw new Error('VoiceID enrollment changed in another operation. Start again.');
    }
    signal.throwIfAborted();
    await store.put({ key: enrollmentKey(scope), value: next });
    if (change.kind === 'import') await retireImportedBrowserEnrollment(transaction);
    await transaction.done;
  } catch (error) {
    abort();
    await transaction.done.catch(ignoreAbort);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function abortCommit(transaction: EnrollmentTransaction): void {
  try {
    transaction.abort();
  } catch {
    /* Transaction already completed. */
  }
}

async function retireImportedBrowserEnrollment(transaction: EnrollmentTransaction): Promise<void> {
  const store = transaction.objectStore(stores.appState);
  const methods: unknown[] = await transaction.objectStore(stores.walletAuthMethods).getAll();
  for (const raw of methods) {
    if (!isPlainObject(raw) || raw.kind !== 'voiceid') continue;
    const row = parseWalletAuthMethodV2StorageRow(raw);
    if (!row) return;
    const method = row.record;
    if (method.kind !== 'voiceid' || method.status !== 'active') continue;
    const scope: VoiceEnrollmentScope = {
      walletId: method.walletId,
      authorityId: method.walletAuthorityId,
      walletAuthMethodId: method.walletAuthMethodId,
      deviceKeyId: method.deviceKeyId,
    };
    try {
      if (!parseEnrollment((await store.get(enrollmentKey(scope)))?.value, scope)) return;
    } catch {
      // Keep the migration source until every other VoiceID scope is usable.
      return;
    }
  }
  await store.delete(OLD_ENROLLMENT_KEY);
}

export async function removeVoiceEnrollments(
  walletId: WalletId,
  methodId: WalletAuthMethodId,
): Promise<void> {
  const database = await IndexedDBManager.seamsWalletDB.getDB();
  const transaction = database.transaction(stores.appState, 'readwrite');
  const store = transaction.objectStore(stores.appState);
  for (const key of await store.getAllKeys()) {
    if (typeof key !== 'string' || !key.startsWith('voiceid-browser-enrollment-v2:')) continue;
    const row = await store.get(key);
    if (row?.value?.scope?.walletId === walletId && row.value.scope.walletAuthMethodId === methodId)
      await store.delete(key);
  }
  await transaction.done;
}

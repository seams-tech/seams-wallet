import { reviseVoiceEnrollment } from './contracts';
import type { IDBPTransaction } from 'idb';
import { IndexedDBManager } from '@/core/indexedDB';
import { SEAMS_WALLET_STORES as stores } from '@/core/indexedDB/schemaNames';
import {
  parseWalletAuthMethodV2StorageRow,
  parseWalletAuthorityStorageRow,
  parseWalletSelectionStorageRow,
} from '@/core/indexedDB/seamsWalletDB/repositories';
import type { WalletId, WalletAuthMethodId, WalletAuthorityId } from '@shared/utils/domainIds';
import { isPlainObject } from '@shared/utils/validation';
import { deviceKey, readBrowserVoiceDevice, type BrowserVoiceDevice } from './deviceStore';
import {
  availabilityKey,
  parseStoredAuthMethodAvailability,
} from '@/core/authMethods/availability';
import {
  buildDelegatedWalletAuthorityV1,
  buildFullOwnerPermissionsV1,
  sameDelegatedWalletAuthorityV1,
} from '@shared/authorization/delegatedAuthority';

import type {
  VoiceEnrollmentScope,
  VoiceEnrollmentAuthorization,
  VoiceEnrollment,
  VoiceOwnerGuard,
  VoiceTemplateAccess,
} from './contracts';
const OLD_ENROLLMENT_KEY = 'voiceid-browser-enrollment-v1';
const MAX_RECORD_BYTES = 32_768;
const transactionStores = [
  stores.appState,
  stores.walletSelections,
  stores.walletAuthMethods,
  stores.walletAuthorities,
];
type EnrollmentTransaction = IDBPTransaction<unknown, string[], 'readwrite'>;

function voiceEnrollmentScope(
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
      await transaction.objectStore(stores.walletAuthMethods).get(guard.sessionMethodId),
    );
    if (
      guard.expiresAtMs <= Date.now() ||
      availability.revision !== guard.availabilityRevision ||
      !selection ||
      selection.record.lockState !== 'unlocked' ||
      selection.record.lockGeneration !== guard.lockGeneration ||
      selection.record.walletAuthMethodId !== guard.sessionMethodId ||
      !owner ||
      owner.record.status !== 'active' ||
      (guard.target === 'activating' && owner.record.kind === 'voiceid') ||
      owner.record.walletId !== scope.walletId ||
      owner.record.walletAuthorityId !== scope.authorityId
    ) {
      throw new Error('The owner session changed or expired. Start again.');
    }
    if (guard.target === 'enrolled') {
      const confirmer = parseWalletAuthMethodV2StorageRow(
        await transaction.objectStore(stores.walletAuthMethods).get(guard.confirmationMethodId),
      );
      if (
        !confirmer ||
        confirmer.record.kind !== 'passkey' ||
        confirmer.record.status !== 'active' ||
        confirmer.record.walletId !== scope.walletId ||
        confirmer.record.walletAuthorityId !== scope.authorityId
      ) {
        throw new Error('The confirming passkey changed or was removed. Start again.');
      }
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

type VoiceEnrollmentParser = (raw: unknown, scope: VoiceEnrollmentScope) => VoiceEnrollment | null;
type WriteBase = Readonly<{
  scope: VoiceEnrollmentScope;
  next: VoiceEnrollment;
  signal: AbortSignal;
}>;
export type VoiceEnrollmentWrite = WriteBase & VoiceEnrollmentAuthorization;

export function voiceEnrollmentStorage(parseEnrollment: VoiceEnrollmentParser) {
  return {
    read: readVoiceEnrollment.bind(null, parseEnrollment),
    readTemplate: readTemplateEnrollment.bind(null, parseEnrollment),
    commit: commitEnrollment.bind(null, parseEnrollment),
    readImportable: readImportableRecord,
  };
}

function readImportableRecord(): Promise<unknown> {
  return IndexedDBManager.getAppState(OLD_ENROLLMENT_KEY);
}
async function readVoiceEnrollment(
  parseEnrollment: VoiceEnrollmentParser,
  scope: VoiceEnrollmentScope,
): Promise<VoiceEnrollment | null> {
  const database = await IndexedDBManager.seamsWalletDB.getDB();
  const transaction = database.transaction(stores.appState, 'readwrite');
  try {
    const row = await transaction.store.get(enrollmentKey(scope));
    let enrollment = parseEnrollment(row?.value, scope);
    if (
      enrollment &&
      JSON.stringify(row?.value?.adaptation) !== JSON.stringify(enrollment.adaptation)
    ) {
      enrollment = reviseVoiceEnrollment(enrollment, enrollment.adaptation);
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

async function readTemplateEnrollment(
  parseEnrollment: VoiceEnrollmentParser,
  access: VoiceTemplateAccess,
  signal: AbortSignal,
): Promise<VoiceEnrollment> {
  const scope = access.scope;
  const guard = access.kind === 'activation' ? access.owner : null;
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
    if (JSON.stringify(row?.value?.adaptation) !== JSON.stringify(adaptation)) {
      await store.put({
        key: enrollmentKey(scope),
        value: reviseVoiceEnrollment(enrollment, adaptation),
      });
    }
    await transaction.done;
    signal.throwIfAborted();
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

async function commitEnrollment(
  parseEnrollment: VoiceEnrollmentParser,
  input: VoiceEnrollmentWrite,
): Promise<void> {
  const { scope, guard, snapshot, next, signal } = input;
  if (input.kind !== 'activate') {
    await input.confirmation.consume(input.scope, input);
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
    if (input.kind === 'import')
      await retireImportedBrowserEnrollment(parseEnrollment, transaction);
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

async function retireImportedBrowserEnrollment(
  parseEnrollment: VoiceEnrollmentParser,
  transaction: EnrollmentTransaction,
): Promise<void> {
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

export async function resolveActivatingVoiceEnrollmentScope(
  device: BrowserVoiceDevice,
): Promise<VoiceEnrollmentScope> {
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(device.walletId);
  if (selected.kind !== 'resolved')
    throw new Error('Select the owner wallet before enrolling VoiceID.');
  return voiceEnrollmentScope(device, selected.authority.authorityId);
}

export async function resolveSelectedVoiceEnrollmentScope(
  walletId: WalletId,
): Promise<VoiceEnrollmentScope> {
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(walletId);
  if (
    selected.kind !== 'resolved' ||
    selected.authMethod.kind !== 'voiceid' ||
    selected.selection.lockState !== 'unlocked'
  ) {
    throw new Error('Unlock this wallet with VoiceID before voice approval.');
  }
  return resolveVoiceEnrollmentScope(walletId, selected.authMethod.walletAuthMethodId);
}

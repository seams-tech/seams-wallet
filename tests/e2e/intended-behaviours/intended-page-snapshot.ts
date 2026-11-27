import type { Page } from '@playwright/test';
import {
  type EmailOtpUnlockNearIdentity,
  type IntendedActionName,
  type IntendedActionResult,
  type IntendedActionState,
  type IntendedEcdsaSummary,
  type IntendedEcdsaTargetKeysSummary,
  type IntendedEcdsaTargetKeySummary,
  type IntendedEcdsaTargetProfileName,
  type IntendedLifecycleEvent,
  type IntendedPageState,
  type IntendedResult,
  isIntendedActionName,
} from '../../intended-app/src/intendedContract';
import { getAddress } from 'viem';
import {
  assertNever,
  requireAuthenticatedKind,
  requireHexString,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireRecord,
  requireString,
} from './harness-validation';
import type { RegisteredNearStateSnapshot, RegisteredWalletSnapshot } from './registered-wallet';
import { assertSameEcdsaAddress } from './signature-verification';

/** The part of the page state that each action's outcome is read from. */
export type IntendedPageSnapshot = Pick<IntendedPageState, 'action' | 'events'>;

export function intendedPageActionIsComplete(expectedAction: string): boolean {
  const status = document.querySelector('[data-testid="intended-action-status"]');
  if (!status) return false;
  const state = status.getAttribute('data-state');
  const actionName = status.getAttribute('data-action');
  return actionName === expectedAction && (state === 'success' || state === 'error');
}

export function intendedPageActionStartedOrCompleted(expectedAction: string): boolean {
  const status = document.querySelector('[data-testid="intended-action-status"]');
  if (!status) return false;
  const state = status.getAttribute('data-state');
  const actionName = status.getAttribute('data-action');
  return (
    actionName === expectedAction &&
    (state === 'running' || state === 'success' || state === 'error')
  );
}

function isResultOfKind<K extends IntendedActionResult['kind']>(
  result: IntendedActionResult,
  kind: K,
): result is IntendedResult<K> {
  return result.kind === kind;
}

/** The result of a successful action, of the kind the step expects. */
function requireSucceededResult<K extends IntendedActionResult['kind']>(
  snapshot: IntendedPageSnapshot,
  kind: K,
  label: string,
): IntendedResult<K> {
  if (snapshot.action.status !== 'success') {
    throw new Error(`${label} did not succeed: ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (!isResultOfKind(result, kind)) {
    throw new Error(`${label} returned unexpected result kind: ${result.kind}`);
  }
  return result;
}

/** The kinds of result that name the wallet they acted on. */
type WalletResultKind = Exclude<IntendedActionResult['kind'], 'device_link_qr_ready'>;

/** `requireSucceededResult` for an action on the expected wallet. */
export function requireWalletResult<K extends WalletResultKind>(
  snapshot: IntendedPageSnapshot,
  kind: K,
  label: string,
  expectedWalletId: string,
): IntendedResult<K> {
  const result = requireSucceededResult(snapshot, kind, label);
  const onWallet: IntendedResult<WalletResultKind> = result;
  if (onWallet.walletId !== expectedWalletId) {
    throw new Error(`${label} wallet mismatch: ${onWallet.walletId}`);
  }
  return result;
}

/** The result of a successful action; a failed action is reported with its error. */
export function requireEndedResult<K extends IntendedActionResult['kind']>(
  snapshot: IntendedPageSnapshot,
  kind: K,
  label: string,
): IntendedResult<K> {
  if (snapshot.action.status !== 'success') {
    throw new Error(
      `${label} ended with ${snapshot.action.status}: ${
        snapshot.action.status === 'error' ? snapshot.action.error : ''
      }`,
    );
  }
  const result = snapshot.action.result;
  if (!isResultOfKind(result, kind)) {
    throw new Error(`${label} returned ${result.kind}`);
  }
  return result;
}

export function requireEd25519AddSignerResult(
  snapshot: IntendedPageSnapshot,
  expectedWalletId: string,
): IntendedResult<'wallet_signer_added'> {
  const result = requireWalletResult(
    snapshot,
    'wallet_signer_added',
    'Ed25519 add-signer',
    expectedWalletId,
  );
  if (!result.nearAccountId || !result.nearEd25519SigningKeyId || !result.operationalPublicKey) {
    throw new Error('Ed25519 add-signer result is missing signer identity');
  }
  return result;
}

export function requireEmailOtpRegistrationResult(
  snapshot: IntendedPageSnapshot,
): IntendedResult<'email_otp_registration_success'> {
  const result = requireSucceededResult(
    snapshot,
    'email_otp_registration_success',
    'Email OTP registration',
  );
  if (!result.initialWalletId) {
    throw new Error('Email OTP registration result is missing initialWalletId');
  }
  if (!result.walletId) {
    throw new Error('Email OTP registration result is missing walletId');
  }
  if (result.walletId === result.initialWalletId) {
    throw new Error('Email OTP registration did not reroll the initial wallet id');
  }
  if (result.authenticationKind !== 'authenticated') {
    throw new Error(
      `Email OTP registration did not authenticate the wallet: ${result.authenticationKind}`,
    );
  }
  return result;
}

export function requireDeviceLinkApprovalResult(
  snapshot: IntendedPageSnapshot,
  expectedWalletId: string,
): IntendedResult<'device_link_approval_recorded'> {
  if (snapshot.action.status !== 'success') {
    throw new Error(`Device 1 link approval ended with ${snapshot.action.status}`);
  }
  const result = snapshot.action.result;
  if (result.kind !== 'device_link_approval_recorded') {
    throw new Error(`Device 1 link approval returned ${result.kind}`);
  }
  if (result.walletId !== expectedWalletId) {
    throw new Error(`Device 1 approved a link for ${result.walletId}`);
  }
  return result;
}

export function requireNearSigningResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    nearAccountId: string;
  },
): IntendedResult<'near_sign_success'> {
  const result = requireWalletResult(
    snapshot,
    'near_sign_success',
    'NEAR signing',
    expected.walletId,
  );
  if (result.nearAccountId !== expected.nearAccountId) {
    throw new Error(`NEAR signing account mismatch: ${result.nearAccountId}`);
  }
  if (!result.signedTransactionB64) {
    throw new Error('NEAR signing result is missing signedTransactionB64');
  }
  if (result.signedTransactionByteLength <= 0) {
    throw new Error('NEAR signing result is missing signed transaction bytes');
  }
  return result;
}

export function requirePasskeyUnlockResult(
  snapshot: IntendedPageSnapshot,
  expected: RegisteredWalletSnapshot & { nearReadiness: 'ready' | 'absent' },
): IntendedResult<'passkey_unlock_success'> {
  const result = requireWalletResult(
    snapshot,
    'passkey_unlock_success',
    'Passkey unlock',
    expected.walletId,
  );
  switch (expected.nearReadiness) {
    case 'ready':
      if (result.nearIdentity !== 'ready') {
        throw new Error('Passkey unlock did not return its expected NEAR identity');
      }
      if (result.nearAccountId !== expected.nearAccountId) {
        throw new Error(`Passkey unlock NEAR account mismatch: ${result.nearAccountId}`);
      }
      if (result.operationalPublicKey !== expected.operationalPublicKey) {
        throw new Error('Passkey unlock operational public key mismatch');
      }
      break;
    case 'absent':
      if (result.nearIdentity !== 'absent') {
        throw new Error('ECDSA-only Passkey unlock unexpectedly returned a NEAR identity');
      }
      break;
  }
  if (result.authenticationKind !== 'authenticated') {
    throw new Error(`Passkey unlock did not authenticate the wallet: ${result.authenticationKind}`);
  }
  return result;
}

export function requirePasskeySyncResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    nearAccountId: string;
    operationalPublicKey: string;
  },
): IntendedResult<'passkey_sync_success'> {
  const result = requireWalletResult(
    snapshot,
    'passkey_sync_success',
    'Passkey cold sync',
    expected.walletId,
  );
  if (result.nearAccountId !== expected.nearAccountId) {
    throw new Error(`Passkey cold sync NEAR account mismatch: ${result.nearAccountId}`);
  }
  if (result.operationalPublicKey !== expected.operationalPublicKey) {
    throw new Error('Passkey cold sync changed the Ed25519 public key');
  }
  return result;
}

export function requireEmailOtpUnlockResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    nearAccountId: string;
    operationalPublicKey: string;
  } & IntendedEcdsaSummary,
): IntendedResult<'email_otp_unlock_success'> {
  const result = requireSucceededResult(snapshot, 'email_otp_unlock_success', 'Email OTP unlock');
  if (result.nearIdentity !== 'ready') {
    throw new Error('Completed Email OTP wallet unlock omitted its NEAR identity');
  }
  if (result.walletId !== expected.walletId) {
    throw new Error(`Email OTP unlock wallet mismatch: ${result.walletId}`);
  }
  if (result.nearAccountId !== expected.nearAccountId) {
    throw new Error(`Email OTP unlock NEAR account mismatch: ${result.nearAccountId}`);
  }
  if (result.operationalPublicKey !== expected.operationalPublicKey) {
    throw new Error('Email OTP unlock operational public key mismatch');
  }
  assertEcdsaEnabledSnapshotsMatch({
    actual: result,
    expected,
    label: 'Email OTP unlock',
  });
  if (result.authenticationKind !== 'authenticated') {
    throw new Error(
      `Email OTP unlock did not authenticate the wallet: ${result.authenticationKind}`,
    );
  }
  return result;
}

function assertEcdsaEnabledSnapshotsMatch(args: {
  actual: IntendedEcdsaSummary;
  expected: IntendedEcdsaSummary;
  label: string;
}): void {
  if (args.actual.ecdsaTargetProfile !== args.expected.ecdsaTargetProfile) {
    throw new Error(
      `${args.label} ECDSA target profile mismatch: ${args.actual.ecdsaTargetProfile}`,
    );
  }
  switch (args.actual.ecdsaTargetProfile) {
    case 'none':
      return;
    case 'tempo':
      if (args.expected.ecdsaTargetProfile !== 'tempo') {
        throw new Error(`${args.label} ECDSA expected profile mismatch`);
      }
      assertSameEcdsaAddress({
        actual: args.actual.thresholdEcdsaEthereumAddress,
        expected: args.expected.thresholdEcdsaEthereumAddress,
        label: `${args.label} threshold ECDSA address`,
      });
      if (args.actual.thresholdEcdsaPublicKeyB64u !== args.expected.thresholdEcdsaPublicKeyB64u) {
        throw new Error(`${args.label} threshold ECDSA public key mismatch`);
      }
      assertEcdsaTargetKeysMatch({
        actual: args.actual.ecdsaTargetKeys,
        expected: args.expected.ecdsaTargetKeys,
        label: `${args.label} ECDSA target keys`,
      });
      return;
    case 'tempo_arc':
      if (args.expected.ecdsaTargetProfile !== 'tempo_arc') {
        throw new Error(`${args.label} ECDSA expected profile mismatch`);
      }
      assertEcdsaTargetKeysMatch({
        actual: args.actual.ecdsaTargetKeys,
        expected: args.expected.ecdsaTargetKeys,
        label: `${args.label} ECDSA target keys`,
      });
      return;
    default:
      return assertNever(args.actual);
  }
}

function assertEcdsaTargetKeysMatch(args: {
  actual: IntendedEcdsaTargetKeysSummary;
  expected: IntendedEcdsaTargetKeysSummary;
  label: string;
}): void {
  if (args.actual.kind !== args.expected.kind) {
    throw new Error(`${args.label} profile mismatch: ${args.actual.kind}`);
  }
  switch (args.actual.kind) {
    case 'none':
      return;
    case 'tempo':
      if (args.expected.kind !== 'tempo') {
        throw new Error(`${args.label} expected profile mismatch`);
      }
      assertEcdsaTargetKeyMatch({
        actual: args.actual.tempo,
        expected: args.expected.tempo,
        label: `${args.label} Tempo`,
      });
      return;
    case 'tempo_arc':
      if (args.expected.kind !== 'tempo_arc') {
        throw new Error(`${args.label} expected profile mismatch`);
      }
      assertEcdsaTargetKeyMatch({
        actual: args.actual.tempo,
        expected: args.expected.tempo,
        label: `${args.label} Tempo`,
      });
      assertEcdsaTargetKeyMatch({
        actual: args.actual.arcEvm,
        expected: args.expected.arcEvm,
        label: `${args.label} Arc/EVM`,
      });
      return;
    default:
      return assertNever(args.actual);
  }
}

function assertEcdsaTargetKeyMatch(args: {
  actual: IntendedEcdsaTargetKeySummary;
  expected: IntendedEcdsaTargetKeySummary;
  label: string;
}): void {
  if (args.actual.chain !== args.expected.chain) {
    throw new Error(`${args.label} chain mismatch: ${args.actual.chain}`);
  }
  if (args.actual.chainId !== args.expected.chainId) {
    throw new Error(`${args.label} chainId mismatch: ${args.actual.chainId}`);
  }
  if (
    getAddress(args.actual.thresholdOwnerAddress) !==
    getAddress(args.expected.thresholdOwnerAddress)
  ) {
    throw new Error(`${args.label} threshold owner mismatch`);
  }
}

export function requireTempoSigningResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    chainId: number;
  },
): IntendedResult<'tempo_sign_success'> {
  const result = requireWalletResult(
    snapshot,
    'tempo_sign_success',
    'Tempo signing',
    expected.walletId,
  );
  if (result.chainId !== expected.chainId) {
    throw new Error(`Tempo signing chainId mismatch: ${result.chainId}`);
  }
  return result;
}

export function requireArcEvmSigningResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    chainId: number;
  },
): IntendedResult<'arc_evm_sign_success'> {
  const result = requireWalletResult(
    snapshot,
    'arc_evm_sign_success',
    'Arc/EVM signing',
    expected.walletId,
  );
  if (result.chainId !== expected.chainId) {
    throw new Error(`Arc/EVM signing chainId mismatch: ${result.chainId}`);
  }
  return result;
}

export function requireEcdsaExportResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    chainId: number;
  },
): IntendedResult<'ecdsa_export_success'> {
  const result = requireWalletResult(
    snapshot,
    'ecdsa_export_success',
    'ECDSA export',
    expected.walletId,
  );
  if (result.chainId !== expected.chainId) {
    throw new Error(`ECDSA export chainId mismatch: ${result.chainId}`);
  }
  return result;
}

export function requireEd25519ExportResult(
  snapshot: IntendedPageSnapshot,
  expected: {
    walletId: string;
    nearAccountId: string;
  },
): IntendedResult<'ed25519_export_success'> {
  const result = requireWalletResult(
    snapshot,
    'ed25519_export_success',
    'Ed25519 export',
    expected.walletId,
  );
  if (result.nearAccountId !== expected.nearAccountId) {
    throw new Error(`Ed25519 export NEAR account mismatch: ${result.nearAccountId}`);
  }
  return result;
}

export async function readIntendedPageSnapshot(page: Page): Promise<IntendedPageSnapshot> {
  const text = await page.getByTestId('intended-result-json').textContent();
  if (!text) throw new Error('Intended page snapshot is empty');
  return parseIntendedPageSnapshot(JSON.parse(text));
}

export function parseIntendedConcurrentActionSnapshots(
  rawSnapshots: readonly unknown[],
): IntendedPageSnapshot[] {
  const snapshots: IntendedPageSnapshot[] = [];
  for (const raw of rawSnapshots) {
    snapshots.push(parseIntendedPageSnapshot(raw));
  }
  return snapshots;
}

export function requireConcurrentSigningSuccess(
  snapshots: readonly IntendedPageSnapshot[],
  action: 'signTempoTransaction' | 'signArcEvmTransaction',
): IntendedPageSnapshot {
  let success: IntendedPageSnapshot | null = null;
  for (const snapshot of snapshots) {
    if (snapshot.action.status === 'error' && snapshot.action.action === action) {
      throw new Error(`Concurrent ${action} failed: ${snapshot.action.error}`);
    }
    if (snapshot.action.status === 'success' && snapshot.action.action === action) {
      success = snapshot;
    }
  }
  if (success) return success;
  throw new Error(`Concurrent ${action} did not produce a success result`);
}

export function snapshotWithMostLifecycleEvents(
  left: IntendedPageSnapshot,
  right: IntendedPageSnapshot,
): IntendedPageSnapshot {
  return left.events.length >= right.events.length ? left : right;
}

function parseIntendedPageSnapshot(raw: unknown): IntendedPageSnapshot {
  const record = requireRecord(raw, 'intended page snapshot');
  return {
    action: parseIntendedPageActionSnapshot(record.action),
    events: parseIntendedPageLifecycleEvents(record.events),
  };
}

function parseIntendedPageLifecycleEvents(raw: unknown): readonly IntendedLifecycleEvent[] {
  if (!Array.isArray(raw)) {
    throw new Error('intended page snapshot events must be an array');
  }
  return raw.map(parseIntendedPageLifecycleEvent);
}

function parseIntendedPageLifecycleEvent(raw: unknown): IntendedLifecycleEvent {
  const record = requireRecord(raw, 'intended page lifecycle event');
  const index = Number(record.index);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('intended page lifecycle event index must be a non-negative integer');
  }
  return {
    index,
    payload: record.payload,
  };
}

function parseIntendedPageActionSnapshot(raw: unknown): IntendedActionState {
  const record = requireRecord(raw, 'intended page action');
  const status = requireString(record.status, 'intended page action status');
  switch (status) {
    case 'idle':
      return { status };
    case 'running':
      return { status, action: parseIntendedActionName(record.action) };
    case 'success':
      return {
        status,
        action: parseIntendedActionName(record.action),
        result: parseIntendedActionResultSnapshot(record.result),
      };
    case 'error':
      return {
        status,
        action: parseIntendedActionName(record.action),
        error: requireString(record.error, 'intended page action error'),
      };
    default:
      throw new Error(`Unknown intended page action status: ${status}`);
  }
}

function parseEmailOtpUnlockNearIdentity(
  record: Record<string, unknown>,
): EmailOtpUnlockNearIdentity {
  switch (record.nearIdentity) {
    case 'ready':
      return {
        nearIdentity: 'ready',
        nearAccountId: requireString(record.nearAccountId, 'Email OTP unlock nearAccountId'),
        operationalPublicKey: requireString(
          record.operationalPublicKey,
          'Email OTP unlock operationalPublicKey',
        ),
      };
    case 'absent':
      if (record.nearAccountId !== undefined || record.operationalPublicKey !== undefined) {
        throw new Error('Email OTP unlock has contradictory NEAR identity fields');
      }
      return { nearIdentity: 'absent' };
    default:
      throw new Error('Email OTP unlock returned an invalid NEAR identity state');
  }
}

function parsePasskeyUnlockResultSnapshot(
  record: Record<string, unknown>,
): IntendedResult<'passkey_unlock_success'> {
  const nearIdentity = requireString(record.nearIdentity, 'passkey unlock NEAR identity');
  const common = {
    kind: 'passkey_unlock_success' as const,
    walletId: requireString(record.walletId, 'passkey unlock walletId'),
    sessionWalletAuthMethodId: requireString(
      record.sessionWalletAuthMethodId,
      'passkey unlock sessionWalletAuthMethodId',
    ),
    authenticationKind: requireAuthenticatedKind(
      record.authenticationKind,
      'passkey unlock authenticationKind',
    ),
  };
  switch (nearIdentity) {
    case 'ready':
      return {
        ...common,
        nearIdentity,
        nearAccountId: requireString(record.nearAccountId, 'passkey unlock nearAccountId'),
        operationalPublicKey: requireString(
          record.operationalPublicKey,
          'passkey unlock operationalPublicKey',
        ),
      };
    case 'absent':
      return {
        ...common,
        nearIdentity,
      };
    default:
      throw new Error(`Unknown passkey unlock NEAR identity: ${nearIdentity}`);
  }
}

function parseIntendedActionResultSnapshot(raw: unknown): IntendedActionResult {
  const record = requireRecord(raw, 'intended action result');
  const kind = requireString(record.kind, 'intended action result kind');
  switch (kind) {
    case 'passkey_registration_success': {
      const walletId = requireString(record.walletId, 'passkey registration walletId');
      const near = parseRegisteredNearState(record, 'passkey registration');
      return {
        kind,
        walletId,
        ...(near.nearReadiness === 'ready'
          ? {
              ...near,
              nearEd25519SigningKeyId: requireString(
                record.nearEd25519SigningKeyId,
                'passkey registration nearEd25519SigningKeyId',
              ),
            }
          : near),
        ...parseEcdsaEnabledSnapshot(record, 'passkey registration'),
      };
    }
    case 'wallet_signer_added':
      return {
        kind,
        walletId: requireString(record.walletId, 'Ed25519 add-signer walletId'),
        nearAccountId: requireString(record.nearAccountId, 'Ed25519 add-signer nearAccountId'),
        nearEd25519SigningKeyId: requireString(
          record.nearEd25519SigningKeyId,
          'Ed25519 add-signer nearEd25519SigningKeyId',
        ),
        operationalPublicKey: requireString(
          record.operationalPublicKey,
          'Ed25519 add-signer operationalPublicKey',
        ),
      };
    case 'ecdsa_signer_added':
      return {
        kind,
        walletId: requireString(record.walletId, 'ECDSA add-signer walletId'),
        ...parseEcdsaEnabledSnapshot(record, 'ECDSA add-signer'),
      };
    case 'add_email_otp_success': {
      const authMethod = requireRecord(record.authMethod, 'add-email-code auth method');
      if (authMethod.kind !== 'email_otp' || authMethod.status !== 'active') {
        throw new Error('add-email-code auth method is not active Email OTP');
      }
      return {
        kind,
        walletId: requireString(record.walletId, 'add-email-code walletId'),
        emailAddress: requireString(record.emailAddress, 'add-email-code emailAddress'),
        walletAuthMethodId: requireString(
          record.walletAuthMethodId,
          'add-email-code walletAuthMethodId',
        ),
        authMethod: { kind: 'email_otp', status: 'active' },
      };
    }
    case 'add_passkey_success': {
      const authMethod = requireRecord(record.authMethod, 'add-passkey auth method');
      if (authMethod.kind !== 'passkey' || authMethod.status !== 'active') {
        throw new Error('add-passkey auth method is not an active Passkey');
      }
      return {
        kind,
        walletId: requireString(record.walletId, 'add-passkey walletId'),
        rpId: requireString(record.rpId, 'add-passkey rpId'),
        walletAuthMethodId: requireString(
          record.walletAuthMethodId,
          'add-passkey walletAuthMethodId',
        ),
        authMethod: { kind: 'passkey', status: 'active' },
      };
    }
    case 'revoke_auth_method_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'revoke walletId'),
        walletAuthMethodId: requireString(record.walletAuthMethodId, 'revoke walletAuthMethodId'),
      };
    case 'added_email_otp_unlock_success': {
      return {
        kind,
        walletId: requireString(record.walletId, 'added email-code unlock walletId'),
        sessionWalletAuthMethodId: requireString(
          record.sessionWalletAuthMethodId,
          'added email-code unlock sessionWalletAuthMethodId',
        ),
        authenticationKind: requireAuthenticatedKind(
          record.authenticationKind,
          'added email-code unlock authenticationKind',
        ),
      };
    }
    case 'near_sign_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'NEAR signing walletId'),
        nearAccountId: requireString(record.nearAccountId, 'NEAR signing nearAccountId'),
        signedTransactionB64: requireString(
          record.signedTransactionB64,
          'NEAR signing signedTransactionB64',
        ),
        signedTransactionByteLength: requirePositiveInteger(
          record.signedTransactionByteLength,
          'NEAR signing signedTransactionByteLength',
        ),
      };
    case 'email_otp_registration_success':
      return {
        kind,
        initialWalletId: requireString(
          record.initialWalletId,
          'Email OTP registration initialWalletId',
        ),
        walletId: requireString(record.walletId, 'Email OTP registration walletId'),
        ...parseRegisteredNearState(record, 'Email OTP registration'),
        authenticationKind: requireAuthenticatedKind(
          record.authenticationKind,
          'Email OTP registration authenticationKind',
        ),
        ...parseEcdsaEnabledSnapshot(record, 'Email OTP registration'),
      };
    case 'near_provisioning_ready':
      return {
        kind,
        walletId: requireString(record.walletId, 'NEAR provisioning walletId'),
        nearAccountId: requireString(record.nearAccountId, 'NEAR provisioning nearAccountId'),
        operationalPublicKey: requireString(
          record.operationalPublicKey,
          'NEAR provisioning operationalPublicKey',
        ),
      };
    case 'passkey_unlock_success':
      return parsePasskeyUnlockResultSnapshot(record);
    case 'passkey_sync_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'passkey sync walletId'),
        nearAccountId: requireString(record.nearAccountId, 'passkey sync nearAccountId'),
        operationalPublicKey: requireString(
          record.operationalPublicKey,
          'passkey sync operationalPublicKey',
        ),
      };
    case 'passkey_recovery_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'passkey recovery walletId'),
        activeRecoveryCodeCount: requireNonNegativeInteger(
          record.activeRecoveryCodeCount,
          'passkey recovery activeRecoveryCodeCount',
        ),
        totalRecoveryCodeCount: requirePositiveInteger(
          record.totalRecoveryCodeCount,
          'passkey recovery totalRecoveryCodeCount',
        ),
      };
    case 'google_email_otp_recovery_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'Google Email OTP recovery walletId'),
        activeRecoveryCodeCount: requireNonNegativeInteger(
          record.activeRecoveryCodeCount,
          'Google Email OTP recovery activeRecoveryCodeCount',
        ),
        totalRecoveryCodeCount: requirePositiveInteger(
          record.totalRecoveryCodeCount,
          'Google Email OTP recovery totalRecoveryCodeCount',
        ),
      };
    case 'email_otp_unlock_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'Email OTP unlock walletId'),
        ...parseEmailOtpUnlockNearIdentity(record),
        sessionWalletAuthMethodId: requireString(
          record.sessionWalletAuthMethodId,
          'Email OTP unlock sessionWalletAuthMethodId',
        ),
        authenticationKind: requireAuthenticatedKind(
          record.authenticationKind,
          'Email OTP unlock authenticationKind',
        ),
        ...parseEcdsaEnabledSnapshot(record, 'Email OTP unlock'),
      };
    case 'tempo_sign_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'Tempo signing walletId'),
        chainId: requirePositiveInteger(record.chainId, 'Tempo signing chainId'),
        senderHashHex: requireHexString(record.senderHashHex, 'Tempo signing senderHashHex'),
        rawTxHex: requireHexString(record.rawTxHex, 'Tempo signing rawTxHex'),
      };
    case 'arc_evm_sign_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'Arc/EVM signing walletId'),
        chainId: requirePositiveInteger(record.chainId, 'Arc/EVM signing chainId'),
        txHashHex: requireHexString(record.txHashHex, 'Arc/EVM signing txHashHex'),
        rawTxHex: requireHexString(record.rawTxHex, 'Arc/EVM signing rawTxHex'),
      };
    case 'ecdsa_export_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'ECDSA export walletId'),
        chainId: requirePositiveInteger(record.chainId, 'ECDSA export chainId'),
      };
    case 'ed25519_export_success':
      return {
        kind,
        walletId: requireString(record.walletId, 'Ed25519 export walletId'),
        nearAccountId: requireString(record.nearAccountId, 'Ed25519 export nearAccountId'),
      };
    case 'device_link_qr_ready':
      return {
        kind,
        linkSessionId: requireString(record.linkSessionId, 'device-link QR linkSessionId'),
        qrPayloadJson: requireString(record.qrPayloadJson, 'device-link QR payload'),
      };
    case 'device_link_approval_recorded':
      return {
        kind,
        walletId: requireString(record.walletId, 'device-link approval walletId'),
        enrollmentId: requireString(record.enrollmentId, 'device-link approval enrollmentId'),
        deviceId: requireString(record.deviceId, 'device-link approval deviceId'),
      };
    case 'linked_device_revoked':
      return {
        kind,
        walletId: requireString(record.walletId, 'linked-device revocation walletId'),
        walletAuthMethodId: requireString(
          record.walletAuthMethodId,
          'linked-device revocation walletAuthMethodId',
        ),
        authorityId: requireString(record.authorityId, 'linked-device revocation authorityId'),
        revocationEpoch: requireNonNegativeInteger(
          record.revocationEpoch,
          'linked-device revocation revocationEpoch',
        ),
      };
    default:
      throw new Error(`Unknown intended action result kind: ${kind}`);
  }
}

function parseRegisteredNearState(
  record: Record<string, unknown>,
  label: string,
): RegisteredNearStateSnapshot {
  if (record.nearReadiness === 'absent') return { nearReadiness: 'absent' };
  const rawProvisioning = record.nearProvisioning;
  if (rawProvisioning !== undefined) {
    const provisioning = requireRecord(rawProvisioning, `${label} nearProvisioning`);
    const status = requireString(provisioning.status, `${label} nearProvisioning status`);
    switch (status) {
      case 'pending':
        return { nearReadiness: 'pending', nearProvisioning: { status } };
      case 'provisioning':
        return { nearReadiness: 'pending', nearProvisioning: { status } };
      case 'retryable':
        return {
          nearReadiness: 'pending',
          nearProvisioning: {
            status,
            error: requireString(provisioning.error, `${label} nearProvisioning error`),
            errorCode: requireString(provisioning.errorCode, `${label} nearProvisioning errorCode`),
          },
        };
      default:
        throw new Error(`${label} returned unknown NEAR provisioning state: ${status}`);
    }
  }
  return {
    nearReadiness: 'ready',
    nearAccountId: requireString(record.nearAccountId, `${label} nearAccountId`),
    operationalPublicKey: requireString(
      record.operationalPublicKey,
      `${label} operationalPublicKey`,
    ),
  };
}

function parseEcdsaEnabledSnapshot(
  raw: Record<string, unknown>,
  label: string,
): IntendedEcdsaSummary {
  const profile = parseEcdsaTargetProfileName(recordValue(raw, 'ecdsaTargetProfile'), label);
  const ecdsaTargetKeys = parseEcdsaTargetKeys(raw.ecdsaTargetKeys, label);
  switch (profile) {
    case 'none':
      if (ecdsaTargetKeys.kind !== 'none') {
        throw new Error(`${label} ECDSA target key profile mismatch: ${ecdsaTargetKeys.kind}`);
      }
      return {
        ecdsaTargetProfile: 'none',
        ecdsaTargetKeys,
      };
    case 'tempo':
      if (ecdsaTargetKeys.kind !== 'tempo') {
        throw new Error(`${label} ECDSA target key profile mismatch: ${ecdsaTargetKeys.kind}`);
      }
      return {
        ecdsaTargetProfile: 'tempo',
        thresholdEcdsaEthereumAddress: requireString(
          raw.thresholdEcdsaEthereumAddress,
          `${label} thresholdEcdsaEthereumAddress`,
        ),
        thresholdEcdsaPublicKeyB64u: requireString(
          raw.thresholdEcdsaPublicKeyB64u,
          `${label} thresholdEcdsaPublicKeyB64u`,
        ),
        ecdsaTargetKeys,
      };
    case 'tempo_arc':
      if (ecdsaTargetKeys.kind !== 'tempo_arc') {
        throw new Error(`${label} ECDSA target key profile mismatch: ${ecdsaTargetKeys.kind}`);
      }
      return {
        ecdsaTargetProfile: 'tempo_arc',
        thresholdEcdsaEthereumAddress: requireString(
          raw.thresholdEcdsaEthereumAddress,
          `${label} thresholdEcdsaEthereumAddress`,
        ),
        thresholdEcdsaPublicKeyB64u: requireString(
          raw.thresholdEcdsaPublicKeyB64u,
          `${label} thresholdEcdsaPublicKeyB64u`,
        ),
        ecdsaTargetKeys,
      };
    default:
      return assertNever(profile);
  }
}

function parseEcdsaTargetProfileName(raw: unknown, label: string): IntendedEcdsaTargetProfileName {
  const value = requireString(raw, `${label} ecdsaTargetProfile`);
  switch (value) {
    case 'none':
    case 'tempo':
    case 'tempo_arc':
      return value;
    default:
      throw new Error(`${label} ecdsaTargetProfile is invalid: ${value}`);
  }
}

function recordValue(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function parseEcdsaTargetKeys(raw: unknown, label: string): IntendedEcdsaTargetKeysSummary {
  const record = requireRecord(raw, `${label} ECDSA target keys`);
  const kind = parseEcdsaTargetProfileName(record.kind, `${label} ECDSA target keys`);
  switch (kind) {
    case 'none':
      return { kind: 'none' };
    case 'tempo':
      return {
        kind: 'tempo',
        tempo: parseEcdsaTargetKey(record.tempo, 'tempo', `${label} Tempo ECDSA target key`),
      };
    case 'tempo_arc':
      return {
        kind: 'tempo_arc',
        tempo: parseEcdsaTargetKey(record.tempo, 'tempo', `${label} Tempo ECDSA target key`),
        arcEvm: parseEcdsaTargetKey(record.arcEvm, 'arc_evm', `${label} Arc/EVM ECDSA target key`),
      };
    default:
      return assertNever(kind);
  }
}

function parseEcdsaTargetKey(
  raw: unknown,
  expectedChain: IntendedEcdsaTargetKeySummary['chain'],
  label: string,
): IntendedEcdsaTargetKeySummary {
  const record = requireRecord(raw, label);
  const chain = requireString(record.chain, `${label} chain`);
  if (chain !== expectedChain) {
    throw new Error(`${label} chain mismatch: ${chain}`);
  }
  return {
    chain: expectedChain,
    chainId: requirePositiveInteger(record.chainId, `${label} chainId`),
    thresholdOwnerAddress: getAddress(
      requireString(record.thresholdOwnerAddress, `${label} thresholdOwnerAddress`),
    ),
  };
}

function parseIntendedActionName(raw: unknown): IntendedActionName {
  const action = requireString(raw, 'intended action');
  if (isIntendedActionName(action)) return action;
  throw new Error(`Unknown intended action: ${action}`);
}

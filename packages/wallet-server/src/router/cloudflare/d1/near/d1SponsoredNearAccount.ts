import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import { alphabetizeStringify, sha256BytesUtf8 } from '@shared/utils/digests';
import { base64UrlEncode } from '@shared/utils/encoders';
import type { AccountCreationResult } from '../../../../core/types';
import {
  broadcastPreparedSponsoredNearAccountCreation,
  prepareSponsoredNearAccountCreationWithRelayer,
  preparedSponsoredNearAccountCreationArtifactFingerprint,
  type PreparedSponsoredNearAccountCreationV1,
} from '../../../../core/nearRelayerAccountProvisioning';
import type { SponsoredNamedNearAccountCreationResult } from '../registration/d1WalletRegistrationService';
import type { NormalizedCloudflareD1RouterApiAuthServiceOptions } from '../auth/d1RouterApiAuthConfig';
import { createCloudflareD1VersionedJsonRecordStore } from '../versionedJson/d1VersionedJsonRecordStore';
import type { VersionedJsonObject } from '../../../framework/versionedJsonRecordStore';
import {
  runRouterAbEd25519YaoRegistrationSideEffectV1,
  type RouterAbEd25519YaoRegistrationSideEffectRecordV1,
  type RouterAbEd25519YaoRegistrationSideEffectStoreV1,
} from '../../../domains/ed25519Yao/registration/routerAbEd25519YaoRegistrationSideEffectBoundary';

type SponsoredAccountOptions = Pick<
  NormalizedCloudflareD1RouterApiAuthServiceOptions,
  | 'database'
  | 'namespace'
  | 'orgId'
  | 'projectId'
  | 'envId'
  | 'relayerAccount'
  | 'relayerPrivateKey'
  | 'relayerPublicKey'
  | 'nearRpcUrl'
  | 'accountInitialBalance'
>;

export type SponsoredNamedNearAccountInput = {
  readonly walletId: WalletId;
  readonly accountId: string;
  readonly publicKey: string;
  /**
   * Registration-scoped key for the durable claim. Two attempts at the same
   * registration share a key so the second replays the first's transaction.
   */
  readonly idempotencyKey: string;
};

/**
 * Validates a persisted claim before it is trusted to skip a broadcast or to be
 * replayed. An invalid record makes the D1 read fail, which leaves the effect
 * uncertain and prevents any network action on unvalidated bytes.
 */
function parseSponsoredNearAccountSideEffectRecord(
  raw: unknown,
): RouterAbEd25519YaoRegistrationSideEffectRecordV1<
  AccountCreationResult,
  WalletSponsoredTransaction
> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Reflect.get(raw, 'operation') !== 'finalize') return null;
  const requestFingerprint = parseSideEffectFingerprint(Reflect.get(raw, 'requestFingerprint'));
  const preparedArtifactFingerprint = parseSideEffectFingerprint(
    Reflect.get(raw, 'preparedArtifactFingerprint'),
  );
  if (requestFingerprint === null || preparedArtifactFingerprint === null) return null;
  const claimedAtMs = Reflect.get(raw, 'claimedAtMs');
  if (!isNonNegativeSafeInteger(claimedAtMs)) return null;
  const prepared = parseWalletSponsoredTransaction(Reflect.get(raw, 'prepared'));
  if (prepared === null) return null;
  const kind = Reflect.get(raw, 'kind');
  if (kind === 'router_ab_ed25519_yao_registration_side_effect_claim_v1') {
    return {
      kind: 'router_ab_ed25519_yao_registration_side_effect_claim_v1',
      operation: 'finalize',
      requestFingerprint,
      preparedArtifactFingerprint,
      claimedAtMs,
      prepared,
    };
  }
  if (kind === 'router_ab_ed25519_yao_registration_side_effect_completion_v1') {
    const completedAtMs = Reflect.get(raw, 'completedAtMs');
    if (!isNonNegativeSafeInteger(completedAtMs)) return null;
    const response = parseAccountCreationResult(Reflect.get(raw, 'response'));
    if (response === null) return null;
    return {
      kind: 'router_ab_ed25519_yao_registration_side_effect_completion_v1',
      operation: 'finalize',
      requestFingerprint,
      preparedArtifactFingerprint,
      claimedAtMs,
      completedAtMs,
      prepared,
      response,
    };
  }
  return null;
}

function parsePreparedSponsoredNearAccountCreation(
  value: unknown,
): PreparedSponsoredNearAccountCreationV1 | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Reflect.get(value, 'kind') !== 'prepared_sponsored_near_account_creation_v1') {
    return null;
  }
  const accountId = parseNonEmptyString(Reflect.get(value, 'accountId'));
  const publicKey = parseNonEmptyString(Reflect.get(value, 'publicKey'));
  const relayerAccountId = parseNonEmptyString(Reflect.get(value, 'relayerAccountId'));
  const relayerPublicKey = parseNonEmptyString(Reflect.get(value, 'relayerPublicKey'));
  const initialBalanceYocto = parseNonEmptyString(Reflect.get(value, 'initialBalanceYocto'));
  const transactionHash = parseNonEmptyString(Reflect.get(value, 'transactionHash'));
  const nextNonce = parseNonEmptyString(Reflect.get(value, 'nextNonce'));
  const blockHash = parseNonEmptyString(Reflect.get(value, 'blockHash'));
  const signedTransactionBorshB64u = parseBoundedBase64Url(
    Reflect.get(value, 'signedTransactionBorshB64u'),
  );
  if (
    accountId === null ||
    publicKey === null ||
    relayerAccountId === null ||
    relayerPublicKey === null ||
    initialBalanceYocto === null ||
    transactionHash === null ||
    nextNonce === null ||
    blockHash === null ||
    signedTransactionBorshB64u === null
  ) {
    return null;
  }
  return {
    kind: 'prepared_sponsored_near_account_creation_v1',
    accountId,
    publicKey,
    relayerAccountId,
    relayerPublicKey,
    initialBalanceYocto,
    transactionHash,
    nextNonce,
    blockHash,
    signedTransactionBorshB64u,
  };
}

function parseAccountCreationResult(value: unknown): AccountCreationResult | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const success = Reflect.get(value, 'success');
  if (typeof success !== 'boolean') return null;
  const accountId = parseOptionalString(Reflect.get(value, 'accountId'));
  const transactionHash = parseOptionalString(Reflect.get(value, 'transactionHash'));
  const error = parseOptionalString(Reflect.get(value, 'error'));
  const message = parseOptionalString(Reflect.get(value, 'message'));
  if (
    ('accountId' in value && accountId === null) ||
    ('transactionHash' in value && transactionHash === null) ||
    ('error' in value && error === null) ||
    ('message' in value && message === null)
  ) {
    return null;
  }
  if (success && (accountId === undefined || transactionHash === undefined)) return null;
  const normalizedAccountId = accountId ?? undefined;
  const normalizedTransactionHash = transactionHash ?? undefined;
  const normalizedError = error ?? undefined;
  const normalizedMessage = message ?? undefined;
  return {
    success,
    ...(normalizedAccountId === undefined ? {} : { accountId: normalizedAccountId }),
    ...(normalizedTransactionHash === undefined
      ? {}
      : { transactionHash: normalizedTransactionHash }),
    ...(normalizedError === undefined ? {} : { error: normalizedError }),
    ...(normalizedMessage === undefined ? {} : { message: normalizedMessage }),
  };
}

function parseNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function parseSideEffectFingerprint(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9:_-]{32,192}$/u.test(value) ? value : null;
}

function parseBoundedBase64Url(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 8_192 &&
    /^[\w-]+$/u.test(value)
    ? value
    : null;
}

function parseOptionalString(value: unknown): string | undefined | null {
  return value === undefined ? undefined : parseNonEmptyString(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function sponsoredNearAccountSideEffectStore(
  options: SponsoredAccountOptions,
): RouterAbEd25519YaoRegistrationSideEffectStoreV1<
  AccountCreationResult,
  WalletSponsoredTransaction
> {
  return createCloudflareD1VersionedJsonRecordStore<
    RouterAbEd25519YaoRegistrationSideEffectRecordV1<
      AccountCreationResult,
      WalletSponsoredTransaction
    >
  >({
    database: options.database,
    scope: {
      namespace: options.namespace,
      orgId: options.orgId,
      projectId: options.projectId,
      envId: options.envId,
    },
    keyPrefix: 'router-ab-yao-sponsored-account:',
    encode: encodeSponsoredRecord,
    parse: parseSponsoredNearAccountSideEffectRecord,
  });
}

/**
 * Creates the sponsored account through a durable claim. The signed transaction
 * and its hash are persisted before the broadcast, so a lost response replays
 * those exact bytes instead of building a second transaction under a fresh
 * nonce. Rebroadcasting an identical signed transaction reuses its hash, so the
 * network treats the retry as the same transaction.
 */
export async function createSponsoredNamedNearAccountForOptions(
  options: SponsoredAccountOptions,
  input: SponsoredNamedNearAccountInput,
): Promise<SponsoredNamedNearAccountCreationResult> {
  const relayerAccount = options.relayerAccount;
  const relayerPrivateKey = options.relayerPrivateKey;
  const nearRpcUrl = options.nearRpcUrl;
  const initialBalanceYocto = options.accountInitialBalance;
  if (!relayerAccount || !relayerPrivateKey || !nearRpcUrl || !initialBalanceYocto) {
    return {
      kind: 'rejected',
      message: 'Sponsored NEAR account creation is not configured on this server',
    };
  }
  const relayerInput = {
    accountId: input.accountId,
    publicKey: input.publicKey,
    relayerAccount,
    relayerPrivateKey,
    relayerPublicKey: options.relayerPublicKey,
    nearRpcUrl,
    initialBalanceYocto,
  };
  const requestFingerprint = base64UrlEncode(
    await sha256BytesUtf8(
      alphabetizeStringify({
        kind: 'sponsored_near_account_creation_v1',
        walletId: input.walletId,
        accountId: input.accountId,
        publicKey: input.publicKey,
        relayerAccountId: relayerAccount,
        initialBalanceYocto,
      }),
    ),
  );
  const outcome = await runRouterAbEd25519YaoRegistrationSideEffectV1<
    AccountCreationResult,
    WalletSponsoredTransaction
  >(sponsoredNearAccountSideEffectStore(options), {
    kind: 'prepared_resumable',
    resumeAfterMs: 30_000,
    operation: 'finalize',
    key: `sponsored-account:${input.idempotencyKey}`,
    requestFingerprint,
    nowMs: () => Date.now(),
    prepare: prepareWalletSponsoredTransaction.bind(null, input.walletId, relayerInput),
    derivePreparedArtifactFingerprint: fingerprintWalletSponsoredTransaction,
    execute: executeWalletSponsoredTransaction.bind(null, {
      walletId: input.walletId,
      nearRpcUrl,
      relayerAccountId: relayerAccount,
    }),
  });
  switch (outcome.kind) {
    case 'executed':
    case 'exact_replay': {
      if (outcome.value.success && outcome.value.accountId && outcome.value.transactionHash) {
        return {
          kind: 'created',
          accountId: outcome.value.accountId,
          transactionHash: outcome.value.transactionHash,
        };
      }
      return {
        kind: 'rejected',
        message:
          outcome.value.message ||
          outcome.value.error ||
          'Sponsored NEAR account creation was rejected',
      };
    }
    case 'in_progress':
    case 'uncertain': {
      const message =
        outcome.kind === 'uncertain'
          ? outcome.message
          : 'Sponsored NEAR account creation is already in progress for this registration';
      return { kind: 'retryable', message, retryAfterMs: 30_000 };
    }
    case 'request_conflict':
      return {
        kind: 'rejected',
        message: 'Sponsored NEAR account creation idempotency key conflicts with another request',
      };
  }
}

type WalletSponsoredTransaction = {
  readonly walletId: WalletId;
  readonly transaction: PreparedSponsoredNearAccountCreationV1;
};

function parseWalletSponsoredTransaction(raw: unknown): WalletSponsoredTransaction | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const walletId = parseWalletId(Reflect.get(raw, 'walletId'));
  const transaction = parsePreparedSponsoredNearAccountCreation(Reflect.get(raw, 'transaction'));
  if (!walletId.ok || !transaction) return null;
  return { walletId: walletId.value, transaction };
}

async function fingerprintWalletSponsoredTransaction(
  prepared: WalletSponsoredTransaction,
): Promise<string> {
  const transactionFingerprint = await preparedSponsoredNearAccountCreationArtifactFingerprint(
    prepared.transaction,
  );
  return base64UrlEncode(
    await sha256BytesUtf8(
      alphabetizeStringify({
        walletId: prepared.walletId,
        transactionFingerprint,
      }),
    ),
  );
}

function encodeSponsoredRecord(
  record: RouterAbEd25519YaoRegistrationSideEffectRecordV1<
    AccountCreationResult,
    WalletSponsoredTransaction
  >,
): VersionedJsonObject {
  return record as unknown as VersionedJsonObject;
}

async function prepareWalletSponsoredTransaction(
  walletId: WalletId,
  input: Parameters<typeof prepareSponsoredNearAccountCreationWithRelayer>[0],
): Promise<WalletSponsoredTransaction> {
  const prepared = await prepareSponsoredNearAccountCreationWithRelayer(input);
  if (!prepared.ok) throw new Error(prepared.message);
  return { walletId, transaction: prepared.prepared };
}

async function executeWalletSponsoredTransaction(
  context: {
    readonly walletId: WalletId;
    readonly nearRpcUrl: string;
    readonly relayerAccountId: string;
  },
  prepared: WalletSponsoredTransaction,
  attempt: 'fresh' | 'resumed',
): Promise<AccountCreationResult> {
  if (prepared.walletId !== context.walletId) {
    throw new Error('Sponsored NEAR account claim belongs to another wallet');
  }
  const broadcast = await broadcastPreparedSponsoredNearAccountCreation({
    prepared: prepared.transaction,
    nearRpcUrl: context.nearRpcUrl,
    relayerAccountId: context.relayerAccountId,
    reconcileFirst: attempt === 'resumed',
  });
  // Keep ambiguous broadcasts open so retries reconcile the original transaction.
  if (broadcast.kind === 'uncertain') throw new Error(broadcast.message);
  return broadcast.result;
}

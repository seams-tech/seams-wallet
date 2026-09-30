/**
 * Parsers for the normal-signing request and Email OTP step-up proof an operation-material
 * request carries.
 */
import { asRecord, toOptionalTrimmedNonEmptyString } from '@shared/utils/validation';
import {
  parseRouterAbMpcMaterialActivationRef,
  parseRouterAbNormalSigningAuthorization,
} from '@shared/utils/routerAbNormalSigningIdentity';
import { parseWalletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import type { Ed25519OperationStepUpProof } from '../../../threshold/ed25519/walletSession';
import type {
  RouterAbEd25519NormalSigningIntentV2Wire,
  RouterAbEd25519SigningPayloadV2Wire,
  RouterAbNormalSigningPrepareRequestV2Wire,
  RouterAbNormalSigningScopeV2Wire,
  RouterAbNearDelegateActionIntentV1Wire,
  RouterAbNearTransactionIntentV1Wire,
  RouterAbNearNetworkIdV2Wire,
} from '@/core/rpcClients/relayer/routerAbNormalSigning';
import { readNumber, readString, rejectUnknownEmailOtpYaoFields } from './payloadParsing';

function parseEmailOtpOperationDigest(value: unknown, label: string): { bytes: readonly number[] } {
  const record = asRecord(value);
  if (!record) throw new Error(`${label} must be an object`);
  rejectUnknownEmailOtpYaoFields(record, ['bytes'], label);
  if (!Array.isArray(record.bytes) || record.bytes.length !== 32) {
    throw new Error(`${label}.bytes must contain exactly 32 bytes`);
  }
  const bytes = record.bytes.map((byte, index) => {
    if (!Number.isSafeInteger(byte) || Number(byte) < 0 || Number(byte) > 255) {
      throw new Error(`${label}.bytes[${index}] is invalid`);
    }
    return Number(byte);
  });
  return { bytes };
}

function parseEmailOtpOperationNetworkId(
  value: unknown,
  label: string,
): RouterAbNearNetworkIdV2Wire {
  const networkId = readString(value, label);
  if (networkId !== 'testnet' && networkId !== 'mainnet') {
    throw new Error(`${label} is invalid`);
  }
  return networkId;
}

function parseEmailOtpOperationTransactionIntent(
  value: unknown,
): RouterAbNearTransactionIntentV1Wire {
  const record = asRecord(value);
  if (!record) throw new Error('normalSigningRequest.intent.transactions entry is invalid');
  rejectUnknownEmailOtpYaoFields(record, ['receiver_id', 'action_fingerprint'], 'transaction');
  return {
    receiver_id: readString(record.receiver_id, 'transaction.receiver_id'),
    action_fingerprint: readString(record.action_fingerprint, 'transaction.action_fingerprint'),
  };
}

function parseEmailOtpOperationDelegateIntent(
  value: unknown,
): RouterAbNearDelegateActionIntentV1Wire {
  const record = asRecord(value);
  if (!record) throw new Error('normalSigningRequest.intent.delegate is invalid');
  rejectUnknownEmailOtpYaoFields(
    record,
    [
      'sender_id',
      'receiver_id',
      'public_key',
      'nonce',
      'max_block_height',
      'action_fingerprint',
      'canonical_delegate_borsh_b64u',
    ],
    'delegate',
  );
  return {
    sender_id: readString(record.sender_id, 'delegate.sender_id'),
    receiver_id: readString(record.receiver_id, 'delegate.receiver_id'),
    public_key: readString(record.public_key, 'delegate.public_key'),
    nonce: readString(record.nonce, 'delegate.nonce'),
    max_block_height: readString(record.max_block_height, 'delegate.max_block_height'),
    action_fingerprint: readString(record.action_fingerprint, 'delegate.action_fingerprint'),
    canonical_delegate_borsh_b64u: readString(
      record.canonical_delegate_borsh_b64u,
      'delegate.canonical_delegate_borsh_b64u',
    ),
  };
}

const EMAIL_OTP_OPERATION_INTENT_IDENTITY_FIELDS = [
  'kind',
  'operation_id',
  'operation_fingerprint',
  'near_account_id',
  'near_network_id',
] as const;

/** The operation and account identity every normal-signing intent kind carries. */
function parseEmailOtpOperationIntentIdentity(record: Record<string, unknown>) {
  return {
    operation_id: readString(record.operation_id, 'intent.operation_id'),
    operation_fingerprint: readString(record.operation_fingerprint, 'intent.operation_fingerprint'),
    near_account_id: readString(record.near_account_id, 'intent.near_account_id'),
    near_network_id: parseEmailOtpOperationNetworkId(
      record.near_network_id,
      'intent.near_network_id',
    ),
  };
}

function parseEmailOtpOperationIntent(value: unknown): RouterAbEd25519NormalSigningIntentV2Wire {
  const record = asRecord(value);
  if (!record) throw new Error('normalSigningRequest.intent is invalid');
  const kind = readString(record.kind, 'normalSigningRequest.intent.kind');
  switch (kind) {
    case 'near_transaction_v1': {
      rejectUnknownEmailOtpYaoFields(
        record,
        [
          ...EMAIL_OTP_OPERATION_INTENT_IDENTITY_FIELDS,
          'transactions',
          'unsigned_transaction_borsh_b64u',
        ],
        'normalSigningRequest.intent',
      );
      if (!Array.isArray(record.transactions) || record.transactions.length === 0) {
        throw new Error('normalSigningRequest.intent.transactions is invalid');
      }
      return {
        kind,
        ...parseEmailOtpOperationIntentIdentity(record),
        transactions: record.transactions.map(parseEmailOtpOperationTransactionIntent),
        unsigned_transaction_borsh_b64u: readString(
          record.unsigned_transaction_borsh_b64u,
          'intent.unsigned_transaction_borsh_b64u',
        ),
      };
    }
    case 'nep413_v1': {
      rejectUnknownEmailOtpYaoFields(
        record,
        [
          ...EMAIL_OTP_OPERATION_INTENT_IDENTITY_FIELDS,
          'recipient',
          'message',
          'nonce_b64u',
          'callback_url',
        ],
        'normalSigningRequest.intent',
      );
      const callbackUrl = toOptionalTrimmedNonEmptyString(record.callback_url);
      return {
        kind,
        ...parseEmailOtpOperationIntentIdentity(record),
        recipient: readString(record.recipient, 'intent.recipient'),
        message: readString(record.message, 'intent.message'),
        nonce_b64u: readString(record.nonce_b64u, 'intent.nonce_b64u'),
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      };
    }
    case 'near_delegate_action_v1': {
      rejectUnknownEmailOtpYaoFields(
        record,
        [...EMAIL_OTP_OPERATION_INTENT_IDENTITY_FIELDS, 'delegate'],
        'normalSigningRequest.intent',
      );
      return {
        kind,
        ...parseEmailOtpOperationIntentIdentity(record),
        delegate: parseEmailOtpOperationDelegateIntent(record.delegate),
      };
    }
    default:
      throw new Error(`Unsupported normalSigningRequest.intent.kind: ${kind}`);
  }
}

function parseEmailOtpOperationSigningPayload(value: unknown): RouterAbEd25519SigningPayloadV2Wire {
  const record = asRecord(value);
  if (!record) throw new Error('normalSigningRequest.signing_payload is invalid');
  const kind = readString(record.kind, 'normalSigningRequest.signing_payload.kind');
  switch (kind) {
    case 'near_unsigned_transaction_borsh_v1':
    case 'nep413_message_v1':
    case 'near_delegate_action_v1':
      rejectUnknownEmailOtpYaoFields(
        record,
        [
          kind === 'near_unsigned_transaction_borsh_v1' ? 'kind' : 'kind',
          'canonical_message_b64u',
          'canonical_delegate_borsh_b64u',
          'unsigned_transaction_borsh_b64u',
          'expected_signing_digest_b64u',
        ],
        'normalSigningRequest.signing_payload',
      );
      if (kind === 'near_unsigned_transaction_borsh_v1') {
        return {
          kind,
          unsigned_transaction_borsh_b64u: readString(
            record.unsigned_transaction_borsh_b64u,
            'signing_payload.unsigned_transaction_borsh_b64u',
          ),
          expected_signing_digest_b64u: readString(
            record.expected_signing_digest_b64u,
            'signing_payload.expected_signing_digest_b64u',
          ),
        };
      }
      if (kind === 'nep413_message_v1') {
        return {
          kind,
          canonical_message_b64u: readString(
            record.canonical_message_b64u,
            'signing_payload.canonical_message_b64u',
          ),
          expected_signing_digest_b64u: readString(
            record.expected_signing_digest_b64u,
            'signing_payload.expected_signing_digest_b64u',
          ),
        };
      }
      return {
        kind,
        canonical_delegate_borsh_b64u: readString(
          record.canonical_delegate_borsh_b64u,
          'signing_payload.canonical_delegate_borsh_b64u',
        ),
        expected_signing_digest_b64u: readString(
          record.expected_signing_digest_b64u,
          'signing_payload.expected_signing_digest_b64u',
        ),
      };
    default:
      throw new Error(`Unsupported normalSigningRequest.signing_payload.kind: ${kind}`);
  }
}

export function parseEmailOtpOperationNormalSigningRequest(
  value: unknown,
): RouterAbNormalSigningPrepareRequestV2Wire {
  const record = asRecord(value);
  if (!record) throw new Error('normalSigningRequest is required');
  rejectUnknownEmailOtpYaoFields(
    record,
    ['scope', 'expires_at_ms', 'display_digest', 'intent', 'signing_payload'],
    'normalSigningRequest',
  );
  const scope = asRecord(record.scope);
  if (!scope) throw new Error('normalSigningRequest.scope is invalid');
  rejectUnknownEmailOtpYaoFields(
    scope,
    ['request_id', 'account_id', 'authorization', 'material_activation', 'signing_worker_id'],
    'normalSigningRequest.scope',
  );
  return {
    scope: {
      request_id: readString(scope.request_id, 'scope.request_id'),
      account_id: readString(scope.account_id, 'scope.account_id'),
      authorization: parseRouterAbNormalSigningAuthorization(scope.authorization),
      material_activation: parseRouterAbMpcMaterialActivationRef(scope.material_activation),
      signing_worker_id: readString(scope.signing_worker_id, 'scope.signing_worker_id'),
    } satisfies RouterAbNormalSigningScopeV2Wire,
    expires_at_ms: readNumber(record.expires_at_ms, 'normalSigningRequest.expires_at_ms'),
    display_digest: parseEmailOtpOperationDigest(
      record.display_digest,
      'normalSigningRequest.display_digest',
    ),
    intent: parseEmailOtpOperationIntent(record.intent),
    signing_payload: parseEmailOtpOperationSigningPayload(record.signing_payload),
  };
}

export function parseEmailOtpOperationStepUpProof(
  value: unknown,
): Extract<Ed25519OperationStepUpProof, { kind: 'email_otp' }> {
  const record = asRecord(value);
  if (!record) throw new Error('operation step-up proof is required');
  rejectUnknownEmailOtpYaoFields(
    record,
    ['kind', 'authorityRef', 'providerSubjectId', 'challengeId', 'otpCode'],
    'operation step-up proof',
  );
  const authorityRef = parseWalletAuthAuthorityRef(record.authorityRef);
  if (!authorityRef) throw new Error('operation step-up proof authorityRef is invalid');
  if (readString(record.kind, 'operation step-up proof.kind') !== 'email_otp') {
    throw new Error('operation step-up proof must use Email OTP');
  }
  return {
    kind: 'email_otp',
    authorityRef,
    providerSubjectId: readString(record.providerSubjectId, 'proof.providerSubjectId'),
    challengeId: readString(record.challengeId, 'proof.challengeId'),
    otpCode: readString(record.otpCode, 'proof.otpCode'),
  };
}

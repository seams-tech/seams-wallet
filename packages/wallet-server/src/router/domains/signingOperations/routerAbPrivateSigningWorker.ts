// The SigningWorker's private API as the router uses it: its paths, the JSON post, and the
// request bodies the router builds for Ed25519 and ECDSA derivation signing.
import type { RouterAbSigningWorkerPrivateTransport } from '../../../core/routerAbSigning/RouterAbNormalSigningRuntime';
import { postRouterAbInternalServiceJson } from '../../../core/ThresholdService/routerAb/internalServiceHttp';
import {
  parseRouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1,
  parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1,
  routerAbEcdsaDerivationEvmDigestSigningFinalizeCoreRequestDigestV1,
  routerAbEcdsaDerivationEvmDigestSigningRequestDigestV1,
  type RouterAbEcdsaDerivationEvmDigestSigningFinalizeCoreRequestV1Wire,
  type RouterAbEcdsaDerivationEvmDigestSigningRequestV1Wire,
  type RouterAbPublicDigest32V1Wire,
} from '@shared/utils/routerAbEcdsaDerivation';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/encoders';
import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import type { AuthorizedOperationReplayResponse } from '../../../authorization/domain';
import type { RouterAbNormalSigningAuthorizationWire } from '@shared/utils/routerAbNormalSigningIdentity';
import type { MpcMaterialActivationId } from '@shared/utils/domainIds';
import { isPlainObject } from '@shared/utils/validation';
import {
  requireMpcMaterialActivationId,
  routerAbSigningError,
  type RouterAbSigningWorkerJsonResult,
} from './routerAbNormalSigningAdmission';
import type { RouterAbOperationStepUpWalletSession } from './routerAbOperationStepUp';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';

const ED25519_SIGNING_INTENT_VERSION_V2 = 'router-ab-protocol/ed25519-normal-signing/intent/v2';
const ED25519_SIGNING_PAYLOAD_VERSION_V2 = 'router-ab-protocol/ed25519-normal-signing/payload/v2';
const ED25519_ROUND1_BINDING_VERSION_V2 =
  'router-ab-protocol/ed25519-normal-signing/round1-binding/v2';
const ED25519_TRUSTED_SOURCE_VERSION_V2 = 'router-ab-cloudflare-trusted-source/v2';

const PRIVATE_ED25519_SIGNING_PREPARE_PATH = '/router-ab/signing-worker/sign/prepare';
const PRIVATE_ED25519_SIGNING_FINALIZE_PATH = '/router-ab/signing-worker/sign';
const PRIVATE_ECDSA_DERIVATION_SIGNING_PREPARE_PATH =
  '/router-ab/signing-worker/ecdsa-derivation/sign/prepare';
const PRIVATE_ECDSA_DERIVATION_SIGNING_FINALIZE_PATH =
  '/router-ab/signing-worker/ecdsa-derivation/sign';
export type RouterAbEd25519PrivateSigningPath =
  | typeof PRIVATE_ED25519_SIGNING_PREPARE_PATH
  | typeof PRIVATE_ED25519_SIGNING_FINALIZE_PATH;

export const ROUTER_AB_ED25519_PRIVATE_SIGNING_PATHS = {
  prepare: PRIVATE_ED25519_SIGNING_PREPARE_PATH,
  finalize: PRIVATE_ED25519_SIGNING_FINALIZE_PATH,
} as const;

export type RouterAbEcdsaDerivationPrivateSigningPath =
  | typeof PRIVATE_ECDSA_DERIVATION_SIGNING_PREPARE_PATH
  | typeof PRIVATE_ECDSA_DERIVATION_SIGNING_FINALIZE_PATH;

export const ROUTER_AB_ECDSA_DERIVATION_PRIVATE_SIGNING_PATHS = {
  prepare: PRIVATE_ECDSA_DERIVATION_SIGNING_PREPARE_PATH,
  finalize: PRIVATE_ECDSA_DERIVATION_SIGNING_FINALIZE_PATH,
} as const;

function resolveRouterAbSigningWorkerFetch(input?: typeof fetch): typeof fetch | null {
  if (input) return input;
  return typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
}

type RouterAbConfiguredSigningWorkerPrivateTransport = Extract<
  RouterAbSigningWorkerPrivateTransport,
  { readonly kind: 'configured' }
>;

export type RouterAbEd25519NormalSigningAuthorizationV2 = RouterAbNormalSigningAuthorizationWire;

type RouterAbMpcMaterialActivationRefV1 = {
  readonly kind: 'mpc_material_activation_ref';
  readonly activation_id: MpcMaterialActivationId;
  readonly capability: string;
  readonly material_owner: string;
  readonly key_binding: string;
  readonly lifecycle_binding: string;
  readonly signing_worker: string;
};

export type RouterAbEd25519NormalSigningScopeV2 = {
  readonly request_id: string;
  readonly account_id: string;
  readonly authorization: RouterAbEd25519NormalSigningAuthorizationV2;
  readonly material_activation: RouterAbMpcMaterialActivationRefV1;
  readonly signing_worker_id: string;
};

type RouterAbPrivateSigningAuthorization =
  | {
      readonly kind: 'wallet_session_operation_credential_v1';
      readonly walletSessionId: string;
      readonly principalId: string;
      readonly runtimePolicyScope: RuntimePolicyScope;
    }
  | {
      readonly kind: 'operation_step_up';
      readonly session: RouterAbOperationStepUpWalletSession;
    };

type RouterAbOwnerAdmissionAuthV1 = ReadonlyExclusiveUnion<
  | {
      readonly auth: 'owner_wallet_session';
      readonly subject_id: string;
      readonly wallet_session_id: string;
    }
  | {
      readonly auth: 'owner_operation_step_up';
      readonly subject_id: string;
      readonly authorization_session_id: string;
    }
>;

type RouterAbNormalSigningPrivateAuthorizationV2 = ReadonlyExclusiveUnion<
  | { readonly kind: 'reusable_wallet_session'; readonly wallet_session_id: string }
  | { readonly kind: 'operation_step_up'; readonly authorization_session_id: string }
>;

type RouterAbNormalSigningTrustedMetadataV1 = {
  readonly org_id: string;
  readonly project_id: string;
  readonly environment: string;
  readonly account_id: string;
  readonly auth: RouterAbOwnerAdmissionAuthV1;
  readonly trusted_source_digest: RouterAbPublicDigest32V1Wire;
  readonly intent_digest: RouterAbPublicDigest32V1Wire;
};

type RouterAbNormalSigningTrustedAdmissionV1 = {
  readonly metadata: RouterAbNormalSigningTrustedMetadataV1;
  readonly decision: {
    readonly kind: 'accepted';
    readonly request_id: string;
  };
};

type RouterAbNormalSigningPrepareAdmissionCandidateV2 = {
  readonly org_id: string;
  readonly project_id: string;
  readonly environment: string;
  readonly account_id: string;
  readonly subject_id: string;
  readonly authorization: RouterAbNormalSigningPrivateAuthorizationV2;
  readonly signing_worker_id: string;
  readonly request_id: string;
  readonly intent_digest: RouterAbPublicDigest32V1Wire;
  readonly signing_payload_digest: RouterAbPublicDigest32V1Wire;
  readonly admitted_signing_digest: RouterAbPublicDigest32V1Wire;
  readonly round1_binding_digest: RouterAbPublicDigest32V1Wire;
  readonly trusted_source_digest: RouterAbPublicDigest32V1Wire;
  readonly expires_at_ms: number;
};

type RouterAbNormalSigningFinalizeAdmissionCandidateV2 = Omit<
  RouterAbNormalSigningPrepareAdmissionCandidateV2,
  'admitted_signing_digest'
>;

type RouterAbNormalSigningEffectClaimV1 =
  | {
      readonly kind: 'reusable_wallet_session';
      readonly wallet_session_id: string;
      readonly authorized_operation_id: string;
      readonly operation_id: string;
      readonly operation_fingerprint_digest: string;
    }
  | {
      readonly kind: 'operation_step_up';
      readonly authorization_session_id: string;
      readonly authorized_operation_id: string;
      readonly operation_id: string;
      readonly operation_fingerprint_digest: string;
    };

function validateRouterAbNormalSigningEffectClaim(
  claim: RouterAbNormalSigningEffectClaimV1,
  scope: RouterAbEd25519NormalSigningScopeV2,
  authorization: RouterAbPrivateSigningAuthorizationContext,
): void {
  requirePrivateSigningString(
    claim.authorized_operation_id,
    'effect_claim.authorized_operation_id',
  );
  requirePrivateSigningString(claim.operation_id, 'effect_claim.operation_id');
  requirePrivateSigningString(
    claim.operation_fingerprint_digest,
    'effect_claim.operation_fingerprint_digest',
  );
  if (claim.kind === 'reusable_wallet_session') {
    requirePrivateSigningString(claim.wallet_session_id, 'effect_claim.wallet_session_id');
    if (
      scope.authorization.kind !== 'reusable_wallet_session' ||
      claim.wallet_session_id !== scope.authorization.wallet_session_id
    ) {
      throw new Error('Reusable Wallet Session effect claim does not match request scope');
    }
    return;
  }
  requirePrivateSigningString(
    claim.authorization_session_id,
    'effect_claim.authorization_session_id',
  );
  if (
    scope.authorization.kind !== 'operation_step_up' ||
    authorization.kind !== 'operation_step_up' ||
    claim.authorization_session_id !== authorization.authorizationSessionId
  ) {
    throw new Error('Operation step-up effect claim does not match request scope');
  }
}

type RouterAbEd25519PrivatePrepareSigningWorkerBody = {
  readonly scope: RouterAbEd25519NormalSigningScopeV2;
  readonly expires_at_ms: number;
  readonly admission_candidate: RouterAbNormalSigningPrepareAdmissionCandidateV2;
  readonly trusted_admission: RouterAbNormalSigningTrustedAdmissionV1;
  readonly material_source: RouterAbNormalSigningMaterialSourceV1;
};

type RouterAbEd25519PrivateFinalizeSigningWorkerBody = {
  readonly request: Record<string, unknown>;
  readonly admission_candidate: RouterAbNormalSigningFinalizeAdmissionCandidateV2;
  readonly trusted_admission: RouterAbNormalSigningTrustedAdmissionV1;
  readonly effect_claim: RouterAbNormalSigningEffectClaimV1;
  readonly material_source: RouterAbNormalSigningMaterialSourceV1;
};

export type RouterAbEd25519PrivateSigningWorkerBody =
  | RouterAbEd25519PrivatePrepareSigningWorkerBody
  | RouterAbEd25519PrivateFinalizeSigningWorkerBody;

type RouterAbEcdsaDerivationPrivatePrepareSigningWorkerBody = {
  request: RouterAbEcdsaDerivationEvmDigestSigningRequestV1Wire;
  trusted_admission: RouterAbNormalSigningTrustedAdmissionV1;
  material_source: RouterAbNormalSigningMaterialSourceV1;
};

type RouterAbEcdsaDerivationPrivateFinalizeSigningWorkerBody = {
  request: RouterAbEcdsaDerivationEvmDigestSigningFinalizeCoreRequestV1Wire;
  trusted_admission: RouterAbNormalSigningTrustedAdmissionV1;
  material_source: RouterAbNormalSigningMaterialSourceV1;
};

export type RouterAbEcdsaDerivationPrivateSigningWorkerBody =
  | RouterAbEcdsaDerivationPrivatePrepareSigningWorkerBody
  | RouterAbEcdsaDerivationPrivateFinalizeSigningWorkerBody;

export type RouterAbNormalSigningMaterialSourceV1 = {
  readonly kind: 'registration_activation';
  readonly lookup: {
    readonly account_id: string;
    readonly material_activation_id: string;
    readonly signing_worker_id: string;
  };
};

function registrationMaterialSourceV1(input: {
  readonly accountId: string;
  readonly materialActivationId: string;
  readonly signingWorkerId: string;
}): RouterAbNormalSigningMaterialSourceV1 {
  return {
    kind: 'registration_activation',
    lookup: {
      account_id: input.accountId,
      material_activation_id: input.materialActivationId,
      signing_worker_id: input.signingWorkerId,
    },
  };
}

function nonEmptyString(value: unknown): string {
  return String(value || '').trim();
}

function pushU32Be(out: number[], value: number): void {
  out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function pushU64Be(out: number[], value: number): void {
  const encoded = BigInt(value);
  for (let shift = 56n; shift >= 0n; shift -= 8n) {
    out.push(Number((encoded >> shift) & 0xffn));
  }
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function pushLen32(out: number[], bytes: Uint8Array): void {
  pushU32Be(out, bytes.length);
  for (const byte of bytes) out.push(byte);
}

async function sha256B64u(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return base64UrlEncode(new Uint8Array(digest));
}

async function sha256Digest32(bytes: Uint8Array): Promise<RouterAbPublicDigest32V1Wire> {
  return digest32FromB64u(await sha256B64u(bytes));
}

export function replayResponseFromSigningWorkerResult(
  result: RouterAbSigningWorkerJsonResult,
): AuthorizedOperationReplayResponse {
  if (result.ok) return result.replay;
  return {
    status: result.status,
    contentType: 'application/json',
    bodyText: JSON.stringify(result.body),
  };
}

export function isRouterAbEcdsaSigningWorkerOperationInProgress(
  result: RouterAbSigningWorkerJsonResult,
): boolean {
  return (
    !result.ok &&
    result.status === 409 &&
    result.body.message.includes('ReplayedLocalRequest:') &&
    result.body.message.includes('SigningWorker ECDSA effect is already in progress')
  );
}

function privateSigningWorkerUrl(
  config: RouterAbConfiguredSigningWorkerPrivateTransport,
  path: RouterAbEd25519PrivateSigningPath | RouterAbEcdsaDerivationPrivateSigningPath,
): string {
  const base = config.signingWorkerBaseUrl.trim().replace(/\/+$/, '');
  if (!base) throw new Error('Router A/B SigningWorker base URL is required');
  return `${base}${path}`;
}

function digest32FromB64u(value: string): RouterAbPublicDigest32V1Wire {
  const bytes = base64UrlDecode(value);
  if (bytes.length !== 32) {
    throw new Error('Router A/B digest must be 32 bytes');
  }
  return { bytes: Array.from(bytes) };
}

function requirePrivateSigningRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requirePrivateSigningString(value: unknown, label: string): string {
  const normalized = nonEmptyString(value);
  if (!normalized) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return normalized;
}

function requirePrivateSigningPositiveSafeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return parsed;
}

function requirePrivateSigningExactFields(
  record: Record<string, unknown>,
  expectedFields: readonly string[],
  label: string,
): void {
  const actualFields = Object.keys(record).sort();
  const expected = [...expectedFields].sort();
  if (
    actualFields.length !== expected.length ||
    actualFields.some((field, index) => field !== expected[index])
  ) {
    throw new Error(`${label} has invalid fields`);
  }
}

function requirePrivateSigningAuthorization(
  value: unknown,
): RouterAbEd25519NormalSigningAuthorizationV2 {
  const authorization = requirePrivateSigningRecord(value, 'scope.authorization');
  switch (authorization.kind) {
    case 'reusable_wallet_session':
      requirePrivateSigningExactFields(
        authorization,
        ['kind', 'wallet_session_id'],
        'scope.authorization',
      );
      return {
        kind: 'reusable_wallet_session',
        wallet_session_id: requirePrivateSigningString(
          authorization.wallet_session_id,
          'scope.authorization.wallet_session_id',
        ),
      };
    case 'operation_step_up':
      requirePrivateSigningExactFields(authorization, ['kind'], 'scope.authorization');
      return { kind: 'operation_step_up' };
    default:
      throw new Error('scope.authorization.kind is invalid');
  }
}

function requirePrivateSigningMaterialActivation(
  value: unknown,
): RouterAbMpcMaterialActivationRefV1 {
  const activation = requirePrivateSigningRecord(value, 'scope.material_activation');
  requirePrivateSigningExactFields(
    activation,
    [
      'kind',
      'activation_id',
      'capability',
      'material_owner',
      'key_binding',
      'lifecycle_binding',
      'signing_worker',
    ],
    'scope.material_activation',
  );
  if (activation.kind !== 'mpc_material_activation_ref') {
    throw new Error('scope.material_activation.kind is invalid');
  }
  return {
    kind: 'mpc_material_activation_ref',
    activation_id: requireMpcMaterialActivationId(activation.activation_id),
    capability: requirePrivateSigningString(
      activation.capability,
      'scope.material_activation.capability',
    ),
    material_owner: requirePrivateSigningString(
      activation.material_owner,
      'scope.material_activation.material_owner',
    ),
    key_binding: requirePrivateSigningString(
      activation.key_binding,
      'scope.material_activation.key_binding',
    ),
    lifecycle_binding: requirePrivateSigningString(
      activation.lifecycle_binding,
      'scope.material_activation.lifecycle_binding',
    ),
    signing_worker: requirePrivateSigningString(
      activation.signing_worker,
      'scope.material_activation.signing_worker',
    ),
  };
}

export function parseRouterAbEd25519NormalSigningScopeV2(
  value: unknown,
): RouterAbEd25519NormalSigningScopeV2 {
  const scope = requirePrivateSigningRecord(value, 'scope');
  requirePrivateSigningExactFields(
    scope,
    ['request_id', 'account_id', 'authorization', 'material_activation', 'signing_worker_id'],
    'scope',
  );
  const parsed = {
    request_id: requirePrivateSigningString(scope.request_id, 'scope.request_id'),
    account_id: requirePrivateSigningString(scope.account_id, 'scope.account_id'),
    authorization: requirePrivateSigningAuthorization(scope.authorization),
    material_activation: requirePrivateSigningMaterialActivation(scope.material_activation),
    signing_worker_id: requirePrivateSigningString(
      scope.signing_worker_id,
      'scope.signing_worker_id',
    ),
  };
  if (parsed.material_activation.signing_worker !== parsed.signing_worker_id) {
    throw new Error('scope material activation SigningWorker mismatch');
  }
  return parsed;
}

export function requirePrivateSigningDigest(
  value: unknown,
  label: string,
): RouterAbPublicDigest32V1Wire {
  const record = requirePrivateSigningRecord(value, label);
  const bytes = Array.isArray(record.bytes) ? record.bytes.map((entry) => Number(entry)) : [];
  if (
    bytes.length !== 32 ||
    !bytes.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)
  ) {
    throw new Error(`${label}.bytes must contain exactly 32 bytes`);
  }
  return { bytes };
}

function requirePrivateSigningStringArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function pushPrivateSigningIntentCommon(out: number[], intent: Record<string, unknown>): void {
  pushLen32(
    out,
    textBytes(requirePrivateSigningString(intent.operation_id, 'intent.operation_id')),
  );
  pushLen32(
    out,
    textBytes(
      requirePrivateSigningString(intent.operation_fingerprint, 'intent.operation_fingerprint'),
    ),
  );
  pushLen32(
    out,
    textBytes(requirePrivateSigningString(intent.near_account_id, 'intent.near_account_id')),
  );
  pushLen32(
    out,
    textBytes(requirePrivateSigningString(intent.near_network_id, 'intent.near_network_id')),
  );
}

function pushPrivateSigningOptionalString(out: number[], value: unknown, label: string): void {
  if (value === undefined || value === null || value === '') {
    out.push(0);
    return;
  }
  out.push(1);
  pushLen32(out, textBytes(requirePrivateSigningString(value, label)));
}

function canonicalPrivateSigningIntentBytes(value: unknown): Uint8Array {
  const intent = requirePrivateSigningRecord(value, 'intent');
  const kind = requirePrivateSigningString(intent.kind, 'intent.kind');
  const out: number[] = [];
  pushLen32(out, textBytes(ED25519_SIGNING_INTENT_VERSION_V2));
  pushLen32(out, textBytes(kind));
  pushPrivateSigningIntentCommon(out, intent);
  switch (kind) {
    case 'near_transaction_v1': {
      const transactions = requirePrivateSigningStringArray(
        intent.transactions,
        'intent.transactions',
      );
      pushU32Be(out, transactions.length);
      for (const [index, transactionValue] of transactions.entries()) {
        const transaction = requirePrivateSigningRecord(
          transactionValue,
          `intent.transactions[${index}]`,
        );
        pushLen32(
          out,
          textBytes(
            requirePrivateSigningString(
              transaction.receiver_id,
              `intent.transactions[${index}].receiver_id`,
            ),
          ),
        );
        pushLen32(
          out,
          textBytes(
            requirePrivateSigningString(
              transaction.action_fingerprint,
              `intent.transactions[${index}].action_fingerprint`,
            ),
          ),
        );
      }
      pushLen32(
        out,
        textBytes(
          requirePrivateSigningString(
            intent.unsigned_transaction_borsh_b64u,
            'intent.unsigned_transaction_borsh_b64u',
          ),
        ),
      );
      return Uint8Array.from(out);
    }
    case 'nep413_v1':
      pushLen32(out, textBytes(requirePrivateSigningString(intent.recipient, 'intent.recipient')));
      pushLen32(out, textBytes(requirePrivateSigningString(intent.message, 'intent.message')));
      pushLen32(
        out,
        textBytes(requirePrivateSigningString(intent.nonce_b64u, 'intent.nonce_b64u')),
      );
      pushPrivateSigningOptionalString(out, intent.callback_url, 'intent.callback_url');
      return Uint8Array.from(out);
    case 'near_delegate_action_v1': {
      const delegate = requirePrivateSigningRecord(intent.delegate, 'intent.delegate');
      for (const field of [
        'sender_id',
        'receiver_id',
        'public_key',
        'nonce',
        'max_block_height',
        'action_fingerprint',
        'canonical_delegate_borsh_b64u',
      ] as const) {
        pushLen32(
          out,
          textBytes(requirePrivateSigningString(delegate[field], `intent.delegate.${field}`)),
        );
      }
      return Uint8Array.from(out);
    }
    default:
      throw new Error(`intent.kind is unsupported: ${kind}`);
  }
}

function privateSigningPayloadPreimage(value: unknown): {
  readonly canonical: Uint8Array;
  readonly preimage: Uint8Array;
  readonly expectedDigest: RouterAbPublicDigest32V1Wire;
} {
  const payload = requirePrivateSigningRecord(value, 'signing_payload');
  const kind = requirePrivateSigningString(payload.kind, 'signing_payload.kind');
  const expectedDigestB64u = requirePrivateSigningString(
    payload.expected_signing_digest_b64u,
    'signing_payload.expected_signing_digest_b64u',
  );
  const out: number[] = [];
  pushLen32(out, textBytes(ED25519_SIGNING_PAYLOAD_VERSION_V2));
  pushLen32(out, textBytes(kind));
  let preimageB64u: string;
  switch (kind) {
    case 'near_unsigned_transaction_borsh_v1':
      preimageB64u = requirePrivateSigningString(
        payload.unsigned_transaction_borsh_b64u,
        'signing_payload.unsigned_transaction_borsh_b64u',
      );
      break;
    case 'nep413_message_v1':
      preimageB64u = requirePrivateSigningString(
        payload.canonical_message_b64u,
        'signing_payload.canonical_message_b64u',
      );
      break;
    case 'near_delegate_action_v1':
      preimageB64u = requirePrivateSigningString(
        payload.canonical_delegate_borsh_b64u,
        'signing_payload.canonical_delegate_borsh_b64u',
      );
      break;
    default:
      throw new Error(`signing_payload.kind is unsupported: ${kind}`);
  }
  pushLen32(out, textBytes(preimageB64u));
  pushLen32(out, textBytes(expectedDigestB64u));
  return {
    canonical: Uint8Array.from(out),
    preimage: base64UrlDecode(preimageB64u),
    expectedDigest: digest32FromB64u(expectedDigestB64u),
  };
}

function privateSigningDigestsEqual(
  left: RouterAbPublicDigest32V1Wire,
  right: RouterAbPublicDigest32V1Wire,
): boolean {
  return left.bytes.every((byte, index) => byte === right.bytes[index]);
}

export async function computeRouterAbEd25519NormalSigningAdmissionMaterial(input: {
  readonly intent: unknown;
  readonly signingPayload: unknown;
}): Promise<{
  readonly intentDigest: RouterAbPublicDigest32V1Wire;
  readonly signingPayloadDigest: RouterAbPublicDigest32V1Wire;
  readonly admittedSigningDigest: RouterAbPublicDigest32V1Wire;
}> {
  const payload = privateSigningPayloadPreimage(input.signingPayload);
  const [intentDigest, signingPayloadDigest, admittedSigningDigest] = await Promise.all([
    sha256Digest32(canonicalPrivateSigningIntentBytes(input.intent)),
    sha256Digest32(payload.canonical),
    sha256Digest32(payload.preimage),
  ]);
  if (!privateSigningDigestsEqual(admittedSigningDigest, payload.expectedDigest)) {
    throw new Error('signing_payload expected signing digest does not match its preimage');
  }
  return { intentDigest, signingPayloadDigest, admittedSigningDigest };
}

async function privateSigningRound1BindingDigest(input: {
  readonly scope: RouterAbEd25519NormalSigningScopeV2;
  readonly expiresAtMs: number;
  readonly displayDigest: RouterAbPublicDigest32V1Wire;
  readonly intentDigest: RouterAbPublicDigest32V1Wire;
  readonly signingPayloadDigest: RouterAbPublicDigest32V1Wire;
  readonly admittedSigningDigest: RouterAbPublicDigest32V1Wire;
}): Promise<RouterAbPublicDigest32V1Wire> {
  const out: number[] = [];
  pushLen32(out, textBytes(ED25519_ROUND1_BINDING_VERSION_V2));
  pushLen32(out, textBytes(input.scope.request_id));
  pushLen32(out, textBytes(input.scope.account_id));
  switch (input.scope.authorization.kind) {
    case 'reusable_wallet_session':
      pushLen32(out, textBytes('reusable_wallet_session'));
      pushLen32(out, textBytes(input.scope.authorization.wallet_session_id));
      break;
    case 'operation_step_up':
      pushLen32(out, textBytes('operation_step_up'));
      break;
  }
  pushLen32(out, textBytes('mpc_material_activation_ref'));
  pushLen32(out, textBytes(input.scope.material_activation.activation_id));
  pushLen32(out, textBytes(input.scope.material_activation.capability));
  pushLen32(out, textBytes(input.scope.material_activation.material_owner));
  pushLen32(out, textBytes(input.scope.material_activation.key_binding));
  pushLen32(out, textBytes(input.scope.material_activation.lifecycle_binding));
  pushLen32(out, textBytes(input.scope.material_activation.signing_worker));
  pushLen32(out, textBytes(input.scope.signing_worker_id));
  pushU64Be(out, input.expiresAtMs);
  out.push(
    ...input.displayDigest.bytes,
    ...input.intentDigest.bytes,
    ...input.signingPayloadDigest.bytes,
    ...input.admittedSigningDigest.bytes,
  );
  return sha256Digest32(Uint8Array.from(out));
}

function normalizedPrivateSigningHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  if (!entry) return '';
  return Array.isArray(entry[1]) ? entry[1].join(',') : String(entry[1] || '').trim();
}

async function privateSigningTrustedSourceDigest(
  headers: Record<string, string | string[] | undefined>,
): Promise<RouterAbPublicDigest32V1Wire> {
  const out = Array.from(textBytes(ED25519_TRUSTED_SOURCE_VERSION_V2));
  for (const name of ['cf-connecting-ip']) {
    const nameBytes = textBytes(name);
    const valueBytes = textBytes(normalizedPrivateSigningHeader(headers, name));
    pushU64Be(out, nameBytes.length);
    out.push(...nameBytes);
    pushU64Be(out, valueBytes.length);
    out.push(...valueBytes);
  }
  return sha256Digest32(Uint8Array.from(out));
}

function privateSigningTrustedAdmission(input: {
  readonly accountId: string;
  readonly authorization: RouterAbPrivateSigningAuthorizationContext;
  readonly requestId: string;
  readonly intentDigest: RouterAbPublicDigest32V1Wire;
  readonly trustedSourceDigest: RouterAbPublicDigest32V1Wire;
}): RouterAbNormalSigningTrustedAdmissionV1 {
  return {
    metadata: {
      org_id: input.authorization.runtimePolicyScope.orgId,
      project_id: input.authorization.runtimePolicyScope.projectId,
      environment: input.authorization.runtimePolicyScope.envId,
      account_id: input.accountId,
      auth:
        input.authorization.kind === 'reusable_wallet_session'
          ? {
              auth: 'owner_wallet_session',
              subject_id: input.authorization.subjectId,
              wallet_session_id: input.authorization.walletSessionId,
            }
          : {
              auth: 'owner_operation_step_up',
              subject_id: input.authorization.subjectId,
              authorization_session_id: input.authorization.authorizationSessionId,
            },
      trusted_source_digest: input.trustedSourceDigest,
      intent_digest: input.intentDigest,
    },
    decision: {
      kind: 'accepted',
      request_id: input.requestId,
    },
  };
}

type RouterAbPrivateSigningAuthorizationContext =
  | {
      readonly kind: 'reusable_wallet_session';
      readonly runtimePolicyScope: RuntimePolicyScope;
      readonly subjectId: string;
      readonly walletSessionId: string;
    }
  | {
      readonly kind: 'operation_step_up';
      readonly runtimePolicyScope: RuntimePolicyScope;
      readonly subjectId: string;
      readonly authorizationSessionId: string;
    };

function privateSigningAuthorizationContextFromAuthorization(
  authorization: RouterAbPrivateSigningAuthorization,
): RouterAbPrivateSigningAuthorizationContext {
  switch (authorization.kind) {
    case 'wallet_session_operation_credential_v1':
      return {
        kind: 'reusable_wallet_session',
        runtimePolicyScope: authorization.runtimePolicyScope,
        subjectId: authorization.principalId,
        walletSessionId: authorization.walletSessionId,
      };
    case 'operation_step_up':
      return {
        kind: 'operation_step_up',
        runtimePolicyScope: authorization.session.runtimePolicyScope,
        subjectId: authorization.session.principalId,
        authorizationSessionId: authorization.session.sessionId,
      };
  }
}

function validatePrivateSigningAuthorizationContext(
  authorization: RouterAbNormalSigningAuthorizationWire,
  context: RouterAbPrivateSigningAuthorizationContext,
): void {
  if (authorization.kind !== context.kind) {
    throw new Error('Router A/B private authorization branch does not match request');
  }
  if (
    authorization.kind === 'reusable_wallet_session' &&
    context.kind === 'reusable_wallet_session' &&
    authorization.wallet_session_id !== context.walletSessionId
  ) {
    throw new Error('Router A/B private Wallet Session does not match request');
  }
}

function privateSigningAuthorizationContext(
  scope: RouterAbEd25519NormalSigningScopeV2,
  authorization: RouterAbPrivateSigningAuthorization,
): RouterAbPrivateSigningAuthorizationContext {
  const context = privateSigningAuthorizationContextFromAuthorization(authorization);
  if (
    context.kind === 'reusable_wallet_session' &&
    scope.authorization.kind === 'reusable_wallet_session'
  ) {
    if (scope.authorization.wallet_session_id !== context.walletSessionId) {
      throw new Error('Router A/B Ed25519 scope authorization does not match exact session');
    }
    return context;
  }
  if (
    context.kind === 'operation_step_up' &&
    authorization.kind === 'operation_step_up' &&
    scope.authorization.kind === 'operation_step_up'
  ) {
    if (
      scope.account_id !== authorization.session.walletId ||
      scope.material_activation.material_owner !== authorization.session.walletId
    ) {
      throw new Error('Router A/B Ed25519 step-up scope does not match the wallet authorization');
    }
    return context;
  }
  throw new Error('Router A/B Ed25519 authorization branch does not match verified binding');
}

type RouterAbEd25519PrivateSigningWorkerBuildInput =
  | {
      readonly phase: 'prepare';
      readonly body: Record<string, unknown>;
      readonly authorization: RouterAbPrivateSigningAuthorization;
      readonly headers: Record<string, string | string[] | undefined>;
      readonly effectClaim?: never;
    }
  | {
      readonly phase: 'finalize';
      readonly body: Record<string, unknown>;
      readonly authorization: RouterAbPrivateSigningAuthorization;
      readonly headers: Record<string, string | string[] | undefined>;
      readonly effectClaim: RouterAbNormalSigningEffectClaimV1;
    };

export async function buildRouterAbEd25519PrivateSigningWorkerBody(
  input: RouterAbEd25519PrivateSigningWorkerBuildInput,
): Promise<RouterAbEd25519PrivateSigningWorkerBody> {
  const scope = parseRouterAbEd25519NormalSigningScopeV2(input.body.scope);
  const signingContext = privateSigningAuthorizationContext(scope, input.authorization);
  const trustedSourceDigest = await privateSigningTrustedSourceDigest(input.headers);
  const materialSource = registrationMaterialSourceV1({
    accountId: scope.account_id,
    materialActivationId: scope.material_activation.activation_id,
    signingWorkerId: scope.signing_worker_id,
  });
  if (input.phase === 'finalize') {
    validateRouterAbNormalSigningEffectClaim(input.effectClaim, scope, signingContext);
    const prepareBinding = requirePrivateSigningRecord(
      input.body.prepare_binding,
      'prepare_binding',
    );
    const intentDigest = requirePrivateSigningDigest(
      prepareBinding.intent_digest,
      'prepare_binding.intent_digest',
    );
    const signingPayloadDigest = requirePrivateSigningDigest(
      prepareBinding.signing_payload_digest,
      'prepare_binding.signing_payload_digest',
    );
    const round1BindingDigest = requirePrivateSigningDigest(
      prepareBinding.round1_binding_digest,
      'prepare_binding.round1_binding_digest',
    );
    const expiresAtMs = requirePrivateSigningPositiveSafeInteger(
      input.body.expires_at_ms,
      'expires_at_ms',
    );
    return {
      request: input.body,
      admission_candidate: {
        ...privateSigningAdmissionCandidateScope(scope, signingContext),
        intent_digest: intentDigest,
        signing_payload_digest: signingPayloadDigest,
        round1_binding_digest: round1BindingDigest,
        trusted_source_digest: trustedSourceDigest,
        expires_at_ms: expiresAtMs,
      },
      trusted_admission: privateSigningTrustedAdmission({
        accountId: scope.account_id,
        authorization: signingContext,
        requestId: scope.request_id,
        intentDigest,
        trustedSourceDigest,
      }),
      effect_claim: input.effectClaim,
      material_source: materialSource,
    };
  }

  const expiresAtMs = requirePrivateSigningPositiveSafeInteger(
    input.body.expires_at_ms,
    'expires_at_ms',
  );
  const material = await computeRouterAbEd25519NormalSigningAdmissionMaterial({
    intent: input.body.intent,
    signingPayload: input.body.signing_payload,
  });
  const round1BindingDigest = await privateSigningRound1BindingDigest({
    scope,
    expiresAtMs,
    displayDigest: requirePrivateSigningDigest(input.body.display_digest, 'display_digest'),
    ...material,
  });
  const trustedAdmission = privateSigningTrustedAdmission({
    accountId: scope.account_id,
    authorization: signingContext,
    requestId: scope.request_id,
    intentDigest: material.intentDigest,
    trustedSourceDigest,
  });
  return {
    scope,
    expires_at_ms: expiresAtMs,
    admission_candidate: {
      ...privateSigningAdmissionCandidateScope(scope, signingContext),
      intent_digest: material.intentDigest,
      signing_payload_digest: material.signingPayloadDigest,
      admitted_signing_digest: material.admittedSigningDigest,
      round1_binding_digest: round1BindingDigest,
      trusted_source_digest: trustedSourceDigest,
      expires_at_ms: expiresAtMs,
    },
    trusted_admission: trustedAdmission,
    material_source: materialSource,
  };
}

function privateSigningAdmissionCandidateScope(
  scope: RouterAbEd25519NormalSigningScopeV2,
  signingContext: RouterAbPrivateSigningAuthorizationContext,
) {
  return {
    org_id: signingContext.runtimePolicyScope.orgId,
    project_id: signingContext.runtimePolicyScope.projectId,
    environment: signingContext.runtimePolicyScope.envId,
    account_id: scope.account_id,
    subject_id: signingContext.subjectId,
    authorization:
      signingContext.kind === 'reusable_wallet_session'
        ? {
            kind: 'reusable_wallet_session' as const,
            wallet_session_id: signingContext.walletSessionId,
          }
        : {
            kind: 'operation_step_up' as const,
            authorization_session_id: signingContext.authorizationSessionId,
          },
    signing_worker_id: scope.signing_worker_id,
    request_id: scope.request_id,
  };
}

export async function buildRouterAbEcdsaDerivationPrivateSigningWorkerBody(input: {
  phase: 'prepare' | 'finalize';
  body: Record<string, unknown>;
  authorization: RouterAbPrivateSigningAuthorization;
  headers: Record<string, string | string[] | undefined>;
}): Promise<RouterAbEcdsaDerivationPrivateSigningWorkerBody> {
  const signingContext = privateSigningAuthorizationContextFromAuthorization(input.authorization);
  const trustedSourceDigest = await privateSigningTrustedSourceDigest(input.headers);
  if (input.phase === 'prepare') {
    const request = parseRouterAbEcdsaDerivationEvmDigestSigningRequestV1(input.body);
    validatePrivateSigningAuthorizationContext(request.authorization, signingContext);
    return privateEcdsaDerivationSigningWorkerBody({
      request,
      requestDigest: await routerAbEcdsaDerivationEvmDigestSigningRequestDigestV1(request),
      signingContext,
      trustedSourceDigest,
    });
  }
  const request = parseRouterAbEcdsaDerivationEvmDigestSigningFinalizeRequestV1(input.body);
  validatePrivateSigningAuthorizationContext(request.authorization, signingContext);
  return privateEcdsaDerivationSigningWorkerBody({
    request,
    requestDigest:
      await routerAbEcdsaDerivationEvmDigestSigningFinalizeCoreRequestDigestV1(request),
    signingContext,
    trustedSourceDigest,
  });
}

function privateEcdsaDerivationSigningWorkerBody<
  TRequest extends RouterAbEcdsaOperationStepUpRequest,
>(input: {
  readonly request: TRequest;
  readonly requestDigest: RouterAbPublicDigest32V1Wire;
  readonly signingContext: RouterAbPrivateSigningAuthorizationContext;
  readonly trustedSourceDigest: RouterAbPublicDigest32V1Wire;
}) {
  return {
    request: input.request,
    trusted_admission: privateSigningTrustedAdmission({
      accountId: input.request.scope.wallet_id,
      authorization: input.signingContext,
      requestId: input.request.request_id,
      intentDigest: input.requestDigest,
      trustedSourceDigest: input.trustedSourceDigest,
    }),
    material_source: registrationMaterialSourceV1({
      accountId: input.request.scope.wallet_id,
      materialActivationId: input.request.scope.material_activation.activation_id,
      signingWorkerId: input.request.scope.signing_worker.server_id,
    }),
  };
}

export type RouterAbEcdsaOperationStepUpRequest =
  | RouterAbEcdsaDerivationEvmDigestSigningRequestV1Wire
  | RouterAbEcdsaDerivationEvmDigestSigningFinalizeCoreRequestV1Wire;

export async function postRouterAbSigningWorkerJson(input: {
  config: RouterAbConfiguredSigningWorkerPrivateTransport;
  path: RouterAbEd25519PrivateSigningPath | RouterAbEcdsaDerivationPrivateSigningPath;
  body: unknown;
}): Promise<RouterAbSigningWorkerJsonResult> {
  const fetchImpl = resolveRouterAbSigningWorkerFetch(input.config.fetchImpl);
  if (!fetchImpl) {
    return routerAbSigningError(500, 'internal', 'fetch is not available in this runtime');
  }

  const url = privateSigningWorkerUrl(input.config, input.path);
  const response = await postRouterAbInternalServiceJson({
    url,
    body: input.body,
    authSecret: input.config.auth.secret,
    fetchImpl,
  });
  if (!response.ok && response.code === 'network_error') {
    return routerAbSigningError(
      502,
      'signing_worker_unreachable',
      `Router A/B SigningWorker request failed: ${response.message}`,
    );
  }

  if (!response.ok && response.code === 'http_error') {
    return routerAbSigningError(
      response.status || 502,
      'signing_worker_error',
      response.bodyText || `Router A/B SigningWorker returned HTTP ${response.status}`,
    );
  }

  if (!response.ok) {
    return routerAbSigningError(
      502,
      'invalid_signing_worker_response',
      `Router A/B SigningWorker returned invalid JSON: ${response.message}`,
    );
  }

  return {
    ok: true,
    body: response.json,
    replay: {
      status: response.status,
      contentType: 'application/json',
      bodyText: response.bodyText,
    },
  };
}

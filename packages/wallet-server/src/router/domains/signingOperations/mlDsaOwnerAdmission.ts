import {
  CAPABILITY_KINDS,
  NEAR_ML_DSA_65_MPC_OPERATION_KINDS,
  parseCapabilityId,
  parseTenantId,
  parseCapabilityOperationId,
  type CapabilityOperationId,
  type CapabilityId,
  type TenantId,
} from '@shared/authorization/capabilityKinds';
import {
  computeCapabilityOperationFingerprintDigest,
  type OperationDigestSet,
} from '@shared/authorization/operationFingerprint';
import { base64UrlDecode } from '@shared/utils/base64';
import {
  parseDigestB64u,
  sha256DigestB64u,
  sha256Utf8DigestB64u,
  type DigestB64u,
} from '@shared/utils/canonicalPrimitives';
import { alphabetizeStringify, sha256BytesUtf8 } from '@shared/utils/digests';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireParsed } from '@shared/passkey-custody/primitives';
import { parseWalletKeyRecord } from '@shared/signing-lanes/recordParsers';
import type { MlDsa65WalletKeyRecord } from '@shared/signing-lanes';
import {
  parseWalletAuthAuthorityRef,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import {
  walletObjectIdentity,
  type WalletObjectIdentity,
} from '../../cloudflare/runtime/walletObjectAddresses';
import type { Variant } from '@shared/utils/variant';
import type {
  AuthorizedOperation,
  VerifiedAuthorizationEvidenceSet,
  VerifiedOwnerProof,
  SessionOrigin,
} from '../../../authorization/domain';
import type { ApprovedMlDsaSessionOperation } from '../../cloudflare/d1/wallet/d1MlDsaSigningSessions';

/** Public registry data. Parsing this record grants no custody or signing authority. */
export class MlDsaSigningTarget {
  private constructor(
    readonly tenantId: TenantId,
    readonly identity: WalletObjectIdentity,
    readonly capabilityId: CapabilityId,
    readonly key: MlDsa65WalletKeyRecord,
    readonly scheduleDigest: DigestB64u,
    readonly authority: WalletAuthAuthorityRef,
  ) {}

  static parse(raw: unknown): MlDsaSigningTarget {
    const row = exactRecord(
      raw,
      ['tenantId', 'identity', 'capabilityId', 'key', 'scheduleDigest', 'authority'],
      'ML-DSA signing target',
    );
    const identity = exactRecord(
      row.identity,
      ['walletId', 'ownershipGeneration', 'orgId', 'projectId', 'envId'],
      'ML-DSA wallet identity',
    );
    const scope = walletObjectIdentity(identity.walletId, identity.ownershipGeneration, {
      orgId: identity.orgId,
      projectId: identity.projectId,
      envId: identity.envId,
    });
    const key = parseWalletKeyRecord(row.key);
    const authority = parseWalletAuthAuthorityRef(row.authority);
    if (
      key.keyFamily !== 'ml_dsa_65' ||
      key.walletId !== scope.walletId ||
      authority?.walletId !== scope.walletId
    ) {
      throw new Error('ML-DSA key and owner authority must belong to the wallet');
    }
    return new MlDsaSigningTarget(
      requireParsed(parseTenantId(row.tenantId), 'tenantId'),
      scope,
      requireParsed(parseCapabilityId(row.capabilityId), 'capabilityId'),
      key,
      parseDigestB64u(row.scheduleDigest),
      authority,
    );
  }
}

/** NEAR signs its 32-byte transaction hash with an empty ML-DSA context. */
export class MlDsaTransactionIntent {
  private constructor(readonly transactionHash: DigestB64u) {}
  static parse(raw: unknown): MlDsaTransactionIntent {
    const row = exactRecord(raw, ['transactionHash'], 'ML-DSA transaction intent');
    return new MlDsaTransactionIntent(parseDigestB64u(row.transactionHash));
  }
}

export async function mlDsaOwnerOperationDigests(
  target: MlDsaSigningTarget,
  intent: MlDsaTransactionIntent,
  displayDigest: DigestB64u,
): Promise<OperationDigestSet> {
  return {
    laneDigest: await sha256Utf8DigestB64u(
      `seams/ml-dsa/owner-key/v1|${alphabetizeStringify({
        tenantId: target.tenantId,
        identity: target.identity,
        capabilityId: target.capabilityId,
        key: target.key,
        scheduleDigest: target.scheduleDigest,
        authority: target.authority,
      })}`,
    ),
    intentDigest: await sha256Utf8DigestB64u(
      `seams/ml-dsa/near-transaction/v1|${alphabetizeStringify({
        transactionHash: intent.transactionHash,
        context: '',
      })}`,
    ),
    displayDigest,
  };
}

type RouterMlDsaSigningRequest = {
  readonly request: {
    readonly key: {
      readonly wallet: {
        readonly org: string;
        readonly project: string;
        readonly environment: string;
        readonly wallet: string;
      };
      readonly key_id: string;
      readonly epoch: number;
      readonly public_key_digest: readonly number[];
      readonly schedule_digest: readonly number[];
    };
    readonly operation: readonly number[];
    readonly message_digest: readonly number[];
    readonly context_digest: readonly number[];
  };
  readonly message: readonly number[];
  readonly context: readonly number[];
};

class PreparedMlDsaOwnerOperationProof {
  private readonly encodedBody: string;
  constructor(
    body: RouterMlDsaSigningRequest,
    readonly expiresAtMs: number,
  ) {
    this.encodedBody = JSON.stringify(body);
  }
  encode(): string {
    return this.encodedBody;
  }
}
export type PreparedMlDsaOwnerOperation = PreparedMlDsaOwnerOperationProof;
export type MlDsaOwnerAdmission =
  | {
      readonly kind: 'prepared';
      readonly operation: PreparedMlDsaOwnerOperation;
      readonly reason?: never;
    }
  | {
      readonly kind: 'refused';
      readonly reason:
        | 'inactive_key'
        | 'unclaimed_operation'
        | 'wrong_operation'
        | 'owner_mismatch'
        | 'expired_evidence'
        | 'binding_mismatch';
      readonly operation?: never;
    };

/**
 * The caller loads the target and claimed operation from trusted stores and supplies
 * the factor verifier's proof. HTTP authentication and custody activation precede this gate.
 * Dedicated ML-DSA grants use the separate verified-session entry point below.
 */
export async function prepareMlDsaOwnerOperation(input: {
  readonly target: MlDsaSigningTarget;
  readonly intent: MlDsaTransactionIntent;
  readonly operation: AuthorizedOperation;
  readonly evidence: VerifiedAuthorizationEvidenceSet;
  readonly ownerProof: Variant<VerifiedOwnerProof, 'purpose', 'operation'>;
  readonly nowMs: number;
  readonly requestOrigin: SessionOrigin;
  readonly audience: SessionOrigin;
}): Promise<MlDsaOwnerAdmission> {
  const { target, intent, operation, evidence, ownerProof, nowMs, requestOrigin, audience } = input;
  if (target.key.lifecycle.state !== 'active') return { kind: 'refused', reason: 'inactive_key' };
  if (operation.lifecycle !== 'claimed') return { kind: 'refused', reason: 'unclaimed_operation' };
  const envelope = operation.operation;
  if (
    envelope.operation.capabilityKind !== CAPABILITY_KINDS.nearMlDsa65MpcSigning ||
    envelope.operation.operationKind !== NEAR_ML_DSA_65_MPC_OPERATION_KINDS.signTransaction ||
    evidence.operation.capabilityKind !== CAPABILITY_KINDS.nearMlDsa65MpcSigning ||
    evidence.operation.operationKind !== NEAR_ML_DSA_65_MPC_OPERATION_KINDS.signTransaction ||
    operation.authorization.kind !== 'verified_step_up' ||
    operation.quota.kind !== 'quota_neutral' ||
    ownerProof.purpose !== 'operation'
  ) {
    return { kind: 'refused', reason: 'wrong_operation' };
  }
  if (
    operation.tenantId !== target.tenantId ||
    envelope.tenantId !== target.tenantId ||
    evidence.tenantId !== target.tenantId ||
    evidence.principalId !== envelope.principalId ||
    evidence.walletId !== target.identity.walletId ||
    envelope.capabilityId !== target.capabilityId ||
    evidence.authorityRef.authorityDigest !== target.authority.authorityDigest ||
    evidence.authorityRef.walletAuthMethodId !== target.authority.walletAuthMethodId ||
    ownerProof.tenantId !== target.tenantId ||
    ownerProof.principalId !== envelope.principalId ||
    ownerProof.walletId !== target.identity.walletId ||
    ownerProof.authority.authorityDigest !== target.authority.authorityDigest ||
    ownerProof.authority.walletAuthMethodId !== target.authority.walletAuthMethodId ||
    evidence.requestOrigin !== requestOrigin ||
    evidence.audience !== audience ||
    ownerProof.origin !== requestOrigin ||
    ownerProof.audience !== audience
  ) {
    return { kind: 'refused', reason: 'owner_mismatch' };
  }
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < evidence.verifiedAtMs ||
    nowMs >= evidence.expiresAtMs ||
    operation.claimedAtMs < evidence.verifiedAtMs ||
    operation.claimedAtMs > nowMs ||
    nowMs < ownerProof.verifiedAtMs ||
    nowMs >= ownerProof.expiresAtMs ||
    operation.claimedAtMs < ownerProof.verifiedAtMs
  ) {
    return { kind: 'refused', reason: 'expired_evidence' };
  }
  const digests = await mlDsaOwnerOperationDigests(target, intent, envelope.digests.displayDigest);
  if (
    operation.authorization.evidenceSetDigest !== evidence.evidenceSetDigest ||
    operation.operationFingerprintDigest !==
      (await computeCapabilityOperationFingerprintDigest(envelope)) ||
    ownerProof.operation.operationFingerprintDigest !== operation.operationFingerprintDigest ||
    ownerProof.operation.laneDigest !== digests.laneDigest ||
    ownerProof.operation.intentDigest !== digests.intentDigest ||
    ownerProof.operation.displayDigest !== digests.displayDigest ||
    envelope.digests.laneDigest !== digests.laneDigest ||
    envelope.digests.intentDigest !== digests.intentDigest ||
    evidence.laneDigest !== digests.laneDigest ||
    evidence.intentDigest !== digests.intentDigest ||
    evidence.displayDigest !== digests.displayDigest
  ) {
    return { kind: 'refused', reason: 'binding_mismatch' };
  }
  return {
    kind: 'prepared',
    operation: await preparedOperation(
      target,
      intent,
      envelope.operationId,
      Math.min(evidence.expiresAtMs, ownerProof.expiresAtMs),
    ),
  };
}

export async function prepareMlDsaSessionOwnerOperation(
  admission: ApprovedMlDsaSessionOperation,
): Promise<PreparedMlDsaOwnerOperation> {
  const record = admission.record;
  if (
    record.target.key.lifecycle.state !== 'active' ||
    record.phase.kind !== 'session_approved' ||
    record.phase.sessionIdB64u !== admission.sessionIdB64u ||
    Date.now() >= admission.expiresAtMs
  )
    throw new Error('The ML-DSA session operation is not active');
  return preparedOperation(
    record.target,
    MlDsaTransactionIntent.parse({
      transactionHash: record.preparation.transaction.transactionHashB64u,
    }),
    requireParsed(
      parseCapabilityOperationId(`ml-dsa:${record.preparation.request.operationIdB64u}`),
      'operationId',
    ),
    admission.expiresAtMs,
  );
}

/** The Router names one published key by these fields. */
export async function mlDsaRouterKeyScope(target: MlDsaSigningTarget) {
  const publicKey = base64UrlDecode(target.key.registeredPublicKeyB64u);
  return {
    wallet: {
      org: target.identity.orgId,
      project: target.identity.projectId,
      environment: target.identity.envId,
      wallet: target.identity.walletId,
    },
    key_id: target.key.mlDsaSigningKeyId,
    epoch: target.key.materialEpoch,
    public_key_digest: Array.from(base64UrlDecode(await sha256DigestB64u(publicKey))),
    schedule_digest: Array.from(base64UrlDecode(target.scheduleDigest)),
  };
}

async function preparedOperation(
  target: MlDsaSigningTarget,
  intent: MlDsaTransactionIntent,
  operation: CapabilityOperationId,
  expiresAtMs: number,
): Promise<PreparedMlDsaOwnerOperation> {
  const message = base64UrlDecode(intent.transactionHash);
  const operationId = await sha256BytesUtf8(
    `seams/ml-dsa/authorized-operation/v1|${alphabetizeStringify({
      tenantId: target.tenantId,
      capabilityId: target.capabilityId,
      operationId: operation,
    })}`,
  );
  return new PreparedMlDsaOwnerOperationProof(
    {
      request: {
        key: await mlDsaRouterKeyScope(target),
        operation: Array.from(operationId),
        message_digest: Array.from(base64UrlDecode(await sha256DigestB64u(message))),
        context_digest: Array.from(base64UrlDecode(await sha256DigestB64u(new Uint8Array()))),
      },
      message: Array.from(message),
      context: [],
    },
    expiresAtMs,
  );
}

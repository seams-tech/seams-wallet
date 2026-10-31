import type {
  EcdsaWalletSessionAdmissionRead,
  Ed25519WalletSessionAdmissionRead,
  DirectWalletSessionCommitPurpose,
} from '../../../../authorization/service';
import type { D1RegistrationCommitBatch } from '../registration/d1WalletRegistrationCommitStore';
import type { RouterAbMpcMaterialActivationRefWire } from '@shared/utils/routerAbNormalSigningIdentity';
import type {
  EcdsaWalletSessionAdmissionInput,
  EcdsaWalletSessionAdmissionResult,
  EcdsaWalletSessionResolutionResult,
  PinnedOwnerWalletScope,
} from '../../../../authorization/ecdsaWalletSessionAdmission';
import type {
  Ed25519WalletSessionAdmissionInput,
  Ed25519WalletSessionAdmissionResult,
  Ed25519WalletSessionResolutionInput,
  Ed25519WalletSessionResolutionResult,
} from '../../../../authorization/ed25519WalletSessionAdmission';
import {
  type WalletAuthorityId,
  type WalletAuthMethodId,
  type WalletId,
} from '@shared/utils/domainIds';
import { type AuthorizedOperationId, type TenantId } from '@shared/authorization/capabilityKinds';
import type {
  AuthorizedOperation,
  AuthorizedOperationInput,
  IssuedWalletSessionAuthorizationV2,
  LiveWalletSessionAuthorizationProjectionV2,
  WalletSessionAuthorizationV2,
  ActiveWalletSessionQuota,
  PersistedActiveWalletSessionAuthorizationV2,
  DirectV2CommitResult,
  WalletSessionAuthorizationV2MintLookup,
  WalletSessionAuthorizationV2MintRead,
  AuthorizedOperationReplayResponse,
  CompletedCapabilityOperationResult,
  IssuedHostedWalletSeamsSessionExchangeV2,
  RedeemHostedWalletSeamsSessionExchangeV2Input,
  PersistedHostedWalletSeamsSessionExchangeV2Result,
  ExactWalletSessionQuotaProjectionV1,
  ExactWalletSessionStatusV2,
  ExactWalletSessionStatusSnapshotV2,
  WalletSessionAdmissionSnapshotV2,
  WalletSessionExactOperationContext,
  ResolvedHostedWalletSessionOperationCredentialV2,
  VerifiedAuthorizationEvidenceSet,
  VerifiedOwnerProof,
} from '../../../../authorization/domain';
import { type CapabilityOperationFingerprintDigest } from '@shared/authorization/operationFingerprint';
import type {
  AuthorizedOperationAdmissionRejection,
  AuthorizedOperationMaterialScope,
  AuthorizedOperationAdmissionResult,
  PreparedAuthorizedOperationAdmission,
} from '../../../../authorization/service';
import type { D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import type {
  AuthorizationSessionPort,
  AuthorizationEvidencePort,
  AuthorizationGrantPort,
  AuthorizedOperationPort,
} from '../../../../authorization/service';
import {
  createD1AuthorizationContext,
  type D1AuthorizationContext,
  type D1AuthorizationStoreOptions,
} from './authorizationStore/context';
import * as retirement from './authorizationStore/retirement';
import * as hostedSessions from './authorizationStore/hostedSessions';
import * as evidence from './authorizationStore/evidence';
import * as issuance from './authorizationStore/issuance';
import * as sessions from './authorizationStore/sessions';
import * as operations from './authorizationStore/operations';

export type { D1AuthorizationStoreOptions } from './authorizationStore/context';

export class CloudflareD1AuthorizationStore
  implements
    AuthorizationSessionPort,
    AuthorizationEvidencePort,
    AuthorizationGrantPort,
    AuthorizedOperationPort
{
  private readonly context: D1AuthorizationContext;
  constructor(options: D1AuthorizationStoreOptions) {
    this.context = createD1AuthorizationContext(options);
  }
  retireWalletSessionAuthorizationsForAuthMethod(input: {
    readonly tenantId: TenantId;
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly nowMs: number;
  }): Promise<void> {
    return retirement.retireWalletSessionAuthorizationsForAuthMethod(this.context, input);
  }

  prepareRetireWalletSessionAuthorizationsForAuthMethod(input: {
    readonly tenantId: TenantId;
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly nowMs: number;
  }): readonly D1PreparedStatementLike[] {
    return retirement.prepareRetireWalletSessionAuthorizationsForAuthMethod(this.context, input);
  }

  prepareRetireWalletSessionAuthorizationsV2ForAuthority(input: {
    readonly tenantId: TenantId;
    readonly walletId: WalletId;
    readonly authorityId: WalletAuthorityId;
    readonly nowMs: number;
  }): readonly D1PreparedStatementLike[] {
    return retirement.prepareRetireWalletSessionAuthorizationsV2ForAuthority(this.context, input);
  }

  putIssuedHostedWalletSeamsSessionExchange(
    exchange: IssuedHostedWalletSeamsSessionExchangeV2,
  ): Promise<void> {
    return hostedSessions.putIssuedHostedWalletSeamsSessionExchange(this.context, exchange);
  }

  redeemHostedWalletSeamsSessionExchange(
    input: RedeemHostedWalletSeamsSessionExchangeV2Input,
    publishCredentialLocator?: () => Promise<void>,
  ): Promise<PersistedHostedWalletSeamsSessionExchangeV2Result> {
    return hostedSessions.redeemHostedWalletSeamsSessionExchange(
      this.context,
      input,
      publishCredentialLocator,
    );
  }

  readHostedWalletSessionOperationCredentialV2(input: {
    readonly tenantId: TenantId;
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly requestOrigin: import('../../../../authorization/domain').SessionOrigin;
    readonly nowMs: number;
  }): Promise<ResolvedHostedWalletSessionOperationCredentialV2 | null> {
    return hostedSessions.readHostedWalletSessionOperationCredentialV2(this.context, input);
  }

  readWalletOperationEvidence(
    input: import('../../../../authorization/service').WalletOperationEvidenceLookup,
  ) {
    return evidence.readRecordedWalletOperationEvidence(this.context, input);
  }

  putVerifiedEvidenceSet(evidenceSet: VerifiedAuthorizationEvidenceSet): Promise<void> {
    return evidence.putVerifiedEvidenceSet(this.context, evidenceSet);
  }

  commitWalletOperationEvidence(input: {
    readonly evidenceSet: VerifiedAuthorizationEvidenceSet;
    readonly consumeInBatch: readonly D1PreparedStatementLike[];
  }): Promise<void> {
    return evidence.commitWalletOperationEvidence(this.context, input);
  }

  consumeVerifiedOwnerProof(
    proof: VerifiedOwnerProof,
    consumedAtMs: number,
    consumptionScopeId: string,
  ): Promise<boolean> {
    return evidence.consumeVerifiedOwnerProof(
      this.context,
      proof,
      consumedAtMs,
      consumptionScopeId,
    );
  }

  commitDirectWalletSessionAuthorizationV2(input: {
    readonly persisted: PersistedActiveWalletSessionAuthorizationV2;
  }): Promise<DirectV2CommitResult> {
    return issuance.commitDirectWalletSessionAuthorizationV2(this.context, input);
  }

  readWalletSessionIssuanceGeneration(walletId: WalletId): Promise<number> {
    return issuance.readWalletSessionIssuanceGeneration(this.context, walletId);
  }

  /** The service validates the committed winner against its caller-specific replay contract. */
  commitDirectReplayableWalletSessionAuthorizationV2(input: {
    readonly persisted: PersistedActiveWalletSessionAuthorizationV2;
    readonly purpose: DirectWalletSessionCommitPurpose;
  }): Promise<DirectV2CommitResult> {
    return issuance.commitDirectReplayableWalletSessionAuthorizationV2(this.context, input);
  }

  commitRegistrationWalletSessionAuthorizationV2(
    commitWallet: (executeBatch: D1RegistrationCommitBatch) => Promise<void>,
    input: {
      readonly persisted: PersistedActiveWalletSessionAuthorizationV2;
      readonly purpose: DirectWalletSessionCommitPurpose;
    },
  ): Promise<DirectV2CommitResult> {
    return issuance.commitRegistrationWalletSessionAuthorizationV2(
      this.context,
      commitWallet,
      input,
    );
  }

  /**
   * Builds the one batch used by direct issuance. Every predecessor mutation
   * is gated by the candidate identity check, so a same-mint replay leaves
   * the committed session and its predecessor state untouched.
   */
  prepareDirectWalletSessionAuthorizationV2Statements(
    persisted: PersistedActiveWalletSessionAuthorizationV2,
  ): readonly [
    D1PreparedStatementLike,
    D1PreparedStatementLike,
    D1PreparedStatementLike,
    D1PreparedStatementLike,
    D1PreparedStatementLike,
    D1PreparedStatementLike,
  ] {
    return issuance.prepareDirectWalletSessionAuthorizationV2Statements(this.context, persisted);
  }

  replaceWalletSessionAuthorizationV2AuthorityProjection(input: {
    readonly session: WalletSessionAuthorizationV2;
    readonly quota: ActiveWalletSessionQuota | ExactWalletSessionQuotaProjectionV1;
  }): Promise<void> {
    return issuance.replaceWalletSessionAuthorizationV2AuthorityProjection(this.context, input);
  }

  prepareWalletSessionAuthorizationV2AuthorityProjectionStatements(input: {
    readonly session: WalletSessionAuthorizationV2;
    readonly promotionAtMs: number;
  }): readonly [D1PreparedStatementLike, D1PreparedStatementLike, D1PreparedStatementLike] {
    return issuance.prepareWalletSessionAuthorizationV2AuthorityProjectionStatements(
      this.context,
      input,
    );
  }

  readWalletSessionAuthorizationV2ByMint(
    input: WalletSessionAuthorizationV2MintLookup,
  ): Promise<WalletSessionAuthorizationV2MintRead | null> {
    return sessions.readWalletSessionAuthorizationV2ByMint(this.context, input);
  }

  readLiveWalletSessionAuthorizationProjectionV2(input: {
    readonly expected: WalletSessionAuthorizationV2;
    readonly nowMs: number;
  }): Promise<LiveWalletSessionAuthorizationProjectionV2 | null> {
    return sessions.readLiveWalletSessionAuthorizationProjectionV2(this.context, input);
  }

  readWalletSessionAuthorizationV2ByAuthorizationId(input: {
    readonly expected: WalletSessionAuthorizationV2;
    readonly nowMs: number;
  }): Promise<IssuedWalletSessionAuthorizationV2 | null> {
    return sessions.readWalletSessionAuthorizationV2ByAuthorizationId(this.context, input);
  }

  readWalletSessionAuthorizationV2ByIdentity(input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly walletId: WalletSessionAuthorizationV2['walletId'];
    readonly walletSessionId: WalletSessionAuthorizationV2['walletSessionId'];
    readonly authorizationId: WalletSessionAuthorizationV2['authorizationId'];
    readonly nowMs: number;
  }): Promise<IssuedWalletSessionAuthorizationV2 | null> {
    return sessions.readWalletSessionAuthorizationV2ByIdentity(this.context, input);
  }

  readActiveWalletSessionAuthorizationV2ByIdentity(input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly walletId: WalletSessionAuthorizationV2['walletId'];
    readonly walletSessionId: WalletSessionAuthorizationV2['walletSessionId'];
    readonly authorizationId: WalletSessionAuthorizationV2['authorizationId'];
    readonly nowMs: number;
  }): Promise<WalletSessionAuthorizationV2 | null> {
    return sessions.readActiveWalletSessionAuthorizationV2ByIdentity(this.context, input);
  }

  readWalletSessionAuthorizationV2ByOperationCredential(input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
  }): Promise<IssuedWalletSessionAuthorizationV2 | null> {
    return sessions.readWalletSessionAuthorizationV2ByOperationCredential(this.context, input);
  }

  /**
   * The live session, its authority and its auth method from one joined read.
   * A commit between separate reads could pair the session with an authority
   * it was never bound to; one statement cannot.
   */
  readWalletSessionAdmissionSnapshotByOperationCredential(input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
  }): Promise<WalletSessionAdmissionSnapshotV2 | null> {
    return sessions.readWalletSessionAdmissionSnapshotByOperationCredential(this.context, input);
  }

  readEcdsaWalletSessionAdmissionSnapshotByOperationCredential(input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
    readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
  }): Promise<EcdsaWalletSessionAdmissionRead | null> {
    return sessions.readEcdsaWalletSessionAdmissionSnapshotByOperationCredential(
      this.context,
      input,
    );
  }

  /**
   * The session with the Ed25519 signer and the policy rows its admission
   * needs, in one statement. The signer and the policy are those of the
   * session's own wallet, whatever wallet the request names.
   */
  readEd25519WalletSessionAdmissionSnapshotByOperationCredential(input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
    readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
  }): Promise<Ed25519WalletSessionAdmissionRead | null> {
    return sessions.readEd25519WalletSessionAdmissionSnapshotByOperationCredential(
      this.context,
      input,
    );
  }

  readWalletSessionExactOperationContextByCredential(input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
  }): Promise<WalletSessionExactOperationContext | null> {
    return sessions.readWalletSessionExactOperationContextByCredential(this.context, input);
  }

  /**
   * Resolves one exact operation credential to the whole digest-free
   * authorization lifecycle. Every observed row returns typed data: expiry,
   * exhaustion, retirement, and an unavailable authority, method, or capability
   * are lifecycle states, not failures. Corrupt rows, columns disagreeing with
   * their record, and broken foreign-key identity still throw.
   */
  readExactWalletSessionStatusByOperationCredential(input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
  }): Promise<ExactWalletSessionStatusV2> {
    return sessions.readExactWalletSessionStatusByOperationCredential(this.context, input);
  }

  /**
   * The exact status with the authority and auth method it was judged
   * against, all from the one joined read.
   */
  readExactWalletSessionStatusSnapshotByOperationCredential(input: {
    readonly tenantId: WalletSessionAuthorizationV2['tenantId'];
    readonly tokenHash: import('@shared/utils/canonicalPrimitives').DigestB64u;
    readonly nowMs: number;
  }): Promise<ExactWalletSessionStatusSnapshotV2> {
    return sessions.readExactWalletSessionStatusSnapshotByOperationCredential(this.context, input);
  }

  readAuthorizedOperation(input: {
    readonly tenantId: TenantId;
    readonly operationFingerprintDigest: CapabilityOperationFingerprintDigest;
  }): Promise<AuthorizedOperation | null> {
    return operations.readAuthorizedOperation(this.context, input);
  }

  readAuthorizedOperationById(input: {
    readonly tenantId: TenantId;
    readonly authorizedOperationId: AuthorizedOperationId;
  }): Promise<AuthorizedOperation | null> {
    return operations.readAuthorizedOperationById(this.context, input);
  }

  readPinnedOwnerWalletScope(input: {
    readonly operation: AuthorizedOperation;
    readonly walletId: WalletId;
  }): Promise<PinnedOwnerWalletScope> {
    return operations.readPinnedOwnerWalletScope(this.context, input);
  }

  /**
   * The admission `admitAuthorizedOperation` would make, prepared for a batch
   * another store owns, after the same reads. It admits no ECDSA material:
   * that admission is conditional on the signer row, not a plain insert.
   */
  prepareAuthorizedOperationAdmission(input: {
    readonly operation: AuthorizedOperationInput;
  }): Promise<PreparedAuthorizedOperationAdmission> {
    return operations.prepareAuthorizedOperationAdmission(this.context, input);
  }

  classifyAuthorizedOperationAdmissionFailure(
    error: unknown,
  ): AuthorizedOperationAdmissionRejection | null {
    return operations.classifyAuthorizedOperationAdmissionFailure(error);
  }

  admitAuthorizedOperation(input: {
    readonly operation: AuthorizedOperationInput;
    readonly material?: AuthorizedOperationMaterialScope;
  }): Promise<AuthorizedOperationAdmissionResult> {
    return operations.admitAuthorizedOperation(this.context, input);
  }

  resolveEcdsaWalletSessionOperation(
    input: EcdsaWalletSessionAdmissionInput,
  ): Promise<EcdsaWalletSessionResolutionResult> {
    return operations.resolveEcdsaWalletSessionOperation(this.context, input);
  }

  /**
   * The stored operation answers for itself: its own grant must still be
   * active, as when a finalize request admitted it again.
   */
  resolveEd25519WalletSessionOperation(
    input: Ed25519WalletSessionResolutionInput,
  ): Promise<Ed25519WalletSessionResolutionResult> {
    return operations.resolveEd25519WalletSessionOperation(this.context, input);
  }

  admitEcdsaWalletSessionOperation(
    input: EcdsaWalletSessionAdmissionInput,
  ): Promise<EcdsaWalletSessionAdmissionResult> {
    return operations.admitEcdsaWalletSessionOperation(this.context, input);
  }

  admitEd25519WalletSessionOperation(
    input: Ed25519WalletSessionAdmissionInput,
  ): Promise<Ed25519WalletSessionAdmissionResult> {
    return operations.admitEd25519WalletSessionOperation(this.context, input);
  }

  completeAuthorizedOperation(input: {
    readonly operation: AuthorizedOperation;
    readonly result: CompletedCapabilityOperationResult;
    readonly response: AuthorizedOperationReplayResponse;
    readonly completedAtMs: number;
  }): Promise<AuthorizedOperation> {
    return operations.completeAuthorizedOperation(this.context, input);
  }
}

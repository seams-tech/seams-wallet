import { linkedDeviceBootstrapFailure } from './linkedDeviceBootstrap';
import type { DelegatedWalletAuthorityV1 } from '@shared/authorization/delegatedAuthority';
import type {
  LinkPrecommitFailureV1,
  LinkedDeviceApprovalV1,
  LinkedDeviceSessionClaimV1,
  LinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1,
  QrLinkedDeviceSessionPayloadV5,
} from '@shared/device-linking/contracts';
import {
  computeLinkedDeviceApprovalDigestV1,
  computeLinkedDeviceSessionClaimDigestV1,
} from '@shared/device-linking/digests';
import { parseLinkedDeviceApprovalV1 } from '@shared/device-linking/parsers';
import { parseLinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1 } from '@shared/device-linking/sourceContribution';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseWalletAuthorityId,
  type WalletAuthorityId,
  type WalletId,
} from '@shared/utils/domainIds';
import type {
  WalletSessionAuthorizationId,
  WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import {
  parseLinkDeviceSessionId,
  type LinkedDeviceEnrollmentId,
  type LinkedDeviceId,
  type LinkDeviceSessionId,
} from '@shared/signing-lanes/ids';
import type { ExactAdministeredSignerManifestV1 } from '@shared/device-linking/delegatedActivationPlan';
import {
  activeStateV1,
  approvalTranscriptMatchesDigest,
  authorityPendingStateV1,
  awaitingSourceContributionDeadlineMsV1,
  awaitingSourceContributionStateV1,
  awaitingTargetDeadlineMsV1,
  awaitingTargetFactorStateV1,
  buildUnclaimedSessionRecordV1,
  claimedStateV1,
  claimTranscriptMatchesDigest,
  conflictResult,
  integrityResult,
  invalidStateResult,
  isPrecommitState,
  linkedDeviceEmailOtpChallengesEqualV1,
  linkedDevicePrecommitFailuresEqualV1,
  linkedDeviceQrPayloadsEqualV1,
  type LinkedDeviceSessionMutationResultV1,
  type LinkedDeviceSessionRecordV1,
  type LinkedDeviceSourceKeyManifestDigestsV1,
  parseEmailOtpChallengeV1,
  parseId,
  parseQrLinkedDeviceSessionPayloadV1,
  provisioningStateV1,
  replaceSessionRecordV1,
  requireDigest,
  requireTimestamp,
  sessionExpiryMsV1,
  sourceContributionTranscriptMatchesDigest,
} from './linkedDeviceSessionRecord';
import {
  validateApprovalMatchesSession,
  validateLinkedDeviceRequestedAuthorityV1,
  validateSourceContributionApprovalMatchesSession,
  validateSourceContributionPreparationMatchesApproval,
} from './linkedDeviceSessionApproval';

type LinkedDeviceClaimV1 = LinkedDeviceSessionClaimV1;

export type {
  LinkSessionStateV1,
  QrLinkedDeviceSessionPayloadV5,
} from '@shared/device-linking/contracts';

export type LinkedDeviceSessionListCursorV1 = {
  readonly updatedAtMs: number;
  readonly linkSessionId: LinkDeviceSessionId;
};

export type LinkedDeviceSessionListPageV1 = {
  readonly records: readonly LinkedDeviceSessionRecordV1[];
  readonly nextCursor: LinkedDeviceSessionListCursorV1 | null;
};

type LinkedDeviceSessionClaimIdentityV1 = {
  readonly walletId: WalletId;
  readonly enrollmentId: LinkedDeviceEnrollmentId;
  readonly deviceId: LinkedDeviceId;
  readonly claimExpiresAtMs: number;
};

type LinkedDeviceOwnerAuthorizationDeniedV1 = {
  readonly kind: 'denied';
  readonly code: 'unauthorized' | 'expired' | 'invalid';
  readonly message: string;
};

export type LinkedDeviceOwnerAuthorizationContextV1 = {
  readonly walletId: WalletId;
  readonly walletSessionId: WalletSessionId;
  readonly authorizationId: WalletSessionAuthorizationId;
  readonly expiresAtMs: number;
  readonly permission: DelegatedWalletAuthorityV1;
  readonly curve: 'ed25519' | 'ecdsa';
  readonly keyManifestDigestB64u: DigestB64u;
};

export type LinkedDeviceOwnerAuthorizationPortV1 = {
  authorizeOwnerClaimV1(input: {
    readonly payload: QrLinkedDeviceSessionPayloadV5;
    readonly requestedAtMs: number;
    readonly owner: LinkedDeviceOwnerAuthorizationContextV1;
  }): Promise<
    | { readonly kind: 'authorized'; readonly identity: LinkedDeviceSessionClaimIdentityV1 }
    | LinkedDeviceOwnerAuthorizationDeniedV1
  >;
  authorizeOwnerApprovalV1(input: {
    readonly session: LinkedDeviceSessionRecordV1;
    readonly approval: LinkedDeviceApprovalV1;
    readonly requestedAtMs: number;
    readonly owner: LinkedDeviceOwnerAuthorizationContextV1;
  }): Promise<
    | {
        readonly kind: 'authorized';
        readonly sourceSignerManifest: ExactAdministeredSignerManifestV1;
        readonly sourceKeyManifestDigestsB64u: LinkedDeviceSourceKeyManifestDigestsV1;
        readonly sourceAuthorityDigestB64u: DigestB64u;
      }
    | LinkedDeviceOwnerAuthorizationDeniedV1
  >;
};

export type LinkedDeviceSessionStoreV1 = {
  createUnclaimedSessionV1(
    record: LinkedDeviceSessionRecordV1,
  ): Promise<LinkedDeviceSessionMutationResultV1>;
  getSessionV1(linkSessionId: LinkDeviceSessionId): Promise<LinkedDeviceSessionRecordV1 | null>;
  listSessionsForWalletV1(input: {
    readonly walletId: WalletId;
    readonly limit: number;
    readonly cursor: LinkedDeviceSessionListCursorV1 | null;
  }): Promise<LinkedDeviceSessionListPageV1>;
  claimSessionV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly expectedRevision: number;
    readonly claim: LinkedDeviceClaimV1;
    readonly claimDigestB64u: DigestB64u;
    readonly nextRecord: LinkedDeviceSessionRecordV1;
    readonly nowMs: number;
  }): Promise<LinkedDeviceSessionMutationResultV1>;
  recordOwnerApprovalV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly expectedRevision: number;
    readonly approval: LinkedDeviceApprovalV1;
    readonly approvalDigestB64u: DigestB64u;
    readonly nextRecord: LinkedDeviceSessionRecordV1;
    readonly nowMs: number;
  }): Promise<LinkedDeviceSessionMutationResultV1>;
  recordTargetCredentialV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly expectedRevision: number;
    readonly nextRecord: LinkedDeviceSessionRecordV1;
    readonly nowMs: number;
  }): Promise<LinkedDeviceSessionMutationResultV1>;
  recordSourceContributionV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly expectedRevision: number;
    readonly approval: LinkedDeviceApprovalV1;
    readonly approvalDigestB64u: DigestB64u;
    readonly nextRecord: LinkedDeviceSessionRecordV1;
    readonly nowMs: number;
  }): Promise<LinkedDeviceSessionMutationResultV1>;
  recordEmailOtpChallengeStateV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly expectedRevision: number;
    readonly nextRecord: LinkedDeviceSessionRecordV1;
    readonly nowMs: number;
  }): Promise<LinkedDeviceSessionMutationResultV1>;
  markAuthorityPendingLocalInstallV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly expectedRevision: number;
    readonly authorityId: WalletAuthorityId;
    readonly packageSetDigestB64u: DigestB64u;
    readonly nextRecord: LinkedDeviceSessionRecordV1;
    readonly nowMs: number;
  }): Promise<LinkedDeviceSessionMutationResultV1>;
  activateSessionV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly expectedRevision: number;
    readonly authorityId: WalletAuthorityId;
    readonly packageSetDigestB64u: DigestB64u;
    readonly activatedAtMs: number;
    readonly nextRecord: LinkedDeviceSessionRecordV1;
    readonly nowMs: number;
  }): Promise<LinkedDeviceSessionMutationResultV1>;
  failBeforeCommitV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly expectedRevision: number;
    readonly nextRecord: LinkedDeviceSessionRecordV1;
    readonly nowMs: number;
  }): Promise<LinkedDeviceSessionMutationResultV1>;
  cancelSessionV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly expectedRevision: number;
    readonly nextRecord: LinkedDeviceSessionRecordV1;
    readonly nowMs: number;
  }): Promise<LinkedDeviceSessionMutationResultV1>;
  expireSessionV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly expectedRevision: number;
    readonly nextRecord: LinkedDeviceSessionRecordV1;
    readonly nowMs: number;
  }): Promise<LinkedDeviceSessionMutationResultV1>;
  deleteActiveSessionV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly expectedRevision: number;
    readonly authorityId: WalletAuthorityId;
    readonly packageSetDigestB64u: DigestB64u;
    readonly nowMs: number;
  }): Promise<LinkedDeviceSessionMutationResultV1>;
};

type LinkedDeviceSessionFailureV1 =
  | {
      readonly outcome: 'home_conflict' | 'home_unavailable';
      readonly message: string;
      readonly record?: never;
    }
  | { readonly outcome: 'invalid_input'; readonly message: string };

export type LinkedDeviceSessionServiceResultV1 =
  | LinkedDeviceSessionMutationResultV1
  | LinkedDeviceSessionFailureV1
  | { readonly outcome: 'unauthorized'; readonly code: string; readonly message: string };

type LinkedDeviceTargetCredentialMutationResultV1 =
  | LinkedDeviceSessionMutationResultV1
  | LinkedDeviceSessionFailureV1;

type LinkedDeviceSessionCreateInputV1 = {
  readonly payload: QrLinkedDeviceSessionPayloadV5;
  readonly nowMs: number;
};

type LinkedDeviceSessionClaimInputV1 = {
  readonly payload: QrLinkedDeviceSessionPayloadV5;
  readonly nowMs: number;
  readonly owner: LinkedDeviceOwnerAuthorizationContextV1;
};

type LinkedDeviceSessionApprovalInputV1 = {
  readonly approval: LinkedDeviceApprovalV1;
  readonly nowMs: number;
  readonly owner: LinkedDeviceOwnerAuthorizationContextV1;
};

type LinkedDeviceSessionCancelInputV1 = {
  readonly linkSessionId: LinkDeviceSessionId;
  readonly expectedRevision: number;
  readonly nowMs: number;
};

type LinkedDeviceSessionExpireInputV1 = {
  readonly linkSessionId: LinkDeviceSessionId;
  readonly expectedRevision: number;
  readonly nowMs: number;
};

type LinkedDeviceSessionDeleteInputV1 = {
  readonly linkSessionId: LinkDeviceSessionId;
  readonly expectedRevision: number;
  readonly authorityId: WalletAuthorityId;
  readonly packageSetDigestB64u: DigestB64u;
  readonly nowMs: number;
};

type LinkedDeviceSessionTargetCredentialInputV1 = {
  readonly linkSessionId: LinkDeviceSessionId;
  readonly expectedRevision: number;
  readonly sourceContributionPreparation: LinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1;
  readonly nowMs: number;
};

type LinkedDeviceSessionSourceContributionInputV1 = {
  readonly approval: LinkedDeviceApprovalV1;
  readonly nowMs: number;
  readonly owner: LinkedDeviceOwnerAuthorizationContextV1;
};

type LinkedDeviceSessionEmailOtpChallengeInputV1 = {
  readonly linkSessionId: LinkDeviceSessionId;
  readonly expectedRevision: number;
  readonly challenge: {
    readonly challengeId: string;
    readonly workerEphemeralPublicKey65B64u: string;
    readonly maskedEmailHint: string;
    readonly expiresAtMs: number;
    readonly resendAvailableAtMs: number;
  };
  readonly nowMs: number;
};

type LinkedDeviceSessionCommitInputV1 = {
  readonly linkSessionId: LinkDeviceSessionId;
  readonly expectedRevision: number;
  readonly authorityId: WalletAuthorityId;
  readonly packageSetDigestB64u: DigestB64u;
  readonly nowMs: number;
};

type LinkedDeviceSessionActivationInputV1 = {
  readonly linkSessionId: LinkDeviceSessionId;
  readonly expectedRevision: number;
  readonly authorityId: WalletAuthorityId;
  readonly packageSetDigestB64u: DigestB64u;
  readonly activatedAtMs: number;
  readonly nowMs: number;
};

export class LinkedDeviceSessionServiceV1 {
  private readonly store: LinkedDeviceSessionStoreV1;
  private readonly authorization: LinkedDeviceOwnerAuthorizationPortV1;

  constructor(input: {
    readonly store: LinkedDeviceSessionStoreV1;
    readonly authorization: LinkedDeviceOwnerAuthorizationPortV1;
  }) {
    this.store = input.store;
    this.authorization = input.authorization;
  }

  async createUnclaimedSessionV1(
    input: LinkedDeviceSessionCreateInputV1,
  ): Promise<LinkedDeviceSessionServiceResultV1> {
    try {
      const payload = parseQrLinkedDeviceSessionPayloadV1(input.payload);
      const nowMs = requireTimestamp(input.nowMs, 'nowMs');
      if (payload.expiresAtMs <= nowMs) {
        return { outcome: 'invalid_input', message: 'link session expiry must be in the future' };
      }
      return await this.store.createUnclaimedSessionV1(
        buildUnclaimedSessionRecordV1(payload, nowMs),
      );
    } catch (error: unknown) {
      return sessionFailureResult(error);
    }
  }

  async claimSessionV1(
    input: LinkedDeviceSessionClaimInputV1,
  ): Promise<LinkedDeviceSessionServiceResultV1> {
    try {
      const payload = parseQrLinkedDeviceSessionPayloadV1(input.payload);
      const nowMs = requireTimestamp(input.nowMs, 'nowMs');
      const existing = await this.store.getSessionV1(payload.linkSessionId);
      if (!existing) return conflictResult(0, null);
      if (!linkedDeviceQrPayloadsEqualV1(existing.qrPayload, payload))
        return conflictResult(existing.revision, existing);
      if (existing.state.state === 'displaying_qr' && nowMs >= payload.expiresAtMs) {
        return { outcome: 'expired', record: existing };
      }
      const requestedAuthorityError = validateLinkedDeviceRequestedAuthorityV1(
        input.owner.permission,
        payload.requestedPermission,
      );
      if (requestedAuthorityError)
        return unauthorizedResult('unauthorized', requestedAuthorityError);
      const authorization = await this.authorization.authorizeOwnerClaimV1({
        payload,
        requestedAtMs: nowMs,
        owner: input.owner,
      });
      if (authorization.kind === 'denied') {
        return unauthorizedResult(authorization.code, authorization.message);
      }
      const priorClaim = existing.claimTranscript?.value;
      const claim = buildClaimV1(
        payload,
        authorization.identity,
        priorClaim?.sessionRevision ?? existing.revision + 1,
        priorClaim?.claimedAtMs ?? nowMs,
      );
      const claimDigestB64u = await digestTranscriptV1('claim', claim);
      if (claimTranscriptMatchesDigest(existing, claimDigestB64u))
        return { outcome: 'replayed', record: existing };
      if (existing.claimTranscript) return conflictResult(existing.revision, existing);
      const nextRecord = replaceSessionRecordV1(existing, {
        state: claimedStateV1(existing, claim),
        claimTranscript: { digestB64u: claimDigestB64u, value: claim },
        revision: existing.revision + 1,
        updatedAtMs: nowMs,
      });
      return await this.store.claimSessionV1({
        linkSessionId: payload.linkSessionId,
        expectedRevision: existing.revision,
        claim,
        claimDigestB64u,
        nextRecord,
        nowMs,
      });
    } catch (error: unknown) {
      return sessionFailureResult(error);
    }
  }

  async recordOwnerApprovalV1(
    input: LinkedDeviceSessionApprovalInputV1,
  ): Promise<LinkedDeviceSessionServiceResultV1> {
    try {
      const approval = parseLinkedDeviceApprovalV1(input.approval);
      const nowMs = requireTimestamp(input.nowMs, 'nowMs');
      const existing = await this.store.getSessionV1(approval.linkSessionId);
      if (!existing) return conflictResult(0, null);
      const approvalDigestB64u = await digestTranscriptV1('approval', approval);
      if (approvalTranscriptMatchesDigest(existing, approvalDigestB64u)) {
        return { outcome: 'replayed', record: existing };
      }
      if (existing.approvalTranscript) return conflictResult(existing.revision, existing);
      if (
        existing.state.state === 'claimed' &&
        existing.claimTranscript &&
        existing.claimTranscript.value.claimExpiresAtMs <= nowMs
      ) {
        return { outcome: 'expired', record: existing };
      }
      validateApprovalMatchesSession(existing, approval, nowMs);
      const requestedAuthorityError = validateLinkedDeviceRequestedAuthorityV1(
        input.owner.permission,
        approval.permission,
      );
      if (requestedAuthorityError)
        return unauthorizedResult('unauthorized', requestedAuthorityError);
      const authorization = await this.authorization.authorizeOwnerApprovalV1({
        session: existing,
        approval,
        requestedAtMs: nowMs,
        owner: input.owner,
      });
      if (authorization.kind === 'denied') {
        return unauthorizedResult(authorization.code, authorization.message);
      }
      const targetFactor = approval.targetFactor;
      const nextRecord = replaceSessionRecordV1(existing, {
        state: awaitingTargetFactorStateV1(existing),
        targetFactor,
        approvalTranscript: {
          digestB64u: approvalDigestB64u,
          value: approval,
          sourceSignerManifest: authorization.sourceSignerManifest,
          sourceKeyManifestDigestsB64u: authorization.sourceKeyManifestDigestsB64u,
          sourceAuthorityDigestB64u: authorization.sourceAuthorityDigestB64u,
        },
        revision: existing.revision + 1,
        updatedAtMs: nowMs,
      });
      return await this.store.recordOwnerApprovalV1({
        linkSessionId: approval.linkSessionId,
        expectedRevision: existing.revision,
        approval,
        approvalDigestB64u,
        nextRecord,
        nowMs,
      });
    } catch (error: unknown) {
      return sessionFailureResult(error);
    }
  }

  async recordTargetCredentialV1(
    input: LinkedDeviceSessionTargetCredentialInputV1,
  ): Promise<LinkedDeviceTargetCredentialMutationResultV1> {
    try {
      const nowMs = requireTimestamp(input.nowMs, 'nowMs');
      const existing = await this.requireSession(input.linkSessionId);
      if (
        existing.state.state === 'awaiting_source_contribution' ||
        existing.state.state === 'provisioning'
      ) {
        return { outcome: 'replayed', record: existing };
      }
      if (existing.state.state !== 'awaiting_target_factor') return invalidStateResult(existing);
      if (nowMs >= awaitingTargetDeadlineMsV1(existing))
        return { outcome: 'expired', record: existing };
      const sourceContributionPreparation =
        parseLinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1(
          input.sourceContributionPreparation,
        );
      const nextRecord = replaceSessionRecordV1(existing, {
        state: awaitingSourceContributionStateV1(existing),
        sourceContributionPreparation,
        revision: existing.revision + 1,
        updatedAtMs: nowMs,
      });
      return await this.store.recordTargetCredentialV1({
        linkSessionId: input.linkSessionId,
        expectedRevision: input.expectedRevision,
        nextRecord,
        nowMs,
      });
    } catch (error: unknown) {
      return sessionFailureResult(error);
    }
  }

  async recordSourceContributionV1(
    input: LinkedDeviceSessionSourceContributionInputV1,
  ): Promise<LinkedDeviceSessionServiceResultV1> {
    try {
      const approval = parseLinkedDeviceApprovalV1(input.approval);
      if (!approval.sourceContribution) {
        return { outcome: 'invalid_input', message: 'source contribution is required' };
      }
      const nowMs = requireTimestamp(input.nowMs, 'nowMs');
      const existing = await this.requireSession(approval.linkSessionId);
      const approvalDigestB64u = await digestTranscriptV1('approval', approval);
      if (sourceContributionTranscriptMatchesDigest(existing, approvalDigestB64u)) {
        return { outcome: 'replayed', record: existing };
      }
      if (existing.state.state !== 'awaiting_source_contribution') {
        return invalidStateResult(existing);
      }
      if (nowMs >= awaitingSourceContributionDeadlineMsV1(existing)) {
        return { outcome: 'expired', record: existing };
      }
      validateSourceContributionApprovalMatchesSession(existing, approval, nowMs);
      validateSourceContributionPreparationMatchesApproval(existing, approval);
      const requestedAuthorityError = validateLinkedDeviceRequestedAuthorityV1(
        input.owner.permission,
        approval.permission,
      );
      if (requestedAuthorityError) {
        return unauthorizedResult('unauthorized', requestedAuthorityError);
      }
      const authorization = await this.authorization.authorizeOwnerApprovalV1({
        session: existing,
        approval,
        requestedAtMs: nowMs,
        owner: input.owner,
      });
      if (authorization.kind === 'denied') {
        return unauthorizedResult(authorization.code, authorization.message);
      }
      const nextRecord = replaceSessionRecordV1(existing, {
        state: provisioningStateV1(existing),
        sourceContributionTranscript: {
          digestB64u: approvalDigestB64u,
          value: approval,
          sourceSignerManifest: authorization.sourceSignerManifest,
          sourceKeyManifestDigestsB64u: authorization.sourceKeyManifestDigestsB64u,
          sourceAuthorityDigestB64u: authorization.sourceAuthorityDigestB64u,
        },
        revision: existing.revision + 1,
        updatedAtMs: nowMs,
      });
      return await this.store.recordSourceContributionV1({
        linkSessionId: approval.linkSessionId,
        expectedRevision: existing.revision,
        approval,
        approvalDigestB64u,
        nextRecord,
        nowMs,
      });
    } catch (error: unknown) {
      return sessionFailureResult(error);
    }
  }

  async recordEmailOtpChallengeStateV1(
    input: LinkedDeviceSessionEmailOtpChallengeInputV1,
  ): Promise<LinkedDeviceSessionServiceResultV1> {
    try {
      const nowMs = requireTimestamp(input.nowMs, 'nowMs');
      const existing = await this.requireSession(input.linkSessionId);
      if (
        existing.state.state !== 'awaiting_target_factor' ||
        existing.targetFactor?.kind !== 'email_otp'
      ) {
        return invalidStateResult(existing);
      }
      if (nowMs >= awaitingTargetDeadlineMsV1(existing))
        return { outcome: 'expired', record: existing };
      const challenge = parseEmailOtpChallengeV1(input.challenge);
      if (
        existing.emailOtpChallenge?.state === 'sent' &&
        linkedDeviceEmailOtpChallengesEqualV1(existing.emailOtpChallenge, challenge)
      ) {
        return { outcome: 'replayed', record: existing };
      }
      const nextRecord = replaceSessionRecordV1(existing, {
        emailOtpChallenge: challenge,
        revision: existing.revision + 1,
        updatedAtMs: nowMs,
      });
      return await this.store.recordEmailOtpChallengeStateV1({
        linkSessionId: input.linkSessionId,
        expectedRevision: input.expectedRevision,
        nextRecord,
        nowMs,
      });
    } catch (error: unknown) {
      return sessionFailureResult(error);
    }
  }

  async markAuthorityPendingLocalInstallV1(
    input: LinkedDeviceSessionCommitInputV1,
  ): Promise<LinkedDeviceSessionServiceResultV1> {
    try {
      const authorityId = parseId(input.authorityId, parseWalletAuthorityId, 'authorityId');
      const packageSetDigestB64u = requireDigest(
        input.packageSetDigestB64u,
        'packageSetDigestB64u',
      );
      const nowMs = requireTimestamp(input.nowMs, 'nowMs');
      const existing = await this.requireSession(input.linkSessionId);
      const retry = pendingRetryResult(existing, authorityId, packageSetDigestB64u);
      if (retry) return retry;
      if (existing.state.state !== 'provisioning') return invalidStateResult(existing);
      const nextRecord = replaceSessionRecordV1(existing, {
        state: authorityPendingStateV1(existing, authorityId, packageSetDigestB64u),
        authorityId,
        packageSetDigestB64u,
        revision: existing.revision + 1,
        updatedAtMs: nowMs,
      });
      return await this.store.markAuthorityPendingLocalInstallV1({
        linkSessionId: input.linkSessionId,
        expectedRevision: input.expectedRevision,
        authorityId,
        packageSetDigestB64u,
        nextRecord,
        nowMs,
      });
    } catch (error: unknown) {
      return sessionFailureResult(error);
    }
  }

  async activateSessionV1(
    input: LinkedDeviceSessionActivationInputV1,
  ): Promise<LinkedDeviceSessionServiceResultV1> {
    try {
      const authorityId = parseId(input.authorityId, parseWalletAuthorityId, 'authorityId');
      const packageSetDigestB64u = requireDigest(
        input.packageSetDigestB64u,
        'packageSetDigestB64u',
      );
      const activatedAtMs = requireTimestamp(input.activatedAtMs, 'activatedAtMs');
      const nowMs = requireTimestamp(input.nowMs, 'nowMs');
      if (activatedAtMs > nowMs) {
        return { outcome: 'invalid_input', message: 'activatedAtMs cannot be in the future' };
      }
      const existing = await this.requireSession(input.linkSessionId);
      const retry = activeRetryResult(existing, authorityId, packageSetDigestB64u);
      if (retry) return retry;
      if (existing.state.state !== 'authority_pending_local_install')
        return invalidStateResult(existing);
      if (
        existing.state.authorityId !== authorityId ||
        existing.state.packageSetDigestB64u !== packageSetDigestB64u
      ) {
        return integrityResult(existing, 'authority_id_mismatch');
      }
      const nextRecord = replaceSessionRecordV1(existing, {
        state: activeStateV1(existing, activatedAtMs),
        revision: existing.revision + 1,
        updatedAtMs: nowMs,
      });
      return await this.store.activateSessionV1({
        linkSessionId: input.linkSessionId,
        expectedRevision: input.expectedRevision,
        authorityId,
        packageSetDigestB64u,
        activatedAtMs,
        nextRecord,
        nowMs,
      });
    } catch (error: unknown) {
      return sessionFailureResult(error);
    }
  }

  async failBeforeCommitV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly expectedRevision: number;
    readonly error: LinkPrecommitFailureV1;
    readonly nowMs: number;
  }): Promise<LinkedDeviceSessionServiceResultV1> {
    try {
      const nowMs = requireTimestamp(input.nowMs, 'nowMs');
      const error = input.error;
      const existing = await this.requireSession(input.linkSessionId);
      if (existing.state.state === 'failed_before_commit') {
        return linkedDevicePrecommitFailuresEqualV1(existing.state.error, error)
          ? { outcome: 'replayed', record: existing }
          : conflictResult(existing.revision, existing);
      }
      if (!isPrecommitState(existing.state)) return invalidStateResult(existing);
      const nextRecord = replaceSessionRecordV1(existing, {
        state: { state: 'failed_before_commit', error },
        revision: existing.revision + 1,
        updatedAtMs: nowMs,
      });
      return await this.store.failBeforeCommitV1({
        linkSessionId: input.linkSessionId,
        expectedRevision: input.expectedRevision,
        nextRecord,
        nowMs,
      });
    } catch (error: unknown) {
      return sessionFailureResult(error);
    }
  }

  async cancelSessionV1(
    input: LinkedDeviceSessionCancelInputV1,
  ): Promise<LinkedDeviceSessionServiceResultV1> {
    try {
      const nowMs = requireTimestamp(input.nowMs, 'nowMs');
      const existing = await this.requireSession(input.linkSessionId);
      if (existing.state.state === 'cancelled') return { outcome: 'replayed', record: existing };
      if (!isPrecommitState(existing.state)) return invalidStateResult(existing);
      const nextRecord = replaceSessionRecordV1(existing, {
        state: { state: 'cancelled', cancelledAtMs: nowMs },
        revision: existing.revision + 1,
        updatedAtMs: nowMs,
      });
      return await this.store.cancelSessionV1({
        linkSessionId: input.linkSessionId,
        expectedRevision: input.expectedRevision,
        nextRecord,
        nowMs,
      });
    } catch (error: unknown) {
      return sessionFailureResult(error);
    }
  }

  async expireSessionV1(
    input: LinkedDeviceSessionExpireInputV1,
  ): Promise<LinkedDeviceSessionServiceResultV1> {
    try {
      const nowMs = requireTimestamp(input.nowMs, 'nowMs');
      const existing = await this.requireSession(input.linkSessionId);
      if (existing.state.state === 'expired') return { outcome: 'replayed', record: existing };
      if (!isPrecommitState(existing.state)) return invalidStateResult(existing);
      if (nowMs < sessionExpiryMsV1(existing)) {
        return { outcome: 'invalid_input', message: 'link session has not expired' };
      }
      const nextRecord = replaceSessionRecordV1(existing, {
        state: { state: 'expired', expiredAtMs: nowMs },
        revision: existing.revision + 1,
        updatedAtMs: nowMs,
      });
      return await this.store.expireSessionV1({
        linkSessionId: input.linkSessionId,
        expectedRevision: input.expectedRevision,
        nextRecord,
        nowMs,
      });
    } catch (error: unknown) {
      return sessionFailureResult(error);
    }
  }

  async deleteActiveSessionV1(
    input: LinkedDeviceSessionDeleteInputV1,
  ): Promise<LinkedDeviceSessionServiceResultV1> {
    try {
      const authorityId = parseId(input.authorityId, parseWalletAuthorityId, 'authorityId');
      const packageSetDigestB64u = requireDigest(
        input.packageSetDigestB64u,
        'packageSetDigestB64u',
      );
      const nowMs = requireTimestamp(input.nowMs, 'nowMs');
      const existing = await this.store.getSessionV1(input.linkSessionId);
      if (!existing) return { outcome: 'deleted', record: null };
      if (existing.state.state !== 'active') return invalidStateResult(existing);
      if (existing.state.authorityId !== authorityId)
        return integrityResult(existing, 'authority_id_mismatch');
      if (existing.packageSetDigestB64u !== packageSetDigestB64u) {
        return integrityResult(existing, 'package_set_digest_mismatch');
      }
      return await this.store.deleteActiveSessionV1({
        linkSessionId: input.linkSessionId,
        expectedRevision: input.expectedRevision,
        authorityId,
        packageSetDigestB64u,
        nowMs,
      });
    } catch (error: unknown) {
      return sessionFailureResult(error);
    }
  }

  async getSessionV1(
    input:
      | { readonly linkSessionId: LinkDeviceSessionId; readonly nowMs: number }
      | LinkDeviceSessionId,
  ): Promise<LinkedDeviceSessionRecordV1 | null> {
    const normalized = normalizeSessionReadInput(input);
    const existing = await this.store.getSessionV1(normalized.linkSessionId);
    if (!existing || !isPrecommitState(existing.state)) return existing;
    if (normalized.nowMs < sessionExpiryMsV1(existing)) return existing;
    const expired = await this.expireSessionV1({
      linkSessionId: existing.linkSessionId,
      expectedRevision: existing.revision,
      nowMs: normalized.nowMs,
    });
    return 'record' in expired && expired.record !== undefined ? expired.record : existing;
  }

  async listSessionsForWalletV1(input: {
    readonly walletId: WalletId;
    readonly nowMs: number;
    readonly limit: number;
    readonly cursor: LinkedDeviceSessionListCursorV1 | null;
  }): Promise<LinkedDeviceSessionListPageV1> {
    const page = await this.store.listSessionsForWalletV1({
      walletId: input.walletId,
      limit: input.limit,
      cursor: input.cursor,
    });
    const records: LinkedDeviceSessionRecordV1[] = [];
    for (const record of page.records) {
      if (!isPrecommitState(record.state) || input.nowMs < sessionExpiryMsV1(record)) {
        records.push(record);
        continue;
      }
      const expired = await this.expireSessionV1({
        linkSessionId: record.linkSessionId,
        expectedRevision: record.revision,
        nowMs: input.nowMs,
      });
      records.push('record' in expired ? (expired.record ?? record) : record);
    }
    return { records, nextCursor: page.nextCursor };
  }

  private async requireSession(
    linkSessionId: LinkDeviceSessionId,
  ): Promise<LinkedDeviceSessionRecordV1> {
    const existing = await this.store.getSessionV1(linkSessionId);
    if (!existing) throw new Error(`unknown link session: ${String(linkSessionId)}`);
    return existing;
  }
}

function digestTranscriptV1(kind: 'claim', value: LinkedDeviceClaimV1): Promise<DigestB64u>;
function digestTranscriptV1(kind: 'approval', value: LinkedDeviceApprovalV1): Promise<DigestB64u>;
async function digestTranscriptV1(
  kind: 'claim' | 'approval',
  value: LinkedDeviceClaimV1 | LinkedDeviceApprovalV1,
): Promise<DigestB64u> {
  if (kind === 'claim') {
    if (!isLinkedDeviceClaimV1(value)) throw new Error('claim transcript value is invalid');
    return computeLinkedDeviceSessionClaimDigestV1(value);
  }
  if (!isLinkedDeviceApprovalV1(value)) throw new Error('approval transcript value is invalid');
  return computeLinkedDeviceApprovalDigestV1(value);
}

function pendingRetryResult(
  record: LinkedDeviceSessionRecordV1,
  authorityId: WalletAuthorityId,
  packageSetDigestB64u: DigestB64u,
): LinkedDeviceSessionMutationResultV1 | null {
  if (record.state.state !== 'authority_pending_local_install' && record.state.state !== 'active')
    return null;
  if (record.state.authorityId !== authorityId)
    return integrityResult(record, 'authority_id_mismatch');
  if (record.packageSetDigestB64u !== packageSetDigestB64u)
    return integrityResult(record, 'package_set_digest_mismatch');
  return { outcome: 'replayed', record };
}

function activeRetryResult(
  record: LinkedDeviceSessionRecordV1,
  authorityId: WalletAuthorityId,
  packageSetDigestB64u: DigestB64u,
): LinkedDeviceSessionMutationResultV1 | null {
  if (record.state.state === 'authority_pending_local_install') {
    if (record.state.authorityId !== authorityId)
      return integrityResult(record, 'authority_id_mismatch');
    if (record.state.packageSetDigestB64u !== packageSetDigestB64u)
      return integrityResult(record, 'package_set_digest_mismatch');
    return null;
  }
  if (record.state.state !== 'active') return null;
  if (record.state.authorityId !== authorityId)
    return integrityResult(record, 'authority_id_mismatch');
  if (record.packageSetDigestB64u !== packageSetDigestB64u)
    return integrityResult(record, 'package_set_digest_mismatch');
  return { outcome: 'replayed', record };
}

function isLinkedDeviceClaimV1(
  value: LinkedDeviceClaimV1 | LinkedDeviceApprovalV1,
): value is LinkedDeviceClaimV1 {
  return value.kind === 'linked_device_session_claim_v1';
}

function isLinkedDeviceApprovalV1(
  value: LinkedDeviceClaimV1 | LinkedDeviceApprovalV1,
): value is LinkedDeviceApprovalV1 {
  return value.kind === 'linked_device_approval_v1';
}

function buildClaimV1(
  payload: QrLinkedDeviceSessionPayloadV5,
  identity: LinkedDeviceSessionClaimIdentityV1,
  sessionRevision: number,
  claimedAtMs: number,
): LinkedDeviceClaimV1 {
  if (identity.claimExpiresAtMs <= claimedAtMs || identity.claimExpiresAtMs > payload.expiresAtMs)
    throw new Error('claim expiry is outside the link session lifetime');
  return {
    kind: 'linked_device_session_claim_v1',
    linkSessionId: payload.linkSessionId,
    walletId: identity.walletId,
    enrollmentId: identity.enrollmentId,
    deviceId: identity.deviceId,
    devicePublicKeyB64u: payload.devicePublicKeyB64u,
    targetFactor: payload.targetFactor,
    sessionRevision,
    claimedAtMs,
    claimExpiresAtMs: identity.claimExpiresAtMs,
  };
}

function normalizeSessionReadInput(
  input:
    | { readonly linkSessionId: LinkDeviceSessionId; readonly nowMs: number }
    | LinkDeviceSessionId,
): { readonly linkSessionId: LinkDeviceSessionId; readonly nowMs: number } {
  if (typeof input === 'string')
    return {
      linkSessionId: parseId(input, parseLinkDeviceSessionId, 'linkSessionId'),
      nowMs: Date.now(),
    };
  return {
    linkSessionId: parseId(input.linkSessionId, parseLinkDeviceSessionId, 'linkSessionId'),
    nowMs: requireTimestamp(input.nowMs, 'nowMs'),
  };
}

function sessionFailureResult(error: unknown): LinkedDeviceSessionFailureV1 {
  const failure = linkedDeviceBootstrapFailure(error);
  if (failure)
    return {
      outcome: failure,
      message: 'Linked-device bootstrap authority is unavailable or conflicting',
    };
  return {
    outcome: 'invalid_input',
    message:
      error instanceof Error ? error.message : String(error || 'invalid linked-device input'),
  };
}

function unauthorizedResult(
  code: string,
  message: string,
): { readonly outcome: 'unauthorized'; readonly code: string; readonly message: string } {
  return { outcome: 'unauthorized', code, message };
}

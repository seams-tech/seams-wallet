// The stored linked-device session record: its shape and parser, the per-state builders and
// fact checks, state transitions, expiry, equality checks and the store's mutation results.
import { parseDeviceId, type DeviceId } from '@shared/authorization/capabilityKinds';
import { sameDelegatedWalletAuthorityV1 } from '@shared/authorization/delegatedAuthority';
import type {
  LinkPrecommitFailureV1,
  LinkSessionStateV1,
  LinkedDeviceApprovalV1,
  LinkedDeviceSessionClaimV1 as LinkedDeviceClaimV1,
  LinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1,
  LinkedDeviceApprovedTargetFactorV1,
  QrLinkedDeviceSessionPayloadV5,
} from '@shared/device-linking/contracts';
import { assertNeverLinkSessionStateV1 } from '@shared/device-linking/contracts';
import {
  parseLinkedDeviceApprovalV1 as parseSharedLinkedDeviceApprovalV1,
  parseLinkedDeviceSessionClaimV1 as parseSharedLinkedDeviceSessionClaimV1,
  parseLinkSessionStateV1,
  parseQrLinkedDeviceSessionPayloadV5 as parseSharedQrLinkedDeviceSessionPayloadV5,
} from '@shared/device-linking/parsers';
import { parseLinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1 } from '@shared/device-linking/sourceContribution';
import { parseDigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  hasWhitespaceOrControlCharacters,
  parseVerifiedEmailAddress,
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  type DomainIdParseResult,
  type WalletAuthorityId,
} from '@shared/utils/domainIds';
import { parseLinkDeviceSessionId, type LinkDeviceSessionId } from '@shared/signing-lanes/ids';
import { LINKED_DEVICE_CLOCK_SKEW_TOLERANCE_MS_V1 } from '@shared/device-linking/requestProof';
import {
  parseExactAdministeredSignerManifestV1,
  type ExactAdministeredSignerV1,
  type ExactAdministeredSignerManifestV1,
} from '@shared/device-linking/delegatedActivationPlan';
import { requireRecordCopy } from '@shared/utils/validation';

type LinkedDeviceClaimTranscriptV1 = {
  readonly digestB64u: DigestB64u;
  readonly value: LinkedDeviceClaimV1;
};

export type LinkedDeviceSourceKeyManifestDigestsV1 =
  | {
      readonly ed25519: DigestB64u;
      readonly ecdsa_secp256k1?: never;
    }
  | {
      readonly ed25519?: never;
      readonly ecdsa_secp256k1: DigestB64u;
    }
  | {
      readonly ed25519: DigestB64u;
      readonly ecdsa_secp256k1: DigestB64u;
    };

type LinkedDeviceApprovalTranscriptV1 = {
  readonly digestB64u: DigestB64u;
  readonly value: LinkedDeviceApprovalV1;
  readonly sourceSignerManifest: ExactAdministeredSignerManifestV1;
  readonly sourceKeyManifestDigestsB64u: LinkedDeviceSourceKeyManifestDigestsV1;
  /** Authority digest at approval time; rotation advances it, so use must re-approve. */
  readonly sourceAuthorityDigestB64u: DigestB64u;
};

export function sourceKeyManifestDigestForFamilyV1(
  digests: LinkedDeviceSourceKeyManifestDigestsV1,
  keyFamily: ExactAdministeredSignerV1['keyFamily'],
): DigestB64u | null {
  switch (keyFamily) {
    case 'ed25519':
      return digests.ed25519 ?? null;
    case 'ecdsa_secp256k1':
      return digests.ecdsa_secp256k1 ?? null;
    default:
      return assertNeverSourceKeyFamilyV1(keyFamily);
  }
}

function assertNeverSourceKeyFamilyV1(value: never): never {
  throw new Error(`unsupported source key family: ${String(value)}`);
}

type LinkedDeviceSourceContributionTranscriptV1 = LinkedDeviceApprovalTranscriptV1;

type LinkedDeviceEmailOtpChallengeV1 =
  | { readonly state: 'available'; readonly maskedEmailHint: string }
  | {
      readonly state: 'sent';
      readonly challengeId: string;
      readonly workerEphemeralPublicKey65B64u: string;
      readonly maskedEmailHint: string;
      readonly expiresAtMs: number;
      readonly resendAvailableAtMs: number;
    };

type LinkedDeviceTargetFactorRecordV1 =
  | {
      readonly targetFactor: Extract<
        LinkedDeviceApprovedTargetFactorV1,
        { readonly kind: 'passkey_prf' }
      >;
      readonly emailOtpChallenge?: never;
    }
  | {
      readonly targetFactor: Extract<
        LinkedDeviceApprovedTargetFactorV1,
        { readonly kind: 'email_otp' }
      >;
      readonly emailOtpChallenge?: LinkedDeviceEmailOtpChallengeV1;
    };

type LinkedDeviceSessionRecordBaseV1 = {
  readonly version: 'linked_device_session_v1';
  readonly linkSessionId: LinkDeviceSessionId;
  readonly qrPayload: QrLinkedDeviceSessionPayloadV5;
  readonly revision: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

type LinkedDeviceSessionUnclaimedRecordV1 = LinkedDeviceSessionRecordBaseV1 & {
  readonly state: Extract<LinkSessionStateV1, { readonly state: 'displaying_qr' }>;
  readonly claimTranscript?: never;
  readonly approvalTranscript?: never;
  readonly targetFactor?: never;
  readonly emailOtpChallenge?: never;
  readonly authorityId?: never;
  readonly packageSetDigestB64u?: never;
  readonly sourceContributionPreparation?: never;
  readonly sourceContributionTranscript?: never;
};

type LinkedDeviceSessionClaimedRecordV1 = LinkedDeviceSessionRecordBaseV1 & {
  readonly state: Extract<LinkSessionStateV1, { readonly state: 'claimed' }>;
  readonly claimTranscript: LinkedDeviceClaimTranscriptV1;
  readonly approvalTranscript?: never;
  readonly targetFactor?: never;
  readonly emailOtpChallenge?: never;
  readonly authorityId?: never;
  readonly packageSetDigestB64u?: never;
  readonly sourceContributionPreparation?: never;
  readonly sourceContributionTranscript?: never;
};

type LinkedDeviceSessionApprovedRecordV1 = LinkedDeviceSessionRecordBaseV1 &
  LinkedDeviceTargetFactorRecordV1 & {
    readonly state: Extract<LinkSessionStateV1, { readonly state: 'awaiting_target_factor' }>;
    readonly claimTranscript: LinkedDeviceClaimTranscriptV1;
    readonly approvalTranscript: LinkedDeviceApprovalTranscriptV1;
    readonly authorityId?: never;
    readonly packageSetDigestB64u?: never;
    readonly sourceContributionPreparation?: never;
    readonly sourceContributionTranscript?: never;
  };

type LinkedDeviceSessionSourceContributionRecordV1 = LinkedDeviceSessionRecordBaseV1 &
  LinkedDeviceTargetFactorRecordV1 & {
    readonly state: Extract<LinkSessionStateV1, { readonly state: 'awaiting_source_contribution' }>;
    readonly claimTranscript: LinkedDeviceClaimTranscriptV1;
    readonly approvalTranscript: LinkedDeviceApprovalTranscriptV1;
    readonly sourceContributionPreparation: LinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1;
    readonly sourceContributionTranscript?: never;
    readonly authorityId?: never;
    readonly packageSetDigestB64u?: never;
  };

type LinkedDeviceSessionProvisioningRecordV1 = LinkedDeviceSessionRecordBaseV1 &
  LinkedDeviceTargetFactorRecordV1 & {
    readonly state: Extract<LinkSessionStateV1, { readonly state: 'provisioning' }>;
    readonly claimTranscript: LinkedDeviceClaimTranscriptV1;
    readonly approvalTranscript: LinkedDeviceApprovalTranscriptV1;
    readonly sourceContributionPreparation: LinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1;
    readonly sourceContributionTranscript: LinkedDeviceSourceContributionTranscriptV1;
    readonly authorityId?: never;
    readonly packageSetDigestB64u?: never;
  };

type LinkedDeviceSessionPendingRecordV1 = LinkedDeviceSessionRecordBaseV1 &
  LinkedDeviceTargetFactorRecordV1 & {
    readonly state: Extract<
      LinkSessionStateV1,
      { readonly state: 'authority_pending_local_install' }
    >;
    readonly claimTranscript: LinkedDeviceClaimTranscriptV1;
    readonly approvalTranscript: LinkedDeviceApprovalTranscriptV1;
    readonly sourceContributionPreparation: LinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1;
    readonly sourceContributionTranscript: LinkedDeviceSourceContributionTranscriptV1;
    readonly authorityId: WalletAuthorityId;
    readonly packageSetDigestB64u: DigestB64u;
  };

type LinkedDeviceSessionActiveRecordV1 = LinkedDeviceSessionRecordBaseV1 &
  LinkedDeviceTargetFactorRecordV1 & {
    readonly state: Extract<LinkSessionStateV1, { readonly state: 'active' }>;
    readonly claimTranscript: LinkedDeviceClaimTranscriptV1;
    readonly approvalTranscript: LinkedDeviceApprovalTranscriptV1;
    readonly sourceContributionPreparation: LinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1;
    readonly sourceContributionTranscript: LinkedDeviceSourceContributionTranscriptV1;
    readonly authorityId: WalletAuthorityId;
    readonly packageSetDigestB64u: DigestB64u;
  };

type LinkedDeviceSessionTerminalRecordV1 = LinkedDeviceSessionRecordBaseV1 & {
  readonly state: Extract<
    LinkSessionStateV1,
    { readonly state: 'failed_before_commit' | 'cancelled' | 'expired' }
  >;
  readonly claimTranscript?: LinkedDeviceClaimTranscriptV1;
  readonly approvalTranscript?: LinkedDeviceApprovalTranscriptV1;
  readonly targetFactor?: LinkedDeviceApprovedTargetFactorV1;
  readonly emailOtpChallenge?: LinkedDeviceEmailOtpChallengeV1;
  readonly sourceContributionPreparation?: LinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1;
  readonly sourceContributionTranscript?: LinkedDeviceSourceContributionTranscriptV1;
  readonly authorityId?: never;
  readonly packageSetDigestB64u?: never;
};

export type LinkedDeviceSessionRecordV1 =
  | LinkedDeviceSessionUnclaimedRecordV1
  | LinkedDeviceSessionClaimedRecordV1
  | LinkedDeviceSessionApprovedRecordV1
  | LinkedDeviceSessionSourceContributionRecordV1
  | LinkedDeviceSessionProvisioningRecordV1
  | LinkedDeviceSessionPendingRecordV1
  | LinkedDeviceSessionActiveRecordV1
  | LinkedDeviceSessionTerminalRecordV1;

export type LinkedDeviceSessionMutationResultV1 =
  | { readonly outcome: 'applied' | 'replayed'; readonly record: LinkedDeviceSessionRecordV1 }
  | {
      readonly outcome: 'conflict';
      readonly expectedRevision: number;
      readonly actualRevision: number | null;
      readonly record: LinkedDeviceSessionRecordV1 | null;
    }
  | { readonly outcome: 'expired'; readonly record: LinkedDeviceSessionRecordV1 }
  | { readonly outcome: 'deleted'; readonly record: null }
  | {
      readonly outcome: 'invalid_state';
      readonly state: LinkSessionStateV1['state'];
      readonly record: LinkedDeviceSessionRecordV1;
    }
  | {
      readonly outcome: 'integrity_error';
      readonly reason: 'authority_id_mismatch' | 'package_set_digest_mismatch';
      readonly record: LinkedDeviceSessionRecordV1;
    };

export function buildUnclaimedSessionRecordV1(
  payload: QrLinkedDeviceSessionPayloadV5,
  nowMs: number,
): LinkedDeviceSessionRecordV1 {
  const parsedPayload = parseQrLinkedDeviceSessionPayloadV1(payload);
  const createdAtMs = requireTimestamp(nowMs, 'nowMs');
  if (parsedPayload.issuedAtMs - createdAtMs > LINKED_DEVICE_CLOCK_SKEW_TOLERANCE_MS_V1) {
    throw new Error('link session issuedAtMs is in the future');
  }
  return buildSessionRecordV1({
    linkSessionId: parsedPayload.linkSessionId,
    qrPayload: parsedPayload,
    state: { state: 'displaying_qr' },
    revision: 1,
    createdAtMs,
    updatedAtMs: createdAtMs,
  });
}

export function parseLinkedDeviceSessionRecordV1(raw: unknown): LinkedDeviceSessionRecordV1 {
  const record = requireRecordCopy(raw, 'linked device session record');
  requireAllowedKeys(record, [
    'version',
    'linkSessionId',
    'qrPayload',
    'state',
    'revision',
    'claimTranscript',
    'approvalTranscript',
    'targetFactor',
    'emailOtpChallenge',
    'sourceContributionPreparation',
    'sourceContributionTranscript',
    'authorityId',
    'packageSetDigestB64u',
    'createdAtMs',
    'updatedAtMs',
  ]);
  if (record.version !== 'linked_device_session_v1')
    throw new Error('linked device session version is invalid');
  const linkSessionId = parseId(record.linkSessionId, parseLinkDeviceSessionId, 'linkSessionId');
  const qrPayload = parseQrLinkedDeviceSessionPayloadV1(record.qrPayload);
  if (qrPayload.linkSessionId !== linkSessionId)
    throw new Error('linkSessionId does not match QR payload');
  const state = parseLinkSessionStateV1(record.state);
  const revision = requirePositiveInteger(record.revision, 'revision');
  const createdAtMs = requireTimestamp(record.createdAtMs, 'createdAtMs');
  const updatedAtMs = requireTimestamp(record.updatedAtMs, 'updatedAtMs');
  if (updatedAtMs < createdAtMs) throw new Error('updatedAtMs precedes createdAtMs');
  return buildSessionRecordV1({
    linkSessionId,
    qrPayload,
    state,
    revision,
    claimTranscript: retiredShapeGuard('claimTranscript', () =>
      parseOptionalClaimTranscript(record.claimTranscript),
    ),
    approvalTranscript: retiredShapeGuard('approvalTranscript', () =>
      parseOptionalApprovalTranscript(record.approvalTranscript, 'approvalTranscript'),
    ),
    targetFactor: parseOptionalApprovedTargetFactor(record.targetFactor),
    emailOtpChallenge: parseOptionalEmailOtpChallenge(record.emailOtpChallenge),
    sourceContributionPreparation: parseOptionalSourceContributionPreparation(
      record.sourceContributionPreparation,
    ),
    sourceContributionTranscript: retiredShapeGuard('sourceContributionTranscript', () =>
      parseOptionalApprovalTranscript(
        record.sourceContributionTranscript,
        'sourceContributionTranscript',
      ),
    ),
    authorityId: parseOptionalId(record.authorityId, parseWalletAuthorityId, 'authorityId'),
    packageSetDigestB64u: parseOptionalDigest(record.packageSetDigestB64u, 'packageSetDigestB64u'),
    createdAtMs,
    updatedAtMs,
  });
}

export function parseQrLinkedDeviceSessionPayloadV1(raw: unknown): QrLinkedDeviceSessionPayloadV5 {
  return parseSharedQrLinkedDeviceSessionPayloadV5(raw);
}

/** Durable facts a session record gains as it advances; each state requires its own subset. */
type LinkedDeviceSessionRecordFactsV1 = {
  readonly claimTranscript?: LinkedDeviceClaimTranscriptV1;
  readonly approvalTranscript?: LinkedDeviceApprovalTranscriptV1;
  readonly targetFactor?: LinkedDeviceApprovedTargetFactorV1;
  readonly emailOtpChallenge?: LinkedDeviceEmailOtpChallengeV1;
  readonly sourceContributionPreparation?: LinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1;
  readonly sourceContributionTranscript?: LinkedDeviceSourceContributionTranscriptV1;
  readonly authorityId?: WalletAuthorityId;
  readonly packageSetDigestB64u?: DigestB64u;
};

type LinkedDeviceSessionRecordInputV1 = LinkedDeviceSessionRecordFactsV1 & {
  readonly linkSessionId: LinkDeviceSessionId;
  readonly qrPayload: QrLinkedDeviceSessionPayloadV5;
  readonly state: LinkSessionStateV1;
  readonly revision: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
};

type LinkedDeviceApprovedRecordFactsV1 = {
  readonly claimTranscript: LinkedDeviceClaimTranscriptV1;
  readonly approvalTranscript: LinkedDeviceApprovalTranscriptV1;
  readonly targetFactor: LinkedDeviceApprovedTargetFactorV1;
};

function buildSessionRecordV1(
  input: LinkedDeviceSessionRecordInputV1,
): LinkedDeviceSessionRecordV1 {
  requireRecordIdentityFacts(input);
  switch (input.state.state) {
    case 'displaying_qr':
      requireNoRecordFacts(input, 'displaying_qr');
      return {
        version: 'linked_device_session_v1',
        linkSessionId: input.linkSessionId,
        qrPayload: input.qrPayload,
        state: input.state,
        revision: input.revision,
        createdAtMs: input.createdAtMs,
        updatedAtMs: input.updatedAtMs,
      };
    case 'claimed':
      requireClaimRecordFacts(input, 'claimed');
      return {
        version: 'linked_device_session_v1',
        linkSessionId: input.linkSessionId,
        qrPayload: input.qrPayload,
        state: input.state,
        claimTranscript: input.claimTranscript,
        revision: input.revision,
        createdAtMs: input.createdAtMs,
        updatedAtMs: input.updatedAtMs,
      };
    case 'awaiting_target_factor':
      return buildApprovedSessionRecordV1(input);
    case 'awaiting_source_contribution':
      return buildSourceContributionSessionRecordV1(input);
    case 'provisioning':
      return buildProvisioningSessionRecordV1(input);
    case 'authority_pending_local_install':
      return buildPendingSessionRecordV1(input);
    case 'active':
      return buildActiveSessionRecordV1(input);
    case 'failed_before_commit':
    case 'cancelled':
    case 'expired':
      requireTerminalRecordFacts(input, input.state.state);
      return {
        version: 'linked_device_session_v1',
        linkSessionId: input.linkSessionId,
        qrPayload: input.qrPayload,
        state: input.state,
        ...(input.claimTranscript ? { claimTranscript: input.claimTranscript } : {}),
        ...(input.approvalTranscript ? { approvalTranscript: input.approvalTranscript } : {}),
        ...(input.targetFactor ? { targetFactor: input.targetFactor } : {}),
        ...(input.emailOtpChallenge ? { emailOtpChallenge: input.emailOtpChallenge } : {}),
        ...(input.sourceContributionPreparation
          ? { sourceContributionPreparation: input.sourceContributionPreparation }
          : {}),
        ...(input.sourceContributionTranscript
          ? { sourceContributionTranscript: input.sourceContributionTranscript }
          : {}),
        revision: input.revision,
        createdAtMs: input.createdAtMs,
        updatedAtMs: input.updatedAtMs,
      };
    default:
      return assertNeverLinkSessionStateV1(input.state);
  }
}

function buildApprovedSessionRecordV1(
  input: LinkedDeviceSessionRecordInputV1,
): LinkedDeviceSessionApprovedRecordV1 {
  if (input.state.state !== 'awaiting_target_factor') {
    throw new Error('approved session state is invalid');
  }
  requireApprovedRecordFacts(input, input.state.state);
  if (input.sourceContributionPreparation || input.sourceContributionTranscript) {
    throw new Error('awaiting target-factor session contains source-contribution facts');
  }
  return approvedStageSessionRecordV1(input, input.state, {});
}

function buildSourceContributionSessionRecordV1(
  input: LinkedDeviceSessionRecordInputV1,
): LinkedDeviceSessionSourceContributionRecordV1 {
  if (input.state.state !== 'awaiting_source_contribution') {
    throw new Error('source-contribution session state is invalid');
  }
  requireApprovedRecordFacts(input, input.state.state);
  if (!input.sourceContributionPreparation || input.sourceContributionTranscript) {
    throw new Error('source-contribution session facts are incomplete');
  }
  return approvedStageSessionRecordV1(input, input.state, {
    sourceContributionPreparation: input.sourceContributionPreparation,
  });
}

function buildProvisioningSessionRecordV1(
  input: LinkedDeviceSessionRecordInputV1,
): LinkedDeviceSessionProvisioningRecordV1 {
  if (input.state.state !== 'provisioning') {
    throw new Error('provisioning session state is invalid');
  }
  requireApprovedRecordFacts(input, input.state.state);
  if (!input.sourceContributionPreparation || !input.sourceContributionTranscript) {
    throw new Error('provisioning session facts are incomplete');
  }
  return approvedStageSessionRecordV1(input, input.state, {
    sourceContributionPreparation: input.sourceContributionPreparation,
    sourceContributionTranscript: input.sourceContributionTranscript,
  });
}

function buildPendingSessionRecordV1(
  input: LinkedDeviceSessionRecordInputV1,
): LinkedDeviceSessionPendingRecordV1 {
  if (input.state.state !== 'authority_pending_local_install') {
    throw new Error('pending session state is invalid');
  }
  requireCommittedRecordFacts(input, input.state.state);
  if (input.authorityId !== input.state.authorityId)
    throw new Error('pending authority facts do not match state');
  if (input.packageSetDigestB64u !== input.state.packageSetDigestB64u)
    throw new Error('pending package digest does not match state');
  return approvedStageSessionRecordV1(input, input.state, {
    sourceContributionPreparation: input.sourceContributionPreparation,
    sourceContributionTranscript: input.sourceContributionTranscript,
    authorityId: input.authorityId,
    packageSetDigestB64u: input.packageSetDigestB64u,
  });
}

function buildActiveSessionRecordV1(
  input: LinkedDeviceSessionRecordInputV1,
): LinkedDeviceSessionActiveRecordV1 {
  if (input.state.state !== 'active') throw new Error('active session state is invalid');
  requireCommittedRecordFacts(input, 'active');
  if (input.authorityId !== input.state.authorityId)
    throw new Error('active authority facts do not match state');
  return approvedStageSessionRecordV1(input, input.state, {
    sourceContributionPreparation: input.sourceContributionPreparation,
    sourceContributionTranscript: input.sourceContributionTranscript,
    authorityId: input.authorityId,
    packageSetDigestB64u: input.packageSetDigestB64u,
  });
}

/**
 * Lays out a record from owner approval onward, in the key order every stored record
 * uses: the approval-stage facts, then the facts the caller's state adds.
 */
function approvedStageSessionRecordV1<
  TState extends LinkSessionStateV1,
  TStageFacts extends LinkedDeviceSessionRecordFactsV1,
>(
  input: LinkedDeviceSessionRecordInputV1 & LinkedDeviceApprovedRecordFactsV1,
  state: TState,
  stageFacts: TStageFacts,
): LinkedDeviceSessionRecordBaseV1 &
  LinkedDeviceTargetFactorRecordV1 & {
    readonly state: TState;
    readonly claimTranscript: LinkedDeviceClaimTranscriptV1;
    readonly approvalTranscript: LinkedDeviceApprovalTranscriptV1;
  } & TStageFacts {
  return {
    version: 'linked_device_session_v1',
    linkSessionId: input.linkSessionId,
    qrPayload: input.qrPayload,
    state,
    claimTranscript: input.claimTranscript,
    approvalTranscript: input.approvalTranscript,
    ...targetFactorRecordFieldsV1(input.targetFactor, input.emailOtpChallenge),
    ...stageFacts,
    revision: input.revision,
    createdAtMs: input.createdAtMs,
    updatedAtMs: input.updatedAtMs,
  };
}

/** A passkey record never carries Email OTP challenge state. */
function targetFactorRecordFieldsV1(
  targetFactor: LinkedDeviceApprovedTargetFactorV1,
  emailOtpChallenge: LinkedDeviceEmailOtpChallengeV1 | undefined,
): LinkedDeviceTargetFactorRecordV1 {
  if (targetFactor.kind === 'passkey_prf') return { targetFactor };
  return { targetFactor, ...(emailOtpChallenge ? { emailOtpChallenge } : {}) };
}

export function replaceSessionRecordV1(
  record: LinkedDeviceSessionRecordV1,
  patch: LinkedDeviceSessionRecordFactsV1 & {
    readonly state?: LinkSessionStateV1;
    readonly revision: number;
    readonly updatedAtMs: number;
  },
): LinkedDeviceSessionRecordV1 {
  return buildSessionRecordV1({
    linkSessionId: record.linkSessionId,
    qrPayload: record.qrPayload,
    state: patch.state ?? record.state,
    revision: patch.revision,
    claimTranscript: patch.claimTranscript ?? record.claimTranscript,
    approvalTranscript: patch.approvalTranscript ?? record.approvalTranscript,
    targetFactor: patch.targetFactor ?? record.targetFactor,
    emailOtpChallenge: patch.emailOtpChallenge ?? record.emailOtpChallenge,
    sourceContributionPreparation:
      patch.sourceContributionPreparation ?? record.sourceContributionPreparation,
    sourceContributionTranscript:
      patch.sourceContributionTranscript ?? record.sourceContributionTranscript,
    authorityId: patch.authorityId ?? record.authorityId,
    packageSetDigestB64u: patch.packageSetDigestB64u ?? record.packageSetDigestB64u,
    createdAtMs: record.createdAtMs,
    updatedAtMs: patch.updatedAtMs,
  });
}

/** Builds the next linear session record for the authority commit transaction. */
export function buildAuthorityPendingLocalInstallSessionRecordV1(input: {
  readonly record: LinkedDeviceSessionRecordV1;
  readonly authorityId: WalletAuthorityId;
  readonly packageSetDigestB64u: DigestB64u;
  readonly nowMs: number;
}): LinkedDeviceSessionRecordV1 {
  const nowMs = requireTimestamp(input.nowMs, 'nowMs');
  if (input.record.state.state !== 'provisioning') {
    throw new Error('linked-device session is not ready for authority commit');
  }
  return replaceSessionRecordV1(input.record, {
    state: authorityPendingStateV1(input.record, input.authorityId, input.packageSetDigestB64u),
    authorityId: input.authorityId,
    packageSetDigestB64u: input.packageSetDigestB64u,
    revision: input.record.revision + 1,
    updatedAtMs: nowMs,
  });
}

/** Builds the next linear session record for the authority activation transaction. */
export function buildAuthorityActiveSessionRecordV1(input: {
  readonly record: LinkedDeviceSessionRecordV1;
  readonly activatedAtMs: number;
  readonly nowMs: number;
}): LinkedDeviceSessionRecordV1 {
  const nowMs = requireTimestamp(input.nowMs, 'nowMs');
  const activatedAtMs = requireTimestamp(input.activatedAtMs, 'activatedAtMs');
  if (activatedAtMs > nowMs) throw new Error('activatedAtMs cannot be in the future');
  if (input.record.state.state !== 'authority_pending_local_install') {
    throw new Error('linked-device session has no pending authority installation');
  }
  return replaceSessionRecordV1(input.record, {
    state: activeStateV1(input.record, activatedAtMs),
    revision: input.record.revision + 1,
    updatedAtMs: nowMs,
  });
}

export function claimedStateV1(
  record: LinkedDeviceSessionRecordV1,
  claim: LinkedDeviceClaimV1,
): Extract<LinkSessionStateV1, { readonly state: 'claimed' }> {
  if (record.state.state !== 'displaying_qr') throw new Error('link session is not claimable');
  return { state: 'claimed', deviceId: parseDeviceIdValue(claim.deviceId) };
}

export function awaitingTargetFactorStateV1(
  record: LinkedDeviceSessionRecordV1,
): Extract<LinkSessionStateV1, { readonly state: 'awaiting_target_factor' }> {
  if (record.state.state !== 'claimed')
    throw new Error('link session is not awaiting owner approval');
  return { state: 'awaiting_target_factor', deviceId: record.state.deviceId };
}

export function provisioningStateV1(
  record: LinkedDeviceSessionRecordV1,
): Extract<LinkSessionStateV1, { readonly state: 'provisioning' }> {
  if (record.state.state !== 'awaiting_source_contribution')
    throw new Error('link session is not awaiting source contribution');
  return { state: 'provisioning', deviceId: record.state.deviceId };
}

export function awaitingSourceContributionStateV1(
  record: LinkedDeviceSessionRecordV1,
): Extract<LinkSessionStateV1, { readonly state: 'awaiting_source_contribution' }> {
  if (record.state.state !== 'awaiting_target_factor') {
    throw new Error('link session is not awaiting target credential');
  }
  return { state: 'awaiting_source_contribution', deviceId: record.state.deviceId };
}

export function authorityPendingStateV1(
  record: LinkedDeviceSessionRecordV1,
  authorityId: WalletAuthorityId,
  packageSetDigestB64u: DigestB64u,
): Extract<LinkSessionStateV1, { readonly state: 'authority_pending_local_install' }> {
  if (record.state.state !== 'provisioning')
    throw new Error('link session has no pending authority installation');
  return {
    state: 'authority_pending_local_install',
    deviceId: record.state.deviceId,
    authorityId,
    packageSetDigestB64u,
  };
}

export function activeStateV1(
  record: LinkedDeviceSessionRecordV1,
  activatedAtMs: number,
): Extract<LinkSessionStateV1, { readonly state: 'active' }> {
  if (record.state.state !== 'authority_pending_local_install')
    throw new Error('link session has no pending authority installation');
  return {
    state: 'active',
    deviceId: record.state.deviceId,
    authorityId: record.state.authorityId,
    activatedAtMs,
  };
}

export function isPrecommitState(state: LinkSessionStateV1): state is Extract<
  LinkSessionStateV1,
  {
    readonly state:
      | 'displaying_qr'
      | 'claimed'
      | 'awaiting_target_factor'
      | 'awaiting_source_contribution'
      | 'provisioning';
  }
> {
  switch (state.state) {
    case 'displaying_qr':
    case 'claimed':
    case 'awaiting_target_factor':
    case 'awaiting_source_contribution':
    case 'provisioning':
      return true;
    case 'authority_pending_local_install':
    case 'active':
    case 'failed_before_commit':
    case 'cancelled':
    case 'expired':
      return false;
    default:
      return assertNeverLinkSessionStateV1(state);
  }
}

export function sessionExpiryMsV1(record: LinkedDeviceSessionRecordV1): number {
  switch (record.state.state) {
    case 'displaying_qr':
      return record.qrPayload.expiresAtMs;
    case 'claimed':
      return record.claimTranscript?.value.claimExpiresAtMs ?? record.qrPayload.expiresAtMs;
    case 'awaiting_target_factor':
    case 'awaiting_source_contribution':
    case 'provisioning':
      return record.approvalTranscript?.value.expiresAtMs ?? record.qrPayload.expiresAtMs;
    case 'authority_pending_local_install':
    case 'active':
    case 'failed_before_commit':
    case 'cancelled':
    case 'expired':
      return Number.POSITIVE_INFINITY;
    default:
      return assertNeverLinkSessionStateV1(record.state);
  }
}

export function awaitingTargetDeadlineMsV1(record: LinkedDeviceSessionRecordV1): number {
  if (record.state.state !== 'awaiting_target_factor')
    throw new Error('link session is not awaiting target factor');
  return record.approvalTranscript?.value.expiresAtMs ?? record.qrPayload.expiresAtMs;
}

export function awaitingSourceContributionDeadlineMsV1(
  record: LinkedDeviceSessionRecordV1,
): number {
  if (record.state.state !== 'awaiting_source_contribution') {
    throw new Error('link session is not awaiting source contribution');
  }
  return record.approvalTranscript?.value.expiresAtMs ?? record.qrPayload.expiresAtMs;
}

export function linkedDeviceQrPayloadsEqualV1(
  left: QrLinkedDeviceSessionPayloadV5,
  right: QrLinkedDeviceSessionPayloadV5,
): boolean {
  if (
    left.version !== right.version ||
    left.purpose !== right.purpose ||
    left.linkSessionId !== right.linkSessionId ||
    left.linkPublicKeyB64u !== right.linkPublicKeyB64u ||
    left.devicePublicKeyB64u !== right.devicePublicKeyB64u ||
    !sameDelegatedWalletAuthorityV1(left.requestedPermission, right.requestedPermission) ||
    left.issuedAtMs !== right.issuedAtMs ||
    left.expiresAtMs !== right.expiresAtMs
  ) {
    return false;
  }
  switch (left.targetFactor.kind) {
    case 'passkey_prf':
      return right.targetFactor.kind === 'passkey_prf';
    case 'email_otp':
      return right.targetFactor.kind === 'email_otp' && left.targetEmail === right.targetEmail;
    default:
      return assertNeverLinkedDeviceTargetFactorV1(left.targetFactor);
  }
}

export function claimTranscriptMatchesDigest(
  record: LinkedDeviceSessionRecordV1,
  digest: DigestB64u,
): boolean {
  return record.claimTranscript?.digestB64u === digest;
}

export function approvalTranscriptMatchesDigest(
  record: LinkedDeviceSessionRecordV1,
  digest: DigestB64u,
): boolean {
  return record.approvalTranscript?.digestB64u === digest;
}

export function sourceContributionTranscriptMatchesDigest(
  record: LinkedDeviceSessionRecordV1,
  digest: DigestB64u,
): boolean {
  return record.sourceContributionTranscript?.digestB64u === digest;
}

export function linkedDeviceEmailOtpChallengesEqualV1(
  left: LinkedDeviceEmailOtpChallengeV1,
  right: LinkedDeviceEmailOtpChallengeV1,
): boolean {
  switch (left.state) {
    case 'available':
      return right.state === 'available' && left.maskedEmailHint === right.maskedEmailHint;
    case 'sent':
      return (
        right.state === 'sent' &&
        left.challengeId === right.challengeId &&
        left.workerEphemeralPublicKey65B64u === right.workerEphemeralPublicKey65B64u &&
        left.maskedEmailHint === right.maskedEmailHint &&
        left.expiresAtMs === right.expiresAtMs &&
        left.resendAvailableAtMs === right.resendAvailableAtMs
      );
    default:
      return assertNeverLinkedDeviceEmailOtpChallengeV1(left);
  }
}

export function linkedDevicePrecommitFailuresEqualV1(
  left: LinkPrecommitFailureV1,
  right: LinkPrecommitFailureV1,
): boolean {
  switch (left.kind) {
    case 'invalid_input':
      return right.kind === 'invalid_input' && left.reason === right.reason;
    case 'unauthorized_source':
      return right.kind === 'unauthorized_source' && left.reason === right.reason;
    case 'revoked_source':
      return right.kind === 'revoked_source' && left.reason === right.reason;
    case 'permission_attenuation_failed':
      return right.kind === 'permission_attenuation_failed' && left.reason === right.reason;
    case 'target_factor_failed':
      return right.kind === 'target_factor_failed' && left.reason === right.reason;
    case 'expired_session':
      return right.kind === 'expired_session' && left.reason === right.reason;
    case 'cancelled_session':
      return right.kind === 'cancelled_session' && left.reason === right.reason;
    case 'claim_conflict':
      return right.kind === 'claim_conflict' && left.reason === right.reason;
    case 'package_preparation_failed':
      return right.kind === 'package_preparation_failed' && left.reason === right.reason;
    default:
      return assertNeverLinkPrecommitFailureV1(left);
  }
}

function assertNeverLinkedDeviceTargetFactorV1(value: never): never {
  throw new Error(`unsupported linked-device target factor: ${String(value)}`);
}

function assertNeverLinkedDeviceEmailOtpChallengeV1(value: never): never {
  throw new Error(`unsupported linked-device email OTP challenge: ${String(value)}`);
}

function assertNeverLinkPrecommitFailureV1(value: never): never {
  throw new Error(`unsupported linked-device precommit failure: ${String(value)}`);
}

function parseLinkedDeviceApprovalV1(raw: unknown): LinkedDeviceApprovalV1 {
  return parseSharedLinkedDeviceApprovalV1(raw);
}

function parseLinkedDeviceClaimV1(raw: unknown): LinkedDeviceClaimV1 {
  return parseSharedLinkedDeviceSessionClaimV1(raw);
}

function parseOptionalClaimTranscript(raw: unknown): LinkedDeviceClaimTranscriptV1 | undefined {
  if (raw === undefined) return undefined;
  const record = requireRecordCopy(raw, 'claimTranscript');
  requireExactKeys(record, ['digestB64u', 'value']);
  return {
    digestB64u: requireDigest(record.digestB64u, 'claimTranscript.digestB64u'),
    value: parseLinkedDeviceClaimV1(record.value),
  };
}

/**
 * A stored transcript no longer parses under the current schema. This class
 * marks exactly the failures a deployment boundary produces - transcript
 * shapes are what refactors move - so a store can delete-and-recover them
 * while every value-consistency failure (tampering) keeps throwing raw.
 */
export class LinkedDeviceRetiredSessionShapeErrorV1 extends Error {
  constructor(transcript: string, cause: unknown) {
    super(
      `linked-device ${transcript} shape is retired: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'LinkedDeviceRetiredSessionShapeErrorV1';
  }
}

function retiredShapeGuard<T>(transcript: string, parse: () => T): T {
  try {
    return parse();
  } catch (error: unknown) {
    if (error instanceof LinkedDeviceRetiredSessionShapeErrorV1) throw error;
    throw new LinkedDeviceRetiredSessionShapeErrorV1(transcript, error);
  }
}

/** The owner approval and its source-contribution re-approval share one transcript shape. */
function parseOptionalApprovalTranscript(
  raw: unknown,
  field: 'approvalTranscript' | 'sourceContributionTranscript',
): LinkedDeviceApprovalTranscriptV1 | undefined {
  if (raw === undefined) return undefined;
  const record = requireRecordCopy(raw, field);
  requireExactKeys(record, [
    'digestB64u',
    'value',
    'sourceSignerManifest',
    'sourceKeyManifestDigestsB64u',
    'sourceAuthorityDigestB64u',
  ]);
  const value = parseLinkedDeviceApprovalV1(record.value);
  if (field === 'sourceContributionTranscript' && !value.sourceContribution) {
    throw new Error(`${field}.value has no source contribution`);
  }
  const sourceKeyManifestDigestsB64u = parseSourceKeyManifestDigestsV1(
    record.sourceKeyManifestDigestsB64u,
    `${field}.sourceKeyManifestDigestsB64u`,
  );
  const sourceSignerManifest = parseExactAdministeredSignerManifestV1(record.sourceSignerManifest);
  assertSourceKeyManifestDigestFamiliesMatchManifestV1(
    sourceSignerManifest,
    sourceKeyManifestDigestsB64u,
  );
  return {
    digestB64u: requireDigest(record.digestB64u, `${field}.digestB64u`),
    value,
    sourceSignerManifest,
    sourceKeyManifestDigestsB64u,
    sourceAuthorityDigestB64u: requireDigest(
      record.sourceAuthorityDigestB64u,
      `${field}.sourceAuthorityDigestB64u`,
    ),
  };
}

function parseSourceKeyManifestDigestsV1(
  raw: unknown,
  field: string,
): LinkedDeviceSourceKeyManifestDigestsV1 {
  const record = requireRecordCopy(raw, field);
  const keys = Object.keys(record).sort();
  if (keys.length === 1 && keys[0] === 'ed25519') {
    return { ed25519: requireDigest(record.ed25519, `${field}.ed25519`) };
  }
  if (keys.length === 1 && keys[0] === 'ecdsa_secp256k1') {
    return {
      ecdsa_secp256k1: requireDigest(record.ecdsa_secp256k1, `${field}.ecdsa_secp256k1`),
    };
  }
  if (keys.length === 2 && keys[0] === 'ecdsa_secp256k1' && keys[1] === 'ed25519') {
    return {
      ed25519: requireDigest(record.ed25519, `${field}.ed25519`),
      ecdsa_secp256k1: requireDigest(record.ecdsa_secp256k1, `${field}.ecdsa_secp256k1`),
    };
  }
  throw new Error(`${field} must contain exactly one digest for each approved source key family`);
}

function parseOptionalSourceContributionPreparation(
  raw: unknown,
): LinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1 | undefined {
  if (raw === undefined) return undefined;
  return parseLinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1(raw);
}

function assertSourceKeyManifestDigestFamiliesMatchManifestV1(
  manifest: ExactAdministeredSignerManifestV1,
  digests: LinkedDeviceSourceKeyManifestDigestsV1,
): void {
  const manifestHasEd25519 = manifest.keyFamilies.some((family) => family === 'ed25519');
  const manifestHasEcdsa = manifest.keyFamilies.some((family) => family === 'ecdsa_secp256k1');
  const digestHasEd25519 = digests.ed25519 !== undefined;
  const digestHasEcdsa = digests.ecdsa_secp256k1 !== undefined;
  if (manifestHasEd25519 !== digestHasEd25519 || manifestHasEcdsa !== digestHasEcdsa) {
    throw new Error(
      'source key manifest digest families do not match the verified signer manifest',
    );
  }
}

function parseOptionalApprovedTargetFactor(
  raw: unknown,
): LinkedDeviceApprovedTargetFactorV1 | undefined {
  if (raw === undefined) return undefined;
  const record = requireRecordCopy(raw, 'targetFactor');
  if (record.kind === 'passkey_prf') {
    requireExactKeys(record, ['kind']);
    return { kind: 'passkey_prf' };
  }
  if (record.kind === 'email_otp') {
    const targetEmail = parseId(
      record.targetEmail,
      parseVerifiedEmailAddress,
      'targetFactor.targetEmail',
    );
    const enrollment = requireRecordCopy(record.enrollment, 'targetFactor.enrollment');
    if (enrollment.kind === 'existing_enrollment') {
      requireExactKeys(record, ['kind', 'targetEmail', 'enrollment', 'baseWalletAuthMethodId']);
      requireExactKeys(enrollment, ['kind']);
      return {
        kind: 'email_otp',
        targetEmail,
        enrollment: { kind: 'existing_enrollment' },
        baseWalletAuthMethodId: parseId(
          record.baseWalletAuthMethodId,
          parseWalletAuthMethodId,
          'targetFactor.baseWalletAuthMethodId',
        ),
      };
    }
    if (enrollment.kind === 'new_enrollment') {
      requireExactKeys(record, ['kind', 'targetEmail', 'enrollment']);
      requireExactKeys(enrollment, ['kind']);
      return {
        kind: 'email_otp',
        targetEmail,
        enrollment: { kind: 'new_enrollment' },
      };
    }
    throw new Error('targetFactor.enrollment.kind is invalid');
  }
  throw new Error('targetFactor.kind is invalid');
}

function parseOptionalEmailOtpChallenge(raw: unknown): LinkedDeviceEmailOtpChallengeV1 | undefined {
  if (raw === undefined) return undefined;
  const record = requireRecordCopy(raw, 'emailOtpChallenge');
  const state = parseIdentityString(record.state, 'emailOtpChallenge.state');
  if (state === 'available') {
    requireExactKeys(record, ['state', 'maskedEmailHint']);
    return {
      state,
      maskedEmailHint: parseIdentityString(
        record.maskedEmailHint,
        'emailOtpChallenge.maskedEmailHint',
      ),
    };
  }
  if (state === 'sent') {
    requireExactKeys(record, ['state', ...SENT_EMAIL_OTP_CHALLENGE_KEYS]);
    return parseSentEmailOtpChallengeFieldsV1(record, 'emailOtpChallenge');
  }
  throw new Error('emailOtpChallenge.state is invalid');
}

export function parseEmailOtpChallengeV1(raw: unknown): LinkedDeviceEmailOtpChallengeV1 {
  const record = requireRecordCopy(raw, 'challenge');
  requireExactKeys(record, SENT_EMAIL_OTP_CHALLENGE_KEYS);
  return parseSentEmailOtpChallengeFieldsV1(record, 'challenge');
}

const SENT_EMAIL_OTP_CHALLENGE_KEYS = [
  'challengeId',
  'workerEphemeralPublicKey65B64u',
  'maskedEmailHint',
  'expiresAtMs',
  'resendAvailableAtMs',
] as const;

/** A stored challenge and a newly sent one parse the same fields under their own prefix. */
function parseSentEmailOtpChallengeFieldsV1(
  record: Record<string, unknown>,
  field: 'emailOtpChallenge' | 'challenge',
): LinkedDeviceEmailOtpChallengeV1 {
  return {
    state: 'sent',
    challengeId: parseIdentityString(record.challengeId, `${field}.challengeId`),
    workerEphemeralPublicKey65B64u: parseIdentityString(
      record.workerEphemeralPublicKey65B64u,
      `${field}.workerEphemeralPublicKey65B64u`,
    ),
    maskedEmailHint: parseIdentityString(record.maskedEmailHint, `${field}.maskedEmailHint`),
    expiresAtMs: requireTimestamp(record.expiresAtMs, `${field}.expiresAtMs`),
    resendAvailableAtMs: requireTimestamp(
      record.resendAvailableAtMs,
      `${field}.resendAvailableAtMs`,
    ),
  };
}

function requireNoRecordFacts(input: LinkedDeviceSessionRecordFactsV1, state: string): void {
  if (
    input.claimTranscript ||
    input.approvalTranscript ||
    input.targetFactor ||
    input.emailOtpChallenge ||
    input.sourceContributionPreparation ||
    input.sourceContributionTranscript ||
    input.authorityId ||
    input.packageSetDigestB64u
  )
    throw new Error(`${state} session carries invalid durable facts`);
}

function requireClaimRecordFacts(
  input: LinkedDeviceSessionRecordFactsV1,
  state: string,
): asserts input is typeof input & { readonly claimTranscript: LinkedDeviceClaimTranscriptV1 } {
  if (
    !input.claimTranscript ||
    input.approvalTranscript ||
    input.targetFactor ||
    input.emailOtpChallenge ||
    input.sourceContributionPreparation ||
    input.sourceContributionTranscript ||
    input.authorityId ||
    input.packageSetDigestB64u
  )
    throw new Error(`${state} session facts are invalid`);
}

function requireApprovedRecordFacts(
  input: LinkedDeviceSessionRecordFactsV1,
  state: string,
): asserts input is typeof input & LinkedDeviceApprovedRecordFactsV1 {
  if (!input.claimTranscript || !input.approvalTranscript || !input.targetFactor)
    throw new Error(`${state} session facts are incomplete`);
  if (input.authorityId || input.packageSetDigestB64u)
    throw new Error(`${state} session contains committed facts`);
  if (input.targetFactor.kind === 'passkey_prf' && input.emailOtpChallenge)
    throw new Error(`${state} passkey session contains email challenge state`);
}

function requireCommittedRecordFacts(
  input: LinkedDeviceSessionRecordFactsV1,
  state: string,
): asserts input is typeof input &
  LinkedDeviceApprovedRecordFactsV1 & {
    readonly sourceContributionPreparation: LinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1;
    readonly sourceContributionTranscript: LinkedDeviceSourceContributionTranscriptV1;
    readonly authorityId: WalletAuthorityId;
    readonly packageSetDigestB64u: DigestB64u;
  } {
  if (
    !input.claimTranscript ||
    !input.approvalTranscript ||
    !input.targetFactor ||
    !input.authorityId ||
    !input.packageSetDigestB64u
  )
    throw new Error(`${state} session facts are incomplete`);
  if (!input.sourceContributionPreparation || !input.sourceContributionTranscript)
    throw new Error(`${state} session source-contribution facts are incomplete`);
  if (input.targetFactor.kind === 'passkey_prf' && input.emailOtpChallenge)
    throw new Error(`${state} passkey session contains email challenge state`);
}

function requireNoCommittedFacts(
  input: { readonly authorityId?: WalletAuthorityId; readonly packageSetDigestB64u?: DigestB64u },
  state: string,
): void {
  if (input.authorityId || input.packageSetDigestB64u)
    throw new Error(`${state} session contains committed facts`);
}

function requireRecordIdentityFacts(input: LinkedDeviceSessionRecordInputV1): void {
  if (input.targetFactor && input.targetFactor.kind !== input.qrPayload.targetFactor.kind) {
    throw new Error('target factor does not match QR payload');
  }
  const claim = input.claimTranscript?.value;
  if (claim) {
    if (
      claim.linkSessionId !== input.linkSessionId ||
      claim.devicePublicKeyB64u !== input.qrPayload.devicePublicKeyB64u ||
      claim.targetFactor.kind !== input.qrPayload.targetFactor.kind
    ) {
      throw new Error('claim transcript identity does not match QR payload');
    }
  }
  const approval = input.approvalTranscript?.value;
  if (approval) {
    if (
      approval.linkSessionId !== input.linkSessionId ||
      approval.linkPublicKeyB64u !== input.qrPayload.linkPublicKeyB64u ||
      approval.devicePublicKeyB64u !== input.qrPayload.devicePublicKeyB64u ||
      approval.targetFactor.kind !== input.qrPayload.targetFactor.kind
    ) {
      throw new Error('approval transcript identity does not match QR payload');
    }
  }
  if (
    claim &&
    approval &&
    parseDeviceIdValue(claim.deviceId) !== parseDeviceIdValue(approval.deviceId)
  ) {
    throw new Error('approval transcript device identity does not match claim transcript');
  }
  switch (input.state.state) {
    case 'displaying_qr':
    case 'failed_before_commit':
    case 'cancelled':
    case 'expired':
      return;
    case 'claimed':
    case 'awaiting_target_factor':
    case 'awaiting_source_contribution':
    case 'provisioning':
      if (!claim || input.state.deviceId !== parseDeviceIdValue(claim.deviceId)) {
        throw new Error(`${input.state.state} device identity does not match claim transcript`);
      }
      return;
    case 'authority_pending_local_install':
    case 'active':
      if (
        !claim ||
        !approval ||
        input.state.deviceId !== parseDeviceIdValue(claim.deviceId) ||
        input.state.deviceId !== parseDeviceIdValue(approval.deviceId)
      ) {
        throw new Error(`${input.state.state} device identity does not match transcripts`);
      }
      return;
    default:
      return assertNeverLinkSessionStateV1(input.state);
  }
}

function requireTerminalRecordFacts(input: LinkedDeviceSessionRecordFactsV1, state: string): void {
  requireNoCommittedFacts(input, state);
  if (
    !input.claimTranscript &&
    (input.approvalTranscript || input.targetFactor || input.emailOtpChallenge)
  ) {
    throw new Error(`${state} session facts are incomplete`);
  }
  if (!input.approvalTranscript && input.emailOtpChallenge) {
    throw new Error(`${state} session email challenge has no approval`);
  }
  if (input.sourceContributionTranscript && !input.sourceContributionPreparation) {
    throw new Error(`${state} source contribution transcript has no preparation`);
  }
  if (input.sourceContributionPreparation && (!input.approvalTranscript || !input.targetFactor)) {
    throw new Error(`${state} source contribution preparation has no approval`);
  }
  if (input.approvalTranscript && !input.targetFactor) {
    throw new Error(`${state} session approval has no target factor`);
  }
  if (input.targetFactor?.kind === 'passkey_prf' && input.emailOtpChallenge) {
    throw new Error(`${state} passkey session contains email challenge state`);
  }
}

export function parseDeviceIdValue(raw: unknown): DeviceId {
  const parsed = parseDeviceId(raw);
  if (!parsed.ok) throw new Error(`deviceId: ${parsed.error.message}`);
  return parsed.value;
}

export function parseId<T>(
  raw: unknown,
  parser: (value: unknown) => DomainIdParseResult<T>,
  field: string,
): T {
  const parsed = parser(raw);
  if (!parsed.ok) throw new Error(`${field}: ${parsed.error.message}`);
  return parsed.value;
}

function parseOptionalId<T>(
  raw: unknown,
  parser: (value: unknown) => DomainIdParseResult<T>,
  field: string,
): T | undefined {
  return raw === undefined ? undefined : parseId(raw, parser, field);
}

function parseIdentityString(raw: unknown, field: string): string {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.trim() !== raw ||
    hasWhitespaceOrControlCharacters(raw)
  )
    throw new Error(`${field} is invalid`);
  return raw;
}

export function requireDigest(raw: unknown, field: string): DigestB64u {
  try {
    return parseDigestB64u(raw);
  } catch {
    throw new Error(`${field} is invalid`);
  }
}

function parseOptionalDigest(raw: unknown, field: string): DigestB64u | undefined {
  return raw === undefined ? undefined : requireDigest(raw, field);
}

export function requireTimestamp(raw: unknown, field: string): number {
  if (!Number.isSafeInteger(raw) || Number(raw) <= 0)
    throw new Error(`${field} must be a positive safe integer`);
  return Number(raw);
}

function requirePositiveInteger(raw: unknown, field: string): number {
  return requireTimestamp(raw, field);
}

function requireExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index]))
    throw new Error('record contains invalid fields');
}

function requireAllowedKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record))
    if (!allowedSet.has(key)) throw new Error('record contains invalid fields');
}

export function conflictResult(
  expectedRevision: number,
  record: LinkedDeviceSessionRecordV1 | null,
): LinkedDeviceSessionMutationResultV1 {
  return {
    outcome: 'conflict',
    expectedRevision,
    actualRevision: record?.revision ?? null,
    record,
  };
}

export function invalidStateResult(
  record: LinkedDeviceSessionRecordV1,
): LinkedDeviceSessionMutationResultV1 {
  return { outcome: 'invalid_state', state: record.state.state, record };
}

export function integrityResult(
  record: LinkedDeviceSessionRecordV1,
  reason: 'authority_id_mismatch' | 'package_set_digest_mismatch',
): LinkedDeviceSessionMutationResultV1 {
  return { outcome: 'integrity_error', reason, record };
}

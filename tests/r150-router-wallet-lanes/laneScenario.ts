// Host-independent Router signing-lane lifecycle scenario for R150.
//
// The scenario drives the real lane lifecycle domain logic (the enrollment
// gateway, LaneEnrollmentActivation, LaneEnrollmentRevocation and the three
// wallet-lane stores) through whatever `WalletLaneStoresV1` it is handed: a
// Router wallet Durable Object behind the store protocol, VM lane-service
// processes, or local SQL stores. It depends on nothing but that interface.
//
// Every record is a fully valid synthetic Ed25519 Yao linked-device lane
// creation: each value passes the shared parsers, and every identity, receipt
// and digest binding the store checks is computed from the real encoders.
// Ids and timestamps derive only from `seed`, so a second run with the same
// seed issues byte-identical commands and must observe durable replays.
//
// Assertions never throw. Each one is recorded as a step with the outcomes it
// accepts; `ok` is true only when every step passed.

import type {
  CommitLaneEnrollmentActivationV1,
  CompleteSigningLaneRevocationV1,
  Ed25519ServerRetirementReceiptV1,
  Ed25519YaoLaneCreationJobV1,
  LaneEnrollmentManifestV1,
  LaneHolderDeliveryReceiptV1,
  LaneProtocolCommitReceiptV1,
  LaneServerActivationReceiptV1,
  PrepareLaneEnrollmentV1,
  RevokeSigningLaneV1,
} from '../../packages/shared-ts/src/signing-lanes';
import {
  buildLaneHolderParticipantRecordWithDigestV1,
  buildLaneProtocolRecordV1,
  buildSigningWorkerParticipantRecordWithDigestV1,
  computeAggregateLaneActivationReceiptDigestV1,
  computeEd25519ServerRetirementReceiptDigestV1,
  computeLaneEnrollmentManifestDigestV1,
  computeLaneProtocolCommitReceiptDigestV1,
  computeOwnerLaneParticipantBindingDigestV1,
  computeRevokeSigningLaneDigestV1,
  encodeLaneHolderDeliveryReceiptV1,
  encodeLaneServerActivationReceiptV1,
  parseCommitLaneEnrollmentActivationV1,
  parseCompleteSigningLaneRevocationV1,
  parseEd25519ServerRetirementReceiptV1,
  parseHpkePublicKeyB64u,
  parseLaneCustodyBindingDigestB64u,
  parseLaneEnrollmentManifestV1,
  parseLaneHolderCustodyBindingId,
  parseLaneHolderDeliveryReceiptV1,
  parseLaneHolderParticipantId,
  parseLaneProtocolCommitReceiptV1,
  parseLaneServerActivationReceiptV1,
  parseOwnerLaneParticipantContinuityV1,
  parseRevokeSigningLaneV1,
  parseRotatableSigningLaneJobV1,
  parseSigningWorkerParticipantId,
  parseSigningWorkerRecipientKeyDigestB64u,
  parseSigningWorkerRecipientKeyId,
} from '../../packages/shared-ts/src/signing-lanes';
import { base64UrlEncode } from '../../packages/shared-ts/src/utils/base64';
import { sha256Bytes, sha256BytesUtf8 } from '../../packages/shared-ts/src/utils/digests';
import {
  parseMpcMaterialActivationRef,
  type DomainIdParseResult,
  type MpcMaterialActivationRef,
} from '../../packages/shared-ts/src/utils/domainIds';
import type { LaneEffectRecordV1 } from '../../packages/wallet-server/src/core/signingLanes/LaneEffectJournalStore';
import type { LaneEnrollmentAdmissionInput } from '../../packages/wallet-server/src/core/signingLanes/LaneLifecycleStore';
import { WalletLaneEnrollmentGateway } from '../../packages/wallet-server/src/core/signingLanes/walletLanes/walletLaneEnrollmentGateway';
import {
  parseWalletLaneOwnerV1,
  type WalletLaneOwnerV1,
} from '../../packages/wallet-server/src/core/signingLanes/walletLanes/walletLaneRecords';
import type { WalletLaneStoresV1 } from '../../packages/wallet-server/src/core/signingLanes/walletLanes/walletLaneStoreProtocol';

// ------------------------------------------------------------------ owners

const OWNER_SCOPE = {
  namespace: 'r150-router-wallet-lanes',
  orgId: 'org-r150-lane-e2e',
  projectId: 'project-r150-lane-e2e',
  envId: 'env-r150-lane-e2e',
} as const;

/** The synthetic wallet every scenario enrolls lanes for. */
export const SCENARIO_OWNER: WalletLaneOwnerV1 = parseWalletLaneOwnerV1({
  ...OWNER_SCOPE,
  walletId: 'wallet-r150-lane-scenario',
});

/** Same tenant scope, different wallet: its records must never enter SCENARIO_OWNER's store. */
export const OTHER_WALLET_OWNER: WalletLaneOwnerV1 = parseWalletLaneOwnerV1({
  ...OWNER_SCOPE,
  walletId: 'wallet-r150-lane-other',
});

// -------------------------------------------------------------- evidence

export type LaneScenarioStepV1 = {
  readonly name: string;
  /** What the domain returned: its `outcome`, a boolean, `rejected`, `pass`/`fail`, or `threw`. */
  readonly outcome: string;
  readonly ok: boolean;
  readonly expected: readonly string[];
  readonly detail?: unknown;
};

export type LaneScenarioEvidence = {
  readonly kind: 'r150_router_wallet_lane_scenario_v1';
  readonly label: string;
  readonly seed: string;
  readonly mode: 'first_run' | 'replay';
  readonly strictReplay: boolean;
  readonly ok: boolean;
  readonly keyFamily: 'ed25519';
  readonly jobKind: 'ed25519_yao_lane_job_v1';
  readonly operation: 'create_lane';
  readonly usedReplayStores: boolean;
  readonly enrollmentId: string;
  readonly operationId: string;
  readonly walletId: string;
  readonly walletKeyId: string;
  readonly laneId: string;
  readonly laneShareEpoch: string;
  readonly steps: readonly LaneScenarioStepV1[];
  readonly failures: readonly string[];
  /** Replay-mode steps whose exact retry was not reported as `replayed`/`already_completed`. */
  readonly nonReplayRetries: readonly { readonly name: string; readonly outcome: string }[];
  readonly finalStates: {
    readonly enrollmentLifecycleState: string | null;
    readonly enrollmentVersion: number | null;
    readonly protocolLifecycleState: string | null;
    readonly protocolVersion: number | null;
    readonly productEpochState: string | null;
    readonly productRevocationEpoch: number | null;
    readonly effectStatus: string | null;
    readonly effectVersion: number | null;
  };
};

export type LaneCasRaceEvidence = {
  readonly kind: 'r150_router_wallet_lane_cas_race_v1';
  readonly seed: string;
  readonly ok: boolean;
  readonly applied: number;
  readonly conflictOrReplay: number;
  readonly enrollmentId: string;
  readonly operationId: string;
  readonly prepareOutcome: string;
  readonly outcomes: readonly { readonly caller: 'first' | 'second'; readonly outcome: string; readonly transcriptHashB64u: string }[];
  readonly winner: 'first' | 'second' | null;
  readonly loserOutcome: string | null;
  readonly storedLifecycleState: string | null;
  readonly storedVersion: number | null;
  readonly storedTranscriptHashB64u: string | null;
  readonly storedMatchesWinner: boolean;
  readonly failures: readonly string[];
};

// --------------------------------------------------------------- time

/**
 * Domain time base, 2100-01-01T00:00:00Z. Fixed rather than read from a clock
 * so repeated runs issue identical commands. It is deliberately later than
 * any host clock: the product-epoch row stamps `created_at_ms` from the
 * store's clock but later sets `updated_at_ms` from the command's
 * `requestedAtMs`/`revokedAtMs`, and the table CHECKs
 * `updated_at_ms >= created_at_ms`. See the R150 report.
 */
export const LANE_SCENARIO_TIME_BASE_MS = Date.UTC(2100, 0, 1);

function laneTimes(base: number) {
  return {
    createdAtMs: base,
    expiresAtMs: base + 3_600_000,
    lockNowMs: base + 500,
    committedAtMs: base + 1_000,
    acknowledgedAtMs: base + 2_000,
    effectRecordedAtMs: base + 2_500,
    serverActivatedAtMs: base + 3_000,
    effectConfirmedAtMs: base + 3_500,
    visibleAtMs: base + 4_000,
    revocationRequestedAtMs: base + 5_000,
    retiredAtMs: base + 5_500,
    revokedAtMs: base + 6_000,
  };
}

// ------------------------------------------------------------ fixtures

type LaneFixture = Awaited<ReturnType<typeof buildLaneFixture>>;

function seedSlug(seed: string): string {
  if (typeof seed !== 'string' || seed.length === 0) throw new Error('lane scenario seed is required');
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(seed)) {
    throw new Error('lane scenario seed must be 1-64 characters of [A-Za-z0-9._-]');
  }
  return seed;
}

function unwrap<T>(result: DomainIdParseResult<T>, label: string): T {
  if (!result.ok) throw new Error(`${label}: ${result.error.message}`);
  return result.value;
}

function activationRef(raw: Record<string, string>): MpcMaterialActivationRef {
  return unwrap(
    parseMpcMaterialActivationRef({ kind: 'mpc_material_activation_ref', ...raw }),
    'material activation',
  );
}

async function sha256B64u(bytes: Uint8Array): Promise<string> {
  return base64UrlEncode(await sha256Bytes(bytes));
}

/**
 * Builds every record of one Ed25519 linked-device lane creation for `owner`.
 * `variant` separates the scenario, race and foreign-wallet enrollments that
 * share a seed.
 */
async function buildLaneFixture(input: {
  readonly owner: WalletLaneOwnerV1;
  readonly seed: string;
  readonly variant: string;
  readonly timeBaseMs: number;
}) {
  const scope = `${input.variant}.${seedSlug(input.seed)}`;
  const id = (what: string) => `r150-${what}-${scope}`;
  const bytes32 = async (label: string) =>
    await sha256BytesUtf8(`seams/r150-router-wallet-lanes/fixture/v1\u0000${scope}\u0000${label}`);
  const digestOf = async (label: string) => base64UrlEncode(await bytes32(label));
  const times = laneTimes(input.timeBaseMs);
  const walletId = String(input.owner.walletId);

  // Source: the owner's passkey lane, bound by owner participant continuity.
  const sourceActivation = activationRef({
    activationId: id('activation-source'),
    capability: id('capability'),
    materialOwner: id('material-owner'),
    keyBinding: id('key-binding'),
    lifecycleBinding: id('lifecycle-binding'),
    signingWorker: id('signing-worker-source'),
  });
  const ownerContinuity = parseOwnerLaneParticipantContinuityV1({
    kind: 'owner_lane_participant_continuity_v1',
    signerId: id('owner-signer'),
    participantIds: [1, 2],
    signingWorkerId: id('signing-worker-source'),
    custodyKeyManifestDigestB64u: await digestOf('owner-custody-key-manifest'),
    sourceIdentityDigestB64u: await digestOf('owner-source-identity'),
  });
  const sourceParticipantBindingDigestB64u =
    await computeOwnerLaneParticipantBindingDigestV1(ownerContinuity);

  // Target participants, with their binding digests computed canonically.
  const holderHpkeBytes = await bytes32('holder-hpke-public-key');
  const holderHpkePublicKeyB64u = unwrap(
    parseHpkePublicKeyB64u(base64UrlEncode(holderHpkeBytes)),
    'holder HPKE key',
  );
  const holderHpkeDigestB64u = unwrap(
    parseSigningWorkerRecipientKeyDigestB64u(await sha256B64u(holderHpkeBytes)),
    'holder HPKE digest',
  );
  const holderParticipant = await buildLaneHolderParticipantRecordWithDigestV1({
    participantId: unwrap(parseLaneHolderParticipantId(id('holder')), 'holder id'),
    custody: {
      kind: 'lane_holder_custody_identity_v1',
      custodyBindingId: unwrap(parseLaneHolderCustodyBindingId(id('holder-custody')), 'custody id'),
      custodyBindingDigestB64u: unwrap(
        parseLaneCustodyBindingDigestB64u(await digestOf('holder-custody-binding')),
        'custody digest',
      ),
    },
    hpkePublicKeyB64u: holderHpkePublicKeyB64u,
    hpkePublicKeyDigestB64u: holderHpkeDigestB64u,
  });
  const workerHpkeBytes = await bytes32('signing-worker-hpke-public-key');
  const signingWorkerParticipant = await buildSigningWorkerParticipantRecordWithDigestV1({
    participantId: unwrap(parseSigningWorkerParticipantId(id('signing-worker')), 'worker id'),
    recipient: {
      kind: 'signing_worker_recipient_identity_v1',
      recipientKeyId: unwrap(parseSigningWorkerRecipientKeyId(id('signing-worker-recipient')), 'recipient id'),
      hpkePublicKeyB64u: unwrap(parseHpkePublicKeyB64u(base64UrlEncode(workerHpkeBytes)), 'worker HPKE key'),
      hpkePublicKeyDigestB64u: unwrap(
        parseSigningWorkerRecipientKeyDigestB64u(await sha256B64u(workerHpkeBytes)),
        'worker HPKE digest',
      ),
    },
  });

  const authorization = {
    kind: 'linked_device_enrollment',
    authorizedOperationId: id('authorized-operation'),
    linkedDeviceEnrollmentId: id('linked-device-enrollment'),
    linkedDevicePermissionDigestB64u: await digestOf('linked-device-permission'),
  };

  const parsedJob = parseRotatableSigningLaneJobV1({
    kind: 'ed25519_yao_lane_job_v1',
    keyFamily: 'ed25519',
    operationId: id('operation'),
    enrollmentId: id('enrollment'),
    idempotencyKey: id('idempotency'),
    walletId,
    walletKeyId: id('wallet-key'),
    source: {
      sourceKind: 'owner_registration',
      laneId: id('lane-owner-passkey'),
      laneKind: 'owner_passkey',
      laneShareEpoch: 'epoch-1',
      revocationEpoch: 0,
      ownerParticipantContinuity: ownerContinuity,
      participantBindingDigestB64u: sourceParticipantBindingDigestB64u,
      materialActivation: sourceActivation,
    },
    targetHolder: {
      participantId: holderParticipant.participantId,
      participantBindingDigestB64u: holderParticipant.participantBindingDigestB64u,
      custodyBindingId: holderParticipant.custodyBindingId,
      custodyBindingDigestB64u: holderParticipant.custodyBindingDigestB64u,
      hpkePublicKeyB64u: holderParticipant.hpkePublicKeyB64u,
      hpkePublicKeyDigestB64u: holderParticipant.hpkePublicKeyDigestB64u,
    },
    targetSigningWorker: {
      participantId: signingWorkerParticipant.participantId,
      participantBindingDigestB64u: signingWorkerParticipant.participantBindingDigestB64u,
      recipientKeyId: signingWorkerParticipant.recipientKeyId,
      hpkePublicKeyB64u: signingWorkerParticipant.hpkePublicKeyB64u,
      hpkePublicKeyDigestB64u: signingWorkerParticipant.hpkePublicKeyDigestB64u,
    },
    targetMaterialActivationId: id('activation-target'),
    protocolVersion: 'rotatable_signing_lane_protocol_v1',
    expiresAtMs: times.expiresAtMs,
    target: {
      operation: 'create_lane',
      laneId: id('lane-linked-device'),
      laneKind: 'linked_device',
      laneShareEpoch: 'epoch-1',
      expectedTargetState: 'absent',
    },
    authorization,
    yaoRequestKind: 'lane_provisioning',
    registeredPublicKeyB64u: base64UrlEncode(await bytes32('registered-ed25519-public-key')),
    nearEd25519SigningKeyId: id('near-ed25519-key'),
    keyCreationSignerSlot: 1,
    stableContextBindingB64u: await digestOf('stable-context-binding'),
    yaoSuiteId: 'ed25519-yao-suite-r150-test',
    circuitDigestB64u: await digestOf('yao-circuit'),
  });
  if (parsedJob.kind !== 'ed25519_yao_lane_job_v1' || parsedJob.target.operation !== 'create_lane') {
    throw new Error('lane fixture did not produce an Ed25519 creation job');
  }
  // Checked above; TypeScript does not narrow on the nested `target.operation`.
  const job = parsedJob as Ed25519YaoLaneCreationJobV1;

  const manifest: LaneEnrollmentManifestV1 = parseLaneEnrollmentManifestV1({
    kind: 'lane_enrollment_manifest_v1',
    enrollmentId: job.enrollmentId,
    walletId,
    authorization: job.authorization,
    orderedChildren: [
      {
        operationId: job.operationId,
        walletKeyId: job.walletKeyId,
        keyFamily: job.keyFamily,
        sourceLaneId: job.source.laneId,
        sourceLaneShareEpoch: job.source.laneShareEpoch,
        sourceRevocationEpoch: job.source.revocationEpoch,
        sourceMaterialActivation: job.source.materialActivation,
        targetLaneId: job.target.laneId,
        targetLaneShareEpoch: job.target.laneShareEpoch,
        targetMaterialActivationId: job.targetMaterialActivationId,
        holderParticipantBindingDigestB64u: job.targetHolder.participantBindingDigestB64u,
        signingWorkerParticipantBindingDigestB64u: job.targetSigningWorker.participantBindingDigestB64u,
      },
    ],
    createdAtMs: times.createdAtMs,
    expiresAtMs: times.expiresAtMs,
  });
  const manifestDigestB64u = await computeLaneEnrollmentManifestDigestV1(manifest);
  const prepare: PrepareLaneEnrollmentV1 = { manifest, children: [job] };

  const commitReceiptFor = async (transcriptLabel: string): Promise<LaneProtocolCommitReceiptV1> =>
    parseLaneProtocolCommitReceiptV1({
      kind: 'lane_protocol_commit_receipt_v1',
      operationId: job.operationId,
      enrollmentId: job.enrollmentId,
      walletId,
      walletKeyId: job.walletKeyId,
      sourceLaneId: job.source.laneId,
      sourceLaneShareEpoch: job.source.laneShareEpoch,
      sourceRevocationEpoch: job.source.revocationEpoch,
      sourceMaterialActivation: job.source.materialActivation,
      targetLaneId: job.target.laneId,
      targetLaneShareEpoch: job.target.laneShareEpoch,
      targetMaterialActivationId: job.targetMaterialActivationId,
      keyFamily: 'ed25519',
      publicIdentityDigestB64u: await digestOf('public-identity'),
      targetHolderPublicCommitmentB64u: base64UrlEncode(await bytes32('holder-public-commitment')),
      targetServerPublicCommitmentB64u: base64UrlEncode(await bytes32('server-public-commitment')),
      targetHolderCiphertextDigestSetB64u: await digestOf('holder-ciphertext-set'),
      targetServerCiphertextDigestSetB64u: await digestOf('server-ciphertext-set'),
      holderRecipientKeyDigestB64u: job.targetHolder.hpkePublicKeyDigestB64u,
      serverRecipientKeyDigestB64u: job.targetSigningWorker.hpkePublicKeyDigestB64u,
      transcriptHashB64u: await digestOf(transcriptLabel),
      committedAtMs: times.committedAtMs,
    });
  const commitReceipt = await commitReceiptFor('transcript');
  const commitReceiptDigestB64u = await computeLaneProtocolCommitReceiptDigestV1(commitReceipt);
  // Same operation, a different transcript: must never replace the committed one.
  const conflictingCommitReceipt = await commitReceiptFor('transcript-conflicting');
  const conflictingCommitReceiptDigestB64u =
    await computeLaneProtocolCommitReceiptDigestV1(conflictingCommitReceipt);

  const holderReceipt: LaneHolderDeliveryReceiptV1 = parseLaneHolderDeliveryReceiptV1({
    kind: 'lane_holder_delivery_receipt_v1',
    operationId: job.operationId,
    enrollmentId: job.enrollmentId,
    targetLaneId: job.target.laneId,
    targetLaneShareEpoch: job.target.laneShareEpoch,
    targetMaterialActivationId: job.targetMaterialActivationId,
    holderParticipantBindingDigestB64u: job.targetHolder.participantBindingDigestB64u,
    holderRecipientKeyDigestB64u: job.targetHolder.hpkePublicKeyDigestB64u,
    holderCiphertextDigestSetB64u: commitReceipt.targetHolderCiphertextDigestSetB64u,
    sealedHolderRecordDigestB64u: await digestOf('sealed-holder-record'),
    transcriptHashB64u: commitReceipt.transcriptHashB64u,
    acknowledgedAtMs: times.acknowledgedAtMs,
  });
  const holderReceiptDigestB64u = await sha256B64u(encodeLaneHolderDeliveryReceiptV1(holderReceipt));

  const targetActivation = activationRef({
    activationId: String(job.targetMaterialActivationId),
    capability: String(sourceActivation.capability),
    materialOwner: String(sourceActivation.materialOwner),
    keyBinding: String(sourceActivation.keyBinding),
    lifecycleBinding: String(sourceActivation.lifecycleBinding),
    signingWorker: String(job.targetSigningWorker.participantId),
  });
  const serverReceipt: LaneServerActivationReceiptV1 = parseLaneServerActivationReceiptV1({
    kind: 'lane_server_activation_receipt_v1',
    operationId: job.operationId,
    enrollmentId: job.enrollmentId,
    targetLaneId: job.target.laneId,
    targetLaneShareEpoch: job.target.laneShareEpoch,
    targetMaterialActivation: targetActivation,
    signingWorkerParticipantBindingDigestB64u: job.targetSigningWorker.participantBindingDigestB64u,
    serverCiphertextDigestSetB64u: commitReceipt.targetServerCiphertextDigestSetB64u,
    transcriptHashB64u: commitReceipt.transcriptHashB64u,
    activatedAtMs: times.serverActivatedAtMs,
  });
  const serverReceiptDigestB64u = await sha256B64u(encodeLaneServerActivationReceiptV1(serverReceipt));

  const visibility: CommitLaneEnrollmentActivationV1 = parseCommitLaneEnrollmentActivationV1({
    kind: 'commit_lane_enrollment_activation_v1',
    enrollmentId: job.enrollmentId,
    walletId,
    manifestDigestB64u,
    orderedChildReceipts: [
      {
        operationId: job.operationId,
        walletKeyId: job.walletKeyId,
        targetLaneId: job.target.laneId,
        targetLaneShareEpoch: job.target.laneShareEpoch,
        targetMaterialActivation: targetActivation,
        protocolCommitReceiptDigestB64u: commitReceiptDigestB64u,
        holderDeliveryReceiptDigestB64u: holderReceiptDigestB64u,
        serverActivationReceiptDigestB64u: serverReceiptDigestB64u,
      },
    ],
    orderedPredecessorRetirements: [],
    activatedAtMs: times.visibleAtMs,
  });
  const aggregateActivationDigestB64u = await computeAggregateLaneActivationReceiptDigestV1({
    kind: 'aggregate_lane_activation_receipt_v1',
    enrollmentId: visibility.enrollmentId,
    walletId: visibility.walletId,
    manifestDigestB64u: visibility.manifestDigestB64u,
    orderedChildReceipts: visibility.orderedChildReceipts,
    activatedAtMs: visibility.activatedAtMs,
  });

  // Signing-lane revocation of the new linked-device lane.
  const revoke: RevokeSigningLaneV1 = parseRevokeSigningLaneV1({
    kind: 'revoke_signing_lane_v1',
    walletId,
    walletKeyId: job.walletKeyId,
    laneId: job.target.laneId,
    laneShareEpoch: job.target.laneShareEpoch,
    expectedRevocationEpoch: job.source.revocationEpoch,
    reason: 'user_revoked',
    retirementCorrelationId: id('retirement'),
    retirementRequestDigestB64u: await digestOf('retirement-request'),
    retirementEffectBindingDigestB64u: await digestOf('retirement-effect-binding'),
    requestedAtMs: times.revocationRequestedAtMs,
  });
  const revokeDigestB64u = await computeRevokeSigningLaneDigestV1(revoke);
  const retirementDraft = {
    kind: 'ed25519_server_retirement_receipt_v1',
    identity: {
      operationId: job.operationId,
      enrollmentId: job.enrollmentId,
      walletId,
      walletKeyId: job.walletKeyId,
      targetLaneId: job.target.laneId,
      targetLaneShareEpoch: job.target.laneShareEpoch,
      targetMaterialActivationId: job.targetMaterialActivationId,
      keyFamily: 'ed25519',
      holderParticipantBindingDigestB64u: job.targetHolder.participantBindingDigestB64u,
      signingWorkerParticipantBindingDigestB64u: job.targetSigningWorker.participantBindingDigestB64u,
      holderRecipientKeyDigestB64u: job.targetHolder.hpkePublicKeyDigestB64u,
      serverRecipientKeyDigestB64u: job.targetSigningWorker.hpkePublicKeyDigestB64u,
      transcriptHashB64u: commitReceipt.transcriptHashB64u,
      protocolCommitReceiptDigestB64u: commitReceiptDigestB64u,
    },
    revocationEpoch: revoke.expectedRevocationEpoch,
    retirementReason: 'lane_revoked',
    retirementCorrelationId: revoke.retirementCorrelationId,
    retirementRequestDigestB64u: revoke.retirementRequestDigestB64u,
    // The canonical payload excludes the self-digest; it is filled in below.
    receiptDigestB64u: await digestOf('retirement-receipt-placeholder'),
    retiredAtMs: times.retiredAtMs,
  };
  const retirementReceiptDigestB64u = await computeEd25519ServerRetirementReceiptDigestV1(
    parseEd25519ServerRetirementReceiptV1(retirementDraft),
  );
  const retirementReceipt: Ed25519ServerRetirementReceiptV1 = parseEd25519ServerRetirementReceiptV1({
    ...retirementDraft,
    receiptDigestB64u: retirementReceiptDigestB64u,
  });
  // Versions of the product-epoch row: pending (1), active (2), fenced (3), revoked (4).
  const completion: CompleteSigningLaneRevocationV1 = parseCompleteSigningLaneRevocationV1({
    kind: 'complete_signing_lane_revocation_v1',
    command: revoke,
    expectedVersion: 3,
    commandDigestB64u: revokeDigestB64u,
    retirementReceipt,
    revokedAtMs: times.revokedAtMs,
  });

  const effect: LaneEffectRecordV1 = {
    kind: 'lane_effect_record_v1',
    effectId: id('effect-activate-server'),
    enrollmentId: job.enrollmentId,
    operationId: job.operationId,
    walletId: job.walletId,
    walletKeyId: job.walletKeyId,
    laneId: job.target.laneId,
    laneShareEpoch: job.target.laneShareEpoch,
    effectKind: 'activate_server_material',
    requestDigestB64u: await digestOf('effect-activate-server-request'),
    recordedAtMs: times.effectRecordedAtMs,
    status: 'recorded',
  };

  const admission: LaneEnrollmentAdmissionInput = {
    manifest,
    children: [
      buildLaneProtocolRecordV1({
        job,
        lifecycle: { state: 'awaiting_protocol_commitment', startedAtMs: manifest.createdAtMs },
      }),
    ],
    commandDigestB64u: manifestDigestB64u,
    lifecycle: { state: 'preparing', manifestDigestB64u, startedAtMs: manifest.createdAtMs },
  };

  return {
    times,
    job,
    manifest,
    manifestDigestB64u,
    prepare,
    admission,
    commitReceipt,
    commitReceiptDigestB64u,
    conflictingCommitReceipt,
    conflictingCommitReceiptDigestB64u,
    commitReceiptFor,
    holderReceipt,
    holderReceiptDigestB64u,
    serverReceipt,
    serverReceiptDigestB64u,
    targetActivation,
    visibility,
    aggregateActivationDigestB64u,
    revoke,
    revokeDigestB64u,
    retirementReceipt,
    retirementReceiptDigestB64u,
    completion,
    effect,
    effectCommandDigestB64u: await digestOf('effect-record-command'),
    effectConfirmCommandDigestB64u: await digestOf('effect-confirm-command'),
    effectResponseDigestB64u: await digestOf('effect-activate-server-response'),
    lockIds: { holder: id('lock-holder'), contender: id('lock-contender') },
    productLookup: {
      walletId: job.walletId,
      walletKeyId: job.walletKeyId,
      laneId: job.target.laneId,
      laneShareEpoch: job.target.laneShareEpoch,
    },
  };
}

// ------------------------------------------------------------ recording

type Outcome = { readonly outcome: string; readonly detail?: unknown };

class StepRecorder {
  readonly steps: LaneScenarioStepV1[] = [];
  readonly failures: string[] = [];

  record(name: string, expected: readonly string[], observed: Outcome, extraFailure?: string | null) {
    const ok = expected.includes(observed.outcome) && !extraFailure;
    const detail =
      extraFailure === undefined || extraFailure === null
        ? observed.detail
        : { ...(isPlainRecord(observed.detail) ? observed.detail : { value: observed.detail }), failure: extraFailure };
    this.steps.push({ name, outcome: observed.outcome, ok, expected, ...(detail === undefined ? {} : { detail }) });
    if (!ok) {
      this.failures.push(
        `${name}: expected ${expected.join('|')}, observed ${observed.outcome}${extraFailure ? ` (${extraFailure})` : ''}`,
      );
    }
    return ok;
  }

  /** Runs a mutating call and checks its `outcome`; `verify` returns a failure reason or null. */
  async outcome<T extends { readonly outcome: string }>(
    name: string,
    expected: readonly string[],
    run: () => Promise<T>,
    verify?: (value: T) => string | null,
    summarize?: (value: T) => unknown,
  ): Promise<T | undefined> {
    let value: T;
    try {
      value = await run();
    } catch (error) {
      this.record(name, expected, { outcome: 'threw', detail: { error: errorMessage(error) } });
      return undefined;
    }
    let failure: string | null = null;
    if (verify && expected.includes(value.outcome)) {
      try {
        failure = verify(value);
      } catch (error) {
        failure = `verification threw: ${errorMessage(error)}`;
      }
    }
    this.record(name, expected, { outcome: value.outcome, detail: summarize?.(value) ?? outcomeSummary(value) }, failure);
    return value;
  }

  /**
   * Like `outcome`, but a rejection whose message matches `rejection` is
   * reported as the outcome `rejected` rather than `threw`.
   */
  async outcomeOrRejection<T extends { readonly outcome: string }>(
    name: string,
    expected: readonly string[],
    rejection: RegExp,
    run: () => Promise<T>,
    verify?: (value: T) => string | null,
  ): Promise<T | undefined> {
    let value: T;
    try {
      value = await run();
    } catch (error) {
      const message = errorMessage(error);
      this.record(name, expected, { outcome: rejection.test(message) ? 'rejected' : 'threw', detail: { error: message } });
      return undefined;
    }
    let failure: string | null = null;
    if (verify && expected.includes(value.outcome)) {
      try {
        failure = verify(value);
      } catch (error) {
        failure = `verification threw: ${errorMessage(error)}`;
      }
    }
    this.record(name, expected, { outcome: value.outcome, detail: outcomeSummary(value) }, failure);
    return value;
  }

  /** The call must reject with a message matching `pattern`. */
  async rejects(name: string, pattern: RegExp, run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
      this.record(name, ['rejected'], { outcome: 'resolved' });
    } catch (error) {
      const message = errorMessage(error);
      this.record(name, ['rejected'], { outcome: pattern.test(message) ? 'rejected' : 'threw', detail: { error: message } });
    }
  }

  /** A boolean-returning call. */
  async boolean(name: string, expected: boolean, run: () => Promise<boolean>): Promise<void> {
    try {
      const value = await run();
      this.record(name, [String(expected)], { outcome: String(value) });
    } catch (error) {
      this.record(name, [String(expected)], { outcome: 'threw', detail: { error: errorMessage(error) } });
    }
  }

  /** A read-side assertion; `check` returns a failure reason or null. */
  async check(name: string, check: () => Promise<{ failure: string | null; detail?: unknown }>): Promise<void> {
    try {
      const result = await check();
      this.record(name, ['pass'], { outcome: result.failure ? 'fail' : 'pass', detail: result.detail }, result.failure);
    } catch (error) {
      this.record(name, ['pass'], { outcome: 'threw', detail: { error: errorMessage(error) } });
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A small JSON-safe summary of any lane mutation result. */
function outcomeSummary(value: object): Record<string, unknown> {
  const record = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ['version', 'expectedVersion', 'actualVersion', 'commandDigestB64u', 'requestedCommandDigestB64u', 'storedCommandDigestB64u']) {
    if (record[key] !== undefined) summary[key] = record[key];
  }
  const nested = (record.record ?? record.value) as Record<string, unknown> | undefined;
  const lifecycle = (nested?.lifecycle ?? record.lifecycle) as { state?: unknown } | undefined;
  if (lifecycle && typeof lifecycle.state === 'string') summary.lifecycleState = lifecycle.state;
  const product = record.productEpoch as { state?: unknown; revocationEpoch?: unknown } | undefined;
  if (product && typeof product.state === 'string') {
    summary.productEpochState = product.state;
    summary.productRevocationEpoch = product.revocationEpoch;
  }
  const epochs = record.productEpochs as readonly { state?: unknown }[] | undefined;
  if (Array.isArray(epochs)) summary.productEpochStates = epochs.map((epoch) => epoch.state);
  const effect = record.record as { status?: unknown } | undefined;
  if (effect && typeof effect.status === 'string') summary.effectStatus = effect.status;
  return summary;
}

function expectEqual(label: string, actual: unknown, expected: unknown): string | null {
  return actual === expected ? null : `${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
}

function firstFailure(...failures: readonly (string | null)[]): string | null {
  return failures.find((failure) => failure !== null) ?? null;
}

// -------------------------------------------------------------- scenario

/** Durable state the scenario owns, as JSON, for before/after comparison. */
async function snapshotLaneState(stores: WalletLaneStoresV1, fixture: LaneFixture): Promise<string> {
  const [enrollment, protocol, products, effect] = await Promise.all([
    stores.lifecycle.getEnrollment(fixture.job.enrollmentId),
    stores.lifecycle.getProtocol(fixture.job.operationId),
    stores.lifecycle.listEnrollmentProductEpochs(fixture.job.enrollmentId),
    stores.effects.getEffect({ effectId: fixture.effect.effectId }),
  ]);
  return JSON.stringify({ enrollment, protocol, products, effect });
}

/**
 * Runs the full lifecycle of one linked-device lane against `stores`. With
 * `replayStores`, every exact duplicate goes through that second handle
 * (another process or connection). With `expectReplay`, the same seed has
 * already completed on this database: every retry must be non-applying and
 * the durable state must be unchanged afterwards.
 */
export async function runLaneLifecycleScenario(input: {
  readonly stores: WalletLaneStoresV1;
  readonly replayStores?: WalletLaneStoresV1;
  readonly label: string;
  readonly seed: string;
  readonly expectReplay?: boolean;
  /**
   * With `expectReplay`, accept only `replayed`/`already_completed` for every
   * exact retry. By default the scenario also accepts the non-applying
   * outcome the domain returns for a retry that arrives after later stages
   * (see `nonReplayRetries`), provided durable state is unchanged.
   */
  readonly strictReplay?: boolean;
  /** The owner `stores` is bound to. Defaults to SCENARIO_OWNER. */
  readonly owner?: WalletLaneOwnerV1;
  /** Domain time base. Defaults to LANE_SCENARIO_TIME_BASE_MS; override only to probe clock handling. */
  readonly timeBaseMs?: number;
}): Promise<LaneScenarioEvidence> {
  const owner = input.owner ?? SCENARIO_OWNER;
  const foreignOwner =
    String(owner.walletId) === String(OTHER_WALLET_OWNER.walletId) ? SCENARIO_OWNER : OTHER_WALLET_OWNER;
  const replay = input.expectReplay === true;
  const strictReplay = input.strictReplay === true;
  const timeBaseMs = input.timeBaseMs ?? LANE_SCENARIO_TIME_BASE_MS;
  const fixture = await buildLaneFixture({ owner, seed: input.seed, variant: 'scenario', timeBaseMs });
  const foreign = await buildLaneFixture({ owner: foreignOwner, seed: input.seed, variant: 'foreign', timeBaseMs });
  const primary = input.stores;
  const duplicate = input.replayStores ?? input.stores;
  const gateway = new WalletLaneEnrollmentGateway({ lifecycleStore: primary.lifecycle });
  const duplicateGateway = new WalletLaneEnrollmentGateway({ lifecycleStore: duplicate.lifecycle });
  const steps = new StepRecorder();
  const { job } = fixture;
  // Exact retries on a completed seed: `replayed` is what an idempotent retry
  // should report. Where the domain reports something else for a retry that
  // arrives after later stages (prepare and effect admission: `conflict`;
  // visibility commit once the lane is revoked: a rejection), that outcome is
  // accepted only because the durable state is proven unchanged at the end,
  // and it is listed in `nonReplayRetries`. `strictReplay` refuses it.
  const COMPLETED = new Set(['replayed', 'already_completed']);
  const lenient = (outcomes: readonly string[]) =>
    strictReplay ? outcomes.filter((outcome) => COMPLETED.has(outcome)) : [...outcomes];
  const retry = (strict: string, ...postCompletion: string[]) =>
    replay ? lenient([strict, ...postCompletion]) : [strict];
  const first = (value: string, onReplay: readonly string[]) => (replay ? lenient(onReplay) : [value]);

  const before = replay ? await snapshotLaneState(primary, fixture).catch((error) => `snapshot threw: ${errorMessage(error)}`) : null;

  // (h) Owner isolation first: nothing for another wallet may enter this store.
  await steps.rejects('owner isolation: foreign-wallet enrollment admission', /belongs to another wallet/, () =>
    primary.lifecycle.putEnrollmentAdmission(foreign.admission),
  );
  await steps.rejects('owner isolation: foreign-wallet prepare through the gateway', /belongs to another wallet/, () =>
    gateway.prepareLaneEnrollmentV1(foreign.prepare),
  );
  await steps.rejects('owner isolation: foreign-wallet product-epoch lookup', /belongs to another wallet/, () =>
    primary.lifecycle.getProductEpoch(foreign.productLookup),
  );
  await steps.rejects('owner isolation: foreign-wallet effect record', /belongs to another wallet/, () =>
    primary.effects.recordEffect({ record: foreign.effect, commandDigestB64u: foreign.effectCommandDigestB64u }),
  );
  await steps.check('owner isolation: nothing of the foreign enrollment was written', async () => {
    const [enrollment, protocol] = await Promise.all([
      primary.lifecycle.getEnrollment(foreign.job.enrollmentId),
      primary.lifecycle.getProtocol(foreign.job.operationId),
    ]);
    return {
      failure: enrollment === null && protocol === null ? null : 'foreign enrollment or protocol is readable',
    };
  });

  // (a) Prepare, then an identical prepare.
  await steps.outcome(
    'prepare lane enrollment',
    first('applied', ['replayed', 'conflict']),
    () => gateway.prepareLaneEnrollmentV1(fixture.prepare),
    (result) =>
      replay || result.outcome === 'conflict'
        ? null
        : firstFailure(
            expectEqual('enrollment version', result.version, 1),
            expectEqual('enrollment lifecycle', result.lifecycle.state, 'preparing'),
            expectEqual('child protocol version', result.orderedProtocols[0].version, 1),
            expectEqual('child lifecycle', result.orderedProtocols[0].record.lifecycle.state, 'awaiting_protocol_commitment'),
          ),
  );
  await steps.outcome(
    'prepare lane enrollment (exact duplicate)',
    retry('replayed', 'conflict'),
    () => duplicateGateway.prepareLaneEnrollmentV1(fixture.prepare),
  );

  // (b) Protocol commit and its duplicate.
  await steps.outcome(
    'record protocol commit',
    first('applied', ['replayed']),
    () => gateway.recordLaneProtocolCommitV1({ receipt: fixture.commitReceipt, expectedVersion: 1 }),
    (result) =>
      result.outcome !== 'applied'
        ? null
        : firstFailure(
            expectEqual('protocol version', result.version, 2),
            expectEqual('protocol lifecycle', result.record.lifecycle.state, 'committed_awaiting_holder_delivery'),
            result.record.lifecycle.state === 'committed_awaiting_holder_delivery'
              ? expectEqual('protocol commit receipt digest', result.record.lifecycle.protocolCommitReceiptDigestB64u, fixture.commitReceiptDigestB64u)
              : null,
          ),
  );
  await steps.outcome('record protocol commit (exact duplicate)', ['replayed'], () =>
    duplicateGateway.recordLaneProtocolCommitV1({ receipt: fixture.commitReceipt, expectedVersion: 1 }),
  );

  // (c) A different transcript for the same operation conflicts and changes nothing.
  const beforeConflict = await readProtocolJson(primary, fixture);
  await steps.outcome('conflicting protocol commit (different transcript)', ['conflict'], () =>
    gateway.recordLaneProtocolCommitV1({ receipt: fixture.conflictingCommitReceipt, expectedVersion: 1 }),
  );
  await steps.outcome('conflicting protocol commit receipt at the store', ['conflict'], () =>
    primary.lifecycle.putProtocolCommitReceipt(
      fixture.conflictingCommitReceipt,
      fixture.conflictingCommitReceiptDigestB64u,
    ),
  );
  await steps.check('conflicting commits leave the protocol unchanged', async () => {
    const after = await readProtocolJson(primary, fixture);
    return { failure: after === beforeConflict ? null : 'protocol record changed after a conflicting commit' };
  });

  // (b) Holder delivery and its duplicate.
  await steps.outcome(
    'record holder delivery',
    first('applied', ['replayed']),
    () => gateway.recordLaneHolderDeliveryV1({ receipt: fixture.holderReceipt, expectedVersion: 2 }),
    (result) =>
      result.outcome !== 'applied'
        ? null
        : firstFailure(
            expectEqual('protocol version', result.version, 3),
            expectEqual('protocol lifecycle', result.record.lifecycle.state, 'awaiting_server_activation'),
          ),
  );
  await steps.outcome('record holder delivery (exact duplicate)', ['replayed'], () =>
    duplicateGateway.recordLaneHolderDeliveryV1({ receipt: fixture.holderReceipt, expectedVersion: 2 }),
  );

  // (g) The server-activation effect is journaled before the effect runs.
  await steps.outcome(
    'journal activate-server-material effect',
    first('applied', ['replayed', 'conflict']),
    () => primary.effects.recordEffect({ record: fixture.effect, commandDigestB64u: fixture.effectCommandDigestB64u }),
    (result) => (result.outcome === 'applied' ? expectEqual('effect version', result.version, 1) : null),
  );
  await steps.outcome(
    'journal activate-server-material effect (exact duplicate)',
    retry('replayed', 'conflict'),
    () => duplicate.effects.recordEffect({ record: fixture.effect, commandDigestB64u: fixture.effectCommandDigestB64u }),
  );

  // (b) Server activation and its duplicate.
  await steps.outcome(
    'activate server material',
    first('applied', ['replayed']),
    () => gateway.activateLaneServerMaterialV1({ receipt: fixture.serverReceipt, expectedVersion: 3 }),
    (result) =>
      result.outcome !== 'applied'
        ? null
        : firstFailure(
            expectEqual('protocol version', result.version, 4),
            expectEqual('protocol lifecycle', result.record.lifecycle.state, 'ready_for_parent_visibility'),
          ),
  );
  await steps.outcome('activate server material (exact duplicate)', ['replayed'], () =>
    duplicateGateway.activateLaneServerMaterialV1({ receipt: fixture.serverReceipt, expectedVersion: 3 }),
  );
  if (!replay) {
    await steps.check('server activation staged a pending product epoch', async () => {
      const product = await primary.lifecycle.getProductEpoch(fixture.productLookup);
      return {
        failure: expectEqual('product epoch state', product?.state ?? null, 'pending_visibility'),
        detail: { productEpochState: product?.state ?? null },
      };
    });
  }

  const confirm = {
    effectId: fixture.effect.effectId,
    expectedVersion: 1,
    commandDigestB64u: fixture.effectConfirmCommandDigestB64u,
    responseDigestB64u: fixture.effectResponseDigestB64u,
    confirmedAtMs: fixture.times.effectConfirmedAtMs,
  };
  await steps.outcome(
    'confirm activate-server-material effect',
    first('applied', ['replayed']),
    () => primary.effects.confirmEffect(confirm),
    (result) =>
      result.outcome === 'conflict'
        ? null
        : firstFailure(
            expectEqual('effect status', result.record.status, 'confirmed'),
            expectEqual('effect version', result.version, 2),
          ),
  );
  await steps.outcome('confirm activate-server-material effect (exact duplicate)', ['replayed'], () =>
    duplicate.effects.confirmEffect(confirm),
  );

  // (d) Parent visibility commit and its duplicate.
  const noActiveEpochs = /no active product epochs/;
  await steps.outcomeOrRejection(
    'commit enrollment activation',
    first('applied', ['replayed', 'rejected']),
    noActiveEpochs,
    () => gateway.commitLaneEnrollmentActivationV1(fixture.visibility),
    (result) =>
      replay || result.outcome === 'conflict'
        ? null
        : firstFailure(
            expectEqual('enrollment version', result.version, 2),
            expectEqual('enrollment lifecycle', result.lifecycle.state, 'active'),
            expectEqual('aggregate receipt digest', result.commandDigestB64u, fixture.aggregateActivationDigestB64u),
            expectEqual('active product epochs', result.productEpochs.length, 1),
          ),
  );
  await steps.outcomeOrRejection(
    'commit enrollment activation (exact duplicate)',
    retry('replayed', 'rejected'),
    noActiveEpochs,
    () => duplicateGateway.commitLaneEnrollmentActivationV1(fixture.visibility),
  );
  await steps.check('enrollment lifecycle is active', async () => {
    const enrollment = await primary.lifecycle.getEnrollment(job.enrollmentId);
    return {
      failure: firstFailure(
        expectEqual('enrollment lifecycle', enrollment?.value.lifecycle.state ?? null, 'active'),
        expectEqual('enrollment version', enrollment?.version ?? null, 2),
      ),
      detail: { state: enrollment?.value.lifecycle.state ?? null, version: enrollment?.version ?? null },
    };
  });
  await steps.check(
    replay ? 'active product epoch lookup is empty after revocation' : 'product epoch is active',
    async () => {
      const active = await primary.lifecycle.getActiveProductEpoch({
        ...fixture.productLookup,
        materialActivation: fixture.targetActivation,
      });
      return {
        failure: replay
          ? active === null
            ? null
            : `revoked lane still reported active (${active.state})`
          : expectEqual('active product epoch state', active?.state ?? null, 'active'),
        detail: { activeProductEpochState: active?.state ?? null },
      };
    },
  );

  // (f) The wallet-key lock serializes the revocation.
  const lockKey = `wallet-key:${String(job.walletKeyId)}`;
  const lockTtlMs = 60_000;
  await steps.outcome(
    'acquire wallet-key lock',
    ['applied'],
    () => primary.locks.acquireWalletKeyLock({ walletKeyId: job.walletKeyId, lockId: fixture.lockIds.holder, ttlMs: lockTtlMs, nowMs: fixture.times.lockNowMs }),
    (result) => (result.outcome === 'applied' ? expectEqual('lock key', result.lock.lockKey, lockKey) : null),
    (result) => (result.outcome === 'conflict' ? { actualLockId: result.actual?.lockId ?? null } : { lockKey: result.lock.lockKey }),
  );
  await steps.outcome(
    'acquire wallet-key lock with another lockId',
    ['conflict'],
    () => duplicate.locks.acquireWalletKeyLock({ walletKeyId: job.walletKeyId, lockId: fixture.lockIds.contender, ttlMs: lockTtlMs, nowMs: fixture.times.lockNowMs }),
    (result) => (result.outcome === 'conflict' ? expectEqual('holding lockId', result.actual?.lockId ?? null, fixture.lockIds.holder) : null),
    (result) => (result.outcome === 'conflict' ? { actualLockId: result.actual?.lockId ?? null } : { lockKey: result.lock.lockKey }),
  );
  await steps.outcome(
    'acquire wallet-key lock again with the same lockId',
    ['replayed'],
    () => duplicate.locks.acquireWalletKeyLock({ walletKeyId: job.walletKeyId, lockId: fixture.lockIds.holder, ttlMs: lockTtlMs, nowMs: fixture.times.lockNowMs }),
    undefined,
    (result) => (result.outcome === 'conflict' ? { actualLockId: result.actual?.lockId ?? null } : { lockKey: result.lock.lockKey }),
  );

  // (e) Signing-lane revocation: fence, then completion with a verified retirement receipt.
  await steps.outcome(
    'fence signing-lane revocation',
    first('applied', ['already_completed']),
    () => gateway.fenceSigningLaneRevocationV1(fixture.revoke),
    (result) =>
      result.outcome !== 'applied'
        ? null
        : firstFailure(
            expectEqual('product version', result.version, 3),
            expectEqual('product state', result.productEpoch.state, 'revocation_pending'),
            expectEqual('product revocation epoch', result.productEpoch.revocationEpoch, 1),
            expectEqual('fence digest', result.commandDigestB64u, fixture.revokeDigestB64u),
          ),
  );
  await steps.outcome('fence signing-lane revocation (exact duplicate)', first('replayed', ['already_completed']), () =>
    duplicateGateway.fenceSigningLaneRevocationV1(fixture.revoke),
  );
  await steps.outcome(
    'complete signing-lane revocation',
    first('applied', ['replayed']),
    () => gateway.completeSigningLaneRevocationV1(fixture.completion),
    (result) =>
      result.outcome === 'conflict'
        ? null
        : firstFailure(
            expectEqual('product version', result.version, 4),
            expectEqual('product state', result.productEpoch.state, 'revoked'),
            result.productEpoch.state === 'revoked'
              ? expectEqual('revocation receipt digest', result.productEpoch.revocationReceiptDigestB64u, fixture.retirementReceiptDigestB64u)
              : null,
            expectEqual('retirement receipt digest', result.retirementReceipt.receiptDigestB64u, fixture.retirementReceiptDigestB64u),
          ),
  );
  await steps.outcome('complete signing-lane revocation (exact duplicate)', ['replayed'], () =>
    duplicateGateway.completeSigningLaneRevocationV1(fixture.completion),
  );
  await steps.outcome('fence signing-lane revocation after completion', ['already_completed'], () =>
    duplicateGateway.fenceSigningLaneRevocationV1(fixture.revoke),
  );
  await steps.check('product epoch ends revoked', async () => {
    const product = await primary.lifecycle.getProductEpoch(fixture.productLookup);
    return {
      failure: firstFailure(
        expectEqual('product epoch state', product?.state ?? null, 'revoked'),
        expectEqual('product revocation epoch', product?.revocationEpoch ?? null, 1),
      ),
      detail: { state: product?.state ?? null, revocationEpoch: product?.revocationEpoch ?? null },
    };
  });

  await steps.boolean('release wallet-key lock with the wrong lockId', false, () =>
    duplicate.locks.releaseLock({ lockKey, lockId: fixture.lockIds.contender }),
  );
  await steps.boolean('release wallet-key lock with the holding lockId', true, () =>
    primary.locks.releaseLock({ lockKey, lockId: fixture.lockIds.holder }),
  );

  if (replay) {
    await steps.check('exact retries leave durable lane state unchanged', async () => {
      const after = await snapshotLaneState(primary, fixture);
      return { failure: after === before ? null : 'durable lane state changed during the replay run' };
    });
  }

  const finalStates = await readFinalStates(primary, fixture);
  const nonReplayRetries = replay
    ? steps.steps
        .filter(
          (step) =>
            step.ok &&
            step.expected.includes('replayed') &&
            step.outcome !== 'replayed' &&
            step.outcome !== 'already_completed',
        )
        .map((step) => ({ name: step.name, outcome: step.outcome }))
    : [];
  return {
    kind: 'r150_router_wallet_lane_scenario_v1',
    label: input.label,
    seed: input.seed,
    mode: replay ? 'replay' : 'first_run',
    strictReplay: replay && strictReplay,
    ok: steps.failures.length === 0,
    keyFamily: 'ed25519',
    jobKind: 'ed25519_yao_lane_job_v1',
    operation: 'create_lane',
    usedReplayStores: input.replayStores !== undefined,
    enrollmentId: String(job.enrollmentId),
    operationId: String(job.operationId),
    walletId: String(job.walletId),
    walletKeyId: String(job.walletKeyId),
    laneId: String(job.target.laneId),
    laneShareEpoch: String(job.target.laneShareEpoch),
    steps: steps.steps,
    failures: steps.failures,
    nonReplayRetries,
    finalStates,
  };
}

async function readProtocolJson(stores: WalletLaneStoresV1, fixture: LaneFixture): Promise<string> {
  try {
    return JSON.stringify(await stores.lifecycle.getProtocol(fixture.job.operationId));
  } catch (error) {
    return `getProtocol threw: ${errorMessage(error)}`;
  }
}

async function readFinalStates(
  stores: WalletLaneStoresV1,
  fixture: LaneFixture,
): Promise<LaneScenarioEvidence['finalStates']> {
  const settle = async <T>(read: () => Promise<T>): Promise<T | null> => {
    try {
      return await read();
    } catch {
      return null;
    }
  };
  const [enrollment, protocol, product, effect] = await Promise.all([
    settle(() => stores.lifecycle.getEnrollment(fixture.job.enrollmentId)),
    settle(() => stores.lifecycle.getProtocol(fixture.job.operationId)),
    settle(() => stores.lifecycle.getProductEpoch(fixture.productLookup)),
    settle(() => stores.effects.getEffect({ effectId: fixture.effect.effectId })),
  ]);
  return {
    enrollmentLifecycleState: enrollment?.value.lifecycle.state ?? null,
    enrollmentVersion: enrollment?.version ?? null,
    protocolLifecycleState: protocol?.value.lifecycle.state ?? null,
    protocolVersion: protocol?.version ?? null,
    productEpochState: product?.state ?? null,
    productRevocationEpoch: product?.revocationEpoch ?? null,
    effectStatus: effect?.record.status ?? null,
    effectVersion: effect?.version ?? null,
  };
}

// ------------------------------------------------------------------ race

/**
 * Prepares a fresh enrollment, then races two different protocol-commit
 * receipts for its one operation through two store handles. Exactly one may
 * apply; the other must see `conflict`, and the stored lifecycle must carry
 * the winner's transcript.
 */
export async function runConcurrentCasRace(input: {
  readonly first: WalletLaneStoresV1;
  readonly second: WalletLaneStoresV1;
  readonly seed: string;
  readonly owner?: WalletLaneOwnerV1;
  readonly timeBaseMs?: number;
}): Promise<LaneCasRaceEvidence> {
  const owner = input.owner ?? SCENARIO_OWNER;
  const fixture = await buildLaneFixture({
    owner,
    seed: input.seed,
    variant: 'race',
    timeBaseMs: input.timeBaseMs ?? LANE_SCENARIO_TIME_BASE_MS,
  });
  const failures: string[] = [];
  const firstGateway = new WalletLaneEnrollmentGateway({ lifecycleStore: input.first.lifecycle });
  const secondGateway = new WalletLaneEnrollmentGateway({ lifecycleStore: input.second.lifecycle });

  let prepareOutcome = 'threw';
  try {
    const prepared = await firstGateway.prepareLaneEnrollmentV1(fixture.prepare);
    prepareOutcome = prepared.outcome;
    if (prepared.outcome !== 'applied') failures.push(`race prepare was ${prepared.outcome}, expected applied (is the seed fresh?)`);
  } catch (error) {
    failures.push(`race prepare threw: ${errorMessage(error)}`);
  }

  const receipts = {
    first: await fixture.commitReceiptFor('race-transcript-first'),
    second: await fixture.commitReceiptFor('race-transcript-second'),
  } as const;
  const settled = await Promise.allSettled([
    firstGateway.recordLaneProtocolCommitV1({ receipt: receipts.first, expectedVersion: 1 }),
    secondGateway.recordLaneProtocolCommitV1({ receipt: receipts.second, expectedVersion: 1 }),
  ]);
  const callers = ['first', 'second'] as const;
  const outcomes = settled.map((result, index) => {
    const caller = callers[index];
    const transcriptHashB64u = receipts[caller].transcriptHashB64u;
    if (result.status === 'rejected') {
      failures.push(`${caller} commit threw: ${errorMessage(result.reason)}`);
      return { caller, outcome: 'threw', transcriptHashB64u };
    }
    return { caller, outcome: result.value.outcome, transcriptHashB64u };
  });
  const applied = outcomes.filter((entry) => entry.outcome === 'applied').length;
  const conflictOrReplay = outcomes.filter(
    (entry) => entry.outcome === 'conflict' || entry.outcome === 'replayed',
  ).length;
  const winnerEntry = outcomes.find((entry) => entry.outcome === 'applied') ?? null;
  const loserEntry = winnerEntry ? outcomes.find((entry) => entry !== winnerEntry) ?? null : null;
  if (applied !== 1) failures.push(`expected exactly one applied commit, observed ${applied}`);
  if (loserEntry && loserEntry.outcome !== 'conflict') {
    failures.push(`the losing commit was ${loserEntry.outcome}, expected conflict`);
  }

  let storedLifecycleState: string | null = null;
  let storedVersion: number | null = null;
  let storedTranscriptHashB64u: string | null = null;
  let storedMatchesWinner = false;
  try {
    const stored = await input.first.lifecycle.getProtocol(fixture.job.operationId);
    storedLifecycleState = stored?.value.lifecycle.state ?? null;
    storedVersion = stored?.version ?? null;
    const lifecycle = stored?.value.lifecycle;
    if (lifecycle && lifecycle.state === 'committed_awaiting_holder_delivery') {
      storedTranscriptHashB64u = lifecycle.transcriptHashB64u;
      if (winnerEntry) {
        const winnerDigest = await computeLaneProtocolCommitReceiptDigestV1(receipts[winnerEntry.caller]);
        storedMatchesWinner =
          lifecycle.transcriptHashB64u === winnerEntry.transcriptHashB64u &&
          lifecycle.protocolCommitReceiptDigestB64u === winnerDigest &&
          stored?.version === 2;
      }
    }
  } catch (error) {
    failures.push(`reading the raced protocol threw: ${errorMessage(error)}`);
  }
  if (!storedMatchesWinner) failures.push('stored protocol lifecycle does not match the winning receipt');

  return {
    kind: 'r150_router_wallet_lane_cas_race_v1',
    seed: input.seed,
    ok: failures.length === 0,
    applied,
    conflictOrReplay,
    enrollmentId: String(fixture.job.enrollmentId),
    operationId: String(fixture.job.operationId),
    prepareOutcome,
    outcomes,
    winner: winnerEntry?.caller ?? null,
    loserOutcome: loserEntry?.outcome ?? null,
    storedLifecycleState,
    storedVersion,
    storedTranscriptHashB64u,
    storedMatchesWinner,
    failures,
  };
}

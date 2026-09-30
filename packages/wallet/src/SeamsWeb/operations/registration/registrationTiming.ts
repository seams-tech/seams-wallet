/**
 * Registration timing, diagnostics, and span accounting.
 *
 * Moved out of `registration.ts` so the registration flow itself is readable.
 * This module records and shapes measurements; it makes no protocol decisions
 * and holds no registration state.
 *
 * `assertNever` lives here despite its generic name because its message names
 * a timing branch — it is a timing helper, not a general utility.
 */

import { isRegistrationBenchmarkDiagnosticsEnabled } from '@/core/signingEngine/walletCustody/ceremonyDriver';
export { isRegistrationBenchmarkDiagnosticsEnabled } from '@/core/signingEngine/walletCustody/ceremonyDriver';
import { isObject } from '@shared/utils/validation';
import type {
  RegistrationHooksOptions,
  RegistrationTimingSpanV1,
} from '@/core/types/sdkSentEvents';
import type { WorkerResourceWarmupDiagnostics } from '@/core/signingEngine/assembly/warmup';
import type { WarmSessionMaterialWriteDiagnosticBucket } from '@/core/signingEngine/session/passkey/warmSessionMaterialWriter';
import type { EmailOtpYaoPrewarmOutcome } from '@/core/signingEngine/workerManager/workerTypes';
import type {
  RegistrationSignerPlan,
  RegistrationSignerPlanBranch,
} from '@shared/utils/registrationSignerPlan';
import type { RegistrationAuthMethodInput } from '@shared/utils/registrationAuthMethodInput';
import {
  type WalletRegistrationRouteDiagnostics,
  type WalletRegistrationRouteTimingName,
} from '@/core/rpcClients/relayer/walletRegistration';
import { type PasskeyRegistrationAuthorityDiagnostics } from '@/SeamsWeb/operations/authMethods/passkey/registrationAuthority';
import { type RouterAbTraceContextV1 } from '@shared/utils/routerAbTraceContext';
export const REGISTRATION_TIMING_LABEL = '[Registration] wallet timing summary';

/**
 * `Server-Timing` metric name → timing bucket, for both the Ed25519 Yao execute
 * response and the ECDSA respond/activate responses. Anything unrecognised is
 * ignored, so a server-side rename can never break registration.
 */
const YAO_SERVER_TIMING_BUCKET_BY_METRIC = new Map<string, RegistrationTimingBucketName>(
  Object.entries({
    yao_credential_digest: 'yaoServerCredentialDigestMs',
    yao_d1_admission_read: 'yaoServerD1AdmissionReadMs',
    yao_router_execution: 'yaoServerRouterExecutionMs',
    yao_result_reconstruction: 'yaoServerResultReconstructionMs',
    yao_router_prepare_pair: 'yaoServerRouterPreparePairMs',
    yao_router_verify_readiness: 'yaoServerRouterVerifyReadinessMs',
    yao_router_role_execution: 'yaoServerRouterRoleExecutionMs',
    yao_router_signing_worker_delivery: 'yaoServerRouterSigningWorkerDeliveryMs',
    ecdsa_respond_d1_claim: 'ecdsaRespondD1ClaimMs',
    ecdsa_respond_reconcile: 'ecdsaRespondReconcileMs',
    ecdsa_respond_router: 'ecdsaRespondRouterMs',
    ecdsa_respond_d1_commit: 'ecdsaRespondD1CommitMs',
    ecdsa_respond_total: 'ecdsaRespondTotalMs',
    ecdsa_activate_d1_claim: 'ecdsaActivateD1ClaimMs',
    ecdsa_activate_reconcile: 'ecdsaActivateReconcileMs',
    ecdsa_activate_router: 'ecdsaActivateRouterMs',
    ecdsa_activate_bootstrap: 'ecdsaActivateBootstrapMs',
    ecdsa_activate_session_provision: 'ecdsaActivateSessionProvisionMs',
    ecdsa_activate_d1_commit: 'ecdsaActivateD1CommitMs',
    ecdsa_activate_policy_lookup: 'ecdsaActivatePolicyLookupMs',
    ecdsa_activate_jwt_mint: 'ecdsaActivateJwtMintMs',
    ecdsa_activate_total: 'ecdsaActivateTotalMs',
    ecdsa_rt_authorize: 'ecdsaRtAuthorizeMs',
    ecdsa_rt_admission: 'ecdsaRtAdmissionMs',
    ecdsa_rt_derivers: 'ecdsaRtDeriversMs',
    ecdsa_rt_deriver_a: 'ecdsaRtDeriverAMs',
    ecdsa_rt_deriver_b: 'ecdsaRtDeriverBMs',
    ecdsa_rt_completion: 'ecdsaRtCompletionMs',
    ecdsa_rt_total: 'ecdsaRtTotalMs',
    ecdsa_rt_act_session: 'ecdsaRtActSessionMs',
    ecdsa_rt_act_worker: 'ecdsaRtActWorkerMs',
    ecdsa_rt_act_total: 'ecdsaRtActTotalMs',
    /* Role-local spans. The Router prefixes each role's own bare metric names
       (`parse`, `preload`, `execute`, `total`) when it folds them in, so
       `parse` lands as `ecdsa_a_parse` and so on.
       These nest inside the Router spans above, and the gap is the finding:
       when `ecdsaRtDeriverAMs` far exceeds `ecdsaDeriverATotalMs`, the time
       went to Worker cold start and transport, not to the deriver's work. */
    ecdsa_a_parse: 'ecdsaDeriverAParseMs',
    ecdsa_a_preload: 'ecdsaDeriverAPreloadMs',
    ecdsa_a_execute: 'ecdsaDeriverAExecuteMs',
    ecdsa_a_total: 'ecdsaDeriverATotalMs',
    ecdsa_b_parse: 'ecdsaDeriverBParseMs',
    ecdsa_b_preload: 'ecdsaDeriverBPreloadMs',
    ecdsa_b_execute: 'ecdsaDeriverBExecuteMs',
    ecdsa_b_total: 'ecdsaDeriverBTotalMs',
    ecdsa_sw_parse: 'ecdsaSigningWorkerParseMs',
    ecdsa_sw_activate: 'ecdsaSigningWorkerActivateMs',
    ecdsa_sw_total: 'ecdsaSigningWorkerTotalMs',
    near_finalize_authority: 'nearFinalizeAuthorityMs',
    near_finalize_fingerprint: 'nearFinalizeFingerprintMs',
    near_finalize_side_effect: 'nearFinalizeSideEffectMs',
    near_finalize_cleanup: 'nearFinalizeCleanupMs',
    near_finalize_session_projection: 'nearFinalizeSessionProjectionMs',
    near_finalize_session_seal: 'nearFinalizeSessionSealMs',
    near_finalize_total: 'nearFinalizeTotalMs',
  } as const satisfies Record<string, RegistrationTimingBucketName>),
);

type TimingBucketRecorder = {
  record: (bucket: RegistrationTimingBucketName, durationMs: number) => void;
};

type StrictEcdsaServerTimingLeg = 'respond' | 'activate';

/** Records fixed timing buckets and reports only whether the raw header arrived. */
export function recordStrictEcdsaServerTimingBuckets(
  recorder: TimingBucketRecorder | null,
  leg: StrictEcdsaServerTimingLeg,
  header: string | null,
): void {
  if (isRegistrationBenchmarkDiagnosticsEnabled()) {
    console.info('[Registration] ECDSA Server-Timing header presence', {
      leg,
      present: Boolean(header?.trim()),
    });
  }
  recordRegistrationServerTimingBuckets(recorder, header);
}

/**
 * Folds a raw `Server-Timing` header into the registration timing recorder.
 * Shared by the Yao and ECDSA paths; unrecognised metrics are dropped.
 */
export function recordRegistrationServerTimingBuckets(
  recorder: TimingBucketRecorder | null,
  header: string | null,
): void {
  if (!recorder) return;
  for (const [bucket, durationMs] of parseYaoServerTimingBuckets(header)) {
    recorder.record(bucket, durationMs);
  }
}

/**
 * Parses a `Server-Timing` header into bucket durations. Diagnostics only: a
 * malformed or absent header yields an empty list and never throws.
 */
export function parseYaoServerTimingBuckets(
  header: string | null | undefined,
): ReadonlyArray<readonly [RegistrationTimingBucketName, number]> {
  if (!header) return [];
  const parsed: Array<readonly [RegistrationTimingBucketName, number]> = [];
  for (const entry of header.split(',')) {
    const parts = entry.split(';');
    const name = String(parts[0] || '').trim();
    /* Map lookup, not property access: a metric literally named `__proto__`
       or `constructor` would otherwise resolve against Object.prototype and be
       recorded as a bucket. */
    const bucket = YAO_SERVER_TIMING_BUCKET_BY_METRIC.get(name);
    if (!bucket) continue;
    for (const part of parts.slice(1)) {
      const [key, rawValue] = part.split('=');
      if (String(key || '').trim() !== 'dur') continue;
      const duration = Number(String(rawValue || '').trim());
      if (!Number.isFinite(duration) || duration < 0) break;
      parsed.push([bucket, duration]);
      break;
    }
  }
  return parsed;
}

export const WALLET_IFRAME_TRANSPORT_TIMING_LABEL =
  '[Registration] wallet iframe transport timing summary';

export function emitNearRegistrationTiming(input: {
  ceremonyId: string;
  stage:
    | `near_only.${'setup' | 'authentication' | 'respond' | 'custody' | 'backup_and_checkpoint' | 'activate' | 'provision_checkpoint' | 'finalize' | 'publication' | 'session_hydration' | 'material_activation' | 'export_capability' | 'wallet_ready'}`
    | 'early_admission'
    | 'custody_join'
    | 'server_finalize'
    | 'local_publication'
    | 'session_install'
    | 'session_seal_preparation'
    | 'session_seal_preparation_wait'
    | 'session_hydration_wait'
    | 'session_hydration'
    | 'signer_activation'
    | 'durable_ready'
    | 'provisioning_total'
    | 'registration_total';
  startedAt: number;
  outcome: 'success' | 'failure';
}): void {
  emitNearRegistrationDuration({
    ceremonyId: input.ceremonyId,
    stage: input.stage,
    durationMs: Math.max(0, performance.now() - input.startedAt),
    outcome: input.outcome,
  });
}

export function recordNearRegistrationSessionTiming(
  ceremonyId: string,
  bucket: WarmSessionMaterialWriteDiagnosticBucket,
  durationMs: number,
): void {
  emitNearRegistrationDuration({
    ceremonyId,
    stage: `session_hydration.${bucket}`,
    durationMs,
    outcome: 'success',
  });
}

function emitNearRegistrationDuration(input: {
  ceremonyId: string;
  stage:
    | Parameters<typeof emitNearRegistrationTiming>[0]['stage']
    | `session_hydration.${WarmSessionMaterialWriteDiagnosticBucket}`;
  durationMs: number;
  outcome: 'success' | 'failure';
}): void {
  if (!isRegistrationBenchmarkDiagnosticsEnabled()) return;
  try {
    console.info(
      '[Registration] NEAR timing',
      JSON.stringify({
        event: 'near_registration_timing',
        ceremonyId: input.ceremonyId,
        stage: input.stage,
        durationMs: input.durationMs,
        outcome: input.outcome,
      }),
    );
  } catch {
    // Diagnostics cannot change registration behavior.
  }
}

type RegistrationTimingAuthMethod = RegistrationAuthMethodInput['kind'];

type RegistrationTimingSignerBranch = 'near_ed25519' | 'evm_family_ecdsa';

type RegistrationTimingSignerSet = {
  kind: 'signer_set';
  branches: readonly RegistrationTimingSignerBranch[];
};

/** Passkey-only auth buckets; an Email OTP registration's `auth` block reports them as zeros. */
const PASSKEY_AUTH_TIMING_BUCKETS = [
  'passkeyAuthConfirmationMs',
  'passkeyAuthPrfExtractionMs',
  'passkeyAuthCredentialRedactionMs',
  'passkeyAuthWorkerReadyMs',
  'passkeyAuthWorkerRequestRoundTripMs',
  'passkeyAuthWorkerResponseValidationMs',
  'passkeyAuthRequestSetupMs',
  'passkeyAuthPromptUserMs',
  'passkeyAuthPromptElementDefineMs',
  'passkeyAuthPromptMountMs',
  'passkeyAuthPromptHostFirstUpdateMs',
  'passkeyAuthPromptHostInteractiveMs',
  'passkeyAuthPromptConfirmEventMs',
  'passkeyAuthPromptDecisionWaitMs',
  'passkeyAuthCredentialCreateStartMs',
  'passkeyAuthCredentialCreateMs',
  'passkeyAuthCredentialSerializeMs',
  'passkeyAuthDuplicateRetryCount',
  'passkeyAuthMainThreadTotalMs',
] as const;

/** Reported in the `ed25519` block only when the signer set has a NEAR Ed25519 branch. */
const ED25519_TIMING_BUCKETS = [
  'emailOtpYaoEnrollmentMaterialWaitMs',
  'emailOtpYaoWorkerRegistrationMs',
  'emailOtpYaoTotalMs',
] as const;

/*
 * The `ecdsa` block reports these only when the signer set has an ECDSA branch.
 * They are two lists because the flat timings emit the Email OTP backup and
 * wallet finalize buckets between the ceremony and the persistence.
 */
const ECDSA_CEREMONY_TIMING_BUCKETS = [
  'ecdsaClientBootstrapMs',
  'ecdsaRegistrationTotalMs',
  'ecdsaRegistrationClientCreateMs',
  'ecdsaRegistrationGatewayRespondMs',
  'ecdsaRegistrationClientProofVerifyMs',
  'ecdsaRegistrationGatewayActivateMs',
  'ecdsaRegistrationClientActivationFinalizeMs',
] as const;

const ECDSA_PERSISTENCE_TIMING_BUCKETS = [
  'ecdsaRegistrationPersistenceMs',
  'ecdsaRegistrationSessionFinalizeMs',
  'ecdsaRegistrationLocalRecordPersistenceMs',
  'ecdsaRegistrationTargetCount',
  'ecdsaRegistrationClientFinalizeMs',
  'ecdsaRegistrationClientMaterialStoreMs',
  'ecdsaRegistrationServerBootstrapMs',
  'ecdsaRegistrationPasskeyBootstrapStoreMs',
  'ecdsaRegistrationRoleLocalRecordPersistenceMs',
  'ecdsaRegistrationWarmSessionHydrationMs',
  'ecdsaRegistrationWarmSessionWorkerReadyMs',
  'ecdsaRegistrationWarmSessionWorkerPutMs',
  'ecdsaRegistrationWarmSessionSealedRecordPersistMs',
  'ecdsaRegistrationWarmSessionSealResolveTransportMs',
  'ecdsaRegistrationWarmSessionSealExistingRecordReadMs',
  'ecdsaRegistrationWarmSessionSealPolicyReadMs',
  'ecdsaRegistrationWarmSessionSealApplyServerSealMs',
  'ecdsaRegistrationWarmSessionSealApplyRuntimeSetupMs',
  'ecdsaRegistrationWarmSessionSealApplyClientSealMs',
  'ecdsaRegistrationWarmSessionSealApplyServerRouteMs',
  'ecdsaRegistrationWarmSessionSealApplyClientUnsealMs',
  'ecdsaRegistrationWarmSessionSealApplyPolicyUpdateMs',
  'ecdsaRegistrationWarmSessionSealRegisterMs',
  'ecdsaRegistrationWarmSessionSealVerifyReadMs',
  'ecdsaRegistrationEmailOtpSessionCommitMs',
] as const;

const ECDSA_TIMING_BUCKETS = [
  ...ECDSA_CEREMONY_TIMING_BUCKETS,
  ...ECDSA_PERSISTENCE_TIMING_BUCKETS,
] as const;

/**
 * Every timing bucket, in the order the summary emits them. Tests and
 * dashboards read the summary as JSON, so the order is part of its format.
 */
const REGISTRATION_TIMING_BUCKETS = [
  'registrationWarmupMs',
  'registrationWarmupWaitMs',
  'registrationWarmupAuthenticatedWalletStateMs',
  'registrationWarmupNoncePrefetchMs',
  'registrationWarmupKeyMaterialReadMs',
  'registrationWarmupUiConfirmPrewarmMs',
  'registrationWarmupSignerWorkerPrewarmMs',
  'registrationWarmupEmailOtpWorkerPrewarmMs',
  'registrationWarmupEmailOtpYaoWasmInitMs',
  'managedRegistrationGrantMs',
  'registrationIntentMs',
  'registrationIntentDigestMs',
  'authProofMs',
  ...PASSKEY_AUTH_TIMING_BUCKETS,
  'emailOtpEnrollmentMaterialMs',
  ...ED25519_TIMING_BUCKETS,
  // Ed25519 Yao branch, client-observed. Applies to passkey and Email OTP
  // alike; the emailOtpYao* buckets above stay Email-OTP specific.
  'yaoBranchTotalMs',
  'yaoAdmissionMs',
  'yaoClientSessionCreateMs',
  'yaoClientCompletionMs',
  // Router-reported, parsed from the execute call's Server-Timing header.
  // Names mirror the server metric names exactly.
  'yaoServerCredentialDigestMs',
  'yaoServerD1AdmissionReadMs',
  'yaoServerRouterExecutionMs',
  'yaoServerResultReconstructionMs',
  'yaoServerRouterPreparePairMs',
  'yaoServerRouterVerifyReadinessMs',
  'yaoServerRouterRoleExecutionMs',
  'yaoServerRouterSigningWorkerDeliveryMs',
  // Gateway-reported ECDSA boundaries, parsed from the respond/activate
  // Server-Timing headers. Names mirror the server metric names.
  'ecdsaRespondD1ClaimMs',
  'ecdsaRespondReconcileMs',
  'ecdsaRespondRouterMs',
  'ecdsaRespondD1CommitMs',
  'ecdsaRespondTotalMs',
  'ecdsaActivateD1ClaimMs',
  'ecdsaActivateReconcileMs',
  'ecdsaActivateRouterMs',
  'ecdsaActivateBootstrapMs',
  'ecdsaActivateSessionProvisionMs',
  'ecdsaActivateD1CommitMs',
  'ecdsaActivatePolicyLookupMs',
  'ecdsaActivateJwtMintMs',
  'ecdsaActivateTotalMs',
  // Router-reported spans, folded into the Gateway header at the service
  // binding. `rtDeriverA`/`rtDeriverB` overlap: the two run concurrently, and
  // `rtDerivers` is their joined wall time.
  'ecdsaRtAuthorizeMs',
  'ecdsaRtAdmissionMs',
  'ecdsaRtDeriversMs',
  'ecdsaRtDeriverAMs',
  'ecdsaRtDeriverBMs',
  'ecdsaRtCompletionMs',
  'ecdsaRtTotalMs',
  'ecdsaRtActSessionMs',
  'ecdsaRtActWorkerMs',
  'ecdsaRtActTotalMs',
  // Role-local spans, folded in by the Router under a per-role prefix.
  'ecdsaDeriverAParseMs',
  'ecdsaDeriverAPreloadMs',
  'ecdsaDeriverAExecuteMs',
  'ecdsaDeriverATotalMs',
  'ecdsaDeriverBParseMs',
  'ecdsaDeriverBPreloadMs',
  'ecdsaDeriverBExecuteMs',
  'ecdsaDeriverBTotalMs',
  'ecdsaSigningWorkerParseMs',
  'ecdsaSigningWorkerActivateMs',
  'ecdsaSigningWorkerTotalMs',
  'nearFinalizeAuthorityMs',
  'nearFinalizeFingerprintMs',
  'nearFinalizeSideEffectMs',
  'nearFinalizeCleanupMs',
  'nearFinalizeSessionProjectionMs',
  'nearFinalizeSessionSealMs',
  'nearFinalizeTotalMs',
  'walletRegisterStartMs',
  ...ECDSA_CEREMONY_TIMING_BUCKETS,
  'emailOtpRecoveryCodeBackupMs',
  'walletRegisterFinalizeMs',
  ...ECDSA_PERSISTENCE_TIMING_BUCKETS,
] as const;

type RegistrationTimingBucketName = (typeof REGISTRATION_TIMING_BUCKETS)[number];

type RegistrationTimingBucketValues = Record<RegistrationTimingBucketName, number>;

type RegistrationTimingSpanKind = 'warmup' | 'auth' | 'ed25519_yao' | 'ecdsa' | 'registration';

type RegistrationTimingSpan = {
  name: RegistrationTimingBucketName;
  kind: RegistrationTimingSpanKind;
  startOffsetMs: number;
  endOffsetMs: number;
};

type RegistrationCriticalPathBucket = {
  name: RegistrationTimingBucketName;
  durationMs: number;
};

type RegistrationCriticalPathSummary = {
  kind: 'registration_critical_path_summary_v2';
  totalElapsedMs: number;
  measuredWorkMs: number;
  spanUnionMs: number;
  spanCoverageRatio: number;
  unattributedElapsedMs: number;
  overlappedOrBackgroundMs: number;
  topBuckets: readonly RegistrationCriticalPathBucket[];
  spans: readonly RegistrationTimingSpan[];
};

/** Spells an intersection out as one object type. */
type Flat<T> = { [K in keyof T]: T[K] };

type PasskeyAuthTimingBucketName = (typeof PASSKEY_AUTH_TIMING_BUCKETS)[number];

type EmailOtpAuthTimingBucketName = 'emailOtpEnrollmentMaterialMs' | 'emailOtpRecoveryCodeBackupMs';

/** The `auth` block: the method used reports its buckets, the other method's are zeros. */
type AuthMethodTiming<
  Kind extends RegistrationTimingAuthMethod,
  Passkey extends number,
  EmailOtp extends number,
> = Flat<
  { kind: Kind; authProofMs: number } & Record<PasskeyAuthTimingBucketName, Passkey> &
    Record<EmailOtpAuthTimingBucketName, EmailOtp>
>;

type RegistrationAuthTiming =
  | AuthMethodTiming<'passkey', number, 0>
  | AuthMethodTiming<'email_otp', 0, number>;

/** A signer branch's buckets: measured when the branch ran, zeros when it did not. */
type SignerBranchTiming<
  Kind extends string,
  Buckets extends readonly RegistrationTimingBucketName[],
  Value extends number,
> = Flat<{ kind: Kind } & Record<Buckets[number], Value>>;

type RegistrationEd25519Timing =
  | SignerBranchTiming<'ed25519_yao_enabled', typeof ED25519_TIMING_BUCKETS, number>
  | SignerBranchTiming<'ed25519_disabled', typeof ED25519_TIMING_BUCKETS, 0>;

type RegistrationEcdsaTiming =
  | SignerBranchTiming<'ecdsa_enabled', typeof ECDSA_TIMING_BUCKETS, number>
  | SignerBranchTiming<'ecdsa_disabled', typeof ECDSA_TIMING_BUCKETS, 0>;

type RegistrationTimingBuckets = RegistrationTimingBucketValues & {
  auth: RegistrationAuthTiming;
  ed25519: RegistrationEd25519Timing;
  ecdsa: RegistrationEcdsaTiming;
  emailOtpYaoPrewarm: EmailOtpYaoPrewarmOutcome;
};

type SucceededRegistrationTimingSummary = {
  kind: 'registration_timing_summary_v2';
  status: 'succeeded';
  authMethod: RegistrationTimingAuthMethod;
  signerSet: RegistrationTimingSignerSet;
  totalMs: number;
  criticalPath: RegistrationCriticalPathSummary;
  relayDiagnostics: WalletRegistrationRouteDiagnostics[];
  errorCode?: never;
  timings: RegistrationTimingBuckets;
};

type FailedRegistrationTimingSummary = {
  kind: 'registration_timing_summary_v2';
  status: 'failed';
  authMethod: RegistrationTimingAuthMethod;
  signerSet: RegistrationTimingSignerSet;
  totalMs: number;
  criticalPath: RegistrationCriticalPathSummary;
  errorCode: string | null;
  relayDiagnostics: WalletRegistrationRouteDiagnostics[];
  timings: RegistrationTimingBuckets;
};

type RegistrationTimingSummary =
  | SucceededRegistrationTimingSummary
  | FailedRegistrationTimingSummary;

export function assertNever(value: never): never {
  throw new Error(`Unexpected registration timing branch: ${String(value)}`);
}

function registrationTimingBranchFromPlanBranch(
  branch: RegistrationSignerPlanBranch,
): RegistrationTimingSignerBranch {
  switch (branch.kind) {
    case 'near_ed25519':
      return 'near_ed25519';
    case 'evm_family_ecdsa':
      return 'evm_family_ecdsa';
    default:
      return assertNever(branch);
  }
}

export function registrationTimingSignerSetFromPlan(
  plan: RegistrationSignerPlan,
): RegistrationTimingSignerSet {
  return {
    kind: 'signer_set',
    branches: plan.branches.map(registrationTimingBranchFromPlanBranch),
  };
}

function registrationTimingSignerSetHasBranch(
  signerSet: RegistrationTimingSignerSet,
  branch: RegistrationTimingSignerBranch,
): boolean {
  return signerSet.branches.includes(branch);
}

export function roundDurationMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function parseWalletRegistrationRouteTimingName(
  value: unknown,
): WalletRegistrationRouteTimingName | null {
  switch (value) {
    case 'registrationIntentLoadMs':
    case 'registrationIntentDigestMs':
    case 'registrationIntentConsumeMs':
    case 'registrationPreparationPersistMs':
    case 'registrationPreparationLoadMs':
    case 'registrationPreparationConsumeMs':
    case 'registrationPreparationScopeCheckMs':
    case 'registrationAuthorityVerifyMs':
    case 'registrationEcdsaPrepareMs':
    case 'registrationCeremonyPersistMs':
    case 'registerPrepareTotalMs':
    case 'registerStartTotalMs':
    case 'registrationEcdsaRespondMs':
    case 'registrationFinalizeReplayLoadMs':
    case 'registrationCeremonyLoadMs':
    case 'registrationEcdsaBootstrapVerifyMs':
    case 'sponsoredNearAccountCreateMs':
    case 'registrationKeygenMs':
    case 'registrationEmailOtpEnrollmentPlanMs':
    case 'relaySessionMintMs':
    case 'relayGoogleEmailOtpActivationPlanMs':
    case 'relayPersistenceMs':
    case 'registrationFinalizeReplayCacheMs':
    case 'registerFinalizeTotalMs':
      return value;
    default:
      return null;
  }
}

function sanitizeWalletRegistrationRouteDiagnostics(
  value: unknown,
): WalletRegistrationRouteDiagnostics | null {
  if (!isObject(value) || value.kind !== 'wallet_registration_route_diagnostics_v1') return null;
  if (
    value.route !== 'wallets_register_start' &&
    value.route !== 'wallets_register_ecdsa_derivation_respond' &&
    value.route !== 'wallets_register_finalize'
  ) {
    return null;
  }
  if (!Array.isArray(value.entries)) return null;
  const entries: WalletRegistrationRouteDiagnostics['entries'] = [];
  for (const entry of value.entries) {
    if (!isObject(entry)) continue;
    const name = parseWalletRegistrationRouteTimingName(entry.name);
    const durationMs = Number(entry.durationMs);
    if (!name || !Number.isFinite(durationMs) || durationMs < 0) continue;
    entries.push({ name, durationMs });
  }
  return {
    kind: 'wallet_registration_route_diagnostics_v1',
    route: value.route,
    entries,
  };
}

function copyWalletRegistrationRouteDiagnostics(
  diagnostics: WalletRegistrationRouteDiagnostics,
): WalletRegistrationRouteDiagnostics {
  return {
    kind: diagnostics.kind,
    route: diagnostics.route,
    entries: diagnostics.entries.map(copyWalletRegistrationRouteTimingEntry),
  };
}

function copyWalletRegistrationRouteTimingEntry(
  entry: WalletRegistrationRouteDiagnostics['entries'][number],
): WalletRegistrationRouteDiagnostics['entries'][number] {
  return { name: entry.name, durationMs: entry.durationMs };
}

/** The given buckets' values, keyed in list order: the order the summary emits them. */
function pickTimingBuckets<Bucket extends RegistrationTimingBucketName>(
  buckets: readonly Bucket[],
  values: RegistrationTimingBucketValues,
): Record<Bucket, number> {
  const picked = {} as Record<Bucket, number>;
  for (const bucket of buckets) {
    picked[bucket] = values[bucket];
  }
  return picked;
}

/** The given buckets, each zero, keyed in list order. */
function zeroTimingBuckets<Bucket extends RegistrationTimingBucketName>(
  buckets: readonly Bucket[],
): Record<Bucket, 0> {
  const zeros = {} as Record<Bucket, 0>;
  for (const bucket of buckets) {
    zeros[bucket] = 0;
  }
  return zeros;
}

function buildRegistrationAuthTiming(input: {
  authMethod: RegistrationTimingAuthMethod;
  buckets: RegistrationTimingBucketValues;
}): RegistrationAuthTiming {
  switch (input.authMethod) {
    case 'passkey':
      return {
        kind: 'passkey',
        authProofMs: input.buckets.authProofMs,
        ...pickTimingBuckets(PASSKEY_AUTH_TIMING_BUCKETS, input.buckets),
        emailOtpEnrollmentMaterialMs: 0,
        emailOtpRecoveryCodeBackupMs: 0,
      };
    case 'email_otp':
      return {
        kind: 'email_otp',
        authProofMs: input.buckets.authProofMs,
        ...zeroTimingBuckets(PASSKEY_AUTH_TIMING_BUCKETS),
        emailOtpEnrollmentMaterialMs: input.buckets.emailOtpEnrollmentMaterialMs,
        emailOtpRecoveryCodeBackupMs: input.buckets.emailOtpRecoveryCodeBackupMs,
      };
    default:
      return assertNever(input.authMethod);
  }
}

function buildRegistrationEd25519Timing(input: {
  signerSet: RegistrationTimingSignerSet;
  buckets: RegistrationTimingBucketValues;
}): RegistrationEd25519Timing {
  return registrationTimingSignerSetHasBranch(input.signerSet, 'near_ed25519')
    ? { kind: 'ed25519_yao_enabled', ...pickTimingBuckets(ED25519_TIMING_BUCKETS, input.buckets) }
    : { kind: 'ed25519_disabled', ...zeroTimingBuckets(ED25519_TIMING_BUCKETS) };
}

function buildRegistrationEcdsaTiming(input: {
  signerSet: RegistrationTimingSignerSet;
  buckets: RegistrationTimingBucketValues;
}): RegistrationEcdsaTiming {
  return registrationTimingSignerSetHasBranch(input.signerSet, 'evm_family_ecdsa')
    ? { kind: 'ecdsa_enabled', ...pickTimingBuckets(ECDSA_TIMING_BUCKETS, input.buckets) }
    : { kind: 'ecdsa_disabled', ...zeroTimingBuckets(ECDSA_TIMING_BUCKETS) };
}

const REGISTRATION_CRITICAL_PATH_BUCKETS: readonly RegistrationTimingBucketName[] = [
  'registrationWarmupWaitMs',
  'managedRegistrationGrantMs',
  'registrationIntentMs',
  'registrationIntentDigestMs',
  'authProofMs',
  'emailOtpEnrollmentMaterialMs',
  'emailOtpYaoEnrollmentMaterialWaitMs',
  'emailOtpYaoWorkerRegistrationMs',
  'emailOtpYaoTotalMs',
  'walletRegisterStartMs',
  'ecdsaClientBootstrapMs',
  'ecdsaRegistrationTotalMs',
  'emailOtpRecoveryCodeBackupMs',
  'walletRegisterFinalizeMs',
  'ecdsaRegistrationPersistenceMs',
];

function registrationTimingSpanKindFromBucket(
  bucket: RegistrationTimingBucketName,
): RegistrationTimingSpanKind {
  if (bucket.startsWith('registrationWarmup')) return 'warmup';
  if (bucket.startsWith('passkeyAuth') || bucket === 'authProofMs') return 'auth';
  if (bucket.includes('Yao') || bucket.includes('yao')) return 'ed25519_yao';
  if (bucket.includes('ecdsa')) return 'ecdsa';
  return 'registration';
}

function copyRegistrationTimingSpan(span: RegistrationTimingSpan): RegistrationTimingSpan {
  return {
    name: span.name,
    kind: span.kind,
    startOffsetMs: span.startOffsetMs,
    endOffsetMs: span.endOffsetMs,
  };
}

function registrationTimingSpanUnionMs(
  totalElapsedMs: number,
  spans: readonly RegistrationTimingSpan[],
): number {
  const sortedSpans = spans
    .map((span) => ({
      start: Math.max(0, Math.min(totalElapsedMs, span.startOffsetMs)),
      end: Math.max(0, Math.min(totalElapsedMs, span.endOffsetMs)),
    }))
    .filter((span) => span.end > span.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  let unionMs = 0;
  let currentStart = 0;
  let currentEnd = 0;
  for (const span of sortedSpans) {
    if (currentEnd <= currentStart) {
      currentStart = span.start;
      currentEnd = span.end;
      continue;
    }
    if (span.start > currentEnd) {
      unionMs += currentEnd - currentStart;
      currentStart = span.start;
      currentEnd = span.end;
      continue;
    }
    currentEnd = Math.max(currentEnd, span.end);
  }
  return currentEnd > currentStart ? unionMs + currentEnd - currentStart : unionMs;
}

function buildRegistrationCriticalPathSummary(input: {
  totalElapsedMs: number;
  buckets: RegistrationTimingBucketValues;
  spans: readonly RegistrationTimingSpan[];
}): RegistrationCriticalPathSummary {
  const measuredBuckets = REGISTRATION_CRITICAL_PATH_BUCKETS.map((name) => ({
    name,
    durationMs: input.buckets[name],
  }));
  const measuredWorkMs = measuredBuckets.reduce(
    (total, bucket) => total + Math.max(0, bucket.durationMs),
    0,
  );
  const topBuckets = measuredBuckets
    .filter((bucket) => bucket.durationMs > 0)
    .sort((left, right) =>
      right.durationMs === left.durationMs
        ? left.name.localeCompare(right.name)
        : right.durationMs - left.durationMs,
    )
    .slice(0, 5);
  const spanUnionMs = registrationTimingSpanUnionMs(input.totalElapsedMs, input.spans);
  return {
    kind: 'registration_critical_path_summary_v2',
    totalElapsedMs: input.totalElapsedMs,
    measuredWorkMs,
    spanUnionMs,
    spanCoverageRatio:
      input.totalElapsedMs > 0 ? Math.min(1, spanUnionMs / input.totalElapsedMs) : 1,
    unattributedElapsedMs: Math.max(0, input.totalElapsedMs - spanUnionMs),
    overlappedOrBackgroundMs: Math.max(0, measuredWorkMs - input.totalElapsedMs),
    topBuckets,
    spans: input.spans.map(copyRegistrationTimingSpan),
  };
}

function buildRegistrationTimingBuckets(input: {
  authMethod: RegistrationTimingAuthMethod;
  signerSet: RegistrationTimingSignerSet;
  buckets: RegistrationTimingBucketValues;
  emailOtpYaoPrewarm: EmailOtpYaoPrewarmOutcome;
}): RegistrationTimingBuckets {
  const buckets = pickTimingBuckets(REGISTRATION_TIMING_BUCKETS, input.buckets);
  return {
    ...buckets,
    auth: buildRegistrationAuthTiming({
      authMethod: input.authMethod,
      buckets,
    }),
    ed25519: buildRegistrationEd25519Timing({
      signerSet: input.signerSet,
      buckets,
    }),
    ecdsa: buildRegistrationEcdsaTiming({
      signerSet: input.signerSet,
      buckets,
    }),
    emailOtpYaoPrewarm: { ...input.emailOtpYaoPrewarm },
  };
}

export class RegistrationTimingRecorder {
  private readonly startedAt: number;
  private nearStageStartedAt: number;
  private readonly buckets: RegistrationTimingBucketValues;
  private readonly relayDiagnostics: WalletRegistrationRouteDiagnostics[];
  private readonly spans: RegistrationTimingSpan[];
  private emailOtpYaoPrewarm: EmailOtpYaoPrewarmOutcome;

  constructor(startedAt: number) {
    this.startedAt = startedAt;
    this.nearStageStartedAt = startedAt;
    this.buckets = zeroTimingBuckets(REGISTRATION_TIMING_BUCKETS);
    this.relayDiagnostics = [];
    this.spans = [];
    this.emailOtpYaoPrewarm = zeroEmailOtpYaoPrewarmDiagnostics();
  }

  markNearStage(
    ceremonyId: string,
    stage: Parameters<typeof emitNearRegistrationTiming>[0]['stage'],
  ): void {
    const endedAt = performance.now();
    emitNearRegistrationDuration({
      ceremonyId,
      stage,
      durationMs: endedAt - this.nearStageStartedAt,
      outcome: 'success',
    });
    this.nearStageStartedAt = endedAt;
  }

  async measure<K extends RegistrationTimingBucketName, T>(
    bucket: K,
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      this.buckets[bucket] = roundDurationMs(startedAt);
      this.recordSpan(bucket, startedAt, performance.now());
    }
  }

  record<K extends RegistrationTimingBucketName>(bucket: K, durationMs: number): void {
    const rounded = Math.max(0, Math.round(durationMs));
    this.buckets[bucket] += rounded;
  }

  snapshot(): RegistrationTimingBucketValues {
    return pickTimingBuckets(REGISTRATION_TIMING_BUCKETS, this.buckets);
  }

  spansSnapshot(): readonly RegistrationTimingSpan[] {
    return this.spans.map(copyRegistrationTimingSpan);
  }

  private recordSpan(
    bucket: RegistrationTimingBucketName,
    startedAt: number,
    endedAt: number,
  ): void {
    this.spans.push({
      name: bucket,
      kind: registrationTimingSpanKindFromBucket(bucket),
      startOffsetMs: Math.max(0, Math.round(startedAt - this.startedAt)),
      endOffsetMs: Math.max(0, Math.round(endedAt - this.startedAt)),
    });
  }

  captureRouteDiagnostics(value: unknown): void {
    const sanitized = sanitizeWalletRegistrationRouteDiagnostics(value);
    if (sanitized) this.relayDiagnostics.push(sanitized);
  }

  captureWarmupDiagnostics(diagnostics: RegistrationWarmupDiagnostics): void {
    this.buckets.registrationWarmupAuthenticatedWalletStateMs =
      diagnostics.authenticatedWalletStateMs;
    this.buckets.registrationWarmupNoncePrefetchMs = diagnostics.noncePrefetchMs;
    this.buckets.registrationWarmupKeyMaterialReadMs = diagnostics.keyMaterialReadMs;
    this.buckets.registrationWarmupUiConfirmPrewarmMs = diagnostics.uiConfirmPrewarmMs;
    this.buckets.registrationWarmupSignerWorkerPrewarmMs = diagnostics.signerWorkerPrewarmMs;
    this.buckets.registrationWarmupEmailOtpWorkerPrewarmMs = diagnostics.emailOtpWorkerPrewarmMs;
    this.buckets.registrationWarmupEmailOtpYaoWasmInitMs = diagnostics.emailOtpYaoWasmInitMs;
    this.emailOtpYaoPrewarm = { ...diagnostics.emailOtpYaoPrewarm };
  }

  emailOtpYaoPrewarmSnapshot(): EmailOtpYaoPrewarmOutcome {
    return { ...this.emailOtpYaoPrewarm };
  }

  capturePasskeyAuthDiagnostics(diagnostics: PasskeyRegistrationAuthorityDiagnostics): void {
    this.buckets.passkeyAuthConfirmationMs = diagnostics.requestConfirmationMs;
    this.buckets.passkeyAuthPrfExtractionMs = diagnostics.prfExtractionMs;
    this.buckets.passkeyAuthCredentialRedactionMs = diagnostics.credentialRedactionMs;
    this.buckets.passkeyAuthWorkerReadyMs = diagnostics.confirmationWorkerReadyMs;
    this.buckets.passkeyAuthWorkerRequestRoundTripMs =
      diagnostics.confirmationWorkerRequestRoundTripMs;
    this.buckets.passkeyAuthWorkerResponseValidationMs =
      diagnostics.confirmationWorkerResponseValidationMs;
    this.buckets.passkeyAuthRequestSetupMs = diagnostics.confirmationRequestSetupMs;
    this.buckets.passkeyAuthPromptUserMs = diagnostics.confirmationPromptUserMs;
    this.buckets.passkeyAuthPromptElementDefineMs = diagnostics.confirmationPromptElementDefineMs;
    this.buckets.passkeyAuthPromptMountMs = diagnostics.confirmationPromptMountMs;
    this.buckets.passkeyAuthPromptHostFirstUpdateMs =
      diagnostics.confirmationPromptHostFirstUpdateMs;
    this.buckets.passkeyAuthPromptHostInteractiveMs =
      diagnostics.confirmationPromptHostInteractiveMs;
    this.buckets.passkeyAuthPromptConfirmEventMs = diagnostics.confirmationPromptConfirmEventMs;
    this.buckets.passkeyAuthPromptDecisionWaitMs = diagnostics.confirmationPromptDecisionWaitMs;
    this.buckets.passkeyAuthCredentialCreateStartMs =
      diagnostics.confirmationCredentialCreateStartMs;
    this.buckets.passkeyAuthCredentialCreateMs = diagnostics.confirmationCredentialCreateMs;
    this.buckets.passkeyAuthCredentialSerializeMs = diagnostics.confirmationCredentialSerializeMs;
    this.buckets.passkeyAuthDuplicateRetryCount = diagnostics.confirmationDuplicateRetryCount;
    this.buckets.passkeyAuthMainThreadTotalMs = diagnostics.confirmationMainThreadTotalMs;
  }

  routeDiagnosticsSnapshot(): WalletRegistrationRouteDiagnostics[] {
    return this.relayDiagnostics.map(copyWalletRegistrationRouteDiagnostics);
  }

  totalMs(): number {
    return roundDurationMs(this.startedAt);
  }
}

export type RegistrationWarmupDiagnostics = WorkerResourceWarmupDiagnostics & {
  emailOtpWorkerPrewarmMs: number;
  emailOtpYaoWasmInitMs: number;
  emailOtpYaoPrewarm: EmailOtpYaoPrewarmOutcome;
};

export function zeroEmailOtpYaoPrewarmDiagnostics(): EmailOtpYaoPrewarmOutcome {
  return {
    kind: 'not_requested',
    elapsedMs: 0,
    workerPrewarmMs: 0,
    yaoWasmInitMs: 0,
  };
}

export function createSucceededRegistrationTimingSummary(input: {
  recorder: RegistrationTimingRecorder;
  authMethod: RegistrationTimingAuthMethod;
  signerSet: RegistrationTimingSignerSet;
}): SucceededRegistrationTimingSummary {
  const totalMs = input.recorder.totalMs();
  const buckets = input.recorder.snapshot();
  return {
    kind: 'registration_timing_summary_v2',
    status: 'succeeded',
    authMethod: input.authMethod,
    signerSet: input.signerSet,
    totalMs,
    criticalPath: buildRegistrationCriticalPathSummary({
      totalElapsedMs: totalMs,
      buckets,
      spans: input.recorder.spansSnapshot(),
    }),
    relayDiagnostics: input.recorder.routeDiagnosticsSnapshot(),
    timings: buildRegistrationTimingBuckets({
      authMethod: input.authMethod,
      signerSet: input.signerSet,
      buckets,
      emailOtpYaoPrewarm: input.recorder.emailOtpYaoPrewarmSnapshot(),
    }),
  };
}

export function createFailedRegistrationTimingSummary(input: {
  recorder: RegistrationTimingRecorder;
  authMethod: RegistrationTimingAuthMethod;
  signerSet: RegistrationTimingSignerSet;
  errorCode: string | null;
}): FailedRegistrationTimingSummary {
  const totalMs = input.recorder.totalMs();
  const buckets = input.recorder.snapshot();
  return {
    kind: 'registration_timing_summary_v2',
    status: 'failed',
    authMethod: input.authMethod,
    signerSet: input.signerSet,
    totalMs,
    criticalPath: buildRegistrationCriticalPathSummary({
      totalElapsedMs: totalMs,
      buckets,
      spans: input.recorder.spansSnapshot(),
    }),
    errorCode: input.errorCode,
    relayDiagnostics: input.recorder.routeDiagnosticsSnapshot(),
    timings: buildRegistrationTimingBuckets({
      authMethod: input.authMethod,
      signerSet: input.signerSet,
      buckets,
      emailOtpYaoPrewarm: input.recorder.emailOtpYaoPrewarmSnapshot(),
    }),
  };
}

export function emitRegistrationTimingSummary(summary: RegistrationTimingSummary): void {
  if (!isRegistrationBenchmarkDiagnosticsEnabled()) return;
  console.info(REGISTRATION_TIMING_LABEL, summary);
  console.info(`${REGISTRATION_TIMING_LABEL} ${JSON.stringify(summary)}`);
}

export function emitRegistrationTimingSpan(input: {
  callback: RegistrationHooksOptions['onTimingSpan'];
  span: RegistrationTimingSpanV1['span'];
  outcome: RegistrationTimingSpanV1['outcome'];
  durationMs: number;
  traceContext: RouterAbTraceContextV1;
}): void {
  const event: RegistrationTimingSpanV1 = {
    event: 'seams_registration_timing_span_v1',
    span: input.span,
    operation: 'registration',
    outcome: input.outcome,
    duration_ms: Math.max(0, Math.round(input.durationMs)),
    trace_id: input.traceContext.value,
  };
  try {
    input.callback?.(event);
  } catch {
    // Telemetry must never change registration behavior.
  }
}

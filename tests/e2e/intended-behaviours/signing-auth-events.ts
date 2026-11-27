import { assertNever } from './harness-validation';
import type { IntendedPageSnapshot } from './intended-page-snapshot';
import type { WalletIframeAutoConfirmDiagnostics } from './wallet-iframe-confirm';

export type IntendedSigningStage =
  | 'post_registration'
  | 'post_unlock'
  | 'post_device_link'
  | 'after_refresh_recovery'
  | 'step_up_required';

type SigningAuthExpectation = 'warm_session' | 'passkey_step_up' | 'email_otp_step_up';

export type SigningAuthEventSummary = {
  phases: readonly string[];
  authenticationMethods: readonly SigningAuthMethod[];
  remainingUses: readonly number[];
  warmSessionClaimed: boolean;
  /** Every warm claim came from an active Wallet Authority, whose budget the
      server keeps: that plan carries no remaining uses. A warm-session plan
      promises them, so any warm-session claim keeps the check. */
  activeWalletAuthorityClaimed: boolean;
  passkeyPromptStarted: boolean;
  passkeyPromptSucceeded: boolean;
  passkeyAuthenticationComplete: boolean;
  emailOtpChallengeStarted: boolean;
  emailOtpChallengeSent: boolean;
  emailOtpVerifyStarted: boolean;
  emailOtpVerifySucceeded: boolean;
  emailOtpAuthenticationComplete: boolean;
  thresholdReconnectStarted: boolean;
  thresholdReconnectSucceeded: boolean;
};

type KeyExportAuthEventSummary = {
  phases: readonly string[];
  passkeyPromptStarted: boolean;
  passkeyPromptSucceeded: boolean;
};

export type AuthCounterIncrement = {
  passkeyPrompts: number;
  emailOtpVerifications: number;
};

type SigningAuthMethod = 'passkey' | 'email_otp' | 'warm_session';
const SIGNING_AUTH_WARM_SESSION_CLAIMED = 'signing.auth.warm_session.claimed';
const SIGNING_AUTH_PASSKEY_PROMPT_STARTED = 'signing.auth.passkey.prompt.started';
const SIGNING_AUTH_PASSKEY_PROMPT_SUCCEEDED = 'signing.auth.passkey.prompt.succeeded';
const SIGNING_AUTH_EMAIL_OTP_CHALLENGE_STARTED = 'signing.auth.email_otp.challenge.started';
const SIGNING_AUTH_EMAIL_OTP_CHALLENGE_SENT = 'signing.auth.email_otp.challenge.sent';
const SIGNING_AUTH_EMAIL_OTP_VERIFY_STARTED = 'signing.auth.email_otp.verify.started';
const SIGNING_AUTH_EMAIL_OTP_VERIFY_SUCCEEDED = 'signing.auth.email_otp.verify.succeeded';
const SIGNING_AUTHENTICATION_COMPLETE = 'signing.authentication.complete';
const SIGNING_THRESHOLD_SESSION_RECONNECT_STARTED = 'signing.threshold_session.reconnect.started';
const SIGNING_THRESHOLD_SESSION_RECONNECT_SUCCEEDED =
  'signing.threshold_session.reconnect.succeeded';
const KEY_EXPORT_AUTH_PASSKEY_PROMPT_STARTED = 'key_export.auth.passkey.prompt.started';
const KEY_EXPORT_AUTH_PASSKEY_PROMPT_SUCCEEDED = 'key_export.auth.passkey.prompt.succeeded';

export function signingAuthExpectationForStage(
  authFamily: 'passkey' | 'email_otp',
  stage: IntendedSigningStage,
): SigningAuthExpectation {
  switch (stage) {
    case 'post_registration':
      return 'warm_session';
    case 'post_unlock':
    case 'post_device_link':
    case 'after_refresh_recovery':
      return 'warm_session';
    case 'step_up_required':
      return authFamily === 'passkey' ? 'passkey_step_up' : 'email_otp_step_up';
    default:
      return assertNever(stage);
  }
}

export function summarizeSigningAuthEvents(
  snapshot: IntendedPageSnapshot,
): SigningAuthEventSummary {
  const phases: string[] = [];
  const authenticationMethods: SigningAuthMethod[] = [];
  const remainingUses: number[] = [];
  let warmSessionClaimed = false;
  let authorityClaims = 0;
  let warmSessionPlanClaims = 0;
  let passkeyPromptStarted = false;
  let passkeyPromptSucceeded = false;
  let passkeyAuthenticationComplete = false;
  let emailOtpChallengeStarted = false;
  let emailOtpChallengeSent = false;
  let emailOtpVerifyStarted = false;
  let emailOtpVerifySucceeded = false;
  let emailOtpAuthenticationComplete = false;
  let thresholdReconnectStarted = false;
  let thresholdReconnectSucceeded = false;

  for (const event of snapshot.events) {
    const phase = signingEventPhase(event.payload);
    if (!phase) continue;
    phases.push(phase);
    const maybeRemainingUses = signingEventRemainingUses(event.payload);
    if (maybeRemainingUses !== null) {
      remainingUses.push(maybeRemainingUses);
    }
    const completedAuthMethod = signingAuthenticationCompleteAuthMethod(event.payload, phase);
    if (completedAuthMethod) {
      authenticationMethods.push(completedAuthMethod);
      switch (completedAuthMethod) {
        case 'passkey':
          passkeyAuthenticationComplete = true;
          break;
        case 'email_otp':
          emailOtpAuthenticationComplete = true;
          break;
        case 'warm_session':
          break;
        default:
          assertNever(completedAuthMethod);
      }
    }
    switch (phase) {
      case SIGNING_AUTH_WARM_SESSION_CLAIMED:
        warmSessionClaimed = true;
        if (signingEventClaimedActiveWalletAuthority(event.payload)) authorityClaims += 1;
        else warmSessionPlanClaims += 1;
        break;
      case SIGNING_AUTH_PASSKEY_PROMPT_STARTED:
        passkeyPromptStarted = true;
        break;
      case SIGNING_AUTH_PASSKEY_PROMPT_SUCCEEDED:
        passkeyPromptSucceeded = true;
        break;
      case SIGNING_AUTH_EMAIL_OTP_CHALLENGE_STARTED:
        emailOtpChallengeStarted = true;
        break;
      case SIGNING_AUTH_EMAIL_OTP_CHALLENGE_SENT:
        emailOtpChallengeSent = true;
        break;
      case SIGNING_AUTH_EMAIL_OTP_VERIFY_STARTED:
        emailOtpVerifyStarted = true;
        break;
      case SIGNING_AUTH_EMAIL_OTP_VERIFY_SUCCEEDED:
        emailOtpVerifySucceeded = true;
        break;
      case SIGNING_THRESHOLD_SESSION_RECONNECT_STARTED:
        thresholdReconnectStarted = true;
        break;
      case SIGNING_THRESHOLD_SESSION_RECONNECT_SUCCEEDED:
        thresholdReconnectSucceeded = true;
        break;
      default:
        break;
    }
  }

  return {
    phases,
    authenticationMethods,
    remainingUses,
    warmSessionClaimed,
    activeWalletAuthorityClaimed: authorityClaims > 0 && warmSessionPlanClaims === 0,
    passkeyPromptStarted,
    passkeyPromptSucceeded,
    passkeyAuthenticationComplete,
    emailOtpChallengeStarted,
    emailOtpChallengeSent,
    emailOtpVerifyStarted,
    emailOtpVerifySucceeded,
    emailOtpAuthenticationComplete,
    thresholdReconnectStarted,
    thresholdReconnectSucceeded,
  };
}

export function assertSigningAuthExpectation(input: {
  label: string;
  stage: IntendedSigningStage;
  expectation: SigningAuthExpectation;
  summary: SigningAuthEventSummary;
}): void {
  switch (input.expectation) {
    case 'warm_session':
      assertWarmSessionSigningAuth(input);
      return;
    case 'passkey_step_up':
      assertPasskeyStepUpSigningAuth(input);
      return;
    case 'email_otp_step_up':
      assertEmailOtpStepUpSigningAuth(input);
      return;
    default:
      return assertNever(input.expectation);
  }
}

function signingAuthSummaryDetails(summary: SigningAuthEventSummary): string {
  return JSON.stringify({
    phases: summary.phases,
    authenticationMethods: summary.authenticationMethods,
    remainingUses: summary.remainingUses,
    warmSessionClaimed: summary.warmSessionClaimed,
    activeWalletAuthorityClaimed: summary.activeWalletAuthorityClaimed,
    passkeyPromptStarted: summary.passkeyPromptStarted,
    passkeyPromptSucceeded: summary.passkeyPromptSucceeded,
    passkeyAuthenticationComplete: summary.passkeyAuthenticationComplete,
    emailOtpChallengeStarted: summary.emailOtpChallengeStarted,
    emailOtpChallengeSent: summary.emailOtpChallengeSent,
    emailOtpVerifyStarted: summary.emailOtpVerifyStarted,
    emailOtpVerifySucceeded: summary.emailOtpVerifySucceeded,
    emailOtpAuthenticationComplete: summary.emailOtpAuthenticationComplete,
    thresholdReconnectStarted: summary.thresholdReconnectStarted,
    thresholdReconnectSucceeded: summary.thresholdReconnectSucceeded,
  });
}

function assertWarmSessionSigningAuth(input: {
  label: string;
  stage: IntendedSigningStage;
  summary: SigningAuthEventSummary;
}): void {
  const usedNoPromptReconnect =
    input.summary.thresholdReconnectSucceeded &&
    !input.summary.passkeyPromptStarted &&
    !input.summary.passkeyPromptSucceeded &&
    !input.summary.passkeyAuthenticationComplete &&
    !hasAnyEmailOtpSigningEvent(input.summary);
  if (!input.summary.warmSessionClaimed && !usedNoPromptReconnect) {
    throw new Error(
      `${input.label} at ${input.stage} did not claim a warm signing session; observed ${signingAuthSummaryDetails(input.summary)}`,
    );
  }
  if (
    input.summary.passkeyPromptStarted ||
    input.summary.passkeyPromptSucceeded ||
    input.summary.passkeyAuthenticationComplete
  ) {
    throw new Error(`${input.label} at ${input.stage} prompted for passkey before exhaustion`);
  }
  if (hasAnyEmailOtpSigningEvent(input.summary)) {
    throw new Error(`${input.label} at ${input.stage} used Email OTP before exhaustion`);
  }
  if (
    input.summary.remainingUses.length === 0 &&
    !usedNoPromptReconnect &&
    !input.summary.activeWalletAuthorityClaimed
  ) {
    throw new Error(`${input.label} at ${input.stage} did not report remaining signing uses`);
  }
}

function assertPasskeyStepUpSigningAuth(input: {
  label: string;
  stage: IntendedSigningStage;
  summary: SigningAuthEventSummary;
}): void {
  const performedPasskeyAuth =
    input.summary.passkeyPromptStarted ||
    input.summary.passkeyPromptSucceeded ||
    input.summary.passkeyAuthenticationComplete;
  if (!performedPasskeyAuth) {
    throw new Error(
      `${input.label} at ${input.stage} did not perform passkey step-up; observed ${signingAuthSummaryDetails(input.summary)}`,
    );
  }
  if (hasAnyEmailOtpSigningEvent(input.summary)) {
    throw new Error(`${input.label} at ${input.stage} used Email OTP in a passkey lifecycle`);
  }
}

function assertEmailOtpStepUpSigningAuth(input: {
  label: string;
  stage: IntendedSigningStage;
  summary: SigningAuthEventSummary;
}): void {
  const performedEmailOtpAuth =
    input.summary.emailOtpChallengeSent ||
    input.summary.emailOtpVerifySucceeded ||
    input.summary.emailOtpAuthenticationComplete;
  if (!performedEmailOtpAuth) {
    throw new Error(
      `${input.label} at ${input.stage} did not perform Email OTP step-up; observed ${signingAuthSummaryDetails(input.summary)}`,
    );
  }
  if (
    input.summary.passkeyPromptStarted ||
    input.summary.passkeyPromptSucceeded ||
    input.summary.passkeyAuthenticationComplete
  ) {
    throw new Error(`${input.label} at ${input.stage} used passkey in an Email OTP lifecycle`);
  }
}

export function summarizeKeyExportAuthEvents(
  snapshot: IntendedPageSnapshot,
): KeyExportAuthEventSummary {
  const phases: string[] = [];
  let passkeyPromptStarted = false;
  let passkeyPromptSucceeded = false;

  for (const event of snapshot.events) {
    const phase = signingEventPhase(event.payload);
    if (!phase) continue;
    phases.push(phase);
    switch (phase) {
      case KEY_EXPORT_AUTH_PASSKEY_PROMPT_STARTED:
        passkeyPromptStarted = true;
        break;
      case KEY_EXPORT_AUTH_PASSKEY_PROMPT_SUCCEEDED:
        passkeyPromptSucceeded = true;
        break;
      default:
        break;
    }
  }

  return {
    phases,
    passkeyPromptStarted,
    passkeyPromptSucceeded,
  };
}

export function assertPasskeyKeyExportAuth(input: {
  label: string;
  summary: KeyExportAuthEventSummary;
  diagnostics: WalletIframeAutoConfirmDiagnostics | null;
}): void {
  if (!input.summary.passkeyPromptStarted || !input.summary.passkeyPromptSucceeded) {
    throw new Error(
      `${input.label} did not require fresh passkey export authorization; observed ${keyExportAuthSummaryDetails(input.summary)}`,
    );
  }
  if (input.diagnostics?.otpFilled) {
    throw new Error(`${input.label} filled Email OTP in a passkey lifecycle`);
  }
}

export function assertEmailOtpKeyExportAuth(input: {
  label: string;
  summary: KeyExportAuthEventSummary;
  diagnostics: WalletIframeAutoConfirmDiagnostics | null;
}): void {
  if (input.summary.passkeyPromptStarted || input.summary.passkeyPromptSucceeded) {
    throw new Error(`${input.label} used passkey export authorization in an Email OTP lifecycle`);
  }
  if (!input.diagnostics?.otpFilled) {
    throw new Error(
      `${input.label} did not fill a fresh Email OTP export authorization; diagnostics ${JSON.stringify(input.diagnostics)}`,
    );
  }
}

function keyExportAuthSummaryDetails(summary: KeyExportAuthEventSummary): string {
  return JSON.stringify({
    phases: summary.phases,
    passkeyPromptStarted: summary.passkeyPromptStarted,
    passkeyPromptSucceeded: summary.passkeyPromptSucceeded,
  });
}

function hasAnyEmailOtpSigningEvent(summary: SigningAuthEventSummary): boolean {
  return (
    summary.emailOtpChallengeStarted ||
    summary.emailOtpChallengeSent ||
    summary.emailOtpVerifyStarted ||
    summary.emailOtpVerifySucceeded ||
    summary.emailOtpAuthenticationComplete
  );
}

export function signingPasskeyPromptCount(summary: SigningAuthEventSummary): number {
  return summary.passkeyPromptStarted ||
    summary.passkeyPromptSucceeded ||
    summary.passkeyAuthenticationComplete
    ? 1
    : 0;
}

export function signingEmailOtpVerificationCount(summary: SigningAuthEventSummary): number {
  return hasAnyEmailOtpSigningEvent(summary) ? 1 : 0;
}

export function minimumRemainingUse(summary: SigningAuthEventSummary): number | null {
  if (summary.remainingUses.length === 0) return null;
  return Math.min(...summary.remainingUses);
}

function signingEventPhase(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const phase = Reflect.get(payload, 'phase');
  return typeof phase === 'string' ? phase : null;
}

function signingEventClaimedActiveWalletAuthority(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const data = Reflect.get(payload, 'data');
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return false;
  return (
    typeof Reflect.get(data, 'authorityId') === 'string' &&
    typeof Reflect.get(data, 'walletSessionId') === 'string'
  );
}

function signingEventRemainingUses(payload: unknown): number | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const data = Reflect.get(payload, 'data');
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const remainingUses = Reflect.get(data, 'remainingUses');
  if (typeof remainingUses !== 'number' || !Number.isFinite(remainingUses)) return null;
  return remainingUses;
}

function signingAuthenticationCompleteAuthMethod(
  payload: unknown,
  phase: string,
): SigningAuthMethod | null {
  if (phase !== SIGNING_AUTHENTICATION_COMPLETE) return null;
  return eventAuthMethod(payload);
}

function eventAuthMethod(payload: unknown): SigningAuthMethod | null {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const authMethod = Reflect.get(payload, 'authMethod');
  if (authMethod === 'passkey' || authMethod === 'email_otp' || authMethod === 'warm_session') {
    return authMethod;
  }
  return null;
}

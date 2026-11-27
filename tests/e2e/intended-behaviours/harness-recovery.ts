import { readPendingWalletRecoveryCommitIdentity } from './recovery-journal';
import {
  type CommitRecoveryFinalization,
  concealFirstRecoveryFinalizationResponse,
  createRecoveryFinalizationResponseLoss,
  failFirstRecoveryFinalization,
  fetchRecoveryFinalizationStatus,
  type RecoveryFinalizeFailure,
} from './recovery-finalization-fault';
import {
  expect,
  type Frame,
  type FrameLocator,
  type Page,
  type Request,
  type Response,
  type Route,
} from '@playwright/test';
import { base64UrlEncode } from '@shared/utils/encoders';
import { decodeWalletRecoveryCode } from '@shared/wallet-recovery/recoveryCodes';
import {
  ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1,
} from '@shared/utils/routerAbEd25519Yao';
import type { WalletRecoveryTargetV1 } from '@shared/wallet-recovery/walletRecoveryTarget';
import { INTENDED_ACTIONS, type IntendedResult } from '../../intended-app/src/intendedContract';
import { randomUUID } from 'node:crypto';
import { AuthMethodFlows } from './harness-auth-methods';
import {
  LOCAL_INTENDED_YAO_RECOVERY_FAULT_HEADER_V1,
  LOCAL_INTENDED_YAO_RECOVERY_FAULT_TOKEN_HEADER_V1,
  LOCAL_INTENDED_YAO_SIGNING_FAULT_HEADER_V1,
  LOCAL_INTENDED_YAO_SIGNING_FAULT_TOKEN_HEADER_V1,
  type RecoveryAuthorityProjection,
  ROUTER_AB_ED25519_SIGNING_FINALIZE_PATH,
  ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH,
  ROUTER_AB_WALLET_RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_PATH,
  ROUTER_AB_WALLET_RECOVERY_PREPARE_PATH,
} from './harness-core';
import {
  requireLocalIntendedYaoFaultRouterOrigin,
  requireUsableIntendedGoogleIdToken,
} from './harness-environment';
import { assertNever, requireRecord, requireString } from './harness-validation';
import { requireWalletResult } from './intended-page-snapshot';
import {
  type RegisteredWalletSnapshot,
  requireNearReadyRegisteredWallet,
} from './registered-wallet';
import {
  autoConfirmWalletIframeUntil,
  type WalletIframeAutoConfirmDiagnostics,
} from './wallet-iframe-confirm';

export type IntendedRecoveryTargetKind = WalletRecoveryTargetV1['kind'];
/* The SigningWorker's refusal of an activation a recovery replaced. */
const SIGNING_WORKER_ACTIVATION_RETIRED_MESSAGE = 'SigningWorker activation is retired';

type RecoveryRequestKind = 'finalize' | 'replay';

type RecoveryRequestIdentity = {
  readonly kind: RecoveryRequestKind;
  readonly path: string;
  readonly target: IntendedRecoveryTargetKind;
  readonly walletId: string;
  readonly recoveryOperationId: string;
  readonly reservationId: string;
  readonly targetDeviceId: string | null;
  readonly targetAuthorityId: string | null;
  readonly targetWalletAuthMethodId: string | null;
  readonly replacementId: string | null;
};

type RecoveryRequestCapture = {
  readonly kind: RecoveryRequestKind;
  readonly path: string;
  readonly target: IntendedRecoveryTargetKind;
  readonly walletId: string;
  request: RecoveryRequestIdentity | null;
  error: string | null;
};

type IntendedRecoveryAction =
  | {
      readonly target: Extract<IntendedRecoveryTargetKind, 'passkey'>;
      readonly name: 'recoverPasskeyWallet';
    }
  | {
      readonly target: Extract<IntendedRecoveryTargetKind, 'google_email_otp'>;
      readonly name: 'recoverGoogleEmailOtpWallet';
    };

/** Wallet recovery with a recovery code, and its faults. */
export class RecoveryFlows extends AuthMethodFlows {
  async recoverPasskeyWalletFromFreshBrowser(): Promise<void> {
    this.recordStage('recover_passkey_wallet_from_fresh_browser');
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({
      action: recoveryActionForTarget('passkey'),
    });
    await driveHostedPasskeyRecovery(this.page, recoveryCode);
    await this.finishPasskeyRecovery(registration, 2);
    this.recordService('fresh-browser passkey recovery completed through normal passkey login');
  }

  async recoverPasskeyWalletAfterFailedFinalization(): Promise<void> {
    this.recordStage('recover_passkey_wallet_after_failed_finalization');
    const action = recoveryActionForTarget('passkey');
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({ action });
    const prepareCapture: RecoveryPrepareCapture = { reservationIds: [] };
    const capturePrepareReservation = captureRecoveryPrepareReservation.bind(null, prepareCapture);
    const finalizeFailure: RecoveryFinalizeFailure = { injected: false };
    const failFirstFinalization = failFirstRecoveryFinalization.bind(null, finalizeFailure);
    this.page.on('request', capturePrepareReservation);
    await this.page.route(`**${ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH}`, failFirstFinalization);
    try {
      const frame = await fillHostedRecoveryCode(this.page, recoveryCode, 'passkey');
      await expect(frame.locator('.seams-recovery-status')).toHaveText(
        'Recovery couldn’t be completed. Try again.',
        { timeout: 60_000 },
      );
      await frame.getByRole('button', { name: 'Retry finalization', exact: true }).click({
        timeout: 30_000,
      });
      await waitForHostedPasskeyRecoverySignIn(this.page, frame);
    } finally {
      await this.page.unroute(
        `**${ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH}`,
        failFirstFinalization,
      );
      this.page.off('request', capturePrepareReservation);
    }
    const snapshot = await this.waitForIntendedPageActionCompletion(action.name, 'success');
    const result = requireWalletResult(
      snapshot,
      'passkey_recovery_success',
      'Passkey recovery',
      this.walletId,
    );
    this.assertRecoveryCodeConsumption(result);
    if (prepareCapture.reservationIds.length !== 1 || !finalizeFailure.injected) {
      throw new Error('Recovery finalization retry did not reuse the admitted recovery operation');
    }
    await this.assertRecoveredWalletLoggedIn(registration.walletId);
    this.passkeyPromptCount += 3;
    this.operatingAuthFamily = 'passkey';
    this.currentWarmSigningStage = 'post_unlock';
    this.recordService('failed finalization left the admitted recovery code reusable');
  }

  /**
   * A fresh-browser recovery whose first attempt is interrupted: the Router
   * runs its execution, staging the attempt's candidate at the SigningWorker,
   * and every reply to it is lost, the Gateway's replay included. The Gateway
   * records the execution as interrupted. Retrying with the same code starts a
   * new attempt of the same recovery, which takes the interrupted attempt's
   * place at the Gateway and its candidate's place at the SigningWorker, then
   * recovers.
   */
  async recoverPasskeyWalletAfterInterruptedAttempt(): Promise<void> {
    this.recordStage('recover_passkey_wallet_after_interrupted_attempt');
    const action = recoveryActionForTarget('passkey');
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({ action });
    const frame = await this.failRecoveryAttemptUnderFault(
      recoveryCode,
      'lose_router_recovery_replies',
    );
    await frame.getByRole('button', { name: 'Retry finalization', exact: true }).click({
      timeout: 30_000,
    });
    await waitForHostedPasskeyRecoverySignIn(this.page, frame);
    await this.finishPasskeyRecovery(registration, 3);
    this.recordService('a retry with the same code superseded the interrupted recovery attempt');
  }

  /**
   * A superseded recovery attempt reaches the SigningWorker late, after the
   * attempt that superseded it staged its candidate, and displaces nothing.
   * The first attempt's execution is kept from the Router, so the Gateway
   * records it interrupted. A retry with the same code starts a new attempt,
   * which supersedes the first, executes and stages. Before the new attempt
   * promotes, the kept execution reaches the Router, which runs it and
   * delivers its packages to the SigningWorker. The new attempt still
   * promotes, and the wallet recovers.
   */
  async recoverPasskeyWalletAcrossALateSupersededAttempt(): Promise<void> {
    this.recordStage('recover_passkey_wallet_across_late_superseded_attempt');
    const action = recoveryActionForTarget('passkey');
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({ action });
    const kept = randomUUID();
    const frame = await this.failRecoveryAttemptUnderFault(
      recoveryCode,
      'withhold_router_recovery_execute',
      kept,
    );
    const activationGate = new RecoveryReplayGate();
    const holdActivation = holdRecoveryReplayUntilReleased.bind(null, activationGate);
    const activationPattern = `**${ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1}`;
    const activationRequested = this.page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        new URL(request.url()).pathname === ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1,
      { timeout: 120_000 },
    );
    await this.context.route(activationPattern, holdActivation);
    try {
      await frame.getByRole('button', { name: 'Retry finalization', exact: true }).click({
        timeout: 30_000,
      });
      // The new attempt has executed and staged; its promotion waits here.
      await activationRequested;
      const late = await this.releaseKeptRecoveryExecute(kept);
      this.recordService(
        `the superseded attempt's late execution answered ${late.status} ${late.body}`,
      );
      let answer: unknown = null;
      try {
        answer = JSON.parse(late.body);
      } catch {
        // A refusal need not be JSON.
      }
      if (
        late.status === 200 &&
        (answer as { readonly status?: unknown } | null)?.status === 'succeeded'
      ) {
        throw new Error(
          `The superseded attempt's late execution staged at the SigningWorker: ${late.body}`,
        );
      }
      /* The Router ran the late execution, and the SigningWorker refused its
         packages as a superseded attempt. Every Router answers that as
         final, so nothing retries it. */
      const refusal = answer as { readonly status?: unknown; readonly code?: unknown } | null;
      if (
        late.status !== 200 ||
        refusal?.status !== 'rejected' ||
        refusal.code !== 'attempt_superseded'
      ) {
        throw new Error(
          `The superseded attempt's late execution was not refused as superseded: ${late.status} ${late.body}`,
        );
      }
    } finally {
      activationGate.release();
      await this.context.unroute(activationPattern, holdActivation);
    }
    await waitForHostedPasskeyRecoverySignIn(this.page, frame);
    await this.finishPasskeyRecovery(registration, 3);
    this.recordService(
      'a superseded attempt that reached the SigningWorker after its successor staged was refused',
    );
  }

  async recoverPasskeyWalletAfterLostFinalizationResponse(
    commitFinalization: CommitRecoveryFinalization = fetchRecoveryFinalizationStatus,
  ): Promise<void> {
    this.recordStage('recover_passkey_wallet_after_lost_finalization_response');
    await this.recoverAcrossLostFinalizationResponse({
      target: 'passkey',
      path: ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH,
      label: 'Passkey',
      commitFinalization,
    });
    await this.unlockPasskeyWallet();
    await this.signTempoTransaction('post_unlock');
    await this.signNearTransaction('post_unlock');
    await this.assertConsumedRecoveryCodeReportedAsUsed();
    this.recordService('Passkey recovery replayed its committed finalization after response loss');
  }

  /**
   * A fresh-browser recovery whose first finalization commits and loses its response. The
   * runtime then resets with the finalization in the durable journal, which must replay it.
   */
  private async recoverAcrossLostFinalizationResponse(input: {
    readonly target: IntendedRecoveryTargetKind;
    readonly path: string;
    readonly label: string;
    readonly commitFinalization: CommitRecoveryFinalization;
  }): Promise<void> {
    const action = recoveryActionForTarget(input.target);
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({ action });
    const finalizeFailure = createRecoveryFinalizationResponseLoss(input.commitFinalization);
    const finalizationCapture = createRecoveryRequestCapture({
      kind: 'finalize',
      path: input.path,
      target: input.target,
      walletId: registration.walletId,
    });
    const captureFinalizationRequest = captureRecoveryRequest.bind(null, finalizationCapture);
    const concealFirstFinalization = concealFirstRecoveryFinalizationResponse.bind(
      null,
      finalizeFailure,
    );
    this.page.on('request', captureFinalizationRequest);
    await this.page.route(`**${input.path}`, concealFirstFinalization);
    const firstFinalizationRequest = this.page.waitForRequest(
      (request) => isRecoveryFinalizationRequest(request, input.path),
      { timeout: 120_000 },
    );
    const firstFinalizationResponse = this.page.waitForResponse(
      (response) => isRecoveryFinalizationResponse(response, input.path, 503),
      { timeout: 120_000 },
    );
    try {
      await fillHostedRecoveryCode(this.page, recoveryCode, input.target);
      if (input.target === 'passkey') {
        await firstFinalizationRequest;
      } else {
        /* A Google recovery asks for an email code, which the auto-confirm enters. */
        await autoConfirmWalletIframeUntil(this.page, firstFinalizationRequest, {
          timeoutMs: 120_000,
          intervalMs: 250,
        });
      }
      await firstFinalizationResponse;
      if (!finalizeFailure.injected) {
        throw new Error(
          `${input.label} recovery did not reach the injected finalization response loss`,
        );
      }
      /* The conceal route keeps blocking duplicate submissions while the
         journal check runs, so a straggling confirm click cannot commit the
         finalization the runtime-reset replay is expected to deliver. */
      await this.waitForPendingWalletRecoveryCommit(
        requireCapturedRecoveryRequest(finalizationCapture),
        'present',
      );
    } finally {
      await this.page.unroute(`**${input.path}`, concealFirstFinalization);
      this.page.off('request', captureFinalizationRequest);
    }
    const finalization = requireCapturedRecoveryRequest(finalizationCapture);
    await this.resumeCommittedRecoveryAfterRuntimeReset(finalization);
  }

  async recoverGoogleEmailOtpWalletFromFreshBrowser(): Promise<void> {
    this.recordStage('recover_google_email_otp_wallet_from_fresh_browser');
    requireUsableIntendedGoogleIdToken(this.config);
    const { registration, recoveryCode } = await this.beginFreshBrowserRecovery({
      action: recoveryActionForTarget('google_email_otp'),
    });
    await fillHostedRecoveryCode(this.page, recoveryCode, 'google_email_otp');
    const diagnostics: WalletIframeAutoConfirmDiagnostics = { attempts: 0, clicked: false };
    const snapshot = await autoConfirmWalletIframeUntil(
      this.page,
      this.waitForIntendedPageActionCompletion('recoverGoogleEmailOtpWallet', 'success'),
      {
        timeoutMs: 120_000,
        intervalMs: 250,
        diagnostics,
      },
    );
    this.latestPageSnapshot = snapshot;
    this.latestWalletIframeAutoConfirmDiagnostics = diagnostics;
    const result = requireWalletResult(
      snapshot,
      'google_email_otp_recovery_success',
      'Google Email OTP recovery',
      this.walletId,
    );
    this.assertRecoveryCodeConsumption(result);
    await this.assertRecoveredWalletLoggedIn(registration.walletId);
    this.emailOtpVerificationCount += 1;
    this.operatingAuthFamily = 'email_otp';
    this.currentWarmSigningStage = 'post_unlock';
    this.recordService('fresh-browser Google Email OTP recovery completed through normal login');
  }

  async recoverGoogleEmailOtpWalletAfterLostFinalizationResponse(
    commitFinalization: CommitRecoveryFinalization = fetchRecoveryFinalizationStatus,
  ): Promise<void> {
    this.recordStage('recover_google_email_otp_wallet_after_lost_finalization_response');
    requireUsableIntendedGoogleIdToken(this.config);
    await this.recoverAcrossLostFinalizationResponse({
      target: 'google_email_otp',
      path: ROUTER_AB_WALLET_RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_PATH,
      label: 'Google',
      commitFinalization,
    });
    /* This device re-established custody through the Google Email OTP
       recovery, so the recovered method - not the founding passkey - is the
       factor that unlocks here. The Passkey mirror case covers the
       passkey-bound custody path. The replayed finalization response carries
       the committed projection naming the installed method. */
    const projection = await this.waitForRecoveryAuthorityProjection();
    this.addedWalletAuthMethodId = projection.authMethodWalletAuthMethodId;
    await this.unlockWithAddedEmailOtp();
    await this.signTempoTransaction('post_unlock');
    await this.signNearTransaction('post_unlock');
    await this.assertConsumedRecoveryCodeReportedAsUsed('google_email_otp');
    this.recordService('Google recovery replayed its committed finalization after response loss');
  }

  /**
   * Enters the recovery code with one recovery fault armed for the attempt, and waits for the
   * attempt to fail. The Gateway's proof header shows which fault it applied.
   */
  private async failRecoveryAttemptUnderFault(
    recoveryCode: string,
    mode: 'lose_router_recovery_replies' | 'withhold_router_recovery_execute',
    token: string = randomUUID(),
  ): Promise<FrameLocator> {
    if (this.intendedYaoRecoveryFault !== null) {
      throw new Error('An intended Yao recovery fault is already armed');
    }
    requireLocalIntendedYaoFaultRouterOrigin(this.config.routerUrl);
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    this.intendedYaoRecoveryFault = { mode, token };
    let frame: FrameLocator;
    try {
      frame = await fillHostedRecoveryCode(this.page, recoveryCode, 'passkey');
      await expect(frame.locator('.seams-recovery-status').last()).toHaveText(
        'Recovery couldn’t be completed. Try again.',
        { timeout: 120_000 },
      );
    } finally {
      this.intendedYaoRecoveryFault = null;
    }
    this.assertIntendedYaoFaultProof(
      proofStartIndex,
      token,
      mode === 'lose_router_recovery_replies'
        ? 'recovery_replies_lost_after_router_executed'
        : 'recovery_execute_withheld',
    );
    return frame;
  }

  async assertRecoveryAuthorityIsAdditive(target: IntendedRecoveryTargetKind): Promise<void> {
    const projection = await this.waitForRecoveryAuthorityProjection();
    const expectedMethod = target === 'passkey' ? 'passkey' : 'email_otp';
    if (projection.walletId !== this.walletId) {
      throw new Error('Recovery authority projection named a different wallet');
    }
    if (projection.authMethodKind !== expectedMethod) {
      throw new Error(
        `Recovery authority installed ${projection.authMethodKind}, expected ${expectedMethod}`,
      );
    }
    if (projection.authorityId === projection.continuityAuthorityId) {
      throw new Error('Recovery reused the continuity authority instead of adding one');
    }
    if (projection.authMethodWalletAuthorityId !== projection.authorityId) {
      throw new Error('Recovery method is not bound to the recovered authority');
    }
    this.recordService(`recovery installed an additive ${expectedMethod} authority`);
  }

  async assertSourceWalletSessionRemainsActive(): Promise<void> {
    const captured = this.sourceWalletBudgetStatusRequest;
    if (!captured) {
      throw new Error('Source Wallet Session authorization was not captured before recovery');
    }
    const replay = await this.replayWalletBudgetStatus(captured);
    if (
      replay.kind !== 'active' ||
      replay.walletSessionId !== captured.walletSessionId ||
      replay.quotaId !== captured.quotaId
    ) {
      throw new Error('The pre-recovery Wallet Session was not active after recovery');
    }
    this.recordService('source Wallet Session remained active after recovery');
  }

  async assertConsumedRecoveryCodeReportedAsUsed(
    target: IntendedRecoveryTargetKind = 'passkey',
  ): Promise<void> {
    const recoveryCode = this.recoveryCodes[0];
    if (!recoveryCode) throw new Error('Recovery-code reuse requires a captured recovery code');
    await this.assertRecoveryCodeAlreadyUsedServerResponse(recoveryCode, target);
    const action = recoveryActionForTarget(target);
    await this.page.getByTestId(INTENDED_ACTIONS[action.name].button).click();
    await this.waitForIntendedPageActionStarted(action.name);
    const frame = await fillHostedRecoveryCode(this.page, recoveryCode, target);
    await expect(frame.locator('.seams-recovery-status')).toHaveText(
      'That recovery code has already been used. Use another code.',
      { timeout: 30_000 },
    );
    await this.page.goto('about:blank');
    this.intendedPageReady = false;
    this.reloadIntendedPageBeforeNextAction = true;
    this.recordService('server and client identified the consumed recovery code');
  }

  async assertReservedRecoveryCodeReportedAsUsed(): Promise<void> {
    requireUsableIntendedGoogleIdToken(this.config);
    const action = recoveryActionForTarget('google_email_otp');
    const { recoveryCode } = await this.beginFreshBrowserRecovery({ action });
    const preparedResponse = this.page.waitForResponse(isSuccessfulRecoveryPrepareResponse);
    await fillHostedRecoveryCode(this.page, recoveryCode, 'google_email_otp');
    await preparedResponse;
    await this.assertRecoveryCodeAlreadyUsedServerResponse(recoveryCode, 'google_email_otp');
    await this.page.goto('about:blank');
    this.intendedPageReady = false;
    this.reloadIntendedPageBeforeNextAction = true;
    this.recordService('server identified a recovery code held by an active recovery');
  }

  private async assertRecoveryCodeAlreadyUsedServerResponse(
    recoveryCode: string,
    target: IntendedRecoveryTargetKind,
  ): Promise<void> {
    const response = await this.request.post(
      `${this.config.routerUrl}${ROUTER_AB_WALLET_RECOVERY_PREPARE_PATH}`,
      {
        headers: {
          'Content-Type': 'application/json',
          Origin: new URL(this.config.appUrl).origin,
        },
        data: {
          recoveryCodeB64u: base64UrlEncode(decodeWalletRecoveryCode(recoveryCode)),
          reservationId: `wallet-recovery-reservation-${randomUUID().replaceAll('-', '')}`,
          target:
            target === 'passkey'
              ? { kind: 'passkey', rpId: new URL(this.config.appUrl).hostname }
              : { kind: 'google_email_otp', googleProvider: 'google' },
        },
      },
    );
    const body = (await response.json()) as { readonly code?: unknown; readonly message?: unknown };
    expect(response.status()).toBe(401);
    expect(body).toMatchObject({
      code: 'recovery_code_used',
      message: 'that recovery code has already been used',
    });
  }

  private async beginFreshBrowserRecovery(input: {
    readonly action: IntendedRecoveryAction;
  }): Promise<{
    readonly registration: RegisteredWalletSnapshot;
    readonly recoveryCode: string;
  }> {
    const registration = this.requireRegisteredWalletForSigning();
    const recoveryCode = this.recoveryCodes[0];
    if (!recoveryCode) {
      throw new Error(`${input.action.target} recovery requires a captured recovery code`);
    }
    await this.preparedWalletBudgetStatus;
    this.sourceWalletBudgetStatusRequest = this.latestWalletBudgetStatusRequest;
    if (!this.sourceWalletBudgetStatusRequest) {
      throw new Error('Source Wallet Session authorization was not captured before recovery');
    }
    this.recoveryAuthorityProjection = null;
    this.recoveryAuthorityProjectionError = null;
    await this.clearBrowserStorageForColdSync();
    await this.ensureIntendedPageOpen();
    const pageRoot = this.page.getByTestId('intended-e2e-page');
    await expect(pageRoot).toHaveAttribute('data-login-state', 'logged_out');
    await expect(pageRoot).toHaveAttribute('data-login-wallet-id', '');
    await this.page.getByTestId(INTENDED_ACTIONS[input.action.name].button).click();
    await this.waitForIntendedPageActionStarted(input.action.name);
    return { registration, recoveryCode };
  }

  private async resumeCommittedRecoveryAfterRuntimeReset(
    finalization: RecoveryRequestIdentity,
  ): Promise<void> {
    const replayCapture = createRecoveryRequestCapture({
      kind: 'replay',
      path: finalization.path,
      target: finalization.target,
      walletId: finalization.walletId,
    });
    const captureReplayRequest = captureRecoveryRequest.bind(null, replayCapture);
    const replayGate = new RecoveryReplayGate();
    const holdReplay = holdRecoveryReplayUntilReleased.bind(null, replayGate);
    const routePattern = `**${finalization.path}`;
    const replayRequest = this.page.waitForRequest(
      (request) => isRecoveryFinalizationRequest(request, finalization.path),
      { timeout: 120_000 },
    );
    const replayResponse = this.page.waitForResponse(
      (response) => isRecoveryFinalizationResponse(response, finalization.path),
      { timeout: 120_000 },
    );
    this.page.on('request', captureReplayRequest);
    await this.page.route(routePattern, holdReplay);
    try {
      await this.resetRuntimeOnlyState();
      await this.ensureIntendedPageOpen();
      const pageRoot = this.page.getByTestId('intended-e2e-page');
      await expect(pageRoot).toHaveAttribute('data-login-state', 'logged_out');
      await expect(pageRoot).toHaveAttribute('data-login-wallet-id', '');
      await replayRequest;
      const replay = requireCapturedRecoveryRequest(replayCapture);
      assertRecoveryReplayMatchesFinalization(finalization, replay);
      await this.waitForPendingWalletRecoveryCommit(finalization, 'present');
      replayGate.release();
      const response = await replayResponse;
      if (response.status() !== 200) {
        throw new Error(`Durable recovery resume returned HTTP ${response.status()}`);
      }
    } finally {
      replayGate.release();
      await this.page.unroute(routePattern, holdReplay);
      this.page.off('request', captureReplayRequest);
    }
    await this.waitForPendingWalletRecoveryCommit(finalization, 'absent');
    this.recordService('durable recovery resume published local continuity after runtime reset');
  }

  private async waitForPendingWalletRecoveryCommit(
    finalization: RecoveryRequestIdentity,
    expectation: 'present' | 'absent',
  ): Promise<void> {
    if (this.browserSession.kind !== 'ready') {
      throw new Error('Recovery evidence requires the initialized browser session');
    }
    const frame = await walletServiceFrame(this.page, this.config.walletOrigin);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const pending = await readPendingWalletRecoveryCommitIdentity(
        this.browserSession.session,
        frame,
        finalization.recoveryOperationId,
      );
      if (
        pending &&
        (pending.walletId !== finalization.walletId ||
          pending.recoveryOperationId !== finalization.recoveryOperationId)
      ) {
        throw new Error('Recovery journal identity does not match the selected operation');
      }
      const matchesExpectation =
        expectation === 'present'
          ? pending?.stage === 'awaiting_server_promotion'
          : pending === null;
      if (matchesExpectation) {
        this.recordService(
          `durable recovery journal ${expectation} for wallet=${finalization.walletId} operation=${finalization.recoveryOperationId}`,
        );
        return;
      }
      await this.page.waitForTimeout(250);
    }
    throw new Error(
      `Durable recovery journal did not become ${expectation} for wallet=${finalization.walletId} operation=${finalization.recoveryOperationId}`,
    );
  }

  /** The passkey recovery action succeeded and this device is logged in to the wallet. */
  private async finishPasskeyRecovery(
    registration: RegisteredWalletSnapshot,
    passkeyPrompts: number,
  ): Promise<void> {
    const snapshot = await this.waitForIntendedPageActionCompletion(
      'recoverPasskeyWallet',
      'success',
    );
    const result = requireWalletResult(
      snapshot,
      'passkey_recovery_success',
      'Passkey recovery',
      this.walletId,
    );
    this.assertRecoveryCodeConsumption(result);
    await this.assertRecoveredWalletLoggedIn(registration.walletId);
    this.passkeyPromptCount += passkeyPrompts;
    this.operatingAuthFamily = 'passkey';
    this.currentWarmSigningStage = 'post_unlock';
  }

  private assertRecoveryCodeConsumption(
    result: Pick<
      | IntendedResult<'passkey_recovery_success'>
      | IntendedResult<'google_email_otp_recovery_success'>,
      'activeRecoveryCodeCount' | 'totalRecoveryCodeCount'
    >,
  ): void {
    if (result.totalRecoveryCodeCount !== this.recoveryCodes.length) {
      throw new Error('Recovery changed the recovery-set size');
    }
    if (result.activeRecoveryCodeCount !== this.recoveryCodes.length - 1) {
      throw new Error('Recovery did not consume exactly one recovery code');
    }
  }

  private async assertRecoveredWalletLoggedIn(expectedWalletId: string): Promise<void> {
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_in',
      { timeout: 30_000 },
    );
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-wallet-id',
      expectedWalletId,
      { timeout: 30_000 },
    );
  }

  private async waitForRecoveryAuthorityProjection(): Promise<RecoveryAuthorityProjection> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (this.recoveryAuthorityProjection) return this.recoveryAuthorityProjection;
      await this.page.waitForTimeout(50);
    }
    if (this.recoveryAuthorityProjectionError) {
      throw new Error(this.recoveryAuthorityProjectionError);
    }
    throw new Error('Recovery finalization did not return its authority projection');
  }

  /**
   * A recovery retires, at the SigningWorker, the activation it replaced. Two
   * NEAR signatures are authorized under that activation before the recovery
   * begins: one is made, and the Gateway keeps its finalize; the other's
   * finalize the Gateway withholds. The recovery is interrupted once and
   * retried with the same code. Once it promotes, both finalizes reach the
   * Router again: the withheld one is refused as retired, and the one already
   * made answers with its signature.
   */
  async recoverPasskeyWalletRetiringTheReplacedActivation(): Promise<void> {
    this.recordStage('recover_passkey_wallet_retiring_replaced_activation');
    requireLocalIntendedYaoFaultRouterOrigin(this.config.routerUrl);
    const made = await this.keepNearSigningFinalize('capture_signing_finalize');
    const withheld = await this.keepNearSigningFinalize('withhold_signing_finalize');
    await this.recoverPasskeyWalletAfterInterruptedAttempt();
    const delayed = await this.releaseNearSigningFinalize(withheld);
    if (delayed.status < 400 || !delayed.body.includes(SIGNING_WORKER_ACTIVATION_RETIRED_MESSAGE)) {
      throw new Error(
        `A finalize withheld across the recovery was not refused as retired: ${delayed.status} ${delayed.body}`,
      );
    }
    const replayed = await this.releaseNearSigningFinalize(made);
    if (
      replayed.original === null ||
      replayed.status !== replayed.original.status ||
      JSON.stringify(JSON.parse(replayed.body)) !==
        JSON.stringify(JSON.parse(replayed.original.body))
    ) {
      throw new Error(
        `A signature made before the recovery did not answer again: ${replayed.status} ${replayed.body}`,
      );
    }
    this.recordService(
      'the recovery retired the replaced activation: a delayed finalize was refused, a made signature answered again',
    );
  }

  /** Signs NEAR once with every finalize of it kept by the Gateway, run or withheld. */
  private async keepNearSigningFinalize(
    mode: 'capture_signing_finalize' | 'withhold_signing_finalize',
  ): Promise<string> {
    if (this.intendedYaoSigningFault !== null) {
      throw new Error('An intended Yao signing fault is already armed');
    }
    const registration = requireNearReadyRegisteredWallet(
      this.requireRegisteredWalletForSigning(),
      'NEAR signing',
    );
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    const token = randomUUID();
    this.intendedYaoSigningFault = { mode, token };
    try {
      if (mode === 'capture_signing_finalize') {
        await this.signNearTransaction('post_registration');
      } else {
        let signed = false;
        try {
          await this.runNearSigningPageAction(registration.nearAccountId);
          signed = true;
        } catch {
          // The Gateway withheld the finalize, so the signature failed.
        }
        if (signed) throw new Error('A NEAR signature signed although its finalize was withheld');
      }
    } finally {
      this.intendedYaoSigningFault = null;
    }
    const expected = `${token}:${
      mode === 'capture_signing_finalize'
        ? 'signing_finalize_captured'
        : 'signing_finalize_withheld'
    }`;
    const observed = this.intendedYaoFaultProofs.slice(proofStartIndex);
    if (observed.length === 0 || observed.some((proof) => proof !== expected)) {
      throw new Error(
        `Expected intended Yao fault proof ${expected}; observed ${observed.join(', ') || '<none>'}`,
      );
    }
    this.recordService(`intended Yao fault proof: ${expected.slice(token.length + 1)}`);
    return token;
  }

  /** Sends a finalize the Gateway kept to the Router again, and reads the Router's reply. */
  private async releaseNearSigningFinalize(token: string): Promise<{
    readonly status: number;
    readonly body: string;
    readonly original: { readonly status: number; readonly body: string } | null;
  }> {
    const response = await this.page.request.post(
      new URL(ROUTER_AB_ED25519_SIGNING_FINALIZE_PATH, this.config.routerUrl).href,
      {
        headers: {
          [LOCAL_INTENDED_YAO_SIGNING_FAULT_HEADER_V1]: 'release_signing_finalize',
          [LOCAL_INTENDED_YAO_SIGNING_FAULT_TOKEN_HEADER_V1]: token,
        },
        data: {},
        timeout: 30_000,
      },
    );
    if (!response.ok()) {
      throw new Error(
        `Releasing a kept finalize failed: ${response.status()} ${await response.text()}`,
      );
    }
    const released = requireRecord(await response.json(), 'released finalize');
    const original = released.original;
    return {
      status: Number(released.status),
      body: requireString(released.body, 'released finalize body'),
      original:
        original === null
          ? null
          : {
              status: Number(requireRecord(original, 'original finalize').status),
              body: requireString(
                requireRecord(original, 'original finalize').body,
                'original body',
              ),
            },
    };
  }

  /** Sends a recovery execution the Gateway kept to the Router, and reads the Router's reply. */
  private async releaseKeptRecoveryExecute(
    token: string,
  ): Promise<{ readonly status: number; readonly body: string }> {
    const response = await this.page.request.post(
      new URL(ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1, this.config.routerUrl).href,
      {
        headers: {
          [LOCAL_INTENDED_YAO_RECOVERY_FAULT_HEADER_V1]: 'release_router_recovery_execute',
          [LOCAL_INTENDED_YAO_RECOVERY_FAULT_TOKEN_HEADER_V1]: token,
        },
        data: {},
      },
    );
    if (!response.ok()) {
      throw new Error(
        `Releasing a kept recovery execution failed: ${response.status()} ${await response.text()}`,
      );
    }
    const released = requireRecord(await response.json(), 'released recovery execution');
    return {
      status: Number(released.status),
      body: requireString(released.body, 'released recovery execution body'),
    };
  }
}

async function hostedAuthMenuFrame(page: Page): Promise<FrameLocator> {
  const iframe = page.locator('iframe[allow*="publickey-credentials-get"]').last();
  await iframe.waitFor({ state: 'attached', timeout: 15_000 });
  return iframe.contentFrame();
}

async function walletServiceFrame(page: Page, walletOrigin: string): Promise<Frame> {
  const iframe = page.locator('iframe[src*="/wallet-service"]').last();
  await iframe.waitFor({ state: 'attached', timeout: 30_000 });
  const iframeHandle = await iframe.elementHandle();
  if (!iframeHandle) throw new Error('Wallet service iframe is unavailable');
  const frame = await iframeHandle.contentFrame();
  if (!frame) throw new Error('Wallet service frame is unavailable');
  const expectedOrigin = new URL(walletOrigin).origin;
  if (new URL(frame.url()).origin !== expectedOrigin) {
    throw new Error('Wallet service frame origin changed');
  }
  return frame;
}

function recoveryActionForTarget(target: IntendedRecoveryTargetKind): IntendedRecoveryAction {
  switch (target) {
    case 'passkey':
      return {
        target,
        name: 'recoverPasskeyWallet',
      };
    case 'google_email_otp':
      return {
        target,
        name: 'recoverGoogleEmailOtpWallet',
      };
    default:
      return assertNever(target);
  }
}

function isSuccessfulRecoveryPrepareResponse(response: Response): boolean {
  return (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === ROUTER_AB_WALLET_RECOVERY_PREPARE_PATH &&
    response.status() === 200
  );
}

function isRecoveryFinalizationRequest(request: Request, path: string): boolean {
  return request.method() === 'POST' && new URL(request.url()).pathname === path;
}

function isRecoveryFinalizationResponse(
  response: Response,
  path: string,
  status?: number,
): boolean {
  return (
    isRecoveryFinalizationRequest(response.request(), path) &&
    (status === undefined || response.status() === status)
  );
}

function createRecoveryRequestCapture(input: {
  readonly kind: RecoveryRequestKind;
  readonly path: string;
  readonly target: IntendedRecoveryTargetKind;
  readonly walletId: string;
}): RecoveryRequestCapture {
  return {
    ...input,
    request: null,
    error: null,
  };
}

function optionalRecoveryRequestString(
  body: Record<string, unknown>,
  field: string,
): string | null {
  const raw = body[field];
  return raw === undefined ? null : requireString(raw, `recovery ${field}`);
}

function parseRecoveryRequestIdentity(
  capture: RecoveryRequestCapture,
  request: Request,
): RecoveryRequestIdentity {
  const body = requireRecord(
    request.postDataJSON(),
    `${capture.kind} recovery finalization request body`,
  );
  if (body.kind !== capture.kind) {
    throw new Error(
      `Recovery finalization request kind ${String(body.kind)} does not equal ${capture.kind}`,
    );
  }
  assertCredentialFreeRecoveryReplayBody(capture, body);
  const requestedWalletId = optionalRecoveryRequestString(body, 'walletId');
  if (requestedWalletId !== null && requestedWalletId !== capture.walletId) {
    throw new Error('Recovery finalization request changed its wallet identity');
  }
  if (capture.target === 'passkey' && requestedWalletId === null) {
    throw new Error('Passkey recovery finalization request omitted walletId');
  }
  const targetDeviceId = optionalRecoveryRequestString(body, 'targetDeviceId');
  const targetAuthorityId = optionalRecoveryRequestString(body, 'targetAuthorityId');
  const targetWalletAuthMethodId = optionalRecoveryRequestString(body, 'targetWalletAuthMethodId');
  if (
    capture.target === 'passkey' &&
    (targetDeviceId === null || targetAuthorityId === null || targetWalletAuthMethodId === null)
  ) {
    throw new Error('Passkey recovery finalization request omitted target identity');
  }
  return {
    kind: capture.kind,
    path: capture.path,
    target: capture.target,
    walletId: requestedWalletId ?? capture.walletId,
    recoveryOperationId: requireString(
      body.recoveryOperationId,
      'recovery finalization request recoveryOperationId',
    ),
    reservationId: requireString(body.reservationId, 'recovery finalization request reservationId'),
    targetDeviceId,
    targetAuthorityId,
    targetWalletAuthMethodId,
    replacementId: optionalRecoveryRequestString(body, 'replacementId'),
  };
}

function assertCredentialFreeRecoveryReplayBody(
  capture: RecoveryRequestCapture,
  body: Record<string, unknown>,
): void {
  if (capture.kind !== 'replay') return;
  const expectedFields =
    capture.target === 'passkey'
      ? [
          'kind',
          'walletId',
          'reservationId',
          'recoveryOperationId',
          'targetDeviceId',
          'targetAuthorityId',
          'targetWalletAuthMethodId',
          'replacementId',
          'replacementEnvelope',
        ]
      : ['kind', 'recoveryOperationId', 'reservationId', 'replacementEnvelope'];
  const actualFields = Object.keys(body).sort();
  const sortedExpectedFields = expectedFields.slice().sort();
  if (
    actualFields.length !== sortedExpectedFields.length ||
    actualFields.some((field, index) => field !== sortedExpectedFields[index])
  ) {
    throw new Error(
      `${capture.target} recovery replay must be credential-free and use its exact request shape`,
    );
  }
}

function captureRecoveryRequest(capture: RecoveryRequestCapture, request: Request): void {
  if (!isRecoveryFinalizationRequest(request, capture.path) || capture.request || capture.error) {
    return;
  }
  try {
    capture.request = parseRecoveryRequestIdentity(capture, request);
  } catch (error) {
    capture.error = error instanceof Error ? error.message : String(error);
  }
}

function requireCapturedRecoveryRequest(capture: RecoveryRequestCapture): RecoveryRequestIdentity {
  if (capture.error) throw new Error(capture.error);
  if (!capture.request) {
    throw new Error(`No exact ${capture.kind} recovery finalization request was captured`);
  }
  return capture.request;
}

function assertRecoveryReplayMatchesFinalization(
  finalization: RecoveryRequestIdentity,
  replay: RecoveryRequestIdentity,
): void {
  const fields: readonly (keyof RecoveryRequestIdentity)[] = [
    'path',
    'target',
    'walletId',
    'recoveryOperationId',
    'reservationId',
    'targetDeviceId',
    'targetAuthorityId',
    'targetWalletAuthMethodId',
    'replacementId',
  ];
  for (const field of fields) {
    if (finalization[field] !== replay[field]) {
      throw new Error(`Recovery replay changed ${field}`);
    }
  }
}

class RecoveryReplayGate {
  readonly released: Promise<void>;
  private resolveRelease: (() => void) | null = null;

  constructor() {
    this.released = new Promise<void>((resolve) => {
      this.resolveRelease = resolve;
    });
  }

  release(): void {
    const resolve = this.resolveRelease;
    this.resolveRelease = null;
    resolve?.();
  }
}

async function holdRecoveryReplayUntilReleased(
  gate: RecoveryReplayGate,
  route: Route,
): Promise<void> {
  await gate.released;
  await route.fallback();
}

async function fillHostedRecoveryCode(
  page: Page,
  recoveryCode: string,
  target: IntendedRecoveryTargetKind,
): Promise<FrameLocator> {
  const frame = await hostedAuthMenuFrame(page);
  await frame.getByText('Recover or link wallet', { exact: true }).click({ timeout: 15_000 });
  await frame.getByRole('button', { name: 'Recover wallet' }).click({ timeout: 15_000 });
  await frame.locator('[data-recovery-code]').fill(recoveryCode);
  await frame.locator('[data-recovery-continue]').click({ timeout: 15_000 });
  await frame.locator(`[data-recovery-target="${target}"]`).click({ timeout: 30_000 });
  return frame;
}

async function waitForHostedPasskeyRecoverySignIn(page: Page, frame: FrameLocator): Promise<void> {
  const deadline = Date.now() + 90_000;
  const primary = frame.locator('[data-auth-menu-primary]');
  const status = frame.locator('.seams-recovery-status').last();
  while (Date.now() < deadline) {
    const label = (await primary.textContent({ timeout: 100 }).catch(() => null))?.trim() ?? '';
    const message = (await status.textContent({ timeout: 100 }).catch(() => null))?.trim() ?? '';
    if (label === 'Unlock with new passkey') {
      await primary.click({ timeout: 15_000 });
      return;
    }
    const createFailed =
      label === 'Create new passkey' &&
      message !== 'Creating new passkey…' &&
      message !== 'Finishing recovery…';
    if (label === 'Retry finalization' || label === 'Continue' || createFailed) {
      throw new Error(`Passkey recovery returned to "${label}": ${message || 'no status message'}`);
    }
    await page.waitForTimeout(250);
  }
  const label =
    (await primary.textContent({ timeout: 100 }).catch(() => null))?.trim() ||
    'no recovery control';
  const message =
    (await status.textContent({ timeout: 100 }).catch(() => null))?.trim() || 'no status message';
  throw new Error(`Passkey recovery did not reach sign-in-ready: ${label}; ${message}`);
}

type RecoveryPrepareCapture = { readonly reservationIds: string[] };

function captureRecoveryPrepareReservation(
  capture: RecoveryPrepareCapture,
  request: Request,
): void {
  if (new URL(request.url()).pathname !== ROUTER_AB_WALLET_RECOVERY_PREPARE_PATH) return;
  const body = request.postDataJSON() as { readonly reservationId?: unknown };
  if (typeof body.reservationId === 'string') capture.reservationIds.push(body.reservationId);
}

async function driveHostedPasskeyRecovery(page: Page, recoveryCode: string): Promise<void> {
  const frame = await fillHostedRecoveryCode(page, recoveryCode, 'passkey');
  await expect(page.getByTestId('intended-e2e-page')).toHaveAttribute(
    'data-login-state',
    'logged_out',
  );
  await waitForHostedPasskeyRecoverySignIn(page, frame);
}

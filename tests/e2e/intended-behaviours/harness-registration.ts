import { expect, type Request, type Response, type Route } from '@playwright/test';
import { ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 } from '@shared/utils/routerAbEd25519Yao';
import { randomUUID } from 'node:crypto';
import type { IntendedYaoFaultModeV1 } from './harness-core';
import {
  requireLocalIntendedRouterBurnBuild,
  requireLocalIntendedYaoFaultRouterOrigin,
} from './harness-environment';
import { SessionFlows } from './harness-session';
import {
  type IntendedPageSnapshot,
  requireEd25519AddSignerResult,
  requireEmailOtpRegistrationResult,
  requireEndedResult,
  requireWalletResult,
} from './intended-page-snapshot';
import {
  nearStateLabel,
  registeredWalletWithNearReady,
  requireNearReadyRegisteredWallet,
  requirePasskeyRegisteredWalletSnapshot,
} from './registered-wallet';
import { waitForWalletRecoveryCodeBackup } from './wallet-iframe-confirm';

/** A finalize fault that the step releases, then checks. */
export type LostFinalizeResponse = {
  readonly release: () => Promise<void>;
  readonly assertReplayed: () => void;
};

async function readAuthenticationMethodsFromIntendedPage(): Promise<{
  ownerDeviceCount: number;
  linkedDeviceCount: number;
}> {
  const read = window.__seamsIntendedE2EReadAuthenticationMethods;
  if (!read) {
    throw new Error('authentication-method inventory helper is unavailable');
  }
  return await read();
}

/** Wallet registration, added signers and NEAR provisioning. */
export class RegistrationFlows extends SessionFlows {
  async registerPasskeyWallet(): Promise<void> {
    this.recordStage('register_passkey_wallet');
    const snapshot = await this.runIntendedPageAction('registerPasskeyWallet', {
      onRecoveryCodes: this.captureRecoveryCodes,
    });
    if (this.recoveryCodes.length === 0) {
      this.captureRecoveryCodes(
        await waitForWalletRecoveryCodeBackup(
          this.page,
          this.latestWalletIframeAutoConfirmDiagnostics || undefined,
        ),
      );
    }
    const result = requireWalletResult(
      snapshot,
      'passkey_registration_success',
      'Passkey registration',
      this.walletId,
    );
    if (this.config.passkeyEcdsaTargetProfile !== 'none' && result.nearReadiness !== 'pending') {
      throw new Error('Mixed passkey registration did not return ECDSA-ready with NEAR pending');
    }
    if (snapshot.events.length === 0) {
      throw new Error('Passkey registration did not emit structured lifecycle events');
    }
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-state',
      'logged_in',
    );
    await expect(this.page.getByTestId('intended-e2e-page')).toHaveAttribute(
      'data-login-wallet-id',
      result.walletId,
    );
    this.registeredWallet = result;
    this.nearSignerSlot = 1;
    this.currentWarmSigningStage = 'post_registration';
    this.passkeyPromptCount += 1;
    this.recordService(
      result.nearReadiness === 'ready'
        ? `passkey registration succeeded wallet=${result.walletId} near=${result.nearAccountId}`
        : `passkey registration succeeded ECDSA-ready wallet=${result.walletId} near=${nearStateLabel(result)}`,
    );
  }

  async assertRegistrationOwnerSessionIsActive(): Promise<void> {
    const inventory = await this.page.evaluate(readAuthenticationMethodsFromIntendedPage);
    if (inventory.ownerDeviceCount < 1) {
      throw new Error('registration owner session returned no owner authentication method');
    }
    this.recordService(
      `registration owner session active ownerMethods=${inventory.ownerDeviceCount} linkedDevices=${inventory.linkedDeviceCount}`,
    );
  }

  async registerPasskeyEd25519YaoWallet(): Promise<void> {
    this.recordStage('register_passkey_ed25519_yao_wallet');
    const snapshot = await this.runIntendedPageAction('registerPasskeyEd25519YaoWallet');
    const result = requireWalletResult(
      snapshot,
      'passkey_registration_success',
      'Passkey registration',
      this.walletId,
    );
    const ready = requireNearReadyRegisteredWallet(result, 'Ed25519 Yao registration');
    if (result.ecdsaTargetProfile !== 'none' || result.ecdsaTargetKeys.kind !== 'none') {
      throw new Error('Ed25519 Yao registration unexpectedly provisioned an ECDSA signer');
    }
    if (snapshot.events.length === 0) {
      throw new Error('Ed25519 Yao passkey registration did not emit lifecycle events');
    }
    this.registeredWallet = result;
    this.nearSignerSlot = 1;
    this.currentWarmSigningStage = 'post_registration';
    this.passkeyPromptCount += 1;
    this.recordService(
      `Ed25519 Yao passkey registration succeeded wallet=${ready.walletId} near=${ready.nearAccountId}`,
    );
  }

  async registerPasskeyEd25519YaoWalletWithExactTransportRetry(): Promise<void> {
    this.recordStage('register_passkey_ed25519_yao_wallet_with_exact_transport_retry');
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    const faultToken = this.armIntendedYaoFault('drop_router_response_once');
    try {
      await this.registerPasskeyEd25519YaoWallet();
      this.assertIntendedYaoFaultProof(proofStartIndex, faultToken, 'exact_request_replayed');
    } finally {
      this.intendedYaoFaultInjection = { kind: 'idle' };
    }
  }

  async assertMixedNearTerminalFailureSurvivesUnlock(): Promise<void> {
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    const faultToken = this.armIntendedYaoFault('return_terminal_burned_once');
    const failed = this.page.waitForResponse(isNearRegistrationExecutionResponse);
    await this.registerPasskeyWallet();
    const initial = await failed;
    expect(await initial.json()).toMatchObject({ ok: false, code: 'execution_failed' });
    this.assertIntendedYaoFaultProof(proofStartIndex, faultToken, 'terminal_failure_not_retried');
    await this.signTempoTransaction('post_registration');
    const replay = this.page.waitForResponse(isNearRegistrationExecutionResponse);
    await this.unlockPasskeyWithPendingNear();
    const retained = await replay;
    expect(await retained.json()).toMatchObject({ ok: false, code: 'execution_failed' });
    expect(retained.request().postData()).toBe(initial.request().postData());
    await this.signArcEvmTransaction('post_unlock');
  }

  async addPasskeyEd25519YaoWalletSigner(): Promise<void> {
    this.recordStage('add_passkey_ed25519_yao_wallet_signer');
    const previous = requireNearReadyRegisteredWallet(
      requirePasskeyRegisteredWalletSnapshot(this.requireRegisteredWalletForSigning()),
      'Ed25519 signer addition',
    );
    const snapshot = await this.runIntendedPageAction('addPasskeyEd25519YaoWalletSigner');
    const result = requireEd25519AddSignerResult(snapshot, this.walletId);
    if (
      result.nearAccountId === previous.nearAccountId ||
      result.operationalPublicKey === previous.operationalPublicKey
    ) {
      throw new Error('Ed25519 add-signer did not create a distinct signer identity');
    }
    if (snapshot.events.length === 0) {
      throw new Error('Ed25519 add-signer did not emit structured lifecycle events');
    }
    this.registeredWallet = {
      kind: 'passkey_registration_success',
      walletId: result.walletId,
      nearReadiness: 'ready',
      nearAccountId: result.nearAccountId,
      operationalPublicKey: result.operationalPublicKey,
      ecdsaTargetProfile: 'none',
      ecdsaTargetKeys: { kind: 'none' },
    };
    this.nearSignerSlot = 2;
    this.currentWarmSigningStage = 'post_registration';
    this.passkeyPromptCount += 1;
    this.recordService(
      `Ed25519 Yao signer added wallet=${result.walletId} near=${result.nearAccountId}`,
    );
  }

  /**
   * A NEAR-ready passkey wallet without ECDSA gains an ECDSA signer through the
   * public add-signer path; later EVM signatures must recover to its address.
   */
  async addPasskeyEcdsaWalletSigner(
    options: { readonly loseFinalizeResponseOnce?: boolean } = {},
  ): Promise<void> {
    this.recordStage('add_passkey_ecdsa_wallet_signer');
    const previous = requireNearReadyRegisteredWallet(
      requirePasskeyRegisteredWalletSnapshot(this.requireRegisteredWalletForSigning()),
      'ECDSA signer addition',
    );
    if (previous.ecdsaTargetProfile !== 'none') {
      throw new Error('ECDSA signer addition expects a wallet without an ECDSA signer');
    }
    const lostFinalize = options.loseFinalizeResponseOnce
      ? await this.loseAddSignerFinalizeResponseOnce()
      : null;
    let snapshot: IntendedPageSnapshot;
    try {
      snapshot = await this.runIntendedPageAction('addPasskeyEcdsaWalletSigner');
    } finally {
      await lostFinalize?.release();
    }
    if (lostFinalize) lostFinalize.assertReplayed();
    if (snapshot.action.status !== 'success') {
      throw new Error(
        `ECDSA add-signer ended with ${snapshot.action.status}: ${
          snapshot.action.status === 'error' ? snapshot.action.error : ''
        }`,
      );
    }
    const result = snapshot.action.result;
    if (result.kind !== 'ecdsa_signer_added' || result.walletId !== this.walletId) {
      throw new Error(
        `ECDSA add-signer returned ${result.kind} for ${'walletId' in result ? result.walletId : undefined}`,
      );
    }
    if (result.ecdsaTargetProfile === 'none') {
      throw new Error('ECDSA add-signer provisioned no ECDSA target');
    }
    if (snapshot.events.length === 0) {
      throw new Error('ECDSA add-signer did not emit structured lifecycle events');
    }
    const { kind: _kind, walletId: _walletId, ...ecdsa } = result;
    this.registeredWallet = {
      kind: 'passkey_registration_success',
      walletId: previous.walletId,
      nearReadiness: 'ready',
      nearAccountId: previous.nearAccountId,
      operationalPublicKey: previous.operationalPublicKey,
      ...ecdsa,
    };
    this.currentWarmSigningStage = 'post_registration';
    this.passkeyPromptCount += 1;
    this.recordService(
      `ECDSA signer added wallet=${result.walletId} profile=${result.ecdsaTargetProfile}`,
    );
  }

  /**
   * Lets the first finalize to `path` reach the Gateway and commit, then drops its response, so
   * the SDK must recover the committed outcome by asking again. The retry must repeat what
   * `retryKey` reads from the request and receive exactly the response that was lost: one
   * committed change, not two.
   */
  protected async loseFirstFinalizeResponse(input: {
    readonly path: RegExp;
    readonly routeGlob: string;
    readonly label: string;
    readonly retryKey: (request: Request) => string;
    readonly retryChanged: (lost: string, replayed: string) => boolean;
    readonly retryChangedMessage: string;
  }): Promise<LostFinalizeResponse> {
    const attempts: { readonly key: string; readonly body: string }[] = [];
    const handler = async (route: Route): Promise<void> => {
      if (
        route.request().method() !== 'POST' ||
        !input.path.test(new URL(route.request().url()).pathname)
      ) {
        await route.fallback();
        return;
      }
      const key = input.retryKey(route.request());
      const response = await route.fetch();
      attempts.push({ key, body: await response.text() });
      if (attempts.length === 1) {
        await route.abort('connectionreset');
        return;
      }
      await route.fulfill({ response });
    };
    await this.context.route(input.routeGlob, handler);
    return {
      release: async () => {
        await this.context.unroute(input.routeGlob, handler);
      },
      assertReplayed: () => {
        const [lost, replayed] = attempts;
        if (attempts.length !== 2 || !lost || !replayed) {
          throw new Error(
            `${input.label} expected one lost and one replayed response, saw ${attempts.length}`,
          );
        }
        if (input.retryChanged(lost.key, replayed.key)) {
          throw new Error(input.retryChangedMessage);
        }
        expect(JSON.parse(replayed.body)).toEqual(JSON.parse(lost.body));
        this.recordService(
          `${input.label.toLowerCase()} lost its response and replayed the committed outcome`,
        );
      },
    };
  }

  /** The add-signer finalize retry must carry the same idempotency key. */
  private async loseAddSignerFinalizeResponseOnce(): Promise<LostFinalizeResponse> {
    return await this.loseFirstFinalizeResponse({
      path: /\/wallets\/[^/]+\/signers\/finalize$/,
      routeGlob: '**/signers/finalize',
      label: 'Add-signer finalize',
      retryKey: (request) =>
        String(
          (request.postDataJSON() as { readonly idempotencyKey?: unknown }).idempotencyKey ?? '',
        ),
      retryChanged: (lost, replayed) => !lost || lost !== replayed,
      retryChangedMessage: 'Add-signer finalize retry changed its idempotency key',
    });
  }

  /**
   * Signer-profile matrix: register a wallet whose signer set is ECDSA only.
   *
   * It becomes the registered wallet like any other, but with NEAR reported
   * absent rather than pending, so anything that would ask it to sign NEAR
   * fails on the readiness check instead of waiting for an account that is
   * never coming.
   */
  async registerPasskeyEcdsaOnlyWallet(): Promise<void> {
    this.recordStage('register_passkey_ecdsa_only_wallet');
    const snapshot = await this.runIntendedPageAction('registerPasskeyEcdsaOnlyWallet');
    const result = requireWalletResult(
      snapshot,
      'passkey_registration_success',
      'Passkey registration',
      this.walletId,
    );
    if (result.nearReadiness !== 'absent') {
      throw new Error(`ECDSA-only registration reported NEAR ${result.nearReadiness}`);
    }
    if (result.ecdsaTargetProfile === 'none') {
      throw new Error('ECDSA-only registration provisioned no ECDSA target');
    }
    this.registeredWallet = result;
    this.currentWarmSigningStage = 'post_registration';
    this.passkeyPromptCount += 1;
    this.recordService(
      `ECDSA-only passkey registration succeeded wallet=${result.walletId} profile=${result.ecdsaTargetProfile}`,
    );
  }

  /** Signer-profile matrix: an Email OTP wallet whose signer set is ECDSA only. */
  async registerEmailOtpEcdsaOnlyWallet(): Promise<void> {
    this.recordStage('register_email_otp_ecdsa_only_wallet');
    const snapshot = await this.runIntendedPageAction('registerEmailOtpEcdsaOnlyWallet');
    const result = requireEndedResult(
      snapshot,
      'email_otp_registration_success',
      'ECDSA-only Email OTP registration',
    );
    if (result.ecdsaTargetProfile === 'none') {
      throw new Error('ECDSA-only Email OTP registration provisioned no ECDSA target');
    }
    this.walletId = result.walletId;
    this.registeredWallet = result;
    this.currentWarmSigningStage = 'post_registration';
    this.emailOtpVerificationCount += 1;
    this.recordService(`ECDSA-only Email OTP registration succeeded wallet=${result.walletId}`);
  }

  /** Signer-profile matrix: an Email OTP wallet whose signer set is Ed25519 only. */
  async registerEmailOtpEd25519OnlyWallet(): Promise<void> {
    this.recordStage('register_email_otp_ed25519_only_wallet');
    const snapshot = await this.runIntendedPageAction('registerEmailOtpEd25519OnlyWallet');
    const result = requireEndedResult(
      snapshot,
      'email_otp_registration_success',
      'Ed25519-only Email OTP registration',
    );
    if (result.ecdsaTargetProfile !== 'none') {
      throw new Error('Ed25519-only Email OTP registration provisioned an ECDSA signer');
    }
    this.walletId = result.walletId;
    this.registeredWallet = result;
    this.currentWarmSigningStage = 'post_registration';
    this.emailOtpVerificationCount += 1;
    this.recordService(`Ed25519-only Email OTP registration succeeded wallet=${result.walletId}`);
  }

  async registerEmailOtpWallet(): Promise<void> {
    this.recordStage('register_email_otp_wallet');
    const snapshot = await this.runIntendedPageAction('registerEmailOtpWallet', {
      onRecoveryCodes: this.captureRecoveryCodes,
    });
    if (this.recoveryCodes.length === 0) {
      this.captureRecoveryCodes(
        await waitForWalletRecoveryCodeBackup(
          this.page,
          this.latestWalletIframeAutoConfirmDiagnostics || undefined,
        ),
      );
    }
    const result = requireEmailOtpRegistrationResult(snapshot);
    if (snapshot.events.length === 0) {
      throw new Error('Email OTP registration did not emit structured lifecycle events');
    }
    this.walletId = result.walletId;
    this.registeredWallet = result;
    this.nearSignerSlot = 1;
    this.currentWarmSigningStage = 'post_registration';
    this.emailOtpVerificationCount += 1;
    this.recordService(
      result.nearReadiness === 'ready'
        ? `email otp registration succeeded initial=${result.initialWalletId} wallet=${result.walletId} near=${result.nearAccountId}`
        : `email otp registration succeeded ECDSA-ready initial=${result.initialWalletId} wallet=${result.walletId} near=${nearStateLabel(result)}`,
    );
  }

  async awaitNearReady(): Promise<void> {
    this.recordStage('near.await_ready');
    const registration = this.requireRegisteredWalletForSigning();
    if (registration.nearReadiness === 'ready') {
      this.recordService(`NEAR already ready wallet=${registration.walletId}`);
      return;
    }
    const snapshot = await this.runIntendedPageAction('awaitNearReady');
    const ready = requireWalletResult(
      snapshot,
      'near_provisioning_ready',
      'NEAR provisioning',
      this.walletId,
    );
    this.registeredWallet = registeredWalletWithNearReady(registration, ready);
    this.recordService(
      `NEAR provisioning ready wallet=${ready.walletId} near=${ready.nearAccountId}`,
    );
  }

  private armIntendedYaoFault(mode: IntendedYaoFaultModeV1): string {
    if (this.intendedYaoFaultInjection.kind !== 'idle') {
      throw new Error('An intended Yao transport fault is already armed');
    }
    requireLocalIntendedYaoFaultRouterOrigin(this.config.routerUrl);
    if (mode === 'return_terminal_burned_once') requireLocalIntendedRouterBurnBuild();
    const token = randomUUID();
    this.intendedYaoFaultInjection = { kind: 'armed', mode, token };
    return token;
  }
}

function isNearRegistrationExecutionResponse(response: Response): boolean {
  return (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1
  );
}

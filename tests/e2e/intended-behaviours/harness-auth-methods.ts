import { expect, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { isRequestTraceEntry, routePathAtRouter } from './harness-core';
import { type LostFinalizeResponse, RegistrationFlows } from './harness-registration';
import { type IntendedPageSnapshot, requireEndedResult } from './intended-page-snapshot';

const GOOGLE_EMAIL_OTP_VERIFY_PATH_V1 = '/auth/google/verify';
/* The Gateway steps of an Email OTP unlock after Google verification. */
const EMAIL_OTP_UNLOCK_GATEWAY_PATHS_V1: ReadonlySet<string> = new Set([
  '/wallet/email-otp/challenge',
  '/wallet/email-otp/factor-release',
  '/wallet/unlock/verify',
]);
const LOCAL_INTENDED_REVOKE_FAULT_HEADER_V1 = 'x-seams-intended-revoke-fault-v1';
const LOCAL_INTENDED_REVOKE_FAULT_TOKEN_HEADER_V1 = 'x-seams-intended-revoke-fault-token-v1';
const LOCAL_INTENDED_REVOKE_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-revoke-fault-proof-v1';

/** Adding, using and revoking a second auth method. */
export class AuthMethodFlows extends RegistrationFlows {
  /** The add-auth-method finalize retry must send the exact same request. */
  private async loseAddAuthMethodFinalizeResponseOnce(): Promise<LostFinalizeResponse> {
    return await this.loseFirstFinalizeResponse({
      path: /\/wallets\/[^/]+\/auth-methods\/finalize$/,
      routeGlob: '**/auth-methods/finalize',
      label: 'Add-auth-method finalize',
      retryKey: (request) => request.postData() ?? '',
      retryChanged: (lost, replayed) => replayed !== lost,
      retryChangedMessage: 'Add-auth-method finalize retry changed its request',
    });
  }

  /**
   * The registered passkey wallet gains an Email OTP method. The wallet prompts
   * for the code on its own surface, so the same auto-confirm that drives every
   * other Email OTP step drives this one.
   */
  async addEmailOtpAuthMethod(
    options: { readonly loseFinalizeResponseOnce?: boolean } = {},
  ): Promise<void> {
    this.recordStage('add_email_otp_auth_method');
    const registration = this.requireRegisteredWalletForSigning();
    const lostFinalize = options.loseFinalizeResponseOnce
      ? await this.loseAddAuthMethodFinalizeResponseOnce()
      : null;
    let snapshot: IntendedPageSnapshot;
    try {
      snapshot = await this.runIntendedPageAction('addEmailOtpAuthMethod');
    } finally {
      await lostFinalize?.release();
    }
    lostFinalize?.assertReplayed();
    if (snapshot.action.status !== 'success') {
      throw new Error(`add-email-code ended with ${snapshot.action.status}`);
    }
    const result = snapshot.action.result;
    if (result.kind !== 'add_email_otp_success') {
      throw new Error(
        `add-email-code returned the wrong result: ${JSON.stringify(snapshot.action.result)}`,
      );
    }
    if (String(result.walletId) !== String(registration.walletId)) {
      throw new Error('add-email-code returned a different wallet');
    }
    this.emailOtpVerificationCount += 1;
    this.crossFamilyAuthMethodAdditionRan = true;
    this.addedWalletAuthMethodId = result.walletAuthMethodId;
    this.recordService(
      `email code added wallet=${String(result.walletId)} email=${String(result.emailAddress)} method=${result.walletAuthMethodId}`,
    );
  }

  /**
   * Retire the method that did the adding.
   *
   * The page picks the target - the one sibling that is not the method just
   * added - so the test cannot accidentally revoke the credential it is about
   * to rely on.
   */
  async revokeSourceAuthMethod(
    expect: 'source' | 'added' = 'source',
    options: { readonly refuseFirstRevocationCommit?: boolean } = {},
  ): Promise<void> {
    this.recordStage(`revoke_${expect}_auth_method`);
    const registration = this.requireRegisteredWalletForSigning();
    const sourceFamily = this.currentOperatingAuthFamily();
    const refusedCommit = options.refuseFirstRevocationCommit
      ? await this.refuseFirstRevocationCommitOnce('auth_method')
      : null;
    let snapshot: IntendedPageSnapshot;
    try {
      snapshot = await this.runIntendedPageAction('revokeSourceAuthMethod');
    } finally {
      await refusedCommit?.release();
    }
    const result = requireEndedResult(snapshot, 'revoke_auth_method_success', 'revoke');
    if (result.walletId !== registration.walletId) {
      throw new Error('revoke targeted a different wallet');
    }
    /* The page always removes the sibling of whoever holds the session, so
       which one that is depends on which method the test is operating as. Say
       it out loud, otherwise a contract that unlocked with the wrong method
       would still look like it passed. */
    const removedAdded = result.walletAuthMethodId === this.addedWalletAuthMethodId;
    if (expect === 'added' && !removedAdded) {
      throw new Error('revoke removed the source method, not the added one');
    }
    if (expect === 'source' && removedAdded) {
      throw new Error('revoke removed the added method instead of its sibling');
    }
    refusedCommit?.assertRecovered(sourceFamily);
    if (sourceFamily === 'passkey') {
      this.passkeyPromptCount += 1;
    } else {
      this.emailOtpVerificationCount += 1;
    }
    this.recordService(`revoked ${expect} method=${result.walletAuthMethodId}`);
  }

  /**
   * The Gateway refuses the first revocation's commit, as a batch that failed,
   * and that answer is lost too, so the SDK sends the exact request again. The
   * retry must commit on the same proof: an Email OTP code is spent only by
   * the batch that revokes, so a failed commit leaves it usable. The harness
   * then sends the committed request once more. Its code is spent by then, so
   * only the Gateway's record of the revocation can answer, and the answer
   * must be exactly the one the retry received.
   */
  protected async refuseFirstRevocationCommitOnce(route: 'auth_method' | 'linked_device'): Promise<{
    readonly release: () => Promise<void>;
    readonly assertRecovered: (sourceFamily: 'passkey' | 'email_otp') => void;
  }> {
    /* An auth method is revoked directly, or as a linked device's through
       device management. Each route answers its refused commit its own way. */
    const revokePath =
      route === 'auth_method'
        ? /\/wallets\/[^/]+\/auth-methods\/[^/]+\/revoke$/
        : /\/wallet\/device-linking\/v1\/devices\/[^/]+\/revoke$/;
    const label = route === 'auth_method' ? 'Auth-method revoke' : 'Linked-device revoke';
    /* The route needs the wallet's Origin, which Playwright's provisional
       headers may leave out of a forwarded request. */
    const origin = new URL(this.config.walletOrigin).origin;
    const token = randomUUID();
    type Attempt = {
      readonly request: string;
      readonly status: number;
      readonly body: string;
      readonly proof: string | null;
    };
    const attempts: Attempt[] = [];
    let replayed: Attempt | null = null;
    const changed: { readonly change: string; readonly status: number; readonly body: string }[] =
      [];
    const handler = async (route: Route): Promise<void> => {
      const request = route.request();
      if (request.method() !== 'POST' || !revokePath.test(new URL(request.url()).pathname)) {
        await route.fallback();
        return;
      }
      const headers = { ...request.headers(), origin };
      const body = request.postData() ?? '';
      if (attempts.length === 0) {
        const refused = await route.fetch({
          headers: {
            ...headers,
            [LOCAL_INTENDED_REVOKE_FAULT_HEADER_V1]: 'refuse_revocation_batch_once',
            [LOCAL_INTENDED_REVOKE_FAULT_TOKEN_HEADER_V1]: token,
          },
        });
        attempts.push({
          request: body,
          status: refused.status(),
          body: await refused.text(),
          proof: refused.headers()[LOCAL_INTENDED_REVOKE_FAULT_PROOF_HEADER_V1] ?? null,
        });
        await route.abort('connectionreset');
        return;
      }
      const committed = await route.fetch({ headers });
      attempts.push({
        request: body,
        status: committed.status(),
        body: await committed.text(),
        proof: null,
      });
      if (attempts.length === 2) {
        const replay = await route.fetch({ headers });
        replayed = {
          request: body,
          status: replay.status(),
          body: await replay.text(),
          proof: null,
        };
        /* A changed request is not the one that committed: it must be refused,
           never answered from the record. */
        for (const change of ['operation', 'proof'] as const) {
          const refused = await route.fetch({
            headers,
            postData: changedRevokeRequestBody(body, change),
          });
          changed.push({ change, status: refused.status(), body: await refused.text() });
        }
      }
      await route.fulfill({ response: committed });
    };
    await this.context.route('**/revoke', handler);
    return {
      release: async () => {
        await this.context.unroute('**/revoke', handler);
      },
      assertRecovered: (sourceFamily) => {
        const [refused, committed] = attempts;
        const replay: Attempt | null = replayed;
        if (attempts.length !== 2 || !refused || !committed || !replay) {
          throw new Error(
            `${label} expected a refused commit, one retry and a replay, saw ${attempts.length} attempts`,
          );
        }
        const expectedProof = `${token}:${
          sourceFamily === 'email_otp'
            ? 'refused_revocation_with_its_code'
            : 'refused_revocation_without_code'
        }`;
        if (refused.proof !== expectedProof) {
          throw new Error(
            `${label} expected the refused-commit proof ${expectedProof}, saw ${refused.proof ?? 'none'}`,
          );
        }
        const refusal = JSON.parse(refused.body) as {
          readonly ok?: unknown;
          readonly code?: unknown;
          readonly kind?: unknown;
        };
        const refusedAsConflict =
          route === 'auth_method'
            ? refused.status === 400 && refusal.ok === false && refusal.code === 'conflict'
            : refused.status === 409 && refusal.ok === false && refusal.kind === 'conflict';
        if (!refusedAsConflict) {
          throw new Error(`${label}'s refused commit answered ${refused.status}: ${refused.body}`);
        }
        if (committed.request !== refused.request || replay.request !== refused.request) {
          throw new Error(`${label} retry changed its request`);
        }
        const answer = JSON.parse(committed.body) as { readonly ok?: unknown };
        if (committed.status !== 200 || answer.ok !== true) {
          throw new Error(
            `${label} retry on the same proof answered ${committed.status}: ${committed.body}`,
          );
        }
        if (replay.status !== committed.status || replay.body !== committed.body) {
          throw new Error(
            `${label} replay answered ${replay.status}: ${replay.body}, not the committed answer`,
          );
        }
        if (changed.length !== 2) {
          throw new Error(`${label} sent ${changed.length} changed requests, expected 2`);
        }
        for (const refusal of changed) {
          if (refusal.status !== 401 || refusal.body === committed.body) {
            throw new Error(
              `${label} with a changed ${refusal.change} answered ${refusal.status}: ${refusal.body}`,
            );
          }
        }
        this.recordService(
          `${label}: a refused commit spent nothing, the retry committed on the same ${sourceFamily} proof, and a replay received the recorded answer`,
        );
      },
    };
  }

  /**
   * Adding a family the authority already has is refused at admission, before
   * anything is verified or written.
   *
   * The counters matter as much as the refusal. A repeat that costs the user
   * another code, or writes a second enrollment before noticing, is a
   * different behaviour from one that answers off the existing inventory.
   */
  async assertRepeatAdditionIsAlreadyConfigured(
    action: 'addPasskeyAuthMethod' | 'addEmailOtpAuthMethod',
  ): Promise<void> {
    this.recordStage('repeat_addition_already_configured');
    const passkeyPromptsBefore = this.passkeyPromptCount;
    const emailVerificationsBefore = this.emailOtpVerificationCount;
    const snapshot = await this.runIntendedPageAction(action, { expectedOutcome: 'error' });
    if (snapshot.action.status === 'success') {
      throw new Error('repeating an addition succeeded; it must be already_configured');
    }
    const detail = String(snapshot.action.status === 'error' ? snapshot.action.error : '');
    if (!/already[\s_]?(has|configured)/i.test(detail)) {
      throw new Error(`repeat addition failed for the wrong reason: ${detail}`);
    }
    if (
      this.passkeyPromptCount !== passkeyPromptsBefore ||
      this.emailOtpVerificationCount !== emailVerificationsBefore
    ) {
      throw new Error('repeat addition verified a factor before answering already_configured');
    }
    this.recordService('repeat addition refused as already configured');
  }

  /**
   * The last way into a wallet cannot be removed.
   *
   * A wallet with one method has no sibling to authorize the removal, and a
   * method may not authorize its own. Together those leave the last credential
   * un-removable, which is the property that makes revocation safe to offer at
   * all.
   */
  async assertFinalAuthMethodCannotBeRevoked(): Promise<void> {
    this.recordStage('final_auth_method_revocation_refused');
    const snapshot = await this.runIntendedPageAction('revokeSourceAuthMethod', {
      expectedOutcome: 'error',
    });
    if (snapshot.action.status === 'success') {
      throw new Error('revoking the final auth method succeeded; it must be refused');
    }
    const detail = snapshot.action.status === 'error' ? snapshot.action.error : '';
    if (!/sibling/i.test(String(detail))) {
      throw new Error(`final auth method revocation failed for the wrong reason: ${detail}`);
    }
    this.recordService('final auth method revocation refused');
  }

  /**
   * The wallet's Email OTP method was revoked: a fresh code must no longer
   * open the wallet, and the refusal must come from the revocation, not from
   * some unrelated failure.
   * - `registered`, a wallet registered with Email OTP: the auth menu still
   *   offers Google for it, so the Gateway's Google verification must refuse
   *   this wallet, whose Email OTP enrollment the revocation removed.
   * - `added`, a wallet that gained the method later: its session no longer
   *   lists the method, so the unlock finds no Email OTP method to open.
   * Either way the unlock never reaches an Email OTP challenge, a factor
   * release or an unlock verification.
   */
  async assertRevokedEmailOtpCannotUnlock(method: 'registered' | 'added'): Promise<void> {
    this.recordStage(`revoked_${method}_email_otp_unlock_refused`);
    await this.resetRuntimeOnlyState();
    const traceStartIndex = this.trace.length;
    const refusal =
      method === 'registered'
        ? await this.refuseRevokedRegisteredEmailOtpUnlock()
        : await this.refuseRevokedAddedEmailOtpUnlock();
    const reached = this.trace
      .slice(traceStartIndex)
      .filter(isRequestTraceEntry)
      .map((entry) => routePathAtRouter(entry.url, this.config.routerUrl))
      .filter(
        (path): path is string => path !== null && EMAIL_OTP_UNLOCK_GATEWAY_PATHS_V1.has(path),
      );
    if (reached.length > 0) {
      throw new Error(`revoked Email OTP unlock still reached ${reached.join(', ')}`);
    }
    this.recordService(`revoked ${method} Email OTP unlock refused: ${refusal}`);
  }

  /**
   * Google verification refuses the selected wallet after revocation removes
   * its enrollment. The harness closes the menu after checking that refusal.
   */
  private async refuseRevokedRegisteredEmailOtpUnlock(): Promise<string> {
    const verification = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        routePathAtRouter(response.url(), this.config.routerUrl) ===
          GOOGLE_EMAIL_OTP_VERIFY_PATH_V1,
      { timeout: 60_000 },
    );
    const action = this.runIntendedPageAction('unlockEmailOtpWallet', {
      expectedOutcome: 'error',
    });
    /* Settled below, once the menu is closed. */
    action.catch(() => undefined);
    const response = await verification;
    expect(response.request().postDataJSON()).toMatchObject({ wallet_id: this.walletId });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      mode: 'wallet_identity_mismatch',
      code: 'wallet_identity_mismatch',
      walletId: this.walletId,
    });
    await this.page
      .locator('iframe[allow*="publickey-credentials-get"]')
      .last()
      .contentFrame()
      .locator('.auth-menu-root')
      .press('Escape');
    const snapshot = await action;
    const detail = snapshot.action.status === 'error' ? snapshot.action.error : '';
    if (detail !== 'Google Email OTP unlock ended with cancelled') {
      throw new Error(`revoked Email OTP unlock ended for another reason: ${detail}`);
    }
    return `Google verification refused the revoked enrollment for ${this.walletId}`;
  }

  /** The wallet's session no longer lists the revoked method. */
  private async refuseRevokedAddedEmailOtpUnlock(): Promise<string> {
    const snapshot = await this.runIntendedPageAction('unlockWithAddedEmailOtp', {
      expectedOutcome: 'error',
    });
    const detail = snapshot.action.status === 'error' ? snapshot.action.error : '';
    if (detail !== 'added email-code unlock needs one email method, found 0') {
      throw new Error(`revoked added Email OTP unlock ended for another reason: ${detail}`);
    }
    return 'the wallet lists no Email OTP method';
  }

  /**
   * The authenticated capability belongs to the method that opened it.
   *
   * The family alone proves nothing here - both methods live on one authority,
   * and the wallet would look identical if it had authenticated the method
   * that did the adding. Only the exact capability id separates the two.
   */
  private assertWalletSessionNamesAddedMethod(input: {
    readonly label: string;
    readonly sessionWalletAuthMethodId: string;
  }): void {
    const expected = this.addedWalletAuthMethodId;
    if (!expected) {
      throw new Error(`${input.label} unlock ran without a recorded added auth method`);
    }
    if (input.sessionWalletAuthMethodId !== expected) {
      throw new Error(
        `${input.label} unlock authenticated ${input.sessionWalletAuthMethodId}, not the added ${expected}`,
      );
    }
    this.recordService(`${input.label} authenticated method=${expected}`);
  }

  /**
   * The method just added actually opens the wallet.
   *
   * Deliberately not `unlockPasskeyWallet`, which requires a passkey-REGISTERED
   * wallet. The point here is the opposite: this wallet was registered with the
   * other family, and the passkey it is unlocking with exists only because the
   * addition created it. Gating on how the wallet was registered would refuse
   * the exact case under test.
   */
  async unlockWithAddedPasskey(): Promise<void> {
    this.recordStage('unlock_with_added_passkey');
    const registration = this.requireRegisteredWalletForSigning();
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runIntendedPageAction('unlockPasskeyWallet');
    const result = requireEndedResult(
      snapshot,
      'passkey_unlock_success',
      'unlock with the added passkey',
    );
    if (result.walletId !== registration.walletId) {
      throw new Error('unlock with the added passkey opened a different wallet');
    }
    /* The added method inherits whatever the wallet already had. A NEAR-ready
       wallet must still open NEAR through it - losing NEAR by adding a passkey
       would be the bug - while an ECDSA-only wallet has no NEAR identity for
       any method to return. Asserting one shape for both would encode the
       wallet's provisioning state into the addition. */
    const expectedNearIdentity = registration.nearReadiness === 'ready' ? 'ready' : 'absent';
    if (result.nearIdentity !== expectedNearIdentity) {
      throw new Error(
        `added-passkey unlock returned NEAR identity ${result.nearIdentity} for a ${registration.nearReadiness} wallet`,
      );
    }
    if (result.authenticationKind !== 'authenticated') {
      throw new Error(
        `unlock with the added passkey did not authenticate the wallet: ${result.authenticationKind}`,
      );
    }
    this.assertWalletSessionNamesAddedMethod({
      label: 'added passkey',
      sessionWalletAuthMethodId: result.sessionWalletAuthMethodId,
    });
    const observedPaths = this.routerPathsSince(traceStartIndex);
    if (!observedPaths.includes('/wallet/unlock/verify')) {
      throw new Error('Added passkey unlock did not traverse /wallet/unlock/verify');
    }
    this.passkeyPromptCount += 1;
    this.operatingAuthFamily = 'passkey';
    this.recordService(`added passkey unlocked wallet=${String(registration.walletId)}`);
  }

  /** An Email OTP wallet gains a Passkey method. */
  async addPasskeyAuthMethod(
    options: { readonly loseFinalizeResponseOnce?: boolean } = {},
  ): Promise<void> {
    this.recordStage('add_passkey_auth_method');
    const registration = this.requireRegisteredWalletForSigning();
    const lostFinalize = options.loseFinalizeResponseOnce
      ? await this.loseAddAuthMethodFinalizeResponseOnce()
      : null;
    let snapshot: IntendedPageSnapshot;
    try {
      snapshot = await this.runIntendedPageAction('addPasskeyAuthMethod');
    } finally {
      await lostFinalize?.release();
    }
    lostFinalize?.assertReplayed();
    if (snapshot.action.status !== 'success') {
      throw new Error(`add-passkey ended with ${snapshot.action.status}`);
    }
    const result = snapshot.action.result;
    if (result.kind !== 'add_passkey_success') {
      throw new Error(
        `add-passkey returned the wrong result: ${JSON.stringify(snapshot.action.result)}`,
      );
    }
    if (String(result.walletId) !== String(registration.walletId)) {
      throw new Error('add-passkey returned a different wallet');
    }
    this.emailOtpVerificationCount += 1;
    this.passkeyPromptCount += 1;
    this.crossFamilyAuthMethodAdditionRan = true;
    this.addedWalletAuthMethodId = result.walletAuthMethodId;
    this.recordService(
      `passkey added wallet=${String(result.walletId)} rp=${String(result.rpId)} method=${result.walletAuthMethodId}`,
    );
  }

  /**
   * The Email OTP method just added actually opens the wallet.
   *
   * The hosted Google menu names the selected wallet, proves its verified
   * address, and opens the exact Email OTP method added to a passkey-founded
   * wallet.
   */
  async unlockWithAddedEmailOtp(): Promise<void> {
    this.recordStage('unlock_with_added_email_otp');
    const registration = this.requireRegisteredWalletForSigning();
    await this.resetRuntimeOnlyState();
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runIntendedPageAction('unlockWithAddedEmailOtp');
    const result = requireEndedResult(
      snapshot,
      'added_email_otp_unlock_success',
      'unlock with the added email code',
    );
    if (result.walletId !== registration.walletId) {
      throw new Error('unlock with the added email code opened a different wallet');
    }
    if (result.authenticationKind !== 'authenticated') {
      throw new Error(
        `unlock with the added email code did not authenticate the wallet: ${result.authenticationKind}`,
      );
    }
    this.assertWalletSessionNamesAddedMethod({
      label: 'added email code',
      sessionWalletAuthMethodId: result.sessionWalletAuthMethodId,
    });
    const observedPaths = new Set(this.routerPathsSince(traceStartIndex));
    for (const expectedPath of [
      '/auth/google/verify',
      '/wallet/email-otp/challenge',
      '/wallet/email-otp/factor-release',
      '/wallet/unlock/verify',
    ]) {
      if (!observedPaths.has(expectedPath)) {
        throw new Error(`Added Email OTP unlock did not traverse ${expectedPath}`);
      }
    }
    this.currentWarmSigningStage = 'post_unlock';
    this.emailOtpVerificationCount += 1;
    this.operatingAuthFamily = 'email_otp';
    this.recordService(`added email code unlocked wallet=${String(registration.walletId)}`);
  }
}

/**
 * The committed revoke request with one thing changed: its operation (the
 * time it names) or its proof (the code or the challenge digest it carries).
 */
function changedRevokeRequestBody(body: string, change: 'operation' | 'proof'): string {
  const request = JSON.parse(body) as {
    requestedAtMs: number;
    sourceProof:
      | { kind: 'email_otp'; otpCode: string }
      | { kind: 'webauthn_assertion'; expectedChallengeDigestB64u: string };
  };
  if (change === 'operation') {
    request.requestedAtMs += 1;
  } else if (request.sourceProof.kind === 'email_otp') {
    const last = request.sourceProof.otpCode.slice(-1);
    request.sourceProof.otpCode = `${request.sourceProof.otpCode.slice(0, -1)}${last === '0' ? '1' : '0'}`;
  } else {
    const digest = request.sourceProof.expectedChallengeDigestB64u;
    request.sourceProof.expectedChallengeDigestB64u = `${digest.slice(0, -1)}${digest.endsWith('A') ? 'B' : 'A'}`;
  }
  return JSON.stringify(request);
}

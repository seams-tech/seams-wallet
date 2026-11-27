import type { SignNEP413MessageParams } from '../../../packages/mpc-wallet/src/core/types/sdkPublicResults';
import { randomUUID } from 'node:crypto';
import {
  IntendedHarnessCore,
  ROUTER_AB_ED25519_SIGNING_PATHS,
  ROUTER_AB_ED25519_YAO_EXPORT_PATHS,
  ROUTER_AB_ED25519_YAO_REGISTRATION_PATHS,
  ROUTER_AB_ED25519_YAO_WARM_RECOVERY_PATHS,
  routerPathIn,
} from './harness-core';
import { requireLocalIntendedYaoFaultRouterOrigin } from './harness-environment';
import { assertNever } from './harness-validation';
import {
  type IntendedPageSnapshot,
  parseIntendedConcurrentActionSnapshots,
  requireArcEvmSigningResult,
  requireConcurrentSigningSuccess,
  requireEcdsaExportResult,
  requireEd25519ExportResult,
  requireNearSigningResult,
  requireTempoSigningResult,
  snapshotWithMostLifecycleEvents,
} from './intended-page-snapshot';
import { requireNearReadyRegisteredWallet } from './registered-wallet';
import {
  verifyArcEvmSignature,
  verifyNearEd25519Signature,
  verifyTempoEcdsaSignature,
} from './signature-verification';
import {
  assertEmailOtpKeyExportAuth,
  assertPasskeyKeyExportAuth,
  assertSigningAuthExpectation,
  type AuthCounterIncrement,
  type IntendedSigningStage,
  minimumRemainingUse,
  type SigningAuthEventSummary,
  signingAuthExpectationForStage,
  signingEmailOtpVerificationCount,
  signingPasskeyPromptCount,
  summarizeKeyExportAuthEvents,
  summarizeSigningAuthEvents,
} from './signing-auth-events';
import {
  autoConfirmWalletIframeUntil,
  closeExportViewerFrameButton,
  isAutomatedSecureConfirmationCancellation,
  signAndVerifyNearMessage,
  waitForWalletIframeConfirmationSettlement,
  type WalletIframeAutoConfirmDiagnostics,
} from './wallet-iframe-confirm';

type IntendedNearSigningStage = Exclude<IntendedSigningStage, 'after_refresh_recovery'>;

type IntendedNoYaoRecoveryAssertionScenario =
  | { kind: 'passkey_unlock' }
  | { kind: 'email_otp_unlock' }
  | { kind: 'post_refresh_near_signing' };

type IntendedNearSigningScenario =
  | {
      kind: 'standard';
      stage: IntendedNearSigningStage;
    }
  | {
      kind: 'post_refresh';
      stage: 'after_refresh_recovery';
    };

declare global {
  interface Window {
    __seamsIntendedConcurrentActionObserver?: IntendedConcurrentActionObserver;
  }
}

type IntendedConcurrentActionObserver = {
  observer: MutationObserver;
  snapshots: unknown[];
};

const INTENDED_TEMPO_CHAIN_ID = 42_431;
const INTENDED_ARC_EVM_CHAIN_ID = 5_042_002;
const MAX_BUDGET_EXHAUSTION_SIGNS = 8;

function installIntendedConcurrentActionObserver(): void {
  // Playwright serializes this installer alone, so its observer callback must be self-contained.
  function captureSnapshot(): void {
    const state = window.__seamsIntendedConcurrentActionObserver;
    if (!state) return;
    const output = document.querySelector('[data-testid="intended-result-json"]');
    const text = output?.textContent?.trim();
    if (!text) return;
    try {
      state.snapshots.push(JSON.parse(text));
    } catch {
      return;
    }
  }

  window.__seamsIntendedConcurrentActionObserver?.observer.disconnect();
  const output = document.querySelector('[data-testid="intended-result-json"]');
  if (!output) {
    throw new Error('Intended page result output is unavailable for concurrent signing');
  }
  const observer = new MutationObserver(captureSnapshot);
  window.__seamsIntendedConcurrentActionObserver = { observer, snapshots: [] };
  observer.observe(output, { childList: true, characterData: true, subtree: true });
  captureSnapshot();
}

function triggerConcurrentEvmFamilySigning(): void {
  const tempo = document.querySelector<HTMLButtonElement>('[data-testid="intended-sign-tempo"]');
  const arcEvm = document.querySelector<HTMLButtonElement>('[data-testid="intended-sign-arc-evm"]');
  if (!tempo || !arcEvm) {
    throw new Error('Concurrent Tempo/Arc signing controls are unavailable');
  }
  if (tempo.disabled || arcEvm.disabled) {
    throw new Error('Concurrent Tempo/Arc signing controls are disabled');
  }
  tempo.click();
  arcEvm.click();
}

function intendedConcurrentEvmFamilySigningFinished(): boolean {
  const snapshots = window.__seamsIntendedConcurrentActionObserver?.snapshots;
  if (!snapshots) return false;
  let tempoComplete = false;
  let arcEvmComplete = false;
  for (const raw of snapshots) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const action = Reflect.get(raw, 'action');
    if (!action || typeof action !== 'object' || Array.isArray(action)) continue;
    const status = Reflect.get(action, 'status');
    if (status !== 'success' && status !== 'error') continue;
    const actionName = Reflect.get(action, 'action');
    if (actionName === 'signTempoTransaction') tempoComplete = true;
    if (actionName === 'signArcEvmTransaction') arcEvmComplete = true;
  }
  return tempoComplete && arcEvmComplete;
}

function readIntendedConcurrentActionSnapshots(): unknown[] {
  return window.__seamsIntendedConcurrentActionObserver?.snapshots ?? [];
}

function disconnectIntendedConcurrentActionObserver(): void {
  const state = window.__seamsIntendedConcurrentActionObserver;
  if (!state) return;
  state.observer.disconnect();
  delete window.__seamsIntendedConcurrentActionObserver;
}

/** Signing and key export, with the checks of how each signature was authorized. */
export class SigningFlows extends IntendedHarnessCore {
  async signNearMessage(
    message: string,
    options?: Pick<SignNEP413MessageParams, 'callbackUrl' | 'state'>,
  ) {
    const registration = requireNearReadyRegisteredWallet(
      this.requireRegisteredWalletForSigning(),
      'NEAR message signing',
    );
    return await signAndVerifyNearMessage(this.page, message, registration, options);
  }

  async signNearTransaction(stage: IntendedNearSigningStage): Promise<SigningAuthEventSummary> {
    return await this.executeNearSigningScenario({ kind: 'standard', stage });
  }

  async signNearTransactionAfterRefresh(): Promise<SigningAuthEventSummary> {
    return await this.executeNearSigningScenario({
      kind: 'post_refresh',
      stage: 'after_refresh_recovery',
    });
  }

  private async executeNearSigningScenario(
    scenario: IntendedNearSigningScenario,
  ): Promise<SigningAuthEventSummary> {
    const { stage } = scenario;
    this.recordStage(`${stage}:near.sign`);
    const registration = requireNearReadyRegisteredWallet(
      this.requireRegisteredWalletForSigning(),
      'NEAR signing',
    );
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runNearSigningPageAction(registration.nearAccountId);
    const result = requireNearSigningResult(snapshot, {
      walletId: this.walletId,
      nearAccountId: registration.nearAccountId,
    });
    await verifyNearEd25519Signature({ registration, result });
    if (snapshot.events.length === 0) {
      throw new Error('NEAR signing did not emit structured lifecycle events');
    }
    const summary = this.assertSigningAuthEvents(snapshot, stage, 'NEAR signing');
    switch (scenario.kind) {
      case 'standard':
        break;
      case 'post_refresh':
        this.assertNoRouterAbEd25519YaoRecoveryRoutes(traceStartIndex, {
          kind: 'post_refresh_near_signing',
        });
        break;
      default:
        assertNever(scenario);
    }
    this.assertRouterAbEd25519SigningRoutes(traceStartIndex);
    this.assertNoEd25519YaoRegistrationRoutes(traceStartIndex);
    this.recordSigningRemainingUses(summary);
    this.recordService(
      `near signing signature verified wallet=${result.walletId} near=${result.nearAccountId} bytes=${result.signedTransactionByteLength}`,
    );
    return summary;
  }

  protected async runNearSigningPageAction(nearAccountId: string): Promise<IntendedPageSnapshot> {
    try {
      return await this.runIntendedPageAction('signNearTransaction', {
        nearAccountId,
      });
    } catch (error) {
      if (!isAutomatedSecureConfirmationCancellation(error)) throw error;
      this.recordService('retrying transient automated NEAR secure-confirm cancellation');
      await this.page.waitForTimeout(250);
      return await this.runIntendedPageAction('signNearTransaction', {
        nearAccountId,
      });
    }
  }

  signingActionTimingEvidence() {
    if (!this.latestActionTiming) throw new Error('Expected action timing evidence');
    const diagnostics = this.latestWalletIframeAutoConfirmDiagnostics;
    return {
      ...this.latestActionTiming.evidence(),
      confirmationAutomation: {
        clock: 'milliseconds since confirmation loop start',
        buttonVisibleMs: diagnostics?.firstButtonVisibleMs ?? null,
        clickDispatchMs: diagnostics?.firstClickDispatchMs ?? null,
        clickDurationMs: diagnostics?.firstClickDurationMs ?? null,
      },
    };
  }

  async signTempoTransaction(stage: IntendedSigningStage): Promise<SigningAuthEventSummary> {
    this.recordStage(`${stage}:tempo.sign`);
    const registration = this.requireRegisteredWalletForSigning();
    const snapshot = await this.runIntendedPageAction('signTempoTransaction');
    const result = requireTempoSigningResult(snapshot, {
      walletId: this.walletId,
      chainId: INTENDED_TEMPO_CHAIN_ID,
    });
    await verifyTempoEcdsaSignature({ registration, result });
    if (snapshot.events.length === 0) {
      throw new Error('Tempo signing did not emit structured lifecycle events');
    }
    const summary = this.assertSigningAuthEvents(snapshot, stage, 'Tempo signing');
    this.recordSigningRemainingUses(summary);
    this.recordService(
      `tempo signing signature verified wallet=${result.walletId} chainId=${result.chainId}`,
    );
    return summary;
  }

  async signArcEvmTransaction(stage: IntendedSigningStage): Promise<SigningAuthEventSummary> {
    this.recordStage(`${stage}:arc_evm.sign`);
    const registration = this.requireRegisteredWalletForSigning();
    const snapshot = await this.runIntendedPageAction('signArcEvmTransaction');
    const result = requireArcEvmSigningResult(snapshot, {
      walletId: this.walletId,
      chainId: INTENDED_ARC_EVM_CHAIN_ID,
    });
    await verifyArcEvmSignature({ registration, result });
    if (snapshot.events.length === 0) {
      throw new Error('Arc/EVM signing did not emit structured lifecycle events');
    }
    const summary = this.assertSigningAuthEvents(snapshot, stage, 'Arc/EVM signing');
    this.recordSigningRemainingUses(summary);
    this.recordService(
      `arc evm signing signature verified wallet=${result.walletId} chainId=${result.chainId}`,
    );
    return summary;
  }

  async signTempoAndArcEvmConcurrently(stage: IntendedSigningStage): Promise<void> {
    this.recordStage(`${stage}:tempo_arc.concurrent_sign`);
    const registration = this.requireRegisteredWalletForSigning();
    await this.ensureIntendedPageOpen();
    // The concurrent pair must spend the last two signatures of the session, with any default
    // budget (DEFAULT_WALLET_SESSION_REMAINING_USES).
    await this.spendSigningBudgetDownTo(2, stage);
    this.latestWalletBudgetStatusRequest = null;
    this.preparedWalletBudgetStatus = null;
    await this.page.evaluate(installIntendedConcurrentActionObserver);
    const diagnostics: WalletIframeAutoConfirmDiagnostics = { attempts: 0, clicked: false };
    let rawSnapshots: unknown[];
    try {
      await this.page.evaluate(triggerConcurrentEvmFamilySigning);
      const completion = this.page.waitForFunction(
        intendedConcurrentEvmFamilySigningFinished,
        undefined,
        { timeout: 120_000 },
      );
      await autoConfirmWalletIframeUntil(this.page, completion, {
        timeoutMs: 120_000,
        intervalMs: 250,
        diagnostics,
      });
      rawSnapshots = await this.page.evaluate(readIntendedConcurrentActionSnapshots);
    } catch (error) {
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          `Concurrent wallet iframe auto-confirm diagnostics: ${JSON.stringify(diagnostics)}`,
          this.recentTraceForError(),
        ].join('\n'),
      );
    } finally {
      await this.page.evaluate(disconnectIntendedConcurrentActionObserver);
      this.latestWalletIframeAutoConfirmDiagnostics = diagnostics;
      this.recordService(`concurrent wallet iframe auto-confirm ${JSON.stringify(diagnostics)}`);
    }

    const snapshots = parseIntendedConcurrentActionSnapshots(rawSnapshots);
    const tempoSnapshot = requireConcurrentSigningSuccess(snapshots, 'signTempoTransaction');
    const arcEvmSnapshot = requireConcurrentSigningSuccess(snapshots, 'signArcEvmTransaction');
    const tempoResult = requireTempoSigningResult(tempoSnapshot, {
      walletId: this.walletId,
      chainId: INTENDED_TEMPO_CHAIN_ID,
    });
    const arcEvmResult = requireArcEvmSigningResult(arcEvmSnapshot, {
      walletId: this.walletId,
      chainId: INTENDED_ARC_EVM_CHAIN_ID,
    });
    await verifyTempoEcdsaSignature({ registration, result: tempoResult });
    await verifyArcEvmSignature({ registration, result: arcEvmResult });
    await this.assertConcurrentWalletBudgetExhausted();
    const concurrentSnapshot = snapshotWithMostLifecycleEvents(tempoSnapshot, arcEvmSnapshot);
    this.assertSigningAuthEvents(concurrentSnapshot, stage, 'Concurrent Tempo/Arc signing');
    this.latestSigningRemainingUses = 0;
    this.latestPageSnapshot = concurrentSnapshot;
    this.recordService(
      `concurrent Tempo/Arc signatures verified wallet=${this.walletId} remainingUses=0`,
    );
    await waitForWalletIframeConfirmationSettlement(this.page);
  }

  /**
   * Signs Tempo transactions until the server says that the Wallet Session has at most `uses`
   * signatures left. Without a session status from an earlier signature, it does nothing.
   */
  private async spendSigningBudgetDownTo(uses: number, stage: IntendedSigningStage): Promise<void> {
    if (!this.latestWalletBudgetStatusRequest && !this.preparedWalletBudgetStatus) return;
    for (let attempt = 0; attempt < MAX_BUDGET_EXHAUSTION_SIGNS; attempt += 1) {
      const status = await this.readCurrentWalletSessionStatus();
      if (status.remainingUses <= uses) return;
      await this.signTempoTransaction(stage);
    }
    throw new Error(`The Wallet Session did not reach ${uses} remaining signatures`);
  }

  async exhaustSigningBudget(): Promise<void> {
    this.recordStage('remaining_spend.exhaust');
    if (this.latestSigningRemainingUses === 0) {
      this.recordService('signing remaining spend already exhausted');
      return;
    }
    if (await this.walletBudgetAuthoritativelyExhausted()) return;
    for (let attempt = 1; attempt <= MAX_BUDGET_EXHAUSTION_SIGNS; attempt += 1) {
      const summary = await this.signNearTransaction(this.currentWarmSigningStage);
      const remainingUses = minimumRemainingUse(summary);
      this.recordService(
        `near remaining spend exhaustion attempt=${attempt} remainingUses=${String(remainingUses)}`,
      );
      if (remainingUses === 0) {
        return;
      }
      if (await this.walletBudgetAuthoritativelyExhausted()) return;
    }
    throw new Error(
      `NEAR remaining spend did not exhaust within ${MAX_BUDGET_EXHAUSTION_SIGNS} warm signs`,
    );
  }

  /** Whether the server reports the Wallet Session that signing last read as exhausted. */
  private async walletBudgetAuthoritativelyExhausted(): Promise<boolean> {
    if (!this.latestWalletBudgetStatusRequest && !this.preparedWalletBudgetStatus) return false;
    const replay = await this.replayLatestWalletBudgetStatus();
    if (replay.kind !== 'exhausted') return false;
    this.latestSigningRemainingUses = 0;
    this.recordService(
      `signing remaining spend authoritatively exhausted walletSessionId=${replay.walletSessionId} quotaId=${replay.quotaId}`,
    );
    return true;
  }

  async exportEcdsaKey(): Promise<void> {
    this.recordStage('ecdsa.export');
    const snapshot = await this.runIntendedPageAction('exportEcdsaKey');
    const result = requireEcdsaExportResult(snapshot, {
      walletId: this.walletId,
      chainId: INTENDED_ARC_EVM_CHAIN_ID,
    });
    if (snapshot.events.length === 0) {
      throw new Error('ECDSA export did not emit structured lifecycle events');
    }
    this.recordExportAuthCounters(this.assertKeyExportAuthEvents(snapshot, 'ECDSA export'));
    await this.closeExportViewerIfOpen();
    this.recordService(
      `ecdsa export succeeded wallet=${result.walletId} chainId=${result.chainId}`,
    );
  }

  async exportEd25519Key(): Promise<void> {
    this.recordStage('ed25519.export');
    const traceStartIndex = this.trace.length;
    const snapshot = await this.runIntendedPageAction('exportEd25519Key');
    const registration = requireNearReadyRegisteredWallet(
      this.requireRegisteredWalletForSigning(),
      'Ed25519 export',
    );
    const result = requireEd25519ExportResult(snapshot, {
      walletId: this.walletId,
      nearAccountId: registration.nearAccountId,
    });
    if (snapshot.events.length === 0) {
      throw new Error('Ed25519 export did not emit structured lifecycle events');
    }
    this.recordExportAuthCounters(this.assertKeyExportAuthEvents(snapshot, 'Ed25519 export'));
    this.assertRouterAbEd25519YaoExportRoutes(traceStartIndex);
    await this.closeExportViewerIfOpen();
    this.recordService(
      `ed25519 export succeeded wallet=${result.walletId} nearAccountId=${result.nearAccountId}`,
    );
  }

  /**
   * An Ed25519 export whose admission loses the Gateway's storage right after
   * the batch that authorized it committed the export's `authorized` state,
   * its nonce claim and its authorized operation. The Gateway sends the
   * identical request again, which admits the export from that durable
   * authorization, and the export completes.
   */
  async exportEd25519KeyAcrossInterruptedAuthorization(): Promise<void> {
    this.recordStage('ed25519.export_across_interrupted_authorization');
    const assertProof = this.armInterruptedEd25519ExportAuthorization();
    try {
      await this.exportEd25519Key();
    } finally {
      this.intendedYaoExportFaultToken = null;
    }
    assertProof();
  }

  /**
   * Arms the storage loss after the next Ed25519 export authorization commits,
   * for a step that drives the export itself. The returned check proves the
   * Gateway admitted the export from its exact retry.
   */
  armInterruptedEd25519ExportAuthorization(): () => void {
    if (this.intendedYaoExportFaultToken !== null) {
      throw new Error('An intended Yao export fault is already armed');
    }
    requireLocalIntendedYaoFaultRouterOrigin(this.config.routerUrl);
    const proofStartIndex = this.intendedYaoFaultProofs.length;
    const faultToken = randomUUID();
    this.intendedYaoExportFaultToken = faultToken;
    return () => {
      this.intendedYaoExportFaultToken = null;
      this.assertIntendedYaoFaultProof(
        proofStartIndex,
        faultToken,
        'export_authorization_committed_then_storage_lost',
      );
      this.recordService('the exact retry admitted an export interrupted after its authorization');
    };
  }

  private async closeExportViewerIfOpen(): Promise<void> {
    const closed = await closeExportViewerFrameButton(this.page);
    if (closed) {
      this.recordService('key export viewer closed');
    }
  }

  private async assertConcurrentWalletBudgetExhausted(): Promise<void> {
    const replay = await this.replayLatestWalletBudgetStatus();
    if (replay.kind !== 'exhausted') {
      throw new Error('Concurrent Tempo/Arc authoritative wallet budget remained active');
    }
    this.recordService(
      `authoritative wallet budget exhausted walletSessionId=${replay.walletSessionId} quotaId=${replay.quotaId}`,
    );
  }

  private assertRouterAbEd25519SigningRoutes(traceStartIndex: number): void {
    const observedPaths = new Set(
      this.trace
        .slice(traceStartIndex)
        .map((entry) =>
          routerPathIn(ROUTER_AB_ED25519_SIGNING_PATHS, entry.url, this.config.routerUrl),
        )
        .filter((path): path is (typeof ROUTER_AB_ED25519_SIGNING_PATHS)[number] => !!path),
    );
    for (const expectedPath of ROUTER_AB_ED25519_SIGNING_PATHS) {
      if (!observedPaths.has(expectedPath)) {
        throw new Error(`NEAR signing did not traverse ${expectedPath}`);
      }
    }
    this.recordService('NEAR signing traversed Router A/B Ed25519 prepare and finalize routes');
  }

  private assertNoEd25519YaoRegistrationRoutes(traceStartIndex: number): void {
    const observedPaths = this.trace
      .slice(traceStartIndex)
      .map((entry) =>
        routerPathIn(ROUTER_AB_ED25519_YAO_REGISTRATION_PATHS, entry.url, this.config.routerUrl),
      )
      .filter((path): path is (typeof ROUTER_AB_ED25519_YAO_REGISTRATION_PATHS)[number] => !!path);
    if (observedPaths.length > 0) {
      throw new Error(
        `Ordinary NEAR signing invoked Ed25519 Yao activation routes: ${observedPaths.join(', ')}`,
      );
    }
    this.recordService('ordinary NEAR signing made zero Ed25519 Yao activation route calls');
  }

  protected assertNoRouterAbEd25519YaoRecoveryRoutes(
    traceStartIndex: number,
    scenario: IntendedNoYaoRecoveryAssertionScenario,
  ): void {
    const flowLabel = noYaoRecoveryAssertionLabel(scenario);
    const observedPaths = new Set<(typeof ROUTER_AB_ED25519_YAO_WARM_RECOVERY_PATHS)[number]>();
    for (const entry of this.trace.slice(traceStartIndex)) {
      const path = routerPathIn(
        ROUTER_AB_ED25519_YAO_WARM_RECOVERY_PATHS,
        entry.url,
        this.config.routerUrl,
      );
      if (path) observedPaths.add(path);
    }
    if (observedPaths.size > 0) {
      throw new Error(
        `${flowLabel} unexpectedly invoked Yao recovery routes: ${[...observedPaths].join(', ')}`,
      );
    }
    this.recordService(`${flowLabel} rehydrated local Ed25519 material without Yao recovery`);
  }

  private assertRouterAbEd25519YaoExportRoutes(traceStartIndex: number): void {
    const observedPaths = new Set<(typeof ROUTER_AB_ED25519_YAO_EXPORT_PATHS)[number]>();
    for (const entry of this.trace.slice(traceStartIndex)) {
      const path = routerPathIn(
        ROUTER_AB_ED25519_YAO_EXPORT_PATHS,
        entry.url,
        this.config.routerUrl,
      );
      if (path) observedPaths.add(path);
    }
    for (const expectedPath of ROUTER_AB_ED25519_YAO_EXPORT_PATHS) {
      if (!observedPaths.has(expectedPath)) {
        throw new Error(`Ed25519 export did not traverse ${expectedPath}`);
      }
    }
    this.recordService('Ed25519 export traversed all strict Router A/B Yao export routes');
  }

  private assertSigningAuthEvents(
    snapshot: IntendedPageSnapshot,
    stage: IntendedSigningStage,
    label: string,
  ): SigningAuthEventSummary {
    const expectation = signingAuthExpectationForStage(this.currentOperatingAuthFamily(), stage);
    const summary = summarizeSigningAuthEvents(snapshot);
    assertSigningAuthExpectation({
      label,
      stage,
      expectation,
      summary,
    });
    this.passkeyPromptCount += signingPasskeyPromptCount(summary);
    this.emailOtpVerificationCount += signingEmailOtpVerificationCount(summary);
    return summary;
  }

  private assertKeyExportAuthEvents(
    snapshot: IntendedPageSnapshot,
    label: string,
  ): AuthCounterIncrement {
    const summary = summarizeKeyExportAuthEvents(snapshot);
    const diagnostics = this.latestWalletIframeAutoConfirmDiagnostics;
    if (this.currentOperatingAuthFamily() === 'passkey') {
      assertPasskeyKeyExportAuth({ label, summary, diagnostics });
      return { passkeyPrompts: 1, emailOtpVerifications: 0 };
    }
    assertEmailOtpKeyExportAuth({ label, summary, diagnostics });
    return { passkeyPrompts: 0, emailOtpVerifications: 1 };
  }

  private recordExportAuthCounters(increment: AuthCounterIncrement): void {
    this.passkeyPromptCount += increment.passkeyPrompts;
    this.emailOtpVerificationCount += increment.emailOtpVerifications;
  }

  private recordSigningRemainingUses(summary: SigningAuthEventSummary): void {
    const remainingUses = minimumRemainingUse(summary);
    if (remainingUses === null) return;
    this.latestSigningRemainingUses = remainingUses;
  }
}

function noYaoRecoveryAssertionLabel(scenario: IntendedNoYaoRecoveryAssertionScenario): string {
  switch (scenario.kind) {
    case 'passkey_unlock':
      return 'Passkey unlock';
    case 'email_otp_unlock':
      return 'Email OTP unlock';
    case 'post_refresh_near_signing':
      return 'Post-refresh local-envelope hydration';
    default:
      return assertNever(scenario);
  }
}

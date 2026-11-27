import {
  type CapturedWalletBudgetStatusRequest,
  capturePreparedWalletBudgetStatus,
  captureWalletBudgetStatusRequest,
} from './wallet-budget-evidence';
import { VirtualPasskeyAuthenticator } from './virtual-authenticator';
import { IntendedActionTiming } from './signing-timing-evidence';
import { parseExactWalletSessionStatusResponse } from '../../../packages/mpc-wallet/src/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import {
  parseMpcWalletSigningQuotaId,
  parseWalletSessionId,
} from '@shared/authorization/capabilityKinds';
import type {
  APIRequestContext,
  APIResponse,
  BrowserContext,
  CDPSession,
  Page,
  Request,
  Response,
  Route,
  TestInfo,
} from '@playwright/test';
import {
  ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_EXPORT_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_WARM_RECOVERY_BOOTSTRAP_PATH_V1,
} from '@shared/utils/routerAbEd25519Yao';
import { INTENDED_ACTIONS, type IntendedActionName } from '../../intended-app/src/intendedContract';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertHttpOk,
  browserStorageDatabasesEmpty,
  clearBrowserStorage,
  compactResponseBodyForTrace,
  enableRegistrationBenchmarkDiagnosticsInFrame,
  enableSigningSessionDebugInFrame,
  fulfillExternalStub,
  hostedBenchmarkAccessToken,
  type IntendedHarnessConfig,
  intendedHarnessConfigFromEnv,
  type IntendedLifecycleFlow,
  isExternalStubHost,
  requireUsableIntendedGoogleIdToken,
  uniqueWalletId,
} from './harness-environment';
import {
  assertNever,
  requireNonNegativeInteger,
  requireRecord,
  requireString,
} from './harness-validation';
import {
  intendedPageActionIsComplete,
  intendedPageActionStartedOrCompleted,
  type IntendedPageSnapshot,
  readIntendedPageSnapshot,
} from './intended-page-snapshot';
import type { RegisteredWalletSnapshot } from './registered-wallet';
import type { IntendedSigningStage } from './signing-auth-events';
import {
  autoConfirmWalletIframeUntil,
  intendedActionRequiresConfirmationSettlement,
  waitForWalletIframeConfirmationSettlement,
  type WalletIframeAutoConfirmDiagnostics,
} from './wallet-iframe-confirm';

type IntendedWarmSessionOriginStage = Extract<
  IntendedSigningStage,
  'post_registration' | 'post_unlock'
>;

const GOOGLE_ID_TOKEN_ACTIONS: ReadonlySet<IntendedActionName> = new Set([
  'addEmailOtpAuthMethod',
  'registerEmailOtpWallet',
  'registerEmailOtpEd25519OnlyWallet',
  'registerEmailOtpEcdsaOnlyWallet',
  'unlockWithAddedEmailOtp',
  'unlockEmailOtpWallet',
  'revokeLinkedDeviceWithEmailOtp',
]);

export type TraceEntry = {
  atMs: number;
  kind: 'stage' | 'console' | 'pageerror' | 'request' | 'requestfailed' | 'response' | 'service';
  message: string;
  url?: string;
  status?: number;
  walletSessionStatusIdentity?: string;
};

export const ROUTER_AB_ED25519_SIGNING_PATHS = [
  '/router-ab/ed25519/sign/prepare',
  '/router-ab/ed25519/sign',
] as const;

export const ROUTER_AB_ED25519_YAO_REGISTRATION_PATHS = [
  ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
] as const;

const LOCAL_INTENDED_YAO_FAULT_HEADER_V1 = 'x-seams-intended-yao-fault-v1';
const LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1 = 'x-seams-intended-yao-fault-token-v1';
const LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1 = 'x-seams-intended-yao-fault-proof-v1';
export const LOCAL_INTENDED_YAO_RECOVERY_FAULT_HEADER_V1 = 'x-seams-intended-yao-recovery-fault-v1';
export const LOCAL_INTENDED_YAO_RECOVERY_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-yao-recovery-fault-token-v1';
export const LOCAL_INTENDED_YAO_SIGNING_FAULT_HEADER_V1 = 'x-seams-intended-yao-signing-fault-v1';
export const LOCAL_INTENDED_YAO_SIGNING_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-yao-signing-fault-token-v1';
export const ROUTER_AB_ED25519_SIGNING_FINALIZE_PATH = '/router-ab/ed25519/sign';
const LOCAL_INTENDED_YAO_EXPORT_FAULT_HEADER_V1 = 'x-seams-intended-yao-export-fault-v1';
const LOCAL_INTENDED_YAO_EXPORT_FAULT_TOKEN_HEADER_V1 =
  'x-seams-intended-yao-export-fault-token-v1';

export type IntendedYaoFaultModeV1 = 'drop_router_response_once' | 'return_terminal_burned_once';

type IntendedYaoFaultProofV1 =
  | 'exact_request_replayed'
  | 'terminal_failure_not_retried'
  | 'recovery_replies_lost_after_router_executed'
  | 'recovery_execute_withheld'
  | 'export_authorization_committed_then_storage_lost'
  | 'signing_finalize_captured'
  | 'signing_finalize_withheld';

type IntendedYaoFaultInjectionStateV1 =
  | {
      readonly kind: 'idle';
    }
  | {
      readonly kind: 'armed';
      readonly mode: IntendedYaoFaultModeV1;
      readonly token: string;
    };

const ROUTER_AB_ED25519_YAO_RECOVERY_PATHS = [
  ROUTER_AB_ED25519_YAO_RECOVERY_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1,
] as const;

export const ROUTER_AB_ED25519_YAO_WARM_RECOVERY_PATHS = [
  ROUTER_AB_ED25519_YAO_WARM_RECOVERY_BOOTSTRAP_PATH_V1,
  ...ROUTER_AB_ED25519_YAO_RECOVERY_PATHS,
] as const;

export const ROUTER_AB_ED25519_YAO_EXPORT_PATHS = [
  ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_EXPORT_EXECUTE_PATH_V1,
] as const;

export const ROUTER_AB_WALLET_RECOVERY_PREPARE_PATH = '/wallets/recovery/prepare';
export const ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH = '/wallets/recovery/finalize';
export const ROUTER_AB_WALLET_RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_PATH =
  '/wallets/recovery/google-email-otp/finalize';

type LifecycleFailureMatcher = {
  id: string;
  pattern: RegExp;
  reason: string;
};

type IntendedLifecycleTracePayload = {
  flow: IntendedLifecycleFlow;
  walletId: string | null;
  appUrl: string;
  routerUrl: string;
  matcherTableVersion: string;
  authPrompts: {
    emailOtp: number;
    passkey: number;
  };
  latestPageSnapshot: IntendedPageSnapshot | null;
  trace: readonly TraceEntry[];
  violations: readonly string[];
};

export type RecoveryAuthorityProjection = {
  readonly walletId: string;
  readonly authorityId: string;
  readonly deviceId: string;
  readonly provenanceKind: 'wallet_recovery';
  readonly recoveryOperationId: string;
  readonly continuityAuthorityId: string;
  readonly authMethodWalletAuthMethodId: string;
  readonly authMethodWalletAuthorityId: string;
  readonly authMethodKind: 'passkey' | 'email_otp';
  readonly authMethodStatus: 'active';
};

type AuthoritativeWalletBudgetReplay =
  | {
      kind: 'active';
      walletSessionId: string;
      quotaId: string;
    }
  | {
      kind: 'exhausted';
      walletSessionId: string;
      quotaId: string;
    };

const LIFECYCLE_FAILURE_MATCHER_TABLE_VERSION = 'refactor-88-2026-07-04';

const LIFECYCLE_FAILURE_MATCHERS: readonly LifecycleFailureMatcher[] = [
  {
    id: 'exact_lane_selection_failure',
    pattern: /exact selected lane/i,
    reason: 'signing did not use a single exact lane',
  },
  {
    id: 'wallet_runtime_postcondition',
    pattern: /WalletRuntimePostcondition/,
    reason: 'wallet runtime reported a lifecycle postcondition failure',
  },
  {
    id: 'canonical_ecdsa_lane_ambiguous_material',
    pattern: /ambiguous_material/i,
    reason: 'runtime observed multiple canonical ECDSA material groups for one operation',
  },
  {
    id: 'post_step_up_retry_success',
    pattern: /post-step-up transaction failed/i,
    reason: 'first post-step-up transaction failed before a retry could succeed',
  },
] as const;
const SEAMS_INTENDED_PERSIST_TRACE_ENV = 'SEAMS_INTENDED_PERSIST_TRACE';
const SEAMS_INTENDED_TRACE_DIR_ENV = 'SEAMS_INTENDED_TRACE_DIR';

function shouldPersistIntendedLifecycleTrace(): boolean {
  return process.env[SEAMS_INTENDED_PERSIST_TRACE_ENV] === '1';
}

function safeTraceFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function intendedLifecycleTraceDirectory(testInfo: TestInfo): string {
  const configured = process.env[SEAMS_INTENDED_TRACE_DIR_ENV];
  if (configured) return path.resolve(configured);
  return path.resolve(testInfo.config.rootDir, '..', 'test-results', 'intended-lifecycle-traces');
}

function intendedLifecycleTraceFilePath(args: {
  testInfo: TestInfo;
  payload: IntendedLifecycleTracePayload;
  attachmentName: string;
}): string {
  const walletId = args.payload.walletId
    ? safeTraceFileSegment(args.payload.walletId)
    : 'no-wallet';
  const flow = safeTraceFileSegment(args.payload.flow);
  /* The devices of one linking contract share a wallet and can close in the
     same millisecond; the attachment name keeps their traces apart. */
  const fileName = `${Date.now()}-${flow}-${walletId}-${safeTraceFileSegment(args.attachmentName)}`;
  return path.join(intendedLifecycleTraceDirectory(args.testInfo), fileName);
}

async function persistIntendedLifecycleTrace(args: {
  testInfo: TestInfo;
  payload: IntendedLifecycleTracePayload;
  attachmentName: string;
}): Promise<void> {
  if (!shouldPersistIntendedLifecycleTrace()) return;
  const filePath = intendedLifecycleTraceFilePath(args);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(args.payload, null, 2), 'utf8');
}

export function isRequestTraceEntry(entry: TraceEntry): boolean {
  return entry.kind === 'request';
}

type IntendedGatewayRequests = {
  get: APIRequestContext['get'];
  post(
    url: string,
    options?: Parameters<APIRequestContext['post']>[1],
  ): Promise<Pick<APIResponse, 'status' | 'ok' | 'text' | 'json'>>;
};

/** The browser, the page actions, the trace and the fault routes that every flow uses. */
export class IntendedHarnessCore {
  readonly flow: IntendedLifecycleFlow;

  walletId: string;

  readonly trace: TraceEntry[] = [];

  protected readonly context: BrowserContext;

  protected readonly page: Page;

  protected readonly request: IntendedGatewayRequests;

  protected readonly networkMode: 'managed_local' | 'external_staging' | 'hosted_product';

  protected readonly config: IntendedHarnessConfig;

  private readonly violations: string[] = [];

  protected emailOtpVerificationCount = 0;

  /** Set by an auth-method addition, which uses one family to add the other. */
  protected crossFamilyAuthMethodAdditionRan = false;

  /** The exact method the last addition created, to check what unlocks later. */
  protected addedWalletAuthMethodId: string | null = null;

  /**
   * The family the wallet is currently operating as.
   *
   * Not the same as `flow`, which names how the wallet was registered. Once a
   * cross-family method is added and used to unlock, every later step-up runs
   * through that family instead, and asserting against the registration flow
   * would demand the credential the user just stopped using.
   */
  protected operatingAuthFamily: 'passkey' | 'email_otp' | null = null;

  protected browserSession:
    | { readonly kind: 'uninitialized' }
    | {
        readonly kind: 'ready';
        readonly session: CDPSession;
        readonly authenticator: VirtualPasskeyAuthenticator;
      } = { kind: 'uninitialized' };

  protected passkeyPromptCount = 0;

  protected latestPageSnapshot: IntendedPageSnapshot | null = null;

  protected latestActionTiming: IntendedActionTiming | null = null;

  protected latestWalletIframeAutoConfirmDiagnostics: WalletIframeAutoConfirmDiagnostics | null =
    null;

  protected intendedPageReady = false;

  protected reloadIntendedPageBeforeNextAction = true;

  /** The app's Wallet Session budget (`signingSessionDefaults`). Null: the app sets none. */
  private signingSessionBudget: { readonly ttlMs: number; readonly remainingUses: number } | null =
    null;

  protected registeredWallet: RegisteredWalletSnapshot | null = null;

  /** Sets the app's Wallet Session budget. The app reads it when the page loads next. */
  useSigningSessionBudget(budget: {
    readonly ttlMs: number;
    readonly remainingUses: number;
  }): void {
    this.signingSessionBudget = budget;
    this.reloadIntendedPageBeforeNextAction = true;
  }

  protected recoveryCodes: readonly string[] = [];

  protected nearSignerSlot = 1;

  protected currentWarmSigningStage: IntendedWarmSessionOriginStage = 'post_registration';

  protected latestSigningRemainingUses: number | null = null;

  protected latestWalletBudgetStatusRequest: CapturedWalletBudgetStatusRequest | null = null;
  protected preparedWalletBudgetStatus: Promise<void> | null = null;

  protected sourceWalletBudgetStatusRequest: CapturedWalletBudgetStatusRequest | null = null;

  protected recoveryAuthorityProjection: RecoveryAuthorityProjection | null = null;

  protected recoveryAuthorityProjectionError: string | null = null;

  protected intendedYaoFaultInjection: IntendedYaoFaultInjectionStateV1 = { kind: 'idle' };

  protected readonly intendedYaoFaultProofs: string[] = [];
  /** Armed once: the next recovery execution loses every Router reply, or is kept from it. */
  protected intendedYaoRecoveryFault: {
    readonly mode: 'lose_router_recovery_replies' | 'withhold_router_recovery_execute';
    readonly token: string;
  } | null = null;

  /** Armed once: the next export admission loses storage after its authorization commits. */
  protected intendedYaoExportFaultToken: string | null = null;

  /** Armed for one NEAR signature: every finalize of it is kept, run or withheld. */
  protected intendedYaoSigningFault: {
    readonly mode: 'capture_signing_finalize' | 'withhold_signing_finalize';
    readonly token: string;
  } | null = null;
  private voiceIdPluginEnabled = false;

  constructor(args: {
    context: BrowserContext;
    flow: IntendedLifecycleFlow;
    networkMode: 'managed_local' | 'external_staging' | 'hosted_product';
    page: Page;
    request: IntendedGatewayRequests;
  }) {
    this.context = args.context;
    this.flow = args.flow;
    this.networkMode = args.networkMode;
    this.page = args.page;
    this.request = args.request;
    this.config = intendedHarnessConfigFromEnv();
    this.walletId = uniqueWalletId();
  }

  async initialize(): Promise<void> {
    this.recordStage('initialize');
    await this.installRegistrationBenchmarkDiagnosticsFlag();
    await this.installSigningSessionDebugFlag();
    await this.installFailureCollectors();
    if (this.networkMode === 'managed_local') {
      await this.installExternalNetworkStubs();
      await this.installIntendedYaoFaultInjection();
    }
    await this.installWebAuthnVirtualAuthenticator();
    await this.resetBrowserStorage();
    await this.assertServicesReady();
  }

  enableVoiceIdPlugin(): void {
    this.voiceIdPluginEnabled = true;
  }

  /**
   * Holds every Wallet Session status answer until released. The Gateway
   * answers each request when it arrives; only the answer's delivery to the
   * wallet waits.
   */
  async holdWalletSessionStatusAnswers(): Promise<{
    readonly heldCount: () => number;
    readonly release: () => void;
    readonly dispose: () => Promise<void>;
  }> {
    const statusPath = '/wallet/session/status';
    /* The status route needs the wallet's Origin, which Playwright's
       provisional headers may leave out of a forwarded request. */
    const origin = new URL(this.config.walletOrigin).origin;
    let holding = true;
    let held = 0;
    let releaseAll: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    const handler = async (route: Route): Promise<void> => {
      const request = route.request();
      if (
        !holding ||
        request.method() !== 'POST' ||
        new URL(request.url()).pathname !== statusPath
      ) {
        await route.fallback();
        return;
      }
      const response = await route.fetch({ headers: { ...request.headers(), origin } });
      held += 1;
      await released;
      await route.fulfill({ response });
    };
    await this.context.route(`**${statusPath}`, handler);
    const release = (): void => {
      holding = false;
      releaseAll();
    };
    return {
      heldCount: () => held,
      release,
      dispose: async () => {
        release();
        await this.context.unroute(`**${statusPath}`, handler);
      },
    };
  }

  assertNoLifecycleViolations(): void {
    if (this.violations.length === 0) return;
    throw new Error(`Intended lifecycle violations:\n${this.violations.join('\n')}`);
  }

  assertNoWrongAuthPath(): void {
    /* Auth-method additions are the one lifecycle that legitimately uses
       both families: the wallet authorizes with the factor it already has and
       verifies the one being added. The guard exists to catch a lifecycle
       silently falling back to the other factor, which is still worth checking
       everywhere else, so this is an opt-out a step must take rather than a
       prefix the flow can accidentally match. */
    if (this.crossFamilyAuthMethodAdditionRan) return;
    if (
      (this.flow === 'passkey.registration' || this.flow === 'passkey.unlock') &&
      this.emailOtpVerificationCount > 0
    ) {
      throw new Error('Passkey lifecycle used Email OTP verification');
    }
    if (
      (this.flow === 'email_otp.registration' || this.flow === 'email_otp.unlock') &&
      this.passkeyPromptCount > 0
    ) {
      throw new Error('Email OTP lifecycle used passkey/WebAuthn verification');
    }
  }

  async attachTrace(
    testInfo: TestInfo,
    attachmentName = 'intended-lifecycle-trace.json',
  ): Promise<void> {
    if (this.networkMode === 'external_staging' && !shouldPersistIntendedLifecycleTrace()) return;
    const payload: IntendedLifecycleTracePayload = {
      flow: this.flow,
      walletId: this.walletId,
      appUrl: this.config.appUrl,
      routerUrl: this.config.routerUrl,
      matcherTableVersion: LIFECYCLE_FAILURE_MATCHER_TABLE_VERSION,
      authPrompts: {
        emailOtp: this.emailOtpVerificationCount,
        passkey: this.passkeyPromptCount,
      },
      latestPageSnapshot: this.latestPageSnapshot,
      trace: this.trace,
      violations: this.violations,
    };
    await persistIntendedLifecycleTrace({ testInfo, payload, attachmentName });
    await testInfo.attach(attachmentName, {
      body: JSON.stringify(payload, null, 2),
      contentType: 'application/json',
    });
  }

  private async installFailureCollectors(): Promise<void> {
    this.page.on('console', this.handleConsoleMessage.bind(this));
    this.page.on('pageerror', this.handlePageError.bind(this));
    this.context.on('request', this.handleRequest.bind(this));
    this.context.on('requestfailed', this.handleRequestFailed.bind(this));
    this.context.on('response', this.handleResponse.bind(this));
  }

  private async installSigningSessionDebugFlag(): Promise<void> {
    if (!this.config.signingSessionDebug) return;
    await this.context.addInitScript(enableSigningSessionDebugInFrame);
  }

  private async installRegistrationBenchmarkDiagnosticsFlag(): Promise<void> {
    await this.context.addInitScript(enableRegistrationBenchmarkDiagnosticsInFrame);
  }

  private async installExternalNetworkStubs(): Promise<void> {
    await this.context.route('**/*', this.handleExternalRoute.bind(this));
  }

  private async installIntendedYaoFaultInjection(): Promise<void> {
    await this.context.route(
      `**${ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1}`,
      this.handleIntendedYaoFaultRoute.bind(this),
    );
    await this.context.route(
      '**/wallets/register/respond',
      this.handleIntendedYaoRespondFaultRoute.bind(this),
    );
    await this.context.route(
      `**${ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1}`,
      this.handleIntendedYaoRecoveryFaultRoute.bind(this),
    );
    await this.context.route(
      `**${ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1}`,
      this.handleIntendedYaoExportFaultRoute.bind(this),
    );
    await this.context.route(
      `**${ROUTER_AB_ED25519_SIGNING_FINALIZE_PATH}`,
      this.handleIntendedYaoSigningFaultRoute.bind(this),
    );
  }

  private async installWebAuthnVirtualAuthenticator(): Promise<void> {
    const client = await this.context.newCDPSession(this.page);
    await client.send('WebAuthn.enable');
    const authenticator = await VirtualPasskeyAuthenticator.add(client);
    this.browserSession = { kind: 'ready', session: client, authenticator };
    this.recordService('webauthn virtual authenticator ready');
  }

  /** The private keys of the virtual passkeys, by base64url credential ID. */
  async passkeySigningKeys(): Promise<Record<string, string>> {
    if (this.browserSession.kind !== 'ready') {
      throw new Error('The virtual passkey requires the initialized browser session');
    }
    return await this.browserSession.authenticator.signingKeys();
  }

  private async resetBrowserStorage(): Promise<void> {
    await this.context.clearCookies();
    await this.page.goto(`${new URL(this.config.appUrl).origin}/__storage-reset`, {
      waitUntil: 'commit',
    });
    await this.page.evaluate(clearBrowserStorage);
    await this.page.waitForFunction(browserStorageDatabasesEmpty, undefined, { timeout: 5_000 });
    if (this.config.signingSessionDebug) {
      await this.page.evaluate(() => {
        localStorage.setItem('seams:debug:signing-session', '1');
      });
    }
    this.intendedPageReady = false;
    this.reloadIntendedPageBeforeNextAction = true;
    this.recordService('browser storage reset');
  }

  private async assertServicesReady(): Promise<void> {
    // The hosted ingress admits readiness only with the benchmark token, and
    // API requests do not pass through the context route that adds it.
    const routerHeaders: Record<string, string> =
      this.networkMode === 'external_staging'
        ? { 'x-r150-benchmark-access': hostedBenchmarkAccessToken() }
        : {};
    await assertHttpOk(this.request, this.config.appUrl, 'site');
    await assertHttpOk(
      this.request,
      `${this.config.routerUrl}/healthz`,
      'router healthz',
      routerHeaders,
    );
    await assertHttpOk(
      this.request,
      `${this.config.routerUrl}/readyz`,
      'router readyz',
      routerHeaders,
    );
    this.recordService('site and router ready');
  }

  protected intendedPageUrl(): URL {
    const url = new URL('/__intended-e2e', this.config.appUrl);
    url.searchParams.set('flow', this.flow);
    if (this.voiceIdPluginEnabled) url.searchParams.set('authMethod', 'voiceid');
    url.searchParams.set('walletId', this.walletId);
    if (this.registeredWallet?.nearReadiness === 'ready') {
      url.searchParams.set('nearAccountId', this.registeredWallet.nearAccountId);
      url.searchParams.set('nearSignerSlot', String(this.nearSignerSlot));
    }
    if (this.config.googleIdToken) {
      url.searchParams.set('googleIdToken', this.config.googleIdToken);
    }
    url.searchParams.set('passkeyEcdsaTargetProfile', this.config.passkeyEcdsaTargetProfile);
    url.searchParams.set('emailOtpEcdsaTargetProfile', this.config.emailOtpEcdsaTargetProfile);
    if (this.signingSessionBudget) {
      url.searchParams.set('signingSessionTtlMs', String(this.signingSessionBudget.ttlMs));
      url.searchParams.set('signingSessionUses', String(this.signingSessionBudget.remainingUses));
    }
    return url;
  }

  private async openIntendedPage(): Promise<void> {
    const url = this.intendedPageUrl();
    await this.page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await this.page.getByTestId('intended-e2e-page').waitFor({
      state: 'visible',
      timeout: 15_000,
    });
    this.intendedPageReady = true;
    this.reloadIntendedPageBeforeNextAction = false;
  }

  protected async resetRuntimeOnlyState(): Promise<void> {
    this.latestPageSnapshot = null;
    await this.page.goto('about:blank');
    this.intendedPageReady = false;
    this.reloadIntendedPageBeforeNextAction = true;
    this.recordService('browser runtime reset preserving storage');
  }

  protected async clearBrowserStorageForColdSync(): Promise<void> {
    await this.context.clearCookies();
    const resetTargets = [
      `${new URL(this.page.url()).origin}/__storage-reset`,
      `${new URL(this.config.walletOrigin).origin}/__storage-reset`,
    ];
    for (const target of resetTargets) {
      await this.page.goto(target, { waitUntil: 'commit' });
      await this.page.evaluate(clearBrowserStorage);
      await this.page.waitForFunction(browserStorageDatabasesEmpty, undefined, { timeout: 5_000 });
    }
    this.latestPageSnapshot = null;
    this.intendedPageReady = false;
    this.reloadIntendedPageBeforeNextAction = true;
    this.recordService('browser storage cleared while preserving the synced passkey credential');
  }

  protected async ensureIntendedPageOpen(): Promise<void> {
    if (this.intendedPageReady && !this.reloadIntendedPageBeforeNextAction) return;
    await this.openIntendedPage();
  }

  protected async runIntendedPageAction(
    action: IntendedActionName,
    opts?: {
      nearAccountId?: string;
      expectedOutcome?: 'success' | 'error';
      stopAfterClick?: boolean;
      onRecoveryCodes?: (codes: readonly string[]) => void;
    },
  ): Promise<IntendedPageSnapshot> {
    if (opts?.nearAccountId && !this.registeredWallet) {
      throw new Error('NEAR signing requires a registered wallet');
    }
    if (GOOGLE_ID_TOKEN_ACTIONS.has(action)) {
      requireUsableIntendedGoogleIdToken(this.config);
    }
    const timing = new IntendedActionTiming();
    await this.ensureIntendedPageOpen();
    timing.pageReadyAt = performance.now();
    await this.page.getByTestId(INTENDED_ACTIONS[action].button).click();
    await this.waitForIntendedPageActionStarted(action);
    timing.actionObservedAt = performance.now();
    const diagnostics: WalletIframeAutoConfirmDiagnostics = { attempts: 0, clicked: false };
    let diagnosticsRecorded = false;
    try {
      const snapshot = await autoConfirmWalletIframeUntil(
        this.page,
        this.waitForIntendedPageActionCompletion(action, opts?.expectedOutcome ?? 'success').then(
          timing.complete.bind(timing),
        ),
        {
          timeoutMs: 120_000,
          intervalMs: 250,
          diagnostics,
          onRecoveryCodes: opts?.onRecoveryCodes,
          stopAfterClick: opts?.stopAfterClick,
        },
      );
      timing.automationFinishedAt = performance.now();
      this.latestPageSnapshot = snapshot;
      if (intendedActionRequiresConfirmationSettlement(action)) {
        await waitForWalletIframeConfirmationSettlement(this.page);
      }
      timing.settledAt = performance.now();
      this.latestActionTiming = timing;
      return snapshot;
    } catch (error) {
      this.latestWalletIframeAutoConfirmDiagnostics = diagnostics;
      this.recordService(`wallet iframe auto-confirm ${JSON.stringify(diagnostics)}`);
      diagnosticsRecorded = true;
      throw new Error(
        [
          error instanceof Error ? error.message : String(error || 'Intended action failed'),
          `Wallet iframe auto-confirm diagnostics: ${JSON.stringify(diagnostics)}`,
          this.recentTraceForError(),
        ].join('\n'),
      );
    } finally {
      this.latestWalletIframeAutoConfirmDiagnostics = diagnostics;
      if (!diagnosticsRecorded) {
        this.recordService(`wallet iframe auto-confirm ${JSON.stringify(diagnostics)}`);
      }
    }
  }

  protected captureRecoveryCodes = (codes: readonly string[]): void => {
    this.recoveryCodes = [...codes];
  };

  protected async waitForIntendedPageActionStarted(action: IntendedActionName): Promise<void> {
    try {
      await this.page.waitForFunction(intendedPageActionStartedOrCompleted, action, {
        timeout: 5_000,
      });
    } catch (error) {
      throw await this.pageActionWaitError(
        `Intended action ${action} did not start after click.`,
        error,
      );
    }
  }

  protected async waitForIntendedPageActionCompletion(
    action: IntendedActionName,
    expectedOutcome: 'success' | 'error',
  ): Promise<IntendedPageSnapshot> {
    try {
      await this.page.waitForFunction(intendedPageActionIsComplete, action, { timeout: 120_000 });
    } catch (error) {
      throw await this.pageActionWaitError(`Intended action ${action} did not complete.`, error);
    }
    const snapshot = await readIntendedPageSnapshot(this.page);
    switch (expectedOutcome) {
      case 'success':
        if (snapshot.action.status === 'success') return snapshot;
        if (snapshot.action.status === 'error') {
          throw new Error(
            `Intended action ${action} failed: ${snapshot.action.error}\n${this.recentTraceForError()}`,
          );
        }
        break;
      case 'error':
        if (snapshot.action.status === 'error') return snapshot;
        if (snapshot.action.status === 'success') {
          throw new Error(`Intended action ${action} succeeded; expected a terminal failure`);
        }
        break;
      default:
        return assertNever(expectedOutcome);
    }
    throw new Error(`Intended action ${action} ended in invalid state: ${snapshot.action.status}`);
  }

  /** A wait on the page's action failed: name it, with the page snapshot and the recent trace. */
  private async pageActionWaitError(message: string, error: unknown): Promise<Error> {
    const snapshot = await this.tryReadIntendedPageSnapshot();
    return new Error(
      [
        message,
        `Page snapshot: ${snapshot ? JSON.stringify(snapshot) : '<unavailable>'}`,
        this.recentTraceForError(),
        `Original error: ${String(error)}`,
      ].join('\n'),
    );
  }

  private async tryReadIntendedPageSnapshot(): Promise<IntendedPageSnapshot | null> {
    try {
      return await readIntendedPageSnapshot(this.page);
    } catch {
      return null;
    }
  }

  protected recentTraceForError(): string {
    const recent = this.trace.slice(-30);
    if (recent.length === 0) return 'Recent intended trace: <empty>';
    return [
      'Recent intended trace:',
      ...recent.map((entry) => {
        const status = entry.status ? ` status=${entry.status}` : '';
        const url = entry.url ? ` url=${entry.url}` : '';
        return `- ${entry.kind}${status}${url}: ${entry.message}`;
      }),
    ].join('\n');
  }

  private async handleExternalRoute(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (!isExternalStubHost(url.hostname)) {
      await route.continue();
      return;
    }
    await fulfillExternalStub(route, this.config);
  }

  private async handleIntendedYaoFaultRoute(route: Route): Promise<void> {
    const current = this.intendedYaoFaultInjection;
    if (current.kind === 'idle' || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    this.intendedYaoFaultInjection = { kind: 'idle' };
    await route.continue({
      headers: {
        ...route.request().headers(),
        [LOCAL_INTENDED_YAO_FAULT_HEADER_V1]: current.mode,
        [LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1]: current.token,
      },
    });
  }

  /** A respond that carries its execute request runs the execution that the fault targets. */
  private async handleIntendedYaoRespondFaultRoute(route: Route): Promise<void> {
    const request = route.request();
    if (
      this.intendedYaoFaultInjection.kind === 'idle' ||
      request.method() !== 'POST' ||
      !Object.hasOwn(request.postDataJSON() ?? {}, 'ed25519Execution')
    ) {
      await route.fallback();
      return;
    }
    await this.handleIntendedYaoFaultRoute(route);
  }

  private async handleIntendedYaoRecoveryFaultRoute(route: Route): Promise<void> {
    const armed = this.intendedYaoRecoveryFault;
    if (armed === null || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    this.intendedYaoRecoveryFault = null;
    await route.continue({
      headers: {
        ...route.request().headers(),
        [LOCAL_INTENDED_YAO_RECOVERY_FAULT_HEADER_V1]: armed.mode,
        [LOCAL_INTENDED_YAO_RECOVERY_FAULT_TOKEN_HEADER_V1]: armed.token,
      },
    });
  }

  private async handleIntendedYaoSigningFaultRoute(route: Route): Promise<void> {
    const armed = this.intendedYaoSigningFault;
    if (armed === null || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.continue({
      headers: {
        ...route.request().headers(),
        [LOCAL_INTENDED_YAO_SIGNING_FAULT_HEADER_V1]: armed.mode,
        [LOCAL_INTENDED_YAO_SIGNING_FAULT_TOKEN_HEADER_V1]: armed.token,
      },
    });
  }

  private async handleIntendedYaoExportFaultRoute(route: Route): Promise<void> {
    const token = this.intendedYaoExportFaultToken;
    if (token === null || route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    this.intendedYaoExportFaultToken = null;
    await route.continue({
      headers: {
        ...route.request().headers(),
        [LOCAL_INTENDED_YAO_EXPORT_FAULT_HEADER_V1]: 'lose_storage_after_export_authorization_once',
        [LOCAL_INTENDED_YAO_EXPORT_FAULT_TOKEN_HEADER_V1]: token,
      },
    });
  }

  private handleConsoleMessage(message: { type(): string; text(): string }): void {
    const text = message.text();
    this.trace.push({
      atMs: Date.now(),
      kind: 'console',
      message: `${message.type()}: ${text}`,
    });
    this.recordViolationIfNeeded(text);
  }

  private handlePageError(error: Error): void {
    const text = error.stack || error.message || String(error);
    this.trace.push({ atMs: Date.now(), kind: 'pageerror', message: text });
    this.recordViolationIfNeeded(text);
  }

  private handleRequestFailed(request: {
    url(): string;
    failure(): { errorText: string } | null;
  }): void {
    const failure = request.failure();
    const message = failure?.errorText || 'request failed';
    this.trace.push({
      atMs: Date.now(),
      kind: 'requestfailed',
      message,
      url: request.url(),
    });
    this.recordViolationIfNeeded(message);
  }

  private handleRequest(request: Request): void {
    const routePath = routePathAtRouter(request.url(), this.config.routerUrl);
    const captured = captureWalletBudgetStatusRequest(request, this.config.routerUrl);
    if (routePath) {
      this.trace.push({
        atMs: Date.now(),
        kind: 'request',
        message: `${request.method()} ${routePath}`,
        url: request.url(),
        ...(captured
          ? {
              walletSessionStatusIdentity: JSON.stringify([
                captured.walletSessionId,
                captured.quotaId,
              ]),
            }
          : {}),
      });
    }
    if (captured) this.latestWalletBudgetStatusRequest = captured;
  }

  async readCurrentWalletSessionStatus() {
    await this.preparedWalletBudgetStatus;
    const captured = this.latestWalletBudgetStatusRequest;
    if (!captured) throw new Error('Signing has not read Wallet Session status');
    const walletSessionId = parseWalletSessionId(captured.walletSessionId);
    const quotaId = parseMpcWalletSigningQuotaId(captured.quotaId);
    if (!walletSessionId.ok || !quotaId.ok) throw new Error('Invalid captured session identity');
    const response = await this.requestWalletBudgetStatus(captured);
    if (!response.ok()) throw new Error(`Wallet Session status failed: ${response.status()}`);
    const status = parseExactWalletSessionStatusResponse(await response.json(), {
      walletSessionId: walletSessionId.value,
      quotaId: quotaId.value,
    });
    if (!status || (status.status !== 'active' && status.status !== 'exhausted')) {
      throw new Error('Expected a current Wallet Session');
    }
    return status;
  }

  protected async replayLatestWalletBudgetStatus(): Promise<AuthoritativeWalletBudgetReplay> {
    await this.preparedWalletBudgetStatus;
    const captured = this.latestWalletBudgetStatusRequest;
    if (!captured) {
      throw new Error('Signing did not expose an authenticated Wallet Session identity');
    }
    return await this.replayWalletBudgetStatus(captured);
  }

  protected async replayWalletBudgetStatus(
    captured: CapturedWalletBudgetStatusRequest,
  ): Promise<AuthoritativeWalletBudgetReplay> {
    const response = await this.requestWalletBudgetStatus(captured);
    const responseText = await response.text();
    if (!response.ok()) {
      throw new Error(
        `Authoritative wallet budget status returned HTTP ${response.status()}: ${responseText}`,
      );
    }
    return parseAuthoritativeWalletBudgetStatus({
      responseText,
      expectedWalletSessionId: captured.walletSessionId,
      expectedQuotaId: captured.quotaId,
    });
  }

  private requestWalletBudgetStatus(captured: CapturedWalletBudgetStatusRequest) {
    const headers: Record<string, string> = {
      Authorization: captured.authorization,
      'Content-Type': captured.contentType,
      Origin: new URL(this.config.walletOrigin).origin,
    };
    // API requests bypass the browser route that supplies benchmark access.
    if (this.networkMode === 'external_staging') {
      headers['x-r150-benchmark-access'] = hostedBenchmarkAccessToken();
    }
    return this.request.post(captured.url, { headers, data: captured.body });
  }

  private async capturePreparedWalletBudget(response: Response): Promise<void> {
    const captured = await capturePreparedWalletBudgetStatus(response);
    if (captured) this.latestWalletBudgetStatusRequest = captured;
  }

  private handleResponse(response: Response): void {
    if (
      response.ok() &&
      routePathAtRouter(response.url(), this.config.routerUrl) ===
        '/router-ab/ecdsa-derivation/sign/prepare'
    ) {
      this.preparedWalletBudgetStatus = this.capturePreparedWalletBudget(response);
    }
    const status = response.status();
    const faultProof = response.headers()[LOCAL_INTENDED_YAO_FAULT_PROOF_HEADER_V1];
    if (faultProof) this.intendedYaoFaultProofs.push(faultProof);
    const routerPath = <Path extends string>(paths: readonly Path[]): Path | null =>
      routerPathIn(paths, response.url(), this.config.routerUrl);
    const signingPath = routerPath(ROUTER_AB_ED25519_SIGNING_PATHS);
    const yaoRegistrationPath = routerPath(ROUTER_AB_ED25519_YAO_REGISTRATION_PATHS);
    const yaoRecoveryPath = routerPath(ROUTER_AB_ED25519_YAO_WARM_RECOVERY_PATHS);
    const yaoExportPath = routerPath(ROUTER_AB_ED25519_YAO_EXPORT_PATHS);
    if (status < 400) {
      void this.captureRecoveryAuthorityProjection(response);
      const observedPath = signingPath ?? yaoRegistrationPath ?? yaoRecoveryPath ?? yaoExportPath;
      if (observedPath) {
        this.trace.push({
          atMs: Date.now(),
          kind: 'response',
          message: `HTTP ${status} ${observedPath}`,
          status,
          url: response.url(),
        });
      }
      return;
    }
    this.trace.push({
      atMs: Date.now(),
      kind: 'response',
      message: `HTTP ${status}`,
      status,
      url: response.url(),
    });
    void this.captureFailedResponseBody(response);
  }

  private async captureRecoveryAuthorityProjection(response: Response): Promise<void> {
    let url: URL;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    if (
      url.origin !== new URL(this.config.routerUrl).origin ||
      (url.pathname !== ROUTER_AB_WALLET_RECOVERY_FINALIZE_PATH &&
        url.pathname !== ROUTER_AB_WALLET_RECOVERY_GOOGLE_EMAIL_OTP_FINALIZE_PATH)
    ) {
      return;
    }
    const body = await response.json().catch(() => null);
    try {
      this.recoveryAuthorityProjection = parseRecoveryAuthorityProjection(body);
    } catch {
      this.recoveryAuthorityProjectionError =
        'Recovery finalization returned an invalid authority projection';
    }
  }

  private async captureFailedResponseBody(response: Response): Promise<void> {
    const body = await response.text().catch(() => '');
    const bodySnippet = compactResponseBodyForTrace(body);
    if (!bodySnippet) return;
    this.trace.push({
      atMs: Date.now(),
      kind: 'response',
      message: bodySnippet,
      status: response.status(),
      url: response.url(),
    });
    this.recordViolationIfNeeded(bodySnippet);
  }

  /** The Router path of each traced entry since `traceStartIndex`, in trace order. */
  protected routerPathsSince(traceStartIndex: number): string[] {
    return this.trace
      .slice(traceStartIndex)
      .map((entry) => routePathAtRouter(entry.url, this.config.routerUrl))
      .filter((path): path is string => path !== null);
  }

  protected recordStage(message: string): void {
    this.trace.push({ atMs: Date.now(), kind: 'stage', message });
  }

  protected recordService(message: string): void {
    this.trace.push({ atMs: Date.now(), kind: 'service', message });
  }

  protected assertIntendedYaoFaultProof(
    proofStartIndex: number,
    token: string,
    expected: IntendedYaoFaultProofV1,
  ): void {
    const observed = this.intendedYaoFaultProofs.slice(proofStartIndex);
    const expectedProof = `${token}:${expected}`;
    if (observed.length !== 1 || observed[0] !== expectedProof) {
      throw new Error(
        `Expected intended Yao fault proof ${expectedProof}; observed ${observed.join(', ') || '<none>'}`,
      );
    }
    this.recordService(`intended Yao fault proof: ${expected}`);
  }

  private recordViolationIfNeeded(message: string): void {
    const matched = LIFECYCLE_FAILURE_MATCHERS.find((matcher) => matcher.pattern.test(message));
    if (!matched) return;
    this.violations.push(`${matched.id}: ${message}`);
  }

  protected currentOperatingAuthFamily(): 'passkey' | 'email_otp' {
    if (this.operatingAuthFamily) return this.operatingAuthFamily;
    return this.flow.startsWith('passkey') ? 'passkey' : 'email_otp';
  }

  protected requireRegisteredWalletForSigning(): RegisteredWalletSnapshot {
    if (this.registeredWallet) return this.registeredWallet;
    throw new Error('Signing requires a registered wallet');
  }
}

/** The path of `rawUrl` when it is one of `paths` at the Router's origin. */
export function routerPathIn<Path extends string>(
  paths: readonly Path[],
  rawUrl: string | undefined,
  routerUrl: string,
): Path | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.origin !== new URL(routerUrl).origin) return null;
  for (const path of paths) {
    if (url.pathname === path) return path;
  }
  return null;
}

export function routePathAtRouter(rawUrl: string | undefined, routerUrl: string): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.origin !== new URL(routerUrl).origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function parseAuthoritativeWalletBudgetStatus(args: {
  readonly responseText: string;
  readonly expectedWalletSessionId: string;
  readonly expectedQuotaId: string;
}): AuthoritativeWalletBudgetReplay {
  let raw: unknown;
  try {
    raw = JSON.parse(args.responseText);
  } catch {
    throw new Error('Authoritative wallet budget status response must be valid JSON');
  }
  const response = requireRecord(raw, 'authoritative wallet budget status response');
  if (response.ok !== true) {
    throw new Error('Authoritative wallet budget status response must report ok=true');
  }
  const walletSessionId = requireString(
    response.walletSessionId,
    'authoritative wallet session status walletSessionId',
  );
  const quotaId = requireString(response.quotaId, 'authoritative wallet session status quotaId');
  if (walletSessionId !== args.expectedWalletSessionId || quotaId !== args.expectedQuotaId) {
    throw new Error('Authoritative wallet budget status returned a different session or quota');
  }
  if (response.status === 'active') {
    return { kind: 'active', walletSessionId, quotaId };
  }
  if (response.status !== 'exhausted') {
    throw new Error(
      `Authoritative wallet budget status has unexpected status ${String(response.status)}`,
    );
  }
  const remainingUses = requireNonNegativeInteger(
    response.remainingUses,
    'authoritative exhausted wallet budget remainingUses',
  );
  if (remainingUses !== 0) {
    throw new Error('Authoritative exhausted wallet quota must have zero remaining uses');
  }
  return {
    kind: 'exhausted',
    walletSessionId,
    quotaId,
  };
}

function parseRecoveryAuthorityProjection(raw: unknown): RecoveryAuthorityProjection {
  const response = requireRecord(raw, 'recovery finalization response');
  if (response.ok !== true) {
    throw new Error('recovery finalization response must report ok=true');
  }
  const projection = requireRecord(response.projection, 'recovery committed projection');
  if (projection.version !== 'wallet_recovery_committed_projection_v1') {
    throw new Error('recovery finalization must return the committed projection envelope');
  }
  const authority = requireRecord(projection.authority, 'recovery authority projection');
  const principal = requireRecord(authority.principal, 'recovery authority principal');
  const provenance = requireRecord(authority.provenance, 'recovery authority provenance');
  const authMethod = requireRecord(projection.authMethod, 'recovery auth method projection');
  if (authority.state !== 'active') {
    throw new Error('recovery authority projection must be active');
  }
  if (principal.kind !== 'owner_device') {
    throw new Error('recovery authority projection must be an owner device');
  }
  if (provenance.kind !== 'wallet_recovery') {
    throw new Error('recovery authority projection must carry wallet-recovery provenance');
  }
  if (authMethod.status !== 'active') {
    throw new Error('recovery auth method projection must be active');
  }
  if (authMethod.kind !== 'passkey' && authMethod.kind !== 'email_otp') {
    throw new Error('recovery auth method projection has an unsupported kind');
  }
  return {
    walletId: requireString(authority.walletId, 'recovery authority walletId'),
    authorityId: requireString(authority.authorityId, 'recovery authority authorityId'),
    deviceId: requireString(principal.deviceId, 'recovery authority deviceId'),
    provenanceKind: 'wallet_recovery',
    recoveryOperationId: requireString(
      provenance.recoveryOperationId,
      'recovery authority recoveryOperationId',
    ),
    continuityAuthorityId: requireString(
      provenance.continuityAuthorityId,
      'recovery authority continuityAuthorityId',
    ),
    authMethodWalletAuthMethodId: requireString(
      authMethod.walletAuthMethodId,
      'recovery auth method walletAuthMethodId',
    ),
    authMethodWalletAuthorityId: requireString(
      authMethod.walletAuthorityId,
      'recovery auth method walletAuthorityId',
    ),
    authMethodKind: authMethod.kind,
    authMethodStatus: 'active',
  };
}

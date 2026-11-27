import { nearTransactionHash } from './near-transaction-hash';
import type { APIRequestContext, BrowserContext, Route } from '@playwright/test';
import { createReadableWalletId } from '@shared/utils/registrationIds';
import type { IntendedEcdsaTargetProfileName } from '../../intended-app/src/intendedContract';
import {
  describeUsableGoogleIdToken,
  resolveGoogleClientId,
} from '../../scripts/intended-google-oidc-env.mjs';
import { requireRecord, requireString } from './harness-validation';

export type IntendedLifecycleFlow =
  | 'passkey.registration'
  | 'passkey.unlock'
  | 'passkey.recovery'
  | 'email_otp.registration'
  | 'email_otp.unlock'
  | 'email_otp.recovery';
const LOCAL_INTENDED_YAO_ROUTER_ORIGIN_V1 = 'http://127.0.0.1:4100';

export type IntendedHarnessConfig = {
  appUrl: string;
  routerUrl: string;
  walletOrigin: string;
  projectEnvironmentId: string;
  publishableKey: string;
  emailOtpAddress: string;
  googleProviderSubjectPrefix: string;
  googleClientId: string;
  googleIdToken: string;
  passkeyEcdsaTargetProfile: IntendedEcdsaTargetProfileName;
  emailOtpEcdsaTargetProfile: IntendedEcdsaTargetProfileName;
  signingSessionDebug: boolean;
};

const EXTERNAL_HOST_PATTERNS = [
  /(^|\.)googleapis\.com$/i,
  /(^|\.)accounts\.google\.com$/i,
  /(^|\.)near\.org$/i,
  /(^|\.)fastnear\.com$/i,
  /^rpc\.moderato\.tempo\.xyz$/i,
  /^rpc\.testnet\.arc\.network$/i,
] as const;

const NEAR_STUB_BLOCK_HASH = '11111111111111111111111111111111';

export async function browserStorageDatabasesEmpty(): Promise<boolean> {
  const databases = await indexedDB.databases().catch((): IDBDatabaseInfo[] => []);
  return databases.every((database) => !database.name);
}

export function hostedBenchmarkAccessToken(): string {
  const accessToken = process.env.SEAMS_INTENDED_BENCHMARK_ACCESS_TOKEN;
  if (!accessToken || accessToken.length < 32) {
    throw new Error('Hosted benchmark access token must contain at least 32 characters');
  }
  return accessToken;
}

export async function installHostedBenchmarkAccess(context: BrowserContext): Promise<void> {
  const accessToken = hostedBenchmarkAccessToken();
  const gatewayUrl = process.env.SEAMS_INTENDED_ROUTER_URL;
  if (!gatewayUrl) throw new Error('Hosted benchmark Gateway URL is required');
  const gatewayOrigin = new URL(gatewayUrl).origin;
  await context.route(
    `${gatewayOrigin}/**`,
    forwardHostedBenchmarkRequest.bind(undefined, accessToken),
  );
}

async function forwardHostedBenchmarkRequest(accessToken: string, route: Route): Promise<void> {
  await route.continue({
    headers: {
      ...route.request().headers(),
      'x-r150-benchmark-access': accessToken,
    },
  });
}

export function intendedNetworkModeFromEnv(): 'managed_local' | 'external_staging' {
  switch (process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY) {
    case undefined:
    case '0':
      return 'managed_local';
    case '1': {
      const arm = process.env.SEAMS_INTENDED_BENCHMARK_ARM;
      const gatewayUrl = process.env.SEAMS_INTENDED_ROUTER_URL;
      if (arm !== 'd1' && arm !== 'do') {
        throw new Error('Hosted benchmark backend arm must be d1 or do');
      }
      if (!gatewayUrl) throw new Error('Hosted benchmark Gateway URL is required');
      const gateway = new URL(gatewayUrl);
      if (
        gateway.protocol !== 'https:' ||
        gateway.hostname.split('.')[0] !== `r150-bench-20260925-${arm}-ingress`
      ) {
        throw new Error('Hosted benchmark Gateway must name the selected arm ingress');
      }
      return 'external_staging';
    }
    default:
      throw new Error('SEAMS_INTENDED_EXTERNAL_GATEWAY must be 0 or 1');
  }
}

export function intendedHarnessConfigFromEnv(): IntendedHarnessConfig {
  const googleClientId = resolveGoogleClientId({ processEnv: process.env });
  return {
    appUrl: process.env.SEAMS_INTENDED_APP_URL || 'http://localhost:4001',
    routerUrl: process.env.SEAMS_INTENDED_ROUTER_URL || 'https://localhost:4101',
    walletOrigin: process.env.SEAMS_INTENDED_WALLET_ORIGIN || 'https://localhost:4002',
    projectEnvironmentId: process.env.SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID || 'local-env',
    publishableKey: process.env.SEAMS_INTENDED_PUBLISHABLE_KEY || 'pk_local',
    emailOtpAddress: process.env.SEAMS_INTENDED_EMAIL || 'alice@example.test',
    googleProviderSubjectPrefix:
      process.env.SEAMS_INTENDED_GOOGLE_SUBJECT_PREFIX || 'intended-google-subject',
    googleClientId,
    googleIdToken: process.env.SEAMS_INTENDED_GOOGLE_ID_TOKEN || '',
    passkeyEcdsaTargetProfile: ecdsaTargetProfileFromEnv({
      raw: process.env.SEAMS_INTENDED_PASSKEY_ECDSA_TARGET_PROFILE,
      name: 'SEAMS_INTENDED_PASSKEY_ECDSA_TARGET_PROFILE',
    }),
    emailOtpEcdsaTargetProfile: emailOtpEcdsaTargetProfileFromEnv(
      process.env.SEAMS_INTENDED_EMAIL_OTP_ECDSA_TARGET_PROFILE,
    ),
    signingSessionDebug: process.env.SEAMS_INTENDED_SIGNING_SESSION_DEBUG === '1',
  };
}

export function requireUsableIntendedGoogleIdToken(
  config: Pick<IntendedHarnessConfig, 'googleClientId' | 'googleIdToken'>,
): void {
  const result = describeUsableGoogleIdToken({
    token: config.googleIdToken,
    clientId: config.googleClientId,
  });
  if (result.status === 'usable') return;
  throw new Error(
    [
      `SEAMS_INTENDED_GOOGLE_ID_TOKEN is ${result.reason}.`,
      'Run pnpm -C tests ensure:intended-google-token before invoking Google-backed intended actions.',
    ].join(' '),
  );
}

export function requireLocalIntendedYaoFaultRouterOrigin(routerUrl: string): void {
  const origin = new URL(routerUrl).origin;
  const offset = Number(process.env.SEAMS_LOCAL_PORT_OFFSET || 0);
  const expected =
    Number.isSafeInteger(offset) && offset >= 0 && offset <= 61435
      ? `http://127.0.0.1:${4100 + offset}`
      : LOCAL_INTENDED_YAO_ROUTER_ORIGIN_V1;
  if (origin === expected) return;
  throw new Error(`Intended Yao fault injection requires ${expected}; received ${origin}`);
}

/** A dev-profile Router can burn an execution for the local terminal-failure fault. */
export function requireLocalIntendedRouterBurnBuild(): void {
  if (process.env.ROUTER_AB_WORKER_BUILD_PROFILE === 'dev') {
    return;
  }
  throw new Error(
    'The terminal-failure fault needs a dev-profile Router: build and run the Workers with ROUTER_AB_WORKER_BUILD_PROFILE=dev',
  );
}

function emailOtpEcdsaTargetProfileFromEnv(
  raw: string | undefined,
): IntendedEcdsaTargetProfileName {
  return ecdsaTargetProfileFromEnv({
    raw,
    name: 'SEAMS_INTENDED_EMAIL_OTP_ECDSA_TARGET_PROFILE',
  });
}

function ecdsaTargetProfileFromEnv(args: {
  raw: string | undefined;
  name: string;
}): IntendedEcdsaTargetProfileName {
  const value = String(args.raw || 'tempo_arc').trim();
  switch (value) {
    case 'none':
    case 'tempo':
    case 'tempo_arc':
      return value;
    default:
      throw new Error(`Unknown ${args.name}: ${value}`);
  }
}

export function uniqueWalletId(): string {
  return String(createReadableWalletId());
}

export function lifecycleFlowFromTestFile(filePath: string): IntendedLifecycleFlow {
  const normalized = filePath.replaceAll('\\', '/');
  if (
    /\/passkey\.registration(?:\.(?:resume|activation-resume))?\.contract\.test\.ts$/u.test(
      normalized,
    ) ||
    normalized.endsWith('passkey.presign-pool.contract.test.ts') ||
    normalized.endsWith('passkey.voiceid-selection.contract.test.ts') ||
    normalized.endsWith('passkey.voiceid-ui.contract.test.ts') ||
    /voiceid\.unlock-(?:near|arc)\.contract\.test\.ts$/u.test(normalized) ||
    normalized.endsWith('voiceid.noise.contract.test.ts') ||
    normalized.endsWith('voiceid.key-export.contract.test.ts') ||
    normalized.endsWith('voiceid.live-page.contract.test.ts') ||
    normalized.endsWith('speak-to-sign.live.contract.test.ts') ||
    normalized.endsWith('presign-generation-storage.contract.test.ts') ||
    normalized.endsWith('passkey.ed25519-yao-local.contract.test.ts') ||
    normalized.endsWith('passkey.signing-session-budget.contract.test.ts') ||
    normalized.endsWith('passkey.near-registration-commit.contract.test.ts') ||
    normalized.endsWith('passkey.near-submission.contract.test.ts') ||
    normalized.endsWith('passkey.add-email-otp.contract.test.ts') ||
    normalized.endsWith('passkey.device-linking.contract.test.ts') ||
    normalized.endsWith('auth-method-addition.matrix.contract.test.ts') ||
    normalized.endsWith('/conformance/journeys/passkey.journeys.contract.test.ts')
  ) {
    return 'passkey.registration';
  }
  if (normalized.endsWith('passkey.unlock.contract.test.ts')) return 'passkey.unlock';
  if (normalized.endsWith('passkey.recovery.contract.test.ts')) return 'passkey.recovery';
  if (normalized.endsWith('google-email-otp.recovery.contract.test.ts')) {
    return 'email_otp.recovery';
  }
  if (
    /email-otp\.registration(?:\.assets|\.resume)?\.contract\.test\.ts$/u.test(normalized) ||
    normalized.endsWith('email-otp.voiceid-selection.contract.test.ts') ||
    normalized.endsWith('email-otp.add-passkey.contract.test.ts') ||
    normalized.endsWith('google-email-otp.rotation.contract.test.ts') ||
    normalized.endsWith('/conformance/journeys/email-otp.journeys.contract.test.ts')
  ) {
    return 'email_otp.registration';
  }
  if (
    normalized.endsWith('email-otp.unlock.contract.test.ts') ||
    normalized.endsWith('email-otp.challenge-expiry.contract.test.ts')
  ) {
    return 'email_otp.unlock';
  }
  throw new Error(`Unknown intended lifecycle contract file: ${filePath}`);
}

export async function clearBrowserStorage(): Promise<void> {
  localStorage.clear();
  sessionStorage.clear();
  const databases = await indexedDB.databases().catch((): IDBDatabaseInfo[] => []);
  const deletions: Promise<void>[] = [];
  for (const database of databases) {
    const name = database.name;
    if (!name) continue;
    deletions.push(
      new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => undefined;
      }),
    );
  }
  await Promise.all(deletions);
}

export function enableSigningSessionDebugInFrame(): void {
  try {
    localStorage.setItem('seams:debug:signing-session', '1');
  } catch {}
}

export function enableRegistrationBenchmarkDiagnosticsInFrame(): void {
  (
    globalThis as {
      __SEAMS_REGISTRATION_BENCHMARK_DIAGNOSTICS?: boolean;
    }
  ).__SEAMS_REGISTRATION_BENCHMARK_DIAGNOSTICS = true;
}

function scheduleServiceReadinessRetry(resolve: () => void): void {
  setTimeout(resolve, 250);
}

export async function assertHttpOk(
  request: Pick<APIRequestContext, 'get'>,
  url: string,
  label: string,
  headers: Record<string, string> = {},
): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    try {
      const response = await request.get(url, { headers, ignoreHTTPSErrors: true, timeout: 5_000 });
      lastStatus = response.status();
      if (response.ok()) return;
    } catch {
      lastStatus = 0;
    }
    await new Promise<void>(scheduleServiceReadinessRetry);
  }
  throw new Error(`${label} is not ready at ${url}${lastStatus > 0 ? `: HTTP ${lastStatus}` : ''}`);
}

export function isExternalStubHost(hostname: string): boolean {
  return EXTERNAL_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

export async function fulfillExternalStub(
  route: Route,
  config: IntendedHarnessConfig,
): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('accounts.google.com')) {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sub: `${config.googleProviderSubjectPrefix}-stub`,
        email: config.emailOtpAddress,
        email_verified: true,
        aud: config.publishableKey,
      }),
    });
    return;
  }
  if (url.hostname.endsWith('near.org')) {
    await fulfillNearRpcStub(route);
    return;
  }
  if (url.hostname.endsWith('fastnear.com')) {
    await fulfillNearRpcStub(route);
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ jsonrpc: '2.0', id: 'intended-evm', result: '0x1' }),
  });
}

export async function fulfillNearRpcStub(route: Route): Promise<void> {
  const request = parseJsonRpcRequest(route.request().postData() || '{}');
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: nearRpcStubResult(request),
    }),
  });
}

function parseJsonRpcRequest(body: string): { id: unknown; method: string; params: unknown } {
  try {
    const parsed = JSON.parse(body);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { id: 'intended-near', method: 'unknown', params: null };
    }
    const id = Reflect.get(parsed, 'id');
    const method = Reflect.get(parsed, 'method');
    return {
      id: id ?? 'intended-near',
      method: typeof method === 'string' ? method : 'unknown',
      params: Reflect.get(parsed, 'params'),
    };
  } catch {
    return { id: 'intended-near', method: 'unknown', params: null };
  }
}

function nearRpcStubResult(request: { method: string; params: unknown }): unknown {
  switch (request.method) {
    case 'query':
      return nearRpcQueryStubResult(request.params);
    case 'block':
      return {
        author: 'intended-e2e',
        chunks: [],
        header: {
          hash: NEAR_STUB_BLOCK_HASH,
          height: 1,
          prev_hash: NEAR_STUB_BLOCK_HASH,
        },
      };
    case 'send_tx': {
      const params = requireRecord(request.params, 'send_tx params');
      const signedTransaction = requireString(params.signed_tx_base64, 'signed transaction');
      const transactionHash = nearTransactionHash(signedTransaction);
      return {
        final_execution_status: 'FINAL',
        status: { SuccessValue: '' },
        transaction: { hash: transactionHash },
        transaction_outcome: {
          id: transactionHash,
          outcome: {
            status: { SuccessValue: '' },
            logs: [],
            receipt_ids: [],
            gas_burnt: 0,
            tokens_burnt: '0',
            executor_id: 'intended-e2e',
          },
        },
        receipts_outcome: [],
      };
    }
    default:
      return {};
  }
}

export function compactResponseBodyForTrace(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  return trimmed.length <= 2_000 ? trimmed : `${trimmed.slice(0, 2_000)}...<truncated>`;
}

function nearRpcQueryStubResult(params: unknown): unknown {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return {};
  const requestType = Reflect.get(params, 'request_type');
  switch (requestType) {
    case 'view_access_key':
      return {
        nonce: 1,
        block_height: 1,
        block_hash: NEAR_STUB_BLOCK_HASH,
        permission: 'FullAccess',
      };
    case 'view_access_key_list':
      return {
        keys: [],
      };
    case 'view_account':
      return {
        amount: '1000000000000000000000000',
        locked: '0',
        code_hash: NEAR_STUB_BLOCK_HASH,
        storage_usage: 0,
        storage_paid_at: 0,
        block_height: 1,
        block_hash: NEAR_STUB_BLOCK_HASH,
      };
    case 'call_function':
      return {
        result: Array.from(new TextEncoder().encode(JSON.stringify('Hello from local NEAR'))),
        logs: [],
        block_height: 1,
        block_hash: NEAR_STUB_BLOCK_HASH,
      };
    default:
      return {};
  }
}

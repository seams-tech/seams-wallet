// The OutLayer backend of the Speak-to-Sign verify route: the pinned verifier on OutLayer, paid
// with the server's payment key, with the TDX quote check of each call and the choice of the
// speech-to-text build (NEAR AI Whisper, or Venice AI while it is down).

import { relayToVerifier, VerifierCallError, type VerifierConfig } from '@seams/voice-sign/server';
import type {
  SpeakToSignBackend,
  SpeakToSignBackendCall,
  SpeakToSignBackendResult,
} from '../../backend';
import { VerifierAttestation } from './attestation';
import { TranscriberChoice } from './transcriber';

/**
 * The verifier calls two remote models, and OutLayer can hold a job before a worker runs it.
 * On 2026-11-11 that wait swung from 1 s to more than 90 s within minutes, while the
 * verifier's own time stayed at 1.7 s; 20 s failed calls that finished in 20-35 s. The wait is
 * longer than the run limit, as in `@seams/voice-sign`.
 */
const OUTLAYER_TIMEOUT_MS = 60_000;
/**
 * 40 s is above the verifier's own 30 s waits for its models, so a slow model gives a signed
 * refusal (`transcriber_unavailable`), not a run that OutLayer stopped. On 2026-11-12 NEAR AI
 * Whisper took 17 s, and the 15 s limit stopped the run.
 */
const OUTLAYER_RESOURCE_LIMITS = Object.freeze({
  max_instructions: 10_000_000_000,
  max_memory_mb: 128,
  max_execution_seconds: 40,
});

/** The backend exists only when the server configuration holds every field. */
export type OutLayerVerifierConfig = Readonly<{
  /** For example `https://testnet-api.outlayer.ai` (`*.outlayer.fastnear.com` is retired: 410). */
  outlayerBaseUrl: string;
  /** `owner/project`, for example `seams-v1.testnet/voice-verifier`. */
  project: string;
  /** The WASM hash of the pinned verifier version: the default build, with NEAR AI Whisper. */
  versionKey: string;
  /**
   * Optional: the WASM hash of the `venice` build of the same verifier, which sends the clip to
   * Venice AI. It serves a call only while NEAR AI or its Whisper is down (`transcriber`).
   */
  veniceVersionKey?: string;
  /** The OutLayer payment key. It goes only into the X-Payment-Key header. */
  paymentKey: string;
  secretsRef: Readonly<{ profile: string; accountId: string }>;
}>;

export type OutLayerBackendDependencies = Readonly<{
  fetch: typeof fetch;
  /** The NEAR AI key of the summary route, for the status check of NEAR AI's Whisper. */
  nearAiApiKey: string | null;
  now?: () => number;
  /** Tests replace the TDX quote check. The server always checks with `VerifierAttestation`. */
  attestation?: Pick<VerifierAttestation, 'check'>;
  /** Tests replace the choice of the speech-to-text service. */
  transcriber?: Pick<TranscriberChoice, 'choose'>;
}>;

const ENV_NAMES = [
  'SPEAK_TO_SIGN_OUTLAYER_BASE_URL',
  'SPEAK_TO_SIGN_OUTLAYER_PROJECT',
  'SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY',
  'SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY',
  'SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE',
  'SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID',
] as const;
/** Optional, apart from the set of six. */
const VENICE_ENV_NAME = 'SPEAK_TO_SIGN_OUTLAYER_VENICE_VERSION_KEY';

export type OutLayerEnvName = (typeof ENV_NAMES)[number] | typeof VENICE_ENV_NAME;

/** Null when no OutLayer variable is set. A partial set is a deployment error. */
export function readOutLayerVerifierConfig(
  read: (name: OutLayerEnvName) => string | undefined,
): OutLayerVerifierConfig | null {
  const values = ENV_NAMES.map((name) => read(name)?.trim() || '');
  if (values.every((value) => value === '')) return null;
  const missing = ENV_NAMES.filter((_, index) => values[index] === '');
  if (missing.length > 0) {
    throw new Error(`Speak-to-Sign verify needs ${missing.join(', ')}`);
  }
  const [outlayerBaseUrl, project, versionKey, paymentKey, profile, accountId] = values;
  const veniceVersionKey = read(VENICE_ENV_NAME)?.trim() || '';
  return {
    outlayerBaseUrl,
    project,
    versionKey,
    paymentKey,
    secretsRef: { profile, accountId },
    ...(veniceVersionKey ? { veniceVersionKey } : {}),
  };
}

/** The OutLayer backend. A bad configuration stops the server at start. */
export function createOutLayerBackend(
  config: OutLayerVerifierConfig,
  dependencies: OutLayerBackendDependencies,
): SpeakToSignBackend {
  const now = dependencies.now ?? Date.now;
  const verifiers = resolveVerifiers(config, dependencies.fetch);
  // Only the fields of the check: the payment key stays with the verifier call.
  const attestation =
    dependencies.attestation ??
    new VerifierAttestation(
      { outlayerBaseUrl: config.outlayerBaseUrl, project: config.project },
      { fetch: dependencies.fetch, now },
    );
  const transcriber =
    dependencies.transcriber ??
    new TranscriberChoice(
      { hasVeniceBuild: verifiers.venice !== null, nearAiApiKey: dependencies.nearAiApiKey },
      { fetch: dependencies.fetch, now },
    );
  return new OutLayerBackend(verifiers, attestation, transcriber, now);
}

/** A verifier call that names its version: the quote check accepts only that WASM hash. */
type PinnedVerifier = VerifierConfig & Readonly<{ versionKey: string }>;

/** The verifier call of each speech-to-text service. The `venice` build is optional. */
type Verifiers = Readonly<{ nearai: PinnedVerifier; venice: PinnedVerifier | null }>;

function resolveVerifiers(
  config: OutLayerVerifierConfig,
  fetch: typeof globalThis.fetch,
): Verifiers {
  const nearai = resolveConfig(config, fetch);
  const { veniceVersionKey } = config;
  if (veniceVersionKey === undefined) return { nearai, venice: null };
  if (!/^[0-9a-f]{64}$/.test(veniceVersionKey) || veniceVersionKey === config.versionKey) {
    throw new Error('Speak-to-Sign OutLayer venice version key must be another 64-hex WASM hash');
  }
  return { nearai, venice: { ...nearai, versionKey: veniceVersionKey } };
}

/**
 * The verifier call of `@seams/voice-sign/server` (speak-to-sign repository). The checks here are
 * stricter than its own: a deployment error stops the server at start, not at the first call.
 */
function resolveConfig(
  config: OutLayerVerifierConfig,
  fetch: typeof globalThis.fetch,
): PinnedVerifier {
  let base: URL;
  try {
    base = new URL(config.outlayerBaseUrl);
  } catch {
    throw new Error('Speak-to-Sign OutLayer base URL is invalid');
  }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('Speak-to-Sign OutLayer base URL must be a plain HTTPS URL');
  }
  if (!/^[a-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(config.project)) {
    throw new Error('Speak-to-Sign OutLayer project must be owner/project');
  }
  for (const [label, value] of [
    ['version key', config.versionKey],
    ['payment key', config.paymentKey],
    ['secrets profile', config.secretsRef.profile],
    ['secrets account', config.secretsRef.accountId],
  ] as const) {
    if (!value || value.trim() !== value) {
      throw new Error(`Speak-to-Sign OutLayer ${label} is required`);
    }
  }
  return {
    baseUrl: config.outlayerBaseUrl,
    project: config.project,
    versionKey: config.versionKey,
    paymentKey: config.paymentKey,
    secretsRef: { profile: config.secretsRef.profile, account_id: config.secretsRef.accountId },
    timeoutMs: OUTLAYER_TIMEOUT_MS,
    resourceLimits: { ...OUTLAYER_RESOURCE_LIMITS },
    fetch,
  };
}

class OutLayerBackend implements SpeakToSignBackend {
  readonly id = 'outlayer' as const;
  // The verifier keeps its templates in OutLayer storage and has no delete.
  readonly operations: ReadonlySet<string> = new Set(['verify', 'enroll']);

  constructor(
    private readonly verifiers: Verifiers,
    private readonly attestation: Pick<VerifierAttestation, 'check'>,
    private readonly transcriber: Pick<TranscriberChoice, 'choose'>,
    private readonly now: () => number,
  ) {}

  /**
   * Relays the input unchanged: the recording in it is sealed to the verifier, so this server
   * cannot read it. `relayToVerifier` gives only an output of a known kind, unchanged. The route
   * sends the output only when the TDX quote of the call binds it to the version that it called:
   * every version of the project signs with the same verdict key.
   */
  async run({
    input,
    logger,
    startedAtMs,
  }: SpeakToSignBackendCall): Promise<SpeakToSignBackendResult> {
    const transcriber = await this.transcriber.choose();
    const verifier = (transcriber === 'venice' && this.verifiers.venice) || this.verifiers.nearai;
    const outlayerStartedAtMs = this.now();
    let output: unknown;
    let attestationPath: string | null;
    try {
      ({ output, attestationUrl: attestationPath } = await relayToVerifier(verifier, { ...input }));
    } catch (error: unknown) {
      const code = verifierFailure(error);
      // The error's message can hold upstream text, so only the code and the status go to the log.
      logger.warn('[speak-to-sign] verifier call failed', {
        code,
        transcriber,
        ...(error instanceof VerifierCallError ? { cause: error.code, status: error.status } : {}),
      });
      return { ok: false, code };
    }
    const outlayerMs = this.now() - outlayerStartedAtMs;
    const attested = await this.attestation.check({
      output,
      attestationUrl: attestationPath,
      versionKey: verifier.versionKey,
    });
    const { recordMs, attestationMs } = attested;
    if (!attested.ok) {
      logger.warn('[speak-to-sign] verifier attestation refused', {
        code: attested.code,
        transcriber,
        recordMs,
        attestationMs,
      });
      return { ok: false, code: attested.code };
    }
    // Only `Revoked` refuses. Another status than `UpToDate` names Intel advisories.
    logger.info('[speak-to-sign] verifier attestation checked', {
      tcbStatus: attested.tcbStatus,
      transcriber,
      recordMs,
      attestationMs,
    });
    return {
      ok: true,
      output,
      attestationUrl: attestationUrlOf(verifier.baseUrl, attestationPath),
      transcriber,
      timing: { outlayerMs, attestationMs, serverMs: this.now() - startedAtMs },
    };
  }
}

/**
 * The full URL of the OutLayer attestation record of a call, from the `attestation_url` path
 * that OutLayer gives (`/attestations/by-call/<call id>`). Null for any other value.
 */
export function attestationUrlOf(baseUrl: string, path: string | null): string | null {
  if (path === null || !/^\/attestations\/by-call\/[0-9a-f-]{1,64}$/.test(path)) return null;
  const base = new URL(baseUrl);
  return `${base.origin}${base.pathname.replace(/\/+$/, '')}${path}`;
}

/** A fixed code for each failure of the call, without upstream text or the payment key. */
function verifierFailure(error: unknown): string {
  if (!(error instanceof VerifierCallError)) return 'verifier_failed';
  switch (error.code) {
    case 'timeout':
      return 'verifier_timeout';
    case 'network':
      return 'verifier_unreachable';
    case 'http':
      return outlayerStatusFailure(error.status ?? 500);
    case 'output':
      // No completed run, or an output of no known kind, such as `seams_voice_error_v1`.
      return 'verifier_failed';
  }
}

function outlayerStatusFailure(status: number): string {
  if (status === 401 || status === 402 || status === 403) return 'verifier_payment_unavailable';
  if (status === 429) return 'verifier_busy';
  if (status >= 400 && status < 500) return 'verifier_rejected_request';
  return 'verifier_failed';
}

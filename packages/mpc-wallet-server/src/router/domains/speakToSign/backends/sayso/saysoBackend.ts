// The SaySo backend of the Speak-to-Sign verify route: the SaySo Worker of the lane, reached
// through the service binding `SAYSO` with `Authorization: Bearer SAYSO_API_KEY`. SaySo checks
// the speaker and the audio and signs the transcript; Wallet core and the co-signer decide the
// words. The browser never holds the key, and the audio goes as a plain WAV.

import { saysoIntent, saysoUserId } from '@shared/speakToSign/evidence/saysoVerdictV1';
import type { SpeakToSignNetwork } from '@shared/speakToSign/spokenRequest';
import { hasExactKeys } from '@shared/utils/exactKeys';
import { isPlainObject } from '@shared/utils/validation';
import type {
  SpeakToSignBackend,
  SpeakToSignBackendCall,
  SpeakToSignBackendResult,
} from '../../backend';

/** The Worker of the lane's SaySo deployment, as a service binding. */
export type SaySoServiceBinding = Readonly<{ fetch(request: Request): Promise<Response> }>;

export type SaySoBackendConfig = Readonly<{
  binding: SaySoServiceBinding;
  /** `SAYSO_API_KEY` of the lane's SaySo Worker. It goes only into the Authorization header. */
  apiKey: string;
}>;

export const SAYSO_ENV_NAMES = ['SAYSO_API_KEY'] as const;
export type SaySoEnvName = (typeof SAYSO_ENV_NAMES)[number];

/**
 * A verify call took about 2 s warm and up to 7 s with a cold speaker container on staging. The
 * limit is above both, so a slow transcriber gives a signed refusal and not a stopped call.
 */
const SAYSO_TIMEOUT_MS = 20_000;
/**
 * An enrollment needs a Wallet Session that a passkey or Email OTP approval issued this recently.
 * A VoiceID session never counts: it is the same voice again.
 */
export const SAYSO_ENROLLMENT_FRESH_MS = 120_000;
const FRESH_APPROVAL_METHODS: ReadonlySet<string> = new Set(['passkey', 'email_otp']);
/** The output kind of each SaySo route. */
const OUTPUT_KINDS = {
  '/v1/verify': 'sayso_verify_output_v1',
  '/v1/enroll': 'sayso_enrollment_v1',
  '/v1/template/delete': 'sayso_template_delete_v1',
} as const;
type SaySoPath = keyof typeof OUTPUT_KINDS;

/** The speech-to-text model that SaySo's `/v1/verify` runs on Workers AI. */
const TRANSCRIBER = 'workers_ai_whisper_large_v3_turbo';

/** Null when the lane sets no SaySo setting. A key without the binding is a deployment error. */
export function readSaySoBackendConfig(
  read: (name: SaySoEnvName) => string | undefined,
  binding: SaySoServiceBinding | null,
): SaySoBackendConfig | null {
  const apiKey = read('SAYSO_API_KEY')?.trim() || '';
  if (!apiKey && !binding) return null;
  if (!apiKey) throw new Error('Speak-to-Sign SaySo needs SAYSO_API_KEY');
  if (!binding) throw new Error('Speak-to-Sign SaySo needs the SAYSO service binding');
  return { binding, apiKey };
}

export function createSaySoBackend(
  config: SaySoBackendConfig,
  dependencies: Readonly<{ now?: () => number }> = {},
): SpeakToSignBackend {
  return new SaySoBackend(config, dependencies.now ?? Date.now);
}

/** The SaySo form of a verify input, as the Wallet's SaySo module sends it. */
type SaySoVerifyInput = Readonly<{
  network: SpeakToSignNetwork;
  owner: string;
  action: string;
  payloadSha256Hex: string;
  sentence: string;
  audioWavB64: string;
}>;

type SaySoEnrollInput = Readonly<{
  network: SpeakToSignNetwork;
  owner: string;
  audioWavB64: readonly string[];
}>;

class SaySoBackend implements SpeakToSignBackend {
  readonly id = 'sayso' as const;
  readonly operations: ReadonlySet<string> = new Set(['verify', 'enroll', 'delete']);

  constructor(
    private readonly config: SaySoBackendConfig,
    private readonly now: () => number,
  ) {}

  async run(call: SpeakToSignBackendCall): Promise<SpeakToSignBackendResult> {
    const { input } = call;
    if (input.op === 'delete') {
      // The owner turned voice approval off. Deleting the owner's own template needs no fresh
      // approval: it can only stop spoken approvals.
      const owner = readDeleteInput(input);
      if (!owner) return { ok: false, code: 'invalid_input' };
      return await this.post(call, '/v1/template/delete', {
        user_id: saysoUserId(owner.network, owner.owner),
      });
    }
    if (input.op === 'enroll') {
      const enroll = readEnrollInput(input);
      if (!enroll) return { ok: false, code: 'invalid_input' };
      // A voice becomes a way to approve payments, so the owner approves the enrollment with a
      // passkey or Email OTP just before it.
      const { session } = call;
      if (
        !FRESH_APPROVAL_METHODS.has(session.authMethodKind) ||
        session.issuedAtMs < call.startedAtMs - SAYSO_ENROLLMENT_FRESH_MS
      ) {
        return { ok: false, code: 'fresh_approval_required' };
      }
      return await this.post(call, '/v1/enroll', {
        user_id: saysoUserId(enroll.network, enroll.owner),
        audio_wav_b64: enroll.audioWavB64,
      });
    }
    const verify = readVerifyInput(input);
    if (!verify) return { ok: false, code: 'invalid_input' };
    let intent: Awaited<ReturnType<typeof saysoIntent>>;
    try {
      // The owner is the session account (the route checked it), so the user is the session's.
      intent = await saysoIntent({
        network: verify.network,
        owner: verify.owner,
        action: verify.action,
        payloadSha256: verify.payloadSha256Hex,
        sentence: verify.sentence,
      });
    } catch {
      return { ok: false, code: 'request_unsupported' };
    }
    return await this.post(call, '/v1/verify', {
      intent: intent.intent,
      audio_wav_b64: verify.audioWavB64,
    });
  }

  /** One call of the SaySo Worker. Its JSON answer goes to the Wallet unchanged. */
  private async post(
    { logger, startedAtMs }: SpeakToSignBackendCall,
    path: SaySoPath,
    body: unknown,
  ): Promise<SpeakToSignBackendResult> {
    const saysoStartedAtMs = this.now();
    let response: Response;
    try {
      response = await this.config.binding.fetch(
        new Request(`https://sayso${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(SAYSO_TIMEOUT_MS),
        }),
      );
    } catch (error: unknown) {
      const code =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'verifier_timeout'
          : 'verifier_unreachable';
      logger.warn('[speak-to-sign] SaySo call failed', { code, path });
      return { ok: false, code };
    }
    const saysoMs = this.now() - saysoStartedAtMs;
    if (!response.ok) {
      const code = saysoStatusFailure(response.status);
      // SaySo's error text stays out of the answer and the log; the status names the cause.
      logger.warn('[speak-to-sign] SaySo refused the call', {
        code,
        path,
        status: response.status,
      });
      return { ok: false, code };
    }
    let output: unknown;
    try {
      output = await response.json();
    } catch {
      return { ok: false, code: 'verifier_failed' };
    }
    if (!isPlainObject(output) || output.kind !== OUTPUT_KINDS[path]) {
      return { ok: false, code: 'verifier_failed' };
    }
    return {
      ok: true,
      output,
      attestationUrl: null,
      transcriber: TRANSCRIBER,
      timing: { saysoMs, serverMs: this.now() - startedAtMs },
    };
  }
}

function readVerifyInput(input: Readonly<Record<string, unknown>>): SaySoVerifyInput | null {
  if (!hasExactKeys(input, ['op', 'network', 'owner', 'intent', 'audio_wav_b64'])) return null;
  const { network, owner, intent, audio_wav_b64: audioWavB64 } = input;
  if (!isNetwork(network) || typeof owner !== 'string' || typeof audioWavB64 !== 'string') {
    return null;
  }
  if (!hasExactKeys(intent, ['action', 'payload_sha256_hex', 'sentence'])) return null;
  const { action, payload_sha256_hex: payloadSha256Hex, sentence } = intent;
  if (typeof action !== 'string' || typeof payloadSha256Hex !== 'string') return null;
  if (typeof sentence !== 'string') return null;
  return { network, owner, action, payloadSha256Hex, sentence, audioWavB64 };
}

function readDeleteInput(
  input: Readonly<Record<string, unknown>>,
): Readonly<{ network: SpeakToSignNetwork; owner: string }> | null {
  if (!hasExactKeys(input, ['op', 'network', 'owner'])) return null;
  const { network, owner } = input;
  return isNetwork(network) && typeof owner === 'string' ? { network, owner } : null;
}

function readEnrollInput(input: Readonly<Record<string, unknown>>): SaySoEnrollInput | null {
  if (!hasExactKeys(input, ['op', 'network', 'owner', 'audio_wav_b64'])) return null;
  const { network, owner, audio_wav_b64: clips } = input;
  if (!isNetwork(network) || typeof owner !== 'string' || !Array.isArray(clips)) return null;
  if (clips.length !== 3 || !clips.every((clip) => typeof clip === 'string')) return null;
  return { network, owner, audioWavB64: clips as readonly string[] };
}

function isNetwork(value: unknown): value is SpeakToSignNetwork {
  return value === 'testnet' || value === 'mainnet';
}

function saysoStatusFailure(status: number): string {
  if (status === 401 || status === 403) return 'verifier_unauthorized';
  if (status === 429) return 'verifier_busy';
  if (status === 413 || (status >= 400 && status < 500)) return 'verifier_rejected_request';
  return 'verifier_failed';
}

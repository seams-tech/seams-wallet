// The Seams server's check of the TDX quote of each OutLayer verifier call. The verdict key is an
// OutLayer keystore key bound to the project, so every version of the project signs with it. The
// quote names the build: its report data is the task hash over the WASM hash, the input hash, the
// output hash, the caller, the project and the time. The verify route sends an output only when
// the quote binds it to the version that the route called (`versionKey` of the call), Intel signed
// the quote for a platform that it did not revoke, and the OutLayer worker contract approves the
// measurements.

import {
  checkAttestationBinding,
  checkQuoteCollateral,
  checkQuoteSignature,
  fetchAttestation,
  fetchCollateral,
  measurementsApproved,
  WORKER_CONTRACT,
  type AttestationRecord,
  type Measurements,
  type QuoteCollateral,
  type TcbStatus,
} from '@seams/voice-verdict';

/** OutLayer stores the record a short time after the call returns: one try each second. */
const RECORD_WAIT_MS = 15_000;
const RECORD_RETRY_MS = 1_000;
/** Each read of OutLayer or of the NEAR RPC. */
const READ_TIMEOUT_MS = 5_000;
/** A positive answer of the worker contract holds this long, so that a removal takes effect. */
const APPROVAL_LIFE_MS = 10 * 60_000;
/** The public RPC of the network of the worker contract, which is the network of the project. */
const NEAR_RPC_URLS = {
  testnet: 'https://rpc.testnet.fastnear.com',
  mainnet: 'https://rpc.mainnet.fastnear.com',
} as const;

export type VerifierAttestationConfig = Readonly<{
  outlayerBaseUrl: string;
  /** `owner/project`. The owner's account names the network of the worker contract. */
  project: string;
}>;

/**
 * One verifier call, as `relayToVerifier` returned it, and the WASM hash of the version that the
 * route called: the only one that the check accepts for this call.
 */
export type VerifierAttestationCall = Readonly<{
  output: unknown;
  attestationUrl: string | null;
  versionKey: string;
}>;

/**
 * `recordMs` is the wait for the record, `attestationMs` the whole check. A refusal has a fixed
 * code `attestation_<code>`, without upstream text.
 */
export type VerifierAttestationResult =
  | Readonly<{ ok: true; tcbStatus: TcbStatus; recordMs: number; attestationMs: number }>
  | Readonly<{ ok: false; code: string; recordMs: number; attestationMs: number }>;

type KeptCollateral = Readonly<{
  collateral: QuoteCollateral;
  validFromMs: number;
  validUntilMs: number;
}>;

/** What the check keeps between calls. */
export type AttestationMemory = Readonly<{
  /** Intel's collateral for each FMSPC that passed a check, until its next update. */
  collaterals: Map<string, KeptCollateral>;
  /** For each set of measurements that the contract approved: until when the answer holds. */
  approvals: Map<string, number>;
}>;

export function createAttestationMemory(): AttestationMemory {
  return { collaterals: new Map(), approvals: new Map() };
}

/** The gateway builds its routes for each request, so the memory belongs to the isolate. */
const ISOLATE_MEMORY = createAttestationMemory();

export type VerifierAttestationDependencies = Readonly<{
  fetch: typeof fetch;
  now: () => number;
  /** Tests pass a clock of their own. */
  sleep?: (ms: number) => Promise<void>;
  /** Default: the memory of this isolate. */
  memory?: AttestationMemory;
}>;

type Outcome = Readonly<{ ok: true; tcbStatus: TcbStatus }> | Readonly<{ ok: false; code: string }>;

export class VerifierAttestation {
  private readonly memory: AttestationMemory;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly read: typeof fetch;
  private readonly near: Readonly<{ rpcUrl: string; contract: string }>;

  constructor(
    private readonly config: VerifierAttestationConfig,
    private readonly dependencies: VerifierAttestationDependencies,
  ) {
    this.memory = dependencies.memory ?? ISOLATE_MEMORY;
    this.sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.read = ((input: RequestInfo | URL, init?: RequestInit) =>
      dependencies.fetch(input, {
        ...init,
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      })) as typeof fetch;
    const network = config.project.split('/')[0].endsWith('.testnet') ? 'testnet' : 'mainnet';
    this.near = { rpcUrl: NEAR_RPC_URLS[network], contract: WORKER_CONTRACT[network] };
  }

  async check(call: VerifierAttestationCall): Promise<VerifierAttestationResult> {
    const startedAtMs = this.dependencies.now();
    const record = await this.waitForRecord(call.attestationUrl);
    const recordMs = this.dependencies.now() - startedAtMs;
    let outcome: Outcome;
    try {
      outcome =
        typeof record === 'string' ? refused(record) : await this.checkRecord(record, call);
    } catch {
      // The record is OutLayer's JSON: a field of another type can throw in the checks.
      outcome = refused('malformed');
    }
    const attestationMs = this.dependencies.now() - startedAtMs;
    return outcome.ok
      ? { ...outcome, recordMs, attestationMs }
      : { ok: false, code: `attestation_${outcome.code}`, recordMs, attestationMs };
  }

  private async waitForRecord(
    attestationUrl: string | null,
  ): Promise<AttestationRecord | 'missing' | 'unavailable'> {
    if (attestationUrl === null) return 'missing';
    const untilMs = this.dependencies.now() + RECORD_WAIT_MS;
    for (;;) {
      try {
        return await fetchAttestation(this.config.outlayerBaseUrl, attestationUrl, {
          fetch: this.read,
        });
      } catch (error: unknown) {
        // Not the URL of a call record: no wait helps.
        if (error instanceof RangeError) return 'missing';
        if (this.dependencies.now() + RECORD_RETRY_MS > untilMs) return 'unavailable';
        await this.sleep(RECORD_RETRY_MS);
      }
    }
  }

  private async checkRecord(record: AttestationRecord, call: VerifierAttestationCall): Promise<Outcome> {
    const bound = await checkAttestationBinding({
      record,
      output: call.output,
      acceptedWasmHashes: [call.versionKey],
      projectId: this.config.project,
    });
    if (!bound.ok) return refused(bound.refusal.code);
    // The collateral must be valid at the time of the call, not at the time of this check.
    const atMs = record.timestamp * 1000;
    const [quote, approval] = await Promise.all([
      this.checkQuote(bound.quote, atMs),
      this.approvalProblem(bound.measurements),
    ]);
    if (!quote.ok) return quote;
    return approval === null ? quote : refused(approval);
  }

  /** The signature chain of the quote to Intel, then Intel's collateral for its platform. */
  private async checkQuote(quote: Uint8Array, atMs: number): Promise<Outcome> {
    const signed = await checkQuoteSignature({ quote, nowMs: atMs });
    if (!signed.ok) return refused(signed.refusal.code);
    const { fmspc } = signed;
    const kept = this.memory.collaterals.get(fmspc);
    let found: KeptCollateral;
    if (kept && covers(kept, atMs)) {
      found = kept;
    } else {
      try {
        const fetched = await fetchCollateral({
          baseUrl: this.config.outlayerBaseUrl,
          fmspc,
          atMs,
          fetch: this.read,
        });
        found = {
          collateral: fetched.collateral,
          validFromMs: Date.parse(fetched.validFrom),
          validUntilMs: Date.parse(fetched.validUntil),
        };
      } catch {
        return refused('collateral_unavailable');
      }
    }
    const full = await checkQuoteCollateral({ quote, nowMs: atMs, collateral: found.collateral });
    if (!full.ok) return refused(full.refusal.code);
    // Only a collateral that passed and covers the call stays in memory.
    if (found !== kept && covers(found, atMs)) this.memory.collaterals.set(fmspc, found);
    return { ok: true, tcbStatus: full.tcbStatus };
  }

  /** Null when the worker contract approves the measurements; else the code of the refusal. */
  private async approvalProblem(measurements: Measurements): Promise<string | null> {
    const { mrtd, rtmr0, rtmr1, rtmr2, rtmr3 } = measurements;
    const key = [this.near.contract, mrtd, rtmr0, rtmr1, rtmr2, rtmr3].join(':');
    if ((this.memory.approvals.get(key) ?? 0) > this.dependencies.now()) return null;
    try {
      const approved = await measurementsApproved({ ...this.near, measurements, fetch: this.read });
      if (!approved) return 'measurements_not_approved';
    } catch {
      return 'measurements_unavailable';
    }
    this.memory.approvals.set(key, this.dependencies.now() + APPROVAL_LIFE_MS);
    return null;
  }
}

/** False for a window that cannot be read: `NaN` compares false. */
function covers(kept: KeptCollateral, atMs: number): boolean {
  return kept.validFromMs <= atMs && atMs < kept.validUntilMs;
}

function refused(code: string): Outcome {
  return { ok: false, code };
}

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { AttestationRecord, QuoteCollateral } from '@seams/voice-verdict';
import {
  createAttestationMemory,
  VerifierAttestation,
  type AttestationMemory,
  type VerifierAttestationConfig,
} from '../../packages/wallet-server/src/router/domains/speakToSign/speakToSignAttestation';

/** A real call of verifier 0.11.0 on OutLayer testnet (2026-11-11), from the speak-to-sign repository. */
const CALL = readFixture('outlayer_attestation_0_11_0.json') as {
  output: Record<string, unknown>;
  record: AttestationRecord & { worker_measurement: string };
};
/** Intel's collateral for the platform of that quote (FMSPC b0c06f000000). */
const COLLATERAL = (
  readFixture('intel_pcs_collateral_0_11_0.json') as { collateral: QuoteCollateral }
).collateral;
const BASE_URL = 'https://testnet-api.outlayer.ai';
const RPC_URL = 'https://rpc.testnet.fastnear.com';
const ATTESTATION_URL = `/attestations/by-call/${CALL.record.call_id}`;
const CONFIG: VerifierAttestationConfig = {
  outlayerBaseUrl: BASE_URL,
  project: 'seams-v1.testnet/voice-verifier',
};
/** The WASM hash of the version that the route called: the one of the record. */
const VERSION_KEY = 'd2f8b63016e6465d614240989f60ff60ad1d0d8dcff7c247e2d4306fc197d9f8';

function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/outlayer-attestation/${name}`, import.meta.url), 'utf8'),
  );
}

type Served = {
  /** The record answers 404 for this many tries, or always. */
  recordMissingTries?: number | 'always';
  record?: unknown;
  collateral?: QuoteCollateral;
  collateralStatus?: number;
  window?: { from: string; until: string };
  approved?: boolean | 'rpc_error';
};

/** A fake OutLayer API and NEAR RPC, with a clock that `sleep` moves. */
function harness(served: Served = {}, memory: AttestationMemory = createAttestationMemory()) {
  const asked = { record: 0, collateral: [] as string[], rpc: [] as Record<string, unknown>[] };
  const sleeps: number[] = [];
  let nowMs = 1_000_000;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(init?.signal, url).toBeInstanceOf(AbortSignal);
    if (url === `${BASE_URL}${ATTESTATION_URL}`) {
      asked.record += 1;
      const missing = served.recordMissingTries ?? 0;
      if (missing === 'always' || asked.record <= missing) {
        return Response.json({ error: 'not found' }, { status: 404 });
      }
      return Response.json(served.record ?? CALL.record);
    }
    if (url.startsWith(`${BASE_URL}/public/collateral?`)) {
      asked.collateral.push(url);
      if (served.collateralStatus) return new Response('busy', { status: served.collateralStatus });
      return Response.json({
        fmspc: 'b0c06f000000',
        covers_requested_time: true,
        valid_from: served.window?.from ?? '2026-11-10T18:17:14Z',
        valid_until: served.window?.until ?? '2026-12-07T23:47:52Z',
        contract_id: 'worker.outlayer.testnet',
        collateral: JSON.stringify(served.collateral ?? COLLATERAL),
      });
    }
    if (url === RPC_URL) {
      const body = JSON.parse(String(init?.body)) as { params: Record<string, unknown> };
      asked.rpc.push(body.params);
      if (served.approved === 'rpc_error')
        return Response.json({ error: { name: 'HANDLER_ERROR' } });
      const answer = new TextEncoder().encode(String(served.approved ?? true));
      return Response.json({ jsonrpc: '2.0', id: 1, result: { result: [...answer], logs: [] } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof globalThis.fetch;
  const dependencies = {
    fetch,
    now: () => nowMs,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      nowMs += ms;
    },
    memory,
  };
  return {
    asked,
    sleeps,
    memory,
    advance: (ms: number) => void (nowMs += ms),
    check: (
      call: { output?: unknown; attestationUrl?: string | null; versionKey?: string } = {},
      config: VerifierAttestationConfig = CONFIG,
    ) =>
      new VerifierAttestation(config, dependencies).check({
        output: call.output ?? CALL.output,
        attestationUrl: call.attestationUrl === undefined ? ATTESTATION_URL : call.attestationUrl,
        versionKey: call.versionKey ?? VERSION_KEY,
      }),
  };
}

test('a real record of the pinned version passes all three checks', async () => {
  const server = harness();
  const result = await server.check();
  expect(result).toEqual({ ok: true, tcbStatus: 'UpToDate', recordMs: 0, attestationMs: 0 });
  expect(server.asked.record).toBe(1);
  // The collateral at the time of the call, not at the time of the check.
  expect(server.asked.collateral).toEqual([
    `${BASE_URL}/public/collateral?fmspc=b0c06f000000&at=${CALL.record.timestamp}`,
  ]);
  expect(server.asked.rpc).toHaveLength(1);
  const [view] = server.asked.rpc;
  expect(view).toMatchObject({
    request_type: 'call_function',
    account_id: 'worker.outlayer.testnet',
    method_name: 'is_measurements_approved',
  });
  const args = JSON.parse(atob(String(view.args_base64))) as {
    measurements: Record<string, string>;
  };
  expect(args.measurements.rtmr3).toBe(CALL.record.worker_measurement);
});

test('a record of another WASM, another output or another project is refused', async () => {
  const otherWasm = harness();
  // A call to another version, such as the `venice` build, accepts only its own WASM hash.
  expect(await otherWasm.check({ versionKey: '0'.repeat(64) })).toMatchObject({
    ok: false,
    code: 'attestation_wasm_not_accepted',
  });
  // A refused binding asks neither Intel's collateral nor the contract.
  expect(otherWasm.asked.collateral).toHaveLength(0);
  expect(otherWasm.asked.rpc).toHaveLength(0);

  const changed = harness();
  expect(await changed.check({ output: { ...CALL.output, outcome: 'accept' } })).toMatchObject({
    ok: false,
    code: 'attestation_output_mismatch',
  });

  const project = harness();
  expect(
    await project.check({}, { ...CONFIG, project: 'other.testnet/voice-verifier' }),
  ).toMatchObject({ ok: false, code: 'attestation_project_mismatch' });

  // A record whose fields do not match its quote, and one that is not a record.
  const edited = harness({ record: { ...CALL.record, wasm_hash: '0'.repeat(64) } });
  expect(await edited.check({ versionKey: '0'.repeat(64) })).toMatchObject({
    ok: false,
    code: 'attestation_task_hash_mismatch',
  });
  for (const record of [{ error: 'nothing' }, { ...CALL.record, tdx_quote: 7 }]) {
    expect(await harness({ record }).check(), JSON.stringify(record).slice(0, 40)).toMatchObject({
      ok: false,
      code: 'attestation_malformed',
    });
  }
});

test('a call without a record URL is refused at once', async () => {
  for (const attestationUrl of [null, '/attestations/other/1', 'https://evil.example/x']) {
    const server = harness();
    expect(await server.check({ attestationUrl })).toEqual({
      ok: false,
      code: 'attestation_missing',
      recordMs: 0,
      attestationMs: 0,
    });
    expect(server.asked.record).toBe(0);
    expect(server.sleeps).toHaveLength(0);
  }
});

test('the route waits one second between tries for the record, for at most 15 s', async () => {
  const late = harness({ recordMissingTries: 3 });
  expect(await late.check()).toMatchObject({ ok: true, recordMs: 3_000, attestationMs: 3_000 });
  expect(late.asked.record).toBe(4);
  expect(late.sleeps).toEqual([1_000, 1_000, 1_000]);

  const never = harness({ recordMissingTries: 'always' });
  expect(await never.check()).toEqual({
    ok: false,
    code: 'attestation_unavailable',
    recordMs: 15_000,
    attestationMs: 15_000,
  });
  // A try at each second from 0 s to 15 s.
  expect(never.asked.record).toBe(16);
  expect(never.sleeps.every((ms) => ms === 1_000)).toBe(true);
  expect(never.asked.collateral).toHaveLength(0);
});

test('collateral and an approval are fetched once, then come from memory', async () => {
  const memory = createAttestationMemory();
  const first = harness({}, memory);
  expect((await first.check()).ok).toBe(true);
  expect((await first.check()).ok).toBe(true);
  expect(first.asked.record).toBe(2);
  expect(first.asked.collateral).toHaveLength(1);
  expect(first.asked.rpc).toHaveLength(1);
  expect([...memory.collaterals.keys()]).toEqual(['b0c06f000000']);

  // Another route set of the same isolate shares the memory.
  const next = harness({}, memory);
  expect((await next.check()).ok).toBe(true);
  expect(next.asked.collateral).toHaveLength(0);
  expect(next.asked.rpc).toHaveLength(0);

  // A positive answer holds for 10 minutes, so that a removal on chain takes effect.
  next.advance(10 * 60_000);
  expect((await next.check()).ok).toBe(true);
  expect(next.asked.rpc).toHaveLength(1);
  expect(next.asked.collateral).toHaveLength(0);
});

test('a collateral that fails or does not cover the call stays out of memory', async () => {
  const unavailable = harness({ collateralStatus: 503 });
  expect(await unavailable.check()).toMatchObject({
    ok: false,
    code: 'attestation_collateral_unavailable',
  });

  const tampered = harness({
    collateral: {
      ...COLLATERAL,
      tcb_info: COLLATERAL.tcb_info.replace('"UpToDate"', '"OutOfDate"'),
    },
  });
  expect(await tampered.check()).toMatchObject({
    ok: false,
    code: 'attestation_bad_collateral_signature',
  });
  expect(tampered.memory.collaterals.size).toBe(0);

  // Intel's collateral still passes, but its stated window ends before the call.
  const window = { from: '2026-11-01T00:00:00Z', until: '2026-11-10T00:00:00Z' };
  const outside = harness({ window });
  expect((await outside.check()).ok).toBe(true);
  expect((await outside.check()).ok).toBe(true);
  expect(outside.asked.collateral).toHaveLength(2);
  expect(outside.memory.collaterals.size).toBe(0);
});

test('measurements that the contract does not approve, or no answer, refuse and are asked again', async () => {
  const rejected = harness({ approved: false });
  for (let round = 0; round < 2; round += 1) {
    expect(await rejected.check()).toMatchObject({
      ok: false,
      code: 'attestation_measurements_not_approved',
    });
  }
  expect(rejected.asked.rpc).toHaveLength(2);
  expect(rejected.memory.approvals.size).toBe(0);

  expect(await harness({ approved: 'rpc_error' }).check()).toMatchObject({
    ok: false,
    code: 'attestation_measurements_unavailable',
  });
});

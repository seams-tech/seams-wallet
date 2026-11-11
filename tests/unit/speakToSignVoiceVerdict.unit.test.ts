import { expect, test } from '@playwright/test';
import { openSignerD1 } from '../fixtures/signer-d1.mjs';
import {
  borshString,
  concat,
  littleEndian,
  nearTransactionActionsBorsh,
  sha256,
  spokenRequestBorsh,
  spokenRequestDigest,
  spokenTextDigest,
  utf8,
  type SpokenRequest,
} from '@shared/speakToSign/spokenRequest';
import {
  parseCosignerVoiceRefusal,
  voiceVerdictMessage,
  type CosignerVoiceRefusal,
} from '@shared/speakToSign/voiceVerdict';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  checkSigningRequestVoiceVerdict,
  splitVoiceVerdict,
  type SigningRouteVoiceVerdict,
  type SpeakToSignVoiceVerdictCheck,
  type VoiceVerdictLedger,
} from '../../packages/wallet-server/src/router/domains/speakToSign/voiceVerdictAdmission';
import { createD1VoiceVerdictLedger } from '../../packages/wallet-server/src/router/cloudflare/d1/speakToSign/d1VoiceVerdictLedger';
import { isD1DatabaseLike } from '../../packages/wallet-server/src/storage/d1Sql';
import type { D1DatabaseLike } from '../../packages/wallet-server/src/storage/tenantRoute';
import { prepareRouterAbNormalSigningV2 } from '@/core/rpcClients/relayer/routerAbNormalSigning';
import { buildMpcMaterialActivationRefFixture } from './helpers/ecdsaMaterialRef.fixtures';

const NOW_MS = 1_762_700_000_000;
const NEAR = 10n ** 24n;
const OWNER = 'owner.testnet';
const WALLET_ID = 'wallet:voice-verdict';
const MATERIAL = routerAbMpcMaterialActivationRefToWire(
  buildMpcMaterialActivationRefFixture('voice-verdict', WALLET_ID),
);
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// ---------------------------------------------------------------- the verifier and the Wallet

type Verifier = Readonly<{ publicKey: string; sign(verdictJson: string): Promise<string> }>;

async function verifierKey(): Promise<Verifier> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKey: `ed25519:${base58(raw)}`,
    async sign(verdictJson) {
      const message = await voiceVerdictMessage(verdictJson);
      const signature = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, message);
      return Buffer.from(signature).toString('base64');
    },
  };
}

function base58(bytes: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`);
  let out = '';
  while (value > 0n) {
    out = B58[Number(value % 58n)] + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function b64u(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function transfer(amountNear: bigint, overrides: Partial<SpokenRequest> = {}): SpokenRequest {
  return {
    kind: 'account_transfer',
    network: 'testnet',
    owner: OWNER,
    receiver: 'alice.testnet',
    amountYocto: amountNear * NEAR,
    ...overrides,
  } as SpokenRequest;
}

/** A signed verdict v2 for `request`, in the verifier's field order. */
async function signedVerdict(
  verifier: Verifier,
  request: SpokenRequest,
  overrides: Record<string, unknown> = {},
): Promise<{ verdict_json: string; signature_b64: string }> {
  const json = JSON.stringify({
    kind: 'seams_voice_signed_verdict_v2',
    renderer: 'spoken-intent/1',
    verifier: '0.4.0',
    request_digest: b64u(await spokenRequestDigest(spokenRequestBorsh(request))),
    spoken_text_digest: b64u(await spokenTextDigest('spoken words')),
    audio_digest: b64u(new Uint8Array(32).fill(7)),
    outcome: 'accept',
    reason: null,
    policy_rule: null,
    expires_at_ms: NOW_MS + 120_000,
    speaker_score_milli: 655,
    word_margin_milli: 142,
    heard: null,
    ...overrides,
  });
  return { verdict_json: json, signature_b64: await verifier.sign(json) };
}

type Action =
  | { kind: 'transfer'; yocto: bigint }
  | { kind: 'call'; method: string; args: unknown; depositYocto?: bigint };

/** The Borsh of an unsigned NEAR transaction V0, as the Wallet's signer worker builds it. */
function unsignedTransaction(input: {
  signer?: string;
  receiver: string;
  actions: readonly Action[];
}): Uint8Array {
  const actions = input.actions.map((action) =>
    action.kind === 'transfer'
      ? concat([Uint8Array.of(3), littleEndian(action.yocto, 16)])
      : concat([
          Uint8Array.of(2),
          borshString(action.method),
          borshString(JSON.stringify(action.args)),
          littleEndian(30_000_000_000_000n, 8),
          littleEndian(action.depositYocto ?? 0n, 16),
        ]),
  );
  return concat([
    borshString(input.signer ?? OWNER),
    Uint8Array.of(0),
    new Uint8Array(32).fill(1),
    littleEndian(42n, 8),
    borshString(input.receiver),
    new Uint8Array(32).fill(2),
    littleEndian(BigInt(actions.length), 4),
    ...actions,
  ]);
}

/** The prepare request of one NEAR transaction, as `buildRouterAbEd25519NearTransactionPrepareRequestV2`. */
function prepareBody(
  transaction: Uint8Array,
  options: { requestId?: string; network?: string; authorization?: string } = {},
): Record<string, unknown> {
  const borsh = b64u(transaction);
  return {
    scope: {
      request_id: options.requestId ?? 'request-1',
      account_id: WALLET_ID,
      authorization:
        options.authorization === 'operation_step_up'
          ? { kind: 'operation_step_up' }
          : { kind: 'reusable_wallet_session', wallet_session_id: 'session-1' },
      material_activation: MATERIAL,
      signing_worker_id: MATERIAL.signing_worker,
    },
    expires_at_ms: NOW_MS + 60_000,
    display_digest: { bytes: new Array(32).fill(3) },
    intent: {
      kind: 'near_transaction_v1',
      operation_id: 'operation-1',
      operation_fingerprint: 'fingerprint-1',
      near_account_id: OWNER,
      near_network_id: options.network ?? 'testnet',
      transactions: [{ receiver_id: 'alice.testnet', action_fingerprint: 'actions-1' }],
      unsigned_transaction_borsh_b64u: borsh,
    },
    signing_payload: {
      kind: 'near_unsigned_transaction_borsh_v1',
      unsigned_transaction_borsh_b64u: borsh,
      expected_signing_digest_b64u: b64u(new Uint8Array(32)),
    },
  };
}

// ---------------------------------------------------------------- the co-signer

/** How the route authorized the request: an operation step-up, or a Wallet Session. */
type RouteAuthorization =
  | 'operation_step_up'
  | Readonly<{ method: 'passkey' | 'email_otp' | 'voiceid'; createdAtMs: number }>;

/** The parts of the route's authorization result that the check reads. */
function routeAuthorization(
  authorization: RouteAuthorization,
): Parameters<typeof checkSigningRequestVoiceVerdict>[1] {
  if (authorization === 'operation_step_up') {
    return { ok: true, kind: 'operation_step_up', phase: 'prepare' } as never;
  }
  return {
    ok: true,
    kind: 'wallet_session_operation_credential_v1',
    validated: {
      admission: {
        context: {
          authorization: { session: { createdAtMs: authorization.createdAtMs } },
          authMethod: { kind: authorization.method },
        },
      },
    },
  } as never;
}

type Harness = Readonly<{
  /** Runs the check as the Ed25519 prepare route does, after it authorized the session. */
  check(
    body: Record<string, unknown>,
    options?: {
      authorization?: RouteAuthorization;
      phase?: 'prepare' | 'finalize';
      nowMs?: number;
    },
  ): Promise<{ status: number; reason: CosignerVoiceRefusal | null; message?: string }>;
  ledger: VoiceVerdictLedger;
  /** Each warning the check wrote to the server log. */
  warnings: unknown[][];
}>;

let signerDatabase: Awaited<ReturnType<typeof openSignerD1>> | null = null;
let namespaceCount = 0;

test.beforeAll(async () => {
  signerDatabase = await openSignerD1();
});

test.afterAll(async () => {
  await signerDatabase?.close();
});

function database(): D1DatabaseLike {
  const opened = signerDatabase?.database;
  if (!isD1DatabaseLike(opened)) throw new Error('Expected the Miniflare D1 database');
  return opened;
}

function harness(verifier: Verifier, options: { configured?: boolean } = {}): Harness {
  namespaceCount += 1;
  const ledger = createD1VoiceVerdictLedger({
    database: database(),
    namespace: `voice-verdicts-${namespaceCount}`,
  });
  let nowMs = NOW_MS;
  const warnings: unknown[][] = [];
  const voiceVerdicts: SpeakToSignVoiceVerdictCheck = {
    ledger,
    verifiers: {
      testnet: {
        project: 'seams-v1.testnet/voice-verifier',
        publicKey: verifier.publicKey,
        audioKey: '',
      },
      mainnet: null,
    },
    now: () => nowMs,
  };
  return {
    ledger,
    warnings,
    async check(body, checkOptions = {}) {
      nowMs = checkOptions.nowMs ?? NOW_MS;
      const ctx: SigningRouteVoiceVerdict['ctx'] = {
        opts: { speakToSignVoiceVerdicts: options.configured === false ? null : voiceVerdicts },
        logger: { warn: (...args: unknown[]) => void warnings.push(args) },
        service: {
          walletRegistration: {
            async resolveEd25519MaterialActivation(lookup) {
              expect(lookup).toEqual({ walletId: WALLET_ID, materialActivation: MATERIAL });
              return { ok: true, nearAccountId: OWNER } as never;
            },
          },
        },
      };
      const route: SigningRouteVoiceVerdict = {
        ...splitVoiceVerdict({ body }),
        ctx,
        phase: checkOptions.phase ?? 'prepare',
      };
      const response = await checkSigningRequestVoiceVerdict(
        route,
        routeAuthorization(
          checkOptions.authorization ?? { method: 'passkey', createdAtMs: NOW_MS - 3_600_000 },
        ),
      );
      if (!response) return { status: 200, reason: null };
      const refusal = (await response.json()) as Record<string, unknown>;
      expect(refusal.ok).toBe(false);
      expect(refusal.code).toBe('voice_verdict_refused');
      expect(parseCosignerVoiceRefusal(String(refusal.message))).toBe(refusal.reason);
      return {
        status: response.status,
        reason: refusal.reason as CosignerVoiceRefusal,
        message: String(refusal.message),
      };
    },
  };
}

function withVerdict(body: Record<string, unknown>, verdict: unknown): Record<string, unknown> {
  return { ...body, voice_verdict: verdict };
}

const ADMITTED = { status: 200, reason: null };

function refused(reason: CosignerVoiceRefusal) {
  return expect.objectContaining({ reason });
}

// ---------------------------------------------------------------- tests

test('a normal signing request carries no verdict and the co-signer does not check one', async () => {
  const cosigner = harness(await verifierKey(), { configured: false });
  const body = prepareBody(unsignedTransaction({ receiver: 'alice.testnet', actions: [] }));
  expect(await cosigner.check(body)).toEqual(ADMITTED);
  const split = splitVoiceVerdict({ body: withVerdict(body, { verdict_json: 'x' }) });
  expect(split.body).toEqual(body);
  expect(split.voiceVerdict).toEqual({ verdict_json: 'x' });
  expect('voice_verdict' in splitVoiceVerdict({ body }).body).toBe(false);
});

test('an accepted transfer verdict for this transaction, owner and session is admitted', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const tx = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: 2n * NEAR }],
  });
  const verdict = await signedVerdict(verifier, transfer(2n));
  expect(await cosigner.check(withVerdict(prepareBody(tx), verdict))).toEqual(ADMITTED);
  // A retry of the same signing request may use the verdict again.
  expect(await cosigner.check(withVerdict(prepareBody(tx), verdict))).toEqual(ADMITTED);
  expect(cosigner.warnings).toEqual([]);
});

test('each refusal writes one log line with its reason, the wallet and the request', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const tx = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: 11n * NEAR }],
  });
  const verdict = await signedVerdict(verifier, transfer(12n));
  expect(await cosigner.check(withVerdict(prepareBody(tx), verdict))).toEqual(
    refused('request_mismatch'),
  );
  expect(cosigner.warnings).toEqual([
    [
      '[speak-to-sign] co-signer refused a voice verdict',
      {
        reason: 'request_mismatch',
        phase: 'prepare',
        walletId: WALLET_ID,
        requestId: 'request-1',
      },
    ],
  ]);
  // A fault names its source in the log, never in the response.
  const failing = harness(verifier);
  const faultyLedger = failing.ledger as { admit: VoiceVerdictLedger['admit'] };
  faultyLedger.admit = async () => {
    throw new Error('D1 is busy');
  };
  const small = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: NEAR }],
  });
  const response = await failing.check(
    withVerdict(prepareBody(small), await signedVerdict(verifier, transfer(1n))),
  );
  expect(response).toEqual({
    status: 503,
    reason: 'unavailable',
    message: 'Speak-to-Sign verdict refused: unavailable',
  });
  expect(failing.warnings[0]?.[1]).toMatchObject({
    reason: 'unavailable',
    detail: 'ledger: D1 is busy',
  });
});

test('a bad signature, another key or a malformed verdict is refused', async () => {
  const verifier = await verifierKey();
  const other = await verifierKey();
  const cosigner = harness(verifier);
  const tx = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: 2n * NEAR }],
  });
  const body = prepareBody(tx);
  const otherKey = await signedVerdict(other, transfer(2n));
  expect(await cosigner.check(withVerdict(body, otherKey))).toEqual({
    status: 403,
    reason: 'signature_invalid',
    message: 'Speak-to-Sign verdict refused: signature_invalid',
  });
  const valid = await signedVerdict(verifier, transfer(2n));
  const changed = valid.verdict_json.replace(
    '"speaker_score_milli":655',
    '"speaker_score_milli":999',
  );
  expect(await cosigner.check(withVerdict(body, { ...valid, verdict_json: changed }))).toEqual(
    refused('signature_invalid'),
  );
  expect(await cosigner.check(withVerdict(body, { ...valid, signature_b64: 'AAAA' }))).toEqual(
    refused('signature_invalid'),
  );
  for (const malformed of [
    null,
    'verdict',
    { verdict_json: valid.verdict_json },
    { ...valid, public_key: verifier.publicKey },
    { verdict_json: '{', signature_b64: valid.signature_b64 },
  ]) {
    expect(await cosigner.check(withVerdict(body, malformed))).toEqual(refused('verdict_invalid'));
  }
  // A refusal of the verifier signs nothing, so it approves nothing.
  const refusal = await signedVerdict(verifier, transfer(2n), {
    outcome: 'refuse',
    reason: 'words',
  });
  expect(await cosigner.check(withVerdict(body, refusal))).toEqual(refused('verdict_invalid'));
  // A network without a pinned key.
  expect(await cosigner.check(withVerdict(prepareBody(tx, { network: 'mainnet' }), valid))).toEqual(
    refused('network_unsupported'),
  );
});

test('an expired verdict, or one that expires too far ahead, is refused', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const body = prepareBody(
    unsignedTransaction({
      receiver: 'alice.testnet',
      actions: [{ kind: 'transfer', yocto: NEAR }],
    }),
  );
  const verdict = await signedVerdict(verifier, transfer(1n));
  expect(await cosigner.check(withVerdict(body, verdict), { nowMs: NOW_MS + 120_000 })).toEqual(
    refused('expired'),
  );
  const farAhead = await signedVerdict(verifier, transfer(1n), { expires_at_ms: NOW_MS + 151_000 });
  expect(await cosigner.check(withVerdict(body, farAhead))).toEqual(refused('expired'));
  expect(await cosigner.check(withVerdict(body, verdict), { nowMs: NOW_MS + 119_000 })).toEqual(
    ADMITTED,
  );
});

test('a transaction that is not the verdict request is refused', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const verdict = await signedVerdict(verifier, transfer(2n));
  const transactions: Array<[string, Uint8Array]> = [
    [
      'another receiver',
      unsignedTransaction({
        receiver: 'mallory.testnet',
        actions: [{ kind: 'transfer', yocto: 2n * NEAR }],
      }),
    ],
    [
      'another amount',
      unsignedTransaction({
        receiver: 'alice.testnet',
        actions: [{ kind: 'transfer', yocto: 3n * NEAR }],
      }),
    ],
    [
      'a second action',
      unsignedTransaction({
        receiver: 'alice.testnet',
        actions: [
          { kind: 'transfer', yocto: 2n * NEAR },
          { kind: 'transfer', yocto: 2n * NEAR },
        ],
      }),
    ],
    [
      'a call instead of the transfer',
      unsignedTransaction({
        receiver: 'alice.testnet',
        actions: [{ kind: 'call', method: 'ft_transfer', args: {}, depositYocto: 1n }],
      }),
    ],
    [
      'bytes after the transaction',
      concat([
        unsignedTransaction({
          receiver: 'alice.testnet',
          actions: [{ kind: 'transfer', yocto: 2n * NEAR }],
        }),
        Uint8Array.of(0),
      ]),
    ],
  ];
  for (const [name, tx] of transactions) {
    expect(await cosigner.check(withVerdict(prepareBody(tx), verdict)), name).toEqual({
      status: 403,
      reason: 'request_mismatch',
      message: 'Speak-to-Sign verdict refused: request_mismatch',
    });
  }
  // The intent and the signed payload must hold the same transaction.
  const tx = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: 2n * NEAR }],
  });
  const body = prepareBody(tx);
  const intent = body.intent as Record<string, unknown>;
  const split = {
    ...body,
    intent: { ...intent, unsigned_transaction_borsh_b64u: b64u(transactions[0][1]) },
  };
  expect(await cosigner.check(withVerdict(split, verdict))).toEqual(refused('request_mismatch'));
});

test('a transaction of another owner than the session account is refused', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  // The verdict and the transaction both name bob, but the session signs for owner.testnet.
  const verdict = await signedVerdict(verifier, transfer(2n, { owner: 'bob.testnet' }));
  const tx = unsignedTransaction({
    signer: 'bob.testnet',
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: 2n * NEAR }],
  });
  expect(await cosigner.check(withVerdict(prepareBody(tx), verdict))).toEqual({
    status: 403,
    reason: 'owner_mismatch',
    message: 'Speak-to-Sign verdict refused: owner_mismatch',
  });
  // A verdict of another owner for the session's own transaction does not match it.
  const own = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: 2n * NEAR }],
  });
  expect(await cosigner.check(withVerdict(prepareBody(own), verdict))).toEqual(
    refused('request_mismatch'),
  );
});

test('a verdict that the co-signer accepted is refused for another signing request', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const tx = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: 2n * NEAR }],
  });
  const verdict = await signedVerdict(verifier, transfer(2n));
  expect(await cosigner.check(withVerdict(prepareBody(tx), verdict))).toEqual(ADMITTED);
  expect(
    await cosigner.check(withVerdict(prepareBody(tx, { requestId: 'request-2' }), verdict)),
  ).toEqual({ status: 409, reason: 'reused', message: 'Speak-to-Sign verdict refused: reused' });
  expect(
    await cosigner.check(withVerdict(prepareBody(tx, { requestId: 'request-1' }), verdict)),
  ).toEqual(ADMITTED);
});

test('the co-signer sets no amount limit on a voice-only payment', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  for (const [near, requestId] of [
    [11n, 'first'],
    [500n, 'second'],
    [1_000_000n, 'third'],
  ] as const) {
    const tx = unsignedTransaction({
      receiver: 'alice.testnet',
      actions: [{ kind: 'transfer', yocto: near * NEAR }],
    });
    const verdict = await signedVerdict(verifier, transfer(near));
    expect(await cosigner.check(withVerdict(prepareBody(tx, { requestId }), verdict))).toEqual(
      ADMITTED,
    );
  }
});

test('a step_up verdict needs a fresh approval of the operation', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const stepUp = { outcome: 'step_up', policy_rule: 'stub_voice_amount_above_10_near' };
  const tx = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: 25n * NEAR }],
  });
  const verdict = await signedVerdict(verifier, transfer(25n), stepUp);
  expect(await cosigner.check(withVerdict(prepareBody(tx), verdict))).toEqual({
    status: 403,
    reason: 'step_up_required',
    message: 'Speak-to-Sign verdict refused: step_up_required',
  });
  expect(
    await cosigner.check(
      withVerdict(
        prepareBody(tx, { requestId: 'fresh', authorization: 'operation_step_up' }),
        verdict,
      ),
      { authorization: 'operation_step_up' },
    ),
  ).toEqual(ADMITTED);
  // The voice alone has no amount limit of its own.
  const tenNear = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: 10n * NEAR }],
  });
  for (const [requestId, score] of [
    ['voice-1', 801],
    ['voice-2', 802],
  ] as const) {
    const voice = await signedVerdict(verifier, transfer(10n), { speaker_score_milli: score });
    expect(await cosigner.check(withVerdict(prepareBody(tenNear, { requestId }), voice))).toEqual(
      ADMITTED,
    );
  }
});

test('a step_up verdict is admitted after a new VoiceID unlock that came after the verdict', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  // The verifier signed this verdict at NOW_MS: it expires 120 s later.
  const verdict = await signedVerdict(verifier, transfer(25n), {
    outcome: 'step_up',
    policy_rule: 'stub_voice_amount_above_10_near',
  });
  const tx = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: 25n * NEAR }],
  });
  const attempt = async (requestId: string, authorization: RouteAuthorization) =>
    await cosigner.check(withVerdict(prepareBody(tx, { requestId }), verdict), {
      authorization,
      nowMs: NOW_MS + 6_000,
    });
  // A VoiceID session from before the verdict is not a fresh approval.
  expect(await attempt('old-unlock', { method: 'voiceid', createdAtMs: NOW_MS - 1 })).toEqual(
    refused('step_up_required'),
  );
  // Only a VoiceID unlock counts: other methods use an operation step-up.
  expect(await attempt('new-passkey', { method: 'passkey', createdAtMs: NOW_MS + 4_000 })).toEqual(
    refused('step_up_required'),
  );
  expect(await attempt('new-otp', { method: 'email_otp', createdAtMs: NOW_MS + 4_000 })).toEqual(
    refused('step_up_required'),
  );
  expect(await attempt('new-unlock', { method: 'voiceid', createdAtMs: NOW_MS + 4_000 })).toEqual(
    ADMITTED,
  );
});

test('spoken notes and ratings are admitted only as one add_note or rate_note call with no deposit', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const contract = 'notes.seams-v1.testnet';
  const text = 'The bridge reopened on Monday after repairs.';
  const summary = 'The bridge is open again.';
  const note: SpokenRequest = {
    kind: 'community_note',
    network: 'testnet',
    owner: OWNER,
    contract,
    postId: 7n,
    noteSha256: await sha256(utf8(text)),
    summary,
  };
  const noteVerdict = await signedVerdict(verifier, note);
  const addNote = (args: unknown, depositYocto = 0n) =>
    prepareBody(
      unsignedTransaction({
        receiver: contract,
        actions: [{ kind: 'call', method: 'add_note', args, depositYocto }],
      }),
      { requestId: `note-${JSON.stringify(args).length}-${depositYocto}` },
    );
  expect(
    await cosigner.check(withVerdict(addNote({ post_id: 7, text, summary }, 1n), noteVerdict)),
  ).toEqual(refused('request_mismatch'));
  expect(
    await cosigner.check(
      withVerdict(addNote({ post_id: 7, text: `${text}!`, summary }), noteVerdict),
    ),
  ).toEqual(refused('request_mismatch'));
  expect(
    await cosigner.check(
      withVerdict(addNote({ post_id: 7, text, summary, extra: 1 }), noteVerdict),
    ),
  ).toEqual(refused('request_mismatch'));
  expect(
    await cosigner.check(withVerdict(addNote({ post_id: 7, text, summary }), noteVerdict)),
  ).toEqual(ADMITTED);

  const rating: SpokenRequest = {
    kind: 'note_rating',
    network: 'testnet',
    owner: OWNER,
    contract,
    noteId: 3n,
    rating: 'somewhat_helpful',
  };
  const ratingVerdict = await signedVerdict(verifier, rating);
  const rateNote = (args: unknown) =>
    prepareBody(
      unsignedTransaction({
        receiver: contract,
        actions: [{ kind: 'call', method: 'rate_note', args }],
      }),
      { requestId: `rating-${JSON.stringify(args)}` },
    );
  expect(
    await cosigner.check(withVerdict(rateNote({ note_id: 3, rating: 'helpful' }), ratingVerdict)),
  ).toEqual(refused('request_mismatch'));
  expect(
    await cosigner.check(
      withVerdict(rateNote({ note_id: 3, rating: 'somewhat_helpful' }), ratingVerdict),
    ),
  ).toEqual(ADMITTED);
});

test('a spoken merge approval is admitted only as one approve_merge call for its repo and commit', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const contract = 'merges.seams-v1.testnet';
  const repo = 'seams-tech/seams-wallet';
  const headCommit = '0123456789abcdef0123456789abcdef01234567';
  const merge: SpokenRequest = {
    kind: 'merge_approval',
    network: 'testnet',
    owner: OWNER,
    contract,
    repoSha256: await sha256(utf8(repo)),
    pullRequest: 42n,
    base: 'main',
    headCommit: Uint8Array.from(headCommit.match(/../g)!, (pair) => Number.parseInt(pair, 16)),
  };
  const mergeVerdict = await signedVerdict(verifier, merge);
  const approve = (args: unknown, depositYocto = 0n) =>
    prepareBody(
      unsignedTransaction({
        receiver: contract,
        actions: [{ kind: 'call', method: 'approve_merge', args, depositYocto }],
      }),
      { requestId: `merge-${JSON.stringify(args)}-${depositYocto}` },
    );
  const args = { repo, pull_request: 42, base: 'main', head_commit: headCommit };
  for (const other of [
    { ...args, head_commit: headCommit.replace(/^0/, '1') },
    { ...args, repo: 'seams-tech/other' },
    { ...args, pull_request: 43 },
    { ...args, base: 'master' },
    { ...args, extra: 1 },
  ]) {
    expect(await cosigner.check(withVerdict(approve(other), mergeVerdict)), JSON.stringify(other)).toEqual(
      refused('request_mismatch'),
    );
  }
  expect(await cosigner.check(withVerdict(approve(args, 1n), mergeVerdict))).toEqual(
    refused('request_mismatch'),
  );
  expect(await cosigner.check(withVerdict(approve(args), mergeVerdict))).toEqual(ADMITTED);
});

test('a spoken bet is admitted only as one ft_transfer_call of the USDC contract with its verdict', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const usdc = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af';
  const market = 'pm-notes.testnet';
  const bet: SpokenRequest = {
    kind: 'market_bet',
    network: 'testnet',
    owner: OWNER,
    market,
    token: usdc,
    marketId: 9n,
    outcome: 'yes',
    amountUnits: 500_000n,
  };
  const verdict = await signedVerdict(verifier, bet);
  const msg = { action: 'bet', market_id: 9, outcome: 'yes', ...verdict };
  const args = { receiver_id: market, amount: '500000', msg: JSON.stringify(msg) };
  let count = 0;
  const call = (
    callArgs: unknown,
    options: { depositYocto?: bigint; receiver?: string; method?: string } = {},
  ) => {
    count += 1;
    return prepareBody(
      unsignedTransaction({
        receiver: options.receiver ?? usdc,
        actions: [
          {
            kind: 'call',
            method: options.method ?? 'ft_transfer_call',
            args: callArgs,
            depositYocto: options.depositYocto ?? 1n,
          },
        ],
      }),
      { requestId: `bet-${count}` },
    );
  };
  const withMsg = (other: Record<string, unknown>) => ({ ...args, msg: JSON.stringify(other) });
  for (const other of [
    { ...args, amount: '5000000' },
    { ...args, amount: '0500000' },
    { ...args, amount: 500000 },
    { ...args, receiver_id: 'other-market.testnet' },
    { ...args, memo: 'bet' },
    { ...args, msg: 'not json' },
    withMsg({ ...msg, outcome: 'no' }),
    withMsg({ ...msg, market_id: 8 }),
    withMsg({ ...msg, action: 'claim' }),
    withMsg({ ...msg, extra: 1 }),
    withMsg({ action: 'bet', market_id: 9, outcome: 'yes' }),
  ]) {
    expect(await cosigner.check(withVerdict(call(other), verdict)), JSON.stringify(other)).toEqual(
      refused('request_mismatch'),
    );
  }
  // NEP-141 takes exactly 1 yoctoNEAR; a plain ft_transfer is not a bet.
  for (const options of [{ depositYocto: 0n }, { depositYocto: 2n }, { method: 'ft_transfer' }]) {
    expect(await cosigner.check(withVerdict(call(args, options), verdict))).toEqual(
      refused('request_mismatch'),
    );
  }
  // Another token can have other decimals, even when the verdict names that token.
  const otherToken = await signedVerdict(verifier, { ...bet, token: 'usdc.testnet' });
  expect(
    await cosigner.check(
      withVerdict(
        call({ ...args, msg: JSON.stringify({ ...msg, ...otherToken }) }, { receiver: 'usdc.testnet' }),
        otherToken,
      ),
    ),
  ).toEqual(refused('request_mismatch'));
  expect(await cosigner.check(withVerdict(call(args), verdict))).toEqual(ADMITTED);
  // The verdict is used once.
  expect(await cosigner.check(withVerdict(call(args), verdict))).toEqual(refused('reused'));
});

test('a bet has no voice limit, and a bet verdict is a whole number of cents', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const usdc = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af';
  const prepared = async (
    amountUnits: bigint,
    requestId: string,
    stepUp = false,
    callAmount = amountUnits.toString(),
  ) => {
    const verdict = await signedVerdict(verifier, {
      kind: 'market_bet',
      network: 'testnet',
      owner: OWNER,
      market: 'pm-notes.testnet',
      token: usdc,
      marketId: 12n,
      outcome: 'no',
      amountUnits,
    });
    const msg = JSON.stringify({ action: 'bet', market_id: 12, outcome: 'no', ...verdict });
    const tx = unsignedTransaction({
      receiver: usdc,
      actions: [
        {
          kind: 'call',
          method: 'ft_transfer_call',
          args: { receiver_id: 'pm-notes.testnet', amount: callAmount, msg },
          depositYocto: 1n,
        },
      ],
    });
    const body = prepareBody(tx, {
      requestId,
      ...(stepUp ? { authorization: 'operation_step_up' } : {}),
    });
    return await cosigner.check(
      withVerdict(body, verdict),
      stepUp ? { authorization: 'operation_step_up' } : {},
    );
  };
  expect(await prepared(10_000_000n, 'ten')).toEqual(ADMITTED);
  expect(await prepared(10n ** 12n, 'largest')).toEqual(ADMITTED);
  expect(await prepared(10_010_000n, 'with-fresh-approval', true)).toEqual(ADMITTED);
  expect(await prepared(500_001n, 'not-cents')).toEqual(refused('request_mismatch'));
  expect(await prepared(500_000n, 'not-u128', false, (2n ** 128n).toString())).toEqual(
    refused('request_mismatch'),
  );
});

test('a general spoken transaction is admitted for its exact actions, receiver and summary', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const summary = 'Sign the guest book and tip one near.';
  const actions = [
    { kind: 'call', method: 'add_message', args: { text: 'hello' } },
    { kind: 'transfer', yocto: NEAR },
  ] as const;
  const tx = unsignedTransaction({ receiver: 'guest-book.testnet', actions });
  const request = async (transaction: Uint8Array, said = summary): Promise<SpokenRequest> => ({
    kind: 'transaction',
    network: 'testnet',
    owner: OWNER,
    receiver: 'guest-book.testnet',
    actionsSha256: await sha256(new Uint8Array(nearTransactionActionsBorsh(transaction))),
    summary: said,
  });
  const verdict = await signedVerdict(verifier, await request(tx));
  let count = 0;
  const attempt = async (transaction: Uint8Array, voice: unknown) => {
    count += 1;
    return await cosigner.check(
      withVerdict(prepareBody(transaction, { requestId: `general-${count}` }), voice),
    );
  };
  // Without the summary, the co-signer looks for a typed request and finds none.
  expect(await attempt(tx, verdict)).toEqual(refused('request_mismatch'));
  expect(await attempt(tx, { ...verdict, summary: 'Sign the guest book.' })).toEqual(
    refused('request_mismatch'),
  );
  expect(await attempt(tx, { ...verdict, summary: 7 })).toEqual(refused('verdict_invalid'));
  expect(await attempt(tx, { ...verdict, summary, extra: 1 })).toEqual(refused('verdict_invalid'));
  // Other actions, another order or another receiver are another transaction.
  for (const other of [
    unsignedTransaction({ receiver: 'guest-book.testnet', actions: [actions[1], actions[0]] }),
    unsignedTransaction({ receiver: 'guest-book.testnet', actions: [actions[0]] }),
    unsignedTransaction({
      receiver: 'guest-book.testnet',
      actions: [actions[0], { kind: 'transfer', yocto: 2n * NEAR }],
    }),
    unsignedTransaction({ receiver: 'other.testnet', actions }),
  ]) {
    expect(await attempt(other, { ...verdict, summary })).toEqual(refused('request_mismatch'));
  }
  // A verdict of a typed transfer does not pass as a general transaction, and the reverse.
  const transferTx = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: NEAR }],
  });
  const transferVerdict = await signedVerdict(verifier, transfer(1n));
  expect(await attempt(transferTx, { ...transferVerdict, summary })).toEqual(
    refused('request_mismatch'),
  );
  expect(await attempt(tx, { ...verdict, summary })).toEqual(ADMITTED);
  expect(await attempt(tx, { ...verdict, summary })).toEqual(refused('reused'));
});

test('a spoken delegate action is admitted as the general transaction of its sender', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const summary = 'Sign the guest book.';
  // One `add_message` call, as Borsh of `Vec<Action>`.
  const actions = concat([
    littleEndian(1n, 4),
    Uint8Array.of(2),
    borshString('add_message'),
    borshString('{"text":"hello"}'),
    littleEndian(30_000_000_000_000n, 8),
    littleEndian(0n, 16),
  ]);
  const delegateBytes = (sender = OWNER, receiver = 'guest-book.testnet', list = actions) =>
    concat([
      Uint8Array.of(0x6e, 0x01, 0x00, 0x40),
      borshString(sender),
      borshString(receiver),
      list,
      littleEndian(77n, 8),
      littleEndian(1_234_567n, 8),
      Uint8Array.of(0),
      new Uint8Array(32).fill(4),
    ]);
  const request: SpokenRequest = {
    kind: 'transaction',
    network: 'testnet',
    owner: OWNER,
    receiver: 'guest-book.testnet',
    actionsSha256: await sha256(actions),
    summary,
  };
  const verdict = await signedVerdict(verifier, request);
  let count = 0;
  const attempt = async (bytes: Uint8Array<ArrayBuffer>, voice: unknown, digest?: Uint8Array) => {
    count += 1;
    const body = prepareBody(new Uint8Array(0), { requestId: `delegate-${count}` });
    return await cosigner.check(
      withVerdict(
        {
          ...body,
          intent: { kind: 'near_delegate_action_v1', near_network_id: 'testnet' },
          signing_payload: {
            kind: 'near_delegate_action_v1',
            canonical_delegate_borsh_b64u: b64u(bytes),
            expected_signing_digest_b64u: b64u(digest ?? (await sha256(bytes))),
          },
        },
        voice,
      ),
    );
  };
  const good = delegateBytes();
  // A delegate action is a general transaction: it always needs the summary.
  expect(await attempt(good, verdict)).toEqual(refused('request_mismatch'));
  expect(await attempt(delegateBytes(OWNER, 'other.testnet'), { ...verdict, summary })).toEqual(
    refused('request_mismatch'),
  );
  const otherActions = concat([actions.subarray(0, actions.length - 1), Uint8Array.of(1)]);
  expect(
    await attempt(delegateBytes(OWNER, 'guest-book.testnet', otherActions), { ...verdict, summary }),
  ).toEqual(refused('request_mismatch'));
  expect(await attempt(delegateBytes('other.testnet'), { ...verdict, summary })).toEqual(
    refused('owner_mismatch'),
  );
  // The signers sign `expected_signing_digest`: it must be the SHA-256 of the delegate bytes.
  expect(await attempt(good, { ...verdict, summary }, new Uint8Array(32).fill(1))).toEqual(
    refused('request_mismatch'),
  );
  // Bytes without the NEP-366 tag are not a delegate action.
  const untagged = concat([Uint8Array.of(0x6e, 0x01, 0x00, 0x41), good.subarray(4)]);
  expect(await attempt(untagged, { ...verdict, summary })).toEqual(refused('request_mismatch'));

  expect(await attempt(good, { ...verdict, summary })).toEqual(ADMITTED);
  // The verdict is used once, as a delegate action or as a transaction.
  const direct = unsignedTransaction({
    receiver: 'guest-book.testnet',
    actions: [{ kind: 'call', method: 'add_message', args: { text: 'hello' } }],
  });
  expect(
    await cosigner.check(
      withVerdict(prepareBody(direct, { requestId: 'direct-after' }), { ...verdict, summary }),
    ),
  ).toEqual(refused('reused'));
});

test('a spoken NEP-413 message is admitted for its exact bytes and summary only', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const summary = 'Log in to the example app';
  // The NEP-413 tag, then the Borsh of the message, the nonce, the recipient and no callback.
  const canonical = concat([
    Uint8Array.of(0x9d, 0x01, 0x00, 0x80),
    borshString('Log in to example.app'),
    new Uint8Array(32).fill(5),
    borshString('example.app'),
    Uint8Array.of(0),
  ]);
  const digest = await sha256(canonical);
  const request = (overrides: Partial<SpokenRequest> = {}): SpokenRequest =>
    ({
      kind: 'signed_message',
      network: 'testnet',
      owner: OWNER,
      payloadSha256: digest,
      summary,
      ...overrides,
    }) as SpokenRequest;
  let count = 0;
  const messageBody = (bytes: Uint8Array, expectedDigest: Uint8Array): Record<string, unknown> => {
    count += 1;
    const body = prepareBody(new Uint8Array(0), { requestId: `message-${count}` });
    return {
      ...body,
      intent: {
        kind: 'nep413_v1',
        operation_id: 'operation-1',
        operation_fingerprint: 'fingerprint-1',
        near_account_id: OWNER,
        near_network_id: 'testnet',
        recipient: 'example.app',
        message: 'Log in to example.app',
        nonce_b64u: b64u(new Uint8Array(32).fill(5)),
      },
      signing_payload: {
        kind: 'nep413_message_v1',
        canonical_message_b64u: b64u(bytes),
        expected_signing_digest_b64u: b64u(expectedDigest),
      },
    };
  };
  const verdict = await signedVerdict(verifier, request());
  const attempt = async (voice: unknown, bytes = canonical, expected = digest) =>
    await cosigner.check(withVerdict(messageBody(bytes, expected), voice));

  // A message always needs its summary beside the verdict.
  expect(await attempt(verdict)).toEqual(refused('request_mismatch'));
  expect(await attempt({ ...verdict, summary: 'Log in to another app' })).toEqual(
    refused('request_mismatch'),
  );
  // Other bytes are another message.
  const other = concat([canonical.subarray(0, canonical.length - 1), Uint8Array.of(1, 0, 0, 0, 0)]);
  expect(await attempt({ ...verdict, summary }, other, await sha256(new Uint8Array(other)))).toEqual(
    refused('request_mismatch'),
  );
  // The signers sign `expected_signing_digest`: it must be the SHA-256 of the message bytes.
  expect(await attempt({ ...verdict, summary }, canonical, new Uint8Array(32).fill(1))).toEqual(
    refused('request_mismatch'),
  );
  // Bytes without the NEP-413 tag could be a transaction, so no message verdict signs them.
  const transactionBytes = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: NEAR }],
  });
  const transactionDigest = await sha256(new Uint8Array(transactionBytes));
  const disguised = await signedVerdict(verifier, request({ payloadSha256: transactionDigest }));
  expect(
    await attempt({ ...disguised, summary }, new Uint8Array(transactionBytes), transactionDigest),
  ).toEqual(refused('request_mismatch'));
  // A verdict of another owner's message does not match the session account.
  const foreign = await signedVerdict(verifier, request({ owner: 'other.testnet' }));
  expect(await attempt({ ...foreign, summary })).toEqual(refused('request_mismatch'));

  expect(await attempt({ ...verdict, summary })).toEqual(ADMITTED);
  expect(await attempt({ ...verdict, summary })).toEqual(refused('reused'));
});

test('a verdict on the second round, or without a configured check, is refused', async () => {
  const verifier = await verifierKey();
  const tx = unsignedTransaction({
    receiver: 'alice.testnet',
    actions: [{ kind: 'transfer', yocto: NEAR }],
  });
  const verdict = await signedVerdict(verifier, transfer(1n));
  expect(
    await harness(verifier).check(withVerdict(prepareBody(tx), verdict), { phase: 'finalize' }),
  ).toEqual(refused('verdict_invalid'));
  expect(
    await harness(verifier, { configured: false }).check(withVerdict(prepareBody(tx), verdict)),
  ).toEqual({
    status: 503,
    reason: 'unavailable',
    message: 'Speak-to-Sign verdict refused: unavailable',
  });
});

test('the D1 ledger records a verdict once and deletes expired records', async () => {
  namespaceCount += 1;
  const ledgerNamespace = namespaceCount;
  const ledger = createD1VoiceVerdictLedger({
    database: database(),
    namespace: `voice-ledger-${ledgerNamespace}`,
  });
  const record = (
    verdictId: string,
    requestId: string,
    acceptedAtMs = NOW_MS,
  ) =>
    ledger.admit({
      walletId: WALLET_ID,
      verdictId,
      requestId,
      acceptedAtMs,
      expiresAtMs: acceptedAtMs + 120_000,
    });
  expect(await record('v1', 'r1')).toBe('admitted');
  expect(await record('v1', 'r1')).toBe('replayed');
  expect(await record('v1', 'r2')).toBe('reused');
  // Two requests at once with one verdict: only one gets it.
  const raced = await Promise.all([record('v2', 'r3'), record('v2', 'r4')]);
  expect(raced.sort()).toEqual(['admitted', 'reused']);
  expect(await record('v3', 'r5')).toBe('admitted');
  const rows = async () =>
    (
      await database()
        .prepare(
          'SELECT verdict_id FROM speak_to_sign_voice_verdicts WHERE namespace = ?1 ORDER BY verdict_id',
        )
        .bind(`voice-ledger-${ledgerNamespace}`)
        .all<{ verdict_id: string }>()
    ).results?.map((row) => row.verdict_id);
  expect(await rows()).toEqual(['v1', 'v2', 'v3']);
  // After the verdicts expired, the next admission deletes the wallet's records.
  expect(await record('v5', 'r6', NOW_MS + 120_000)).toBe('admitted');
  expect(await rows()).toEqual(['v5']);
});

test('the Wallet sends the verdict beside the prepare request and reads the typed refusal', async () => {
  const bodies: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: Parameters<typeof fetch>[0]) => {
    bodies.push(JSON.parse(await (input as Request).text()));
    return Response.json(
      {
        ok: false,
        code: 'voice_verdict_refused',
        reason: 'reused',
        message: 'Speak-to-Sign verdict refused: reused',
      },
      { status: 409 },
    );
  };
  const request = { scope: { request_id: 'r' } } as unknown as Parameters<
    typeof prepareRouterAbNormalSigningV2
  >[0]['request'];
  const credential = {
    kind: 'wallet_session_opaque' as const,
    home: { kind: 'direct' as const },
    walletSessionToken: `wst_${'A'.repeat(43)}`,
  };
  try {
    const error = await prepareRouterAbNormalSigningV2({
      relayServerUrl: 'https://relay.example.test',
      credential,
      request,
      voiceVerdict: { verdictJson: '{"kind":"v"}', signatureB64: 'c2ln' },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(parseCosignerVoiceRefusal((error as Error).message)).toBe('reused');
    await prepareRouterAbNormalSigningV2({
      relayServerUrl: 'https://relay.example.test',
      credential,
      request,
    }).catch(() => null);
  } finally {
    globalThis.fetch = originalFetch;
  }
  expect(bodies).toEqual([
    { ...request, voice_verdict: { verdict_json: '{"kind":"v"}', signature_b64: 'c2ln' } },
    request,
  ]);
});

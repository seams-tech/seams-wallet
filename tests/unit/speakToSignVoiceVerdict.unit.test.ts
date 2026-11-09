import { expect, test } from '@playwright/test';
import { openSignerD1 } from '../fixtures/signer-d1.mjs';
import {
  borshString,
  concat,
  littleEndian,
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

type Harness = Readonly<{
  /** Runs the check as the Ed25519 prepare route does, after it authorized the session. */
  check(
    body: Record<string, unknown>,
    options?: { authorizationKind?: string; phase?: 'prepare' | 'finalize'; nowMs?: number },
  ): Promise<{ status: number; reason: CosignerVoiceRefusal | null; message?: string }>;
  ledger: VoiceVerdictLedger;
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
  const voiceVerdicts: SpeakToSignVoiceVerdictCheck = {
    ledger,
    verifiers: {
      testnet: { project: 'seams-v1.testnet/voice-verifier', publicKey: verifier.publicKey },
      mainnet: null,
    },
    now: () => nowMs,
  };
  return {
    ledger,
    async check(body, checkOptions = {}) {
      nowMs = checkOptions.nowMs ?? NOW_MS;
      const ctx: SigningRouteVoiceVerdict['ctx'] = {
        opts: { speakToSignVoiceVerdicts: options.configured === false ? null : voiceVerdicts },
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
        checkOptions.authorizationKind ?? 'wallet_session_operation_credential_v1',
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

test('voice-only payments stop at 10 NEAR each and 20 NEAR in 24 hours', async () => {
  const verifier = await verifierKey();
  const cosigner = harness(verifier);
  const pay = async (near: bigint, requestId: string, nowMs = NOW_MS, extra = {}) => {
    const tx = unsignedTransaction({
      receiver: 'alice.testnet',
      actions: [{ kind: 'transfer', yocto: near * NEAR }],
    });
    const verdict = await signedVerdict(verifier, transfer(near), {
      expires_at_ms: nowMs + 120_000,
      speaker_score_milli: 600 + Number(near),
      ...extra,
    });
    return await cosigner.check(withVerdict(prepareBody(tx, { requestId }), verdict), { nowMs });
  };
  expect(await pay(11n, 'over-each')).toEqual({
    status: 403,
    reason: 'over_payment_limit',
    message: 'Speak-to-Sign verdict refused: over_payment_limit',
  });
  expect(await pay(10n, 'first')).toEqual(ADMITTED);
  expect(await pay(8n, 'second')).toEqual(ADMITTED);
  expect(await pay(3n, 'third')).toEqual({
    status: 403,
    reason: 'over_daily_limit',
    message: 'Speak-to-Sign verdict refused: over_daily_limit',
  });
  expect(await pay(2n, 'fourth')).toEqual(ADMITTED);
  // Refused payments do not count. After 24 hours, the earlier payments no longer count.
  expect(await pay(1n, 'fifth')).toEqual(refused('over_daily_limit'));
  expect(await pay(9n, 'next-day', NOW_MS + 86_400_001)).toEqual(ADMITTED);
});

test('a step_up verdict needs a fresh approval of the operation, and then the voice limits do not apply', async () => {
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
      { authorizationKind: 'operation_step_up' },
    ),
  ).toEqual(ADMITTED);
  // The 25 NEAR with a fresh approval leaves the whole voice-only day free.
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

test('the D1 ledger records a verdict once and sums voice amounts in one statement', async () => {
  namespaceCount += 1;
  const ledger = createD1VoiceVerdictLedger({
    database: database(),
    namespace: `voice-ledger-${namespaceCount}`,
  });
  const record = (
    verdictId: string,
    requestId: string,
    voiceHundredths: number,
    acceptedAtMs = NOW_MS,
  ) =>
    ledger.admit({
      walletId: WALLET_ID,
      verdictId,
      requestId,
      voiceHundredths,
      acceptedAtMs,
      expiresAtMs: acceptedAtMs + 120_000,
      windowStartMs: acceptedAtMs - 86_400_000,
      limitHundredths: 2_000,
    });
  expect(await record('v1', 'r1', 1_500)).toBe('admitted');
  expect(await record('v1', 'r1', 1_500)).toBe('replayed');
  expect(await record('v1', 'r2', 1_500)).toBe('reused');
  // Two requests at once: only one fits the remaining 5 NEAR.
  const raced = await Promise.all([record('v2', 'r3', 400), record('v3', 'r4', 400)]);
  expect(raced.sort()).toEqual(['admitted', 'over_daily_limit']);
  // An approval that moves no voice-only value always fits.
  expect(await record('v4', 'r5', 0)).toBe('admitted');
  expect(await record('v5', 'r6', 500, NOW_MS + 86_400_001)).toBe('admitted');
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

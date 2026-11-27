import { expect, test } from '@playwright/test';
import { WALLET_SESSION_SEAL_BASE_PATH } from '@shared/utils/signingSessionSeal';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import {
  createSigningSessionSealEvaluator,
  warmSigningSessionSealRuntime,
} from '../../packages/mpc-wallet-server/src/threshold/session/signingSessionSeal/crypto/oprf';
import { createSigningSessionSealService } from '../../packages/mpc-wallet-server/src/threshold/session/signingSessionSeal/service';
import { parseSigningSessionSealEvaluateBody } from '../../packages/mpc-wallet-server/src/threshold/session/signingSessionSeal/transport/shared';
import {
  createEmailOtpEd25519WarmSeal,
  type EmailOtpEd25519WarmSealRecord,
  type EmailOtpEd25519WarmSealStore,
} from '@/core/signingEngine/workerManager/workers/email-otp/ed25519WarmSeal';

const relayUrl = 'https://gateway.test';
const walletId = 'wallet-a';
const thresholdSessionId = 'ed25519-threshold-session-a';
const enrollment = {
  enrollmentId: 'email-otp-device-enrollment-v1:wallet-a:s1',
  enrollmentSealKeyVersion: 'email-otp-seal-v1',
};
const factorSecret32 = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

/** One live Wallet Session that the fake Gateway admits for one Ed25519 threshold session. */
type AdmittedSession = {
  readonly walletId: string;
  readonly thresholdSessionId: string;
  expiresAtMs: number;
};

function credential(token: string, walletSessionId: string): WalletSessionOperationCredentialV1 {
  return {
    kind: 'opaque_wallet_session_operation_credential_v1',
    token,
    walletSessionId,
    home: { kind: 'wallet_home_region', region: 'test' },
  } as unknown as WalletSessionOperationCredentialV1;
}

function memoryStore(): EmailOtpEd25519WarmSealStore & {
  readonly records: Map<string, EmailOtpEd25519WarmSealRecord>;
} {
  const records = new Map<string, EmailOtpEd25519WarmSealRecord>();
  return {
    records,
    read: async (id) => records.get(id) ?? null,
    put: async (record) => void records.set(record.walletId, { ...record }),
    delete: async (id) => void records.delete(id),
  };
}

/** Routes the seal requests of the worker code to the real seal service. */
function installGateway(sessions: Map<string, AdmittedSession>): string[] {
  const service = createSigningSessionSealService({
    evaluator: createSigningSessionSealEvaluator({
      rootSecretB64u: Buffer.alloc(32, 9).toString('base64url'),
      currentKeyVersion: 'signing-session-seal-test-r1',
      acceptedKeyVersions: ['signing-session-seal-test-r1'],
    }),
  });
  const bodies: string[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.pathname).toBe(`${WALLET_SESSION_SEAL_BASE_PATH}/evaluate`);
    const body = String(init?.body || '');
    bodies.push(body);
    const token = String(new Headers(init?.headers).get('Authorization') || '').replace(
      /^Bearer /u,
      '',
    );
    const session = sessions.get(token);
    const parsed = parseSigningSessionSealEvaluateBody(JSON.parse(body));
    if (!session || !parsed.ok) {
      return Response.json(
        { ok: false, code: 'unauthorized', message: 'no session' },
        { status: 401 },
      );
    }
    const result = await service.evaluate(parsed.value, {
      userId: session.walletId,
      session: {
        kind: 'exact_wallet_session_operation_credential',
        curve: 'ed25519',
        thresholdSessionId: session.thresholdSessionId,
        userId: session.walletId,
        expiresAtMs: session.expiresAtMs,
      },
    });
    return Response.json(result, { status: result.ok ? 200 : 409 });
  }) as typeof fetch;
  return bodies;
}

const realFetch = globalThis.fetch;

test.beforeAll(async () => {
  // The Gateway warm-up starts the shared WASM module; the worker code below uses it too.
  await warmSigningSessionSealRuntime();
});

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

function liveSession(): AdmittedSession {
  return { walletId, thresholdSessionId, expiresAtMs: Date.now() + 60_000 };
}

test('the re-hydrate opens S from the seal of its own Wallet Session', async () => {
  const store = memoryStore();
  const bodies = installGateway(new Map([['token-a', liveSession()]]));
  const warmSeal = createEmailOtpEd25519WarmSeal(store);
  const session = {
    relayUrl,
    walletId,
    thresholdSessionId,
    operationCredential: credential('token-a', 'wallet-session-a'),
  };

  await warmSeal.seal({ ...session, enrollment, factorSecret32 });
  const opened = await warmSeal.open(session);

  expect(Array.from(opened.factorSecret32)).toEqual(Array.from(factorSecret32));
  expect(opened.enrollmentId).toBe(enrollment.enrollmentId);
  expect(opened.enrollmentSealKeyVersion).toBe(enrollment.enrollmentSealKeyVersion);
  // The server saw two blinded elements and never S.
  expect(bodies).toHaveLength(2);
  const secretB64u = Buffer.from(factorSecret32).toString('base64url');
  for (const body of bodies) expect(body).not.toContain(secretB64u);
  expect(store.records.get(walletId)?.sealedSecretB64u).not.toContain(secretB64u);
});

test('a live seal of the same session is not sealed again', async () => {
  const store = memoryStore();
  const bodies = installGateway(new Map([['token-a', liveSession()]]));
  const warmSeal = createEmailOtpEd25519WarmSeal(store);
  const session = {
    relayUrl,
    walletId,
    thresholdSessionId,
    operationCredential: credential('token-a', 'wallet-session-a'),
  };

  await warmSeal.seal({ ...session, enrollment, factorSecret32 });
  const first = store.records.get(walletId);
  await warmSeal.seal({ ...session, enrollment, factorSecret32 });

  expect(bodies).toHaveLength(1);
  expect(store.records.get(walletId)).toEqual(first);
});

test('another Wallet Session cannot open the seal', async () => {
  const store = memoryStore();
  installGateway(
    new Map([
      ['token-a', liveSession()],
      ['token-b', liveSession()],
    ]),
  );
  const warmSeal = createEmailOtpEd25519WarmSeal(store);
  await warmSeal.seal({
    relayUrl,
    walletId,
    thresholdSessionId,
    operationCredential: credential('token-a', 'wallet-session-a'),
    enrollment,
    factorSecret32,
  });

  await expect(
    warmSeal.open({
      relayUrl,
      walletId,
      thresholdSessionId,
      operationCredential: credential('token-b', 'wallet-session-b'),
    }),
  ).rejects.toThrow('Email OTP Ed25519 warm seal is unavailable for this Wallet Session');
});

test('the seal opens only for the threshold session that it names', async () => {
  const store = memoryStore();
  const otherThresholdSessionId = 'ed25519-threshold-session-b';
  const sessions = new Map([['token-a', liveSession()]]);
  installGateway(sessions);
  const warmSeal = createEmailOtpEd25519WarmSeal(store);
  await warmSeal.seal({
    relayUrl,
    walletId,
    thresholdSessionId,
    operationCredential: credential('token-a', 'wallet-session-a'),
    enrollment,
    factorSecret32,
  });
  // A copy of the record moved to another threshold session, which the server admits.
  const record = store.records.get(walletId);
  if (!record) throw new Error('missing seal');
  store.records.set(walletId, { ...record, thresholdSessionId: otherThresholdSessionId });
  sessions.set('token-a', { ...liveSession(), thresholdSessionId: otherThresholdSessionId });

  // The POPRF `info` and the AES-GCM data name the threshold session, so the tag check fails.
  await expect(
    warmSeal.open({
      relayUrl,
      walletId,
      thresholdSessionId: otherThresholdSessionId,
      operationCredential: credential('token-a', 'wallet-session-a'),
    }),
  ).rejects.toThrow('The operation failed for an operation-specific reason');
});

test('an ended session opens nothing, and an expired seal is deleted', async () => {
  const store = memoryStore();
  const session = liveSession();
  installGateway(new Map([['token-a', session]]));
  const warmSeal = createEmailOtpEd25519WarmSeal(store);
  const scope = {
    relayUrl,
    walletId,
    thresholdSessionId,
    operationCredential: credential('token-a', 'wallet-session-a'),
  };
  await warmSeal.seal({ ...scope, enrollment, factorSecret32 });

  session.expiresAtMs = Date.now() - 1;
  await expect(warmSeal.open(scope)).rejects.toThrow('threshold session expired');
  expect(store.records.has(walletId)).toBe(true);

  const record = store.records.get(walletId);
  if (!record) throw new Error('missing seal');
  store.records.set(walletId, { ...record, expiresAtMs: Date.now() - 1 });
  await expect(warmSeal.open(scope)).rejects.toThrow('Email OTP Ed25519 warm seal expired');
  expect(store.records.has(walletId)).toBe(false);
});

test('no seal is kept when the server refuses the session', async () => {
  const store = memoryStore();
  installGateway(new Map());
  const warmSeal = createEmailOtpEd25519WarmSeal(store);

  await expect(
    warmSeal.seal({
      relayUrl,
      walletId,
      thresholdSessionId,
      operationCredential: credential('token-a', 'wallet-session-a'),
      enrollment,
      factorSecret32,
    }),
  ).rejects.toThrow('Email OTP Ed25519 warm seal failed');
  expect(store.records.size).toBe(0);
});

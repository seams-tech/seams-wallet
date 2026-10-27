import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  buildVoiceIdWalletSessionChallenge,
  parseVoiceIdDevicePublicKeyB64u,
  voiceIdWalletSessionChallengeBytes,
  type VoiceIdWalletSessionChallenge,
} from '@shared/authorization/voiceIdDeviceAssertion';
import { base64UrlEncode } from '@shared/utils/base64';
import { sha256DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
} from '@shared/utils/domainIds';
import {
  verifyVoiceIdWalletSessionAssertion,
  type RegisteredVoiceIdDeviceKey,
} from '@server/authorization/voiceIdDeviceProof';
import { D1VoiceIdWalletSessionChallenges } from '@server/router/cloudflare/d1/wallet/d1VoiceIdWalletSessionChallenges';
import { openSignerD1 } from '../../fixtures/signer-d1.mjs';

const SCOPE = {
  namespace: 'voiceid-proof',
  orgId: 'voiceid-org',
  projectId: 'voiceid-project',
  envId: 'test',
};

function requireParsed<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error('Test identity was invalid');
  return result.value;
}

async function fixture(store: D1VoiceIdWalletSessionChallenges): Promise<{
  challenge: VoiceIdWalletSessionChallenge;
  registered: RegisteredVoiceIdDeviceKey;
  privateKey: CryptoKey;
}> {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  if (!('privateKey' in keys)) throw new Error('Ed25519 key pair was unavailable');
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const deviceKeyId = await sha256DigestB64u(publicKey);
  const walletId = requireParsed(parseWalletId('owner.testnet'));
  const walletAuthMethodId = requireParsed(parseWalletAuthMethodId(`wallet-auth-method:${randomUUID()}`));
  const walletAuthorityId = requireParsed(parseWalletAuthorityId('owner-authority'));
  const registered: RegisteredVoiceIdDeviceKey = {
    walletId,
    walletAuthMethodId,
    walletAuthorityId,
    deviceKeyId,
    publicKeyB64u: parseVoiceIdDevicePublicKeyB64u(base64UrlEncode(publicKey)),
    status: 'active',
  };
  const challenge = await store.issue({
    registered,
    requestOrigin: 'https://app.example.test',
    audience: 'https://wallet.example.test',
    nowMs: Date.now(),
  });
  return {
    challenge,
    registered,
    privateKey: keys.privateKey,
  };
}

async function assertion(
  challenge: VoiceIdWalletSessionChallenge,
  privateKey: CryptoKey,
) {
  const signature = await crypto.subtle.sign(
    'Ed25519',
    privateKey,
    voiceIdWalletSessionChallengeBytes(challenge),
  );
  return {
    kind: 'voiceid_device_assertion_v1',
    challenge,
    signatureB64u: base64UrlEncode(new Uint8Array(signature)),
  };
}

function challengeWithWallet(
  challenge: VoiceIdWalletSessionChallenge,
  walletId: VoiceIdWalletSessionChallenge['walletId'],
): VoiceIdWalletSessionChallenge {
  return buildVoiceIdWalletSessionChallenge({
    walletId,
    walletAuthMethodId: challenge.walletAuthMethodId,
    walletAuthorityId: challenge.walletAuthorityId,
    deviceKeyId: challenge.deviceKeyId,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    requestOrigin: challenge.requestOrigin,
    audience: challenge.audience,
    issuedAtMs: challenge.issuedAtMs,
    expiresAtMs: challenge.expiresAtMs,
  });
}

function challengeWithOrigin(
  challenge: VoiceIdWalletSessionChallenge,
  requestOrigin: string,
): VoiceIdWalletSessionChallenge {
  return buildVoiceIdWalletSessionChallenge({
    walletId: challenge.walletId,
    walletAuthMethodId: challenge.walletAuthMethodId,
    walletAuthorityId: challenge.walletAuthorityId,
    deviceKeyId: challenge.deviceKeyId,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    requestOrigin,
    audience: challenge.audience,
    issuedAtMs: challenge.issuedAtMs,
    expiresAtMs: challenge.expiresAtMs,
  });
}

test('a registered VoiceID device can prove one durable Wallet Session challenge', runJourney);

async function runJourney({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  void page;
  const runtime = await openSignerD1();
  try {
    const store = new D1VoiceIdWalletSessionChallenges(runtime.database, SCOPE);
    const current = await fixture(store);
    const signed = await assertion(current.challenge, current.privateKey);
    const nowMs = current.challenge.issuedAtMs + 1_000;
    const anotherStore = new D1VoiceIdWalletSessionChallenges(runtime.database, SCOPE);
    const stored = await anotherStore.read({
      challengeId: current.challenge.challengeId,
      requestOrigin: current.challenge.requestOrigin,
      audience: current.challenge.audience,
      nowMs,
    });
    expect(stored).toEqual(current.challenge);

    const otherTenant = new D1VoiceIdWalletSessionChallenges(runtime.database, {
      ...SCOPE,
      envId: 'another-environment',
    });
    expect(await otherTenant.read({
      challengeId: current.challenge.challengeId,
      requestOrigin: current.challenge.requestOrigin,
      audience: current.challenge.audience,
      nowMs,
    })).toBeNull();
    expect(await anotherStore.read({
      challengeId: current.challenge.challengeId,
      requestOrigin: 'https://attacker.example.test',
      audience: current.challenge.audience,
      nowMs,
    })).toBeNull();
    expect(await anotherStore.read({
      challengeId: current.challenge.challengeId,
      requestOrigin: current.challenge.requestOrigin,
      audience: current.challenge.audience,
      nowMs: current.challenge.expiresAtMs,
    })).toBeNull();
    const alteredOrigin = challengeWithOrigin(current.challenge, 'https://attacker.example.test');
    expect(await store.consume(alteredOrigin, nowMs)).toBe(false);

    const otherWallet = requireParsed(parseWalletId('different.testnet'));
    const changedWallet = challengeWithWallet(current.challenge, otherWallet);
    await expect(verifyVoiceIdWalletSessionAssertion({
      registered: current.registered,
      expectedChallenge: changedWallet,
      assertion: signed,
      nowMs,
      consumeChallenge: store.consume.bind(store),
    })).rejects.toThrow('unavailable');

    const changedOrigin = challengeWithOrigin(current.challenge, 'https://attacker.example.test');
    await expect(verifyVoiceIdWalletSessionAssertion({
      registered: current.registered,
      expectedChallenge: changedOrigin,
      assertion: signed,
      nowMs,
      consumeChallenge: store.consume.bind(store),
    })).rejects.toThrow('different challenge');

    const tamperedSignature = {
      ...signed,
      signatureB64u: base64UrlEncode(new Uint8Array(64)),
    };
    await expect(verifyVoiceIdWalletSessionAssertion({
      registered: current.registered,
      expectedChallenge: current.challenge,
      assertion: tamperedSignature,
      nowMs,
      consumeChallenge: store.consume.bind(store),
    })).rejects.toThrow('signature is invalid');

    await expect(verifyVoiceIdWalletSessionAssertion({
      registered: current.registered,
      expectedChallenge: current.challenge,
      assertion: signed,
      nowMs: current.challenge.expiresAtMs,
      consumeChallenge: store.consume.bind(store),
    })).rejects.toThrow('unavailable');

    expect(await store.read({
      challengeId: current.challenge.challengeId,
      requestOrigin: current.challenge.requestOrigin,
      audience: current.challenge.audience,
      nowMs,
    })).toEqual(current.challenge);

    const proof = await verifyVoiceIdWalletSessionAssertion({
      registered: current.registered,
      expectedChallenge: current.challenge,
      assertion: signed,
      nowMs,
      consumeChallenge: anotherStore.consume.bind(anotherStore),
    });
    expect(proof.challenge.challengeId).toBe(current.challenge.challengeId);
    expect(await store.read({
      challengeId: current.challenge.challengeId,
      requestOrigin: current.challenge.requestOrigin,
      audience: current.challenge.audience,
      nowMs,
    })).toBeNull();

    await expect(verifyVoiceIdWalletSessionAssertion({
      registered: current.registered,
      expectedChallenge: current.challenge,
      assertion: signed,
      nowMs,
      consumeChallenge: store.consume.bind(store),
    })).rejects.toThrow('already consumed');

    const raceChallenge = await store.issue({
      registered: current.registered,
      requestOrigin: current.challenge.requestOrigin,
      audience: current.challenge.audience,
      nowMs: Date.now(),
    });
    const raceAssertion = await assertion(raceChallenge, current.privateKey);
    const raceNowMs = raceChallenge.issuedAtMs + 1_000;
    const races = await Promise.allSettled([
      verifyVoiceIdWalletSessionAssertion({
        registered: current.registered,
        expectedChallenge: raceChallenge,
        assertion: raceAssertion,
        nowMs: raceNowMs,
        consumeChallenge: store.consume.bind(store),
      }),
      verifyVoiceIdWalletSessionAssertion({
        registered: current.registered,
        expectedChallenge: raceChallenge,
        assertion: raceAssertion,
        nowMs: raceNowMs,
        consumeChallenge: anotherStore.consume.bind(anotherStore),
      }),
    ]);
    const successes = Number(races[0]?.status === 'fulfilled') + Number(races[1]?.status === 'fulfilled');
    expect(successes).toBe(1);

    const reportPath = testInfo.outputPath('voiceid-device-proof.json');
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify({
      schemaVersion: 'voiceid_device_proof_journey_v2',
      status: 'passed',
      publicDeviceKeyId: current.registered.deviceKeyId,
      cases: [
        'durable_challenge_read_across_store_instances',
        'tenant_and_origin_scope_enforced',
        'changed_challenge_cannot_consume',
        'expired_challenge_cannot_be_read',
        'valid_registered_key',
        'single_use_replay_rejected',
        'concurrent_consumption_has_one_winner',
        'different_wallet_rejected',
        'changed_origin_rejected',
        'forged_signature_rejected',
        'expired_challenge_rejected',
      ],
    }, null, 2)}\n`);
    await testInfo.attach('voiceid-device-proof.json', {
      path: reportPath,
      contentType: 'application/json',
    });
  } finally {
    await runtime.close();
  }
}

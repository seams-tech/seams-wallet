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
import { parseWalletSessionMintId } from '@shared/authorization/capabilityKinds';
import { base64UrlEncode } from '@shared/utils/base64';
import {
  parseDigestB64u,
  sha256DigestB64u,
} from '@shared/utils/canonicalPrimitives';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
} from '@shared/utils/domainIds';
import {
  verifyVoiceIdWalletSessionAssertion,
  type RegisteredVoiceIdDeviceKey,
} from '@server/authorization/voiceIdDeviceProof';

class ChallengeLedger {
  private readonly consumed = new Set<string>();

  readonly consume = async (challenge: VoiceIdWalletSessionChallenge): Promise<boolean> => {
    const id = String(challenge.challengeId);
    if (this.consumed.has(id)) return false;
    this.consumed.add(id);
    return true;
  };
}

function requireParsed<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error('Test identity was invalid');
  return result.value;
}

function nonce() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return parseDigestB64u(base64UrlEncode(bytes));
}

async function fixture(): Promise<{
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
  const challengeId = requireParsed(parseWalletSessionMintId(randomUUID()));
  const issuedAtMs = Date.now();
  const challenge = buildVoiceIdWalletSessionChallenge({
    walletId,
    walletAuthMethodId,
    walletAuthorityId,
    deviceKeyId,
    challengeId,
    nonce: nonce(),
    requestOrigin: 'https://app.example.test',
    audience: 'https://wallet.example.test',
    issuedAtMs,
    expiresAtMs: issuedAtMs + 30_000,
  });
  return {
    challenge,
    registered: {
      walletId,
      walletAuthMethodId,
      walletAuthorityId,
      deviceKeyId,
      publicKeyB64u: parseVoiceIdDevicePublicKeyB64u(base64UrlEncode(publicKey)),
      status: 'active',
    },
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

test('a registered VoiceID device can prove one fresh Wallet Session challenge', runJourney);

async function runJourney({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  void page;
  const current = await fixture();
  const signed = await assertion(current.challenge, current.privateKey);
  const ledger = new ChallengeLedger();
  const nowMs = current.challenge.issuedAtMs + 1_000;
  const proof = await verifyVoiceIdWalletSessionAssertion({
    registered: current.registered,
    expectedChallenge: current.challenge,
    assertion: signed,
    nowMs,
    consumeChallenge: ledger.consume,
  });
  expect(proof.challenge.challengeId).toBe(current.challenge.challengeId);

  await expect(
    verifyVoiceIdWalletSessionAssertion({
      registered: current.registered,
      expectedChallenge: current.challenge,
      assertion: signed,
      nowMs,
      consumeChallenge: ledger.consume,
    }),
  ).rejects.toThrow('already consumed');

  const otherWallet = requireParsed(parseWalletId('different.testnet'));
  const changedWallet = challengeWithWallet(current.challenge, otherWallet);
  await expect(
    verifyVoiceIdWalletSessionAssertion({
      registered: current.registered,
      expectedChallenge: changedWallet,
      assertion: signed,
      nowMs,
      consumeChallenge: new ChallengeLedger().consume,
    }),
  ).rejects.toThrow('unavailable');

  const changedOrigin = challengeWithOrigin(current.challenge, 'https://attacker.example.test');
  await expect(
    verifyVoiceIdWalletSessionAssertion({
      registered: current.registered,
      expectedChallenge: changedOrigin,
      assertion: signed,
      nowMs,
      consumeChallenge: new ChallengeLedger().consume,
    }),
  ).rejects.toThrow('different challenge');

  const tamperedSignature = {
    ...signed,
    signatureB64u: base64UrlEncode(new Uint8Array(64)),
  };
  await expect(
    verifyVoiceIdWalletSessionAssertion({
      registered: current.registered,
      expectedChallenge: current.challenge,
      assertion: tamperedSignature,
      nowMs,
      consumeChallenge: new ChallengeLedger().consume,
    }),
  ).rejects.toThrow('signature is invalid');

  await expect(
    verifyVoiceIdWalletSessionAssertion({
      registered: current.registered,
      expectedChallenge: current.challenge,
      assertion: signed,
      nowMs: current.challenge.expiresAtMs,
      consumeChallenge: new ChallengeLedger().consume,
    }),
  ).rejects.toThrow('unavailable');

  const reportPath = testInfo.outputPath('voiceid-device-proof.json');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    schemaVersion: 'voiceid_device_proof_journey_v1',
    status: 'passed',
    publicDeviceKeyId: current.registered.deviceKeyId,
    cases: [
      'valid_registered_key',
      'single_use_replay_rejected',
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
}

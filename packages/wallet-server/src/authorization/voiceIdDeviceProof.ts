import {
  parseVoiceIdDeviceAssertion,
  voiceIdWalletSessionChallengeBytes,
  type VoiceIdDevicePublicKeyB64u,
  type VoiceIdWalletSessionChallenge,
} from '@shared/authorization/voiceIdDeviceAssertion';
import { base64UrlDecode } from '@shared/utils/base64';
import { sha256DigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import type {
  WalletAuthMethodId,
  WalletAuthorityId,
  WalletId,
} from '@shared/utils/domainIds';

export type RegisteredVoiceIdDeviceKey = Readonly<{
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
  walletAuthorityId: WalletAuthorityId;
  deviceKeyId: DigestB64u;
  publicKeyB64u: VoiceIdDevicePublicKeyB64u;
  status: 'active';
}>;

class VerifiedVoiceIdWalletSessionProof {
  private readonly proofBrand = true;

  constructor(
    readonly challenge: VoiceIdWalletSessionChallenge,
    readonly deviceKeyId: DigestB64u,
  ) {
    void this.proofBrand;
  }
}

export type VerifiedVoiceIdSessionProof = VerifiedVoiceIdWalletSessionProof;

export type ConsumeVoiceIdChallenge = (
  challenge: VoiceIdWalletSessionChallenge,
  nowMs: number,
) => Promise<boolean>;

function sameChallenge(
  left: VoiceIdWalletSessionChallenge,
  right: VoiceIdWalletSessionChallenge,
): boolean {
  return (
    left.kind === right.kind &&
    left.walletId === right.walletId &&
    left.walletAuthMethodId === right.walletAuthMethodId &&
    left.walletAuthorityId === right.walletAuthorityId &&
    left.deviceKeyId === right.deviceKeyId &&
    left.challengeId === right.challengeId &&
    left.nonce === right.nonce &&
    left.requestOrigin === right.requestOrigin &&
    left.audience === right.audience &&
    left.issuedAtMs === right.issuedAtMs &&
    left.expiresAtMs === right.expiresAtMs
  );
}

/** Only this server boundary turns a signed device result into verified proof. */
export async function verifyVoiceIdWalletSessionAssertion(input: {
  registered: RegisteredVoiceIdDeviceKey;
  expectedChallenge: VoiceIdWalletSessionChallenge;
  assertion: unknown;
  nowMs: number;
  consumeChallenge: ConsumeVoiceIdChallenge;
}): Promise<VerifiedVoiceIdSessionProof> {
  const challenge = input.expectedChallenge;
  if (
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < challenge.issuedAtMs - 5_000 ||
    input.nowMs >= challenge.expiresAtMs ||
    challenge.walletId !== input.registered.walletId ||
    challenge.walletAuthMethodId !== input.registered.walletAuthMethodId ||
    challenge.walletAuthorityId !== input.registered.walletAuthorityId ||
    challenge.deviceKeyId !== input.registered.deviceKeyId
  ) {
    throw new Error('VoiceID Wallet Session challenge is unavailable');
  }
  const assertion = parseVoiceIdDeviceAssertion(input.assertion);
  if (!sameChallenge(assertion.challenge, challenge)) {
    throw new Error('VoiceID assertion names a different challenge');
  }
  const publicKeyBytes = base64UrlDecode(input.registered.publicKeyB64u);
  const publicKeyId = await sha256DigestB64u(publicKeyBytes);
  if (publicKeyId !== input.registered.deviceKeyId) {
    throw new Error('VoiceID device key identity is invalid');
  }
  const publicKey = await crypto.subtle.importKey(
    'raw',
    publicKeyBytes,
    'Ed25519',
    false,
    ['verify'],
  );
  const verified = await crypto.subtle.verify(
    'Ed25519',
    publicKey,
    base64UrlDecode(assertion.signatureB64u),
    voiceIdWalletSessionChallengeBytes(challenge),
  );
  if (!verified) throw new Error('VoiceID device signature is invalid');
  if (!(await input.consumeChallenge(challenge, input.nowMs))) {
    throw new Error('VoiceID challenge was already consumed');
  }
  return new VerifiedVoiceIdWalletSessionProof(challenge, input.registered.deviceKeyId);
}

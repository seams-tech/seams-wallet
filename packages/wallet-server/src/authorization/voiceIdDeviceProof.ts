import {
  parseVoiceIdDeviceAssertion,
  parseVoiceIdOperationAssertion,
  voiceIdOperationStatementBytes,
  voiceIdWalletSessionChallengeBytes,
  type VoiceIdDevicePublicKeyB64u,
  type VoiceIdOperationKind,
  type VoiceIdOperationStatement,
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
  await requireRegisteredDeviceSignature(
    input.registered,
    assertion.signatureB64u,
    voiceIdWalletSessionChallengeBytes(challenge),
  );
  if (!(await input.consumeChallenge(challenge, input.nowMs))) {
    throw new Error('VoiceID challenge was already consumed');
  }
  return new VerifiedVoiceIdWalletSessionProof(challenge, input.registered.deviceKeyId);
}

async function requireRegisteredDeviceSignature(
  registered: RegisteredVoiceIdDeviceKey,
  signatureB64u: string,
  signedBytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const publicKeyBytes = base64UrlDecode(registered.publicKeyB64u);
  const publicKeyId = await sha256DigestB64u(publicKeyBytes);
  if (publicKeyId !== registered.deviceKeyId) {
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
    base64UrlDecode(signatureB64u),
    signedBytes,
  );
  if (!verified) throw new Error('VoiceID device signature is invalid');
}

class VerifiedVoiceIdOperationStatementProof {
  private readonly proofBrand = true;

  constructor(
    readonly statement: VoiceIdOperationStatement,
    readonly deviceKeyId: DigestB64u,
    readonly assertionDigest: DigestB64u,
  ) {
    void this.proofBrand;
  }
}

/**
 * A voice check for one operation. It is not a Wallet Session proof, and no
 * conversion exists between the two: a session assertion signs a different
 * statement under a different domain.
 */
export type VerifiedVoiceIdOperationProof = VerifiedVoiceIdOperationStatementProof;

/**
 * Only this server boundary turns a signed operation statement into verified
 * proof. The caller supplies the digest the operation expects and owns its
 * single use, as it does for a passkey assertion over the same digest.
 */
export async function verifyVoiceIdOperationAssertion(input: {
  registered: RegisteredVoiceIdDeviceKey;
  assertion: unknown;
  operationKind: VoiceIdOperationKind;
  operationChallenge: DigestB64u;
  requestOrigin: string;
  nowMs: number;
}): Promise<VerifiedVoiceIdOperationProof> {
  const assertion = parseVoiceIdOperationAssertion(input.assertion);
  const statement = assertion.statement;
  if (
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < statement.issuedAtMs - 5_000 ||
    input.nowMs >= statement.expiresAtMs ||
    statement.walletId !== input.registered.walletId ||
    statement.walletAuthMethodId !== input.registered.walletAuthMethodId ||
    statement.walletAuthorityId !== input.registered.walletAuthorityId ||
    statement.deviceKeyId !== input.registered.deviceKeyId ||
    statement.operationKind !== input.operationKind ||
    statement.operationChallenge !== input.operationChallenge ||
    statement.requestOrigin !== input.requestOrigin
  ) {
    throw new Error('VoiceID operation statement does not match this operation');
  }
  const signedBytes = voiceIdOperationStatementBytes(statement);
  await requireRegisteredDeviceSignature(input.registered, assertion.signatureB64u, signedBytes);
  const assertionDigest = await sha256DigestB64u(
    new TextEncoder().encode(`${statement.operationChallenge}|${assertion.signatureB64u}`),
  );
  return new VerifiedVoiceIdOperationStatementProof(
    statement,
    input.registered.deviceKeyId,
    assertionDigest,
  );
}

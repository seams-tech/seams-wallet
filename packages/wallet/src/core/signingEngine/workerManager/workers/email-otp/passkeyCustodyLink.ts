/**
 * Linking a new passkey to Email OTP custody: holds the opened seed between prepare and
 * complete, then reseals it to the passkey.
 */
import {
  type WalletAuthMethodId,
  parsePasskeyEnvelopeId,
  parseWebAuthnCredentialIdB64u,
} from '@shared/utils/domainIds';
import { base64UrlDecode } from '@shared/utils/encoders';
import { secureRandomId } from '@shared/utils/secureRandomId';
import {
  buildMethodBoundEnvelopeOwnership,
  buildPasskeyCustodyEnvelopeRecord,
  buildPasskeyEnvelopeFactor,
  parseEnvelopeCiphertextB64u,
  parseEnvelopeNonceB64u,
  parseEnvelopeRevision,
  parsePasskeyCustodyEnvelopeRecord,
  type PasskeyCustodyEnvelopeLifecycle,
  type PasskeyCustodySecretBinding,
  type PasskeyCustodyEnvelopeRecord,
  type WalletCustodyEnvelopeFactor,
} from '@shared/passkey-custody';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { zeroizeBytes } from '@/core/signingEngine/session/emailOtp/zeroize';
import type { EmailOtpWorkerOperationMap } from '@/core/signingEngine/workerManager/workerTypes';
import {
  passkey_custody_open_wallet_seed_v1,
  passkey_custody_reseal_wallet_seed_v1,
  type WasmPasskeyCustodyHandleV1,
} from '../../../../../../../../wasm/near_signer/pkg/wasm_signer_worker.js';
import { getPrfFirstB64uFromCredential } from '../../../webauthnAuth/credentials/credentialExtensions';
import { normalizeRegistrationCredential } from '../../../webauthnAuth/credentials/helpers';
import { assertNeverEmailOtpWorker, readString } from './payloadParsing';
import { ensureNearSignerRecoveryWasm } from './crypto';
import { type EmailOtpWalletCustodySeedUnlock, unlockEmailOtpWalletCustodySeed } from './unlock';

const EMAIL_OTP_PASSKEY_CUSTODY_LINK_TTL_MS = 2 * 60_000;
const MAX_EMAIL_OTP_PASSKEY_CUSTODY_LINKS = 8;

type EmailOtpPasskeyCustodyLinkEntry = {
  readonly handle: WasmPasskeyCustodyHandleV1;
  readonly envelope: PasskeyCustodyEnvelopeRecord;
  readonly expiresAtMs: number;
};
const emailOtpPasskeyCustodyLinks = new Map<string, EmailOtpPasskeyCustodyLinkEntry>();

function walletCustodyEnvelopeBindingJson(envelope: PasskeyCustodyEnvelopeRecord): string {
  return JSON.stringify({
    walletId: envelope.walletId,
    envelopeId: envelope.envelopeId,
    factor: envelope.factor,
    envelopeRevision: envelope.envelopeRevision,
    binding: envelope.binding,
  });
}

function disposeEmailOtpPasskeyCustodyLink(entry: EmailOtpPasskeyCustodyLinkEntry): void {
  entry.handle.free();
}

function discardExpiredEmailOtpPasskeyCustodyLinks(nowMs: number): void {
  for (const [pendingHandleId, entry] of emailOtpPasskeyCustodyLinks) {
    if (entry.expiresAtMs > nowMs) continue;
    emailOtpPasskeyCustodyLinks.delete(pendingHandleId);
    disposeEmailOtpPasskeyCustodyLink(entry);
  }
}

function storeEmailOtpPasskeyCustodyLink(entry: EmailOtpPasskeyCustodyLinkEntry): string {
  const nowMs = Date.now();
  discardExpiredEmailOtpPasskeyCustodyLinks(nowMs);
  if (emailOtpPasskeyCustodyLinks.size >= MAX_EMAIL_OTP_PASSKEY_CUSTODY_LINKS) {
    const oldest = emailOtpPasskeyCustodyLinks.entries().next().value as
      | [string, EmailOtpPasskeyCustodyLinkEntry]
      | undefined;
    if (oldest) {
      emailOtpPasskeyCustodyLinks.delete(oldest[0]);
      disposeEmailOtpPasskeyCustodyLink(oldest[1]);
    }
  }
  const pendingHandleId = secureRandomId(
    'email-otp-passkey-custody-link',
    24,
    'Email OTP passkey custody link handle',
  );
  emailOtpPasskeyCustodyLinks.set(pendingHandleId, entry);
  return pendingHandleId;
}

function takeEmailOtpPasskeyCustodyLink(
  pendingHandleIdRaw: unknown,
): EmailOtpPasskeyCustodyLinkEntry {
  const pendingHandleId = readString(pendingHandleIdRaw, 'pendingHandleId');
  const nowMs = Date.now();
  discardExpiredEmailOtpPasskeyCustodyLinks(nowMs);
  const entry = emailOtpPasskeyCustodyLinks.get(pendingHandleId);
  if (!entry) throw new Error('Email OTP passkey custody link is missing or expired');
  emailOtpPasskeyCustodyLinks.delete(pendingHandleId);
  return entry;
}

function samePasskeyCustodySecretBindingV1(
  left: PasskeyCustodySecretBinding,
  right: PasskeyCustodySecretBinding,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'wallet_custody_seed_v1':
      return right.kind === left.kind && left.derivationScheme === right.derivationScheme;
    case 'ed25519_yao_client_root_v1':
      return (
        right.kind === left.kind &&
        left.linkSessionId === right.linkSessionId &&
        left.walletKeyId === right.walletKeyId &&
        left.targetFactor.kind === right.targetFactor.kind &&
        left.applicationBindingDigestB64u === right.applicationBindingDigestB64u &&
        left.registeredPublicKeyB64u === right.registeredPublicKeyB64u &&
        left.enrollmentId === right.enrollmentId &&
        left.deviceId === right.deviceId &&
        left.revocationEpoch === right.revocationEpoch
      );
    case 'ed25519_lane_holder_share_v1':
      return (
        right.kind === left.kind &&
        left.walletKeyId === right.walletKeyId &&
        left.laneId === right.laneId &&
        left.laneShareEpoch === right.laneShareEpoch &&
        left.nearEd25519SigningKeyId === right.nearEd25519SigningKeyId &&
        left.registeredPublicKeyB64u === right.registeredPublicKeyB64u &&
        left.participantBindingDigestB64u === right.participantBindingDigestB64u
      );
    case 'ecdsa_lane_holder_share_v1':
      return (
        right.kind === left.kind &&
        left.walletKeyId === right.walletKeyId &&
        left.laneId === right.laneId &&
        left.laneShareEpoch === right.laneShareEpoch &&
        left.evmFamilySigningKeySlotId === right.evmFamilySigningKeySlotId &&
        left.thresholdSessionId === right.thresholdSessionId &&
        left.thresholdPublicKey33B64u === right.thresholdPublicKey33B64u
      );
    default:
      return assertNeverEmailOtpWorker(left);
  }
}

function sameWalletCustodyEnvelopeFactorV1(
  left: WalletCustodyEnvelopeFactor,
  right: WalletCustodyEnvelopeFactor,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'passkey':
      return (
        right.kind === left.kind &&
        left.rpId === right.rpId &&
        left.credentialIdB64u === right.credentialIdB64u &&
        left.kekVersion === right.kekVersion
      );
    case 'email_otp':
      return (
        right.kind === left.kind &&
        left.enrollmentId === right.enrollmentId &&
        left.enrollmentSealKeyVersion === right.enrollmentSealKeyVersion &&
        left.kekVersion === right.kekVersion
      );
    default:
      return assertNeverEmailOtpWorker(left);
  }
}

function samePasskeyCustodyEnvelopeLifecycleV1(
  left: PasskeyCustodyEnvelopeLifecycle,
  right: PasskeyCustodyEnvelopeLifecycle,
): boolean {
  switch (left.state) {
    case 'active':
      return right.state === 'active' && left.activatedAtMs === right.activatedAtMs;
    case 'retired':
      return (
        right.state === 'retired' &&
        left.activatedAtMs === right.activatedAtMs &&
        left.retiredAtMs === right.retiredAtMs
      );
    case 'revoked':
      return (
        right.state === 'revoked' &&
        left.activatedAtMs === right.activatedAtMs &&
        left.revokedAtMs === right.revokedAtMs
      );
    default:
      return assertNeverEmailOtpWorker(left);
  }
}

function emailOtpPasskeySourceEnvelopeMatches(
  expected: PasskeyCustodyEnvelopeRecord,
  received: PasskeyCustodyEnvelopeRecord,
): boolean {
  return (
    expected.walletId === received.walletId &&
    expected.envelopeId === received.envelopeId &&
    expected.envelopeVersion === received.envelopeVersion &&
    expected.envelopeRevision === received.envelopeRevision &&
    expected.nonceB64u === received.nonceB64u &&
    expected.sealedCustodySecretB64u === received.sealedCustodySecretB64u &&
    expected.aadHashB64u === received.aadHashB64u &&
    expected.ciphertextDigestB64u === received.ciphertextDigestB64u &&
    samePasskeyCustodySecretBindingV1(expected.binding, received.binding) &&
    sameWalletCustodyEnvelopeFactorV1(expected.factor, received.factor) &&
    samePasskeyCustodyEnvelopeLifecycleV1(expected.lifecycle, received.lifecycle)
  );
}

export async function prepareEmailOtpPasskeyCustodyLink(
  args: EmailOtpWalletCustodySeedUnlock,
): Promise<EmailOtpWorkerOperationMap['prepareEmailOtpPasskeyCustodyLink']['result']> {
  const recovered = await unlockEmailOtpWalletCustodySeed(
    args,
    'Email OTP passkey linking did not return wallet custody material',
  );
  const envelope = parsePasskeyCustodyEnvelopeRecord(recovered.walletCustodyEnvelope);
  if (
    envelope.walletId !== args.walletId ||
    envelope.factor.kind !== 'email_otp' ||
    envelope.lifecycle.state !== 'active'
  ) {
    zeroizeBytes(recovered.clientSecret32);
    throw new Error('Email OTP passkey linking returned a mismatched custody envelope');
  }
  await ensureNearSignerRecoveryWasm();
  let handle: WasmPasskeyCustodyHandleV1 | null = null;
  try {
    handle = passkey_custody_open_wallet_seed_v1(
      recovered.clientSecret32,
      walletCustodyEnvelopeBindingJson(envelope),
      base64UrlDecode(envelope.nonceB64u),
      envelope.sealedCustodySecretB64u,
      envelope.aadHashB64u,
      envelope.ciphertextDigestB64u,
    );
    const expiresAtMs = Date.now() + EMAIL_OTP_PASSKEY_CUSTODY_LINK_TTL_MS;
    const pendingHandleId = storeEmailOtpPasskeyCustodyLink({ handle, envelope, expiresAtMs });
    handle = null;
    return {
      pendingHandleId,
      walletId: envelope.walletId,
      envelopeId: envelope.envelopeId,
      envelopeRevision: envelope.envelopeRevision,
      enrollmentId: envelope.factor.enrollmentId,
      enrollmentSealKeyVersion: envelope.factor.enrollmentSealKeyVersion,
      expiresAtMs,
    };
  } finally {
    handle?.free();
    zeroizeBytes(recovered.clientSecret32);
  }
}

export function completeEmailOtpPasskeyCustodyLink(args: {
  readonly pendingHandleId: string;
  readonly existingEnvelope: PasskeyCustodyEnvelopeRecord;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly registration: EmailOtpWorkerOperationMap['completeEmailOtpPasskeyCustodyLink']['payload']['registration'];
  readonly registrationCredential: EmailOtpWorkerOperationMap['completeEmailOtpPasskeyCustodyLink']['payload']['registrationCredential'];
}): EmailOtpWorkerOperationMap['completeEmailOtpPasskeyCustodyLink']['result'] {
  const entry = takeEmailOtpPasskeyCustodyLink(args.pendingHandleId);
  const existingEnvelope = parsePasskeyCustodyEnvelopeRecord(args.existingEnvelope);
  const credential = normalizeRegistrationCredential(args.registrationCredential);
  const replacementFactorSecret = base64UrlDecode(getPrfFirstB64uFromCredential(credential) || '');
  try {
    if (!emailOtpPasskeySourceEnvelopeMatches(entry.envelope, existingEnvelope)) {
      throw new Error('Email OTP passkey linking source envelope changed');
    }
    if (replacementFactorSecret.byteLength !== 32) {
      throw new Error('New passkey did not return a 32-byte PRF.first output');
    }
    const credentialId = parseWebAuthnCredentialIdB64u(credential.rawId || credential.id);
    if (!credentialId.ok) throw new Error(credentialId.error.message);
    const envelopeId = parsePasskeyEnvelopeId(
      secureRandomId('wallet-custody-envelope', 24, 'wallet custody envelope ids'),
    );
    if (!envelopeId.ok) throw new Error(envelopeId.error.message);
    const factor = buildPasskeyEnvelopeFactor({
      rpId: args.registration.rpId,
      credentialIdB64u: credentialId.value,
    });
    const replacementBindingJson = JSON.stringify({
      walletId: existingEnvelope.walletId,
      envelopeId: envelopeId.value,
      factor,
      envelopeRevision: 1,
      binding: existingEnvelope.binding,
    });
    const resealed = passkey_custody_reseal_wallet_seed_v1(
      entry.handle,
      replacementFactorSecret,
      replacementBindingJson,
    ) as Record<string, unknown>;
    const nowMs = Date.now();
    return {
      registrationCredential: credential,
      custodyEnvelope: parsePasskeyCustodyEnvelopeRecord(
        buildPasskeyCustodyEnvelopeRecord({
          ownership: buildMethodBoundEnvelopeOwnership(args.walletAuthMethodId),
          envelopeId: envelopeId.value,
          walletId: existingEnvelope.walletId,
          binding: existingEnvelope.binding,
          factor,
          envelopeRevision: parseEnvelopeRevision(1),
          nonceB64u: parseEnvelopeNonceB64u(readString(resealed.nonceB64u, 'resealed.nonceB64u')),
          sealedCustodySecretB64u: parseEnvelopeCiphertextB64u(
            readString(resealed.sealedCustodySecretB64u, 'resealed.sealedCustodySecretB64u'),
          ),
          aadHashB64u: parseDigestB64u(readString(resealed.aadHashB64u, 'resealed.aadHashB64u')),
          ciphertextDigestB64u: parseDigestB64u(
            readString(resealed.ciphertextDigestB64u, 'resealed.ciphertextDigestB64u'),
          ),
          lifecycle: { state: 'active', activatedAtMs: nowMs },
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
        }),
      ),
    };
  } finally {
    replacementFactorSecret.fill(0);
    disposeEmailOtpPasskeyCustodyLink(entry);
  }
}

export function discardEmailOtpPasskeyCustodyLink(pendingHandleIdRaw: unknown): boolean {
  const pendingHandleId = readString(pendingHandleIdRaw, 'pendingHandleId');
  const entry = emailOtpPasskeyCustodyLinks.get(pendingHandleId);
  if (!entry) return false;
  emailOtpPasskeyCustodyLinks.delete(pendingHandleId);
  disposeEmailOtpPasskeyCustodyLink(entry);
  return true;
}

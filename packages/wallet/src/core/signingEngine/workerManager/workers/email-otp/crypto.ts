/**
 * The worker's cryptographic runtimes: its wasm modules, the Ed25519 Yao client, Shamir client
 * seals and the ECDH/AES-GCM factor-release channel.
 */
import { initializeWasm, resolveWasmUrl } from '@/core/walletRuntimePaths/wasm-loader';
import { base64UrlDecode } from '@shared/utils/encoders';
import { EMAIL_OTP_FACTOR_RELEASE_AAD_DOMAIN_V1 } from '@shared/utils/emailOtpDomain';
import type { LinkedDeviceEmailOtpFactorReleaseEnvelopeV1 } from '@shared/device-linking/contracts';
import {
  decodeEmailOtpEscrowSecret32,
  type EmailOtpEscrowSecret32DecodeResult,
} from '@/core/signingEngine/session/emailOtp/secretEscrow';
import { zeroizeBytes } from '@/core/signingEngine/session/emailOtp/zeroize';
import { RouterAbEd25519YaoClientV1 } from '../../../threshold/ed25519/yaoClient';
import initEvmCrypto, {
  init_evm_crypto,
} from '../../../../../../../../wasm/evm_crypto/pkg/evm_crypto.js';
import initEmailOtpRuntime, {
  derive_email_otp_unlock_auth_seed_from_secret32,
  init_email_otp_runtime,
} from '../../../../../../../../wasm/email_otp_runtime/pkg/email_otp_runtime.js';
import initWalletCustodyCeremony from '../../../../../../../../wasm/wallet_custody_ceremony/pkg/wallet_custody_ceremony.js';
import initNearSignerRecoveryWasm, {
  init_worker as init_near_signer_recovery_worker,
} from '../../../../../../../../wasm/near_signer/pkg/wasm_signer_worker.js';
import { getShamir3PassRuntime } from '../shamir3pass/runtime';
import { readString } from './payloadParsing';

export function generateRandomSecret32(): Uint8Array {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is unavailable in this runtime');
  }
  return cryptoApi.getRandomValues(new Uint8Array(32));
}

const evmCryptoWasmUrl = resolveWasmUrl('evm_crypto.wasm', 'Email OTP');
const emailOtpRuntimeWasmUrl = resolveWasmUrl('email_otp_runtime_bg.wasm', 'Email OTP Runtime');
const walletCustodyCeremonyWasmUrl = resolveWasmUrl(
  'wallet_custody_ceremony_bg.wasm',
  'Email OTP Wallet Custody',
);
const nearSignerRecoveryWasmUrl = resolveWasmUrl(
  'wasm_signer_worker_bg.wasm',
  'Email OTP Recovery Wrap',
);
let evmCryptoInitPromise: Promise<void> | null = null;
let emailOtpRuntimeInitPromise: Promise<void> | null = null;
let nearSignerRecoveryInitPromise: Promise<void> | null = null;
let walletCustodyCeremonyInitPromise: Promise<void> | null = null;
let emailOtpYaoClientInitPromise: Promise<RouterAbEd25519YaoClientV1> | null = null;

function resetEmailOtpYaoClientInitOnFailure(error: unknown): never {
  emailOtpYaoClientInitPromise = null;
  throw error;
}

export function getEmailOtpYaoClient(): Promise<RouterAbEd25519YaoClientV1> {
  if (!emailOtpYaoClientInitPromise) {
    emailOtpYaoClientInitPromise = RouterAbEd25519YaoClientV1.initializeBundled().catch(
      resetEmailOtpYaoClientInitOnFailure,
    );
  }
  return emailOtpYaoClientInitPromise;
}

export async function ensureEvmCryptoWasm(): Promise<void> {
  if (evmCryptoInitPromise) return evmCryptoInitPromise;
  evmCryptoInitPromise = (async () => {
    await initializeWasm({
      workerName: 'Email OTP',
      wasmUrl: evmCryptoWasmUrl,
      initFunction: initEvmCrypto as unknown as (wasmModule?: unknown) => Promise<void>,
      validateFunction: () => init_evm_crypto(),
    });
  })();
  return evmCryptoInitPromise;
}

async function ensureEmailOtpRuntimeWasm(): Promise<void> {
  if (emailOtpRuntimeInitPromise) return emailOtpRuntimeInitPromise;
  emailOtpRuntimeInitPromise = (async () => {
    await initializeWasm({
      workerName: 'Email OTP Runtime',
      wasmUrl: emailOtpRuntimeWasmUrl,
      initFunction: initEmailOtpRuntime as unknown as (wasmModule?: unknown) => Promise<void>,
      validateFunction: () => init_email_otp_runtime(),
    });
  })();
  return emailOtpRuntimeInitPromise;
}

export async function ensureWalletCustodyCeremonyWasm(): Promise<void> {
  if (walletCustodyCeremonyInitPromise) return walletCustodyCeremonyInitPromise;
  walletCustodyCeremonyInitPromise = (async () => {
    await initializeWasm({
      workerName: 'Email OTP Wallet Custody',
      wasmUrl: walletCustodyCeremonyWasmUrl,
      initFunction: initWalletCustodyCeremony as unknown as (wasmModule?: unknown) => Promise<void>,
    });
  })();
  return walletCustodyCeremonyInitPromise;
}

export async function ensureNearSignerRecoveryWasm(): Promise<void> {
  if (nearSignerRecoveryInitPromise) return nearSignerRecoveryInitPromise;
  nearSignerRecoveryInitPromise = (async () => {
    await initializeWasm({
      workerName: 'Email OTP Recovery Wrap',
      wasmUrl: nearSignerRecoveryWasmUrl,
      initFunction: initNearSignerRecoveryWasm as unknown as (
        wasmModule?: unknown,
      ) => Promise<void>,
      validateFunction: () => init_near_signer_recovery_worker(),
    });
  })();
  return nearSignerRecoveryInitPromise;
}

export async function deriveEmailOtpUnlockAuthSeedInWorker(args: {
  clientSecret32: Uint8Array;
  walletId: string;
}): Promise<Uint8Array> {
  await ensureEmailOtpRuntimeWasm();
  return derive_email_otp_unlock_auth_seed_from_secret32(
    args.clientSecret32,
    String(args.walletId || '').trim(),
  );
}

export async function removeClientSealToSecret32(args: {
  runtime: Awaited<ReturnType<typeof getShamir3PassRuntime>>;
  keyHandle: string;
  ciphertextB64u: string;
}): Promise<EmailOtpEscrowSecret32DecodeResult> {
  const plaintext = await args.runtime.removeClientSealWithKeyHandleToBytes({
    ciphertextB64u: args.ciphertextB64u,
    keyHandle: args.keyHandle,
  });
  try {
    return decodeEmailOtpEscrowSecret32(plaintext);
  } finally {
    zeroizeBytes(plaintext);
  }
}

export async function addClientSealFromBytes(args: {
  runtime: Awaited<ReturnType<typeof getShamir3PassRuntime>>;
  keyHandle: string;
  ciphertext: Uint8Array;
}): Promise<string> {
  return readString(
    await args.runtime.addClientSealBytesWithKeyHandle({
      ciphertext: args.ciphertext,
      keyHandle: args.keyHandle,
    }),
    'wrappedCiphertext',
  );
}

/** A fresh P-256 key pair; the Router seals the released factor to its public half. */
export async function generateEmailOtpFactorReleaseKeyPair(label: string): Promise<{
  readonly subtle: SubtleCrypto;
  readonly privateKey: CryptoKey;
  readonly workerPublicKey: Uint8Array;
}> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error(`${label} requires WebCrypto`);
  const generated = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  if (!('privateKey' in generated) || !('publicKey' in generated)) {
    throw new Error(`${label} generated an invalid ECDH key pair`);
  }
  const workerPublicKey = new Uint8Array(await subtle.exportKey('raw', generated.publicKey));
  return { subtle, privateKey: generated.privateKey, workerPublicKey };
}

/**
 * Opens a factor released to this worker: ECDH with the Router's ephemeral key, then
 * AES-GCM bound to the wallet, enrollment and challenge. The caller owns and zeroizes
 * the decoded server key, nonce and ciphertext.
 */
export async function openEmailOtpFactorReleaseCiphertext(args: {
  readonly subtle: SubtleCrypto;
  readonly workerPrivateKey: CryptoKey;
  readonly serverPublicKey: Uint8Array;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly walletId: string;
  readonly enrollmentId: string;
  readonly enrollmentSealKeyVersion: string;
  readonly challengeId: string;
}): Promise<Uint8Array> {
  let sharedSecret: Uint8Array | null = null;
  let aad: Uint8Array | null = null;
  let factorSecret32: Uint8Array | null = null;
  try {
    const serverKey = await args.subtle.importKey(
      'raw',
      args.serverPublicKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    sharedSecret = new Uint8Array(
      await args.subtle.deriveBits({ name: 'ECDH', public: serverKey }, args.workerPrivateKey, 256),
    );
    const aesKey = await args.subtle.importKey('raw', sharedSecret, { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);
    aad = new TextEncoder().encode(
      `${EMAIL_OTP_FACTOR_RELEASE_AAD_DOMAIN_V1}\0${args.walletId}\0${args.enrollmentId}\0${args.enrollmentSealKeyVersion}\0${args.challengeId}`,
    );
    factorSecret32 = new Uint8Array(
      await args.subtle.decrypt(
        { name: 'AES-GCM', iv: args.nonce, additionalData: aad, tagLength: 128 },
        aesKey,
        args.ciphertext,
      ),
    );
    if (factorSecret32.length !== 32) {
      throw new Error('Email OTP factor release plaintext must contain exactly 32 bytes');
    }
    const ownedFactorSecret32 = factorSecret32;
    factorSecret32 = null;
    return ownedFactorSecret32;
  } finally {
    zeroizeBytes(sharedSecret);
    zeroizeBytes(aad);
    zeroizeBytes(factorSecret32);
  }
}

export async function decryptEmailOtpFactorReleaseEnvelope(args: {
  walletId: string;
  challengeId: string;
  workerPrivateKey: CryptoKey;
  materialRecovery: LinkedDeviceEmailOtpFactorReleaseEnvelopeV1;
}): Promise<{
  challengeId: string;
  enrollmentId: string;
  enrollmentSealKeyVersion: string;
  factorSecret32: Uint8Array;
}> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Email OTP factor release requires WebCrypto');
  const released = args.materialRecovery;
  if (released.challengeId !== args.challengeId) {
    throw new Error('Email OTP factor release challenge binding changed');
  }
  let serverPublicKey: Uint8Array | null = null;
  let nonce: Uint8Array | null = null;
  let ciphertext: Uint8Array | null = null;
  try {
    serverPublicKey = base64UrlDecode(released.serverEphemeralPublicKey65B64u);
    if (serverPublicKey.length !== 65 || serverPublicKey[0] !== 4) {
      throw new Error('Email OTP factor release returned an invalid server public key');
    }
    nonce = base64UrlDecode(released.nonce12B64u);
    if (nonce.length !== 12) throw new Error('Email OTP factor release returned an invalid nonce');
    ciphertext = base64UrlDecode(released.ciphertextB64u);
    if (ciphertext.length < 16) {
      throw new Error('Email OTP factor release returned an invalid ciphertext');
    }
    return {
      challengeId: released.challengeId,
      enrollmentId: released.enrollmentId,
      enrollmentSealKeyVersion: released.enrollmentSealKeyVersion,
      factorSecret32: await openEmailOtpFactorReleaseCiphertext({
        subtle,
        workerPrivateKey: args.workerPrivateKey,
        serverPublicKey,
        nonce,
        ciphertext,
        walletId: args.walletId,
        enrollmentId: released.enrollmentId,
        enrollmentSealKeyVersion: released.enrollmentSealKeyVersion,
        challengeId: released.challengeId,
      }),
    };
  } finally {
    zeroizeBytes(serverPublicKey);
    zeroizeBytes(nonce);
    zeroizeBytes(ciphertext);
  }
}

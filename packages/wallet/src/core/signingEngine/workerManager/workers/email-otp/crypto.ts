/**
 * The worker's cryptographic runtimes: its wasm modules, the Ed25519 Yao client and the
 * Shamir client seal of the warm session.
 */
import { initializeWasm, resolveWasmUrl } from '@/core/walletRuntimePaths/wasm-loader';
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
import { getShamir3PassRuntime } from '../shamir3pass/runtime';

export function generateRandomSecret32(): Uint8Array {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is unavailable in this runtime');
  }
  return cryptoApi.getRandomValues(new Uint8Array(32));
}

const evmCryptoWasmUrl = resolveWasmUrl('evm_crypto_bg.wasm', 'Email OTP');
const emailOtpRuntimeWasmUrl = resolveWasmUrl('email_otp_runtime_bg.wasm', 'Email OTP Runtime');
const walletCustodyCeremonyWasmUrl = resolveWasmUrl(
  'wallet_custody_ceremony_bg.wasm',
  'Email OTP Wallet Custody',
);
let evmCryptoInitPromise: Promise<void> | null = null;
let emailOtpRuntimeInitPromise: Promise<void> | null = null;
let walletCustodyCeremonyInitPromise: Promise<void> | null = null;
let emailOtpYaoClientInitPromise: Promise<RouterAbEd25519YaoClientV1> | null = null;

function resetEmailOtpYaoClientInitOnFailure(error: unknown): never {
  emailOtpYaoClientInitPromise = null;
  throw error;
}

function resetEvmCryptoInitOnFailure(error: unknown): never {
  evmCryptoInitPromise = null;
  throw error;
}

function resetEmailOtpRuntimeInitOnFailure(error: unknown): never {
  emailOtpRuntimeInitPromise = null;
  throw error;
}

function resetWalletCustodyCeremonyInitOnFailure(error: unknown): never {
  walletCustodyCeremonyInitPromise = null;
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
  evmCryptoInitPromise = initializeWasm({
    workerName: 'Email OTP',
    wasmUrl: evmCryptoWasmUrl,
    initFunction: initEvmCrypto as unknown as (wasmModule?: unknown) => Promise<void>,
    validateFunction: init_evm_crypto,
  }).catch(resetEvmCryptoInitOnFailure);
  return evmCryptoInitPromise;
}

async function ensureEmailOtpRuntimeWasm(): Promise<void> {
  if (emailOtpRuntimeInitPromise) return emailOtpRuntimeInitPromise;
  emailOtpRuntimeInitPromise = initializeWasm({
    workerName: 'Email OTP Runtime',
    wasmUrl: emailOtpRuntimeWasmUrl,
    initFunction: initEmailOtpRuntime as unknown as (wasmModule?: unknown) => Promise<void>,
    validateFunction: init_email_otp_runtime,
  }).catch(resetEmailOtpRuntimeInitOnFailure);
  return emailOtpRuntimeInitPromise;
}

export async function ensureWalletCustodyCeremonyWasm(): Promise<void> {
  if (walletCustodyCeremonyInitPromise) return walletCustodyCeremonyInitPromise;
  walletCustodyCeremonyInitPromise = initializeWasm({
    workerName: 'Email OTP Wallet Custody',
    wasmUrl: walletCustodyCeremonyWasmUrl,
    initFunction: initWalletCustodyCeremony as unknown as (wasmModule?: unknown) => Promise<void>,
  }).catch(resetWalletCustodyCeremonyInitOnFailure);
  return walletCustodyCeremonyInitPromise;
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

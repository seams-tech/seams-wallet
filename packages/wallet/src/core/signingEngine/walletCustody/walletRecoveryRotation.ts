import {
  issueWalletRecoveryCodes,
  zeroizeIssuedWalletRecoveryCodes,
  type IssuedWalletRecoveryCodes,
} from '@shared/wallet-recovery/recoveryCodes';
import {
  walletRecoverySetRotationWireFromWorkerResultV1,
  type WalletRecoverySetRotationWorkerResultV1,
} from '@shared/wallet-recovery/walletRecoveryRotation';
import { deriveRecoveryCodeLocatorV1FromBytes } from '@shared/wallet-recovery/recoveryCodeLocator';
import type { PasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import type { WalletRecoverySetRotationWireV1 } from '@shared/wallet-recovery/walletRecoveryEnvelopeSet';
import { base64UrlEncode } from '@shared/utils/base64';
import { joinCustodyWireFromEnvelopeRecord } from './joinCustodyWire';
import {
  readWalletRecoveryCodeStatus,
  rotateWalletRecoverySet,
  type WalletCustodyFactorProof,
  type WalletRecoverySetRotateResult,
} from '@/core/rpcClients/relayer/walletRecoveryRotate';

type WalletRecoveryRotationWorker = {
  rotateRecoverySet(args: {
    readonly custodyJson: string;
    readonly factorSecret: ArrayBuffer;
    readonly recoveryCodesJson: string;
  }): Promise<WalletRecoverySetRotationWorkerResultV1>;
};

export type WalletRecoveryFactorProofRequest =
  | {
      readonly operation: 'recovery_status';
      readonly payload: { readonly walletId: string; readonly requestId: string };
    }
  | {
      readonly operation: 'recovery_rotate';
      readonly payload: {
        readonly walletId: string;
        readonly expectedStoreVersion: string;
        readonly manifestKekWraps: WalletRecoverySetRotationWireV1['manifestKekWraps'];
        readonly entries: readonly WalletRecoverySetRotationWireV1['entry'][];
        readonly recoveryCodeLocators: readonly {
          readonly locatorB64u: string;
          readonly recoveryKeyId: string;
        }[];
      };
    };

export type WalletRecoveryFactorProofFactory = (
  request: WalletRecoveryFactorProofRequest,
) => Promise<WalletCustodyFactorProof>;

type EmailOtpWalletRecoveryRotationWorker = {
  rotateRecoverySet(args: {
    readonly recoveryCodesJson: string;
  }): Promise<WalletRecoverySetRotationWorkerResultV1>;
};

export type WalletRecoveryRotationOutcome =
  | {
      readonly kind: 'rotated';
      readonly walletId: string;
      readonly recoveryCodes: readonly string[];
      readonly issuedAtMs: number;
      readonly storeVersion: string;
    }
  | Exclude<WalletRecoverySetRotateResult, { readonly kind: 'rotated' }>;

/**
 * Performs one active-factor recovery-set rotation. The worker opens the
 * existing custody envelope and reseals the same seed under a fresh manifest
 * KEK; this coordinator only transports opaque ciphertext and returns the
 * plaintext codes after the server's atomic CAS succeeds.
 */
export async function rotateWalletRecoverySetWithActiveFactorV1(input: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly factorProof: WalletRecoveryFactorProofFactory;
  readonly statusRequestId: string;
  readonly custodyEnvelope: PasskeyCustodyEnvelopeRecord;
  readonly factorSecret: ArrayBuffer;
  readonly worker: WalletRecoveryRotationWorker;
  readonly fetchImpl?: typeof fetch;
}): Promise<WalletRecoveryRotationOutcome> {
  let issued: IssuedWalletRecoveryCodes | null = issueWalletRecoveryCodes();
  const factorSecret = new Uint8Array(input.factorSecret.slice(0));
  try {
    return await rotateWithIssuedCodes(input, issued, (codeBytes) => {
      const custody = joinCustodyWireFromEnvelopeRecord(input.custodyEnvelope);
      if (!custody.ok) throw new Error(custody.reason);
      return input.worker.rotateRecoverySet({
        custodyJson: custody.custodyJson,
        factorSecret: factorSecret.buffer.slice(0),
        recoveryCodesJson: recoveryCodesJson(codeBytes),
      });
    });
  } finally {
    factorSecret.fill(0);
    if (issued) zeroizeIssuedWalletRecoveryCodes(issued);
    issued = null;
  }
}

export async function rotateWalletRecoverySetWithEmailOtpV1(input: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly factorProof: WalletRecoveryFactorProofFactory;
  readonly statusRequestId: string;
  readonly worker: EmailOtpWalletRecoveryRotationWorker;
  readonly fetchImpl?: typeof fetch;
}): Promise<WalletRecoveryRotationOutcome> {
  let issued: IssuedWalletRecoveryCodes | null = issueWalletRecoveryCodes();
  try {
    return await rotateWithIssuedCodes(input, issued, (codeBytes) =>
      input.worker.rotateRecoverySet({ recoveryCodesJson: recoveryCodesJson(codeBytes) }),
    );
  } finally {
    if (issued) zeroizeIssuedWalletRecoveryCodes(issued);
    issued = null;
  }
}

// The steps both factors share. `rotateInWorker` runs after the status read, so a wallet
// without a ready recovery set never reaches the worker.
async function rotateWithIssuedCodes(
  input: {
    readonly relayUrl: string;
    readonly walletId: string;
    readonly factorProof: WalletRecoveryFactorProofFactory;
    readonly statusRequestId: string;
    readonly fetchImpl?: typeof fetch;
  },
  issued: IssuedWalletRecoveryCodes,
  rotateInWorker: (
    codeBytes: readonly Uint8Array[],
  ) => Promise<WalletRecoverySetRotationWorkerResultV1>,
): Promise<WalletRecoveryRotationOutcome> {
  const statusPayload = { walletId: input.walletId, requestId: input.statusRequestId };
  const current = await readWalletRecoveryCodeStatus({
    relayUrl: input.relayUrl,
    walletId: input.walletId,
    requestId: input.statusRequestId,
    factorProof: await input.factorProof({
      operation: 'recovery_status',
      payload: statusPayload,
    }),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
  if (current.kind !== 'ready') {
    return current.kind === 'unauthorized'
      ? { kind: 'transport_failed', message: current.message }
      : current;
  }
  const workerResult = await rotateInWorker(issued.codeBytes);
  const replacement = walletRecoverySetRotationWireFromWorkerResultV1(workerResult);
  if (replacement.walletId !== input.walletId) {
    throw new Error('Recovery rotation worker returned a different wallet');
  }
  const recoveryCodeLocators = await deriveRecoveryCodeLocators(
    issued.codeBytes,
    replacement.manifestKekWraps,
  );
  const rotated = await rotateWalletRecoverySet({
    relayUrl: input.relayUrl,
    walletId: input.walletId,
    factorProof: await input.factorProof({
      operation: 'recovery_rotate',
      payload: {
        walletId: input.walletId,
        expectedStoreVersion: current.storeVersion,
        manifestKekWraps: replacement.manifestKekWraps,
        entries: [replacement.entry],
        recoveryCodeLocators,
      },
    }),
    expectedStoreVersion: current.storeVersion,
    replacement,
    recoveryCodeLocators,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
  if (rotated.kind !== 'rotated') return rotated;
  return {
    kind: 'rotated',
    walletId: input.walletId,
    recoveryCodes: issued.codes,
    issuedAtMs: rotated.issuedAtMs,
    storeVersion: rotated.storeVersion,
  };
}

function recoveryCodesJson(codeBytes: readonly Uint8Array[]): string {
  return JSON.stringify(codeBytes.map((bytes) => ({ codeBytesB64u: base64UrlEncode(bytes) })));
}

async function deriveRecoveryCodeLocators(
  codeBytes: readonly Uint8Array[],
  wraps: readonly { readonly recoveryKeyId: string }[],
): Promise<readonly { readonly locatorB64u: string; readonly recoveryKeyId: string }[]> {
  if (codeBytes.length !== wraps.length) {
    throw new Error('Recovery code locators do not match the replacement wraps');
  }
  const recoveryCodeLocators = await Promise.all(
    codeBytes.map(async (bytes, index) => {
      const wrap = wraps[index];
      if (!wrap) throw new Error('Recovery code locators do not match the replacement wraps');
      return {
        locatorB64u: await deriveRecoveryCodeLocatorV1FromBytes(bytes),
        recoveryKeyId: wrap.recoveryKeyId,
      };
    }),
  );
  if (
    new Set(recoveryCodeLocators.map((locator) => locator.locatorB64u)).size !==
    recoveryCodeLocators.length
  ) {
    throw new Error('Recovery code locators must be unique');
  }
  return recoveryCodeLocators;
}

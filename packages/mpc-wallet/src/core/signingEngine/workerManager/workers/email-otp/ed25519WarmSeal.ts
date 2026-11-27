import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import {
  blindNewSigningSessionSealInput,
  blindSealedSigningSessionSecret,
  callSigningSessionSealEvaluateRoute,
  discardSigningSessionSealBlind,
  openSigningSessionSecret,
  sealSigningSessionSecret,
} from '../oprf/signingSessionSeal';
import type {
  EmailOtpEd25519YaoRecoveryBootstrapV1,
  EmailOtpFactorEnrollmentV1 as EmailOtpFactorEnrollment,
} from '@/core/signingEngine/workerManager/workerTypes';
import { EMAIL_OTP_ED25519_WARM_SEAL_STORE, openEmailOtpDeviceStore } from './deviceStore';
import { bindEmailOtpEd25519YaoCapabilityWarmFactor } from './sessionState';

/**
 * The Ed25519 warm seal of the Email OTP factor key S.
 *
 * An unlock that activates a NEAR Ed25519 capability under an Email OTP Wallet Session seals S
 * under the signing-session seal of that session. The sealed value stays in this worker's store.
 * After a reload or a worker restart, the NEAR re-hydrate opens S again with the Wallet Session
 * bearer: the server evaluates one blinded element for the wallet and its Ed25519 threshold
 * session, and only while that session is live and admits Ed25519 signing. No server route
 * releases S for a bearer alone, and the sealed value is useless after its session ends.
 */

export type EmailOtpEd25519WarmSealRecord = EmailOtpFactorEnrollment & {
  readonly walletId: string;
  readonly walletSessionId: string;
  readonly thresholdSessionId: string;
  readonly sealedSecretB64u: string;
  readonly keyVersion: string;
  readonly expiresAtMs: number;
};

export type EmailOtpEd25519WarmSealStore = {
  read(walletId: string): Promise<EmailOtpEd25519WarmSealRecord | null>;
  put(record: EmailOtpEd25519WarmSealRecord): Promise<void>;
  delete(walletId: string): Promise<void>;
};

/** The Wallet Session and the Ed25519 threshold session that a warm seal belongs to. */
type EmailOtpEd25519WarmSealSession = {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly thresholdSessionId: string;
  readonly operationCredential: WalletSessionOperationCredentialV1;
};

const RECORD_STRING_FIELDS = [
  'walletId',
  'walletSessionId',
  'thresholdSessionId',
  'enrollmentId',
  'enrollmentSealKeyVersion',
  'sealedSecretB64u',
  'keyVersion',
] as const;

function parseWarmSealRecord(value: unknown): EmailOtpEd25519WarmSealRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const field of RECORD_STRING_FIELDS) {
    if (typeof record[field] !== 'string' || !record[field]) return null;
  }
  if (!Number.isSafeInteger(record.expiresAtMs) || Number(record.expiresAtMs) <= 0) return null;
  return record as EmailOtpEd25519WarmSealRecord;
}

const indexedDbWarmSealStore: EmailOtpEd25519WarmSealStore = {
  async read(walletId) {
    const database = await openEmailOtpDeviceStore();
    try {
      return parseWarmSealRecord(await database.get(EMAIL_OTP_ED25519_WARM_SEAL_STORE, walletId));
    } finally {
      database.close();
    }
  },
  async put(record) {
    const database = await openEmailOtpDeviceStore();
    try {
      await database.put(EMAIL_OTP_ED25519_WARM_SEAL_STORE, record);
    } finally {
      database.close();
    }
  },
  async delete(walletId) {
    const database = await openEmailOtpDeviceStore();
    try {
      await database.delete(EMAIL_OTP_ED25519_WARM_SEAL_STORE, walletId);
    } finally {
      database.close();
    }
  },
};

function sealScope(session: EmailOtpEd25519WarmSealSession) {
  return { walletId: session.walletId, thresholdSessionId: session.thresholdSessionId };
}

export function createEmailOtpEd25519WarmSeal(store: EmailOtpEd25519WarmSealStore) {
  return {
    /**
     * Seals S for the session and keeps the sealed value. A live seal of the same session and
     * enrollment stays, so a re-hydrate does not seal again.
     */
    async seal(
      args: EmailOtpEd25519WarmSealSession & {
        readonly enrollment: EmailOtpFactorEnrollment;
        readonly factorSecret32: Uint8Array;
      },
    ): Promise<void> {
      if (args.factorSecret32.length !== 32) {
        throw new Error('Email OTP Ed25519 warm seal requires a 32-byte factor secret');
      }
      const walletSessionId = String(args.operationCredential.walletSessionId);
      const current = await store.read(args.walletId);
      if (
        current?.walletSessionId === walletSessionId &&
        current.thresholdSessionId === args.thresholdSessionId &&
        current.enrollmentId === args.enrollment.enrollmentId &&
        current.enrollmentSealKeyVersion === args.enrollment.enrollmentSealKeyVersion &&
        current.expiresAtMs > Date.now()
      ) {
        return;
      }
      const blind = await blindNewSigningSessionSealInput();
      let blindOwned = true;
      try {
        const evaluation = await callSigningSessionSealEvaluateRoute({
          relayerUrl: args.relayUrl,
          bearerToken: args.operationCredential.token,
          thresholdSessionId: args.thresholdSessionId,
          blindedElementB64u: blind.blindedElementB64u,
        });
        if (!evaluation.ok) {
          throw new Error(`Email OTP Ed25519 warm seal failed: ${evaluation.message}`);
        }
        const expiresAtMs = evaluation.expiresAtMs;
        if (!expiresAtMs || expiresAtMs <= Date.now()) {
          throw new Error('Email OTP Ed25519 warm seal found no live Wallet Session');
        }
        blindOwned = false;
        const sealedSecretB64u = await sealSigningSessionSecret({
          blind,
          scope: sealScope(args),
          evaluation,
          secret32: args.factorSecret32,
        });
        await store.put({
          walletId: args.walletId,
          walletSessionId,
          thresholdSessionId: args.thresholdSessionId,
          enrollmentId: args.enrollment.enrollmentId,
          enrollmentSealKeyVersion: args.enrollment.enrollmentSealKeyVersion,
          sealedSecretB64u,
          keyVersion: evaluation.keyVersion,
          expiresAtMs,
        });
      } finally {
        if (blindOwned) discardSigningSessionSealBlind(blind);
      }
    },

    /** Opens S from the seal of this exact session. The caller zeroes the factor secret. */
    async open(
      args: EmailOtpEd25519WarmSealSession,
    ): Promise<EmailOtpFactorEnrollment & { readonly factorSecret32: Uint8Array }> {
      const record = await store.read(args.walletId);
      if (
        !record ||
        record.walletSessionId !== String(args.operationCredential.walletSessionId) ||
        record.thresholdSessionId !== args.thresholdSessionId
      ) {
        throw new Error('Email OTP Ed25519 warm seal is unavailable for this Wallet Session');
      }
      if (record.expiresAtMs <= Date.now()) {
        await store.delete(args.walletId);
        throw new Error('Email OTP Ed25519 warm seal expired');
      }
      const opening = await blindSealedSigningSessionSecret(record.sealedSecretB64u);
      let blindOwned = true;
      try {
        const evaluation = await callSigningSessionSealEvaluateRoute({
          relayerUrl: args.relayUrl,
          bearerToken: args.operationCredential.token,
          thresholdSessionId: args.thresholdSessionId,
          blindedElementB64u: opening.blind.blindedElementB64u,
          keyVersion: record.keyVersion,
        });
        if (!evaluation.ok) {
          throw new Error(`Email OTP Ed25519 warm seal restore failed: ${evaluation.message}`);
        }
        blindOwned = false;
        const factorSecret32 = await openSigningSessionSecret({
          opening,
          scope: sealScope(args),
          evaluation,
        });
        return {
          enrollmentId: record.enrollmentId,
          enrollmentSealKeyVersion: record.enrollmentSealKeyVersion,
          factorSecret32,
        };
      } finally {
        if (blindOwned) discardSigningSessionSealBlind(opening.blind);
      }
    },
  };
}

export const emailOtpEd25519WarmSeal = createEmailOtpEd25519WarmSeal(indexedDbWarmSealStore);

/**
 * Keeps S warm for an Ed25519 capability that an unlock opened: in this worker's memory for the
 * running session, and sealed under the session for the re-hydrate after a reload.
 */
export async function keepEmailOtpEd25519WarmFactor(args: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly bootstrap: EmailOtpEd25519YaoRecoveryBootstrapV1;
  readonly operationCredential: WalletSessionOperationCredentialV1;
  readonly enrollment: EmailOtpFactorEnrollment;
  readonly factorSecret32: Uint8Array;
}): Promise<void> {
  await emailOtpEd25519WarmSeal.seal({
    relayUrl: args.relayUrl,
    walletId: args.walletId,
    thresholdSessionId: args.bootstrap.session.thresholdSessionId,
    operationCredential: args.operationCredential,
    enrollment: args.enrollment,
    factorSecret32: args.factorSecret32,
  });
  bindEmailOtpEd25519YaoCapabilityWarmFactor({
    bootstrap: args.bootstrap,
    factorSecret32: args.factorSecret32,
    materialActivation: args.bootstrap.capability.materialActivation,
  });
}

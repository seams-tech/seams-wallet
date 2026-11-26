import type { WalletId } from '@shared/utils/registrationIntent';
import { isPlainObject } from '@shared/utils/validation';
import { alphabetizeStringify, sha256BytesUtf8 } from '@shared/utils/digests';
import { base64UrlEncode } from '@shared/utils/encoders';
import type { WalletAddSignerFinalizeResponse } from '../../../../core/registrationContracts';
import type {
  StoredWalletAddSignerFinalizeRequest,
  StoredWalletAddSignerCeremony,
} from '../../../../core/RegistrationCeremonyStore';
import {
  parseWalletIdForIntent,
  parseD1WalletAddSignerFinalizeTerminalResponse,
} from '../registration/d1RegistrationCeremonyRecords';
import {
  parseRouterAbEd25519YaoRegistrationSideEffectRecordV1,
  type RouterAbEd25519YaoRegistrationSideEffectStoreV1,
  type RouterAbEd25519YaoRegistrationSideEffectRecordV1,
} from '../../../domains/ed25519Yao/registration/routerAbEd25519YaoRegistrationSideEffectBoundary';

export type D1WalletAddSignerFinalizePreparedV1 =
  | {
      readonly walletId: WalletId;
      readonly kind: 'd1_wallet_add_signer_finalize_ed25519_prepared_v1';
      readonly finalizingAtMs: number;
      readonly signerWriteAtMs?: never;
    }
  | {
      readonly walletId: WalletId;
      readonly kind: 'd1_wallet_add_signer_finalize_ecdsa_prepared_v1';
      readonly signerWriteAtMs: number;
      readonly finalizingAtMs?: never;
    };

export type D1WalletAddSignerFinalizeSideEffectStore =
  RouterAbEd25519YaoRegistrationSideEffectStoreV1<
    WalletAddSignerFinalizeResponse,
    D1WalletAddSignerFinalizePreparedV1
  >;

export type D1WalletAddSignerFinalizeSideEffectRecord =
  RouterAbEd25519YaoRegistrationSideEffectRecordV1<
    WalletAddSignerFinalizeResponse,
    D1WalletAddSignerFinalizePreparedV1
  >;

function parseWalletAddSignerFinalizePrepared(
  raw: unknown,
): D1WalletAddSignerFinalizePreparedV1 | null {
  if (!isPlainObject(raw)) return null;
  const record = raw;
  const walletId = parseWalletIdForIntent(record.walletId);
  if (!walletId) return null;
  if (record.kind === 'd1_wallet_add_signer_finalize_ed25519_prepared_v1') {
    const finalizingAtMs = record.finalizingAtMs;
    if (
      typeof finalizingAtMs !== 'number' ||
      !Number.isSafeInteger(finalizingAtMs) ||
      finalizingAtMs <= 0
    ) {
      return null;
    }
    return {
      kind: 'd1_wallet_add_signer_finalize_ed25519_prepared_v1',
      walletId,
      finalizingAtMs,
    };
  }
  if (record.kind !== 'd1_wallet_add_signer_finalize_ecdsa_prepared_v1') return null;
  const signerWriteAtMs = record.signerWriteAtMs;
  return typeof signerWriteAtMs === 'number' &&
    Number.isSafeInteger(signerWriteAtMs) &&
    signerWriteAtMs > 0
    ? { kind: 'd1_wallet_add_signer_finalize_ecdsa_prepared_v1', walletId, signerWriteAtMs }
    : null;
}

export function parseD1WalletAddSignerFinalizeSideEffectRecord(
  raw: unknown,
): D1WalletAddSignerFinalizeSideEffectRecord | null {
  const record = parseRouterAbEd25519YaoRegistrationSideEffectRecordV1(raw, {
    operation: 'add_signer_finalize',
    parsePrepared: parseWalletAddSignerFinalizePrepared,
    parseResponse: parseD1WalletAddSignerFinalizeTerminalResponse,
  });
  if (
    record?.kind === 'router_ab_ed25519_yao_registration_side_effect_completion_v1' &&
    record.response.ok &&
    record.response.walletId !== record.prepared.walletId
  ) {
    return null;
  }
  return record;
}

export async function fingerprintD1WalletAddSignerFinalizePrepared(
  prepared: D1WalletAddSignerFinalizePreparedV1,
): Promise<string> {
  return base64UrlEncode(await sha256BytesUtf8(alphabetizeStringify(prepared)));
}

export async function returnD1WalletAddSignerFinalizePrepared(
  prepared: D1WalletAddSignerFinalizePreparedV1,
): Promise<D1WalletAddSignerFinalizePreparedV1> {
  return prepared;
}

export async function rejectUnexpectedWalletAddSignerFinalizePreparation(): Promise<never> {
  throw new Error('persisted add-signer finalize claim disappeared during reconciliation');
}

export function buildD1WalletAddSignerFinalizePrepared(input: {
  readonly request: StoredWalletAddSignerFinalizeRequest;
  readonly ceremony: StoredWalletAddSignerCeremony;
  readonly nowMs: number;
}): D1WalletAddSignerFinalizePreparedV1 {
  if (input.request.kind === 'evm_family_ecdsa') {
    return {
      walletId: input.ceremony.intent.walletId,
      kind: 'd1_wallet_add_signer_finalize_ecdsa_prepared_v1',
      signerWriteAtMs: input.nowMs,
    };
  }
  if (input.ceremony.signerState.kind === 'near_ed25519_yao_add_signer_finalizing') {
    return {
      walletId: input.ceremony.intent.walletId,
      kind: 'd1_wallet_add_signer_finalize_ed25519_prepared_v1',
      finalizingAtMs: input.ceremony.signerState.finalizingAtMs,
    };
  }
  return {
    walletId: input.ceremony.intent.walletId,
    kind: 'd1_wallet_add_signer_finalize_ed25519_prepared_v1',
    finalizingAtMs: input.nowMs,
  };
}


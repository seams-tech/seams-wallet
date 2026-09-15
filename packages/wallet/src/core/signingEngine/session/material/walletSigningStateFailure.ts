import type { MpcCapabilityHydrationBlockedReason } from './mpcCapabilityHydration';
import type { NearEd25519WalletSessionFullLoginReason } from './nearEd25519YaoSigningPreparation';

export const WALLET_SIGNING_MATERIAL_INVALID = 'wallet_signing_material_invalid' as const;
export const WALLET_FULL_LOGIN_REQUIRED = 'wallet_full_login_required' as const;
export const WALLET_SIGNING_MATERIAL_TEMPORARILY_UNAVAILABLE =
  'wallet_signing_material_temporarily_unavailable' as const;
export const WALLET_OPERATION_STEP_UP_CANCELLED =
  'wallet_operation_step_up_cancelled' as const;

export type InvalidWalletSigningMaterialReason =
  | Exclude<
      MpcCapabilityHydrationBlockedReason,
      'persistence_unavailable' | 'revoked' | 'replaced'
    >
  | 'missing_runtime'
  | 'runtime_conflict';

export type WalletFullLoginRequiredReason =
  | NearEd25519WalletSessionFullLoginReason
  | 'revoked'
  | 'replaced';

export type WalletSigningMaterialDisposition =
  | {
      readonly kind: 'invalid_material';
      readonly reason: InvalidWalletSigningMaterialReason;
    }
  | {
      readonly kind: 'full_login_required';
      readonly reason: 'revoked' | 'replaced';
    }
  | {
      readonly kind: 'temporarily_unavailable';
      readonly reason: 'persistence_unavailable';
    };

export function classifyWalletSigningMaterialBlock(
  reason: MpcCapabilityHydrationBlockedReason,
): WalletSigningMaterialDisposition {
  switch (reason) {
    case 'missing_capability':
    case 'missing_material':
    case 'authority_ambiguous':
    case 'binding_mismatch':
    case 'exact_record_conflict':
    case 'corrupt':
      return { kind: 'invalid_material', reason };
    case 'revoked':
    case 'replaced':
      return { kind: 'full_login_required', reason };
    case 'persistence_unavailable':
      return { kind: 'temporarily_unavailable', reason };
    default:
      reason satisfies never;
      throw new Error('[SigningEngine] unsupported signing material block reason');
  }
}

export class InvalidWalletSigningMaterialError extends Error {
  readonly name = 'InvalidWalletSigningMaterialError';
  readonly code = WALLET_SIGNING_MATERIAL_INVALID;

  constructor(readonly reason: InvalidWalletSigningMaterialReason) {
    super('Wallet signing material is invalid. Log in again or recover the wallet.');
  }
}

export class WalletFullLoginRequiredError extends Error {
  readonly name = 'WalletFullLoginRequiredError';
  readonly code = WALLET_FULL_LOGIN_REQUIRED;

  constructor(readonly reason: WalletFullLoginRequiredReason) {
    super('A full wallet login is required before signing.');
  }
}

export type WalletSigningStateFailure =
  | InvalidWalletSigningMaterialError
  | WalletFullLoginRequiredError;

export class WalletSigningMaterialTemporarilyUnavailableError extends Error {
  readonly name = 'WalletSigningMaterialTemporarilyUnavailableError';
  readonly code = WALLET_SIGNING_MATERIAL_TEMPORARILY_UNAVAILABLE;
  readonly reason = 'persistence_unavailable';

  constructor() {
    super('Wallet signing material storage is temporarily unavailable. Retry the operation.');
  }
}

export type WalletSigningMaterialBlockError =
  | WalletSigningStateFailure
  | WalletSigningMaterialTemporarilyUnavailableError;

export function invalidWalletSigningMaterial(
  reason: InvalidWalletSigningMaterialReason,
): InvalidWalletSigningMaterialError {
  return new InvalidWalletSigningMaterialError(reason);
}

export function fullWalletLoginRequired(
  reason: WalletFullLoginRequiredReason,
): WalletFullLoginRequiredError {
  return new WalletFullLoginRequiredError(reason);
}

export function walletSigningMaterialBlockError(
  reason: MpcCapabilityHydrationBlockedReason,
): WalletSigningMaterialBlockError {
  const disposition = classifyWalletSigningMaterialBlock(reason);
  switch (disposition.kind) {
    case 'invalid_material':
      return invalidWalletSigningMaterial(disposition.reason);
    case 'full_login_required':
      return fullWalletLoginRequired(disposition.reason);
    case 'temporarily_unavailable':
      return new WalletSigningMaterialTemporarilyUnavailableError();
    default:
      disposition satisfies never;
      throw new Error('[SigningEngine] unsupported signing material disposition');
  }
}

export class WalletOperationStepUpCancelled extends Error {
  readonly name = 'WalletOperationStepUpCancelled';
  readonly code = WALLET_OPERATION_STEP_UP_CANCELLED;

  constructor() {
    super('Request cancelled.');
  }
}

export function walletOperationStepUpCancelled(): WalletOperationStepUpCancelled {
  return new WalletOperationStepUpCancelled();
}

export function isWalletSigningStateFailure(error: unknown): error is WalletSigningStateFailure {
  return (
    error instanceof InvalidWalletSigningMaterialError ||
    error instanceof WalletFullLoginRequiredError
  );
}

import { expect, test } from '@playwright/test';
import { classifyNearEd25519WalletSessionAuthorization } from '@/core/signingEngine/session/material/nearEd25519YaoSigningPreparation';
import {
  classifyWalletSigningMaterialBlock,
  fullWalletLoginRequired,
  invalidWalletSigningMaterial,
  isWalletSigningStateFailure,
  WALLET_FULL_LOGIN_REQUIRED,
  WALLET_OPERATION_STEP_UP_CANCELLED,
  WALLET_SIGNING_MATERIAL_TEMPORARILY_UNAVAILABLE,
  WALLET_SIGNING_MATERIAL_INVALID,
  walletSigningMaterialBlockError,
  walletOperationStepUpCancelled,
} from '@/core/signingEngine/session/material/walletSigningStateFailure';

test.describe('NEAR signing authorization disposition', () => {
  test('expired and exhausted sessions require operation-scoped step-up', () => {
    expect(classifyNearEd25519WalletSessionAuthorization({ kind: 'expired' })).toEqual({
      kind: 'operation_step_up',
      reason: 'expired',
    });
    expect(classifyNearEd25519WalletSessionAuthorization({ kind: 'exhausted' })).toEqual({
      kind: 'operation_step_up',
      reason: 'exhausted',
    });
  });

  test('revoked or invalid authorization requires full login', () => {
    expect(classifyNearEd25519WalletSessionAuthorization({ kind: 'superseded' })).toEqual({
      kind: 'full_login_required',
      reason: 'superseded',
    });
    expect(classifyNearEd25519WalletSessionAuthorization({ kind: 'corrupt' })).toEqual({
      kind: 'full_login_required',
      reason: 'corrupt',
    });
  });

  test('persistence outages remain retryable without terminating wallet state', () => {
    expect(
      classifyNearEd25519WalletSessionAuthorization({ kind: 'persistence_unavailable' }),
    ).toEqual({
      kind: 'temporarily_unavailable',
      reason: 'persistence_unavailable',
    });
  });

  test('material, login, and locked-cancellation states have distinct boundary codes', () => {
    expect(invalidWalletSigningMaterial('corrupt').code).toBe(
      WALLET_SIGNING_MATERIAL_INVALID,
    );
    expect(fullWalletLoginRequired('superseded').code).toBe(WALLET_FULL_LOGIN_REQUIRED);
    const stepUpCancellation = walletOperationStepUpCancelled();
    expect(stepUpCancellation.code).toBe(WALLET_OPERATION_STEP_UP_CANCELLED);
    expect(isWalletSigningStateFailure(stepUpCancellation)).toBe(true);
  });

  test('material blocks distinguish terminal corruption, revocation, and retryable storage', () => {
    expect(classifyWalletSigningMaterialBlock('binding_mismatch')).toEqual({
      kind: 'invalid_material',
      reason: 'binding_mismatch',
    });
    expect(classifyWalletSigningMaterialBlock('revoked')).toEqual({
      kind: 'full_login_required',
      reason: 'revoked',
    });
    expect(classifyWalletSigningMaterialBlock('persistence_unavailable')).toEqual({
      kind: 'temporarily_unavailable',
      reason: 'persistence_unavailable',
    });
    expect(walletSigningMaterialBlockError('persistence_unavailable').code).toBe(
      WALLET_SIGNING_MATERIAL_TEMPORARILY_UNAVAILABLE,
    );
  });
});

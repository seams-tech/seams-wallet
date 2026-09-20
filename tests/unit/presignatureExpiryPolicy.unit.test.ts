import { expect, test } from '@playwright/test';
import { resolveRouterAbEcdsaPresignDeadlines } from '../../packages/wallet-server/src/core/ThresholdService/routerAb/ecdsaDerivationPoolFillHandlers';

test('operation step-up bounds completed presignature material to the operation expiry', () => {
  const nowMs = 1_000_000;
  const operationExpiresAtMs = nowMs + 30_000;
  const deadlines = resolveRouterAbEcdsaPresignDeadlines({
    requestedCeremonyExpiresAtMs: nowMs + 5 * 60_000,
    requestedMaterialExpiresAtMs: nowMs + 90 * 24 * 60 * 60_000,
    thresholdExpiresAtMs: operationExpiresAtMs,
    authorization: {
      kind: 'operation_step_up',
      materialExpiresAtMs: operationExpiresAtMs,
    },
    nowMs,
  });

  expect(deadlines).toEqual({
    ceremonyExpiresAtMs: operationExpiresAtMs,
    materialExpiresAtMs: operationExpiresAtMs,
  });
});

test('wallet-session presignature material uses the server-owned 90-day maximum', () => {
  const nowMs = 1_000_000;
  const deadlines = resolveRouterAbEcdsaPresignDeadlines({
    requestedCeremonyExpiresAtMs: nowMs + 10 * 60_000,
    requestedMaterialExpiresAtMs: nowMs + 91 * 24 * 60 * 60_000,
    thresholdExpiresAtMs: nowMs + 60 * 60_000,
    authorization: { kind: 'wallet_session' },
    nowMs,
  });

  expect(deadlines).toEqual({
    ceremonyExpiresAtMs: nowMs + 5 * 60_000,
    materialExpiresAtMs: nowMs + 90 * 24 * 60 * 60_000,
  });
});

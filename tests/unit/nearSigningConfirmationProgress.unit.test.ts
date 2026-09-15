import { expect, test } from '@playwright/test';
import { emitNearSigningConfirmationProgress } from '@/core/signingEngine/flows/signNear/signTransactions';
import { SigningAuthPlanKind } from '@/core/signingEngine/stepUpConfirmation/types';

const PASSKEY_REAUTH_PLAN = {
  kind: SigningAuthPlanKind.PasskeyReauth,
  method: 'passkey',
} as const;

test.describe('NEAR signing confirmation progress', () => {
  test('forwards cancellation immediately so the request surface can close', () => {
    const events: Array<Record<string, unknown>> = [];

    emitNearSigningConfirmationProgress(
      {
        onEvent: (event) => events.push(event),
        nearAccountId: 'alice.testnet',
        signingAuthPlan: PASSKEY_REAUTH_PLAN,
      },
      {
        requestId: 'confirm-near-cancelled',
        step: 2,
        phase: 'confirmation.complete',
        status: 'failed',
        message: 'User cancelled secure confirm request',
      },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      flow: 'signing',
      phase: 'signing.confirmation.cancelled',
      status: 'cancelled',
      interaction: { kind: 'transaction_confirmation', overlay: 'hide' },
    });
  });

  test('keeps the request surface visible when passkey authentication follows confirmation', () => {
    const events: Array<Record<string, unknown>> = [];

    emitNearSigningConfirmationProgress(
      {
        onEvent: (event) => events.push(event),
        nearAccountId: 'alice.testnet',
        signingAuthPlan: PASSKEY_REAUTH_PLAN,
      },
      {
        requestId: 'confirm-near-approved',
        step: 2,
        phase: 'confirmation.complete',
        status: 'succeeded',
        message: 'Confirmation complete',
      },
    );

    expect(events).toEqual([]);
  });
});

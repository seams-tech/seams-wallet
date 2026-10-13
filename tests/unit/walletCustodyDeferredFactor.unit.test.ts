import { expect, test } from '@playwright/test';
import {
  runWalletCustodyKeySetCeremony,
  type WalletCustodyCeremonyStepRunner,
} from '../../packages/wallet/src/core/signingEngine/walletCustody/ceremonyDriver';

type Step = { readonly type: string; readonly payload: unknown };

/** Records each worker step, in order, and answers as the custody worker does. */
class RecordedWorker {
  readonly steps: Step[] = [];
  readonly run = this.answer.bind(this) as WalletCustodyCeremonyStepRunner;

  private async answer(type: string, payload: { readonly ceremonyId: string }): Promise<unknown> {
    this.steps.push({ type, payload });
    switch (type) {
      case 'beginWalletCustodyKeySetRun':
        return {
          ceremonyId: payload.ceremonyId,
          keySet: 'near_ed25519_v1',
          yaoExecuteRequestJson: '{"execute":true}',
        };
      case 'finishWalletCustodyKeySetRun':
        return { walletId: 'wallet:deferred-factor' };
      default:
        return { ceremonyId: payload.ceremonyId };
    }
  }

  types(): string[] {
    return this.steps.map((step) => step.type);
  }
}

const KEY_SET = {
  keySet: 'near_ed25519_v1' as const,
  protocolInputsJson: '{}',
  nearEd25519SigningKeyId: 'near-key',
};

test('a NEAR custody run begins without its factor and takes it after the Router round', async () => {
  const worker = new RecordedWorker();
  const order: string[] = [];
  const factorSecret = new Uint8Array([7, 7, 7]).buffer;
  await runWalletCustodyKeySetCeremony({
    runStep: worker.run,
    ceremonyId: 'ceremony-deferred',
    custody: {
      origin: 'establish_factor_after_round',
      walletId: 'wallet:deferred-factor',
      recoveryCodesJson: '[]',
      factor: async () => {
        order.push('factor');
        return { factorJson: '{"factor":"passkey"}', factorSecret };
      },
    },
    keySetRun: {
      ...KEY_SET,
      runRouterRound: async (request) => {
        order.push('round');
        expect(request).toBe('{"execute":true}');
        return '{"result":true}';
      },
    },
  });
  expect(order).toEqual(['round', 'factor']);
  expect(worker.types()).toEqual([
    'beginWalletCustodyKeySetRun',
    'completeWalletCustodyKeySetRun',
    'finishWalletCustodyKeySetRun',
  ]);
  // The begin step carries no factor. The finish step seals under the one that arrived later.
  expect(worker.steps[0].payload).toEqual({
    ceremonyId: 'ceremony-deferred',
    keySet: 'near_ed25519_v1',
    custody: { origin: 'establish', walletId: 'wallet:deferred-factor' },
    protocolInputsJson: '{}',
  });
  expect(worker.steps[2].payload).toMatchObject({
    finish: { kind: 'establish', factorJson: '{"factor":"passkey"}', recoveryCodesJson: '[]' },
  });
});

test('a failed Router round discards the run and never asks for the factor', async () => {
  const worker = new RecordedWorker();
  let factorRequests = 0;
  await expect(
    runWalletCustodyKeySetCeremony({
      runStep: worker.run,
      ceremonyId: 'ceremony-refused',
      custody: {
        origin: 'establish_factor_after_round',
        walletId: 'wallet:deferred-factor',
        recoveryCodesJson: '[]',
        factor: async () => {
          factorRequests += 1;
          return { factorJson: '{}', factorSecret: new ArrayBuffer(1) };
        },
      },
      keySetRun: {
        ...KEY_SET,
        runRouterRound: async () => {
          throw new Error('The passkey prompt was dismissed');
        },
      },
    }),
  ).rejects.toThrow('The passkey prompt was dismissed');
  expect(factorRequests).toBe(0);
  expect(worker.types()).toEqual(['beginWalletCustodyKeySetRun', 'discardWalletCustodyCeremony']);
});

test('a factor that fails to arrive discards the run after its round', async () => {
  const worker = new RecordedWorker();
  await expect(
    runWalletCustodyKeySetCeremony({
      runStep: worker.run,
      ceremonyId: 'ceremony-no-factor',
      custody: {
        origin: 'establish_factor_after_round',
        walletId: 'wallet:deferred-factor',
        recoveryCodesJson: '[]',
        factor: async () => {
          throw new Error('The passkey returned no PRF output');
        },
      },
      keySetRun: { ...KEY_SET, runRouterRound: async () => '{"result":true}' },
    }),
  ).rejects.toThrow('The passkey returned no PRF output');
  expect(worker.types()).toEqual([
    'beginWalletCustodyKeySetRun',
    'completeWalletCustodyKeySetRun',
    'discardWalletCustodyCeremony',
  ]);
});

test('an EVM custody run refuses a factor that arrives after its round', async () => {
  const worker = new RecordedWorker();
  await expect(
    runWalletCustodyKeySetCeremony({
      runStep: worker.run,
      custody: {
        origin: 'establish_factor_after_round',
        walletId: 'wallet:deferred-factor',
        recoveryCodesJson: '[]',
        factor: async () => ({ factorJson: '{}', factorSecret: new ArrayBuffer(1) }),
      },
      keySetRun: {
        keySet: 'evm_family_ecdsa_v1',
        protocolInputsJson: '{}',
        evmFamilySigningKeySlotId: 'slot',
        beforeRelayerRound: async () => undefined,
        runRelayerRound: async () => '{}',
      },
    }),
  ).rejects.toThrow('seals under its factor before the relayer round');
  expect(worker.steps).toEqual([]);
});

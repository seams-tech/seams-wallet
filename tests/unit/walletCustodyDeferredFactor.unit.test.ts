import { expect, test } from '@playwright/test';
import {
  runWalletCustodyKeySetCeremony,
  type WalletCustodyCeremonyStepRunner,
} from '../../packages/wallet/src/core/signingEngine/walletCustody/ceremonyDriver';

/** Records which worker steps ran, and answers as the custody worker does. */
class RecordedWorker {
  readonly types: string[] = [];
  readonly run = this.answer.bind(this) as WalletCustodyCeremonyStepRunner;

  private async answer(type: string, payload: { readonly ceremonyId: string }): Promise<unknown> {
    this.types.push(type);
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
}

const KEY_SET = {
  keySet: 'near_ed25519_v1' as const,
  protocolInputsJson: '{}',
  nearEd25519SigningKeyId: 'near-key',
};

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
  expect(worker.types).toContain('discardWalletCustodyCeremony');
  expect(worker.types).not.toContain('finishWalletCustodyKeySetRun');
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
  expect(worker.types).toContain('discardWalletCustodyCeremony');
  expect(worker.types).not.toContain('finishWalletCustodyKeySetRun');
});

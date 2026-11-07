import React from 'react';
import { functionCall, type ActionResult } from '@seams/wallet';
import { useSeams } from '@seams/wallet/react';

type Seams = ReturnType<typeof useSeams>['seams'];
type TransferResult = Awaited<
  ReturnType<NonNullable<Seams['speakToSign']>['requestTransfer']>
>;
type VaultCall = {
  walletId: string;
  nearAccountId: string;
  method: string;
  args: Record<string, unknown>;
  depositYocto: string;
};

declare global {
  interface Window {
    __seamsIntendedSpeakToSign?: {
      /** One owner call on the configured vault, signed and sent by the Wallet. */
      callVault(input: VaultCall): Promise<ActionResult>;
      readNearAccountState(walletId: string): Promise<unknown>;
      requestTransfer(input: {
        walletId: string;
        receiver: string;
        amount: string;
      }): Promise<TransferResult>;
    };
  }
}

/** Installs the live Speak-to-Sign helpers when the app configures the descriptor. */
export function SpeakToSignHelpers(): null {
  const { seams } = useSeams();
  React.useEffect(installHelpers.bind(null, seams), [seams]);
  return null;
}

function installHelpers(seams: Seams): () => void {
  const speakToSign = seams.speakToSign;
  if (!speakToSign) return uninstall;
  window.__seamsIntendedSpeakToSign = {
    callVault: callVault.bind(null, seams, speakToSign.vault),
    readNearAccountState: (walletId) => seams.registration.getNearAccountState({ walletId }),
    requestTransfer: speakToSign.requestTransfer,
  };
  return uninstall;
}

function uninstall(): void {
  delete window.__seamsIntendedSpeakToSign;
}

async function callVault(seams: Seams, vault: string, input: VaultCall): Promise<ActionResult> {
  return await seams.near.signAndSendTransaction({
    walletSession: input.walletId,
    nearAccount: input.nearAccountId,
    receiverId: vault,
    actions: [
      functionCall({
        method: input.method,
        args: input.args,
        gas: '30000000000000',
        deposit: input.depositYocto,
      }),
    ],
    options: {
      confirmationConfig: { uiMode: 'modal', behavior: 'requireClick' },
      waitUntil: 'FINAL',
    },
  });
}

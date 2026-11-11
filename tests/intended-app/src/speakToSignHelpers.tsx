import React from 'react';
import { useSeams } from '@seams/wallet/react';

type Seams = ReturnType<typeof useSeams>['seams'];
type Spoken = NonNullable<Seams['near']['spoken']>;
type TransferResult = Awaited<ReturnType<Spoken['transfer']>>;
type EnrollmentResult = Awaited<ReturnType<Spoken['enroll']>>;

declare global {
  interface Window {
    __seamsIntendedSpeakToSign?: {
      readNearAccountState(walletId: string): Promise<unknown>;
      requestTransfer(input: {
        walletId: string;
        receiver: string;
        amount: string;
      }): Promise<TransferResult>;
      enroll(input: { walletId: string }): Promise<EnrollmentResult>;
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
  const spoken = seams.near.spoken;
  if (!spoken) return uninstall;
  window.__seamsIntendedSpeakToSign = {
    readNearAccountState: (walletId) => seams.registration.getNearAccountState({ walletId }),
    requestTransfer: ({ walletId, receiver, amount }) =>
      spoken.transfer({ walletSession: walletId, receiver, amount }),
    enroll: ({ walletId }) => spoken.enroll({ walletSession: walletId }),
  };
  return uninstall;
}

function uninstall(): void {
  delete window.__seamsIntendedSpeakToSign;
}

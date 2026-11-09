import React from 'react';
import { useSeams } from '@seams/wallet/react';

type Seams = ReturnType<typeof useSeams>['seams'];
type SpeakToSign = NonNullable<Seams['speakToSign']>;
type TransferResult = Awaited<ReturnType<SpeakToSign['requestTransfer']>>;
type EnrollmentResult = Awaited<ReturnType<SpeakToSign['enroll']>>;

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
  const speakToSign = seams.speakToSign;
  if (!speakToSign) return uninstall;
  window.__seamsIntendedSpeakToSign = {
    readNearAccountState: (walletId) => seams.registration.getNearAccountState({ walletId }),
    requestTransfer: speakToSign.requestTransfer,
    enroll: speakToSign.enroll,
  };
  return uninstall;
}

function uninstall(): void {
  delete window.__seamsIntendedSpeakToSign;
}

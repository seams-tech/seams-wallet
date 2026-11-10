import {
  SeamsWeb,
  type SeamsConfigsInput,
  type SpeakToSignCapability,
  type SpeakToSignFeaturePlugin,
  type SpeakToSignTransferResult,
  type WalletTransactionFeaturePlugin,
} from '@seams/wallet';
import type { SPEAK_TO_SIGN_HOST_API_VERSION } from '../../packages/wallet/src/core/transactionFeatures/hostPlugin';
import type { VOICE_ID_HOST_API_VERSION } from '../../packages/wallet/src/core/authMethods/hostPlugin';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

declare const base: SeamsConfigsInput;
const feature: SpeakToSignFeaturePlugin = { kind: 'speak_to_sign', network: 'testnet' };
const seams = new SeamsWeb({ ...base, transactionFeatures: [feature] });

// The property has the capability type, and it is optional: the constructor sets it only
// when the config holds the descriptor.
const propertyChecks: [
  Expect<Equal<SeamsWeb['speakToSign'], SpeakToSignCapability | undefined>>,
  Expect<Equal<{} extends Pick<SeamsWeb, 'speakToSign'> ? true : false, true>>,
  Expect<Equal<Readonly<Pick<SeamsWeb, 'speakToSign'>>, Pick<SeamsWeb, 'speakToSign'>>>,
] = [true, true, true];
void propertyChecks;

const transfer = { walletId: 'alice.testnet', receiver: 'bob.testnet', amount: '2.5' } as const;
// @ts-expect-error An app must check that the capability exists before it calls it.
void seams.speakToSign.requestTransfer(transfer);
if (seams.speakToSign) {
  void seams.speakToSign.requestTransfer(transfer);
  // @ts-expect-error A spoken payment names its receiver and its amount.
  void seams.speakToSign.requestTransfer({ walletId: 'alice.testnet' });
  const network: 'testnet' | 'mainnet' = seams.speakToSign.network;
  void network;
  void seams.speakToSign.requestTransfer(transfer).then((result) => {
    // A sent payment names how the owner approved it.
    if (result.kind === 'sent') {
      const approval: 'voice' | 'voice_and_passkey' = result.approval;
      void approval;
    }
  });
  const enrollment = seams.speakToSign.enroll({ walletId: 'alice.testnet' });
  void enrollment.then((result) => {
    // An enrollment names the template epoch; no transaction authorizes it.
    if (result.kind === 'enrolled') {
      const epoch: number = result.templateEpoch;
      // @ts-expect-error The enrollment authorization is a signed message, not a transaction.
      const hash: string = result.transactionHash;
      void [epoch, hash];
    }
  });
  const bet = {
    walletId: 'alice.testnet',
    contract: 'pm-notes.testnet',
    token: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
    marketId: 9,
    amount: '0.5',
  } as const;
  void seams.speakToSign.requestBet({ ...bet, outcome: 'yes' });
  // @ts-expect-error A bet backs "yes" or "no".
  void seams.speakToSign.requestBet({ ...bet, outcome: 'maybe' });
  // @ts-expect-error A spoken bet names its token; the Wallet accepts only the network's USDC.
  void seams.speakToSign.requestBet({ ...bet, outcome: 'no', token: undefined });
  // @ts-expect-error The Wallet reads the owner itself; the app cannot name one.
  void seams.speakToSign.enroll({ walletId: 'alice.testnet', owner: 'victim.testnet' });
}
// @ts-expect-error The app cannot set the capability.
seams.speakToSign = undefined;

// @ts-expect-error The network is testnet or mainnet.
const betanetFeature: SpeakToSignFeaturePlugin = { kind: 'speak_to_sign', network: 'betanet' };
// @ts-expect-error A spoken payment comes from the owner's own account; there is no vault.
const vaultFeature: SpeakToSignFeaturePlugin = { kind: 'speak_to_sign', vault: 'vault.testnet', network: 'testnet' };
void [betanetFeature, vaultFeature];
// @ts-expect-error A browser callback cannot cross into the wallet iframe.
const callbackFeature: WalletTransactionFeaturePlugin = { ...feature, load: async () => ({}) };
void callbackFeature;
// @ts-expect-error A transaction feature needs an exact known kind.
const unknownFeature: WalletTransactionFeaturePlugin = { kind: 'voiceid', network: 'testnet' };
void unknownFeature;

// @ts-expect-error An unavailable result names its reason.
const reasonless: SpeakToSignTransferResult = { kind: 'unavailable' };
void reasonless;

declare const hostVersion: typeof SPEAK_TO_SIGN_HOST_API_VERSION;
// @ts-expect-error Speak-to-Sign has its own host API version, separate from VoiceID's.
const sharedVersion: typeof VOICE_ID_HOST_API_VERSION = hostVersion;
void sharedVersion;

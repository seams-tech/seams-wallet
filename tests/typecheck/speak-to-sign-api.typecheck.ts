import {
  SeamsWeb,
  type SeamsConfigsInput,
  type SpeakToSignCapability,
  type SpeakToSignFeaturePlugin,
  type SpeakToSignResult,
  type SpeakToSignSentTransaction,
  type WalletTransactionFeaturePlugin,
} from '@seams/wallet';
import type { SPEAK_TO_SIGN_HOST_API_VERSION } from '../../packages/wallet/src/core/transactionFeatures/hostPlugin';
import type { VOICE_ID_HOST_API_VERSION } from '../../packages/wallet/src/core/authMethods/hostPlugin';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

declare const base: SeamsConfigsInput;
const feature: SpeakToSignFeaturePlugin = { kind: 'speak_to_sign', network: 'testnet' };
const seams = new SeamsWeb({ ...base, transactionFeatures: [feature] });

// `near.speakToSign` has the capability type, and it is optional: the constructor sets it only
// when the config holds the descriptor. The SDK has no top-level `speakToSign`.
const propertyChecks: [
  Expect<Equal<SeamsWeb['near']['speakToSign'], SpeakToSignCapability | undefined>>,
  Expect<Equal<'speakToSign' extends keyof SeamsWeb ? true : false, false>>,
] = [true, true];
void propertyChecks;

const voice = seams.near.speakToSign;
const transfer = { walletId: 'alice.testnet', receiver: 'bob.testnet', amount: '2.5' } as const;
const transaction = { receiverId: 'guest-book.testnet', actions: [] };
// @ts-expect-error An app must check that the capability exists before it calls it.
void voice.typed.transfer(transfer);
if (voice) {
  const network: 'testnet' | 'mainnet' = voice.network;
  void network;
  // Each signing call has the name of the `seams.near` call that it replaces, and an approved
  // result holds what that call returns.
  void voice
    .signAndSendTransaction({ walletId: 'alice.testnet', transaction, summary: 'Sign the guest book.' })
    .then((result) => {
      if (result.kind === 'approved') {
        const hash: string = result.result.transactionHash;
        const approval: 'voice' | 'voice_and_passkey' = result.approval;
        void [hash, approval];
      }
      // @ts-expect-error The success of every signing call is `approved`.
      if (result.kind === 'sent') void result;
    });
  // @ts-expect-error A spoken transaction needs the summary that the owner says.
  void voice.signAndSendTransaction({ walletId: 'alice.testnet', transaction });
  void voice
    .signTransaction({ walletId: 'alice.testnet', transaction, summary: 'Sign the guest book.' })
    .then((result) => {
      if (result.kind === 'approved') {
        const signed: Awaited<ReturnType<SeamsWeb['near']['signTransaction']>> = result.result;
        void signed;
      }
    });
  void voice
    .signDelegateAction({
      walletId: 'alice.testnet',
      delegate: { ...transaction, nonce: 1n, maxBlockHeight: 2, publicKey: 'ed25519:key' },
      summary: 'Sign the guest book.',
    })
    .then((result) => {
      if (result.kind === 'approved') {
        const signed: Awaited<ReturnType<SeamsWeb['near']['signDelegateAction']>> = result.result;
        void signed;
      }
    });
  // @ts-expect-error The Wallet sets the sender of a delegate action; the app cannot name one.
  void voice.signDelegateAction({ walletId: 'alice.testnet', delegate: { ...transaction, senderId: 'victim.testnet', nonce: 1, maxBlockHeight: 2, publicKey: 'ed25519:key' }, summary: 'Sign' });
  void voice
    .signMessage({
      walletId: 'alice.testnet',
      message: 'Log in to example.app',
      recipient: 'example.app',
      summary: 'Log in to the example app',
    })
    .then((result) => {
      if (result.kind === 'approved') {
        const signature: string = result.result.signature;
        // @ts-expect-error A signed message is not a transaction.
        const hash: string = result.result.transactionHash;
        void [signature, hash];
      }
    });

  // The typed calls: the sentence comes from the request fields.
  void voice.typed.transfer(transfer).then((result) => {
    if (result.kind === 'refused' && result.reason === 'receiver_missing') void result;
  });
  // @ts-expect-error A spoken payment names its receiver and its amount.
  void voice.typed.transfer({ walletId: 'alice.testnet' });
  const bet = {
    walletId: 'alice.testnet',
    contract: 'pm-notes.testnet',
    token: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
    marketId: 9,
    amount: '0.5',
  } as const;
  void voice.typed.bet({ ...bet, outcome: 'yes' });
  // @ts-expect-error A bet backs "yes" or "no".
  void voice.typed.bet({ ...bet, outcome: 'maybe' });
  // @ts-expect-error A spoken bet names its token; the Wallet accepts only the network's USDC.
  void voice.typed.bet({ ...bet, outcome: 'no', token: undefined });

  void voice.enroll({ walletId: 'alice.testnet' }).then((result) => {
    // An enrollment names the template epoch; no transaction authorizes it.
    if (result.kind === 'enrolled') {
      const epoch: number = result.templateEpoch;
      // @ts-expect-error The enrollment authorization is a signed message, not a transaction.
      const hash: string = result.transactionHash;
      void [epoch, hash];
    }
  });
  // @ts-expect-error The Wallet reads the owner itself; the app cannot name one.
  void voice.enroll({ walletId: 'alice.testnet', owner: 'victim.testnet' });
}
// @ts-expect-error The app cannot set the capability.
seams.near.speakToSign = undefined;

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
const reasonless: SpeakToSignResult<SpeakToSignSentTransaction> = { kind: 'unavailable' };
void reasonless;

declare const hostVersion: typeof SPEAK_TO_SIGN_HOST_API_VERSION;
// @ts-expect-error Speak-to-Sign has its own host API version, separate from VoiceID's.
const sharedVersion: typeof VOICE_ID_HOST_API_VERSION = hostVersion;
void sharedVersion;

// The plugin's operations take no request: `record` nothing, `verify` one clip handle, and
// `sign` the verifier output and the hooks. Core bound the request before it made them.
type ApprovalOperations = import('../../packages/wallet/src/core/transactionFeatures/hostPlugin').SpeakToSignApprovalOperations;
const recordArity: Parameters<ApprovalOperations['record']>['length'] = 0;
const verifyArity: Parameters<ApprovalOperations['verify']>['length'] = 1;
const signArity: Parameters<ApprovalOperations['sign']>['length'] = 2;
void [recordArity, verifyArity, signArity];
declare const approvalOperations: ApprovalOperations;
// @ts-expect-error A clip handle has no audio: the plugin cannot pass bytes to `verify`.
void approvalOperations.verify({ kind: 'captured', speechMs: 1, endOfSpeechAt: 1, wav: new Uint8Array(1) });

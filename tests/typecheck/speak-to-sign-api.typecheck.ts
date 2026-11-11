import {
  SeamsWeb,
  spoken,
  type SeamsConfigsInput,
  type SpokenApprovalPlugin,
  type SpokenCalls,
  type SpeakToSignResult,
  type SpeakToSignSentTransaction,
  type WalletApprovalPlugin,
} from '@seams/wallet';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

declare const base: SeamsConfigsInput;
const feature: SpokenApprovalPlugin = spoken({ network: 'testnet' });
const seams = new SeamsWeb({ ...base, approvals: [feature] });
// @ts-expect-error The configuration key is `approvals`.
void new SeamsWeb({ ...base, transactionFeatures: [feature] });

// `near.spoken` is optional: the constructor sets it only when `approvals` holds the descriptor.
// The SDK has no `speakToSign` object.
const propertyChecks: [
  Expect<Equal<SeamsWeb['near']['spoken'], SpokenCalls | undefined>>,
  Expect<Equal<'speakToSign' extends keyof SeamsWeb['near'] ? true : false, false>>,
  Expect<Equal<'speakToSign' extends keyof SeamsWeb ? true : false, false>>,
] = [true, true, true];
void propertyChecks;

const transaction = { receiverId: 'guest-book.testnet', actions: [] };
const approval = { kind: 'spoken', summary: 'Sign the guest book.' } as const;

// The normal sign calls take `approval`. An approved result holds what the call without
// `approval` returns, and a refusal is a result, not an exception.
void seams.near.signAndSendTransaction({ ...transaction, approval }).then((result) => {
  if (result.kind === 'approved') {
    const hash: string = result.result.transactionHash;
    const how: 'voice' | 'voice_and_passkey' = result.approval;
    void [hash, how];
  }
  // @ts-expect-error The success of every spoken call is `approved`.
  if (result.kind === 'sent') void result;
});
// Without `approval` the call is the normal call, with its normal result.
void seams.near.signAndSendTransaction(transaction).then((result) => {
  const succeeded: boolean = result.success;
  // @ts-expect-error The normal result is not a spoken result: it has no `approved` kind.
  if (result.kind === 'approved') void succeeded;
});
// @ts-expect-error A spoken approval needs the summary that the owner says.
void seams.near.signAndSendTransaction({ ...transaction, approval: { kind: 'spoken' } });
// @ts-expect-error `spoken` is the only kind of approval.
void seams.near.signAndSendTransaction({ ...transaction, approval: { kind: 'typed', summary: 'x' } });
// The wallet is optional, as for the normal call.
void seams.near.signAndSendTransaction({ ...transaction, approval, walletSession: 'alice.testnet' });
void seams.near.signTransaction({ transaction, approval }).then((result) => {
  if (result.kind === 'approved') {
    const signed: { signedTransaction: unknown } = result.result;
    void signed;
  }
});
void seams.near
  .signDelegateAction({
    delegate: { ...transaction, nonce: 1n, maxBlockHeight: 2, publicKey: 'ed25519:key' },
    approval,
  })
  .then((result) => {
    if (result.kind === 'approved') void result.result;
  });
void seams.near
  .signMessage({
    params: { message: 'Log in to example.app', recipient: 'example.app' },
    approval: { kind: 'spoken', summary: 'Log in to the example app' },
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
const voice = seams.near.spoken;
const transfer = { receiver: 'bob.testnet', amount: '2.5' } as const;
// @ts-expect-error An app must check that `spoken` exists before it calls it.
void voice.transfer(transfer);
if (voice) {
  const network: 'testnet' | 'mainnet' = voice.network;
  void network;
  void voice.transfer(transfer).then((result) => {
    if (result.kind === 'refused' && result.reason === 'receiver_missing') void result;
  });
  void voice.transfer({ ...transfer, walletSession: 'alice.testnet' });
  // @ts-expect-error A spoken payment names its receiver and its amount.
  void voice.transfer({});
  // @ts-expect-error The call names the wallet with `walletSession`, as the normal calls do.
  void voice.transfer({ ...transfer, walletId: 'alice.testnet' });
  const bet = {
    contract: 'pm-notes.testnet',
    token: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
    marketId: 9,
    amount: '0.5',
  } as const;
  void voice.bet({ ...bet, outcome: 'yes' });
  // @ts-expect-error A bet backs "yes" or "no".
  void voice.bet({ ...bet, outcome: 'maybe' });
  // @ts-expect-error A spoken bet names its token; the Wallet accepts only the network's USDC.
  void voice.bet({ ...bet, outcome: 'no', token: undefined });

  void voice.enroll().then((result) => {
    // An enrollment names the template epoch; no transaction authorizes it.
    if (result.kind === 'enrolled') {
      const epoch: number = result.templateEpoch;
      // @ts-expect-error The enrollment authorization is a signed message, not a transaction.
      const hash: string = result.transactionHash;
      void [epoch, hash];
    }
  });
  // @ts-expect-error The Wallet reads the owner itself; the app cannot name one.
  void voice.enroll({ owner: 'victim.testnet' });
}
// @ts-expect-error The app cannot set the capability.
seams.near.spoken = undefined;

// @ts-expect-error The network is testnet or mainnet.
const betanetFeature: SpokenApprovalPlugin = { kind: 'spoken', network: 'betanet' };
// @ts-expect-error A spoken payment comes from the owner's own account; there is no vault.
const vaultFeature: SpokenApprovalPlugin = { kind: 'spoken', vault: 'vault.testnet', network: 'testnet' };
void [betanetFeature, vaultFeature];
// @ts-expect-error A browser callback cannot cross into the wallet iframe.
const callbackFeature: WalletApprovalPlugin = { ...feature, load: async () => ({}) };
void callbackFeature;
// @ts-expect-error An approval needs an exact known kind.
const unknownFeature: WalletApprovalPlugin = { kind: 'voiceid', network: 'testnet' };
void unknownFeature;

// @ts-expect-error An unavailable result names its reason.
const reasonless: SpeakToSignResult<SpeakToSignSentTransaction> = { kind: 'unavailable' };
void reasonless;

// The approver's operations take no request: `record` nothing, `verify` one clip handle, and
// `sign` the verifier output and the hooks. Core bound the request before it made them.
type ApprovalOperations = import('../../packages/wallet/src/core/transactionFeatures/hostPlugin').SpeakToSignApprovalOperations;
const recordArity: Parameters<ApprovalOperations['record']>['length'] = 0;
const verifyArity: Parameters<ApprovalOperations['verify']>['length'] = 1;
const signArity: Parameters<ApprovalOperations['sign']>['length'] = 2;
void [recordArity, verifyArity, signArity];
declare const approvalOperations: ApprovalOperations;
// @ts-expect-error A clip handle has no audio: the plugin cannot pass bytes to `verify`.
void approvalOperations.verify({ kind: 'captured', speechMs: 1, endOfSpeechAt: 1, wav: new Uint8Array(1) });

// The descriptor comes from `@seams/wallet`. An app installs no plugin package.
// @ts-expect-error The network is testnet or mainnet.
spoken({ network: 'betanet' });
// @ts-expect-error A spoken payment comes from the owner's own account; there is no vault.
spoken({ vault: 'vault.testnet', network: 'testnet' });

import {
  SeamsWeb,
  defineSeamsConfig,
  type SeamsConfigsInput,
  type SpeakToSignTransferResult,
  type WalletTransactionFeaturePlugin,
} from '@seams/wallet';
import { speakToSign } from '../../packages/speak-to-sign/src/descriptor';
import * as host from '../../packages/speak-to-sign/src/host';
import type { SPEAK_TO_SIGN_HOST_API_VERSION } from '../../packages/wallet/src/core/transactionFeatures/hostPlugin';
import type { VOICE_ID_HOST_API_VERSION } from '../../packages/wallet/src/core/authMethods/hostPlugin';

declare const base: Omit<SeamsConfigsInput, 'transactionFeatures'>;
declare const widened: SeamsConfigsInput;
const feature = speakToSign({ vault: 'vault.testnet', network: 'testnet' });

const configured = new SeamsWeb({ ...base, transactionFeatures: [feature] });
void configured.speakToSign.requestTransfer({ walletId: 'alice.testnet' });
const vault: string = configured.speakToSign.vault;
void vault;

const defined = new SeamsWeb(
  defineSeamsConfig({
    walletOrigin: 'https://wallet.example.test',
    relayerUrl: 'https://relay.example.test',
    publishableKey: 'pk_test',
    transactionFeatures: [feature],
  }),
);
void defined.speakToSign;

const plain = new SeamsWeb(base);
// @ts-expect-error Without the descriptor the app API has no Speak-to-Sign.
void plain.speakToSign;
const empty = new SeamsWeb({ ...base, transactionFeatures: [] });
// @ts-expect-error An empty feature list adds no Speak-to-Sign.
void empty.speakToSign;
const unknown = new SeamsWeb(widened);
// @ts-expect-error A feature list of unknown contents cannot promise Speak-to-Sign.
void unknown.speakToSign;
const plainDefined = new SeamsWeb(
  defineSeamsConfig({
    walletOrigin: 'https://wallet.example.test',
    relayerUrl: 'https://relay.example.test',
    publishableKey: 'pk_test',
  }),
);
// @ts-expect-error defineSeamsConfig without the descriptor adds no Speak-to-Sign.
void plainDefined.speakToSign;
const contextValue: SeamsWeb = configured;
// @ts-expect-error The default SeamsWeb type, used by shared code, has no feature API.
void contextValue.speakToSign;

// @ts-expect-error The vault network is testnet or mainnet.
speakToSign({ vault: 'vault.testnet', network: 'betanet' });
// @ts-expect-error A browser callback cannot cross into the wallet iframe.
const callbackFeature: WalletTransactionFeaturePlugin = { ...feature, load: async () => ({}) };
void callbackFeature;
// @ts-expect-error A transaction feature needs an exact known kind.
const unknownFeature: WalletTransactionFeaturePlugin = { kind: 'voiceid', vault: 'v', network: 'testnet' };
void unknownFeature;

// @ts-expect-error An unavailable result names its reason.
const reasonless: SpeakToSignTransferResult = { kind: 'unavailable' };
void reasonless;

const hostVersion: typeof SPEAK_TO_SIGN_HOST_API_VERSION = host.hostApiVersion;
void hostVersion;
// @ts-expect-error Speak-to-Sign has its own host API version, separate from VoiceID's.
const sharedVersion: typeof VOICE_ID_HOST_API_VERSION = host.hostApiVersion;
void sharedVersion;

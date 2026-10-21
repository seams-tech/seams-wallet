import type { NearCommands } from '../../packages/wallet/src/SeamsWeb/publicApi/nearCommands';
import type { EvmFamilyCommands } from '../../packages/wallet/src/SeamsWeb/publicApi/evmFamilyCommands';
import type { WalletRegistrationCommand } from '../../packages/wallet/src/SeamsWeb/publicApi/createPublicApi';
import type { ThresholdEd25519ComputeNep413SigningDigestRequest } from '../../packages/wallet/src/core/types/signer-worker';

declare const nep413Digest: ThresholdEd25519ComputeNep413SigningDigestRequest;
const nep413WithState: ThresholdEd25519ComputeNep413SigningDigestRequest = {
  message: 'hi',
  recipient: 'myapp.com',
  nonce: 'nonce',
  callbackUrl: null,
  // @ts-expect-error The signed payload excludes response transport state.
  state: 'transport',
};
const nep413SpreadState: ThresholdEd25519ComputeNep413SigningDigestRequest = {
  ...nep413Digest,
  // @ts-expect-error A broad spread cannot add transport state to a signed payload.
  state: 'transport',
};
// @ts-expect-error The internal request records an explicit callback choice.
const nep413MissingCallback: ThresholdEd25519ComputeNep413SigningDigestRequest = {
  message: 'hi',
  recipient: 'myapp.com',
  nonce: 'nonce',
};
void nep413WithState;
void nep413SpreadState;
void nep413MissingCallback;

declare const near: NearCommands;
declare const evm: EvmFamilyCommands;
declare const nearInput: Parameters<NearCommands['signAndSendTransaction']>[0];
declare const evmInput: Parameters<EvmFamilyCommands['signEvmFamily']>[0];
declare const missingNearSubject: Omit<typeof nearInput, 'walletSession' | 'nearAccount'>;
declare const missingEvmSubject: Omit<typeof evmInput, 'walletSession'>;

// @ts-expect-error Internal commands require the resolved wallet and NEAR account.
near.signAndSendTransaction(missingNearSubject);
// @ts-expect-error A broad spread cannot replace a resolved subject with undefined.
near.signAndSendTransaction({ ...nearInput, walletSession: undefined });
// @ts-expect-error A broad spread cannot remove the resolved NEAR account.
near.signAndSendTransaction({ ...nearInput, nearAccount: undefined });
// @ts-expect-error Signing commands require a resolved wallet session.
evm.signEvmFamily(missingEvmSubject);
// @ts-expect-error Signing commands require a concrete chain target.
evm.signEvmFamily({ ...evmInput, chainTarget: undefined });

import {
  createDevicesCapability,
  type DeviceCommands,
} from '../../packages/wallet/src/SeamsWeb/publicApi/devices';
import { DeviceLinkingDomain } from '../../packages/wallet/src/SeamsWeb/operations/devices/linkDevice';
import type { DeviceLinkingWebContext } from '../../packages/wallet/src/SeamsWeb/signingSurface/types';
declare const devices: DeviceCommands;
declare const getContext: () => DeviceLinkingWebContext;
// @ts-expect-error Host linking requires authenticated ports.
new DeviceLinkingDomain({ getContext });
// @ts-expect-error Every device facade requires a cancellation command.
createDevicesCapability({ ...devices, cancelLinking: undefined });
// @ts-expect-error Device inventory cannot own an implicit unlock path.
createDevicesCapability({ ...devices, ownerSessionRenewal: {} });

import type { ClientPreferenceState } from '../../packages/wallet/src/SeamsWeb/walletIframe/client/preferenceState';
import type { PreferencesCapability } from '../../packages/wallet/src/SeamsWeb/publicApi/types';
declare const preferenceState: ClientPreferenceState;
declare const preferences: PreferencesCapability;
const preferenceFlush: Promise<void> = preferences.flush();
void preferenceFlush;
// @ts-expect-error A host preference update must identify its target, including null for defaults.
preferenceState.applyWalletHostConfirmationConfig({
  confirmationConfig: preferences.getConfirmationConfig(),
});

import type { SeamsWeb } from '../../packages/wallet/src/SeamsWeb/SeamsWeb';
declare const applicationClient: SeamsWeb;
declare const registrationCommand: WalletRegistrationCommand;
const registrationWithDefaults = {
  authMethod: registrationCommand.authMethod,
};
void applicationClient.registration.registerWallet(registrationWithDefaults);
// @ts-expect-error Defaults must be resolved before internal registration commands.
const unresolvedRegistration: WalletRegistrationCommand = registrationWithDefaults;
const missingRegistrationWallet: WalletRegistrationCommand = {
  ...registrationCommand,
  // @ts-expect-error A broad spread cannot erase the internal wallet selection.
  wallet: undefined,
};
void unresolvedRegistration;
void missingRegistrationWallet;
const missingRegistrationSigners: WalletRegistrationCommand = {
  ...registrationCommand,
  // @ts-expect-error Internal commands require a resolved signer selection.
  signerSelection: undefined,
};
void missingRegistrationSigners;
applicationClient.config.setTheme('dark');
applicationClient.config.setAppearance({ theme: { id: 'default', mode: 'light' } });
applicationClient.config.chainTarget('tempo-testnet');
applicationClient.config.configuredChainTargets();
// @ts-expect-error Configuration calls are grouped under config.
applicationClient.setTheme('dark');
// @ts-expect-error Appearance has one public entry point.
applicationClient.setAppearance({ theme: { id: 'default', mode: 'light' } });
// @ts-expect-error Chain selection is grouped under config.
applicationClient.chainTarget('tempo-testnet');
// @ts-expect-error Configured chain inventory is grouped under config.
applicationClient.configuredChainTargets();
// @ts-expect-error The current theme is a read-only projection of appearance.
applicationClient.theme = 'dark';
// @ts-expect-error Application clients cannot expose wallet-origin execution contexts.
applicationClient.getContext();


import { WalletHostRuntime } from '../../packages/wallet/src/SeamsWeb/walletIframe/host/WalletHostRuntime';
import type { WalletHostConfig } from '../../packages/wallet/src/SeamsWeb/walletIframe/shared/configuration';
import type { SeamsConfigsInput, SeamsConfigsReadonly } from '../../packages/wallet/src/core/types/seams';
declare const rawWalletConfig: SeamsConfigsInput;
declare const commonWalletConfig: SeamsConfigsReadonly;
declare const hostConfig: WalletHostConfig;
// @ts-expect-error Host construction requires resolved configuration.
new WalletHostRuntime(rawWalletConfig);
// @ts-expect-error A general configuration can select application iframe execution.
new WalletHostRuntime(commonWalletConfig);
// @ts-expect-error Spreading application configuration cannot establish host ownership.
new WalletHostRuntime({ ...commonWalletConfig });
const nestedHostConfig = {
  ...hostConfig,
  wallet: {
    mode: 'direct' as const,
    rpId: hostConfig.wallet.rpId,
    iframe: { origin: 'https://wallet.example.com' },
  },
};
// @ts-expect-error Host configuration excludes a nested application iframe origin.
new WalletHostRuntime(nestedHostConfig);


import type { PMSetConfigPayload } from '../../packages/wallet/src/SeamsWeb/walletIframe/shared/messages';
// @ts-expect-error Configuration messages require a complete resolved configuration.
const missingHostConfig: PMSetConfigPayload = { kind: 'configure', assetsBaseUrl: 'https://wallet.example.com/sdk/' };
// @ts-expect-error Appearance updates cannot replace execution settings.
const mixedHostUpdate: PMSetConfigPayload = { kind: 'appearance', appearance: hostConfig.ui.appearance, config: hostConfig };
// @ts-expect-error The retired partial input payload is not a configuration message.
const partialHostUpdate: PMSetConfigPayload = { relayer: { url: 'https://relay.example.com' } };
void missingHostConfig;
void mixedHostUpdate;
void partialHostUpdate;

// @ts-expect-error Host identity requires a validated RP ID.
const missingHostRpId: WalletHostConfig['wallet'] = { mode: 'direct' };
// @ts-expect-error Raw strings cannot become host credential identities.
const rawHostRpId: WalletHostConfig['wallet'] = { mode: 'direct', rpId: 'wallet.example.com' };
const clientWalletWithHostIdentity = {
  ...applicationClient.configs.wallet,
  rpId: hostConfig.wallet.rpId,
};
// @ts-expect-error Client transport settings cannot be combined with host credential identity.
const mixedWalletConfig: SeamsConfigsReadonly['wallet'] = clientWalletWithHostIdentity;
void missingHostRpId;
void rawHostRpId;
void mixedWalletConfig;

import type { PreferencesChangedPayload } from '../../packages/wallet/src/SeamsWeb/walletIframe/shared/messages';
// @ts-expect-error Preference observations require an ordered revision, not a timestamp.
const timestampedPreferences: PreferencesChangedPayload = { walletId: null, confirmationConfig: preferences.getConfirmationConfig(), updatedAt: 1 };
// @ts-expect-error Preference snapshots must identify the wallet whose values they contain.
const unboundPreferences: PreferencesChangedPayload = { revision: 1, confirmationConfig: preferences.getConfirmationConfig() };
void timestampedPreferences;
void unboundPreferences;


declare const walletHostRuntime: WalletHostRuntime;
const persistedPreferenceWrite: Promise<void> = walletHostRuntime.preferences.setConfirmationConfig({ uiMode: 'drawer' });
void persistedPreferenceWrite;

import type { WalletHostRuntimeRequest, WalletHostRuntimeState } from '../../packages/wallet/src/SeamsWeb/walletIframe/host/runtimeContext';
declare const requestWithoutExecutionGeneration: Omit<WalletHostRuntimeRequest, 'executionGeneration'>;
declare const stateWithoutExecutionGeneration: Omit<WalletHostRuntimeState, 'executionGeneration'>;
// @ts-expect-error A request must capture its execution generation before asynchronous work.
const unboundRuntimeRequest: WalletHostRuntimeRequest = { ...requestWithoutExecutionGeneration };
// @ts-expect-error Host state must identify its current execution generation.
const unversionedRuntimeState: WalletHostRuntimeState = { ...stateWithoutExecutionGeneration };
declare const capturedRuntimeRequest: WalletHostRuntimeRequest;
// @ts-expect-error A request cannot adopt a replacement generation after it starts.
capturedRuntimeRequest.executionGeneration = capturedRuntimeRequest.state.executionGeneration;
void unboundRuntimeRequest;
void unversionedRuntimeState;

import type {
  WalletIframeExactSessionSnapshot,
  WalletIframeExactSessionState,
  WalletIframeSessionPublication,
} from '../../packages/wallet/src/SeamsWeb/walletIframe/shared/exactSessionState';
declare const observedSession: WalletIframeExactSessionState;
// @ts-expect-error Session snapshots require a host-issued revision.
const unversionedSession: WalletIframeExactSessionSnapshot = { walletId: null, state: observedSession };
// @ts-expect-error A revision cannot replace the required session projection.
const missingSessionProjection: WalletIframeExactSessionSnapshot = { walletId: null, revision: 1 };
declare const sessionSnapshot: WalletIframeExactSessionSnapshot;
// @ts-expect-error An exact-state observation must carry its complete public session.
const missingPublicSession: WalletIframeExactSessionSnapshot = { walletId: null, revision: 1, state: observedSession };
// @ts-expect-error Broad spreads cannot remove the public session.
const optionalPublicSession: WalletIframeExactSessionSnapshot = { ...sessionSnapshot, session: undefined };
void missingPublicSession;
void optionalPublicSession;
declare const observedPublication: WalletIframeSessionPublication & { kind: 'observed' };
// @ts-expect-error A refresh cannot carry a previously observed session.
const refreshWithObservedSession: WalletIframeSessionPublication = { ...observedPublication, kind: 'refresh' };
void refreshWithObservedSession;
// @ts-expect-error An observation cannot adopt another revision after capture.
sessionSnapshot.revision = 2;
// @ts-expect-error Broad spreads cannot remove the required revision.
const optionalSessionRevision: WalletIframeExactSessionSnapshot = { ...sessionSnapshot, revision: undefined };
void unversionedSession;
void missingSessionProjection;
void optionalSessionRevision;

// @ts-expect-error Locked snapshots must still identify the observed wallet selection.
const unboundSessionSnapshot: WalletIframeExactSessionSnapshot = { revision: 1, state: observedSession };
void unboundSessionSnapshot;

import type { ClientConnectionState } from '../../packages/wallet/src/SeamsWeb';
const connectionState: ClientConnectionState = applicationClient.connection.getState();
void connectionState;
applicationClient.connection.connect();
applicationClient.connection.onChange(() => {});
applicationClient.connection.dispose();
// @ts-expect-error Readiness requires a connection generation.
const invalidReady: ClientConnectionState = { kind: 'ready' };
// @ts-expect-error A ready connection cannot carry failure state.
const invalidSpread: ClientConnectionState = { ...connectionState, kind: 'ready', generation: 1, error: new Error() };
// @ts-expect-error Disposal cannot retain an active generation.
const invalidDisposed: ClientConnectionState = { kind: 'disposed', generation: 1 };
// @ts-expect-error Connection snapshots are read-only.
connectionState.kind = 'ready';
// @ts-expect-error Connect has one public namespace.
applicationClient.initWalletIframe();
// @ts-expect-error Readiness is represented by connection state.
applicationClient.isWalletIframeReady();
// @ts-expect-error Subscriptions use connection.onChange.
applicationClient.onWalletIframeReady(() => {});
// @ts-expect-error Disposal belongs to connection.
applicationClient.dispose();

// @ts-expect-error Host preference events are internal; use preferences subscriptions.
applicationClient.onWalletIframePreferencesChanged(() => {});

applicationClient.auth.getSession();
applicationClient.auth.hasPasskey('wallet-1');
applicationClient.auth.lock();
// @ts-expect-error Lock is the sole session-ending public operation.
applicationClient.auth.logout();
// @ts-expect-error Session reads use getSession.
applicationClient.auth.getWalletSession();
// @ts-expect-error Passkey queries use hasPasskey.
applicationClient.auth.hasPasskeyCredential('wallet-1');

applicationClient.auth.onSessionChange((session) => {
  session.authentication.kind;
});
// @ts-expect-error The public boolean login callback is removed.
applicationClient.onWalletIframeLoginStatusChanged(() => {});

// @ts-expect-error Connection preparation uses connection.connect.
applicationClient.prewarm({ iframe: true, workers: true });
// @ts-expect-error Block preparation belongs to the selected host operation.
applicationClient.prefetchBlockheight();
declare const providerProps: import('../../packages/wallet/src/react/context/SeamsWebProvider').SeamsWebProviderProps;
// @ts-expect-error Provider mount already connects; the redundant idle flag is removed.
providerProps.eager;

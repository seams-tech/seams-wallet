import type { NearCommands } from '../../packages/wallet/src/SeamsWeb/publicApi/nearCommands';
import type { EvmFamilyCommands } from '../../packages/wallet/src/SeamsWeb/publicApi/evmFamilyCommands';

declare const near: NearCommands;
declare const evm: EvmFamilyCommands;
declare const nearInput: Parameters<NearCommands['executeAction']>[0];
declare const evmInput: Parameters<EvmFamilyCommands['signEvmFamily']>[0];
declare const missingNearSubject: Omit<typeof nearInput, 'walletSession' | 'nearAccount'>;
declare const missingEvmSubject: Omit<typeof evmInput, 'walletSession'>;

// @ts-expect-error Internal commands require the resolved wallet and NEAR account.
near.executeAction(missingNearSubject);
// @ts-expect-error A broad spread cannot replace a resolved subject with undefined.
near.executeAction({ ...nearInput, walletSession: undefined });
// @ts-expect-error A broad spread cannot remove the resolved NEAR account.
near.executeAction({ ...nearInput, nearAccount: undefined });
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
createDevicesCapability({ ...devices, cancelDeviceLinking: undefined });
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
    iframe: { ...hostConfig.wallet.iframe, origin: 'https://wallet.example.com' },
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

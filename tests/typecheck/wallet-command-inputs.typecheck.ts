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

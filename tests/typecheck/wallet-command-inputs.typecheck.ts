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

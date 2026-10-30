import type { ExternalNearController } from '@/externalNear/controller';
import type { ExternalEvmController } from '@/externalEvm/controller';
import type { ExternalEvmWallet } from '@/externalEvm/types';
import type { HostedSeamsAuthMenuProps } from '@/react/components/HostedSeamsAuthMenu/types';
import type { WalletAlternative } from '@/react/components/HostedSeamsAuthMenu/walletAlternatives';
import type {
  WalletConnectionRequest,
  WalletConnectionState,
} from '@/SeamsWeb/walletIframe/shared/walletAlternatives';

declare const near: ExternalNearController;
declare const evm: ExternalEvmController;
declare const wallet: ExternalEvmWallet;
declare const onOutcome: HostedSeamsAuthMenuProps['onOutcome'];
declare const connectionRequest: WalletConnectionRequest;
function accept(): void {}
const omitted: HostedSeamsAuthMenuProps = { onOutcome };
const configured: HostedSeamsAuthMenuProps = {
  onOutcome,
  walletAlternatives: {
    primary: [{ kind: 'near', wallet: 'meteor', controller: near, onConnected: accept }],
    secondary: [{ kind: 'evm', wallet, controller: evm, onConnected: accept }],
  },
};
// @ts-expect-error A connection callback is required for every alternative.
const missingCallback: WalletAlternative = { kind: 'near', wallet: 'meteor', controller: near };
// @ts-expect-error An EVM controller cannot connect a NEAR wallet.
const mixedController: WalletAlternative = {
  kind: 'near',
  wallet: 'meteor',
  controller: evm,
  onConnected: accept,
};
// @ts-expect-error Spread construction must preserve the connector branch.
const mixedSpread: WalletAlternative = { ...mixedController, kind: 'evm', wallet: 'meteor' };
// @ts-expect-error A pending connection requires its request identity.
const missingRequest: WalletConnectionState = { kind: 'pending' };
// @ts-expect-error Idle state cannot carry a failure message.
const invalidState: WalletConnectionState = { kind: 'idle', message: 'failed' };
const alternativeId: string = connectionRequest.alternativeId;
const invalidRequest: WalletConnectionRequest = {
  ...connectionRequest,
  // @ts-expect-error Connection requests identify a configured alternative, not a Seams wallet.
  walletId: 'near:meteor',
};
void [
  omitted,
  configured,
  missingCallback,
  mixedController,
  mixedSpread,
  missingRequest,
  invalidState,
  alternativeId,
  invalidRequest,
];

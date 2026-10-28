import type { ExternalNearController } from '@/externalNear/controller';
import type { WalletConnectorMenuProps } from '@/react/components/HostedSeamsAuthMenu/WalletConnectorMenu';
import type { HostedSeamsAuthMenuProps } from '@/react/components/HostedSeamsAuthMenu/types';

declare const controller: ExternalNearController;
declare const onOutcome: HostedSeamsAuthMenuProps['onOutcome'];

const seamsOnly: WalletConnectorMenuProps = { onOutcome };
const external: WalletConnectorMenuProps = {
  onOutcome,
  externalNear: { controller, onConnected: acceptConnection },
  options: { meteor: { label: 'Use Meteor' } },
  authMenu: { initialMode: 'register' },
};

const missingConnectionHandler: WalletConnectorMenuProps = {
  onOutcome,
  // @ts-expect-error An enabled controller requires its typed connection handler.
  externalNear: { controller },
};

const replacedOutcomeHandler: WalletConnectorMenuProps = {
  onOutcome,
  // @ts-expect-error The connector owns forwarding the hosted auth outcome.
  authMenu: { onOutcome },
};

const replacedTransition: WalletConnectorMenuProps = {
  onOutcome,
  // @ts-expect-error The connector measures the entry height itself.
  authMenu: { initialHeightCssPx: 400 },
};

const invalidHeight: HostedSeamsAuthMenuProps = {
  onOutcome,
  // @ts-expect-error Layout height is a numeric CSS-pixel measurement.
  initialHeightCssPx: '400px',
};

function acceptConnection(): void {}

void [
  seamsOnly,
  external,
  missingConnectionHandler,
  replacedOutcomeHandler,
  replacedTransition,
  invalidHeight,
];

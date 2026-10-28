import type { ExternalNearWalletId } from '@/externalNear/types';
import { WalletIcon } from './AccountMenuButton/icons/WalletIcon';
import { hotWalletIcon, meteorWalletIcon } from './externalWalletBrandImages';

export function ExternalNearWalletIcon({ wallet }: { wallet: ExternalNearWalletId }) {
  switch (wallet) {
    case 'meteor':
      return <img src={meteorWalletIcon} width={32} height={32} alt="" />;
    case 'hot':
      return <img src={hotWalletIcon} width={32} height={32} alt="" />;
    case 'intear':
      return <WalletIcon width={28} height={28} />;
    default: {
      const exhaustive: never = wallet;
      throw new Error(`Unknown external wallet icon: ${String(exhaustive)}`);
    }
  }
}

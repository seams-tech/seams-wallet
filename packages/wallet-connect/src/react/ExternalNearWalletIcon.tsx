import { hotWalletIcon, meteorWalletIcon } from '@shared/near/walletBrandImages';
import type { ExternalNearWalletId } from '../externalNear/types';

// Intear has no artwork here: the picker shows the lucide "wallet" icon in Intear's blue.
const intearWalletIcon =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1685ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></svg>',
  );

export function ExternalNearWalletIcon({ wallet }: { wallet: ExternalNearWalletId }) {
  switch (wallet) {
    case 'meteor':
      return <img src={meteorWalletIcon} width={32} height={32} alt="" />;
    case 'hot':
      return <img src={hotWalletIcon} width={32} height={32} alt="" />;
    case 'intear':
      return <img src={intearWalletIcon} width={28} height={28} alt="" />;
    default: {
      const exhaustive: never = wallet;
      throw new Error(`Unknown external wallet icon: ${String(exhaustive)}`);
    }
  }
}

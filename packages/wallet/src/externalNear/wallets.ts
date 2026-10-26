import type { ExternalNearWalletId, NearWalletProvider } from './types';

export function nearWalletName(wallet: ExternalNearWalletId): string {
  switch (wallet) {
    case 'meteor':
      return 'Meteor Wallet';
    case 'hot':
      return 'HOT Wallet';
    case 'intear':
      return 'Intear Wallet';
    default:
      return assertNever(wallet);
  }
}
function assertNever(value: never): never {
  throw new Error(`Unknown NEAR wallet: ${value}`);
}

export async function createNearWalletProvider(
  wallet: ExternalNearWalletId,
): Promise<NearWalletProvider> {
  switch (wallet) {
    case 'meteor': {
      const { MeteorExtensionProvider } = await import('./meteor');
      return new MeteorExtensionProvider();
    }
    case 'hot': {
      const { HotExtensionProvider } = await import('./hot');
      return new HotExtensionProvider();
    }
    case 'intear': {
      const { IntearWalletProvider } = await import('./intear');
      return new IntearWalletProvider();
    }
    default:
      return assertNever(wallet);
  }
}

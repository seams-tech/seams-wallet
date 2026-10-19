import { logWalletEvents, type SeamsWeb } from '@seams/wallet';

export async function exportNearKey(seams: SeamsWeb): Promise<void> {
  await seams.keys.exportKey({
    kind: 'ed25519',
    options: { onEvent: logWalletEvents() },
  });
}

export async function exportEvmKey(seams: SeamsWeb): Promise<void> {
  await seams.keys.exportKey({
    kind: 'ecdsa',
    chainTarget: 'tempo-testnet',
    options: { onEvent: logWalletEvents() },
  });
}

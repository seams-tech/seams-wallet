// Shared event name constants for Wallet iframe DOM interactions
// These are reused across the iframe host, wallet UI, and tests.

export const WalletIframeDomEvents = {
  TX_CONFIRMER_CONFIRM: 'seams:tx-confirmer-confirm',
  TX_CONFIRMER_CANCEL: 'seams:tx-confirmer-cancel',
  TX_CONFIRMER_INTERACTIVE: 'seams:tx-confirmer-interactive',
} as const;

export type WalletIframeDomEvent =
  (typeof WalletIframeDomEvents)[keyof typeof WalletIframeDomEvents];

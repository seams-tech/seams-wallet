/**
 * A Wallet card can show as one step of an app's own dialog: the SDK places the card over an
 * element in the app's layout (the anchor) and tells the app what the card does. These events
 * carry the card's size, its readiness, Back and Close, and how it ended. They carry no approval
 * data: the call's own result does.
 */

/** A control that the SDK draws inside the card, beside the card's own controls. */
export type WalletStepChrome = 'back' | 'close' | 'none';

/** The card's layout size in CSS pixels. */
export type WalletStepSize = Readonly<{ width: number; height: number }>;

/**
 * How the card ended. `completed`: the card did its job (it signed, or the person signed in).
 * `back` and `closed`: the person pressed Back or Close in the card. `cancelled`: the app or the
 * SDK ended the card. `failed`: the card ended with an error.
 */
export type WalletStepExit = Readonly<{
  kind: 'completed' | 'back' | 'closed' | 'cancelled' | 'failed';
}>;

export type WalletStepEvents = Readonly<{
  /** The card has its size and is still hidden. Size the anchor's container now. */
  onEnter?: (size: WalletStepSize) => void;
  /** The card is painted at its size. */
  onReady?: () => void;
  /** The card changes size. Runs before the new size paints. */
  onResize?: (size: WalletStepSize) => void;
  /** The card is gone. The anchor keeps the card's last size until the app changes it. */
  onExit?: (exit: WalletStepExit) => void;
  /** The person pressed Back in the card (`chrome: 'back'`). */
  onBack?: () => void;
  /** The person pressed Close in the card (`chrome: 'close'`). */
  onClose?: () => void;
}>;

export function parseWalletStepChrome(value: unknown): WalletStepChrome | null {
  return value === 'back' || value === 'close' || value === 'none' ? value : null;
}

/** The exit of a card whose own cancel ran: the chrome says which control the person pressed. */
export function walletStepExitForDismissal(chrome: WalletStepChrome): WalletStepExit {
  return { kind: chrome === 'back' ? 'back' : 'closed' };
}

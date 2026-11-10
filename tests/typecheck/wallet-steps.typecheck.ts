import type { NearSignerCapability } from '@/SeamsWeb/publicApi/types';
import type {
  ReviewedTransactionInput,
  TransactionReview,
} from '@/react/transactionReview/contract';
import type { WalletSurfacePresentation } from '@/SeamsWeb/walletIframe/shared/walletStep';
import type { WalletStepProps } from '@/react/components/WalletStep';

declare const anchor: HTMLElement;
declare const near: NearSignerCapability;
type NearArgs = Parameters<NearSignerCapability['signAndSendTransaction']>[0];

const anchored: WalletSurfacePresentation = {
  kind: 'anchored',
  anchor,
  chrome: 'back',
  onEnter: ({ width, height }) => void (width + height),
  onExit: (exit) => void exit.kind,
};
void near.signAndSendTransaction({ receiverId: 'r.testnet', actions: [], presentation: anchored });
void near.signAndSendTransaction({
  receiverId: 'r.testnet',
  actions: [],
  presentation: { kind: 'modal' },
});

const approveChrome: WalletSurfacePresentation = {
  kind: 'anchored',
  anchor,
  // @ts-expect-error The SDK draws only Back or Close in the card, never an approve control.
  chrome: 'approve',
};
void approveChrome;

const review: TransactionReview = {
  title: 'Review',
  validity: { kind: 'unbounded' },
  render: () => null,
};
const reviewed: ReviewedTransactionInput<NearArgs> = { receiverId: 'r.testnet', actions: [], review };
void reviewed;
// @ts-expect-error A reviewed transaction shows in the Wallet's own modal: it takes no presentation.
const reviewedWithPresentation: ReviewedTransactionInput<NearArgs> = { ...reviewed, presentation: anchored };
void reviewedWithPresentation;

const confirmStep: WalletStepProps<{ success: boolean }> = {
  surface: {
    kind: 'transaction_confirm',
    send: async (presentation) => {
      void presentation.anchor;
      return { success: true };
    },
  },
  chrome: 'back',
  initialHeight: 480,
  onOutcome: (outcome) => {
    if (outcome.kind === 'result') void outcome.result.success;
  },
};
void confirmStep;

const signInStep: WalletStepProps<never> = {
  surface: { kind: 'auth_menu', initialMode: 'register' },
  chrome: 'close',
};
void signInStep;

const sendWithoutCall: WalletStepProps<unknown> = {
  // @ts-expect-error A transaction step sends its own call.
  surface: { kind: 'transaction_confirm' },
};
void sendWithoutCall;

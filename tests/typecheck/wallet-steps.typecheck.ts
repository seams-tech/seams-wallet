import type { AuthMenuCapability, NearSignerCapability } from '@/SeamsWeb/publicApi/types';
import type { SpeakToSignCapability } from '@/SeamsWeb/publicApi/speakToSign';
import type { HostedAuthMenuOpenRequest } from '@/SeamsWeb/walletIframe/shared/messages';
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
const reviewed: ReviewedTransactionInput<NearArgs> = {
  receiverId: 'r.testnet',
  actions: [],
  review,
};
void reviewed;
// @ts-expect-error A reviewed transaction shows in the Wallet's own modal: it takes no presentation.
const reviewedWithPresentation: ReviewedTransactionInput<NearArgs> = {
  ...reviewed,
  presentation: anchored,
};
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

const steps: ReviewedTransactionInput<NearArgs> = {
  receiverId: 'r.testnet',
  actions: [],
  steps: {
    title: 'Place bet',
    validity: { kind: 'unbounded' },
    before: (controls) => void controls.continueToWallet(),
    after: (outcome, controls) => void [outcome, controls.close()],
  },
};
void steps;

const both: ReviewedTransactionInput<NearArgs> = {
  receiverId: 'r.testnet',
  actions: [],
  // @ts-expect-error A call takes `steps` or its earlier name `review`, not both.
  steps: { title: 'Place bet', validity: { kind: 'unbounded' }, before: () => null },
  review,
};
void both;

// App steps around the sign-in card and a VoiceID card in the Wallet's own modal.
declare const authMenu: AuthMenuCapability;
declare const speakToSign: SpeakToSignCapability;
declare const request: HostedAuthMenuOpenRequest;
const note = {
  walletId: 'w.testnet',
  contract: 'notes.testnet',
  postId: 1,
  text: 'A note',
  summary: 'plain words',
};

void authMenu.open(request, undefined, {
  steps: {
    title: 'Place a bet',
    before: ({ continueToWallet, cancel }) => [continueToWallet, cancel],
    after: (outcome, { close }) => (outcome.kind === 'authenticated' ? outcome.walletId : close),
  },
});
void speakToSign.requestNote({
  ...note,
  steps: { title: 'Add a note', after: (result) => (result.kind === 'sent' ? result.times : null) },
});
// @ts-expect-error A request shows in the app's dialog or in the modal with steps, not both.
void speakToSign.requestNote({ ...note, presentation: anchored, steps: { title: 'Add a note' } });

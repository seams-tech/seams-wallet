import type { AppearanceConfigInput } from '@/core/types/seams';
import { asRecord, isFunction, isNonEmptyString, isString } from '@shared/utils/validation';
import { TransactionReviewError } from '../walletIframe/shared/transactionReview';
import type { AnchoredWalletPresentation } from '../walletIframe/shared/walletStep';

/** Controls of the app step before the Wallet's card. Continue opens the card; it never signs. */
export type WalletModalBeforeControls = Readonly<{
  continueToWallet: () => void;
  cancel: () => void;
}>;

/** Ends the app step after the Wallet's card, and with it the modal. */
export type WalletModalAfterControls = Readonly<{ close: () => void }>;

/**
 * App steps around one Wallet card in the SDK's modal. `before` shows first, and its Continue
 * opens the Wallet's card; Back in the card returns to it with the app's state kept. `after` shows
 * the call's result in the same modal when the call completed; the call's promise settles first.
 * Both return React content, so they need `TransactionReviewHost` from `@seams/wallet/react`.
 */
export type WalletModalSteps<Outcome> = Readonly<{
  /** The modal's accessible name and its heading in the app steps. */
  title: string;
  before?: (controls: WalletModalBeforeControls) => unknown;
  after?: (outcome: Outcome, controls: WalletModalAfterControls) => unknown;
  className?: string;
}>;

/** One call in the modal: the Wallet card that it sends over the modal's own anchor. */
export type WalletModalStepsCall<T> = Readonly<{
  kind: 'auth_menu' | 'speak_to_sign';
  steps: WalletModalSteps<T>;
  send: (presentation: AnchoredWalletPresentation) => Promise<T>;
  /** The call's result when the person leaves the modal before the Wallet card ends. */
  cancelled: T;
  appearance: AppearanceConfigInput | undefined;
}>;

export interface WalletModalStepsPresenter {
  run<T>(call: WalletModalStepsCall<T>): Promise<T>;
}

/**
 * The SeamsWeb instance whose calls take modal steps, with its current appearance. Its key is the
 * instance's `near` capability: React's `seams` is a proxy of the instance, but it returns the
 * same capability objects.
 */
export type WalletModalStepsOwner = Readonly<{
  key: () => object;
  appearance: () => AppearanceConfigInput | undefined;
}>;

const presenters = new WeakMap<object, WalletModalStepsPresenter>();

/** `TransactionReviewHost` shows the modal steps of its SeamsWeb instance until it unmounts. */
export function registerWalletModalStepsPresenter(
  key: object,
  presenter: WalletModalStepsPresenter,
): () => void {
  presenters.set(key, presenter);
  return () => {
    if (presenters.get(key) === presenter) presenters.delete(key);
  };
}

export async function runWalletModalSteps<T>(
  owner: WalletModalStepsOwner,
  call: Omit<WalletModalStepsCall<T>, 'steps' | 'appearance'> & Readonly<{ steps: unknown }>,
): Promise<T> {
  const steps = validateWalletModalSteps<T>(call.steps);
  const presenter = presenters.get(owner.key());
  if (!presenter) {
    throw new TransactionReviewError(
      'review_host_unavailable',
      'Wallet modal steps need TransactionReviewHost inside SeamsWebProvider',
    );
  }
  return await presenter.run({ ...call, steps, appearance: owner.appearance() });
}

function isStepContent(value: unknown): boolean {
  return value === undefined || (isFunction(value) && value.constructor.name !== 'AsyncFunction');
}

function validateWalletModalSteps<T>(input: unknown): WalletModalSteps<T> {
  const steps = asRecord(input);
  const title = isString(steps?.title) ? steps.title.trim() : '';
  if (
    !steps ||
    !isNonEmptyString(title) ||
    !isStepContent(steps.before) ||
    !isStepContent(steps.after) ||
    (steps.before === undefined && steps.after === undefined) ||
    (steps.className !== undefined && !isString(steps.className))
  ) {
    throw new TransactionReviewError(
      'review_invalid_input',
      'Modal steps need a nonempty title and a before or after function that returns content',
    );
  }
  return Object.freeze({
    title,
    ...(steps.before !== undefined
      ? { before: steps.before as NonNullable<WalletModalSteps<T>['before']> }
      : {}),
    ...(steps.after !== undefined
      ? { after: steps.after as NonNullable<WalletModalSteps<T>['after']> }
      : {}),
    ...(isString(steps.className) ? { className: steps.className } : {}),
  });
}

import type { Variant } from '@shared/utils/variant';
import type { CheckoutLocale } from '../shared/api';
import type { RailStart } from '../shared/methods';
import type { CheckoutTheme } from '../shared/protocol';

/**
 * The only third-party scripts of the checkout frame. Each loads when a method needs it, and
 * the frame's Content-Security-Policy names the same hosts.
 */
export const PROVIDER_SCRIPTS = {
  stripe: 'https://js.stripe.com/endive/stripe.js',
  komoju: 'https://multipay.komoju.com/fields.js',
} as const;

type CardForm = Variant<RailStart, 'kind', 'card_form'>;

export type CardSubmit =
  /** The provider took the card. The rail's event decides the payment. */
  | { readonly kind: 'submitted' }
  /** The provider refused the input. `message` is the provider's text, or null for our own. */
  | { readonly kind: 'refused'; readonly message: string | null };

/** The provider's card fields, mounted in the frame. They hold the card data: the frame's own code never reads it. */
export type CardFields = {
  submit(): Promise<CardSubmit>;
  destroy(): void;
};

type CardFieldsOptions = {
  readonly container: HTMLElement;
  readonly theme: CheckoutTheme;
  readonly locale: CheckoutLocale;
  /** The page of the frame's origin that the provider returns the customer to. */
  readonly returnUrl: string;
  /** Says whether the fields can be submitted now. */
  readonly onReady: (ready: boolean) => void;
};

type StripeElement = {
  mount(element: HTMLElement): void;
  on(event: 'change', handler: (event: { complete: boolean }) => void): void;
  destroy(): void;
};
type WalletConfirm = { paymentFailed(payload?: { reason?: string }): void };
type StripeWalletElement = {
  mount(element: HTMLElement): void;
  on(event: 'confirm', handler: (event: WalletConfirm) => void): void;
  on(event: 'availablepaymentmethodschange', handler: (event: { paymentMethods?: unknown }) => void): void;
  destroy(): void;
};
type StripeElements = {
  create(type: 'payment', options: object): StripeElement;
  create(type: 'expressCheckout', options: object): StripeWalletElement;
};
type StripeConfirm = { error?: { message?: string } };
type StripeClient = {
  elements(options: object): StripeElements;
  confirmPayment(options: object): Promise<StripeConfirm>;
};
type KomojuFields = HTMLElement & { submit(): Promise<unknown> };

declare global {
  interface Window {
    Stripe?: (publishableKey: string, options?: object) => StripeClient;
  }
}

const scripts = new Map<string, Promise<void>>();

function loadScript(src: string, module: boolean): Promise<void> {
  let loading = scripts.get(src);
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      if (module) script.type = 'module';
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => {
        scripts.delete(src);
        script.remove();
        reject(new Error(`The script ${src} did not load`));
      };
      document.head.append(script);
    });
    scripts.set(src, loading);
  }
  return loading;
}

/** One theme object as a Stripe `appearance` object. */
export function stripeAppearance(theme: CheckoutTheme): object {
  return {
    theme: 'stripe',
    variables: {
      ...(theme.accent ? { colorPrimary: theme.accent } : {}),
      ...(theme.radius === undefined ? {} : { borderRadius: `${theme.radius}px` }),
      ...(theme.fontFamily ? { fontFamily: `${theme.fontFamily}, system-ui, sans-serif` } : {}),
    },
  };
}

/**
 * One theme object as a KOMOJU Fields theme. KOMOJU supports colour changes only; the radius
 * and the font are overrides of its own rules. The fields take the theme as a stylesheet URL,
 * so the CSS travels as a data URL and the checkout origin serves no theme file.
 */
export function komojuTheme(theme: CheckoutTheme): string {
  const root = [
    ...(theme.accent ? [`--selected-color:${theme.accent}`] : []),
    ...(theme.fontFamily ? [`font-family:${theme.fontFamily},sans-serif`] : []),
  ];
  const radius = theme.radius === undefined ? '' : `.field input,.radio{border-radius:${theme.radius}px}`;
  return `data:text/css,${encodeURIComponent(`:root,:host{${root.join(';')}}${radius}`)}`;
}

async function mountStripe(
  start: Variant<CardForm, 'fields', 'stripe'>,
  options: CardFieldsOptions,
): Promise<CardFields> {
  await loadScript(PROVIDER_SCRIPTS.stripe, false);
  if (!window.Stripe) throw new Error('Stripe.js did not start');
  const stripe = window.Stripe(start.publishableKey, { locale: options.locale });
  const elements = stripe.elements({
    clientSecret: start.clientSecret,
    appearance: stripeAppearance(options.theme),
    locale: options.locale,
  });
  // Card only: the wallets have their own method in the Seams list.
  const element = elements.create('payment', {
    layout: 'tabs',
    wallets: { applePay: 'never', googlePay: 'never', link: 'never' },
  });
  element.on('change', (event) => options.onReady(event.complete));
  element.mount(options.container);
  options.onReady(false);
  return {
    async submit() {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: options.returnUrl },
        // 3-D Secure opens in Stripe's own frame, so the checkout frame keeps its document.
        redirect: 'if_required',
      });
      return result.error
        ? { kind: 'refused', message: result.error.message ?? null }
        : { kind: 'submitted' };
    },
    destroy: () => element.destroy(),
  };
}

async function mountKomoju(
  start: Variant<CardForm, 'fields', 'komoju'>,
  options: CardFieldsOptions,
): Promise<CardFields> {
  await loadScript(PROVIDER_SCRIPTS.komoju, true);
  await customElements.whenDefined('komoju-fields');
  const fields = document.createElement('komoju-fields') as KomojuFields;
  fields.setAttribute('session-id', start.sessionId);
  fields.setAttribute('publishable-key', start.publishableKey);
  fields.setAttribute('payment-type', 'credit_card');
  fields.setAttribute('locale', options.locale);
  fields.setAttribute('theme', komojuTheme(options.theme));
  let refusal: string | null = null;
  let refused = false;
  const onRefused = (event: Event): void => {
    refused = true;
    const error = (event as CustomEvent<{ error?: unknown }>).detail?.error;
    const message = typeof error === 'string' ? error : (error as { message?: unknown } | null)?.message;
    refusal = typeof message === 'string' ? message : null;
    // The frame shows the refusal in its own error line.
    event.preventDefault();
  };
  fields.addEventListener('komoju-error', onRefused);
  fields.addEventListener('komoju-invalid', onRefused);
  options.container.append(fields);
  // KOMOJU's fields report no state before submit, so the pay button is always on.
  options.onReady(true);
  return {
    async submit() {
      refused = false;
      refusal = null;
      await fields.submit();
      // After a success, the fields send the frame to the return page of the checkout origin.
      return refused ? { kind: 'refused', message: refusal } : { kind: 'submitted' };
    },
    destroy: () => fields.remove(),
  };
}

type WalletButtonOptions = Pick<CardFieldsOptions, 'container' | 'theme' | 'locale' | 'returnUrl'> & {
  /** The device has no such wallet, or the merchant's domain is not registered. */
  readonly onUnavailable: () => void;
  /** The customer approved or refused the payment in the sheet of the device. */
  readonly onSubmit: (result: CardSubmit) => void;
};

/** Mounts Stripe's button of one device wallet. The button opens the sheet of the device. */
export async function mountWalletButton(
  start: Variant<RailStart, 'kind', 'wallet_button'>,
  options: WalletButtonOptions,
): Promise<Pick<CardFields, 'destroy'>> {
  await loadScript(PROVIDER_SCRIPTS.stripe, false);
  if (!window.Stripe) throw new Error('Stripe.js did not start');
  const stripe = window.Stripe(start.publishableKey, { locale: options.locale });
  const { clientSecret } = start;
  const elements = stripe.elements({ clientSecret, appearance: stripeAppearance(options.theme), locale: options.locale });
  const shown = (wallet: typeof start.wallet): 'always' | 'never' => (start.wallet === wallet ? 'always' : 'never');
  const element = elements.create('expressCheckout', {
    paymentMethods: {
      applePay: shown('apple_pay'),
      googlePay: shown('google_pay'),
      link: 'never',
      paypal: 'never',
      amazonPay: 'never',
      klarna: 'never',
    },
    buttonHeight: Math.min(55, Math.max(40, options.theme.buttonHeight ?? 48)),
  });
  element.on('availablepaymentmethodschange', (event) => {
    if (!event.paymentMethods) options.onUnavailable();
  });
  element.on('confirm', (event) => {
    void stripe
      .confirmPayment({
        elements,
        clientSecret,
        confirmParams: { return_url: options.returnUrl },
        redirect: 'if_required',
      })
      .then((result) => {
        if (!result.error) return options.onSubmit({ kind: 'submitted' });
        event.paymentFailed({ reason: 'fail' });
        options.onSubmit({ kind: 'refused', message: result.error.message ?? null });
      });
  });
  element.mount(options.container);
  return { destroy: () => element.destroy() };
}

export function mountCardFields(
  start: CardForm,
  options: CardFieldsOptions,
): Promise<CardFields> {
  return start.fields === 'stripe' ? mountStripe(start, options) : mountKomoju(start, options);
}

import { hasExactKeys } from '@shared/utils/exactKeys';
import { isArray, isFiniteNumber, isPlainObject, isString } from '@shared/utils/validation';
import type { CheckoutLocale } from './api';
import type { CheckoutSession, MethodOption } from './api';
import {
  CUSTOMER_FIELDS,
  isCheckoutMethod,
  type CheckoutMethod,
  type CustomerDetails,
  type NextStep,
} from './methods';

/** The protocol between the page SDK and the checkout frame, over the frame kit's port. */
export const CHECKOUT_PROTOCOL = { name: 'seams-checkout', version: '1' } as const;

/** The width that the checkout frame is designed for. A narrow page gives it less. */
export const CHECKOUT_FRAME_WIDTH_CSS_PX = 440;

export type CheckoutLayout = 'list' | 'accordion' | 'tabs';

/** One theme for the Seams screens and for the card fields of both providers. */
export type CheckoutTheme = {
  /** The colour of the pay button and the selected method, as `#rgb` or `#rrggbb`. */
  readonly accent?: string;
  /** The corner radius of buttons and fields, 0 to 32 CSS pixels. */
  readonly radius?: number;
  /** The height of the pay button, 36 to 64 CSS pixels. */
  readonly buttonHeight?: number;
  /** A font family that the customer's device has. The checkout loads no font file. */
  readonly fontFamily?: string;
};

/** Where the checkout stands, as the page needs it to make the result. */
/**
 * `confirming`: the provider took the payment and the frame waits for the rail's event.
 * `pending`: the payment waits for longer, for example for a store payment.
 */
export type CheckoutStatus = 'open' | 'confirming' | 'pending' | 'paid' | 'failed';

export type OpenMessage = {
  readonly type: 'open';
  readonly publishableKey: string;
  readonly clientToken: string;
  /** The stage that shows the frame. The frame's size messages carry it back. */
  readonly stage: string;
  /** `headless`: the page draws the list and each next step; the frame holds the provider part. */
  readonly presentation: 'modal' | 'inline' | 'headless';
  readonly layout: CheckoutLayout;
  /** The order of the methods and a subset of them, or null for the project's own list. */
  readonly methods: readonly CheckoutMethod[] | null;
  readonly theme: CheckoutTheme;
  readonly locale: CheckoutLocale;
};

export type FrameMessage =
  | { readonly type: 'size'; readonly stage: string; readonly heightCssPx: number }
  | { readonly type: 'status'; readonly status: CheckoutStatus }
  /** The customer selected the close button or the done button. */
  | { readonly type: 'close' }
  /** Headless: the order and its methods, after the frame read them. */
  | { readonly type: 'methods'; readonly order: CheckoutSession['order']; readonly methods: readonly MethodOption[] }
  /** Headless: a next step that the page draws. */
  | { readonly type: 'next_step'; readonly method: CheckoutMethod; readonly step: NextStep }
  /** Headless: the last command did not work. `message` is the provider's text, when one exists. */
  | { readonly type: 'error'; readonly code: string; readonly message: string | null };

/** What the page asks of a headless frame. */
export type PageCommand =
  | { readonly type: 'select'; readonly method: CheckoutMethod; readonly details: CustomerDetails }
  | { readonly type: 'pay' };

const LAYOUTS: readonly string[] = ['list', 'accordion', 'tabs'];
const STATUSES: readonly string[] = ['open', 'confirming', 'pending', 'paid', 'failed'];
const MAX_TOKEN = 512;

function isToken(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= MAX_TOKEN;
}

/**
 * Keeps only the theme values that are safe to put into CSS. A value of another form is
 * dropped, so a page cannot put its own CSS or a URL into the checkout frame.
 */
export function parseTheme(input: unknown): CheckoutTheme {
  if (!isPlainObject(input)) return {};
  const { accent, radius, buttonHeight, fontFamily } = input;
  const inRange = (value: unknown, min: number, max: number): value is number =>
    isFiniteNumber(value) && value >= min && value <= max;
  return {
    ...(isString(accent) && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent) ? { accent } : {}),
    ...(inRange(radius, 0, 32) ? { radius: Math.round(radius) } : {}),
    ...(inRange(buttonHeight, 36, 64) ? { buttonHeight: Math.round(buttonHeight) } : {}),
    ...(isString(fontFamily) && /^[\p{L}\p{N} ,_-]{1,100}$/u.test(fontFamily) ? { fontFamily } : {}),
  };
}

/** The message that opens a checkout, as the frame accepts it. */
export function parseOpenMessage(value: unknown): OpenMessage | null {
  const keys = [
    'type',
    'publishableKey',
    'clientToken',
    'stage',
    'presentation',
    'layout',
    'methods',
    'theme',
    'locale',
  ] as const;
  if (!hasExactKeys(value, keys) || value.type !== 'open') return null;
  const { publishableKey, clientToken, stage, presentation, layout, methods, locale } = value;
  if (!isToken(publishableKey) || !isToken(clientToken) || !isToken(stage)) return null;
  if (presentation !== 'modal' && presentation !== 'inline' && presentation !== 'headless') return null;
  if (!isString(layout) || !LAYOUTS.includes(layout)) return null;
  if (locale !== 'en' && locale !== 'ja') return null;
  if (methods !== null && !(isArray(methods) && methods.every(isCheckoutMethod))) return null;
  return {
    type: 'open',
    publishableKey,
    clientToken,
    stage,
    presentation,
    layout: layout as CheckoutLayout,
    methods: methods as readonly CheckoutMethod[] | null,
    theme: parseTheme(value.theme),
    locale,
  };
}

/** A message of the frame, as the page accepts it. */
export function parseFrameMessage(value: unknown): FrameMessage | null {
  if (!isPlainObject(value)) return null;
  if (hasExactKeys(value, ['type']) && value.type === 'close') return { type: 'close' };
  if (hasExactKeys(value, ['type', 'status']) && value.type === 'status') {
    const { status } = value;
    return isString(status) && STATUSES.includes(status)
      ? { type: 'status', status: status as CheckoutStatus }
      : null;
  }
  if (hasExactKeys(value, ['type', 'order', 'methods']) && value.type === 'methods') {
    const { order, methods } = value;
    return isPlainObject(order) && isArray(methods)
      ? { type: 'methods', order: order as CheckoutSession['order'], methods: methods as MethodOption[] }
      : null;
  }
  if (hasExactKeys(value, ['type', 'method', 'step']) && value.type === 'next_step') {
    const { method, step } = value;
    const kinds: readonly unknown[] = ['voucher', 'bank_details', 'redirect'];
    return isCheckoutMethod(method) && isPlainObject(step) && kinds.includes(step.kind)
      ? { type: 'next_step', method, step: step as NextStep }
      : null;
  }
  if (hasExactKeys(value, ['type', 'code', 'message']) && value.type === 'error') {
    const { code, message } = value;
    return isToken(code) && (message === null || isString(message)) ? { type: 'error', code, message } : null;
  }
  if (hasExactKeys(value, ['type', 'stage', 'heightCssPx']) && value.type === 'size') {
    const { stage, heightCssPx } = value;
    const valid = isToken(stage) && isFiniteNumber(heightCssPx) && heightCssPx > 0 && heightCssPx < 10_000;
    return valid ? { type: 'size', stage, heightCssPx } : null;
  }
  return null;
}

/** A command of the page, as a headless frame accepts it. Only known customer fields pass. */
export function parsePageCommand(value: unknown): PageCommand | null {
  if (hasExactKeys(value, ['type']) && value.type === 'pay') return { type: 'pay' };
  if (!hasExactKeys(value, ['type', 'method', 'details']) || value.type !== 'select') return null;
  const { method, details } = value;
  if (!isCheckoutMethod(method) || !isPlainObject(details)) return null;
  const known = CUSTOMER_FIELDS.flatMap((field) => {
    const text = details[field];
    return isString(text) && text.length <= MAX_TOKEN ? [[field, text.trim()] as const] : [];
  });
  return { type: 'select', method, details: Object.fromEntries(known) };
}

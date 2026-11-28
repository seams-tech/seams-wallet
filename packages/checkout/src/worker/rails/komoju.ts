import { hasExactKeys } from '@shared/utils/exactKeys';
import { asRecord, isArray, isString, requireNonEmptyString } from '@shared/utils/validation';
import { toOptionalTrimmedNonEmptyString } from '@shared/utils/validation';
import type { CheckoutMethod, CustomerField, KonbiniStore } from '../../shared/methods';
import type { AttemptState } from '../../shared/orderState';
import { hmacSha256Hex, timingSafeEqual } from '../../shared/signature';
import { createRailHttp, type RailBody, type RailHttp } from './http';
import {
  RailError,
  acceptsOrder,
  type PaymentRail,
  type RailAccount,
  type RailAttempt,
  type RailContext,
  type RailEvent,
  type RailFailure,
  type RailModule,
  type RailPaymentState,
  type RailStarted,
  type RailWebhook,
} from './rail';

const KOMOJU_API = 'https://komoju.com/api/v1';
/** The API version that this rail was written against. */
const KOMOJU_API_VERSION = '2025-01-28';
/** KOMOJU keeps an idempotency key for 24 hours. After that, the rail looks the payment up. */
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60_000;

const METHODS: ReadonlySet<CheckoutMethod> = new Set(['card', 'konbini', 'bank_transfer', 'paypay']);
/** KOMOJU's limits for each method that takes yen only. */
const YEN_LIMITS = {
  konbini: [1, 300_000],
  bank_transfer: [1, Number.MAX_SAFE_INTEGER],
  paypay: [1, 1_000_000],
} as const;
const FIELDS: Readonly<Record<CheckoutMethod, readonly CustomerField[]>> = {
  card: ['email'],
  konbini: ['konbini_store', 'email'],
  bank_transfer: ['family_name', 'given_name', 'family_name_kana', 'given_name_kana', 'email', 'phone'],
  paypay: [],
};
/** KOMOJU's name for each store. */
const STORES: Readonly<Record<KonbiniStore, string>> = {
  seven_eleven: 'seven-eleven',
  lawson: 'lawson',
  family_mart: 'family-mart',
  ministop: 'ministop',
  daily_yamazaki: 'daily-yamazaki',
  seicomart: 'seicomart',
};
/** The payment types that wait in `authorized` until the customer pays at a store or a bank. */
const OFFLINE_TYPES: readonly unknown[] = ['konbini', 'bank_transfer', 'pay_easy'];
/** A payment that the server made directly has this prefix in its reference. A card has a session. */
const PAYMENT_REF = 'payment:';

/** The state of an attempt for each status of a KOMOJU payment. */
const PAYMENT_STATES: Readonly<Record<string, AttemptState>> = {
  // The customer is at a 3-D Secure page or at a wallet app.
  pending: 'requires_action',
  authorized: 'requires_action',
  captured: 'succeeded',
  // A refund comes only after a capture, so the money did arrive.
  refunded: 'succeeded',
  cancelled: 'cancelled',
  expired: 'expired',
  // KOMOJU says that a failed payment can be tried again in the same session.
  failed: 'created',
};

function readFailure(body: Record<string, unknown>): RailFailure {
  const error = asRecord(body.error) ?? {};
  return {
    code: toOptionalTrimmedNonEmptyString(error.code) ?? 'komoju_error',
    message: toOptionalTrimmedNonEmptyString(error.message) ?? 'KOMOJU refused the request',
  };
}

function paymentState(payment: Record<string, unknown>): RailPaymentState {
  const status = String(payment.status);
  const offline = OFFLINE_TYPES.includes(asRecord(payment.payment_details)?.type);
  const state = status === 'authorized' && offline ? 'pending_offline' : PAYMENT_STATES[status];
  if (!state) throw new RailError('unavailable', 'unknown_status', `Unknown payment status ${status}`);
  return {
    state,
    paid: state === 'succeeded' ? { amount: Number(payment.total), currency: String(payment.currency) } : null,
    failure: status === 'failed' ? { code: 'payment_failed', message: 'The payment failed' } : null,
  };
}

function sessionState(session: Record<string, unknown>): RailPaymentState {
  const payment = asRecord(session.payment);
  if (payment) return paymentState(payment);
  const state = session.status === 'cancelled' ? 'cancelled' : session.expired === true ? 'expired' : 'created';
  return { state, paid: null, failure: null };
}

/** The path of a reference: a session for a card, a payment for the other methods. */
function refPath(ref: string): string {
  return ref.startsWith(PAYMENT_REF)
    ? `/payments/${encodeURIComponent(ref.slice(PAYMENT_REF.length))}`
    : sessionPath(ref);
}

function readRef(ref: string, body: Record<string, unknown>): RailPaymentState {
  return ref.startsWith(PAYMENT_REF) ? paymentState(body) : sessionState(body);
}

/** The details that KOMOJU needs to make a payment of one method on the server. */
function paymentDetails(attempt: RailAttempt): RailBody {
  const { details } = attempt;
  switch (attempt.method) {
    case 'konbini':
      return {
        type: 'konbini',
        store: STORES[details.konbini_store as KonbiniStore] ?? '',
        email: details.email ?? '',
        expiry_days: attempt.offlineDays,
      };
    case 'bank_transfer':
      return {
        type: 'bank_transfer',
        email: details.email ?? '',
        phone: details.phone ?? '',
        family_name: details.family_name ?? '',
        given_name: details.given_name ?? '',
        family_name_kana: details.family_name_kana ?? '',
        given_name_kana: details.given_name_kana ?? '',
        expiry_days: attempt.offlineDays,
      };
    default:
      return { type: attempt.method };
  }
}

/** The next step of a payment that the server made, as the browser gets it. */
function nextStep(payment: Record<string, unknown>): Pick<RailStarted, 'start' | 'deadlineMs'> {
  const details = asRecord(payment.payment_details) ?? {};
  const text = (value: unknown): string | null => toOptionalTrimmedNonEmptyString(value) ?? null;
  const deadlineMs = Date.parse(String(payment.payment_deadline ?? details.payment_deadline));
  const instructionsUrl = text(details.instructions_url);
  if (details.type === 'konbini') {
    const store = (Object.keys(STORES) as KonbiniStore[]).find((name) => STORES[name] === details.store);
    // KOMOJU says not to show the 7-Eleven code. That store's voucher is KOMOJU's own page.
    const hidden = store === 'seven_eleven';
    const code = {
      stores: store ? [store] : [],
      paymentCode: hidden ? null : text(details.receipt),
      confirmationCode: hidden ? null : text(details.confirmation_code),
    };
    return { start: { kind: 'voucher', deadlineMs, instructionsUrl, codes: [code] }, deadlineMs };
  }
  if (details.type === 'bank_transfer') {
    return {
      start: {
        kind: 'bank_details',
        deadlineMs,
        instructionsUrl,
        bankName: text(details.bank_name) ?? '',
        branchName: text(details.account_branch_name) ?? '',
        accountType: text(details.account_type) ?? '',
        accountNumber: text(details.account_number) ?? '',
        accountHolder: text(details.account_name) ?? '',
      },
      deadlineMs,
    };
  }
  return { start: { kind: 'redirect', url: requireNonEmptyString(details.redirect_url, 'redirect URL') } };
}

function sessionPath(ref: string): string {
  return `/sessions/${encodeURIComponent(ref)}`;
}

function connectKomoju(account: RailAccount, context: RailContext): PaymentRail {
  const http: RailHttp = createRailHttp({
    fetch: context.fetch,
    baseUrl: KOMOJU_API,
    authorization: `Basic ${btoa(`${account.secrets.secretKey}:`)}`,
    idempotencyHeader: 'x-komoju-idempotency',
    encoding: 'json',
    headers: { 'x-komoju-api-version': KOMOJU_API_VERSION },
    readError: readFailure,
  });

  async function read(ref: string): Promise<RailPaymentState> {
    return readRef(ref, await http.get(refPath(ref)));
  }

  /** The payment of an attempt whose idempotency key is too old to use again. */
  async function findPayment(attempt: RailAttempt): Promise<Record<string, unknown> | null> {
    if (context.now() - attempt.createdAtMs <= IDEMPOTENCY_WINDOW_MS) return null;
    const list = await http.get(`/payments?external_order_num=${encodeURIComponent(attempt.id)}`);
    return isArray(list.data) ? asRecord(list.data[0]) : null;
  }

  /** Makes the payment of a method that needs no card fields: the server gives all details. */
  async function startDirect(attempt: RailAttempt): Promise<RailStarted> {
    const payment =
      (await findPayment(attempt)) ??
      (await http.post(
        '/payments',
        {
          amount: attempt.amount,
          // Without this, some API versions add 10% tax to the amount.
          tax: 0,
          currency: attempt.currency,
          external_order_num: attempt.id,
          return_url: attempt.returnUrl,
          locale: attempt.locale,
          payment_details: paymentDetails(attempt),
        },
        attempt.id,
      ));
    const ref = `${PAYMENT_REF}${requireNonEmptyString(payment.id, 'payment id')}`;
    return { ref, payment: paymentState(payment), ...nextStep(payment) };
  }

  async function verify(webhook: RailWebhook): Promise<RailEvent | null> {
    // KOMOJU signs the raw body and no timestamp. So the Worker reads the payment from the API
    // after this check, and a replayed event cannot set a state that the payment does not have.
    const expected = await hmacSha256Hex(account.secrets.webhookSecret ?? '', webhook.body);
    if (!timingSafeEqual(webhook.header('x-komoju-signature') ?? '', expected)) return null;
    const event = asRecord(JSON.parse(webhook.body)) ?? {};
    const data = asRecord(event.data) ?? {};
    const attemptId = data.external_order_num;
    if (!String(event.type).startsWith('payment.') || !isString(attemptId)) return { kind: 'ignored' };
    // The attempt names its own payment, so the event needs no reference.
    return { kind: 'payment', attemptId, ref: null };
  }

  return {
    events: { kind: 'webhook', verify },
    read,
    async start(attempt: RailAttempt): Promise<RailStarted> {
      if (attempt.method !== 'card') return startDirect(attempt);
      const publishableKey = account.public.publishableKey ?? '';
      const existing = (await findPayment(attempt))?.session;
      const session = isString(existing)
        ? await http.get(sessionPath(existing))
        : await http.post(
            '/sessions',
            {
              amount: attempt.amount,
              currency: attempt.currency,
              return_url: attempt.returnUrl,
              default_locale: attempt.locale,
              payment_types: ['credit_card'],
              payment_data: { external_order_num: attempt.id, capture: 'auto' },
              ...(attempt.details.email ? { email: attempt.details.email } : {}),
            },
            attempt.id,
          );
      const sessionId = requireNonEmptyString(session.id, 'session id');
      return {
        ref: sessionId,
        payment: sessionState(session),
        start: { kind: 'card_form', fields: 'komoju', publishableKey, sessionId },
      };
    },
    async cancel(ref) {
      try {
        await http.post(`${refPath(ref)}/cancel`, {});
        return { kind: 'cancelled' };
      } catch (error) {
        // KOMOJU refuses the cancel of a session that is completed.
        if (!(error instanceof RailError) || error.kind !== 'refused') throw error;
        return { kind: (await read(ref)).state === 'cancelled' ? 'cancelled' : 'too_late' };
      }
    },
  };
}

export const komojuRail: RailModule = {
  id: 'komoju',
  methods: METHODS,
  accepts: (method, currency, amount) => acceptsOrder(METHODS, YEN_LIMITS, method, currency, amount),
  fields: (method) => FIELDS[method],
  parseAccount(input) {
    if (!hasExactKeys(input, ['publishableKey', 'secretKey', 'webhookSecret'])) {
      throw new Error('A KOMOJU account has a publishableKey, a secretKey and a webhookSecret');
    }
    const publishableKey = requireNonEmptyString(input.publishableKey, 'publishableKey');
    const secretKey = requireNonEmptyString(input.secretKey, 'secretKey');
    const webhookSecret = requireNonEmptyString(input.webhookSecret, 'webhookSecret');
    if (publishableKey.startsWith('sk_') || secretKey.startsWith('pk_')) {
      throw new Error('The KOMOJU publishableKey and secretKey are in the wrong fields');
    }
    if (publishableKey.includes('_live_') !== secretKey.includes('_live_')) {
      throw new Error('The KOMOJU keys are not of the same mode: one is live and one is test');
    }
    // KOMOJU has no restricted key: this key reaches all of the merchant's API. It is sealed
    // with the encryption key of this rail only, and only this file reads it.
    return { public: { publishableKey }, secrets: { secretKey, webhookSecret } };
  },
  connect: connectKomoju,
};

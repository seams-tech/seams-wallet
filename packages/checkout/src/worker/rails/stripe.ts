import { hasExactKeys } from '@shared/utils/exactKeys';
import {
  asRecord,
  isArray,
  isString,
  requireNonEmptyString,
  toOptionalTrimmedNonEmptyString,
} from '@shared/utils/validation';
import type { CheckoutMethod, CustomerField, KonbiniStore } from '../../shared/methods';
import { verifyTimestamped } from '../../shared/signature';
import type { AttemptState } from '../../shared/orderState';
import { createRailHttp, type RailBody, type RailHttp } from './http';
import {
  RailError,
  acceptsOrder,
  type PaymentRail,
  type RailAccount,
  type RailAttempt,
  type RailEvent,
  type RailFailure,
  type RailModule,
  type RailPaymentState,
  type RailStarted,
  type RailWebhook,
} from './rail';

const STRIPE_API = 'https://api.stripe.com';
/** The API version that this rail was written against. Stripe keeps old versions working. */
const STRIPE_API_VERSION = '2026-11-18.endive';
/** Stripe's own tolerance for the age of a webhook. */
const WEBHOOK_TOLERANCE_SECONDS = 300;
/** The metadata key that marks a PaymentIntent of the checkout, with the attempt ID. */
const ATTEMPT_METADATA = 'seams_attempt';

const METHODS: ReadonlySet<CheckoutMethod> = new Set(['card', 'konbini', 'bank_transfer', 'paypay']);
/** The metadata key with the method of the attempt. */
const METHOD_METADATA = 'seams_method';
/** Stripe's limits for each method that takes yen only. */
const YEN_LIMITS = {
  konbini: [120, 300_000],
  bank_transfer: [1, Number.MAX_SAFE_INTEGER],
  paypay: [50, 1_000_000],
} as const;
const EXPIRED_CODE = 'payment_intent_payment_attempt_expired';
const STORES: Readonly<Record<string, KonbiniStore>> = {
  familymart: 'family_mart',
  lawson: 'lawson',
  ministop: 'ministop',
  seicomart: 'seicomart',
};
const FIELDS: Readonly<Partial<Record<CheckoutMethod, readonly CustomerField[]>>> = {
  card: ['email'],
  konbini: ['full_name', 'email'],
  bank_transfer: ['full_name', 'email'],
  paypay: [],
};

function readFailure(body: Record<string, unknown>): RailFailure {
  const error = asRecord(body.error) ?? asRecord(body.last_payment_error) ?? {};
  return {
    code: toOptionalTrimmedNonEmptyString(error.decline_code ?? error.code) ?? 'stripe_error',
    message: toOptionalTrimmedNonEmptyString(error.message) ?? 'Stripe refused the request',
  };
}

function intentState(intent: Record<string, unknown>): AttemptState {
  const card = asRecord(intent.metadata)?.[METHOD_METADATA] === 'card';
  const nextAction = asRecord(intent.next_action)?.type;
  switch (intent.status) {
    case 'requires_payment_method':
    case 'requires_confirmation': {
      // A declined card can be tried again in the same PaymentIntent. A voucher that expired,
      // or a wallet payment that the customer refused, cannot.
      const error = asRecord(intent.last_payment_error);
      if (card || !error) return 'created';
      return error.code === EXPIRED_CODE ? 'expired' : 'failed';
    }
    case 'requires_action':
      return nextAction === 'konbini_display_details' ||
        nextAction === 'display_bank_transfer_instructions'
        ? 'pending_offline'
        : 'requires_action';
    case 'processing':
      return 'requires_action';
    case 'succeeded':
      return 'succeeded';
    case 'canceled':
      return 'cancelled';
    default:
      throw new RailError('unavailable', 'unknown_status', `Unknown PaymentIntent status ${intent.status}`);
  }
}

function paymentState(intent: Record<string, unknown>): RailPaymentState {
  const state = intentState(intent);
  const paid =
    state === 'succeeded'
      ? { amount: Number(intent.amount_received), currency: String(intent.currency).toUpperCase() }
      : null;
  return { state, paid, failure: intent.last_payment_error ? readFailure(intent) : null };
}

function intentPath(ref: string): string {
  return `/v1/payment_intents/${encodeURIComponent(ref)}`;
}

/** The next step of a PaymentIntent that the server confirmed, as the browser gets it. */
function nextStep(intent: Record<string, unknown>): Pick<RailStarted, 'start' | 'deadlineMs'> {
  const next = asRecord(intent.next_action) ?? {};
  const konbini = asRecord(next.konbini_display_details);
  if (konbini) {
    const deadlineMs = Number(konbini.expires_at) * 1000;
    const codes = Object.entries(asRecord(konbini.stores) ?? {}).flatMap(([name, value]) => {
      const store = STORES[name];
      const code = asRecord(value);
      if (!store || !code) return [];
      return {
        stores: [store],
        paymentCode: toOptionalTrimmedNonEmptyString(code.payment_code) ?? null,
        confirmationCode: toOptionalTrimmedNonEmptyString(code.confirmation_number) ?? null,
      };
    });
    const instructionsUrl = toOptionalTrimmedNonEmptyString(konbini.hosted_voucher_url) ?? null;
    return { start: { kind: 'voucher', deadlineMs, instructionsUrl, codes }, deadlineMs };
  }
  const bank = asRecord(next.display_bank_transfer_instructions);
  const address = isArray(bank?.financial_addresses) ? asRecord(bank.financial_addresses[0]) : null;
  const zengin = asRecord(address?.zengin);
  if (bank && zengin) {
    const text = (value: unknown): string => toOptionalTrimmedNonEmptyString(value) ?? '';
    return {
      start: {
        kind: 'bank_details',
        deadlineMs: null,
        instructionsUrl: toOptionalTrimmedNonEmptyString(bank.hosted_instructions_url) ?? null,
        bankName: text(zengin.bank_name),
        branchName: text(zengin.branch_name),
        accountType: text(zengin.account_type),
        accountNumber: text(zengin.account_number),
        accountHolder: text(zengin.account_holder_name),
      },
    };
  }
  const redirect = asRecord(next.redirect_to_url);
  if (redirect) return { start: { kind: 'redirect', url: requireNonEmptyString(redirect.url, 'redirect URL') } };
  throw new RailError('unavailable', 'no_next_action', 'Stripe gave no next step for the payment');
}

function connectStripe(account: RailAccount, fetcher: typeof fetch): PaymentRail {
  const http: RailHttp = createRailHttp({
    fetch: fetcher,
    baseUrl: STRIPE_API,
    authorization: `Bearer ${account.secrets.restrictedKey}`,
    idempotencyHeader: 'idempotency-key',
    encoding: 'form',
    headers: { 'stripe-version': STRIPE_API_VERSION },
    readError: readFailure,
  });

  async function read(ref: string): Promise<RailPaymentState> {
    return paymentState(await http.get(intentPath(ref)));
  }

  /** The parameters that confirm a PaymentIntent of one method on the server. */
  async function confirmBody(attempt: RailAttempt): Promise<RailBody> {
    const { details } = attempt;
    const billing = { name: details.full_name ?? '', email: details.email ?? '' };
    switch (attempt.method) {
      case 'card':
        return details.email ? { receipt_email: details.email } : {};
      case 'konbini':
        return {
          confirm: true,
          payment_method_data: { type: 'konbini', billing_details: billing },
          payment_method_options: { konbini: { expires_after_days: attempt.offlineDays } },
        };
      case 'paypay':
        return { confirm: true, payment_method_data: { type: 'paypay' }, return_url: attempt.returnUrl };
      case 'bank_transfer': {
        // Stripe gives each customer one bank account for transfers. A customer for each
        // attempt makes the account name the attempt, so its money is never mixed up.
        const customer = await http.post(
          '/v1/customers',
          { ...billing, metadata: { [ATTEMPT_METADATA]: attempt.id } },
          `${attempt.id}-customer`,
        );
        return {
          confirm: true,
          customer: requireNonEmptyString(customer.id, 'customer id'),
          payment_method_data: { type: 'customer_balance' },
          payment_method_options: {
            customer_balance: { funding_type: 'bank_transfer', bank_transfer: { type: 'jp_bank_transfer' } },
          },
        };
      }
      default:
        throw new RailError('refused', 'method_not_supported', `Stripe does not take ${attempt.method}`);
    }
  }

  async function verify(webhook: RailWebhook): Promise<RailEvent | null> {
    const valid = await verifyTimestamped({
      secret: account.secrets.webhookSecret ?? '',
      body: webhook.body,
      header: webhook.header('stripe-signature'),
      nowMs: webhook.nowMs,
      toleranceSeconds: WEBHOOK_TOLERANCE_SECONDS,
    });
    if (!valid) return null;
    const event = asRecord(JSON.parse(webhook.body)) ?? {};
    const object = asRecord(asRecord(event.data)?.object) ?? {};
    if (event.type === 'cash_balance.funds_available' && isString(object.customer)) {
      // Money is in the customer's cash balance, and Stripe applied it to no payment.
      const customer = await http.get(`/v1/customers/${encodeURIComponent(object.customer)}`);
      const attemptId = asRecord(customer.metadata)?.[ATTEMPT_METADATA];
      const [currency, amount] = Object.entries(asRecord(object.available) ?? {})[0] ?? [];
      if (!isString(attemptId) || !currency || !(Number(amount) > 0)) return { kind: 'ignored' };
      return {
        kind: 'unmatched_funds',
        attemptId,
        ref: `${object.customer}:${String(event.id)}`,
        amount: Number(amount),
        currency: currency.toUpperCase(),
      };
    }
    const attemptId = asRecord(object.metadata)?.[ATTEMPT_METADATA];
    // The merchant's Stripe account also has payments that the checkout did not make.
    if (!String(event.type).startsWith('payment_intent.') || !isString(attemptId)) {
      return { kind: 'ignored' };
    }
    return { kind: 'payment', attemptId, ref: requireNonEmptyString(object.id, 'PaymentIntent id') };
  }

  return {
    events: { kind: 'webhook', verify },
    read,
    async start(attempt: RailAttempt): Promise<RailStarted> {
      const type = attempt.method === 'bank_transfer' ? 'customer_balance' : attempt.method;
      const body: RailBody = {
        amount: attempt.amount,
        currency: attempt.currency.toLowerCase(),
        allowed_payment_method_types: [type],
        metadata: {
          [ATTEMPT_METADATA]: attempt.id,
          [METHOD_METADATA]: attempt.method,
          seams_order: attempt.orderReference,
        },
        ...(await confirmBody(attempt)),
      };
      const intent = await http.post('/v1/payment_intents', body, attempt.id);
      const ref = requireNonEmptyString(intent.id, 'PaymentIntent id');
      const payment = paymentState(intent);
      if (attempt.method !== 'card') return { ref, payment, ...nextStep(intent) };
      return {
        ref,
        payment,
        start: {
          kind: 'card_form',
          fields: 'stripe',
          publishableKey: account.public.publishableKey ?? '',
          clientSecret: requireNonEmptyString(intent.client_secret, 'PaymentIntent client secret'),
        },
      };
    },
    async cancel(ref) {
      try {
        await http.post(`${intentPath(ref)}/cancel`, {});
        return { kind: 'cancelled' };
      } catch (error) {
        // Stripe refuses a cancel of a PaymentIntent that is paid or already cancelled.
        if (error instanceof RailError && error.code === 'payment_intent_unexpected_state') {
          return { kind: (await read(ref)).state === 'cancelled' ? 'cancelled' : 'too_late' };
        }
        throw error;
      }
    },
  };
}

function isLiveKey(key: string): boolean {
  return key.includes('_live_');
}

export const stripeRail: RailModule = {
  id: 'stripe',
  methods: METHODS,
  accepts: (method, currency, amount) => acceptsOrder(METHODS, YEN_LIMITS, method, currency, amount),
  fields: (method) => FIELDS[method] ?? [],
  parseAccount(input) {
    if (!hasExactKeys(input, ['publishableKey', 'restrictedKey', 'webhookSecret'])) {
      throw new Error('A Stripe account has a publishableKey, a restrictedKey and a webhookSecret');
    }
    const publishableKey = requireNonEmptyString(input.publishableKey, 'publishableKey');
    const restrictedKey = requireNonEmptyString(input.restrictedKey, 'restrictedKey');
    const webhookSecret = requireNonEmptyString(input.webhookSecret, 'webhookSecret');
    if (!/^pk_(test|live)_/.test(publishableKey)) {
      throw new Error('The Stripe publishableKey starts with pk_test_ or pk_live_');
    }
    // A restricted key can only do what the merchant allowed. A secret key (sk_) can pay out
    // and read all data, so the checkout never stores one.
    if (!/^rk_(test|live)_/.test(restrictedKey)) {
      throw new Error('The checkout accepts only a Stripe restricted key (rk_test_ or rk_live_)');
    }
    if (isLiveKey(publishableKey) !== isLiveKey(restrictedKey)) {
      throw new Error('The Stripe keys are not of the same mode: one is live and one is test');
    }
    if (!webhookSecret.startsWith('whsec_')) {
      throw new Error('The Stripe webhookSecret starts with whsec_');
    }
    return { public: { publishableKey }, secrets: { restrictedKey, webhookSecret } };
  },
  connect: (account, context) => connectStripe(account, context.fetch),
};

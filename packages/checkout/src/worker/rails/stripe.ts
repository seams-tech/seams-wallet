import { hasExactKeys } from '@shared/utils/exactKeys';
import {
  asRecord,
  isString,
  requireNonEmptyString,
  toOptionalTrimmedNonEmptyString,
} from '@shared/utils/validation';
import type { CheckoutMethod } from '../../shared/methods';
import { verifyTimestamped } from '../../shared/signature';
import type { AttemptState } from '../../shared/orderState';
import { createRailHttp, type RailBody, type RailHttp } from './http';
import {
  RailError,
  type PaymentRail,
  type RailAccount,
  type RailAttempt,
  type RailEvent,
  type RailFailure,
  type RailModule,
  type RailPaymentState,
  type RailWebhook,
} from './rail';

const STRIPE_API = 'https://api.stripe.com';
/** The API version that this rail was written against. Stripe keeps old versions working. */
const STRIPE_API_VERSION = '2026-11-18.endive';
/** Stripe's own tolerance for the age of a webhook. */
const WEBHOOK_TOLERANCE_SECONDS = 300;
/** The metadata key that marks a PaymentIntent of the checkout, with the attempt ID. */
const ATTEMPT_METADATA = 'seams_attempt';

const METHODS: ReadonlySet<CheckoutMethod> = new Set(['card']);

const STATES: Readonly<Record<string, AttemptState>> = {
  requires_payment_method: 'created',
  requires_confirmation: 'created',
  requires_action: 'requires_action',
  processing: 'requires_action',
  succeeded: 'succeeded',
  canceled: 'cancelled',
};

function readFailure(body: Record<string, unknown>): RailFailure {
  const error = asRecord(body.error) ?? asRecord(body.last_payment_error) ?? {};
  return {
    code: toOptionalTrimmedNonEmptyString(error.decline_code ?? error.code) ?? 'stripe_error',
    message: toOptionalTrimmedNonEmptyString(error.message) ?? 'Stripe refused the request',
  };
}

function paymentState(intent: Record<string, unknown>): RailPaymentState {
  const state = STATES[String(intent.status)];
  if (!state) {
    throw new RailError('unavailable', 'unknown_status', `Unknown PaymentIntent status ${intent.status}`);
  }
  const paid =
    state === 'succeeded'
      ? { amount: Number(intent.amount_received), currency: String(intent.currency).toUpperCase() }
      : null;
  return { state, paid, failure: intent.last_payment_error ? readFailure(intent) : null };
}

function intentPath(ref: string): string {
  return `/v1/payment_intents/${encodeURIComponent(ref)}`;
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
    async start(attempt: RailAttempt) {
      const body: RailBody = {
        amount: attempt.amount,
        currency: attempt.currency.toLowerCase(),
        allowed_payment_method_types: ['card'],
        metadata: { [ATTEMPT_METADATA]: attempt.id, seams_order: attempt.orderReference },
        ...(attempt.details.email ? { receipt_email: attempt.details.email } : {}),
      };
      const intent = await http.post('/v1/payment_intents', body, attempt.id);
      return {
        ref: requireNonEmptyString(intent.id, 'PaymentIntent id'),
        payment: paymentState(intent),
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
  fields: () => ['email'],
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

import type { CheckoutMethod, CustomerField } from '../../packages/checkout/src/shared/methods';
import type { AttemptState } from '../../packages/checkout/src/shared/orderState';
import { hmacSha256Hex } from '../../packages/checkout/src/shared/signature';
import {
  RailError,
  type RailAttempt,
  type RailCancel,
  type RailModule,
  type RailPaymentState,
} from '../../packages/checkout/src/worker/rails/rail';

type FakePayment = {
  readonly ref: string;
  readonly attempt: RailAttempt;
  state: AttemptState;
  paidAmount: number | null;
  failure: { code: string; message: string } | null;
};

const WEBHOOK_SECRET = 'fake-webhook-secret';

/**
 * A provider in memory. A test moves a payment as a customer or a provider does, and then sends
 * the signed webhook. Each call of the rail is recorded.
 */
export class FakeProvider {
  readonly payments = new Map<string, FakePayment>();
  readonly calls: string[] = [];
  startAnswer: 'ok' | 'refused' | 'no_answer' = 'ok';
  cancelAnswer: RailCancel['kind'] | 'no_answer' = 'cancelled';
  private nextRef = 1;

  /** The payment of the newest attempt. */
  get last(): FakePayment {
    const payment = [...this.payments.values()].at(-1);
    if (!payment) throw new Error('The fake provider has no payment');
    return payment;
  }

  start(attempt: RailAttempt): FakePayment {
    this.calls.push(`start:${attempt.method}`);
    if (this.startAnswer === 'no_answer') throw new RailError('unavailable', 'no_answer', 'No answer');
    if (this.startAnswer === 'refused') throw new RailError('refused', 'bad_request', 'Refused');
    // An idempotent provider gives the same payment to a repeat of the same attempt.
    const existing = [...this.payments.values()].find((payment) => payment.attempt.id === attempt.id);
    if (existing) return existing;
    const payment: FakePayment = {
      ref: `fp_${this.nextRef++}`,
      attempt,
      state: 'created',
      paidAmount: null,
      failure: null,
    };
    this.payments.set(payment.ref, payment);
    return payment;
  }

  read(ref: string): RailPaymentState {
    const payment = this.payments.get(ref);
    if (!payment) throw new RailError('refused', 'not_found', 'No such payment');
    return {
      state: payment.state,
      paid:
        payment.paidAmount === null
          ? null
          : { amount: payment.paidAmount, currency: payment.attempt.currency },
      failure: payment.failure,
    };
  }

  cancel(ref: string): RailCancel {
    this.calls.push(`cancel:${ref}`);
    if (this.cancelAnswer === 'no_answer') throw new RailError('unavailable', 'no_answer', 'No answer');
    const payment = this.payments.get(ref);
    if (this.cancelAnswer === 'cancelled' && payment) payment.state = 'cancelled';
    return { kind: this.cancelAnswer };
  }

  /** The customer pays. `amount` is the order amount unless the test gives another one. */
  pay(ref: string, amount?: number): void {
    const payment = this.payments.get(ref)!;
    payment.state = 'succeeded';
    payment.paidAmount = amount ?? payment.attempt.amount;
  }

  decline(ref: string): void {
    this.payments.get(ref)!.failure = { code: 'card_declined', message: 'Your card was declined.' };
  }

  set(ref: string, state: AttemptState): void {
    this.payments.get(ref)!.state = state;
  }

  /** The signed webhook for a payment, as the provider sends it. */
  async webhook(ref: string, secret = WEBHOOK_SECRET): Promise<{ body: string; signature: string }> {
    const body = JSON.stringify({ ref, attempt: this.payments.get(ref)?.attempt.id ?? null });
    return { body, signature: await hmacSha256Hex(secret, body) };
  }
}

/** A rail of the fake provider. Its account has one public value and one webhook secret. */
export function fakeRail(
  provider: FakeProvider,
  id = 'fake',
  methods: readonly CheckoutMethod[] = ['card'],
  fields: readonly CustomerField[] = [],
): RailModule {
  return {
    id,
    methods: new Set(methods),
    fields: () => fields,
    parseAccount: () => ({
      public: { publishableKey: `${id}_pk` },
      secrets: { webhookSecret: WEBHOOK_SECRET },
    }),
    connect: (account) => ({
      events: {
        kind: 'webhook',
        async verify(webhook) {
          const expected = await hmacSha256Hex(account.secrets.webhookSecret ?? '', webhook.body);
          if (webhook.header('fake-signature') !== expected) return null;
          const { ref, attempt } = JSON.parse(webhook.body) as { ref: string; attempt: string | null };
          return { kind: 'payment', attemptId: attempt, ref };
        },
      },
      async start(attempt) {
        const payment = provider.start(attempt);
        return {
          ref: payment.ref,
          payment: provider.read(payment.ref),
          start: {
            kind: 'card_form',
            fields: 'stripe',
            publishableKey: account.public.publishableKey ?? '',
            clientSecret: `${payment.ref}_secret`,
          },
        };
      },
      read: async (ref) => provider.read(ref),
      cancel: async (ref) => provider.cancel(ref),
    }),
  };
}

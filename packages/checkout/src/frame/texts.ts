import type { CheckoutLocale } from '../shared/api';
import type { CheckoutMethod, CustomerField } from '../shared/methods';

/** Each text of the checkout frame. The provider's fields get the same locale. */
type Texts = {
  readonly title: string;
  readonly close: string;
  readonly orderSummary: string;
  readonly shipping: string;
  readonly total: string;
  readonly methodsLabel: string;
  readonly methods: Readonly<Record<CheckoutMethod, string>>;
  readonly fields: Readonly<Record<CustomerField, string>>;
  readonly continue: string;
  readonly pay: (amount: string) => string;
  readonly loading: string;
  readonly preparing: string;
  readonly confirming: string;
  readonly paidTitle: string;
  readonly paidBody: string;
  readonly pendingTitle: string;
  readonly pendingBody: string;
  readonly done: string;
  readonly closedTitle: Readonly<Record<'expired' | 'cancelled' | 'unavailable', string>>;
  readonly noMethods: string;
  readonly errorGeneric: string;
  readonly errorDeclined: string;
  readonly errorField: (field: string) => string;
  readonly retry: string;
};

const en: Texts = {
  title: 'Checkout',
  close: 'Close',
  orderSummary: 'Order summary',
  shipping: 'Shipping',
  total: 'Total',
  methodsLabel: 'Payment method',
  methods: { card: 'Card' },
  fields: { email: 'Email address' },
  continue: 'Continue',
  pay: (amount) => `Pay ${amount}`,
  loading: 'Loading the order',
  preparing: 'Preparing the payment',
  confirming: 'Confirming your payment',
  paidTitle: 'Payment complete',
  paidBody: 'Thank you. We sent the details to your email address.',
  pendingTitle: 'We are confirming your payment',
  pendingBody: 'This can take a few minutes. You can close this window.',
  done: 'Done',
  closedTitle: {
    expired: 'This order expired',
    cancelled: 'This order was cancelled',
    unavailable: 'This order cannot be paid here',
  },
  noMethods: 'No payment method is available for this order.',
  errorGeneric: 'The payment did not start. Try again.',
  errorDeclined: 'The payment was declined. Check the details or use another method.',
  errorField: (field) => `Enter: ${field}`,
  retry: 'Try again',
};

const ja: Texts = {
  title: 'お支払い',
  close: '閉じる',
  orderSummary: 'ご注文内容',
  shipping: '送料',
  total: '合計',
  methodsLabel: 'お支払い方法',
  methods: { card: 'クレジットカード' },
  fields: { email: 'メールアドレス' },
  continue: '次へ',
  pay: (amount) => `${amount}を支払う`,
  loading: 'ご注文を読み込んでいます',
  preparing: 'お支払いを準備しています',
  confirming: 'お支払いを確認しています',
  paidTitle: 'お支払いが完了しました',
  paidBody: 'ありがとうございます。詳細をメールでお送りしました。',
  pendingTitle: 'お支払いを確認しています',
  pendingBody: '数分かかる場合があります。この画面は閉じても問題ありません。',
  done: '完了',
  closedTitle: {
    expired: 'このご注文は期限切れです',
    cancelled: 'このご注文はキャンセルされました',
    unavailable: 'このご注文はここではお支払いできません',
  },
  noMethods: 'このご注文で利用できるお支払い方法がありません。',
  errorGeneric: 'お支払いを開始できませんでした。もう一度お試しください。',
  errorDeclined: 'お支払いが承認されませんでした。内容をご確認いただくか、別の方法をお試しください。',
  errorField: (field) => `${field}を入力してください`,
  retry: 'もう一度試す',
};

export type FrameTexts = Texts;

export function textsFor(locale: CheckoutLocale): FrameTexts {
  return locale === 'ja' ? ja : en;
}

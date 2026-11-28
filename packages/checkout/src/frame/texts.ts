import type { CheckoutLocale } from '../shared/api';
import type { CheckoutMethod, CustomerField, KonbiniStore } from '../shared/methods';

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
  readonly stores: Readonly<Record<KonbiniStore, string>>;
  readonly voucherTitle: string;
  readonly bankTitle: string;
  readonly payBy: (deadline: string) => string;
  readonly paymentCode: string;
  readonly confirmationCode: string;
  readonly instructions: string;
  readonly bank: Readonly<Record<'bankName' | 'branchName' | 'accountType' | 'accountNumber' | 'accountHolder', string>>;
  readonly redirectTitle: (method: string) => string;
  readonly redirectBody: string;
  readonly redirectOpen: (method: string) => string;
  readonly otherMethod: string;
  readonly returned: string;
};

const en: Texts = {
  title: 'Checkout',
  close: 'Close',
  orderSummary: 'Order summary',
  shipping: 'Shipping',
  total: 'Total',
  methodsLabel: 'Payment method',
  methods: { card: 'Card', konbini: 'Convenience store', bank_transfer: 'Bank transfer', paypay: 'PayPay' },
  fields: {
    email: 'Email address',
    full_name: 'Full name',
    family_name: 'Family name',
    given_name: 'Given name',
    family_name_kana: 'Family name (katakana)',
    given_name_kana: 'Given name (katakana)',
    phone: 'Phone number',
    konbini_store: 'Store',
  },
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
  stores: {
    seven_eleven: '7-Eleven',
    lawson: 'Lawson',
    family_mart: 'FamilyMart',
    ministop: 'Ministop',
    daily_yamazaki: 'Daily Yamazaki',
    seicomart: 'Seicomart',
  },
  voucherTitle: 'Pay at the store',
  bankTitle: 'Send the bank transfer',
  payBy: (deadline) => `Pay by ${deadline}`,
  paymentCode: 'Payment code',
  confirmationCode: 'Confirmation number',
  instructions: 'Open the payment instructions',
  bank: {
    bankName: 'Bank',
    branchName: 'Branch',
    accountType: 'Account type',
    accountNumber: 'Account number',
    accountHolder: 'Account holder',
  },
  redirectTitle: (method) => `Approve the payment with ${method}`,
  redirectBody: 'The page opens in a new tab. Come back here after you approve the payment.',
  redirectOpen: (method) => `Open ${method}`,
  otherMethod: 'Use another payment method',
  returned: 'You can close this window and go back to the shop.',
};

const ja: Texts = {
  title: 'お支払い',
  close: '閉じる',
  orderSummary: 'ご注文内容',
  shipping: '送料',
  total: '合計',
  methodsLabel: 'お支払い方法',
  methods: { card: 'クレジットカード', konbini: 'コンビニ払い', bank_transfer: '銀行振込', paypay: 'PayPay' },
  fields: {
    email: 'メールアドレス',
    full_name: 'お名前',
    family_name: '姓',
    given_name: '名',
    family_name_kana: '姓（カタカナ）',
    given_name_kana: '名（カタカナ）',
    phone: '電話番号',
    konbini_store: 'コンビニ',
  },
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
  stores: {
    seven_eleven: 'セブン-イレブン',
    lawson: 'ローソン',
    family_mart: 'ファミリーマート',
    ministop: 'ミニストップ',
    daily_yamazaki: 'デイリーヤマザキ',
    seicomart: 'セイコーマート',
  },
  voucherTitle: 'コンビニでお支払いください',
  bankTitle: '銀行振込でお支払いください',
  payBy: (deadline) => `お支払い期限：${deadline}`,
  paymentCode: 'お支払い番号',
  confirmationCode: '確認番号',
  instructions: 'お支払い方法の詳細を開く',
  bank: {
    bankName: '銀行名',
    branchName: '支店名',
    accountType: '口座種別',
    accountNumber: '口座番号',
    accountHolder: '口座名義',
  },
  redirectTitle: (method) => `${method}でお支払いを承認してください`,
  redirectBody: '新しいタブで開きます。承認後、この画面に戻ってください。',
  redirectOpen: (method) => `${method}を開く`,
  otherMethod: '別のお支払い方法を選ぶ',
  returned: 'この画面を閉じて、ショップにお戻りください。',
};

export type FrameTexts = Texts;

export function textsFor(locale: CheckoutLocale): FrameTexts {
  return locale === 'ja' ? ja : en;
}

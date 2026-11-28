// The one table of auth result codes: the HTTP status of each code and its text in English and
// Japanese. The Auth Worker answers with a code from this table, and the client shows its text.

export const AUTH_CODES = {
  invalid_body: {
    status: 400,
    en: 'The request is not valid.',
    ja: 'リクエストが正しくありません。',
  },
  unauthorized: { status: 401, en: 'Sign in again.', ja: 'もう一度サインインしてください。' },
  forbidden: {
    status: 403,
    en: 'This request is not allowed.',
    ja: 'このリクエストは許可されていません。',
  },
  not_found: { status: 404, en: 'Not found.', ja: '見つかりません。' },
  not_configured: {
    status: 503,
    en: 'This sign-in method is not set up.',
    ja: 'このサインイン方法は設定されていません。',
  },
  internal: {
    status: 500,
    en: 'Something went wrong. Try again.',
    ja: 'エラーが発生しました。もう一度お試しください。',
  },
  rate_limited: {
    status: 429,
    en: 'Too many attempts. Try again later.',
    ja: '試行回数が多すぎます。しばらくしてからお試しください。',
  },
  challenge_expired_or_invalid: {
    status: 401,
    en: 'This request has expired. Try again.',
    ja: 'リクエストの有効期限が切れました。もう一度お試しください。',
  },
  invalid_origin: {
    status: 403,
    en: 'The passkey was used on another site.',
    ja: 'パスキーが別のサイトで使用されました。',
  },
  unknown_credential: {
    status: 401,
    en: 'This passkey is not registered.',
    ja: 'このパスキーは登録されていません。',
  },
  invalid_proof: {
    status: 401,
    en: 'The sign-in check failed.',
    ja: 'サインインの確認に失敗しました。',
  },
  user_verification_required: {
    status: 401,
    en: 'Confirm with your screen lock, fingerprint or face.',
    ja: '画面ロック、指紋または顔で確認してください。',
  },
  email_code_invalid: {
    status: 401,
    en: 'The code is not correct.',
    ja: 'コードが正しくありません。',
  },
  email_code_locked: {
    status: 429,
    en: 'Too many wrong codes. Request a new code.',
    ja: '間違ったコードが多すぎます。新しいコードをリクエストしてください。',
  },
  audience_not_allowed: {
    status: 403,
    en: 'This proof is not available here.',
    ja: 'この確認はここでは利用できません。',
  },
  account_choice_required: {
    status: 409,
    en: 'Choose the account to sign in to.',
    ja: 'サインインするアカウントを選択してください。',
  },
  method_exists: {
    status: 409,
    en: 'This sign-in method is already added.',
    ja: 'このサインイン方法はすでに追加されています。',
  },
  last_method: {
    status: 409,
    en: 'You cannot remove your last sign-in method.',
    ja: '最後のサインイン方法は削除できません。',
  },
  removal_refused: {
    status: 409,
    en: 'This sign-in method is still in use and cannot be removed.',
    ja: 'このサインイン方法は使用中のため削除できません。',
  },
  removal_unavailable: {
    status: 503,
    en: 'The removal could not be confirmed. Try again.',
    ja: '削除を確認できませんでした。もう一度お試しください。',
  },
} as const satisfies Record<string, { status: number; en: string; ja: string }>;

export type AuthCode = keyof typeof AUTH_CODES;

export type AuthFailure<C extends AuthCode = AuthCode> = {
  readonly ok: false;
  readonly code: C;
  readonly message: string;
};

/** A failure with the English text of its code. `detail` replaces the text for an operator log. */
export function authFailure<const C extends AuthCode>(code: C, detail?: string): AuthFailure<C> {
  return { ok: false, code, message: detail || AUTH_CODES[code].en };
}

export function isAuthCode(value: unknown): value is AuthCode {
  return typeof value === 'string' && Object.hasOwn(AUTH_CODES, value);
}

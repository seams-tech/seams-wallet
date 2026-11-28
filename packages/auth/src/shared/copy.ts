// The text of the auth menu in English and Japanese, and the part of it that an app can
// replace. The keys that an app can replace are an integrator contract: an app that sets one
// sees its own words, and an unknown key is refused.

export const AUTH_LOCALES = ['en', 'ja'] as const;
export type AuthLocale = (typeof AUTH_LOCALES)[number];

export function parseAuthLocale(value: unknown): AuthLocale | null {
  return AUTH_LOCALES.find((locale) => locale === value) ?? null;
}

const EN = {
  title: 'Sign in',
  subtitle: 'Use a passkey or your email address.',
  passkeyCta: 'Continue with a passkey',
  createAccountCta: 'Create an account with a passkey',
  emailLabel: 'Email address',
  emailCta: 'Continue with email',
  voiceIdCta: 'Continue with VoiceID',
  codeTitle: 'Enter the code',
  codeSubtitle: 'We sent a 6-digit code to {email}.',
  codeLabel: '6-digit code',
  codeCta: 'Continue',
  resendCta: 'Send a new code',
  backCta: 'Back',
  closeCta: 'Close',
  accountChoiceTitle: 'Choose an account',
  proveTitle: 'Confirm it is you',
  provePasskeyCta: 'Confirm with a passkey',
  proveEmailCta: 'Send a code to {email}',
  proveVoiceIdCta: 'Confirm with VoiceID',
  methodsTitle: 'Sign-in methods',
  addPasskeyCta: 'Add a passkey',
  addEmailCta: 'Add an email address',
  addVoiceIdCta: 'Add VoiceID',
  removeTitle: 'Remove this sign-in method',
  removeSubtitle: 'Confirm with another sign-in method.',
  methodPasskey: 'Passkey',
  methodEmail: 'Email code',
  methodVoiceId: 'VoiceID',
  working: 'One moment…',
  passkeyCancelled: 'The passkey prompt was closed. Try again.',
  passkeyUnsupported: 'This browser cannot use passkeys here.',
  voiceIdUnavailable: 'VoiceID is not set up on this device.',
} as const;

export type AuthMenuText = { readonly [Key in keyof typeof EN]: string };

const JA: AuthMenuText = {
  title: 'サインイン',
  subtitle: 'パスキーまたはメールアドレスを使用します。',
  passkeyCta: 'パスキーで続ける',
  createAccountCta: 'パスキーでアカウントを作成',
  emailLabel: 'メールアドレス',
  emailCta: 'メールで続ける',
  voiceIdCta: 'VoiceIDで続ける',
  codeTitle: 'コードを入力',
  codeSubtitle: '{email} に6桁のコードを送信しました。',
  codeLabel: '6桁のコード',
  codeCta: '続ける',
  resendCta: '新しいコードを送信',
  backCta: '戻る',
  closeCta: '閉じる',
  accountChoiceTitle: 'アカウントを選択',
  proveTitle: 'ご本人確認',
  provePasskeyCta: 'パスキーで確認',
  proveEmailCta: '{email} にコードを送信',
  proveVoiceIdCta: 'VoiceIDで確認',
  methodsTitle: 'サインイン方法',
  addPasskeyCta: 'パスキーを追加',
  addEmailCta: 'メールアドレスを追加',
  addVoiceIdCta: 'VoiceIDを追加',
  removeTitle: 'このサインイン方法を削除',
  removeSubtitle: '別のサインイン方法で確認してください。',
  methodPasskey: 'パスキー',
  methodEmail: 'メールコード',
  methodVoiceId: 'VoiceID',
  working: 'お待ちください…',
  passkeyCancelled: 'パスキーの確認が閉じられました。もう一度お試しください。',
  passkeyUnsupported: 'このブラウザではパスキーを使用できません。',
  voiceIdUnavailable: 'このデバイスではVoiceIDが設定されていません。',
};

/** The keys that an app can replace with its own words. */
export const AUTH_MENU_COPY_KEYS = [
  'title',
  'subtitle',
  'passkeyCta',
  'createAccountCta',
  'emailCta',
  'voiceIdCta',
] as const satisfies readonly (keyof AuthMenuText)[];

export type AuthMenuCopy = { readonly [Key in (typeof AUTH_MENU_COPY_KEYS)[number]]?: string };

const MAX_COPY_LENGTH = 120;

/** The app's copy, or null when it has an unknown key or a value that is not short text. */
export function parseAuthMenuCopy(value: unknown): AuthMenuCopy | null {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const copy: { -readonly [Key in keyof AuthMenuCopy]: string } = {};
  for (const [key, text] of Object.entries(value)) {
    const known = AUTH_MENU_COPY_KEYS.find((candidate) => candidate === key);
    if (!known || typeof text !== 'string' || !text.trim() || text.length > MAX_COPY_LENGTH) {
      return null;
    }
    copy[known] = text;
  }
  return copy;
}

export function authMenuText(locale: AuthLocale, copy: AuthMenuCopy): AuthMenuText {
  return { ...(locale === 'ja' ? JA : EN), ...copy };
}

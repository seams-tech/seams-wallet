// The text of the email that carries a code. The purpose line comes from the operator's
// configuration of the audience, never from the app page.

export const AUTH_LOCALES = ['en', 'ja'] as const;
export type AuthLocale = (typeof AUTH_LOCALES)[number];

export type PurposeText = { readonly en: string; readonly ja: string };

export function parseAuthLocale(value: unknown): AuthLocale {
  return value === 'ja' ? 'ja' : 'en';
}

const SIGN_IN_PURPOSE: PurposeText = { en: 'sign in', ja: 'サインイン' };

export function emailCodeMessage(input: {
  readonly appName: string;
  readonly code: string;
  readonly locale: AuthLocale;
  /** With no purpose, the code is for a sign-in. */
  readonly purpose: PurposeText | undefined;
}): { subject: string; text: string } {
  const purpose = (input.purpose ?? SIGN_IN_PURPOSE)[input.locale];
  if (input.locale === 'ja') {
    return {
      subject: `${input.appName} の確認コード: ${input.code}`,
      text: [
        `${input.appName} の確認コードは ${input.code} です。`,
        `このコードの用途: ${purpose}`,
        'コードは10分間有効です。このコードを他の人に教えないでください。',
        'このリクエストに心当たりがない場合は、このメールを無視してください。',
      ].join('\n'),
    };
  }
  return {
    subject: `${input.code} is your ${input.appName} code`,
    text: [
      `Your ${input.appName} code is ${input.code}.`,
      `This code is for: ${purpose}`,
      'The code is valid for 10 minutes. Do not give this code to another person.',
      'If you did not ask for this code, ignore this email.',
    ].join('\n'),
  };
}

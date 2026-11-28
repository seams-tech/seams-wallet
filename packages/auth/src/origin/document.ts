import { ACCOUNT_FRAME_PATH } from '../shared/protocol';

// The document of the account frame. The services package builds it for an operator, with the
// configuration of this account origin. The document is static, and its script comes from the
// account origin only.

/** The file of the frame's script, beside the document. */
export const ACCOUNT_FRAME_SCRIPT = 'account-frame.js';
export const ACCOUNT_CONFIG_ELEMENT_ID = 'seams-account-config';

export type AccountOriginConfig = {
  /** The base URL of the Auth Worker. An empty text: the account origin serves its routes. */
  readonly authApiUrl: string;
  /** The passkey relying party ID. It is the host of today's Wallet origin, or a parent of it. */
  readonly rpId: string;
  /** The purpose that the menu shows for each audience, in the operator's words. */
  readonly purposes: Readonly<Record<string, { readonly en: string; readonly ja: string }>>;
};

function htmlEscapeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function accountFrameHtml(config: AccountOriginConfig): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Sign in</title>
    <script type="application/json" id="${ACCOUNT_CONFIG_ELEMENT_ID}">${htmlEscapeJson(config)}</script>
    <script type="module" src="${ACCOUNT_FRAME_PATH}${ACCOUNT_FRAME_SCRIPT}"></script>
  </head>
  <body></body>
</html>
`;
}

/**
 * The Content-Security-Policy of the account document. Scripts come only from the account
 * origin, which also serves each plugin and each gate. The frame calls only the Auth Worker and
 * its own origin. A plugin that needs another host adds it in the operator's own policy.
 */
export function accountFrameCsp(config: Pick<AccountOriginConfig, 'authApiUrl'>): string {
  const api = config.authApiUrl ? ` ${new URL(config.authApiUrl).origin}` : '';
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `connect-src 'self'${api}`,
    "img-src 'self' data:",
    "worker-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

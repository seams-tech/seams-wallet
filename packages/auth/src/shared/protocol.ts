import { hasExactKeys } from '@shared/utils/exactKeys';
import { isPlainObject } from '@shared/utils/validation';
import { parseAudience, parseChallenge } from '../proofs/audience';
import { parseAuthLocale, parseAuthMenuCopy, type AuthLocale, type AuthMenuCopy } from './copy';

// The messages between the app page and the account frame, over the port of the frame kit.
// The app page sends requests and gets only results: a login token, a proof statement, a list
// of methods. No message carries a session secret, a key or a factor secret, and a request has
// no field for a secret sink.

/** A page SDK refuses an account origin of another version, and the frame refuses the page. */
export const AUTH_PROTOCOL = { name: 'seams-auth', version: '1' } as const;

/** The path of the account frame document on the account origin. */
export const ACCOUNT_FRAME_PATH = '/account/';

/** The width of the account frame in a dialog. The frame reports its height. */
export const AUTH_FRAME_WIDTH_CSS_PX = 400;

/** The methods as the app API names them. */
export const AUTH_METHOD_NAMES = ['passkey', 'email_code', 'voiceid'] as const;
export type AuthMethodName = (typeof AUTH_METHOD_NAMES)[number];

/** The name of the window event that carries the raw text of an auth menu error. */
export const AUTH_ERROR_EVENT = 'seams:auth-error';

export type AuthErrorDetail = {
  readonly kind: 'auth_error_v1';
  /** The result code of the Auth Worker, or a code of the browser step. */
  readonly code: string;
  /** The raw text of the error, for the app's own log. */
  readonly message: string;
  /** The view of the auth menu that showed the error. */
  readonly view: string;
};

export type AuthMethodSummary = {
  readonly id: string;
  readonly method: AuthMethodName;
  /** A masked email address, or an empty text. */
  readonly label: string;
  readonly createdAtMs: number;
};

export type AuthSessionSummary = {
  readonly accountId: string;
  /** The login token for the app's backend. */
  readonly token: string;
  readonly tokenExpiresAtMs: number;
};

type Unavailable = { readonly kind: 'unavailable'; readonly reason: string };
type Cancelled = { readonly kind: 'cancelled' };

export type SignInResult =
  | ({ readonly kind: 'signed_in' } & AuthSessionSummary)
  | Cancelled
  | Unavailable;
export type SessionResult =
  | ({ readonly kind: 'session' } & AuthSessionSummary)
  | { readonly kind: 'none' };
export type ProveResult =
  | { readonly kind: 'proved'; readonly statement: string; readonly expiresAtMs: number }
  | Cancelled
  | Unavailable;
export type MethodsResult =
  | { readonly kind: 'methods'; readonly methods: readonly AuthMethodSummary[] }
  | Unavailable;
export type MethodChangeResult =
  | { readonly kind: 'done'; readonly methods: readonly AuthMethodSummary[] }
  | Cancelled
  | Unavailable;

export type InitMessage = {
  readonly type: 'init';
  readonly publishableKey: string;
  readonly environmentId: string;
  readonly methods: readonly AuthMethodName[];
  /** The plugins of the account origin that the app enables. */
  readonly plugins: readonly string[];
  readonly locale: AuthLocale;
  readonly copy: AuthMenuCopy;
};

export type PageRequest =
  | { readonly type: 'sign_in'; readonly requestId: string }
  | { readonly type: 'session'; readonly requestId: string }
  | { readonly type: 'sign_out'; readonly requestId: string }
  | {
      readonly type: 'prove';
      readonly requestId: string;
      readonly audience: string;
      readonly challenge: string;
    }
  | { readonly type: 'methods_list'; readonly requestId: string }
  | { readonly type: 'methods_add'; readonly requestId: string; readonly method: AuthMethodName }
  | { readonly type: 'methods_remove'; readonly requestId: string; readonly id: string }
  /** The user closed the dialog of an open request. */
  | { readonly type: 'cancel'; readonly requestId: string }
  /** Opens a channel to one plugin. The message carries one port for the plugin. */
  | { readonly type: 'channel'; readonly pluginId: string };

type WithoutRequestId<Request> = Request extends { readonly requestId: string }
  ? Omit<Request, 'requestId'>
  : never;

/** A request before the page gives it an ID. */
export type PageRequestBody = WithoutRequestId<PageRequest>;

export type FrameMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'refused'; readonly reason: string }
  | { readonly type: 'reply'; readonly requestId: string; readonly result: unknown }
  /**
   * The frame needs the dialog: for a request of the page, or for a plugin. A plugin's dialog
   * has an ID that starts with `frame:`, and the frame closes it with `hide`.
   */
  | { readonly type: 'show'; readonly requestId: string; readonly title: string }
  | { readonly type: 'hide'; readonly requestId: string }
  | { readonly type: 'resize'; readonly requestId: string; readonly heightCssPx: number }
  | { readonly type: 'session_changed'; readonly accountId: string | null }
  | ({ readonly type: 'error' } & AuthErrorDetail);

function text(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

const PLUGIN_ID = /^[a-z][a-z0-9-]{0,31}$/;

export function parsePluginId(value: unknown): string | null {
  return typeof value === 'string' && PLUGIN_ID.test(value) ? value : null;
}

function parseMethodName(value: unknown): AuthMethodName | null {
  return AUTH_METHOD_NAMES.find((name) => name === value) ?? null;
}

function parseUniqueList<Item>(
  value: unknown,
  parse: (item: unknown) => Item | null,
): Item[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const items: Item[] = [];
  for (const raw of value) {
    const item = parse(raw);
    if (item === null || items.includes(item)) return null;
    items.push(item);
  }
  return items;
}

/** The first message of the page. Null: the frame refuses it and does nothing. */
export function parseInitMessage(value: unknown): InitMessage | null {
  if (
    !hasExactKeys(value, [
      'type',
      'publishableKey',
      'environmentId',
      'methods',
      'plugins',
      'locale',
      'copy',
    ]) ||
    value.type !== 'init' ||
    !text(value.publishableKey) ||
    !text(value.environmentId)
  ) {
    return null;
  }
  const methods = parseUniqueList(value.methods, parseMethodName);
  const plugins = parseUniqueList(value.plugins, parsePluginId);
  const locale = parseAuthLocale(value.locale);
  const copy = parseAuthMenuCopy(value.copy);
  if (!methods || methods.length === 0 || !plugins || !locale || !copy) return null;
  return {
    type: 'init',
    publishableKey: value.publishableKey,
    environmentId: value.environmentId,
    methods,
    plugins,
    locale,
    copy,
  };
}

/** A request of the page. A request with a field that its type does not have is refused. */
export function parsePageRequest(value: unknown): PageRequest | null {
  if (!isPlainObject(value)) return null;
  if (value.type === 'channel') {
    const pluginId = parsePluginId(value.pluginId);
    return hasExactKeys(value, ['type', 'pluginId']) && pluginId
      ? { type: 'channel', pluginId }
      : null;
  }
  const requestId = value.requestId;
  if (!text(requestId, 64)) return null;
  switch (value.type) {
    case 'sign_in':
    case 'session':
    case 'sign_out':
    case 'methods_list':
    case 'cancel':
      return hasExactKeys(value, ['type', 'requestId']) ? { type: value.type, requestId } : null;
    case 'prove': {
      const audience = parseAudience(value.audience);
      const challenge = parseChallenge(value.challenge);
      return hasExactKeys(value, ['type', 'requestId', 'audience', 'challenge']) &&
        audience &&
        challenge
        ? { type: 'prove', requestId, audience, challenge }
        : null;
    }
    case 'methods_add': {
      const method = parseMethodName(value.method);
      return hasExactKeys(value, ['type', 'requestId', 'method']) && method
        ? { type: 'methods_add', requestId, method }
        : null;
    }
    case 'methods_remove':
      return hasExactKeys(value, ['type', 'requestId', 'id']) && text(value.id)
        ? { type: 'methods_remove', requestId, id: value.id }
        : null;
    default:
      return null;
  }
}

/** A message of the frame. The page reads a result only for a request that it has open. */
export function parseFrameMessage(value: unknown): FrameMessage | null {
  if (!isPlainObject(value)) return null;
  switch (value.type) {
    case 'ready':
      return { type: 'ready' };
    case 'refused':
      return text(value.reason) ? { type: 'refused', reason: value.reason } : null;
    case 'reply':
      return text(value.requestId, 64) && isPlainObject(value.result)
        ? { type: 'reply', requestId: value.requestId, result: value.result }
        : null;
    case 'show':
      return text(value.requestId, 64) && text(value.title)
        ? { type: 'show', requestId: value.requestId, title: value.title }
        : null;
    case 'hide':
      return text(value.requestId, 64) ? { type: 'hide', requestId: value.requestId } : null;
    case 'resize':
      return text(value.requestId, 64) &&
        typeof value.heightCssPx === 'number' &&
        value.heightCssPx > 0 &&
        value.heightCssPx < 10_000
        ? { type: 'resize', requestId: value.requestId, heightCssPx: value.heightCssPx }
        : null;
    case 'session_changed':
      return value.accountId === null || text(value.accountId)
        ? { type: 'session_changed', accountId: value.accountId }
        : null;
    case 'error':
      return text(value.code, 64) && typeof value.message === 'string' && text(value.view, 64)
        ? {
            type: 'error',
            kind: 'auth_error_v1',
            code: value.code,
            message: value.message.slice(0, 2000),
            view: value.view,
          }
        : null;
    default:
      return null;
  }
}

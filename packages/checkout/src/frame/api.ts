import { isObject, isString } from '@shared/utils/validation';
import {
  CHECKOUT_ROUTES,
  type CheckoutErrorCode,
  type CheckoutSession,
  type StartAttemptInput,
} from '../shared/api';

/** A request that the checkout Worker refused. */
export class FrameApiError extends Error {
  readonly code: CheckoutErrorCode | 'bad_answer';

  constructor(code: CheckoutErrorCode | 'bad_answer') {
    super(code);
    this.name = 'FrameApiError';
    this.code = code;
  }
}

type FrameCredentials = {
  readonly clientToken: string;
  readonly publishableKey: string;
  /** The origin of the page that embeds the frame, as the browser reports it. */
  readonly parentOrigin: string;
};

export type FrameApi = {
  session(): Promise<CheckoutSession>;
  start(input: StartAttemptInput): Promise<NonNullable<CheckoutSession['attempt']>>;
};

/** The frame's client of the checkout Worker, which has the same origin as the frame. */
export function createFrameApi(credentials: FrameCredentials): FrameApi {
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${credentials.clientToken}`,
        'seams-publishable-key': credentials.publishableKey,
        'seams-parent-origin': credentials.parentOrigin,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const answer: unknown = await response.json().catch(() => null);
    if (response.ok && isObject(answer)) return answer as T;
    const code = isObject(answer) && isObject(answer.error) ? answer.error.code : null;
    throw new FrameApiError(isString(code) ? (code as CheckoutErrorCode) : 'bad_answer');
  }
  return {
    session: () => call('GET', CHECKOUT_ROUTES.session),
    start: (input) => call('POST', CHECKOUT_ROUTES.attempts, input),
  };
}

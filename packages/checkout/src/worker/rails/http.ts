import { isObject, isPlainObject } from '@shared/utils/validation';
import { RailError, type RailFailure } from './rail';

const DEFAULT_TIMEOUT_MS = 20_000;

type FormValue = string | number | boolean | readonly FormValue[] | { readonly [key: string]: FormValue };

export type RailBody = { readonly [key: string]: FormValue };

type RailHttpOptions = {
  readonly fetch: typeof fetch;
  readonly baseUrl: string;
  /** The value of the `Authorization` header. It never appears in an error or a log. */
  readonly authorization: string;
  readonly idempotencyHeader: string;
  readonly encoding: 'form' | 'json';
  readonly headers?: Readonly<Record<string, string>>;
  /** Reads the provider's error from the body of a refused request. */
  readonly readError: (body: Record<string, unknown>) => RailFailure;
};

/** The REST client of one rail for one merchant account. No provider SDK is in the Worker. */
export type RailHttp = {
  get(path: string): Promise<Record<string, unknown>>;
  post(path: string, body: RailBody, idempotencyKey?: string): Promise<Record<string, unknown>>;
};

function appendForm(params: URLSearchParams, key: string, value: FormValue): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendForm(params, `${key}[${index}]`, item as FormValue));
  } else if (isPlainObject(value)) {
    for (const [name, item] of Object.entries(value)) {
      appendForm(params, `${key}[${name}]`, item as FormValue);
    }
  } else {
    params.append(key, String(value));
  }
}

/** Encodes a body as Stripe reads it: `a[b]=1&c[0]=x`. */
function formEncode(body: RailBody): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) appendForm(params, key, value);
  return params.toString();
}

export function createRailHttp(options: RailHttpOptions): RailHttp {
  async function send(
    method: 'GET' | 'POST',
    path: string,
    body?: RailBody,
    idempotencyKey?: string,
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      ...options.headers,
      accept: 'application/json',
      authorization: options.authorization,
    };
    let payload: string | undefined;
    if (body) {
      const json = options.encoding === 'json';
      headers['content-type'] = json ? 'application/json' : 'application/x-www-form-urlencoded';
      payload = json ? JSON.stringify(body) : formEncode(body);
    }
    if (idempotencyKey) headers[options.idempotencyHeader] = idempotencyKey;

    let response: Response;
    let parsed: unknown;
    try {
      response = await options.fetch(`${options.baseUrl}${path}`, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      parsed = await response.json();
    } catch {
      // The cause can hold the request, so it is not kept.
      throw new RailError('unavailable', 'no_answer', `The provider gave no answer to ${method} ${path}`);
    }
    if (!isObject(parsed)) {
      throw new RailError('unavailable', 'bad_answer', `The provider gave no JSON object to ${method} ${path}`);
    }
    if (response.ok) return parsed;
    const failure = options.readError(parsed);
    // 409: the first request with this idempotency key still runs. 429 and 5xx can pass later.
    const retryable = response.status === 409 || response.status === 429 || response.status >= 500;
    throw new RailError(retryable ? 'unavailable' : 'refused', failure.code, failure.message);
  }

  return {
    get: (path) => send('GET', path),
    post: (path, body, idempotencyKey) => send('POST', path, body, idempotencyKey),
  };
}

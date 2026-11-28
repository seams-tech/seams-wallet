import { isPlainObject } from '@shared/utils/validation';

// The Auth Worker as the account frame calls it. Each request carries the publishable key, the
// environment and the origin of the app page that embeds the frame.

export type ApiFailure = { readonly ok: false; readonly code: string; readonly message: string };
export type ApiResult<Body> =
  | ({ readonly ok: true } & Body)
  | (ApiFailure & Record<string, unknown>);

export type AuthApi = {
  post<Body extends object>(
    path: string,
    body?: object,
    sessionToken?: string | null,
  ): Promise<ApiResult<Body>>;
};

export function createAuthApi(input: {
  readonly baseUrl: string;
  readonly publishableKey: string;
  readonly environmentId: string;
  readonly appOrigin: string;
}): AuthApi {
  return {
    async post<Body extends object>(
      path: string,
      body: object = {},
      sessionToken?: string | null,
    ): Promise<ApiResult<Body>> {
      try {
        const response = await fetch(`${input.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${input.publishableKey}`,
            'x-seams-environment-id': input.environmentId,
            'x-seams-app-origin': input.appOrigin,
            ...(sessionToken ? { 'x-seams-session': sessionToken } : {}),
          },
          body: JSON.stringify(body),
        });
        const answer: unknown = await response.json();
        if (isPlainObject(answer) && answer.ok === true) return answer as ApiResult<Body>;
        if (isPlainObject(answer) && typeof answer.code === 'string') {
          return { ...answer, ok: false, code: answer.code, message: String(answer.message ?? '') };
        }
        return { ok: false, code: 'internal', message: `HTTP ${response.status}` };
      } catch (error) {
        return { ok: false, code: 'network', message: String(error) };
      }
    },
  };
}

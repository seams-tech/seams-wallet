import { verifyLoginToken } from '@seams/auth/server';

// The backend of the example app. It checks the login token with the key set of the Auth
// Worker. It needs no secret of Seams.

export async function me(
  authorization: string | undefined,
  options: { projectId: string; issuer: string },
): Promise<{ status: number; body: object }> {
  const token = authorization?.replace(/^Bearer /i, '') ?? '';
  const user = await verifyLoginToken(token, options);
  if (!user) return { status: 401, body: { error: 'The login token is not valid' } };
  return {
    status: 200,
    body: { accountId: user.accountId, method: user.method, email: user.email },
  };
}

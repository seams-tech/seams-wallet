import { createApplicationAuthAssertion } from '@seams/wallet-server/application-auth';

type ApplicationSession = {
  readonly subject: string;
  readonly expiresAtMs: number;
};

type ApplicationAuthBackend = {
  readonly appOrigin: string;
  readonly issuer: string;
  readonly environmentId: string;
  readonly relayerUrl: string;
  readonly secretApiKey: string;
  readonly privateKey: CryptoKey;
  /** Return the application's verified session after Google or app-passkey login. */
  readonly readApplicationSession: (request: Request) => Promise<ApplicationSession | null>;
};

/** Mount this handler on POST /api/wallet/handoff in the application's backend. */
export async function applicationWalletHandoff(
  request: Request,
  backend: ApplicationAuthBackend,
): Promise<Response> {
  if (request.method !== 'POST' || request.headers.get('Origin') !== backend.appOrigin) {
    return Response.json({ error: 'Invalid request origin.' }, { status: 403 });
  }
  const session = await backend.readApplicationSession(request);
  if (!session || session.expiresAtMs <= Date.now()) {
    return Response.json({ error: 'Sign in to the application.' }, { status: 401 });
  }
  const body: unknown = await request.json();
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Invalid handoff request.');
  const walletId = Reflect.get(body, 'walletId');
  const attemptId = Reflect.get(body, 'attemptId');
  const purpose = Reflect.get(body, 'purpose');
  if (
    typeof walletId !== 'string' ||
    typeof attemptId !== 'string' ||
    (purpose !== 'authenticate' && purpose !== 'associate')
  ) {
    return Response.json({ error: 'Invalid handoff request.' }, { status: 400 });
  }
  const assertion = await createApplicationAuthAssertion({
    privateKey: backend.privateKey,
    issuer: backend.issuer,
    subject: session.subject,
    environmentId: backend.environmentId,
    walletId,
    attemptId,
    purpose,
    nowMs: Date.now(),
    sessionExpiresAtMs: session.expiresAtMs,
  });
  const exchange = await fetch(
    `${backend.relayerUrl.replace(/\/$/, '')}/wallet/external-auth/backend-exchange`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${backend.secretApiKey}`,
        Origin: backend.appOrigin,
        'x-seams-environment-id': backend.environmentId,
      },
      body: JSON.stringify({ walletId, attemptId, proof: { kind: 'application', assertion } }),
    },
  );
  const result: unknown = await exchange.json();
  if (!exchange.ok || !result || typeof result !== 'object' || Reflect.get(result, 'ok') !== true) {
    return Response.json({ error: 'Wallet handoff failed.' }, { status: 403 });
  }
  const value: unknown = Reflect.get(result, 'value');
  if (!value || typeof value !== 'object' || typeof Reflect.get(value, 'code') !== 'string')
    throw new Error('Invalid wallet handoff response.');
  return Response.json(
    { code: Reflect.get(value, 'code') },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

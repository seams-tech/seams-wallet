const ACCESS_HEADER = 'x-r150-benchmark-access';
const CORS_HEADERS = [
  ACCESS_HEADER,
  'content-type',
  'authorization',
  'x-seams-benchmark-diagnostics',
  'x-seams-linked-device-proof-v1',
  'x-seams-wallet-recovery-challenge-id',
  'x-seams-trace-id',
  'x-seams-environment-id',
  'x-environment-id',
].join(', ');

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (origin === env.BENCHMARK_APP_ORIGIN || origin === env.BENCHMARK_WALLET_ORIGIN) {
    return origin;
  }
  return null;
}

function isConfigured(env) {
  const expiresAt = Number(env.BENCHMARK_EXPIRES_AT_MS);
  return (
    typeof env.BENCHMARK_ACCESS_TOKEN === 'string' &&
    env.BENCHMARK_ACCESS_TOKEN.length >= 32 &&
    Number.isSafeInteger(expiresAt) &&
    Date.now() < expiresAt
  );
}

async function hasAccess(request, env) {
  const supplied = request.headers.get(ACCESS_HEADER) ?? '';
  const encoder = new TextEncoder();
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(supplied)),
    crypto.subtle.digest('SHA-256', encoder.encode(env.BENCHMARK_ACCESS_TOKEN)),
  ]);
  return crypto.subtle.timingSafeEqual(suppliedHash, expectedHash);
}

function withCors(response, origin) {
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.set('Access-Control-Allow-Headers', CORS_HEADERS);
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.headers.append('Vary', 'Origin');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export default {
  async fetch(request, env) {
    if (!isConfigured(env)) {
      return new Response(null, { status: 503 });
    }

    const pathname = new URL(request.url).pathname;
    if (request.method === 'GET' && pathname === '/healthz') {
      return new Response(null, { status: 204 });
    }
    if (request.method === 'GET' && pathname === '/readyz') {
      if (!(await hasAccess(request, env))) {
        return new Response(null, { status: 403 });
      }
      const headers = new Headers(request.headers);
      headers.delete(ACCESS_HEADER);
      const upstream = await env.GATEWAY.fetch(new Request(request, { headers }));
      return new Response(null, { status: upstream.ok ? 204 : 503 });
    }

    const origin = allowedOrigin(request, env);
    if (origin === null) {
      return new Response(null, { status: 403 });
    }
    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
    }
    if (!(await hasAccess(request, env))) {
      return withCors(new Response(null, { status: 403 }), origin);
    }

    const headers = new Headers(request.headers);
    headers.delete(ACCESS_HEADER);
    const upstream = await env.GATEWAY.fetch(new Request(request, { headers }));
    if (upstream.status >= 300 && upstream.status < 400) {
      return withCors(new Response(null, { status: 502 }), origin);
    }
    return withCors(new Response(upstream.body, upstream), origin);
  },
};

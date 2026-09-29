const CREATION_PATH = '/router-ab/internal/tenant-root/creation/v1/create';
const INTERNAL_AUTH_HEADER = 'x-router-ab-internal-service-auth';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== CREATION_PATH || url.search) {
      return new Response(null, { status: 404 });
    }
    if (url.hostname !== '127.0.0.1' || request.headers.has('Origin')) {
      return new Response(null, { status: 403 });
    }
    const serviceAuth = request.headers.get(INTERNAL_AUTH_HEADER);
    if (!serviceAuth || request.headers.get('content-type') !== 'application/json') {
      return new Response(null, { status: 403 });
    }
    const headers = new Headers({
      'content-type': 'application/json',
      [INTERNAL_AUTH_HEADER]: serviceAuth,
    });
    const body = await request.arrayBuffer();
    if (body.byteLength > 16_384) {
      return new Response(null, { status: 413 });
    }
    const upstream = await env.ROUTER.fetch(new Request(`https://router.internal${CREATION_PATH}`, {
      method: 'POST',
      headers,
      body,
    }));
    if (upstream.status >= 300 && upstream.status < 400) {
      return new Response(null, { status: 502 });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  },
};

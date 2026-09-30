// The R150 probe Worker: one Playwright container per probe region. Each
// region is its own container application, placed by its region constraint
// (APAC, WEUR or ENAM); Cloudflare picks the location inside it, and the
// container reports where it runs. One Durable Object per region owns its
// container and forwards the runner's requests to the container's server.
//
//   GET    /<region>/identity       the container's runtime identity
//   POST   /<region>/attempts       starts one attempt
//   GET    /<region>/attempts/<id>  the attempt's status and result
//   DELETE /<region>                stops the region's container
//
// Every request needs `Authorization: Bearer <PROBE_ACCESS_TOKEN>` before
// PROBE_EXPIRES_AT_MS. The benchmark access tokens a request carries are
// passed to the container and never stored here.
import { DurableObject } from 'cloudflare:workers';

const REGION_BINDINGS = { apac: 'PROBE_APAC', weur: 'PROBE_WEUR', enam: 'PROBE_ENAM' };
const CONTAINER_PORT = 8080;
const CONTAINER_READY_TIMEOUT_MS = 180_000;
/** An idle container stops after this, so a forgotten probe does not keep billing. */
const CONTAINER_INACTIVITY_TIMEOUT_MS = 10 * 60_000;

class ProbeContainer extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const container = this.ctx.container;
    if (request.method === 'DELETE' && url.pathname === '/') {
      if (container.running) await container.destroy('probe stopped by its operator');
      return Response.json({ stopped: true });
    }
    if (!container.running) {
      container.start({ enableInternet: true });
      await container.setInactivityTimeout(CONTAINER_INACTIVITY_TIMEOUT_MS);
    }
    const body = request.method === 'POST' ? await request.text() : undefined;
    const port = container.getTcpPort(CONTAINER_PORT);
    const deadline = Date.now() + CONTAINER_READY_TIMEOUT_MS;
    for (;;) {
      try {
        return await port.fetch(`http://probe${url.pathname}`, {
          method: request.method,
          headers: { 'content-type': 'application/json' },
          body,
        });
      } catch (error) {
        if (Date.now() > deadline) {
          return Response.json(
            { error: `the probe container did not answer: ${String(error)}` },
            { status: 503 },
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }
}

export class ProbeApac extends ProbeContainer {}
export class ProbeWeur extends ProbeContainer {}
export class ProbeEnam extends ProbeContainer {}

export default {
  async fetch(request, env) {
    const expiresAtMs = Number(env.PROBE_EXPIRES_AT_MS);
    if (!Number.isSafeInteger(expiresAtMs) || Date.now() >= expiresAtMs) {
      return new Response('the probe has expired', { status: 403 });
    }
    if (!(await authorized(request, env.PROBE_ACCESS_TOKEN))) {
      return new Response('unauthorized', { status: 401 });
    }
    const url = new URL(request.url);
    const [, region, ...rest] = url.pathname.split('/');
    const bindingName = REGION_BINDINGS[region];
    if (!bindingName) return new Response('not found', { status: 404 });
    const namespace = env[bindingName];
    const stub = namespace.get(namespace.idFromName('probe'));
    return await stub.fetch(`http://probe/${rest.join('/')}`, {
      method: request.method,
      headers: { 'content-type': 'application/json' },
      body: request.method === 'POST' ? await request.text() : undefined,
    });
  },
};

async function authorized(request, token) {
  if (typeof token !== 'string' || token.length < 32) return false;
  const encoder = new TextEncoder();
  const presented = encoder.encode(request.headers.get('authorization') ?? '');
  const expected = encoder.encode(`Bearer ${token}`);
  return (
    presented.byteLength === expected.byteLength &&
    crypto.subtle.timingSafeEqual(presented, expected)
  );
}

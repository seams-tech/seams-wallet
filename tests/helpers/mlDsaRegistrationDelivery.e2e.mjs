// Local-only proxy: lose one committed batch reply and retain public retry evidence.
export const registrationDeliveryScript = `
function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byteHex).join('');
}
function byteHex(byte) { return byte.toString(16).padStart(2, '0'); }
export class RegistrationDeliveryBarrier {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.active = 0;
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/state') {
      return Response.json({
        active: this.active,
        maximumActive: await this.state.storage.get('maximum-active') ?? 0,
        lostReplies: await this.state.storage.get('lost-replies') ?? 0,
        heldReply: await this.state.storage.get('held-reply') ?? false,
        lateReplyReleased: await this.state.storage.get('late-reply-released') ?? false,
        deliveries: Object.fromEntries(await this.state.storage.list({ prefix: 'delivery/' })),
      });
    }
    if (path === '/retry-installs') {
      const claim = await this.state.storage.get('claim');
      if (!claim) return new Response('Missing fixture claim', { status: 409 });
      const first = install(this.env, claim);
      const second = install(this.env, claim);
      return Response.json(await Promise.all([first, second]));
    }
    const command = await request.clone().json();
    const target = this.env.REAL_POOL.get(this.env.REAL_POOL.idFromName(this.state.id.toString()));
    if (command.command !== 'install_registration_batch') return target.fetch(request);
    this.active += 1;
    try {
      const maximum = await this.state.storage.get('maximum-active') ?? 0;
      await this.state.storage.put('maximum-active', Math.max(maximum, this.active));
      const name = 'delivery/' + command.claim.request.epoch + '/' + command.ordinal;
      const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(await request.clone().text())));
      const previous = await this.state.storage.get(name);
      if (previous && previous.hash !== hash) throw new Error('Retry changed the persisted delivery');
      await this.state.storage.put(name, { hash, attempts: (previous?.attempts ?? 0) + 1 });
      const response = await target.fetch(request);
      if (response.status === 200 && command.claim.request.epoch === 1) {
        if (this.env.STALL_DELIVERY && command.ordinal === 0) {
          await this.state.storage.put('claim', command.claim);
          await this.state.storage.put('held-reply', true);
          await scheduler.wait(45000);
          await this.state.storage.put('late-reply-released', true);
          return response;
        }
        await scheduler.wait(150);
        if (!this.env.STALL_DELIVERY && command.ordinal === 0 && !(await this.state.storage.get('lost-replies'))) {
          await this.state.storage.put('claim', command.claim);
          await this.state.storage.put('lost-replies', 1);
          return new Response('Injected lost successful batch reply', { status: 503 });
        }
      }
      return response;
    } finally {
      this.active -= 1;
    }
  }
}
async function install(env, claim) {
  const response = await env.REGISTRATION_A.fetch('https://ml-dsa.internal/router-ab/ml-dsa/registration/role', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-router-ab-internal-service-auth': env.INTERNAL_AUTH },
    body: JSON.stringify({ command: 'install', claim }),
  });
  await response.text();
  return response.status;
}
export default { fetch() { return new Response('Local registration delivery fixture'); } };
`;

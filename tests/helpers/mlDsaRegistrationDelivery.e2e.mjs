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
        alteredCiphertextRejected: await this.state.storage.get('altered-ciphertext-rejected') ?? false,
        atomicPairRollback: await this.state.storage.get('atomic-pair-rollback') ?? false,
        oversizedDeliveryRejected: await this.state.storage.get('oversized-delivery-rejected') ?? false,
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
    if (command.command !== 'install_registration_stock') return target.fetch(request);
    const batches = command.delivery.batches;
    this.active += batches.length;
    try {
      const maximum = await this.state.storage.get('maximum-active') ?? 0;
      await this.state.storage.put('maximum-active', Math.max(maximum, this.active));
      if (command.claim.request.epoch === 1 && batches[0].ordinal === 0 && !(await this.state.storage.get('atomic-pair-rollback'))) {
        const oversized = structuredClone(command);
        oversized.delivery.batches.push(structuredClone(batches[1]));
        await requireRefusal(target, request, oversized, 'JSON is invalid');
        await this.state.storage.put('oversized-delivery-rejected', true);
        const changed = structuredClone(command);
        changed.delivery.batches[1].binding.role = 'b';
        await requireRefusal(target, request, changed, 'Registration stock belongs to another role');
        const inspected = await target.fetch(new Request(request.url, {
          method: 'POST', headers: request.headers,
          body: JSON.stringify({ command: 'inspect', key: batches[0].binding.key, batches: batches.map(batchIdentity) }),
        }));
        if (inspected.status !== 200 || JSON.stringify(await inspected.json()) !== '["missing","missing"]')
          throw new Error('Failed pair delivery published partial stock');
        await this.state.storage.put('atomic-pair-rollback', true);
      }
      const hash = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(await request.clone().text())));
      for (const batch of batches) {
        const name = 'delivery/' + command.claim.request.epoch + '/' + batch.ordinal;
        const previous = await this.state.storage.get(name);
        if (previous && previous.hash !== hash) throw new Error('Retry changed the persisted delivery');
        await this.state.storage.put(name, { hash, attempts: (previous?.attempts ?? 0) + 1 });
      }
      const response = await target.fetch(request);
      if (response.status === 200 && command.claim.request.epoch === 1) {
        if (batches[0].ordinal === 0 && !(await this.state.storage.get('altered-ciphertext-rejected'))) {
          const changed = structuredClone(command);
          changed.delivery.batches[0].sealed.encapsulated_key[0] ^= 1;
          await requireRefusal(target, request, changed, 'Registration signing ciphertext changed');
          await this.state.storage.put('altered-ciphertext-rejected', true);
        }
        if (this.env.STALL_DELIVERY && batches[0].ordinal === 0) {
          await this.state.storage.put('claim', command.claim);
          await this.state.storage.put('held-reply', true);
          await scheduler.wait(45000);
          await this.state.storage.put('late-reply-released', true);
          return response;
        }
        await scheduler.wait(150);
        if (!this.env.STALL_DELIVERY && batches[0].ordinal === 0 && !(await this.state.storage.get('lost-replies'))) {
          await this.state.storage.put('claim', command.claim);
          await this.state.storage.put('lost-replies', 1);
          return new Response('Injected lost successful batch reply', { status: 503 });
        }
      }
      return response;
    } finally {
      this.active -= batches.length;
    }
  }
}
function batchIdentity(batch) { return batch.binding.batch; }
async function requireRefusal(target, request, command, expected) {
  let response;
  try {
    response = await target.fetch(new Request(request.url, {
      method: 'POST', headers: request.headers, body: JSON.stringify(command),
    }));
  } catch (error) {
    if (!String(error).includes(expected)) throw error;
    return;
  }
  const body = await response.text();
  if (response.status < 400 || !body.includes(expected)) throw new Error('Unexpected delivery refusal');
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

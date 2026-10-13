export class TenantRoot {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    let count = (await this.state.storage.get('count')) ?? 0;
    if (new URL(request.url).pathname.endsWith('/increment')) {
      count += 1;
      await this.state.storage.put('count', count);
    }
    return Response.json({ owner: 'router', count });
  }
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === '/health') {
      return new Response('ready');
    }
    const id = env.TENANT_ROOT.idFromName('tenant');
    return env.TENANT_ROOT.get(id).fetch(request);
  },
};

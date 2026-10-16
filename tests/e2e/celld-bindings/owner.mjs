function writeStreamChunks(controller) {
  const encoder = new TextEncoder();
  for (const chunk of ['alpha\n', 'βeta\n', 'omega']) {
    controller.enqueue(encoder.encode(chunk));
  }
  controller.close();
}

export class TenantRoot {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    let count = (await this.state.storage.get('count')) ?? 0;
    if (new URL(request.url).pathname.endsWith('/increment')) {
      count += 1;
      await this.state.storage.put('count', count);
    }
    return Response.json({ owner: this.env.OWNER_LABEL, count, id: this.state.id.toString() });
  }
}

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname === '/stream') {
      return new Response(new ReadableStream({ start: writeStreamChunks }), {
        status: 206,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'x-stream-owner': 'router' },
      });
    }
    if (new URL(request.url).pathname === '/health') {
      return new Response('ready');
    }
    if (new URL(request.url).pathname.startsWith('/caller/')) {
      return env.CONTROL_PLANE.fetch(request);
    }
    const id = env.TENANT_ROOT.idFromName('tenant');
    return env.TENANT_ROOT.get(id).fetch(request);
  },
};

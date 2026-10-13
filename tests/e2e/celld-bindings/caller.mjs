export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health') {
      return new Response('ready');
    }
    if (path.startsWith('/service/')) {
      return env.ROUTER.fetch(request);
    }
    const namespace = path.startsWith('/alias/') ? env.ALIAS : env.TENANT_ROOT;
    const id = namespace.idFromName('tenant');
    const restored = namespace.idFromString(id.toString());
    return namespace.get(restored).fetch(request);
  },
};

export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health') {
      return new Response('ready');
    }
    if (path.startsWith('/service/')) {
      return env.ROUTER.fetch(request);
    }
    const id = env.TENANT_ROOT.idFromName('tenant');
    return env.TENANT_ROOT.get(id).fetch(request);
  },
};

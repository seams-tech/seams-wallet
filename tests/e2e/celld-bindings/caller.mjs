function cloneRejects(response) {
  try {
    response.clone();
    return false;
  } catch (error) {
    return error instanceof TypeError;
  }
}

async function streamClone(env) {
  const response = await env.ROUTER.fetch('https://probe/stream');
  const copy = response.clone();
  const copyText = await copy.text();
  const originalText = await response.text();

  const locked = await env.ROUTER.fetch('https://probe/stream');
  const lockedReader = locked.body.getReader();
  const rejectsLocked = cloneRejects(locked);
  lockedReader.releaseLock();
  await locked.body.cancel();

  const disturbed = await env.ROUTER.fetch('https://probe/stream');
  const reader = disturbed.body.getReader();
  await reader.read();
  reader.releaseLock();
  const rejectsDisturbed = cloneRejects(disturbed);
  await disturbed.body.cancel();

  return Response.json({
    originalText,
    copyText,
    originalStatus: response.status,
    copyStatus: copy.status,
    originalHeader: response.headers.get('x-stream-owner'),
    copyHeader: copy.headers.get('x-stream-owner'),
    rejectsConsumed: cloneRejects(response),
    rejectsLocked,
    rejectsDisturbed,
  });
}

export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/stream-clone') {
      return streamClone(env);
    }
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

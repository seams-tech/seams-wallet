async function fetchRole(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/health') return new Response('ready');
  if (path === '/bindings') {
    return Response.json({ role: env.ROLE, names: Object.keys(env).sort() });
  }
  if (path === '/write') {
    await env.BACKUP.put('same-key', env.ROLE);
    return Response.json({ written: env.ROLE });
  }
  if (path === '/read') {
    const object = await env.BACKUP.get('same-key');
    return Response.json({ value: object === null ? null : await object.text() });
  }
  if (path === '/list') {
    const page = await env.BACKUP.list();
    const keys = [];
    for (const object of page.objects) keys.push(object.key);
    return Response.json({ keys });
  }
  if (path === '/cas') {
    const current = await env.BACKUP.head('same-key');
    const accepted = await env.BACKUP.put('same-key', `${env.ROLE}-updated`, {
      onlyIf: { etagMatches: current.etag },
    });
    const refused = await env.BACKUP.put('same-key', 'must-not-commit', {
      onlyIf: { etagMatches: current.etag },
    });
    return Response.json({ accepted: accepted !== null, refused: refused === null });
  }
  if (path === '/stream') {
    const bytes = new Uint8Array(9 * 1024 * 1024).fill(env.ROLE === 'a' ? 65 : 66);
    await env.BACKUP.put('stream', new Blob([bytes]).stream());
    const stored = await env.BACKUP.get('stream');
    const body = new Uint8Array(await stored.arrayBuffer());
    for (const byte of body) {
      if (byte !== bytes[0]) throw new Error('stream content differs');
    }
    return Response.json({ size: body.length });
  }
  if (path === '/multipart') {
    const upload = await env.BACKUP.createMultipartUpload('multipart');
    const part = await upload.uploadPart(1, env.ROLE);
    await upload.complete([part]);
    const object = await env.BACKUP.get('multipart');
    return Response.json({ value: await object.text() });
  }
  if (path === '/delete') {
    await env.BACKUP.delete(['stream', 'multipart']);
    return Response.json({ deleted: true });
  }
  return new Response('unknown route', { status: 404 });
}

export default { fetch: fetchRole };

function fetchRouter(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/health') return new Response('ready');
  const role = url.pathname.split('/')[1];
  url.pathname = url.pathname.slice(2);
  if (role === 'a') return env.A.fetch(new Request(url, request));
  if (role === 'b') return env.B.fetch(new Request(url, request));
  return new Response('unknown role', { status: 404 });
}

export default { fetch: fetchRouter };

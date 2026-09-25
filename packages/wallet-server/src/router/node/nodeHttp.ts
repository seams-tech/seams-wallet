// Serves a fetch-style handler on an ordinary Node HTTP listener.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export function listenNodeFetchHandler(input: {
  readonly host: string;
  readonly port: number;
  readonly handle: (request: Request) => Promise<Response>;
}): Promise<Server> {
  const server = createServer((incoming, outgoing) => {
    void forward(incoming, outgoing, input.handle);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(input.port, input.host, () => resolve(server));
  });
}

async function forward(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  handle: (request: Request) => Promise<Response>,
): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (typeof value === 'string') headers.set(name, value);
      else if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    }
    const method = incoming.method ?? 'GET';
    const request = new Request(`http://${incoming.headers.host ?? 'localhost'}${incoming.url ?? '/'}`, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.statusCode = 500;
    outgoing.end('internal error');
  }
}

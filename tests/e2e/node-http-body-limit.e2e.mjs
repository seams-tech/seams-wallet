// Run with Node >= 22.18: node tests/e2e/node-http-body-limit.e2e.mjs
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listenNodeFetchHandler } from '../../packages/wallet-server/src/router/node/nodeHttp.ts';

const bodyLimit = 1024 * 1024;
let handlerCalls = 0;

async function handle(request) {
  handlerCalls += 1;
  if (request.headers.get('authorization') !== 'Bearer test-credential') {
    return new Response('unauthorized', { status: 401 });
  }
  return new Response(String((await request.arrayBuffer()).byteLength));
}

function failOnTimeout() {
  this.destroy(new Error('server did not respond and close the connection within 5 seconds'));
}

async function exchange(port, headers, chunks) {
  const socket = connect({ host: '127.0.0.1', port });
  socket.setTimeout(5_000, failOnTimeout);
  try {
    await once(socket, 'connect');
    socket.write(['POST /wallet-operation HTTP/1.1', 'Host: localhost', ...headers, '', ''].join('\r\n'));
    for (const chunk of chunks) socket.write(chunk);
    // Leave the upload side open: rejection must not wait for the body to finish.
    const response = [];
    for await (const chunk of socket) response.push(chunk);
    const text = Buffer.concat(response).toString();
    const [head, body] = text.split('\r\n\r\n');
    return { status: Number(head.split(' ')[1]), head, body };
  } finally {
    socket.destroy();
  }
}

const server = await listenNodeFetchHandler({ host: '127.0.0.1', port: 0, handle });
const { port } = server.address();
const results = {};
try {
  results.declaredOversize = await exchange(port, [`Content-Length: ${bodyLimit + 1}`], []);
  assert.equal(results.declaredOversize.status, 413);
  assert.match(results.declaredOversize.head, /connection: close/i);
  assert.equal(handlerCalls, 0);

  // Cross the cap over multiple chunks, without a terminating chunk or credentials.
  const halfBody = Buffer.alloc(bodyLimit / 2, 'x');
  results.chunkedOversize = await exchange(port, ['Transfer-Encoding: chunked'], [
    `${halfBody.length.toString(16)}\r\n`, halfBody, '\r\n',
    `${halfBody.length.toString(16)}\r\n`, halfBody, '\r\n',
    '1\r\nx\r\n',
  ]);
  assert.equal(results.chunkedOversize.status, 413);
  assert.match(results.chunkedOversize.head, /connection: close/i);
  assert.equal(handlerCalls, 0);

  results.exactLimit = await exchange(port, [
    `Content-Length: ${bodyLimit}`,
    'Authorization: Bearer test-credential',
    'Connection: close',
  ], [Buffer.alloc(bodyLimit, 'x')]);
  assert.equal(results.exactLimit.status, 200);
  assert.equal(results.exactLimit.body, String(bodyLimit));
  assert.equal(handlerCalls, 1);

  results.unauthorized = await exchange(port, ['Content-Length: 2', 'Connection: close'], ['{}']);
  assert.equal(results.unauthorized.status, 401);
  assert.equal(handlerCalls, 2);

  const artifactDirectory = await mkdtemp(join(tmpdir(), 'node-http-body-limit-'));
  const artifact = join(artifactDirectory, 'result.json');
  await writeFile(artifact, `${JSON.stringify({ bodyLimit, handlerCalls, results }, null, 2)}\n`);
  console.log(`Node HTTP body-limit E2E passed. Evidence: ${artifact}`);
} finally {
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}

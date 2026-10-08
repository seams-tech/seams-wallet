import { Response, WebSocketPair } from 'miniflare';

export const ceremonyPath = '/router-ab/deriver-a/ed25519-yao/ceremony';
const preparationHeader = 'x-seams-yao-preparation';
const readinessHeader = 'x-seams-yao-readiness';

export function ceremonyPreparation(request) {
  return JSON.parse(request.headers.get(preparationHeader));
}

export async function openCeremony(worker, preparation, headers) {
  const upgradeHeaders = new Headers(headers);
  upgradeHeaders.delete('host');
  upgradeHeaders.set('Upgrade', 'websocket');
  upgradeHeaders.set(preparationHeader, JSON.stringify(preparation));
  return worker.fetch(`https://custody.test${ceremonyPath}`, { headers: Object.fromEntries(upgradeHeaders) });
}

export async function executeCeremony(worker, execution, headers) {
  const { local_receipt, peer_receipt, ...preparation } = execution;
  const response = await openCeremony(worker, preparation, headers);
  if (response.status !== 101) return response;
  const socket = response.webSocket;
  socket.accept();
  try {
    const next = nextMessage(socket);
    socket.send(JSON.stringify({ local_receipt, peer_receipt }));
    const result = JSON.parse(await next);
    return result.status === 'completed'
      ? Response.json(result.execution)
      : Response.json(result.failure, { status: 409 });
  } finally {
    socket.close(1000, 'E2E execution finished');
  }
}

function nextMessage(socket) {
  const result = Promise.withResolvers();
  const timeout = setTimeout(result.reject, 35_000, new Error('Ceremony message timed out'));
  const observer = new MessageObserver(socket, result, timeout);
  socket.addEventListener('message', observer.message.bind(observer), { once: true });
  socket.addEventListener('close', observer.close.bind(observer), { once: true });
  return result.promise;
}

class MessageObserver {
  constructor(socket, result, timeout) {
    this.socket = socket;
    this.result = result;
    this.timeout = timeout;
  }
  message(event) {
    clearTimeout(this.timeout);
    this.result.resolve(event.data);
  }
  close() {
    clearTimeout(this.timeout);
    this.result.reject(new Error('Ceremony connection closed'));
  }
}

// Exercise the actual connection while faults act on its domain boundaries.
export async function interceptCeremony(request, worker, observer) {
  const preparation = ceremonyPreparation(request);
  await observer.beforePreparation?.(preparation);
  // The Node WebSocket proxy must use its own loopback Host header.
  const headers = new Headers(request.headers);
  headers.delete('host');
  const response = await worker.fetch(request.url, { headers: Object.fromEntries(headers) });
  if (response.status !== 101) {
    await observer.rejected?.(response.clone());
    // Node has detached its HTTP parser for this upgrade. A failed handshake
    // must close that socket instead of inviting another request on it.
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'content-type': 'application/json', connection: 'close' },
    });
  }
  const receipt = JSON.parse(response.headers.get(readinessHeader));
  await observer.prepared?.(preparation, receipt);
  const pair = new WebSocketPair();
  const exchange = new ObservedCeremony(pair[1], response.webSocket, preparation, observer);
  exchange.connect();
  // Each proxy leg negotiates its own WebSocket extensions and handshake key.
  return new Response(null, {
    status: 101,
    headers: { [readinessHeader]: response.headers.get(readinessHeader) },
    webSocket: pair[0],
  });
}

class ObservedCeremony {
  constructor(router, a, preparation, observer) {
    this.router = router;
    this.a = a;
    this.preparation = preparation;
    this.observer = observer;
  }
  connect() {
    this.router.accept();
    this.a.accept();
    this.router.addEventListener('message', this.fromRouter.bind(this));
    this.a.addEventListener('message', this.fromA.bind(this));
    this.router.addEventListener('close', this.close.bind(this));
    this.a.addEventListener('close', this.close.bind(this));
  }
  async fromRouter(event) {
    try {
      const start = JSON.parse(event.data);
      this.execution = { ...this.preparation, local_receipt: start.local_receipt, peer_receipt: start.peer_receipt };
      await this.observer.beforeStart?.(this.execution);
      this.a.send(event.data);
    } catch (error) {
      this.observer.error = error;
      this.close();
    }
  }
  async fromA(event) {
    this.delivering = true;
    try {
      const outcome = JSON.parse(event.data);
      await this.observer.finished?.(this.execution, outcome);
      this.router.send(event.data);
    } catch (error) {
      this.observer.error = error;
    } finally {
      this.delivering = false;
      this.close();
    }
  }
  close() {
    if (this.delivering || this.closed) return;
    this.closed = true;
    this.router.close(1000, 'E2E exchange finished');
    this.a.close(1000, 'E2E exchange finished');
  }
}

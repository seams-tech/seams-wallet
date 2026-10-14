const admissionTable = 'tenant_root_root_use_admissions';

export const proxySource = `
const evidence = {
  connectionAttempts: 0, connections: 0, refusals: [], aMessages: 0, bMessages: 0,
  disconnected: false, aClosed: false, bClosed: false
};
let heldExchange = null;
class Exchange {
  constructor(a, b, behaviour) {
    this.a = a;
    this.b = b;
    this.closed = false;
    this.behaviour = behaviour;
    this.heldFrame = null;
  }
  fromA(event) {
    if (this.closed) return;
    evidence.aMessages += 1;
    this.b.send(event.data);
  }
  fromB(event) {
    if (this.closed) return;
    evidence.bMessages += 1;
    if (this.behaviour === 'hold-second-reply' && evidence.bMessages === 2) {
      this.heldFrame = event.data;
      heldExchange = this;
      evidence.heldSecondReply = true;
      return;
    }
    if (this.behaviour === 'disconnect' && evidence.bMessages === 2) {
      evidence.disconnected = true;
      this.close();
      return;
    }
    this.a.send(event.data);
  }
  release() {
    if (this.closed || this.heldFrame === null) throw new Error('No held reply');
    this.a.send(this.heldFrame);
    this.heldFrame = null;
    heldExchange = null;
    evidence.releasedSecondReply = true;
  }
  closedByA(event) {
    evidence.aClose = { code: event.code, reason: event.reason };
    evidence.aClosed = true;
    this.close();
  }
  closedByB(event) {
    evidence.bClose = { code: event.code, reason: event.reason };
    evidence.bClosed = true;
    this.close();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.heldFrame = null;
    if (heldExchange === this) heldExchange = null;
    this.a.close(1011, 'E2E peer disconnect');
    this.b.close(1011, 'E2E peer disconnect');
  }
}
async function cancelPreparedAdmission(env) {
  const rows = await env.ADMISSION_DB.prepare(
    "SELECT attempt_key_hex, pair_object_id FROM ${admissionTable} WHERE attempt_kind = 'ed25519_yao_pair_session' AND status = 'admitted'",
  ).all();
  if (rows.results.length !== 1) throw new Error('Expected one admitted A execution');
  const admission = rows.results[0];
  const sql = env.CONNECTION === 'delete-admission'
    ? "DELETE FROM ${admissionTable} WHERE attempt_key_hex = ?1"
    : "UPDATE ${admissionTable} SET status = 'cancelled' WHERE attempt_key_hex = ?1";
  const changed = await env.ADMISSION_DB.prepare(sql).bind(admission.attempt_key_hex).run();
  if (changed.meta.changes !== 1) throw new Error('Expected exactly one changed admission');
  const object = env.A_WALLET.get(env.A_WALLET.idFromString(admission.pair_object_id));
  const response = await object.fetch('https://custody.test/router-ab/internal/deriver-a/wallet-pair/reconcile', {
    method: 'POST',
    body: JSON.stringify({
      session_hex: admission.attempt_key_hex,
      fence: true,
      peer_settled: false,
      now_ms: Date.now(),
    }),
  });
  const state = await response.json();
  if (response.status !== 200 || state !== 'fenced') throw new Error('A admission was not fenced before B accepted');
  evidence.admissionCancelledAfterPreparation = true;
}
// The connection as Deriver A sent it, for another wallet object: the next
// ownership generation, or another tenant root.
function rescoped(request, behaviour) {
  const headers = new Headers(request.headers);
  const start = JSON.parse(headers.get('x-seams-yao-wallet-pair-scope'));
  if (behaviour === 'changed-generation') start.scope.ownership_generation += 1;
  else start.scope.root_identity.projectId = start.scope.root_identity.projectId + '-other';
  headers.set('x-seams-yao-wallet-pair-scope', JSON.stringify(start));
  return new Request(request, { headers });
}
async function refusal(response) {
  const body = await response.text();
  let reason = null;
  try {
    reason = JSON.parse(body).reason ?? null;
  } catch {
    // An untyped failure names no reason.
  }
  evidence.refusals.push({ status: response.status, reason });
  return new Response(body, { status: response.status, headers: response.headers });
}
const handler = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/evidence') return Response.json(evidence);
    if (path === '/release' && request.method === 'POST') {
      if (heldExchange === null) return new Response('No held reply', { status: 409 });
      heldExchange.release();
      return new Response('released');
    }
    if (!path.endsWith('/ed25519-yao/duplex')) return env.REAL_B.fetch(request);
    evidence.connectionAttempts += 1;
    if (evidence.connectionAttempts > 1) return env.REAL_B.fetch(request);
    const behaviour = env.CONNECTION;
    await env.ORDER.fetch('https://order.test/connection-arrived');
    if (behaviour === 'after-preparation' || behaviour === 'refused-after-preparation') {
      await env.ORDER.fetch('https://order.test/preparation-answered');
    }
    if (behaviour === 'cancel-admission' || behaviour === 'delete-admission') {
      await cancelPreparedAdmission(env);
    }
    if (behaviour === 'refused' || behaviour === 'refused-after-preparation') {
      return refusal(new Response('E2E refused upgrade', { status: 503 }));
    }
    if (behaviour === 'changed-generation' || behaviour === 'wrong-root') {
      return refusal(await env.REAL_B.fetch(rescoped(request, behaviour)));
    }
    const again = behaviour === 'duplicate' ? new Request(request) : null;
    const response = await env.REAL_B.fetch(request);
    const b = response.webSocket;
    if (!b) return refusal(response);
    evidence.connections += 1;
    b.binaryType = 'arraybuffer';
    b.accept();
    if (behaviour === 'lose-reply') {
      // Deriver A never holds a socket: B's is the only one to close.
      b.close(1011, 'E2E lost upgrade reply');
      evidence.aClosed = true;
      evidence.bClosed = true;
      return refusal(new Response('E2E lost upgrade reply', { status: 503 }));
    }
    if (again) {
      const second = await env.REAL_B.fetch(again);
      if (second.webSocket) {
        second.webSocket.accept();
        second.webSocket.close(1011, 'E2E duplicate socket');
        evidence.duplicateSocket = { status: second.status, upgraded: true };
      } else {
        const body = await second.text();
        let typedRefusal = false;
        try {
          typedRefusal = typeof JSON.parse(body).reason === 'string';
        } catch {
          // An untyped failure is not a refusal that releases Deriver A.
        }
        evidence.duplicateSocket = { status: second.status, upgraded: false, typedRefusal };
      }
    }
    const pair = new WebSocketPair();
    const a = pair[1];
    a.binaryType = 'arraybuffer';
    a.accept();
    const exchange = new Exchange(a, b, behaviour);
    a.addEventListener('message', exchange.fromA.bind(exchange));
    b.addEventListener('message', exchange.fromB.bind(exchange));
    a.addEventListener('close', exchange.closedByA.bind(exchange));
    b.addEventListener('close', exchange.closedByB.bind(exchange));
    return new Response(null, { status: 101, headers: response.headers, webSocket: pair[0] });
  }
};
export class YaoConnectionProxy {
  constructor(_state, env) { this.env = env; }
  fetch(request) { return handler.fetch(request, this.env); }
}
export default {
  fetch(request, env) {
    return env.PROXY_OBJECT.get(env.PROXY_OBJECT.idFromName('connection')).fetch(request);
  }
};`;

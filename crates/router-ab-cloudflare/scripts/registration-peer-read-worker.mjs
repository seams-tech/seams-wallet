// E2E adapters hold only the admitted-root read, after the pair is claimed.
export function heldRootReadWorker(entrypoint) {
  return `
import { RouterAbDeriverBWalletDurableObject as Wallet } from ${JSON.stringify(entrypoint)};
export * from ${JSON.stringify(entrypoint)};
export { default } from ${JSON.stringify(entrypoint)};

const queries = new WeakMap();
function trackStatement(statement, query) {
  queries.set(statement, query);
  statement.bind = bindStatement.bind(null, statement.bind.bind(statement), query);
  return statement;
}
function bindStatement(bind, query, ...values) {
  return trackStatement(bind(...values), query);
}
function queryOf(statement) { return queries.get(statement); }

class HeldSession {
  constructor(session, observer) {
    this.session = session;
    this.observer = observer;
  }
  prepare(query) { return trackStatement(this.session.prepare(query), query); }
  getBookmark() { return this.session.getBookmark(); }
  async batch(statements) {
    if (statements.length === 3) {
      const sql = statements.map(queryOf);
      if (!sql[0]?.includes('FROM tenant_root_root_use_admissions') ||
          !sql[1]?.includes('FROM tenant_root_role_shares') ||
          !sql[2]?.includes("lifecycle = 'active'")) {
        throw new Error('E2E expected the admitted-root read batch');
      }
      const response = await this.observer.fetch('https://evidence/root-read');
      if (!response.ok) throw new Error('E2E admitted-root read failed');
    }
    return this.session.batch(statements);
  }
}
// workers-rs checks the binding's constructor name before using its methods.
class D1Database {
  constructor(database, observer) {
    this.database = database;
    this.observer = observer;
  }
  withSession(bookmark) {
    return new HeldSession(this.database.withSession(bookmark), this.observer);
  }
}
export class RouterAbDeriverBWalletDurableObject extends Wallet {
  constructor(state, env) {
    super(state, {
      ...env,
      DERIVER_ROLE_PRIVATE_DB: new D1Database(env.DERIVER_ROLE_PRIVATE_DB, env.READ_OBSERVER),
    });
  }
}
`;
}

export const observedPreparedPeer = `
const frames = { connections: 0, aPrefaces: 0, bStarted: 0, bProofs: 0 };
class Peer {
  constructor(a, b, observer, context) {
    this.a = a;
    this.b = b;
    this.observer = observer;
    this.context = context;
    this.sawAProof = false;
    this.sawBProof = false;
    this.closed = false;
  }
  fromA(event) {
    this.b.send(event.data);
    if (typeof event.data === 'string') {
      this.context.waitUntil(this.observer.fetch('https://evidence/a-start', {
        method: 'POST', body: event.data,
      }));
    } else if (!this.sawAProof) {
      this.sawAProof = true;
      frames.aPrefaces += 1;
      this.context.waitUntil(this.observer.fetch('https://evidence/a-preface'));
    }
  }
  fromB(event) {
    this.a.send(event.data);
    if (typeof event.data === 'string') {
      frames.bStarted += 1;
    } else if (!this.sawBProof) {
      this.sawBProof = true;
      frames.bProofs += 1;
    }
  }
  close(event) {
    if (this.closed) return;
    this.closed = true;
    this.a.close(event.code, event.reason);
    this.b.close(event.code, event.reason);
  }
}
export default {
  async fetch(request, env, context) {
    if (new URL(request.url).pathname === '/evidence') return Response.json(frames);
    await env.COUNTS.fetch('https://count' + new URL(request.url).pathname);
    const response = await env.REAL.fetch(request);
    if (!response.webSocket) return response;
    frames.connections += 1;
    const b = response.webSocket;
    const sockets = new WebSocketPair();
    const a = sockets[1];
    a.binaryType = b.binaryType = 'arraybuffer';
    a.accept();
    b.accept();
    const peer = new Peer(a, b, env.COUNTS, context);
    a.addEventListener('message', peer.fromA.bind(peer));
    b.addEventListener('message', peer.fromB.bind(peer));
    a.addEventListener('close', peer.close.bind(peer));
    b.addEventListener('close', peer.close.bind(peer));
    return new Response(null, { status: 101, webSocket: sockets[0] });
  },
};
`;

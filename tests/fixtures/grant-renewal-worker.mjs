// Holds a real creation transaction after Rust captures its admission time.
// This module is used only by the local workerd acceptance journey.
import runtime, {
  RouterAbTenantRootCreationDurableObject as CreationObject,
} from '../../crates/router-ab-cloudflare/build/dev/router/index.js';
export * from '../../crates/router-ab-cloudflare/build/dev/router/index.js';
export default runtime;

function nativeMember(target, property) {
  const value = Reflect.get(target, property, target);
  return typeof value === 'function' ? value.bind(target) : value;
}

class TransactionGate {
  state = { kind: 'idle' };

  constructor(storage) {
    this.storage = storage;
  }

  get(target, property) {
    return property === 'transaction'
      ? this.transaction.bind(this)
      : nativeMember(target, property);
  }

  async transaction(callback) {
    if (this.state.kind === 'armed') {
      const deferred = Promise.withResolvers();
      this.state = { kind: 'held', heldAtMs: Date.now(), deferred };
      await deferred.promise;
    }
    return this.storage.transaction(callback);
  }

  release() {
    if (this.state.kind !== 'held') throw new Error('No transaction is held');
    this.state.deferred.resolve();
    this.state = { kind: 'released' };
  }

  observation() {
    return this.state.kind === 'held'
      ? { kind: 'held', heldAtMs: this.state.heldAtMs }
      : { kind: this.state.kind };
  }
}

class GatedState {
  constructor(storage) {
    this.storage = storage;
  }

  get(target, property) {
    return property === 'storage' ? this.storage : nativeMember(target, property);
  }
}

export class RouterAbTenantRootCreationDurableObject extends CreationObject {
  constructor(state, env) {
    const gate = new TransactionGate(state.storage);
    const storage = new Proxy(state.storage, gate);
    super(new Proxy(state, new GatedState(storage)), env);
    this.gate = gate;
  }

  async fetch(request) {
    switch (new URL(request.url).pathname) {
      case '/acceptance/arm':
        if (this.gate.state.kind !== 'idle') throw new Error('Transaction gate already used');
        this.gate.state = { kind: 'armed' };
        return Response.json({ kind: 'armed' });
      case '/acceptance/status':
        return Response.json(this.gate.observation());
      case '/acceptance/release':
        this.gate.release();
        return Response.json({ kind: 'released' });
      default:
        return super.fetch(request);
    }
  }
}

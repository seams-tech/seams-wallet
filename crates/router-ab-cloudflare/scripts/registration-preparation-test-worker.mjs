// Imported only by the local native-Worker E2E wrapper.
class RootReadGate {
  constructor(state, env, role, diagnostics) {
    this.state = state;
    this.env = env;
    this.role = role;
    this.originals = new WeakMap();
    this.labels = new WeakMap();
    this.held = false;
    this.diagnostics = diagnostics;
  }

  wrap(target, sql = null) {
    if (sql !== null) this.labels.set(target, sql);
    const proxy = new Proxy(target, { get: this.get.bind(this) });
    this.originals.set(proxy, target);
    return proxy;
  }

  get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property === 'constructor' || typeof value !== 'function') return value;
    if (property === 'withSession') return this.session.bind(this, target, value);
    if (property === 'prepare') return this.prepare.bind(this, target, value);
    if (property === 'bind') return this.bind.bind(this, target, value);
    if (property === 'batch') return this.batch.bind(this, target, value);
    return value.bind(target);
  }

  session(target, method, ...args) {
    return this.wrap(Reflect.apply(method, target, args));
  }

  prepare(target, method, sql) {
    return this.wrap(Reflect.apply(method, target, [sql]), sql);
  }

  bind(target, method, ...args) {
    return this.wrap(Reflect.apply(method, target, args), this.labels.get(target));
  }

  unwrap(statement) {
    return this.originals.get(statement) ?? statement;
  }

  async hold() {
    const response = await this.env.REGISTRATION_TEST_CONTROL.fetch('https://control/root-read', {
      method: 'POST',
      body: JSON.stringify({ role: this.role, objectId: this.state.id.toString() }),
    });
    await response.text();
  }

  async batch(target, method, statements) {
    const originals = statements.map(this.unwrap.bind(this));
    const first = this.labels.get(originals[0]) ?? '';
    if (originals.length === 3 && first.startsWith('SELECT tenant_root_share_epoch,')) {
      this.diagnostics.rootReads += 1;
    }
    const hold = !this.held && this.role === 'deriver_b'
      && this.env.REGISTRATION_READ_GATE !== 'none'
      && originals.length === 3 && first.startsWith('SELECT tenant_root_share_epoch,');
    if (hold) this.held = true;
    if (hold && this.env.REGISTRATION_READ_GATE === 'before') await this.hold();
    const result = await Reflect.apply(method, target, [originals]);
    if (hold && this.env.REGISTRATION_READ_GATE === 'after') await this.hold();
    return result;
  }
}

export function gatedEnvironment(state, env, role, diagnostics) {
  const gate = new RootReadGate(state, env, role, diagnostics);
  return { ...env, DERIVER_ROLE_PRIVATE_DB: gate.wrap(env.DERIVER_ROLE_PRIVATE_DB) };
}

export function inspectPreparation(state, session) {
  const binding = state.storage.sql.exec(
    'SELECT use_json FROM yao_registration_input_binding WHERE session_hex = ?', session,
  ).toArray();
  const preparation = state.storage.sql.exec(
    'SELECT preparation_json FROM yao_registration_preparation WHERE id = 1',
  ).toArray();
  const pairs = state.storage.sql.exec(
    'SELECT lifecycle FROM yao_pair_sessions WHERE session_hex = ?', session,
  ).toArray();
  return { binding, preparation, pairs };
}

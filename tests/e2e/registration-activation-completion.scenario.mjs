import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  seedCommittedRegistration,
  seedRegistrationHome,
} from './execution-generation.scenario.mjs';

class ApprovedDirectory {
  publications = 0;

  async reserve() {
    throw new Error('This scenario starts with an approved registration');
  }

  async complete() {
    this.publications += 1;
    return { ok: true };
  }
}

// A registration operation that publishes its home and leaves the activation
// for the record that completes it, as activation and NEAR provisioning do.
class RegistrationOperation {
  now = 100;
  activation = null;
  afterPublication = null;
  afterInitialRead = null;

  constructor(api, database, scope, label) {
    this.api = api;
    this.database = database;
    this.scope = scope;
    this.directory = new ApprovedDirectory();
    this.authority = new api.D1WalletExecutionAuthority(database, scope, this.directory);
    this.store = new api.D1WalletOperationStore(
      {
        database,
        scope,
        keyPrefix: `activation-completion-${label}:`,
        encode: identity,
        parse: this.parse.bind(this),
      },
      operationWallet,
    );
  }

  async reserve(label) {
    this.admission = (await this.api.buildNearRegistrationAuthorityFixture(label)).admission;
    this.identity = {
      walletId: this.admission.application_binding.wallet_id,
      ceremonyId: `activation-completion-${label}`,
    };
    await seedRegistrationHome({ database: this.database, scope: this.scope, ...this.identity });
    assert.equal((await this.authority.admitHome(this.identity)).ok, true);
  }

  parse(value) {
    return this.api.parseRouterAbEd25519YaoRegistrationSideEffectRecordV2(value, {
      operation: 'registration_activate',
      parsePrepared: this.parsePrepared.bind(this),
      parseReceipt,
    });
  }

  parsePrepared(value) {
    const parsed = this.api.parseRouterAbEd25519YaoRegistrationAdmissionRequestV1(value);
    return parsed.ok ? parsed.value : null;
  }

  async execute() {
    const published = await this.authority.publishEstablished({
      registration: await seedCommittedRegistration({
        database: this.database,
        scope: this.scope,
        ...this.identity,
      }),
      session: {
        kind: 'credential',
        walletId: this.identity.walletId,
        digest: createHash('sha256').update(this.identity.walletId).digest('base64url'),
        expiresAtMs: Date.now() + 60_000,
      },
    });
    assert.equal(published.ok, true, published.message);
    this.activation = published.activation;
    await this.afterPublication?.();
    return 'completed';
  }

  async run() {
    this.now += 2;
    const initialRecord = await this.store.read('operation');
    await this.afterInitialRead?.();
    return this.api.runRouterAbEd25519YaoRegistrationSideEffectV2(this.store, {
      kind: 'prepared_resumable',
      operation: 'registration_activate',
      key: 'operation',
      initialRecord,
      requestFingerprint: 'a'.repeat(64),
      resumeAfterMs: 1,
      nowMs: () => this.now,
      prepare: async () => this.admission,
      derivePreparedArtifactFingerprint: preparedFingerprint,
      execute: this.execute.bind(this),
      projectReceipt: identity,
      completionWrite: () => this.activation,
      replay: async (receipt) => receipt,
    });
  }

  async active() {
    return (await this.authority.admitEstablishedHome({ walletId: this.identity.walletId })).ok;
  }

  async recordKind() {
    return (await this.store.read('operation')).value.kind;
  }
}

function identity(value) {
  return value;
}

function operationWallet(record) {
  return record.prepared.application_binding.wallet_id;
}

function parseReceipt(value) {
  return value === 'completed' ? value : null;
}

async function preparedFingerprint(prepared) {
  return createHash('sha256').update(JSON.stringify(prepared)).digest('hex');
}

async function completeCompetingRegistration(operation) {
  operation.afterInitialRead = null;
  assert.equal((await operation.run()).kind, 'executed');
}

function writtenTables(call) {
  const tables = new Set();
  for (const statement of call.statements) {
    if (statement.query.kind !== 'UPDATE') continue;
    for (const table of statement.query.tables) tables.add(table);
  }
  return [...tables].sort();
}

function hasTables(tables) {
  return tables.length > 0;
}

const CLAIM = 'router_ab_ed25519_yao_registration_side_effect_claim_v1';
const COMPLETION = 'router_ab_ed25519_yao_registration_side_effect_completion_v2';

// The home of a registration becomes active in the batch that completes its operation.
export async function verifyRegistrationActivationCompletion({ api, database, scope }) {
  // One batch completes the operation and activates the home. Until then signing stays fenced.
  const traced = new api.TracedD1Database(database);
  const committed = new RegistrationOperation(api, traced, scope, 'committed');
  await committed.reserve('activation-committed');
  let activeAfterPublication = null;
  committed.afterPublication = async () => {
    activeAfterPublication = await committed.active();
  };
  const first = await committed.run();
  assert.equal(first.kind, 'executed', JSON.stringify(first));
  assert.equal(activeAfterPublication, false, 'A published home must stay fenced');
  assert.equal(await committed.active(), true);
  const calls = JSON.parse(traced.response(new Response()).headers.get('x-benchmark-d1')).calls;
  const writes = calls.map(writtenTables).filter(hasTables);
  // The completion decision updates the generation before publication. The
  // last write completes the record and activates it together.
  assert.deepEqual(writes, [
    ['wallet_execution_generations'],
    ['router_ab_yao_versioned_json_records', 'wallet_execution_generations'],
  ]);
  assert.equal(await committed.recordKind(), COMPLETION);

  // A completed operation replays its receipt and publishes nothing.
  committed.afterPublication = null;
  assert.equal((await committed.run()).kind, 'exact_replay');
  assert.equal(committed.directory.publications, 1);

  // Another request can complete after the initial read. The losing CAS must
  // reconcile with a fresh read and replay the winner without executing again.
  const stale = new RegistrationOperation(api, database, scope, 'stale-read');
  await stale.reserve('activation-stale-read');
  stale.afterInitialRead = completeCompetingRegistration.bind(undefined, stale);
  assert.equal((await stale.run()).kind, 'exact_replay');
  assert.equal(stale.directory.publications, 1);
  assert.equal(await stale.active(), true);

  // A completion that loses its record leaves the home fenced. The next run completes both.
  const contended = new RegistrationOperation(api, database, scope, 'contended');
  await contended.reserve('activation-contended');
  contended.afterPublication = async () => {
    const claim = await contended.store.read('operation');
    assert.equal(claim.value.kind, CLAIM);
    assert.equal(
      (await contended.store.put('operation', claim.value, claim.version)).kind,
      'stored',
    );
  };
  assert.equal((await contended.run()).kind, 'uncertain');
  assert.equal(await contended.active(), false);
  assert.equal(await contended.recordKind(), CLAIM);
  contended.afterPublication = null;
  assert.equal((await contended.run()).kind, 'executed');
  assert.equal(await contended.active(), true);
  assert.equal(contended.directory.publications, 2);

  // An activation that fails leaves the operation incomplete, so it runs again.
  const refused = new RegistrationOperation(api, database, scope, 'refused');
  await refused.reserve('activation-refused');
  await database
    .prepare(
      `CREATE TRIGGER injected_activation_refusal
    BEFORE UPDATE ON wallet_execution_generations
    WHEN NEW.state = 'active' AND NEW.origin_id = 'activation-completion-activation-refused'
    BEGIN SELECT RAISE(ABORT, 'injected_activation_refusal'); END`,
    )
    .run();
  const failed = await refused.run();
  assert.equal(failed.kind, 'uncertain');
  assert.equal(failed.phase, 'terminal_commit');
  assert.match(failed.message, /injected_activation_refusal/u);
  assert.equal(await refused.active(), false);
  assert.equal(await refused.recordKind(), CLAIM);
  await database.prepare('DROP TRIGGER injected_activation_refusal').run();
  assert.equal((await refused.run()).kind, 'executed');
  assert.equal(await refused.active(), true);
  assert.equal(await refused.recordKind(), COMPLETION);

  return {
    activationCommitsWithCompletion: true,
    publishedHomeStaysFencedUntilCompletion: true,
    completedOperationPublishesNothing: true,
    staleInitialReadReconcilesWithCommittedWinner: true,
    lostCompletionLeavesHomeFenced: true,
    failedActivationLeavesOperationIncomplete: true,
  };
}

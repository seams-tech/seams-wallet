import { expect, test } from '@playwright/test';
import { openSignerD1 } from '../fixtures/signer-d1.mjs';
import { isD1DatabaseLike } from '../../packages/wallet-server/src/storage/d1Sql';
import { parseWebAuthnRpId } from '@shared/utils/domainIds';
import { LocalRegistrationSetupAuthority } from '../../packages/wallet-server/src/localRegistrationSetupAuthority';
import { CloudflareD1RegistrationCeremonyIntentStore } from '../../packages/wallet-server/src/router/cloudflare/d1/registration/d1RegistrationCeremonyStore';
import { executeD1WalletRegistrationSetup } from '../../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationSetupExecution';
import type { RouterAbEcdsaStrictRegistrationPort } from '../../packages/wallet-server/src/router/domains/ecdsa/routerAbEcdsaStrictRegistration';
import type { WalletRegistrationSetupInput } from '../../packages/wallet-server/src/router/domains/walletRegistration/walletRegistrationInputs';
import { dispatchWalletRegistrationSetup } from '../../packages/wallet-server/src/router/framework/registrationSetupDispatch';
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
} from '../../packages/wallet-server/src/storage/tenantRoute';

const CONNECTION_LOST = 'D1_ERROR: Network connection lost.';
const SCOPE = { namespace: 'namespace', orgId: 'org', projectId: 'project', envId: 'dev' };
/** `lost_request` fails before the batch runs. `lost_reply` fails after it committed. */
type BatchFault = { readonly kind: 'none' | 'lost_request' | 'lost_reply'; readonly error?: Error };

class FaultingDatabase implements D1DatabaseLike {
  batchCalls = 0;

  constructor(
    private readonly inner: D1DatabaseLike,
    private readonly faultForCall: (call: number) => BatchFault,
  ) {}

  prepare(query: string): D1PreparedStatementLike {
    return this.inner.prepare(query);
  }

  async batch<T = unknown>(statements: readonly D1PreparedStatementLike[]): Promise<readonly T[]> {
    this.batchCalls += 1;
    const fault = this.faultForCall(this.batchCalls);
    const error = fault.error ?? new Error(CONNECTION_LOST);
    if (fault.kind === 'lost_request') throw error;
    const results = await this.inner.batch<T>(statements);
    if (fault.kind === 'lost_reply') throw error;
    return results;
  }

  exec(query: string): Promise<unknown> {
    return this.inner.exec(query);
  }
}

function rpId() {
  const parsed = parseWebAuthnRpId('localhost');
  if (!parsed.ok) throw new Error('rpId fixture is invalid');
  return parsed.value;
}

function setupInput(operation: string): WalletRegistrationSetupInput {
  return {
    request: {
      completion: 'wallet_session',
      registrationOperationId: `operation-${operation}`,
      signerSelection: {
        kind: 'signer_set',
        signers: [
          {
            kind: 'near_ed25519',
            accountProvisioning: {
              kind: 'implicit_account',
              accountIdSource: 'ed25519_public_key',
            },
            signerSlot: 1,
            participantIds: [1, 2],
            derivationVersion: 1,
          },
        ],
      },
      authMethod: { kind: 'passkey', rpId: rpId() },
    },
    orgId: SCOPE.orgId,
    expectedOrigin: 'https://app.example',
    signer: { signJwt: async (subject) => `signed:${subject}` },
    runtimePolicyScope: {
      orgId: SCOPE.orgId,
      projectId: SCOPE.projectId,
      envId: SCOPE.envId,
      signingRootVersion: 'v1',
    },
    signingRootId: `${SCOPE.projectId}:${SCOPE.envId}`,
    signingRootVersion: 'v1',
  };
}

/** Setup as the Gateway assembles it, with the ceremony store on a faulting database. */
async function setupHarness(faultForCall: (call: number) => BatchFault) {
  const opened = await openSignerD1();
  const healthy: unknown = opened.database;
  if (!isD1DatabaseLike(healthy)) throw new Error('Expected the Miniflare D1 database');
  const faulting = new FaultingDatabase(healthy, faultForCall);
  const dependencies = {
    home: { kind: 'direct' as const },
    reservation: new LocalRegistrationSetupAuthority(healthy, SCOPE),
    store: new CloudflareD1RegistrationCeremonyIntentStore({
      kind: 'partitioned_d1',
      database: faulting,
      scope: SCOPE,
      keyPrefix: 'registration:',
    }),
    // A NEAR-only plan prepares no ECDSA branch.
    ecdsaStrictRegistration: {} as RouterAbEcdsaStrictRegistrationPort,
    // Setup mints the Yao identity for this SigningWorker. This runtime describes no admission.
    ed25519Yao: {
      signingWorkerId: 'worker',
      describeRegistrationAdmission: async () => ({
        ok: false as const,
        status: 503 as const,
        code: 'admission_failed',
        message: 'This runtime describes no admission before its proof',
      }),
    },
    startRegistrationWallets: null,
  };
  const count = countD1Rows.bind(null, healthy);
  return {
    faulting,
    setup: (input: WalletRegistrationSetupInput) =>
      dispatchWalletRegistrationSetup(
        {
          dispatcher: null,
          local: {
            setupWalletRegistration: (request) =>
              executeD1WalletRegistrationSetup(request, dependencies),
          },
        },
        input,
      ),
    ceremonyRows: () =>
      count(
        `SELECT COUNT(*) AS rows FROM registration_ceremony_records
          WHERE record_scope LIKE '%ceremony' AND record_scope NOT LIKE '%index'`,
      ),
    homeRows: () => count('SELECT COUNT(*) AS rows FROM wallet_execution_generations'),
    close: opened.close,
  };
}

async function withCapturedErrors<T>(
  run: () => Promise<T>,
): Promise<{ readonly value: T; readonly logged: string }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...values: unknown[]) => {
    lines.push(JSON.stringify(values));
  };
  try {
    return { value: await run(), logged: lines.join('\n') };
  } finally {
    console.error = original;
  }
}

for (const kind of ['lost_request', 'lost_reply'] as const) {
  test(`setup succeeds on the retry after one ${kind} connection fault`, async () => {
    const harness = await setupHarness((call) => ({ kind: call === 1 ? kind : 'none' }));
    try {
      const response = await harness.setup(setupInput(kind));

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ ok: true, kind: 'near_ed25519' });
      expect(harness.faulting.batchCalls).toBe(2);
      // The repeat stores nothing twice: one setup snapshot, one ceremony, one home.
      expect(await harness.ceremonyRows()).toBe(2);
      expect(await harness.homeRows()).toBe(1);
    } finally {
      await harness.close();
    }
  });
}

test('a persistent connection fault returns 503 without the driver text', async () => {
  const harness = await setupHarness(() => ({ kind: 'lost_request' }));
  try {
    const { value: response, logged } = await withCapturedErrors(() =>
      harness.setup(setupInput('persistent')),
    );

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      ok: false,
      code: 'storage_unavailable',
      message: 'Wallet registration setup is temporarily unavailable. Try again.',
    });
    expect(JSON.stringify(response.body)).not.toContain('D1_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('Network connection lost');
    // Two retries follow the first attempt, and the cause is logged on the server.
    expect(harness.faulting.batchCalls).toBe(3);
    expect(logged).toContain(CONNECTION_LOST);
    expect(await harness.ceremonyRows()).toBe(0);
  } finally {
    await harness.close();
  }
});

test('a storage error that is not transient is not retried and returns 500', async () => {
  const driverText = 'D1_ERROR: no such table: registration_ceremony_records';
  const harness = await setupHarness(() => ({
    kind: 'lost_request',
    error: new Error(driverText),
  }));
  try {
    const { value: response, logged } = await withCapturedErrors(() =>
      harness.setup(setupInput('permanent')),
    );

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      ok: false,
      code: 'internal',
      message: 'Wallet registration setup failed',
    });
    expect(harness.faulting.batchCalls).toBe(1);
    expect(logged).toContain(driverText);
  } finally {
    await harness.close();
  }
});

test('a rejected request keeps its client error and its message', async () => {
  const harness = await setupHarness(() => ({ kind: 'none' }));
  try {
    const input = setupInput('rejected');
    const response = await harness.setup({
      ...input,
      runtimePolicyScope: { ...input.runtimePolicyScope!, orgId: 'another-org' },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      ok: false,
      code: 'scope_conflict',
      message: 'Registration scope differs from the local authority',
    });
  } finally {
    await harness.close();
  }
});

async function countD1Rows(database: D1DatabaseLike, sql: string): Promise<number> {
  const row = await database.prepare(sql).first<{ readonly rows: number }>();
  if (row === null) throw new Error('Expected one D1 count result');
  return row.rows;
}

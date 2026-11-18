import { expect, test } from '@playwright/test';
import { buildFullOwnerPermissionsV1 } from '@shared/authorization/delegatedAuthority';
import { parseTenantId } from '@shared/authorization/capabilityKinds';
import {
  DEFAULT_WALLET_SESSION_REMAINING_USES,
  DEFAULT_WALLET_SESSION_TTL_MS,
  LINKED_DEVICE_WALLET_SESSION_REMAINING_USES,
  LINKED_DEVICE_WALLET_SESSION_TTL_MS,
  MAX_WALLET_SESSION_REMAINING_USES,
  MAX_WALLET_SESSION_TTL_MS,
} from '@shared/threshold/sessionPolicy';
import {
  DEFAULT_TENANT_WALLET_SESSION_LIMITS,
  grantWalletSessionBudget,
  parseOptionalWalletSessionBudget,
  parseSignedPolicyWalletSessionBudget,
  parseWalletSessionLimits,
  type WalletSessionBudget,
  type WalletSessionLimits,
} from '@shared/threshold/walletSessionBudget';
import { AuthorizationService, type WalletSessionLimitsPort } from '../../packages/wallet-server/src/authorization/service';
import { capabilityPolicyPort } from '../../packages/wallet-server/src/authorization/capabilityPolicy';
import { CloudflareD1AuthorizationStore } from '../../packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
import { D1WalletExecutionAuthority } from '../../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
import { prepareD1WalletAuthorityPutStatement } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
import { prepareD1WalletAuthMethodV2PutStatement } from '../../packages/wallet-server/src/core/d1WalletAuthMethodStore';
import { createWalletConsoleOpsClient } from '../../packages/wallet-server/src/router/cloudflare/runtime/walletConsoleOpsClient';
import { createProjectEnvironmentWalletSessionLimits } from '../../packages/wallet-server/src/router/cloudflare/runtime/projectEnvironmentWalletSessionLimits';
import { buildLinkedDeviceManagementAuthorityFixture } from './helpers/linkedDeviceManagement.fixtures';
import { openSignerD1 } from '../fixtures/signer-d1.mjs';
import { seedExecutionGeneration } from '../e2e/execution-generation.scenario.mjs';

const DAY_MS = 24 * 60 * 60_000;
const SCOPE = {
  namespace: 'wallet-session-budget',
  orgId: 'budget-org',
  projectId: 'budget-project',
  envId: 'budget-project:dev',
};

class FixedLimits implements WalletSessionLimitsPort {
  reads = 0;

  constructor(private readonly limits: WalletSessionLimits | Error) {}

  async readWalletSessionLimits(): Promise<WalletSessionLimits> {
    this.reads += 1;
    if (this.limits instanceof Error) throw this.limits;
    return this.limits;
  }
}

/** Ports that a grant never reaches. A call to one is a defect of the test. */
const UNUSED_PORT = new Proxy(
  {},
  {
    get(_target, property) {
      throw new Error(`The grant must not use the port member ${String(property)}`);
    },
  },
);

function serviceWithLimits(limits: WalletSessionLimitsPort): AuthorizationService {
  return new AuthorizationService({
    policy: capabilityPolicyPort,
    sessions: UNUSED_PORT as never,
    evidence: UNUSED_PORT as never,
    grants: UNUSED_PORT as never,
    authorizedOperations: UNUSED_PORT as never,
    walletSessionLimits: limits,
    audit: {},
  });
}

async function prepareGrant(input: {
  readonly limits: WalletSessionLimits | Error;
  readonly requestedBudget: WalletSessionBudget | null;
  readonly provenance?: 'wallet_registration' | 'device_link';
}) {
  const fixture = await buildLinkedDeviceManagementAuthorityFixture({
    label: 'budget-grant',
    permissions: buildFullOwnerPermissionsV1(),
    provenance: input.provenance ?? 'wallet_registration',
  });
  const tenantId = parseTenantId(SCOPE.orgId);
  if (!tenantId.ok) throw new Error(tenantId.error.message);
  const issuedAtMs = 1_000_000;
  const prepared = await serviceWithLimits(new FixedLimits(input.limits))
    .prepareWalletSessionAuthorizationV2({
      tenantId: tenantId.value,
      principalId: fixture.issuedSession.session.principalId,
      walletId: fixture.authority.walletId,
      authority: fixture.authority,
      walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
      mintId: fixture.issuedSession.session.mintId,
      requestedBudget: input.requestedBudget,
      issuedAtMs,
    });
  return {
    ttlMs: prepared.session.expiresAtMs - issuedAtMs,
    remainingUses: prepared.quota.remainingUses,
    quotaExpiresAtMs: prepared.quota.expiresAtMs,
    sessionExpiresAtMs: prepared.session.expiresAtMs,
  };
}

test.describe('Wallet Session budget grant', () => {
  test('no request grants the default budget', async () => {
    const granted = await prepareGrant({
      limits: DEFAULT_TENANT_WALLET_SESSION_LIMITS,
      requestedBudget: null,
    });
    expect(granted.remainingUses).toBe(DEFAULT_WALLET_SESSION_REMAINING_USES);
    expect(granted.ttlMs).toBe(DEFAULT_WALLET_SESSION_TTL_MS);
    expect(granted.quotaExpiresAtMs).toBe(granted.sessionExpiresAtMs);
  });

  test('a request under the maximum is granted as asked', async () => {
    const granted = await prepareGrant({
      limits: DEFAULT_TENANT_WALLET_SESSION_LIMITS,
      requestedBudget: { ttlMs: 2 * DAY_MS, remainingUses: 7 },
    });
    expect(granted).toMatchObject({ ttlMs: 2 * DAY_MS, remainingUses: 7 });
  });

  test('a request above the default maximum gets 100 signatures and 30 days', async () => {
    const granted = await prepareGrant({
      limits: DEFAULT_TENANT_WALLET_SESSION_LIMITS,
      requestedBudget: { ttlMs: 60 * DAY_MS, remainingUses: 500 },
    });
    expect(granted).toMatchObject({ ttlMs: 30 * DAY_MS, remainingUses: 100 });
  });

  test("the tenant's own maximum caps the request", async () => {
    const granted = await prepareGrant({
      limits: { maxTtlMs: DAY_MS, maxRemainingUses: 10 },
      requestedBudget: { ttlMs: 60 * DAY_MS, remainingUses: 500 },
    });
    expect(granted).toMatchObject({ ttlMs: DAY_MS, remainingUses: 10 });
  });

  test('a tenant maximum above 100 lets a request above 100 through', async () => {
    const granted = await prepareGrant({
      limits: { maxTtlMs: MAX_WALLET_SESSION_TTL_MS, maxRemainingUses: 1_000 },
      requestedBudget: { ttlMs: DAY_MS, remainingUses: 500 },
    });
    expect(granted).toMatchObject({ ttlMs: DAY_MS, remainingUses: 500 });
  });

  test('an unreadable maximum grants at most the default budget', async () => {
    const granted = await prepareGrant({
      limits: new Error('Console is unavailable'),
      requestedBudget: { ttlMs: 60 * DAY_MS, remainingUses: 500 },
    });
    expect(granted).toMatchObject({
      ttlMs: DEFAULT_WALLET_SESSION_TTL_MS,
      remainingUses: DEFAULT_WALLET_SESSION_REMAINING_USES,
    });
  });

  test('an unreadable maximum keeps a smaller request', async () => {
    const granted = await prepareGrant({
      limits: new Error('Console is unavailable'),
      requestedBudget: { ttlMs: 60_000, remainingUses: 2 },
    });
    expect(granted).toMatchObject({ ttlMs: 60_000, remainingUses: 2 });
  });

  test("a linked device's authority keeps its own budget under the tenant's maximum", async () => {
    // The issuer reads the profile from the authority, so no caller can give a
    // linked device the app's budget.
    const own = await prepareGrant({
      limits: DEFAULT_TENANT_WALLET_SESSION_LIMITS,
      provenance: 'device_link',
      requestedBudget: { ttlMs: 60 * DAY_MS, remainingUses: 500 },
    });
    expect(own).toMatchObject({
      ttlMs: LINKED_DEVICE_WALLET_SESSION_TTL_MS,
      remainingUses: LINKED_DEVICE_WALLET_SESSION_REMAINING_USES,
    });
    const capped = await prepareGrant({
      limits: { maxTtlMs: DAY_MS, maxRemainingUses: 10 },
      provenance: 'device_link',
      requestedBudget: null,
    });
    expect(capped).toMatchObject({ ttlMs: LINKED_DEVICE_WALLET_SESSION_TTL_MS, remainingUses: 10 });
  });
});

test.describe('Wallet Session budget parsers', () => {
  test('the request needs exactly ttlMs and remainingUses as positive integers', () => {
    expect(parseOptionalWalletSessionBudget(undefined, 'budget')).toBeNull();
    expect(parseOptionalWalletSessionBudget(null, 'budget')).toBeNull();
    expect(parseOptionalWalletSessionBudget({ ttlMs: 1, remainingUses: 1 }, 'budget')).toEqual({
      ttlMs: 1,
      remainingUses: 1,
    });
    // A request above the platform ceiling is a valid request; the grant caps it.
    expect(
      parseOptionalWalletSessionBudget({ ttlMs: 9e12, remainingUses: 9e9 }, 'budget'),
    ).toEqual({ ttlMs: 9e12, remainingUses: 9e9 });
    for (const invalid of [
      { ttlMs: 0, remainingUses: 1 },
      { ttlMs: 1, remainingUses: 1.5 },
      { ttlMs: '1', remainingUses: 1 },
      { ttlMs: 1 },
      { ttlMs: 1, remainingUses: 1, extra: true },
      [],
    ]) {
      expect(() => parseOptionalWalletSessionBudget(invalid, 'budget')).toThrow();
    }
  });

  test('a tenant maximum is at most the platform ceiling', () => {
    expect(
      parseWalletSessionLimits(
        { maxTtlMs: MAX_WALLET_SESSION_TTL_MS, maxRemainingUses: MAX_WALLET_SESSION_REMAINING_USES },
        'limits',
      ),
    ).toEqual({
      maxTtlMs: MAX_WALLET_SESSION_TTL_MS,
      maxRemainingUses: MAX_WALLET_SESSION_REMAINING_USES,
    });
    expect(() =>
      parseWalletSessionLimits(
        { maxTtlMs: MAX_WALLET_SESSION_TTL_MS + 1, maxRemainingUses: 1 },
        'limits',
      ),
    ).toThrow(/maxTtlMs/);
    expect(() =>
      parseWalletSessionLimits(
        { maxTtlMs: 1, maxRemainingUses: MAX_WALLET_SESSION_REMAINING_USES + 1 },
        'limits',
      ),
    ).toThrow(/maxRemainingUses/);
    expect(() => parseWalletSessionLimits({ maxTtlMs: 1 }, 'limits')).toThrow();
  });

  test('a signed session policy holds a budget within the platform ceiling', () => {
    expect(
      parseSignedPolicyWalletSessionBudget(
        { version: 'threshold_session_v1', ttlMs: 60_000, remainingUses: 7 },
        'sessionPolicy',
      ),
    ).toEqual({ ttlMs: 60_000, remainingUses: 7 });
    for (const [policy, field] of [
      [{ ttlMs: MAX_WALLET_SESSION_TTL_MS + 1, remainingUses: 1 }, /sessionPolicy\.ttlMs/],
      [{ ttlMs: 1, remainingUses: MAX_WALLET_SESSION_REMAINING_USES + 1 }, /remainingUses/],
      [{ ttlMs: 0, remainingUses: 1 }, /sessionPolicy\.ttlMs/],
      [{ ttlMs: 1 }, /sessionPolicy\.remainingUses/],
    ] as const) {
      expect(() => parseSignedPolicyWalletSessionBudget(policy, 'sessionPolicy')).toThrow(field);
    }
  });

  test('the grant takes each field on its own', () => {
    expect(
      grantWalletSessionBudget({
        profile: 'default',
        requested: { ttlMs: 10, remainingUses: 1_000 },
        limits: { maxTtlMs: 100, maxRemainingUses: 20 },
      }),
    ).toEqual({ ttlMs: 10, remainingUses: 20 });
  });
});

test.describe('the tenant maximum from the Console', () => {
  function consoleBinding(environment: Record<string, unknown>) {
    return {
      async fetch(): Promise<Response> {
        return Response.json({ ok: true, environments: [environment] });
      },
    };
  }

  const ENVIRONMENT = {
    id: SCOPE.envId,
    projectId: SCOPE.projectId,
    key: 'dev',
    signingRootVersion: '1',
    status: 'ACTIVE',
  };

  test('a tenant setting is read once for each composition', async () => {
    let reads = 0;
    const binding = consoleBinding({
      ...ENVIRONMENT,
      walletSessionLimits: { maxTtlMs: DAY_MS, maxRemainingUses: 12 },
    });
    const limits = createProjectEnvironmentWalletSessionLimits({
      resolver: createWalletConsoleOpsClient({
        fetch: async (...args) => {
          reads += 1;
          return binding.fetch(...args);
        },
      }).projectEnvironments,
      scope: SCOPE,
    });
    await expect(limits.readWalletSessionLimits()).resolves.toEqual({
      maxTtlMs: DAY_MS,
      maxRemainingUses: 12,
    });
    await limits.readWalletSessionLimits();
    expect(reads).toBe(1);
  });

  test('no tenant setting means the default maximum', async () => {
    for (const environment of [ENVIRONMENT, { ...ENVIRONMENT, walletSessionLimits: null }]) {
      const limits = createProjectEnvironmentWalletSessionLimits({
        resolver: createWalletConsoleOpsClient(consoleBinding(environment)).projectEnvironments,
        scope: SCOPE,
      });
      await expect(limits.readWalletSessionLimits()).resolves.toEqual(
        DEFAULT_TENANT_WALLET_SESSION_LIMITS,
      );
    }
  });

  test('an invalid setting or an unknown field fails the read', async () => {
    for (const environment of [
      { ...ENVIRONMENT, walletSessionLimits: { maxTtlMs: 0, maxRemainingUses: 1 } },
      { ...ENVIRONMENT, unknownSetting: true },
    ]) {
      const limits = createProjectEnvironmentWalletSessionLimits({
        resolver: createWalletConsoleOpsClient(consoleBinding(environment)).projectEnvironments,
        scope: SCOPE,
      });
      await expect(limits.readWalletSessionLimits()).rejects.toThrow();
    }
  });

  test('an invalid setting leaves the rest of the environment readable', async () => {
    // Registration and external auth read the same environment; only the grant
    // falls back when the tenant's maximum does not parse.
    const environments = await createWalletConsoleOpsClient(
      consoleBinding({ ...ENVIRONMENT, walletSessionLimits: { maxTtlMs: 0, maxRemainingUses: 1 } }),
    ).projectEnvironments.listEnvironments(
      {
        orgId: SCOPE.orgId,
        projectId: SCOPE.projectId,
        environmentId: SCOPE.envId,
        actorUserId: 'test',
        roles: [],
      },
      { status: 'ACTIVE' },
    );
    expect(environments.map((environment) => environment.id)).toEqual([SCOPE.envId]);
  });

  test('a composition without a limits port is refused', () => {
    expect(
      () =>
        new AuthorizationService({
          policy: capabilityPolicyPort,
          sessions: UNUSED_PORT as never,
          evidence: UNUSED_PORT as never,
          grants: UNUSED_PORT as never,
          authorizedOperations: UNUSED_PORT as never,
          walletSessionLimits: undefined as never,
          audit: {},
        }),
    ).toThrow(/walletSessionLimits/);
  });
});

test('an issued Wallet Session stores the granted budget in its quota', async () => {
  const runtime = await openSignerD1();
  try {
    const database = runtime.database;
    const fixture = await buildLinkedDeviceManagementAuthorityFixture({
      label: 'budget-issue',
      permissions: buildFullOwnerPermissionsV1(),
      provenance: 'wallet_registration',
      expiresAtMs: Date.now() + 120_000,
    });
    await seedExecutionGeneration({
      api: { D1WalletExecutionAuthority },
      database,
      scope: SCOPE,
      walletId: fixture.authority.walletId,
    });
    await database.batch([
      prepareD1WalletAuthorityPutStatement({ database, scope: SCOPE, authority: fixture.authority }),
      prepareD1WalletAuthMethodV2PutStatement({ database, scope: SCOPE, record: fixture.authMethod }),
    ]);
    const store = new CloudflareD1AuthorizationStore({
      database,
      namespace: SCOPE.namespace,
      walletSignerScope: SCOPE,
    });
    const serviceWithStore = (limits: WalletSessionLimits) =>
      new AuthorizationService({
        policy: capabilityPolicyPort,
        sessions: store,
        grants: store,
        evidence: store,
        authorizedOperations: store,
        walletSessionLimits: new FixedLimits(limits),
        audit: {},
      });
    const service = serviceWithStore({ maxTtlMs: DAY_MS, maxRemainingUses: 10 });
    const tenantId = parseTenantId(SCOPE.orgId);
    if (!tenantId.ok) throw new Error(tenantId.error.message);
    const issuedAtMs = Date.now();
    const input = {
      tenantId: tenantId.value,
      principalId: fixture.issuedSession.session.principalId,
      walletId: fixture.authority.walletId,
      authority: fixture.authority,
      walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
      mintId: fixture.issuedSession.session.mintId,
      requestedBudget: { ttlMs: 60 * DAY_MS, remainingUses: 500 },
      issuedAtMs,
    };
    const issued = await service.issueDirectWalletSessionAuthorizationV2(input);
    if (issued.kind !== 'issued') throw new Error('The Wallet Session was not issued');
    // A retry of the same mint after the tenant changed the maximum replays the
    // commit: the grant of the retry differs, and the identity does not.
    const retried = await serviceWithStore({
      maxTtlMs: 2 * DAY_MS,
      maxRemainingUses: 20,
    }).issueDirectWalletSessionAuthorizationV2({ ...input, issuedAtMs: issuedAtMs + 5 });
    expect(retried).toMatchObject({
      kind: 'already_committed',
      authorizationId: issued.session.authorizationId,
    });
    const stored = await service.readWalletSessionAuthorizationV2ByAuthorizationId({
      expected: issued.session,
      nowMs: issuedAtMs + 1,
    });
    expect(stored?.quota.remainingUses).toBe(10);
    expect(stored?.session.expiresAtMs).toBe(issuedAtMs + DAY_MS);
    expect(stored?.quota.expiresAtMs).toBe(issuedAtMs + DAY_MS);
  } finally {
    await runtime.close();
  }
});

import type { CloudflareServiceBindingFetcher } from '../runtime/routerAbServiceBindings';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../core/d1TenantStore';
import type { D1DatabaseLike } from '../../../storage/tenantRoute';
import { WalletObjectAddresses, type WalletObjectIdentity } from '../runtime/walletObjectAddresses';

const READ = `SELECT router, deriver_a, deriver_b, signing_worker FROM wallet_object_addresses
  WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
    AND wallet_id = ?5 AND ownership_generation = ?6`;

export class D1WalletObjectAddresses {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async initialize(
    identity: WalletObjectIdentity,
    router: CloudflareServiceBindingFetcher,
    credential: string,
  ): Promise<WalletObjectAddresses> {
    const existing = await this.read(identity);
    if (existing !== null) return existing;
    const response = await router.fetch(
      'https://mpc-router.router-ab.internal/router-ab/router/wallet/allocate',
      {
        method: 'POST',
        headers: { 'x-router-ab-internal-service-auth': credential },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error('Custody address allocation failed');
    return this.insert(identity, WalletObjectAddresses.parse(await response.json()));
  }

  async read(identity: WalletObjectIdentity): Promise<WalletObjectAddresses | null> {
    const row = await prepareD1TenantStatement(this.database, this.scope, READ, [
      identity.walletId,
      identity.ownershipGeneration,
    ]).first();
    return row === null ? null : WalletObjectAddresses.parse(row);
  }

  /** Competing allocations return the same persisted winner before either starts work. */
  async insert(
    identity: WalletObjectIdentity,
    addresses: WalletObjectAddresses,
  ): Promise<WalletObjectAddresses> {
    const identityValues = [identity.walletId, identity.ownershipGeneration];
    const results = await this.database.batch<{ readonly results: readonly unknown[] }>([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `INSERT INTO wallet_object_addresses
        (namespace, org_id, project_id, env_id, wallet_id, ownership_generation,
         router, deriver_a, deriver_b, signing_worker)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT (namespace, org_id, project_id, env_id, wallet_id, ownership_generation) DO NOTHING`,
        [
          ...identityValues,
          addresses.router,
          addresses.deriver_a,
          addresses.deriver_b,
          addresses.signing_worker,
        ],
      ),
      prepareD1TenantStatement(this.database, this.scope, READ, identityValues),
    ]);
    const row = results[1]?.results?.[0];
    return WalletObjectAddresses.parse(row);
  }
}

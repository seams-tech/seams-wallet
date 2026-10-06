import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import type { WalletExecutionAuthority, WalletRegistrationReservationAuthority } from '../../../domains/walletRegistration/walletRegistrationReservation';

type Authority = WalletRegistrationReservationAuthority;
type HomeAdmission = Awaited<ReturnType<Authority['admitHome']>>;
type OrdinaryAdmission = Awaited<ReturnType<WalletExecutionAuthority['admitEstablishedHome']>>;

// Console admits registration. The local database retains execution identity
// across requests and closes it in the same transaction as session retirement.
export class D1WalletExecutionAuthority implements Authority, WalletExecutionAuthority {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
    private readonly registration: Authority,
  ) {}

  reserve(input: Parameters<Authority['reserve']>[0]) {
    return this.registration.reserve(input);
  }

  async admitHome(input: Parameters<Authority['admitHome']>[0]): Promise<HomeAdmission> {
    const completed = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `SELECT generation FROM wallet_execution_generations
       WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
         AND wallet_id = ?5 AND origin = 'registration' AND origin_id = ?6
         AND state = 'active'`,
      [input.walletId, input.ceremonyId],
    ).first<{ readonly generation: number }>();
    if (completed) {
      return { ok: true, purpose: 'ordinary', ownershipGeneration: completed.generation };
    }
    const admitted = await this.registration.admitHome(input);
    if (!admitted.ok) return admitted;
    if (admitted.purpose === 'ordinary') {
      // A reply can be lost after Console commits completion and before the
      // local completion write. Its next admission proves the same home.
      await prepareD1TenantStatement(
        this.database,
        this.scope,
        `UPDATE wallet_execution_generations SET state = 'active'
         WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
           AND wallet_id = ?5 AND generation = ?6 AND origin = 'registration'
           AND origin_id = ?7 AND state = 'registering'`,
        [input.walletId, admitted.ownershipGeneration, input.ceremonyId],
      ).run();
      const local = await this.admitEstablishedHome({ walletId: input.walletId });
      if (!local.ok) return local;
      if (local.ownershipGeneration !== admitted.ownershipGeneration)
        throw new Error('Wallet execution generation differs from its admitted home');
      return local;
    }
    const generation = admitted.ownershipGeneration;
    if (!Number.isSafeInteger(generation) || generation < 1)
      throw new Error('Registration execution generation is invalid');
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `INSERT INTO wallet_execution_generations
          (namespace, org_id, project_id, env_id, wallet_id, generation, origin, origin_id, state)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'registration', ?7, 'registering')
         ON CONFLICT DO NOTHING`,
        [input.walletId, generation, input.ceremonyId],
      ),
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `UPDATE wallet_execution_generations SET state = state
         WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
           AND wallet_id = ?5 AND generation = ?6 AND origin = 'registration'
           AND origin_id = ?7 AND state = 'registering'`,
        [input.walletId, generation, input.ceremonyId],
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
    return admitted;
  }

  async complete(input: Parameters<Authority['complete']>[0]) {
    const completed = await this.registration.complete(input);
    if (!completed.ok) return completed;
    const state = input.outcome === 'established' ? 'active' : 'retired';
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `UPDATE wallet_execution_generations SET state = ?7
         WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
           AND wallet_id = ?5 AND origin = 'registration' AND origin_id = ?6
           AND state IN ('registering', ?7)`,
        [input.walletId, input.ceremonyId, state],
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
    return completed;
  }

  async admitEstablishedHome(
    input: Parameters<WalletExecutionAuthority['admitEstablishedHome']>[0],
  ): Promise<OrdinaryAdmission> {
    return admitD1EstablishedWalletHome(this.database, this.scope, input);
  }
}

export async function admitD1EstablishedWalletHome(
  database: D1DatabaseLike,
  scope: D1TenantScope,
  input: Parameters<WalletExecutionAuthority['admitEstablishedHome']>[0],
): Promise<OrdinaryAdmission> {
  const row = await prepareD1TenantStatement(
    database,
    scope,
    `SELECT generation FROM wallet_execution_generations
     WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
       AND wallet_id = ?5 AND state = 'active'`,
    [input.walletId],
  ).first<{ readonly generation: number }>();
  if (!row)
    return {
      ok: false,
      code: 'wallet_home_unavailable',
      message: 'Wallet execution is not active at this home',
    };
  return { ok: true, purpose: 'ordinary', ownershipGeneration: row.generation };
}

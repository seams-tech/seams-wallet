import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import type {
  RegistrationEstablishedPublication,
  WalletExecutionAuthority,
  WalletRegistrationHomeAuthority,
  WalletRegistrationReservationAuthority,
} from '../../../domains/walletRegistration/walletRegistrationReservation';

type Authority = WalletRegistrationReservationAuthority;
type HomeAdmission = Awaited<ReturnType<Authority['admitHome']>>;
type OrdinaryAdmission = Awaited<ReturnType<WalletExecutionAuthority['admitEstablishedHome']>>;

// Console admits registration. The local database retains execution identity
// across requests and closes it in the same transaction as session retirement.
export class D1WalletExecutionAuthority
  implements WalletRegistrationHomeAuthority, WalletExecutionAuthority
{
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
    private readonly registration: Authority,
  ) {}

  reserve(input: Parameters<Authority['reserve']>[0]) {
    return this.registration.reserve(input);
  }

  async admitHome(input: Parameters<Authority['admitHome']>[0]): Promise<HomeAdmission> {
    const local = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `SELECT generation, state, registration_completion FROM wallet_execution_generations
       WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
         AND wallet_id = ?5 AND origin = 'registration' AND origin_id = ?6`,
      [input.walletId, input.ceremonyId],
    ).first<{
      readonly generation: number;
      readonly state: string;
      readonly registration_completion: string;
    }>();
    if (local) {
      switch (local.state) {
        case 'active':
          return this.admitEstablishedHome({ walletId: input.walletId });
        case 'registering':
          if (local.registration_completion === 'pending') {
            return { ok: true, purpose: 'registration', ownershipGeneration: local.generation };
          }
          if (local.registration_completion !== 'established') {
            throw new Error('Registration completion state is invalid');
          }
          // Issuance retry republishes the committed session and home together.
          // Keep signing fenced until that publication is acknowledged.
          return { ok: true, purpose: 'registration', ownershipGeneration: local.generation };
        case 'retired':
          if (local.registration_completion === 'cancelled') {
            const published = await this.cancel(input);
            if (!published.ok) return published;
          }
          return {
            ok: false,
            code: 'wallet_home_unavailable',
            message: 'Registration execution is retired at this home',
          };
        default:
          throw new Error('Registration execution state is invalid');
      }
    }
    return {
      ok: false,
      code: 'wallet_home_unavailable',
      message: 'Registration setup has no local execution identity',
    };
  }

  async cancel(input: Parameters<WalletRegistrationHomeAuthority['cancel']>[0]) {
    const completion = { ...input, outcome: 'cancelled' as const };
    await this.fixDecision(completion);
    const completed = await this.registration.complete(completion);
    if (!completed.ok) return completed;
    await this.database.batch(this.prepareState(input, 'retired'));
    return completed;
  }

  async publishEstablished(
    input: Parameters<WalletRegistrationHomeAuthority['publishEstablished']>[0],
  ): Promise<RegistrationEstablishedPublication> {
    const published = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `SELECT state FROM wallet_execution_generations
       WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
         AND wallet_id = ?5 AND origin = 'registration' AND origin_id = ?6
         AND state IN ('registering', 'active') AND registration_completion = 'established'`,
      [input.walletId, input.ceremonyId],
    ).first<{ readonly state: string }>();
    // Activation follows the acknowledged directory write. Its exact retry is local.
    if (published?.state === 'active') return { ok: true, activation: null };
    const completion = { ...input, outcome: 'established' as const };
    if (published?.state !== 'registering') await this.fixDecision(completion);
    const completed = await this.registration.complete(completion);
    if (!completed.ok) return completed;
    return { ok: true, activation: { statements: this.prepareState(input, 'active') } };
  }

  // Fix the terminal decision before crossing the database boundary. Exact
  // retries may publish it again; a conflicting outcome never reaches Console.
  private async fixDecision(input: Parameters<Authority['complete']>[0]): Promise<void> {
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `UPDATE wallet_execution_generations
         SET registration_completion = ?7,
             state = CASE WHEN ?7 = 'cancelled' THEN 'retired' ELSE state END
         WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
           AND wallet_id = ?5 AND origin = 'registration' AND origin_id = ?6
           AND registration_completion IN ('pending', ?7)
           AND (state = 'registering'
             OR (?7 = 'established' AND state = 'active')
             OR (?7 = 'cancelled' AND state = 'retired'))`,
        [input.walletId, input.ceremonyId, input.outcome],
      ),
      this.database.prepare(D1_BATCH_CAS_GUARD_SQL),
    ]);
  }

  /** The state update with its guard. The guard reads the row count of the update before it. */
  private prepareState(
    input: { readonly ceremonyId: string; readonly walletId: string },
    state: 'active' | 'retired',
  ) {
    return [
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
    ];
  }

  async admitEstablishedHome(
    input: Parameters<WalletExecutionAuthority['admitEstablishedHome']>[0],
  ): Promise<OrdinaryAdmission> {
    return admitD1EstablishedWalletHome(this.database, this.scope, input);
  }
}

/** Records the authenticated reservation beside setup without reopening a retired home. */
export function prepareD1RegistrationHomeReservation(
  database: D1DatabaseLike,
  scope: D1TenantScope,
  input: Parameters<Authority['admitHome']>[0] & { readonly ownershipGeneration: number },
) {
  if (!Number.isSafeInteger(input.ownershipGeneration) || input.ownershipGeneration < 1)
    throw new Error('Registration execution generation is invalid');
  const identity = [input.walletId, input.ownershipGeneration, input.ceremonyId];
  return [
    prepareD1TenantStatement(
      database,
      scope,
      `INSERT INTO wallet_execution_generations
        (namespace, org_id, project_id, env_id, wallet_id, generation, origin, origin_id, state)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'registration', ?7, 'registering')
       ON CONFLICT DO NOTHING`,
      identity,
    ),
    prepareD1TenantStatement(
      database,
      scope,
      `UPDATE wallet_execution_generations SET state = state
       WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
         AND wallet_id = ?5 AND generation = ?6 AND origin = 'registration'
         AND origin_id = ?7 AND state IN ('registering', 'active')`,
      identity,
    ),
    database.prepare(D1_BATCH_CAS_GUARD_SQL),
  ];
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
       AND wallet_id = ?5 AND state = 'active'
       AND NOT EXISTS (SELECT 1 FROM wallet_relocation_write_blocks block
         WHERE block.namespace = ?1 AND block.org_id = ?2 AND block.project_id = ?3
           AND block.env_id = ?4 AND block.wallet_id = ?5 AND block.source_generation = generation
           AND block.state IN ('draining', 'checked'))`,
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

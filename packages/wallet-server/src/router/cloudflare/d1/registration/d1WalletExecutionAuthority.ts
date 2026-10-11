import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import type { D1DatabaseLike, D1ResultLike } from '../../../../storage/tenantRoute';
import type {
  RegistrationEstablishedPublication,
  WalletExecutionAuthority,
  WalletRegistrationHomeAuthority,
  WalletRegistrationReservationAuthority,
} from '../../../domains/walletRegistration/walletRegistrationReservation';

type Authority = WalletRegistrationReservationAuthority;
type HomeAdmission = Awaited<ReturnType<Authority['admitHome']>>;
type OrdinaryAdmission = Awaited<ReturnType<WalletExecutionAuthority['admitEstablishedHome']>>;
type RegistrationHomeRow = {
  readonly generation: number;
  readonly state: string;
  readonly registration_completion: string;
  readonly relocation_blocked: number;
};

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
    const result = await this.prepareHomeRead(input).all<RegistrationHomeRow>();
    return this.admitHomeRead(input, result);
  }

  prepareHomeRead(input: Parameters<Authority['admitHome']>[0]) {
    return prepareD1TenantStatement(
      this.database,
      this.scope,
      `SELECT generation, state, registration_completion,
         EXISTS (SELECT 1 FROM wallet_relocation_write_blocks block
           WHERE block.namespace = ?1 AND block.org_id = ?2 AND block.project_id = ?3
             AND block.env_id = ?4 AND block.wallet_id = ?5 AND block.source_generation = generation
             AND block.state IN ('draining', 'checked')) AS relocation_blocked
       FROM wallet_execution_generations
       WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
         AND wallet_id = ?5 AND origin = 'registration' AND origin_id = ?6`,
      [input.walletId, input.ceremonyId],
    );
  }

  async admitHomeRead(
    input: Parameters<Authority['admitHome']>[0],
    result: D1ResultLike<Partial<Record<keyof RegistrationHomeRow, unknown>>>,
  ): Promise<HomeAdmission> {
    if (!result.success) throw new Error('Registration home D1 read failed');
    const local = result.results?.[0];
    if (local) {
      if (
        typeof local.generation !== 'number' ||
        !Number.isSafeInteger(local.generation) ||
        local.generation < 1 ||
        (local.relocation_blocked !== 0 && local.relocation_blocked !== 1)
      ) {
        throw new Error('Registration execution identity is invalid');
      }
      switch (local.state) {
        case 'active':
          if (local.relocation_blocked === 1) {
            return {
              ok: false,
              code: 'wallet_home_unavailable',
              message: 'Wallet execution is not active at this home',
            };
          }
          return { ok: true, purpose: 'ordinary', ownershipGeneration: local.generation };
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
    await this.fixCancellation(input);
    const completed = await this.registration.complete(completion);
    if (!completed.ok) return completed;
    await this.database.batch(this.prepareState(input, 'retired'));
    return completed;
  }

  async publishEstablished(
    input: Parameters<WalletRegistrationHomeAuthority['publishEstablished']>[0],
  ): Promise<RegistrationEstablishedPublication> {
    // Activation follows the acknowledged directory write. Its exact retry is local.
    if (input.registration.state === 'active') return { ok: true, activation: null };
    const completed = await this.registration.complete({
      ceremonyId: input.registration.ceremonyId,
      walletId: input.registration.walletId,
      outcome: 'established',
      session: input.session,
    });
    if (!completed.ok) return completed;
    return {
      ok: true,
      activation: { statements: this.prepareState(input.registration, 'active') },
    };
  }

  // Fix cancellation before crossing the database boundary. Exact
  // retries may publish it again; a conflicting outcome never reaches Console.
  private async fixCancellation(
    input: Parameters<WalletRegistrationHomeAuthority['cancel']>[0],
  ): Promise<void> {
    await this.database.batch([
      prepareD1TenantStatement(
        this.database,
        this.scope,
        `UPDATE wallet_execution_generations
         SET registration_completion = 'cancelled', state = 'retired'
         WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
           AND wallet_id = ?5 AND origin = 'registration' AND origin_id = ?6
           AND registration_completion IN ('pending', 'cancelled')
           AND state IN ('registering', 'retired')`,
        [input.walletId, input.ceremonyId],
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

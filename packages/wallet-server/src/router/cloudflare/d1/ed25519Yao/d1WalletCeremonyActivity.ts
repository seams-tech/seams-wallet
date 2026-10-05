import type { WalletId } from '@shared/utils/domainIds';
import { prepareD1TenantStatement, type D1TenantScope } from '../../../../core/d1TenantStore';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import type { RouterAbEd25519YaoProductRegistrationCeremonyStateV1 } from '../../../domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitioning';

type Ceremony = RouterAbEd25519YaoProductRegistrationCeremonyStateV1;
type MapValue<T> = T extends ReadonlyMap<string, infer V> ? V : never;

export class D1WalletCeremonyActivity {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {}

  async hasPending(walletId: WalletId): Promise<boolean> {
    const row = await prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      SELECT 1 AS pending FROM wallet_ceremony_activity
      WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
        AND wallet_id = ?5 AND settled = 0 LIMIT 1`,
      [walletId],
    ).first();
    return row !== null;
  }

  project(recordKey: string, walletId: WalletId, ceremony: Ceremony): D1PreparedStatementLike {
    return prepareD1TenantStatement(
      this.database,
      this.scope,
      `
      INSERT INTO wallet_ceremony_activity
        (namespace, org_id, project_id, env_id, record_key, wallet_id, settled)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT (namespace, org_id, project_id, env_id, record_key)
      DO UPDATE SET wallet_id = excluded.wallet_id, settled = excluded.settled`,
      [recordKey, walletId, ceremonySettled(ceremony) ? 1 : 0],
    );
  }
}

function ceremonySettled(ceremony: Ceremony): boolean {
  if (ceremony.registration.admissionClaims.size > 0) return false;
  for (const registration of ceremony.registration.states.values()) {
    if (!registrationSettled(registration)) return false;
  }
  for (const recovery of ceremony.recovery.recoveries.values()) {
    if (!recoverySettled(recovery)) return false;
  }
  for (const exported of ceremony.export.exports.values()) {
    if (!exportSettled(exported)) return false;
  }
  return true;
}

function registrationSettled(state: MapValue<Ceremony['registration']['states']>): boolean {
  switch (state.kind) {
    case 'activated':
      return state.activationConsumerBinding !== null;
    case 'admitted':
    case 'executing':
    case 'failed':
      return false;
    default:
      return assertNever(state);
  }
}

function recoverySettled(state: MapValue<Ceremony['recovery']['recoveries']>): boolean {
  switch (state.kind) {
    case 'promoted':
    case 'superseded':
      return true;
    case 'admitting':
    case 'admission_failed':
    case 'admitted':
    case 'executing':
    case 'execution_interrupted':
    case 'execution_failed':
    case 'staged':
    case 'activating':
    case 'activation_failed':
      return false;
    default:
      return assertNever(state);
  }
}

function exportSettled(state: MapValue<Ceremony['export']['exports']>): boolean {
  switch (state.kind) {
    case 'completed':
      return true;
    case 'authorized':
    case 'admitting':
    case 'admission_failed':
    case 'admitted':
    case 'executing':
    case 'execution_failed':
      return false;
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown ceremony state: ${String(value)}`);
}

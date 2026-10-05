import type { D1DatabaseLike } from './storage/tenantRoute';
import type { D1TenantScope } from './core/d1TenantStore';
import { D1RegistrationCeremonyRecordStore } from './router/cloudflare/d1/registration/d1RegistrationCeremonyRecordStore';
import {
  parseWalletRegistrationSetupReservation,
  proposeWalletRegistrationSetup,
  walletRegistrationSetupRequestDigest,
  type WalletRegistrationReservationAuthority,
  type WalletRegistrationSetupReservationResult,
} from './router/domains/walletRegistration/walletRegistrationReservation';
import type { WalletRegistrationSetupInput } from './router/domains/walletRegistration/walletRegistrationInputs';

// The standalone local host simulates Console with one persistent local authority.
export class LocalRegistrationSetupAuthority implements WalletRegistrationReservationAuthority {
  private readonly storage: D1RegistrationCeremonyRecordStore;

  constructor(
    private readonly database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {
    this.storage = new D1RegistrationCeremonyRecordStore({
      database,
      scope,
      keyPrefix: 'local-registration-authority:',
    });
  }

  async admitEstablishedHome(
    input: Parameters<WalletRegistrationReservationAuthority['admitEstablishedHome']>[0],
  ): Promise<Awaited<ReturnType<WalletRegistrationReservationAuthority['admitEstablishedHome']>>> {
    const terminal = await this.database
      .prepare(
        `SELECT 1 AS established FROM registration_ceremony_records
       WHERE namespace = ?1 AND org_id = ?2 AND project_id = ?3 AND env_id = ?4
         AND record_scope = 'setup-terminal'
         AND substr(record_id, 1, 29) = 'local-registration-authority:'
         AND json_extract(record_json, '$.walletId') = ?5
         AND json_extract(record_json, '$.outcome') = 'established'
         AND expires_at_ms > ?6 LIMIT 1`,
      )
      .bind(
        this.scope.namespace,
        this.scope.orgId,
        this.scope.projectId,
        this.scope.envId,
        input.walletId,
        Date.now(),
      )
      .first();
    if (!terminal)
      return {
        ok: false,
        code: 'wallet_home_unavailable',
        message: 'Wallet home is not established',
      };
    return { ok: true, ownershipGeneration: 1, purpose: 'ordinary' };
  }

  async reserve(
    input: WalletRegistrationSetupInput,
  ): Promise<WalletRegistrationSetupReservationResult> {
    const scope = input.runtimePolicyScope;
    if (
      !scope ||
      input.orgId !== this.scope.orgId ||
      scope.orgId !== this.scope.orgId ||
      scope.projectId !== this.scope.projectId ||
      scope.envId !== this.scope.envId
    ) {
      return {
        ok: false,
        code: 'scope_conflict',
        message: 'Registration scope differs from the local authority',
      };
    }
    const requestDigest = await walletRegistrationSetupRequestDigest(this.scope.namespace, input);
    const stored = await this.storage.insertOrRead({
      scope: 'setup-reservation',
      id: input.request.registrationOperationId,
      value: { requestDigest, reservation: proposeWalletRegistrationSetup(input) },
      expiresAtMs: Number.MAX_SAFE_INTEGER,
    });
    if (stored.value.requestDigest !== requestDigest) {
      return {
        ok: false,
        code: 'request_conflict',
        message: 'Registration operation was already used for another request',
      };
    }
    const reservation = parseWalletRegistrationSetupReservation(stored.value.reservation);
    await this.storage.putExact({
      scope: 'setup-ceremony-index',
      id: reservation.ceremonyId,
      value: { walletId: reservation.walletId },
      expiresAtMs: Number.MAX_SAFE_INTEGER,
    });
    const terminal = await this.storage.get('setup-terminal', reservation.ceremonyId);
    if (terminal?.value.outcome === 'cancelled') {
      return { ok: false, code: 'registration_cancelled', message: 'Registration was cancelled' };
    }
    return {
      ok: true,
      reservation,
      lifecycle: terminal?.value.outcome === 'established' ? 'established' : 'reserved',
    };
  }
  async admitHome(
    input: Parameters<WalletRegistrationReservationAuthority['admitHome']>[0],
  ): Promise<Awaited<ReturnType<WalletRegistrationReservationAuthority['admitHome']>>> {
    const identity = await this.storage.get('setup-ceremony-index', input.ceremonyId);
    const terminal = await this.storage.get('setup-terminal', input.ceremonyId);
    if (
      !identity ||
      identity.value.walletId !== input.walletId ||
      terminal?.value.outcome === 'cancelled'
    ) {
      return {
        ok: false,
        code: 'wallet_home_unavailable',
        message: 'Registration home is unavailable',
      };
    }
    return {
      ok: true,
      ownershipGeneration: 1,
      purpose: terminal?.value.outcome === 'established' ? 'ordinary' : 'registration',
    };
  }

  async complete(
    input: Parameters<WalletRegistrationReservationAuthority['complete']>[0],
  ): Promise<Awaited<ReturnType<WalletRegistrationReservationAuthority['complete']>>> {
    const identity = await this.storage.get('setup-ceremony-index', input.ceremonyId);
    if (!identity || identity.value.walletId !== input.walletId) {
      return {
        ok: false,
        code: 'home_conflict',
        message: 'Registration completion does not match its reservation',
      };
    }
    const terminal = await this.storage.insertOrRead({
      scope: 'setup-terminal',
      id: input.ceremonyId,
      value: { walletId: input.walletId, outcome: input.outcome },
      expiresAtMs: Number.MAX_SAFE_INTEGER,
    });
    return terminal.value.outcome === input.outcome
      ? { ok: true }
      : {
          ok: false,
          code: 'registration_conflict',
          message: 'Registration terminal outcome conflicts with its reservation',
        };
  }
}

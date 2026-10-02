import type { D1DatabaseLike } from './storage/tenantRoute';
import type { D1TenantScope } from './core/d1TenantStore';
import { D1RegistrationCeremonyRecordStore } from './router/cloudflare/d1/registration/d1RegistrationCeremonyRecordStore';
import {
  parseWalletRegistrationSetupReservation,
  proposeWalletRegistrationSetup,
  walletRegistrationSetupRequestDigest,
  type WalletRegistrationSetupReservationPort,
  type WalletRegistrationSetupReservationResult,
} from './router/domains/walletRegistration/walletRegistrationReservation';
import type { WalletRegistrationSetupInput } from './router/domains/walletRegistration/walletRegistrationInputs';

// The standalone local host simulates Console with one persistent local authority.
export class LocalRegistrationSetupAuthority implements WalletRegistrationSetupReservationPort {
  private readonly storage: D1RegistrationCeremonyRecordStore;

  constructor(
    database: D1DatabaseLike,
    private readonly scope: D1TenantScope,
  ) {
    this.storage = new D1RegistrationCeremonyRecordStore({
      database,
      scope,
      keyPrefix: 'local-registration-authority:',
    });
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
    return {
      ok: true,
      reservation: parseWalletRegistrationSetupReservation(stored.value.reservation),
    };
  }
}

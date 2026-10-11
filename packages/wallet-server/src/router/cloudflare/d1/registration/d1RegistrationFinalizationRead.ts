import type { D1DatabaseLike, D1ResultLike } from '../../../../storage/tenantRoute';
import type { WalletRegistrationHomeAuthority } from '../../../domains/walletRegistration/walletRegistrationReservation';
import type { CloudflareD1RegistrationCeremonyIntentStore } from './d1RegistrationCeremonyStore';
import type { D1WalletExecutionAuthority } from './d1WalletExecutionAuthority';
import type { D1WalletOperationStore } from './d1WalletOperationStore';
import type { D1WalletRegistrationNearProvisioningSideEffectRecord } from './d1WalletRegistrationService';

/** The registration home, retry record, and ceremony share one D1 snapshot. */
export class D1RegistrationFinalizationRead {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly authority: D1WalletExecutionAuthority | null,
    readonly operations: D1WalletOperationStore<D1WalletRegistrationNearProvisioningSideEffectRecord>,
    private readonly getCeremonies: () => CloudflareD1RegistrationCeremonyIntentStore,
  ) {}

  async read(
    home: Parameters<WalletRegistrationHomeAuthority['admitHome']>[0],
    operationKey: string,
  ) {
    if (!this.authority) {
      return {
        ok: false as const,
        code: 'registration_authority_unavailable' as const,
        message: 'Registration reservation authority is required',
      };
    }
    const ceremonies = this.getCeremonies();
    const results = await this.database.batch<D1ResultLike<Record<string, unknown>>>([
      this.authority.prepareHomeRead(home),
      this.operations.prepareRead(operationKey),
      ceremonies.prepareCeremonyRead(home.ceremonyId),
    ]);
    const [homeRead, operationRead, ceremonyRead] = results;
    if (results.length !== 3 || !homeRead || !operationRead || !ceremonyRead) {
      throw new Error('Registration finalization D1 batch returned incomplete results');
    }
    const admission = await this.authority.admitHomeRead(home, homeRead);
    if (!admission.ok) return admission;
    if (!ceremonyRead.success) throw new Error('Registration ceremony D1 read failed');
    const operation = this.operations.parseReadResult(operationRead);
    // A completed retry needs no ceremony. Decode only if the operation runner
    // prepares a new claim; resumed claims independently read their current state.
    return {
      ok: true as const,
      operation,
      readCeremony: ceremonies.parseCeremonyRead.bind(ceremonies, home.ceremonyId, ceremonyRead),
    };
  }
}

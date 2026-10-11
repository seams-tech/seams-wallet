import type { D1DatabaseLike, D1ResultLike } from '../../../../storage/tenantRoute';
import type { WalletRegistrationHomeAuthority } from '../../../domains/walletRegistration/walletRegistrationReservation';
import type { CloudflareD1RegistrationCeremonyIntentStore } from './d1RegistrationCeremonyStore';
import type { D1WalletExecutionAuthority } from './d1WalletExecutionAuthority';
import type { D1WalletOperationStore } from './d1WalletOperationStore';
import type { D1WalletRegistrationNearProvisioningSideEffectRecord } from './d1WalletRegistrationService';
import type { CloudflareD1Ed25519YaoLifecycleDecisionStoreV1 } from '../ed25519Yao/d1Ed25519YaoLifecycleDecisionStore';

/** Read admission and immutable finalization state from one D1 snapshot. */
export class D1WalletRegistrationRead {
  constructor(
    private readonly database: D1DatabaseLike,
    private readonly authority: D1WalletExecutionAuthority | null,
    readonly operations: D1WalletOperationStore<D1WalletRegistrationNearProvisioningSideEffectRecord>,
    private readonly getCeremonies: () => CloudflareD1RegistrationCeremonyIntentStore,
    private readonly decisions: CloudflareD1Ed25519YaoLifecycleDecisionStoreV1,
  ) {}

  async readRespond(home: Parameters<WalletRegistrationHomeAuthority['admitHome']>[0]) {
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
      ceremonies.prepareCeremonyRead(home.ceremonyId),
    ]);
    const [homeRead, ceremonyRead] = results;
    if (results.length !== 2 || !homeRead || !ceremonyRead) {
      throw new Error('Registration respond D1 batch returned incomplete results');
    }
    const admission = await this.authority.admitHomeRead(home, homeRead);
    if (!admission.ok) return admission;
    return {
      ok: true as const,
      ownershipGeneration: admission.ownershipGeneration,
      snapshot: await ceremonies.parseCeremonySnapshotRead(home.ceremonyId, ceremonyRead),
    };
  }

  async readFinalization(
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
      this.decisions.prepareRead(home.ceremonyId),
    ]);
    const [homeRead, operationRead, ceremonyRead, decisionRead] = results;
    if (results.length !== 4 || !homeRead || !operationRead || !ceremonyRead || !decisionRead) {
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
      // A decision never changes. A competing insert still fails the wallet
      // transaction's decision guard before any companion write can commit.
      decision: this.decisions.parseRead(home.ceremonyId, decisionRead),
      readCeremony: ceremonies.parseCeremonyRead.bind(ceremonies, home.ceremonyId, ceremonyRead),
    };
  }
}

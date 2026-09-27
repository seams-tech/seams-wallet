import type { WalletEd25519YaoActiveCapabilityRecord } from '../../../../core/WalletStore';
import {
  InMemoryRouterAbEd25519YaoRegistrationService,
  type RouterAbEd25519YaoActivationConsumptionRequestV1,
  type RouterAbEd25519YaoActivationConsumptionResultV1,
  type RouterAbEd25519YaoRegistrationBackend,
  type RouterAbEd25519YaoRegistrationBackendResult,
} from '../registration/routerAbEd25519YaoRegistration';
import { InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationAdapter } from '../registration/routerAbEd25519YaoRegistrationIntentAuthorization';
import type {
  RouterAbEd25519YaoRegistrationIntentBindingResult,
  RouterAbEd25519YaoVerifiedActivationIntentV1,
} from '../registration/routerAbEd25519YaoRegistrationIntentAuthorization';
import {
  InMemoryRouterAbEd25519YaoRecoveryService,
  type RouterAbEd25519YaoActiveCapabilityLookupResultV1,
  type RouterAbEd25519YaoActiveCapabilityLookupV1,
  type RouterAbEd25519YaoRecoveryBackend,
  type RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallationV1,
  type RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1,
} from '../recovery/routerAbEd25519YaoRecovery';
import {
  routerAbEd25519YaoPersistedCapabilityMatchesLookupV1,
  type RouterAbEd25519YaoProductRegistrationRuntimeV1,
  type RouterAbEd25519YaoProductRegistrationStateV1,
  type RouterAbEd25519YaoVerifiedRegistrationAdmissionResultV1,
} from './routerAbEd25519YaoProductRegistration';
import {
  routerAbEd25519YaoAdmittedRegistrationAuthorityV1,
  type RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
  type RouterAbEd25519YaoProductRegistrationPartitionedStateV1,
} from './routerAbEd25519YaoProductRegistrationPartitionedStateStore';
import {
  parseRouterAbEd25519YaoRegistrationRouterAnswerV1,
  type RouterAbEd25519YaoPinnedRegistrationBackend,
} from '../registration/routerAbEd25519YaoHttpRegistrationBackend';
import {
  pinRouterAbEd25519YaoRegistrationDispatchRootV1,
  routerAbEd25519YaoRegistrationExecuteRequestFromRouterRequestJsonV1,
  routerAbEd25519YaoRegistrationResultFromRouterAnswerV1,
} from '../registration/routerAbEd25519YaoRegistrationExecutionRecord';
import type { RouterAbEd25519YaoTenantRootWireV1 } from '../routerAbEd25519YaoGatewayEnvelope';

export type RouterAbEd25519YaoProductRegistrationRequestScopedRuntimeInputV1 = {
  readonly signingWorkerId: string;
  readonly store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1;
  /** The Router, which owns each registration's execution and its consumption. */
  readonly registrationBackend: RouterAbEd25519YaoPinnedRegistrationBackend;
  /** Loads one canonical signer record for an existing-wallet capability miss. */
  readonly loadPersistedActiveCapability?: (
    input: RouterAbEd25519YaoActiveCapabilityLookupV1,
  ) => Promise<WalletEd25519YaoActiveCapabilityRecord | null>;
};

type RequestScopedMutationResult<T> =
  | { readonly kind: 'commit'; readonly value: T }
  | { readonly kind: 'reject'; readonly value: T };

const SHARED_CAPABILITY_READ_LIFECYCLE_ID = 'shared-capability-read';
const MAX_DETERMINISTIC_COMMIT_ATTEMPTS = 2;

const UNUSED_BACKEND: RouterAbEd25519YaoRegistrationBackend & RouterAbEd25519YaoRecoveryBackend = {
  admit: rejectUnusedBackend,
  execute: rejectUnusedBackend,
  admitRecovery: rejectUnusedBackend,
  executeRecovery: rejectUnusedBackend,
  activateRecovery: rejectUnusedBackend,
};

/**
 * Product-state runtime for wallet start/finalize routes. Each mutation loads
 * fresh partitioned state and reconciles CAS conflicts by reapplying only the
 * deterministic state transition. External account, wallet, and session
 * effects stay outside this adapter and are never repeated here.
 */
export function createRouterAbEd25519YaoProductRegistrationRequestScopedRuntimeV1(
  input: RouterAbEd25519YaoProductRegistrationRequestScopedRuntimeInputV1,
): RouterAbEd25519YaoProductRegistrationRuntimeV1 {
  return new RouterAbEd25519YaoProductRegistrationRequestScopedRuntime(input);
}

class RouterAbEd25519YaoProductRegistrationRequestScopedRuntime implements RouterAbEd25519YaoProductRegistrationRuntimeV1 {
  readonly kind = 'router_ab_ed25519_yao_product_registration_runtime_v1' as const;
  readonly signingWorkerId: string;

  constructor(
    private readonly input: RouterAbEd25519YaoProductRegistrationRequestScopedRuntimeInputV1,
  ) {
    this.signingWorkerId = input.signingWorkerId.trim();
    if (!this.signingWorkerId) throw new Error('Ed25519 Yao SigningWorker ID is required');
  }

  async bindVerifiedIntent(
    input: RouterAbEd25519YaoVerifiedActivationIntentV1,
  ): Promise<RouterAbEd25519YaoRegistrationIntentBindingResult> {
    return await this.commitUntilReconciled(
      input.admissionRequest.scope.lifecycle_id,
      bindVerifiedIntentMutation.bind(undefined, input),
    );
  }

  async bindAndAdmitVerifiedRegistration(
    input: RouterAbEd25519YaoVerifiedActivationIntentV1,
  ): Promise<RouterAbEd25519YaoVerifiedRegistrationAdmissionResultV1> {
    return await bindAndAdmitVerifiedRegistration({
      input,
      store: this.input.store,
      backend: this.input.registrationBackend,
    });
  }

  /**
   * Consumes a registration's activation at the Router, which owns its
   * execution: the first consumer binding wins, and the same binding
   * replays. The admission and the tenant root pinned with it come from this
   * Gateway's ceremony record, and the result is derived from the Router's
   * recorded answer: no active-root lookup is needed.
   */
  async consumeActivated(
    input: RouterAbEd25519YaoActivationConsumptionRequestV1,
  ): Promise<RouterAbEd25519YaoActivationConsumptionResultV1> {
    const lifecycleId = input.reference.lifecycleId;
    const loaded = await this.input.store.load(lifecycleId);
    const authority = routerAbEd25519YaoAdmittedRegistrationAuthorityV1(loaded.state, lifecycleId);
    if (!authority) {
      return {
        ok: false,
        code: 'unknown_registration',
        message: 'registration lifecycle was not found',
      };
    }
    const backend = this.input.registrationBackend;
    const consumed = await backend.consumeRegistration({
      tenantRoot: authority.dispatchRoot,
      walletId: authority.admissionReceipt.binding.lifecycle.account_id,
      lifecycleId,
      sessionId: input.reference.sessionId,
      consumerBinding: input.consumerBinding,
    });
    switch (consumed.kind) {
      case 'unavailable':
        throw new Error(`Router registration consumption is unavailable: ${consumed.message}`);
      case 'refused':
        return { ok: false, code: consumed.code, message: consumed.message };
      case 'consumed':
        break;
    }
    const request = routerAbEd25519YaoRegistrationExecuteRequestFromRouterRequestJsonV1(
      consumed.requestJson,
    );
    const result = routerAbEd25519YaoRegistrationResultFromRouterAnswerV1({
      backend,
      authority,
      request,
      answer: parseRouterAbEd25519YaoRegistrationRouterAnswerV1(consumed.responseJson, request),
    });
    if (!result.ok) {
      throw new Error(`Router recorded answer is not a verifiable activation: ${result.message}`);
    }
    return {
      ok: true,
      activation: {
        admissionRequest: authority.admissionRequest,
        admissionReceipt: authority.admissionReceipt,
        result: result.value,
      },
    };
  }

  async installRegistrationFinalizeCapability(
    input: RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallationV1,
  ): Promise<RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1> {
    return await this.commitUntilReconciled(
      input.registrationAdmissionRequest.scope.lifecycle_id,
      installRegistrationFinalizeCapabilityMutation.bind(undefined, input),
    );
  }

  async installPersistedActiveCapability(
    input: WalletEd25519YaoActiveCapabilityRecord,
  ): Promise<RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1> {
    return await this.commitUntilReconciled(
      input.admissionRequest.scope.lifecycle_id,
      installPersistedActiveCapabilityMutation.bind(undefined, input),
    );
  }

  async resolveActiveCapability(
    input: RouterAbEd25519YaoActiveCapabilityLookupV1,
  ): Promise<RouterAbEd25519YaoActiveCapabilityLookupResultV1> {
    const loaded = await this.input.store.load(SHARED_CAPABILITY_READ_LIFECYCLE_ID);
    const result = recoveryService(loaded.state).resolveActiveCapability(input);
    if (
      result.ok ||
      result.code !== 'unknown_capability' ||
      !this.input.loadPersistedActiveCapability
    ) {
      return result;
    }
    const persisted = await this.input.loadPersistedActiveCapability(input);
    if (!persisted || !routerAbEd25519YaoPersistedCapabilityMatchesLookupV1(persisted, input)) {
      return result;
    }
    const installed = await this.installPersistedActiveCapability(persisted);
    if (!installed.ok) {
      return {
        ok: false,
        code: 'capability_conflict',
        message: installed.message,
      };
    }
    const refreshed = await this.input.store.load(SHARED_CAPABILITY_READ_LIFECYCLE_ID);
    return recoveryService(refreshed.state).resolveActiveCapability(input);
  }

  private async commitUntilReconciled<T>(
    lifecycleId: string,
    mutate: (
      state: RouterAbEd25519YaoProductRegistrationStateV1,
    ) => Promise<RequestScopedMutationResult<T>>,
  ): Promise<T> {
    for (let attempt = 0; attempt < MAX_DETERMINISTIC_COMMIT_ATTEMPTS; attempt += 1) {
      const loaded = await this.input.store.load(lifecycleId);
      const mutation = await mutate(loaded.state);
      if (mutation.kind === 'reject') return mutation.value;
      const committed = await this.input.store.commit(commitInput(lifecycleId, loaded));
      if (committed.kind === 'stored') return mutation.value;
    }
    throw new Error('Request-scoped product state remained contended after one reconciliation');
  }
}

/**
 * Binds a verified intent and admits its registration. The tenant root the
 * registration dispatches to is resolved once, for a fresh admission, and
 * pinned with the admission in the ceremony record.
 */
async function bindAndAdmitVerifiedRegistration(input: {
  readonly input: RouterAbEd25519YaoVerifiedActivationIntentV1;
  readonly store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1;
  readonly backend: RouterAbEd25519YaoPinnedRegistrationBackend;
}): Promise<RouterAbEd25519YaoVerifiedRegistrationAdmissionResultV1> {
  const lifecycleId = input.input.admissionRequest.scope.lifecycle_id;
  let backendResult: RouterAbEd25519YaoRegistrationBackendResult | null = null;
  let dispatchRoot: RouterAbEd25519YaoTenantRootWireV1 | null = null;
  for (let attempt = 0; attempt < MAX_DETERMINISTIC_COMMIT_ATTEMPTS; attempt += 1) {
    const loaded = await input.store.load(lifecycleId);
    const bound = await new InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationAdapter(
      loaded.state.authorization,
    ).bindVerifiedIntent(input.input);
    if (!bound.ok) return bound;

    const service = new InMemoryRouterAbEd25519YaoRegistrationService(
      input.backend,
      loaded.state.registration,
    );
    const preparation = service.prepareAdmit(bound.admissionRequest);
    if (preparation.kind === 'completed') {
      return { ok: true, status: 200, value: preparation.value };
    }
    if (preparation.kind === 'failed') return preparation.failure;

    if (dispatchRoot === null) {
      try {
        dispatchRoot = await input.backend.resolveRegistrationDispatchRoot(
          bound.admissionRequest,
        );
      } catch (error: unknown) {
        return {
          ok: false,
          status: 503,
          code: 'admission_failed',
          message: `registration tenant root is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }
    if (backendResult === null) {
      try {
        backendResult = await input.backend.admit(bound.admissionRequest);
      } catch (error: unknown) {
        return {
          ok: false,
          status: 503,
          code: 'admission_uncertain',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    const admitted = service.commitAdmit({
      request: bound.admissionRequest,
      claim: preparation.claim,
      outcome: { kind: 'backend_response', result: backendResult },
    });
    if (!admitted.ok) return admitted;
    pinRouterAbEd25519YaoRegistrationDispatchRootV1(
      loaded.state.registration,
      lifecycleId,
      dispatchRoot,
    );

    const committed = await input.store.commit(commitInput(lifecycleId, loaded));
    if (committed.kind === 'stored') return admitted;
  }
  return {
    ok: false,
    status: 503,
    code: 'admission_uncertain',
    message: 'Yao verified registration admission remained contended after one reconciliation',
  };
}

async function bindVerifiedIntentMutation(
  input: RouterAbEd25519YaoVerifiedActivationIntentV1,
  state: RouterAbEd25519YaoProductRegistrationStateV1,
): Promise<RequestScopedMutationResult<RouterAbEd25519YaoRegistrationIntentBindingResult>> {
  const result = await new InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationAdapter(
    state.authorization,
  ).bindVerifiedIntent(input);
  return result.ok ? { kind: 'commit', value: result } : { kind: 'reject', value: result };
}

async function installRegistrationFinalizeCapabilityMutation(
  input: RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallationV1,
  state: RouterAbEd25519YaoProductRegistrationStateV1,
): Promise<
  RequestScopedMutationResult<RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1>
> {
  const result = recoveryService(state).installRegistrationFinalizeCapability(input);
  return result.ok ? { kind: 'commit', value: result } : { kind: 'reject', value: result };
}

async function installPersistedActiveCapabilityMutation(
  input: WalletEd25519YaoActiveCapabilityRecord,
  state: RouterAbEd25519YaoProductRegistrationStateV1,
): Promise<
  RequestScopedMutationResult<RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1>
> {
  const result = recoveryService(state).installPersistedActiveCapability(input);
  return result.ok ? { kind: 'commit', value: result } : { kind: 'reject', value: result };
}

function recoveryService(
  state: RouterAbEd25519YaoProductRegistrationStateV1,
): InMemoryRouterAbEd25519YaoRecoveryService {
  return new InMemoryRouterAbEd25519YaoRecoveryService(UNUSED_BACKEND, state.recovery);
}

function commitInput(
  lifecycleId: string,
  loaded: RouterAbEd25519YaoProductRegistrationPartitionedStateV1,
) {
  return {
    lifecycleId,
    state: loaded.state,
    baseline: loaded.baseline,
  };
}

async function rejectUnusedBackend(): Promise<never> {
  throw new Error('Request-scoped product runtime invoked an unavailable protocol backend');
}

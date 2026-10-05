import {
  parseRouterAbEd25519YaoRecoveryActivationResultV1,
  type RouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import {
  InMemoryRouterAbEd25519YaoRecoveryService,
  InMemoryRouterAbEd25519YaoRecoveryStateV1,
} from '../../../packages/wallet-server/src/router/domains/ed25519Yao/recovery/routerAbEd25519YaoRecovery';
import { buildNearRecoveryAdmissionFixture } from './nearRegistration.fixtures';

function unexpectedBackendCall(): never {
  throw new Error('Capability cache fixture must not execute recovery');
}

function clientPackage(deriver: 'deriver_a' | 'deriver_b') {
  return {
    kind: 'activation_client',
    deriver,
    session: new Array(32).fill(1),
    transcript: new Array(32).fill(1),
    encapsulated_key: new Array(32).fill(1),
    ciphertext: new Array(16).fill(1),
  };
}

export function buildNearRecoveryCacheFixture(
  registration: RouterAbEd25519YaoRegistrationAdmissionRequestV1,
  kind: 'active' | 'suspended',
) {
  const request = buildNearRecoveryAdmissionFixture(registration);
  const scope = request.scope;
  const result = parseRouterAbEd25519YaoRecoveryActivationResultV1({
    binding: {
      lifecycle: {
        lifecycle_id: scope.lifecycle_id,
        work_kind: 'recovery',
        primitive_request_kind: 'recovery',
        root_share_epoch: scope.root_share_epoch,
        account_id: scope.account_id,
        session_id: scope.threshold_session_id,
        signer_set_id: scope.signer_set_id,
        selected_server_id: scope.signing_worker_id,
      },
      operation: 'recovery',
      session_id: new Array(32).fill(1),
      stable_key_context_binding: new Array(32).fill(1),
      material_activation: scope.material_activation,
    },
    deriver_a_client_package: clientPackage('deriver_a'),
    deriver_b_client_package: clientPackage('deriver_b'),
    public_receipt: {
      transcript: new Array(32).fill(1),
      registered_public_key: request.registered_public_key,
      joined_client_commitment: new Array(32).fill(1),
      joined_signing_worker_commitment: new Array(32).fill(1),
      signing_worker_verifying_share: new Array(32).fill(1),
      state_epoch: 2,
      material_activation: scope.material_activation,
    },
  });
  if (!result.ok) throw new Error(result.message);
  const state = new InMemoryRouterAbEd25519YaoRecoveryStateV1();
  const service = new InMemoryRouterAbEd25519YaoRecoveryService(
    {
      admitRecovery: unexpectedBackendCall,
      resolveRecoveryDispatchRoot: unexpectedBackendCall,
      executeRecovery: unexpectedBackendCall,
      activateRecovery: unexpectedBackendCall,
    },
    state,
  );
  const installed = service.installPersistedActiveCapability({
    version: 'wallet_ed25519_yao_recovery_capability_v1',
    activeCapabilityBinding: request.replacement_capability_binding,
    nearAccountId: request.scope.account_id,
    admissionRequest: request,
    activationResult: result.value,
    runtimePolicyScope: {
      orgId: 'organization',
      projectId: 'project',
      envId: 'dev',
      signingRootVersion: 'v1',
    },
  });
  if (!installed.ok) throw new Error(installed.message);
  if (kind === 'suspended') {
    for (const [key, capability] of state.capabilities) {
      state.capabilities.set(key, {
        kind: 'suspended',
        identity: capability.identity,
        recoveryKey: JSON.stringify(request),
      });
    }
  }
  return state;
}

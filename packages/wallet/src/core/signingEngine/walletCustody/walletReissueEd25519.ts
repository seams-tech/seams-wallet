import {
  ROUTER_AB_ED25519_YAO_REISSUE_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_REISSUE_EXECUTE_PATH_V1,
  parseRouterAbEd25519YaoReissueActivationAdmissionReceiptV1,
  parseRouterAbEd25519YaoReissueActivationExecuteRequestV1,
  parseRouterAbEd25519YaoReissueActivationResultV1,
  parseRouterAbEd25519YaoReissueAdmissionRequestV1,
  sameRouterAbEd25519YaoByteSequence,
  type RouterAbEd25519YaoActivationAdmissionReceiptV1,
  type RouterAbEd25519YaoApplicationBindingFactsV1,
  type RouterAbEd25519YaoReissueAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import {
  routerAbMpcMaterialActivationRefToWire,
  sameRouterAbMpcMaterialActivationRef,
} from '@shared/utils/routerAbNormalSigningIdentity';
import type { MpcMaterialActivationRef } from '@shared/utils/domainIds';
import type { RouterAbEd25519YaoRecoveryTransportV1 } from '../threshold/ed25519/yaoClient';

/**
 * The wallet's active NEAR capability, as the server's unlock response names
 * it. A reissue reproduces the Client share of exactly this state.
 */
export type WalletSessionEd25519ReissueBasisV1 = {
  readonly materialActivation: MpcMaterialActivationRef;
  readonly registeredPublicKey: readonly number[];
  readonly signingWorkerVerifyingShare: readonly number[];
  readonly stateEpoch: number;
  readonly applicationBinding: RouterAbEd25519YaoApplicationBindingFactsV1;
  readonly participantIds: readonly [number, number];
  readonly lifecycle: {
    readonly lifecycleId: string;
    readonly rootShareEpoch: string;
    readonly accountId: string;
    readonly thresholdSessionId: string;
    readonly signerSetId: string;
    readonly signingWorkerId: string;
  };
};

function requireParsed<T>(
  parsed:
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string },
  label: string,
): T {
  if (!parsed.ok) throw new Error(`${label}: ${parsed.message}`);
  return parsed.value;
}

export function buildWalletReissueEd25519AdmissionRequestV1(
  basis: WalletSessionEd25519ReissueBasisV1,
): RouterAbEd25519YaoReissueAdmissionRequestV1 {
  return requireParsed(
    parseRouterAbEd25519YaoReissueAdmissionRequestV1({
      scope: {
        lifecycle_id: basis.lifecycle.lifecycleId,
        root_share_epoch: basis.lifecycle.rootShareEpoch,
        account_id: basis.lifecycle.accountId,
        threshold_session_id: basis.lifecycle.thresholdSessionId,
        signer_set_id: basis.lifecycle.signerSetId,
        signing_worker_id: basis.lifecycle.signingWorkerId,
        material_activation: routerAbMpcMaterialActivationRefToWire(basis.materialActivation),
      },
      application_binding: basis.applicationBinding,
      participant_ids: basis.participantIds,
      registered_public_key: basis.registeredPublicKey,
    }),
    'wallet reissue Ed25519 admission request is invalid',
  );
}

export async function admitWalletReissueEd25519V1(input: {
  readonly request: RouterAbEd25519YaoReissueAdmissionRequestV1;
  readonly transport: RouterAbEd25519YaoRecoveryTransportV1;
}): Promise<RouterAbEd25519YaoActivationAdmissionReceiptV1<'reissue'>> {
  const response = await input.transport.send({
    kind: 'reissue_admit',
    path: ROUTER_AB_ED25519_YAO_REISSUE_ADMISSION_PATH_V1,
    body: input.request,
  });
  if (!response.ok) {
    throw new Error(`Router Ed25519 reissue admission failed: ${response.message}`);
  }
  const receipt = requireParsed(
    parseRouterAbEd25519YaoReissueActivationAdmissionReceiptV1(response.value),
    'Router Ed25519 reissue admission is invalid',
  );
  if (
    receipt.binding.lifecycle.lifecycle_id !== input.request.scope.lifecycle_id ||
    !sameRouterAbMpcMaterialActivationRef(
      receipt.binding.material_activation,
      input.request.scope.material_activation,
    )
  ) {
    throw new Error('Router Ed25519 reissue admission changed the active material');
  }
  return receipt;
}

/**
 * Runs the reissue round. The result must name the server's current state:
 * the same key, material activation, epoch and SigningWorker verifying share.
 */
export async function executeWalletReissueEd25519RoundV1(input: {
  readonly executeRequestJson: string;
  readonly basis: WalletSessionEd25519ReissueBasisV1;
  readonly transport: RouterAbEd25519YaoRecoveryTransportV1;
}): Promise<string> {
  const executeRequest = requireParsed(
    parseRouterAbEd25519YaoReissueActivationExecuteRequestV1(JSON.parse(input.executeRequestJson)),
    'wallet reissue Ed25519 execute request is invalid',
  );
  const response = await input.transport.send({
    kind: 'reissue_execute',
    path: ROUTER_AB_ED25519_YAO_REISSUE_EXECUTE_PATH_V1,
    body: executeRequest,
  });
  if (!response.ok) {
    throw new Error(`Router Ed25519 reissue execute failed: ${response.message}`);
  }
  const result = requireParsed(
    parseRouterAbEd25519YaoReissueActivationResultV1(response.value),
    'Router Ed25519 reissue result is invalid',
  );
  const receipt = result.public_receipt;
  if (
    receipt.state_epoch !== input.basis.stateEpoch ||
    !sameRouterAbEd25519YaoByteSequence(
      receipt.registered_public_key,
      input.basis.registeredPublicKey,
    ) ||
    !sameRouterAbEd25519YaoByteSequence(
      receipt.signing_worker_verifying_share,
      input.basis.signingWorkerVerifyingShare,
    ) ||
    !sameRouterAbMpcMaterialActivationRef(
      receipt.material_activation,
      routerAbMpcMaterialActivationRefToWire(input.basis.materialActivation),
    )
  ) {
    throw new Error('Router Ed25519 reissue result differs from the active capability');
  }
  return JSON.stringify(result);
}

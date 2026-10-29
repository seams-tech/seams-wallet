import type { SigningOperationId } from '@/core/signingEngine/session/operationState/types';
import type { ThresholdEd25519KeyMaterial } from '@/core/accountData/near/nearAccountData.types';
import { IndexedDBManager } from '@/core/indexedDB';
import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type {
  NearEd25519YaoPreparedMaterialBoundary,
  NearPasskeyEd25519OperationStepUpCapabilityPreparation,
} from '@/core/signingEngine/interfaces/near';
import type {
  NearEd25519MaterialIdentity,
  NearSigningApiDeps,
} from '@/core/signingEngine/interfaces/operationDeps';
import { resolveWalletAuthorityOperation } from '@/core/signingEngine/session/authority';
import type {
  AvailableSigningLanes,
  ConcreteAvailableEd25519SigningLane,
} from '@/core/signingEngine/session/availability/availableSigningLanes';
import { buildExactPasskeyOwnerLaneScope } from '@/core/signingEngine/session/identity/ownerLaneScope';
import { buildAuthorizationRequiredNearEd25519YaoSigningPreparation } from '@/core/signingEngine/session/material/nearEd25519YaoSigningPreparation';
import type {
  Ed25519YaoPublicCapabilityLaneReferenceV1,
  Ed25519YaoPublicCapabilityReferenceStorePort,
} from '@/core/signingEngine/threshold/ed25519/yaoPublicCapabilityReferences';
import type { AccountId } from '@/core/types/accountIds';
import { buildThresholdEd25519Participants2pV1 } from '@shared/threshold/participants';
import { base58Encode } from '@shared/utils/base58';
import { base64UrlDecode } from '@shared/utils/base64';
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import { NEAR_ED25519_YAO_KEY_VERSION_V1 } from '@shared/utils/registrationSignerPlan';
import { parseSignerSlot } from '@shared/utils/signerSlot';
import {
  assertPasskeyEd25519MaterialAccess,
  nearEd25519MaterialIdentityFromBoundaryInput,
  preparePasskeyEd25519OperationMaterial,
  rehydratePreparedPasskeyEd25519YaoOperationStepUp,
  type PasskeyEd25519MaterialAccess,
} from './nearPasskeyOperationMaterial';

type OwnerOperationAccess = Extract<PasskeyEd25519MaterialAccess, { kind: 'owner_operation' }>;
type OwnerOperationLane = Ed25519YaoPublicCapabilityLaneReferenceV1 & { auth: { kind: 'passkey' } };
type OwnerOperationMaterial = Awaited<ReturnType<typeof preparePasskeyEd25519OperationMaterial>>;
type OwnerOperationInput = {
  readonly operationId: SigningOperationId;
  readonly walletId: WalletId;
  readonly nearAccountId: AccountId;
  readonly relayerUrl: string;
  readonly assertCurrent: () => void;
};

/** This projection contains durable material and fresh owner proof. It has no reusable authority. */
export async function createNearOwnerOperationDeps(
  base: NearSigningApiDeps,
  lanes: Pick<Ed25519YaoPublicCapabilityReferenceStorePort, 'listLanes'>,
  input: OwnerOperationInput,
): Promise<NearSigningApiDeps> {
  input.assertCurrent();
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(String(input.walletId));
  if (
    selected.kind !== 'resolved' ||
    selected.authMethod.kind !== 'passkey' ||
    selected.authMethod.status !== 'active' ||
    selected.authority.state !== 'active' ||
    selected.authMethod.walletId !== input.walletId ||
    selected.authority.walletId !== input.walletId ||
    selected.authMethod.walletAuthorityId !== selected.authority.authorityId
  ) {
    throw new Error(
      'Enroll a wallet-origin owner passkey on this device before approving a transaction.',
    );
  }
  const access: OwnerOperationAccess = {
    kind: 'owner_operation',
    authMethod: selected.authMethod,
    authority: selected.authority,
    assertCurrent: input.assertCurrent,
  };
  const matches: OwnerOperationLane[] = [];
  for (const lane of await lanes.listLanes()) {
    if (
      lane.walletId === input.walletId &&
      lane.nearAccountId === input.nearAccountId &&
      lane.auth.kind === 'passkey' &&
      String(lane.auth.rpId) === String(selected.authMethod.rpId) &&
      lane.auth.credentialIdB64u === selected.authMethod.credentialIdB64u &&
      selected.authority.signerActivations.ed25519 !== undefined &&
      mpcMaterialActivationRefsEqual(
        lane.materialActivation,
        selected.authority.signerActivations.ed25519.materialActivation,
      )
    ) {
      matches.push({
        walletId: lane.walletId,
        nearAccountId: lane.nearAccountId,
        nearEd25519SigningKeyId: lane.nearEd25519SigningKeyId,
        signerSlot: lane.signerSlot,
        thresholdSessionId: lane.thresholdSessionId,
        runtimePolicyScope: lane.runtimePolicyScope,
        materialActivation: lane.materialActivation,
        auth: lane.auth,
      });
    }
  }
  const [lane] = matches;
  if (matches.length !== 1 || !lane)
    throw new Error('The wallet has no exact owner signing material on this device.');
  const scope = new NearOwnerOperation(input, access, lane, base.getSignerWorkerContext);
  return {
    nearRpcUrl: base.nearRpcUrl,
    touchConfirm: base.touchConfirm,
    resolveOwnerLaneScope: scope.resolveOwnerLaneScope.bind(scope),
    prepareNearEd25519YaoMaterialBoundary: scope.prepareMaterial.bind(scope),
    signingSessionCoordinator: base.signingSessionCoordinator,
    readAvailableSigningLanesForSigning: scope.readLanes.bind(scope),
    createSigningSessionId: ownerOperationId.bind(
      null,
      input.operationId,
      base.createSigningSessionId,
    ),
    getSignerWorkerContext: scope.workerContext.bind(scope),
    withThresholdEd25519CommitQueue: base.withThresholdEd25519CommitQueue,
  };
}

function ownerOperationId(
  operationId: SigningOperationId,
  generate: (prefix: string) => string,
  prefix: string,
): string {
  return prefix === 'near-transaction-sign' ? operationId : generate(prefix);
}

class NearOwnerOperation {
  constructor(
    private readonly input: OwnerOperationInput,
    private readonly access: OwnerOperationAccess,
    private readonly lane: OwnerOperationLane,
    private readonly getContext: NearSigningApiDeps['getSignerWorkerContext'],
  ) {}

  workerContext(): ReturnType<NearSigningApiDeps['getSignerWorkerContext']> {
    return {
      ...this.getContext(),
      resolveOperationStepUpCredential: this.ownerCredential.bind(this),
    };
  }

  async ownerCredential(
    args: Parameters<
      ReturnType<NearSigningApiDeps['getSignerWorkerContext']>['resolveOperationStepUpCredential']
    >[0],
  ): Promise<{ kind: 'operation_step_up' }> {
    await this.assertCurrent();
    const proof = args.proof;
    if (
      args.walletId !== this.input.walletId ||
      proof.kind !== 'passkey' ||
      proof.authority.bindingId !== this.access.authMethod.walletAuthMethodId ||
      proof.authority.factor.credentialIdB64u !== this.access.authMethod.credentialIdB64u ||
      String(proof.authority.verifier.rpId) !== String(this.access.authMethod.rpId)
    )
      throw new Error('The operation owner proof changed.');
    return { kind: 'operation_step_up' };
  }

  async resolveOwnerLaneScope(walletId: WalletId) {
    if (walletId !== this.input.walletId) throw new Error('The approval wallet changed.');
    await this.assertCurrent();
    const signerSlot = parseSignerSlot(this.lane.signerSlot, { min: 1 });
    if (signerSlot === null) throw new Error('The owner signer slot is invalid.');
    return buildExactPasskeyOwnerLaneScope({ authMethod: this.access.authMethod, signerSlot });
  }

  async assertCurrent(): Promise<void> {
    this.input.assertCurrent();
    const selected = await IndexedDBManager.resolveSelectedWalletAuthority(
      String(this.input.walletId),
    );
    if (selected.kind !== 'resolved') throw new Error('The selected wallet owner changed.');
    assertPasskeyEd25519MaterialAccess(this.access, selected);
  }

  async readLanes(
    args: Parameters<NearSigningApiDeps['readAvailableSigningLanesForSigning']>[0],
  ): Promise<AvailableSigningLanes> {
    await this.resolveOwnerLaneScope(this.input.walletId);
    if (String(args.walletId) !== String(this.input.walletId))
      throw new Error('The approval wallet changed.');
    const lane: ConcreteAvailableEd25519SigningLane = {
      auth: this.lane.auth,
      curve: 'ed25519',
      chain: 'near',
      materialActivation: this.lane.materialActivation,
      walletId: this.lane.walletId,
      nearAccountId: this.lane.nearAccountId,
      nearEd25519SigningKeyId: this.lane.nearEd25519SigningKeyId,
      signerSlot: this.lane.signerSlot,
      thresholdSessionId: this.lane.thresholdSessionId,
      source: 'public_capability_reference',
      state: 'deferred',
      authorizationState: 'authorization_required',
    };
    return {
      walletId: this.input.walletId,
      generation: this.access.authority.updatedAtMs,
      ecdsa: { targets: [], lanesByTarget: {}, candidatesByTarget: {} },
      lanes: { ed25519: { near: lane } },
      candidates: { ed25519: { near: [lane] } },
    };
  }

  async prepareMaterial(
    input: Parameters<NearSigningApiDeps['prepareNearEd25519YaoMaterialBoundary']>[0],
  ): Promise<NearEd25519YaoPreparedMaterialBoundary> {
    await this.assertCurrent();
    const identity = nearEd25519MaterialIdentityFromBoundaryInput(input);
    this.assertIdentity(identity);
    const material = await preparePasskeyEd25519OperationMaterial({
      walletId: this.input.walletId,
      identity,
      relayerUrl: this.input.relayerUrl,
      access: this.access,
    });
    const preparation = buildAuthorizationRequiredNearEd25519YaoSigningPreparation({
      hydration: material.prepared.plan,
      requirement: this.lane.auth,
    });
    return {
      preparation,
      executor: {
        resolveSigningKeyMaterial: this.resolveKeyMaterial.bind(this, material),
        preparePasskeyOperationStepUp: this.prepareStepUp.bind(this, input, material),
        resolve: rejectReusableAuthority,
        resolveWalletSessionState: rejectReusableAuthority,
        resolveFundingSession: rejectReusableAuthority,
        prepareEmailOtpOperationStepUp: rejectReusableAuthority,
      },
    };
  }

  assertIdentity(identity: NearEd25519MaterialIdentity): void {
    const signer = identity.signer;
    if (
      signer.account.wallet.walletId !== this.lane.walletId ||
      signer.account.nearAccountId !== this.lane.nearAccountId ||
      signer.nearEd25519SigningKeyId !== this.lane.nearEd25519SigningKeyId ||
      signer.signerSlot !== this.lane.signerSlot ||
      String(identity.thresholdSessionId) !== String(this.lane.thresholdSessionId) ||
      identity.auth.kind !== 'passkey' ||
      identity.auth.rpId !== this.lane.auth.rpId ||
      identity.auth.credentialIdB64u !== this.lane.auth.credentialIdB64u
    )
      throw new Error('The approved signing identity changed.');
  }

  async resolveKeyMaterial(material: OwnerOperationMaterial): Promise<ThresholdEd25519KeyMaterial> {
    await this.assertCurrent();
    const operation = await resolveWalletAuthorityOperation({
      selected: { authMethod: this.access.authMethod, authority: this.access.authority },
      operation: { kind: 'near_sign', operation: 'sign', keyFamily: 'ed25519' },
    });
    if (
      operation.kind !== 'resolved' ||
      operation.value.keyFamily !== 'ed25519' ||
      !mpcMaterialActivationRefsEqual(
        operation.value.materialActivation,
        this.lane.materialActivation,
      )
    ) {
      throw new Error('The owner cannot approve this signing material.');
    }
    const [clientParticipantId, relayerParticipantId] = material.participantIds;
    if (clientParticipantId === undefined || relayerParticipantId === undefined)
      throw new Error('The signing participants are invalid.');
    return {
      nearAccountId: this.input.nearAccountId,
      signerSlot: this.lane.signerSlot,
      kind: 'threshold_ed25519_v1',
      publicKey: `ed25519:${base58Encode(base64UrlDecode(operation.value.registeredPublicKeyB64u))}`,
      relayerKeyId: material.facts.routerAbNormalSigning.signingWorkerId,
      keyVersion: NEAR_ED25519_YAO_KEY_VERSION_V1,
      participants: buildThresholdEd25519Participants2pV1({
        clientParticipantId,
        relayerParticipantId,
        relayerKeyId: material.facts.routerAbNormalSigning.signingWorkerId,
        clientShareDerivation: 'prf_first_v1',
      }),
      timestamp: this.access.authority.activatedAtMs,
    };
  }

  async prepareStepUp(
    input: Parameters<NearSigningApiDeps['prepareNearEd25519YaoMaterialBoundary']>[0],
    material: OwnerOperationMaterial,
  ): Promise<NearPasskeyEd25519OperationStepUpCapabilityPreparation> {
    await this.assertCurrent();
    return {
      materialActivation: material.prepared.plan.materialActivation,
      facts: material.facts,
      participantIds: material.participantIds,
      rehydrate: rehydratePreparedPasskeyEd25519YaoOperationStepUp.bind(null, {
        input,
        access: this.access,
        identity: material.localIdentity,
        facts: material.facts,
        authority: material.authority,
        rpId: this.lane.auth.rpId,
        credentialIdB64u: this.lane.auth.credentialIdB64u,
        publicLocator: material.publicLocator,
        materialActivation: material.prepared.plan.materialActivation,
      }),
    };
  }
}

async function rejectReusableAuthority(): Promise<never> {
  throw new Error('A fresh owner operation cannot use reusable signing authority.');
}

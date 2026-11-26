import type {
  RouterAbEd25519YaoApplicationBindingFactsV1,
  RouterAbEd25519YaoActivationAdmissionReceiptV1,
} from '@shared/utils/routerAbEd25519Yao';
import {
  executeWorkerOperation,
  type WorkerOperationContext,
} from '../../workerManager/executeWorkerOperation';
import type { UnlockedEd25519ExportRootLinkingCapabilityV1 } from '../../workerManager/workerTypes';

function requestJson(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Yao lane request JSON is required');
  }
  return value;
}

type Ed25519YaoLaneWorkerSourceV1 = {
  readonly sourceHandle: string;
  discard(): Promise<void>;
  prepareSourcePreservingRegistration(input: {
    readonly targetAdmission: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;
    readonly applicationBinding: RouterAbEd25519YaoApplicationBindingFactsV1;
    readonly participantIds: readonly [number, number];
    readonly expectedRegisteredPublicKeyB64u: string;
    readonly targetClientRecipientPublicKeyB64u: string;
  }): Promise<{ readonly requestJson: string }>;
};

export async function openEd25519YaoLaneWorkerSourceFromUnlockedCapabilityV1(args: {
  readonly workerCtx: WorkerOperationContext;
  readonly capability: UnlockedEd25519ExportRootLinkingCapabilityV1;
  readonly applicationBindingDigestB64u: string;
  readonly walletKeyId: string;
  readonly enrollmentId: string;
  readonly revocationEpoch: number;
  readonly registeredPublicKeyB64u: string;
}): Promise<Ed25519YaoLaneWorkerSourceV1> {
  const opened = await executeWorkerOperation({
    ctx: args.workerCtx,
    kind: 'walletCustodyCeremony',
    request: {
      type: 'openEd25519YaoLaneSource',
      payload: {
        kind: 'unlocked_ed25519_export_root_capability',
        capability: args.capability,
        applicationBindingDigestB64u: args.applicationBindingDigestB64u,
        walletKeyId: args.walletKeyId,
        enrollmentId: args.enrollmentId,
        revocationEpoch: args.revocationEpoch,
        registeredPublicKeyB64u: args.registeredPublicKeyB64u,
      },
    },
  });
  return new Ed25519YaoLaneWorkerSource(args.workerCtx, opened.sourceHandle);
}

class Ed25519YaoLaneWorkerSource implements Ed25519YaoLaneWorkerSourceV1 {
  #discarded = false;

  constructor(
    private readonly workerCtx: WorkerOperationContext,
    readonly sourceHandle: string,
  ) {}

  async discard(): Promise<void> {
    if (this.#discarded) return;
    this.#discarded = true;
    await executeWorkerOperation({
      ctx: this.workerCtx,
      kind: 'walletCustodyCeremony',
      request: {
        type: 'discardEd25519YaoLaneSource',
        payload: { sourceHandle: this.sourceHandle },
      },
    });
  }

  async prepareSourcePreservingRegistration(input: {
    readonly targetAdmission: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;
    readonly applicationBinding: RouterAbEd25519YaoApplicationBindingFactsV1;
    readonly participantIds: readonly [number, number];
    readonly expectedRegisteredPublicKeyB64u: string;
    readonly targetClientRecipientPublicKeyB64u: string;
  }): Promise<{ readonly requestJson: string }> {
    if (this.#discarded) {
      throw new Error('Ed25519 Yao lane source is already consumed');
    }
    this.#discarded = true;
    const result = await executeWorkerOperation({
      ctx: this.workerCtx,
      kind: 'walletCustodyCeremony',
      request: {
        type: 'prepareEd25519YaoSourcePreservingRegistration',
        payload: {
          sourceHandle: this.sourceHandle,
          targetAdmission: input.targetAdmission,
          applicationBinding: input.applicationBinding,
          participantIds: input.participantIds,
          expectedRegisteredPublicKeyB64u: input.expectedRegisteredPublicKeyB64u,
          targetClientRecipientPublicKeyB64u: input.targetClientRecipientPublicKeyB64u,
        },
      },
    });
    return { requestJson: requestJson(result.requestJson) };
  }
}

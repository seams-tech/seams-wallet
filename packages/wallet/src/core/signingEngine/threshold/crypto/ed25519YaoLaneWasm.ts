import type { Ed25519YaoLaneJobV1 } from '@shared/signing-lanes/rotation';
import { computeEd25519YaoLaneSessionDigestV1 } from '@shared/signing-lanes/rotationDigests';
import type {
  RouterAbEd25519YaoApplicationBindingFactsV1,
  RouterAbEd25519YaoCeremonyBindingV1,
  RouterAbEd25519YaoActivationAdmissionReceiptV1,
} from '@shared/utils/routerAbEd25519Yao';
import {
  deriveRouterAbEd25519YaoApplicationBindingDigestV1,
  deriveRouterAbEd25519YaoStableContextBindingV1,
} from '@shared/utils/routerAbEd25519Yao';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import {
  routerAbMpcMaterialActivationRefToWire,
  sameRouterAbMpcMaterialActivationRef,
} from '@shared/utils/routerAbNormalSigningIdentity';
import {
  executeWorkerOperation,
  type WorkerOperationContext,
} from '../../workerManager/executeWorkerOperation';
import type { UnlockedEd25519ExportRootLinkingCapabilityV1 } from '../../workerManager/workerTypes';

/**
 * Checks every public binding used by the Rust lane client before crossing the
 * worker boundary. The Rust check remains authoritative; this gives callers a
 * precise boundary error when a stale local identity or ceremony response is
 * selected, instead of collapsing it into the WASM binding error.
 */
export async function assertEd25519YaoLaneCeremonyBindingParityV1(input: {
  readonly job: Ed25519YaoLaneJobV1;
  readonly ceremonyBinding: RouterAbEd25519YaoCeremonyBindingV1;
  readonly applicationBinding: RouterAbEd25519YaoApplicationBindingFactsV1;
  readonly participantIds: readonly [number, number];
  readonly applicationBindingDigestB64u?: string;
}): Promise<void> {
  const expectedApplicationDigestB64u = base64UrlEncode(
    Uint8Array.from(
      await deriveRouterAbEd25519YaoApplicationBindingDigestV1(input.applicationBinding),
    ),
  );
  if (
    input.applicationBindingDigestB64u !== undefined &&
    input.applicationBindingDigestB64u !== expectedApplicationDigestB64u
  ) {
    throw new Error(
      `Ed25519 Yao lane application binding digest mismatch: expected ${expectedApplicationDigestB64u}, received ${input.applicationBindingDigestB64u}`,
    );
  }

  const expectedStableContextBindingB64u = base64UrlEncode(
    Uint8Array.from(
      await deriveRouterAbEd25519YaoStableContextBindingV1(
        input.applicationBinding,
        input.participantIds,
      ),
    ),
  );
  if (input.job.stableContextBindingB64u !== expectedStableContextBindingB64u) {
    throw new Error(
      `Ed25519 Yao lane job stable context binding mismatch: expected ${expectedStableContextBindingB64u}, received ${input.job.stableContextBindingB64u}`,
    );
  }
  const ceremonyStableContextBindingB64u = base64UrlEncode(
    Uint8Array.from(input.ceremonyBinding.stable_key_context_binding),
  );
  if (ceremonyStableContextBindingB64u !== expectedStableContextBindingB64u) {
    throw new Error(
      `Ed25519 Yao lane ceremony stable context binding mismatch: expected ${expectedStableContextBindingB64u}, received ${ceremonyStableContextBindingB64u}`,
    );
  }

  if (input.ceremonyBinding.operation !== input.job.yaoRequestKind) {
    throw new Error(
      `Ed25519 Yao lane ceremony operation mismatch: expected ${input.job.yaoRequestKind}, received ${input.ceremonyBinding.operation}`,
    );
  }
  const expectedSessionDigestB64u = await computeEd25519YaoLaneSessionDigestV1(input.job);
  const ceremonySessionDigestB64u = base64UrlEncode(
    Uint8Array.from(input.ceremonyBinding.session_id),
  );
  if (ceremonySessionDigestB64u !== expectedSessionDigestB64u) {
    throw new Error(
      `Ed25519 Yao lane ceremony session mismatch: expected ${expectedSessionDigestB64u}, received ${ceremonySessionDigestB64u}`,
    );
  }

  if (
    !sameRouterAbMpcMaterialActivationRef(
      routerAbMpcMaterialActivationRefToWire(input.job.source.materialActivation),
      input.ceremonyBinding.material_activation,
    )
  ) {
    throw new Error('Ed25519 Yao lane ceremony material activation mismatch');
  }

  assertCanonicalRecipientKeyV1(
    input.job.targetHolder.hpkePublicKeyB64u,
    'target holder HPKE public key',
  );
  assertCanonicalRecipientKeyV1(
    input.job.targetSigningWorker.hpkePublicKeyB64u,
    'target SigningWorker HPKE public key',
  );
}

function assertCanonicalRecipientKeyV1(value: string, label: string): void {
  let decoded: Uint8Array;
  try {
    decoded = base64UrlDecode(value);
  } catch {
    throw new Error(`Ed25519 Yao lane ${label} is not valid unpadded base64url`);
  }
  if (decoded.length !== 32 || base64UrlEncode(decoded) !== value) {
    throw new Error(`Ed25519 Yao lane ${label} must be a canonical 32-byte value`);
  }
}

function requestJson(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Yao lane request JSON is required');
  }
  return value;
}

export type Ed25519YaoLaneWorkerSourceV1 = {
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

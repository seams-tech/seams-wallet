import type {
  LaneHolderDeliveryReceiptV1,
  LaneHolderRecipientHandleV1,
  LaneHolderRecipientWorkerV1,
} from '@shared/signing-lanes/rotation';
import {
  parseHpkePublicKeyB64u,
  parseSigningWorkerRecipientKeyDigestB64u,
  type HpkePublicKeyB64u,
  type SigningWorkerRecipientKeyDigestB64u,
} from '@shared/signing-lanes/participants';
import { computeLaneHolderParticipantBindingDigestV1 } from '@shared/signing-lanes/participantDigest';
import { parseLaneHolderRecipientHandleV1 } from '@shared/utils/domainIds';
import type {
  LaneEnrollmentId,
  LaneOperationId,
  LaneShareEpoch,
  SigningLaneId,
} from '@shared/signing-lanes/ids';
import type { MpcMaterialActivationId, WalletId, WalletKeyId } from '@shared/utils/domainIds';
import type {
  LaneHolderCustodyBindingId,
  LaneParticipantBindingDigestB64u,
} from '@shared/signing-lanes/participants';

type LaneHolderRecipientCreationInputV1 = Parameters<
  LaneHolderRecipientWorkerV1['createLaneHolderRecipientV1']
>[0];

export type OpenLaneHolderRecipientV1 = {
  readonly state: 'open';
  readonly operationId: LaneOperationId;
  readonly enrollmentId: LaneEnrollmentId;
  readonly walletKeyId: WalletKeyId;
  readonly targetLaneId: SigningLaneId;
  readonly targetLaneShareEpoch: LaneShareEpoch;
  readonly targetMaterialActivationId: MpcMaterialActivationId;
  readonly holderParticipantBindingDigestB64u: LaneParticipantBindingDigestB64u;
  readonly custodyBindingId: LaneHolderCustodyBindingId;
  readonly custodyBindingDigestB64u: string;
  readonly recipientHandle: LaneHolderRecipientHandleV1;
  readonly hpkePublicKeyB64u: string;
  readonly hpkePublicKeyDigestB64u: string;
};

export type SealedLaneHolderRecipientV1 = {
  readonly state: 'sealed';
  readonly operationId: LaneOperationId;
  readonly enrollmentId: LaneEnrollmentId;
  readonly walletId: WalletId;
  readonly walletKeyId: WalletKeyId;
  readonly targetLaneId: SigningLaneId;
  readonly targetLaneShareEpoch: LaneShareEpoch;
  readonly targetMaterialActivationId: MpcMaterialActivationId;
  readonly holderParticipantBindingDigestB64u: string;
  readonly custodyBindingId: LaneHolderCustodyBindingId;
  readonly holderRecipientKeyDigestB64u: string;
  readonly holderCiphertextDigestSetB64u: string;
  readonly sealedHolderRecordDigestB64u: string;
  readonly transcriptHashB64u: string;
  readonly sealedHolderMaterialB64u: string;
  readonly acknowledgedAtMs: number;
  readonly holderDeliveryReceipt: LaneHolderDeliveryReceiptV1;
};

export type DiscardedLaneHolderRecipientV1 = {
  readonly state: 'discarded';
  readonly operationId: LaneOperationId;
  readonly enrollmentId: LaneEnrollmentId;
};

function parseHandle(value: unknown): LaneHolderRecipientHandleV1 {
  const result = parseLaneHolderRecipientHandleV1(value);
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

function parseHpkePublicKey(value: unknown): HpkePublicKeyB64u {
  const result = parseHpkePublicKeyB64u(value);
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

function parseRecipientKeyDigest(value: unknown): SigningWorkerRecipientKeyDigestB64u {
  const result = parseSigningWorkerRecipientKeyDigestB64u(value);
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

async function prepareLaneHolderRecipientV1(args: {
  readonly input: LaneHolderRecipientCreationInputV1;
  readonly worker: LaneHolderRecipientWorkerV1;
}): Promise<OpenLaneHolderRecipientV1> {
  const descriptor = await args.worker.createLaneHolderRecipientV1(args.input);
  const recipientHandle = parseHandle(descriptor.recipientHandle);
  try {
    const hpkePublicKeyB64u = parseHpkePublicKey(descriptor.hpkePublicKeyB64u);
    const hpkePublicKeyDigestB64u = parseRecipientKeyDigest(descriptor.hpkePublicKeyDigestB64u);
    const holderParticipantBindingDigestB64u = await computeLaneHolderParticipantBindingDigestV1({
      participantId: args.input.targetHolderParticipantId,
      custody: {
        kind: 'lane_holder_custody_identity_v1',
        custodyBindingId: args.input.custodyBindingId,
        custodyBindingDigestB64u: args.input.custodyBindingDigestB64u,
      },
      hpkePublicKeyB64u,
      hpkePublicKeyDigestB64u,
    });
    return {
      state: 'open',
      operationId: args.input.operationId,
      enrollmentId: args.input.enrollmentId,
      walletKeyId: args.input.walletKeyId,
      targetLaneId: args.input.targetLaneId,
      targetLaneShareEpoch: args.input.targetLaneShareEpoch,
      targetMaterialActivationId: args.input.targetMaterialActivationId,
      holderParticipantBindingDigestB64u,
      custodyBindingId: args.input.custodyBindingId,
      custodyBindingDigestB64u: args.input.custodyBindingDigestB64u,
      recipientHandle,
      hpkePublicKeyB64u,
      hpkePublicKeyDigestB64u,
    };
  } catch (error) {
    await args.worker
      .discardLaneHolderRecipientV1({
        recipientHandle,
        operationId: args.input.operationId,
      })
      .catch(() => undefined);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export const createLaneHolderRecipientV1 = prepareLaneHolderRecipientV1;

export async function discardLaneHolderRecipientV1(args: {
  readonly state: OpenLaneHolderRecipientV1;
  readonly worker: LaneHolderRecipientWorkerV1;
}): Promise<DiscardedLaneHolderRecipientV1> {
  await args.worker.discardLaneHolderRecipientV1({
    recipientHandle: args.state.recipientHandle,
    operationId: args.state.operationId,
  });
  return {
    state: 'discarded',
    operationId: args.state.operationId,
    enrollmentId: args.state.enrollmentId,
  };
}

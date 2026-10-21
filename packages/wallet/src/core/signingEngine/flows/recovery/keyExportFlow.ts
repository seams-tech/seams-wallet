import {
  createKeyExportFlowEvent,
  KeyExportEventPhase,
  type CreateKeyExportFlowEventInput,
  type KeyExportFlowEvent,
} from '@/core/types/sdkSentEvents';
import { errorMessage, isUserCancellationError } from '@shared/utils/errors';
import { secureRandomId } from '@shared/utils/secureRandomId';
import {
  thresholdEcdsaChainTargetKey,
  type NearAccountRef,
  type ThresholdEcdsaChainTarget,
  type WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type {
  ExactEcdsaSigningLaneIdentity,
  ExactEd25519ExportMaterialIdentity,
} from '../../session/identity/exactSigningLaneIdentity';
import type { MpcMaterialActivationRef, WalletId } from '@shared/utils/domainIds';
import type { ExclusiveUnion } from '@shared/utils/variant';

export type KeyExportEventCallback = (event: KeyExportFlowEvent) => void;

export type KeyExportUiOptions = {
  variant?: 'drawer' | 'modal';
  theme?: 'dark' | 'light';
};

interface SigningEngineKeyExportUiOptions extends KeyExportUiOptions {
  onEvent?: KeyExportEventCallback;
}

export type SigningEngineExportKeypairWithUIInput = ExclusiveUnion<
  | {
      kind: 'ml_dsa_65';
      nearAccount: NearAccountRef;
      walletSession: WalletSessionRef;
      signer: import('@/core/types/seams').AddedMlDsaSignerCapability;
      options: SigningEngineKeyExportUiOptions;
    }
  | {
      kind: 'ecdsa';
      chainTarget: ThresholdEcdsaChainTarget;
      walletSession: WalletSessionRef;
      laneIdentity: ExactEcdsaSigningLaneIdentity;
      nearAccount?: never;
      options: SigningEngineKeyExportUiOptions;
    }
  | {
      kind: 'ed25519';
      nearAccount: NearAccountRef;
      walletSession: WalletSessionRef;
      laneIdentity: ExactEd25519ExportMaterialIdentity;
      materialActivation: MpcMaterialActivationRef;
      chainTarget?: never;
      options: SigningEngineKeyExportUiOptions;
    }
>;

export type SigningEngineResolveExactKeyExportLaneInput = ExclusiveUnion<
  | { kind: 'ecdsa'; chainTarget: ThresholdEcdsaChainTarget; walletSession: WalletSessionRef }
  | { kind: 'ed25519'; nearAccount: NearAccountRef; walletSession: WalletSessionRef }
>;

export type SigningEngineResolveExactKeyExportLaneResult =
  | {
      kind: 'ecdsa';
      laneIdentity: ExactEcdsaSigningLaneIdentity;
    }
  | {
      kind: 'ed25519';
      laneIdentity: ExactEd25519ExportMaterialIdentity;
      materialActivation: MpcMaterialActivationRef;
    };

type KeyExportFlowContext = {
  subject: string;
  chain: 'near' | ThresholdEcdsaChainTarget['kind'];
  data:
    | { curve: 'ed25519' | 'ml_dsa_65'; chain: 'near'; nearAccount: NearAccountRef }
    | {
        curve: 'ecdsa';
        chain: ThresholdEcdsaChainTarget['kind'];
        chainTarget: ThresholdEcdsaChainTarget;
      };
};

function keyExportFlowContext(input: SigningEngineExportKeypairWithUIInput): KeyExportFlowContext {
  switch (input.kind) {
    case 'ecdsa':
      return {
        subject: `${String(input.walletSession.walletId)}:${thresholdEcdsaChainTargetKey(input.chainTarget)}`,
        chain: input.chainTarget.kind,
        data: {
          curve: 'ecdsa',
          chain: input.chainTarget.kind,
          chainTarget: input.chainTarget,
        },
      };
    case 'ed25519':
    case 'ml_dsa_65':
      return {
        subject: `${String(input.walletSession.walletId)}:near:${String(input.nearAccount.accountId)}`,
        chain: 'near',
        data: { curve: input.kind, chain: 'near', nearAccount: input.nearAccount },
      };
  }
}

export function emitKeyExportEvent(
  onEvent: KeyExportEventCallback | undefined,
  input: CreateKeyExportFlowEventInput,
): void {
  if (!onEvent) return;
  try {
    onEvent(createKeyExportFlowEvent(input));
  } catch {}
}

export function createExportUiRequestId(prefix: string): string {
  return secureRandomId(prefix, 32, 'key export UI request IDs');
}

export function emitNearKeyExportViewerLifecycle(
  context: {
    readonly flowId: string;
    readonly walletId: WalletId;
    readonly curve: 'ed25519' | 'ml_dsa_65';
    readonly onEvent: KeyExportEventCallback | undefined;
  },
  event: 'opened' | 'closed',
): void {
  const accountId = String(context.walletId);
  emitKeyExportEvent(context.onEvent, {
    phase:
      event === 'opened'
        ? KeyExportEventPhase.STEP_04_VIEWER_OPENED
        : KeyExportEventPhase.STEP_05_VIEWER_CLOSED,
    status: event === 'opened' ? 'waiting_for_user' : 'succeeded',
    flowId: context.flowId,
    accountId,
    interaction: { kind: 'key_export_viewer', overlay: event === 'opened' ? 'show' : 'hide' },
    data: { chain: 'near', curve: context.curve },
  });
  if (event !== 'closed') return;
  emitKeyExportEvent(context.onEvent, {
    phase: KeyExportEventPhase.STEP_06_COMPLETED,
    status: 'succeeded',
    flowId: context.flowId,
    accountId,
    interaction: { kind: 'none', overlay: 'hide' },
    data: { chain: 'near', curve: context.curve },
  });
}

function createKeyExportFlowId(subjectId: string, chain: string): string {
  return `key-export:${subjectId}:${chain}:${createExportUiRequestId('flow')}`;
}

export async function runKeyExportWithFlowEvents<TResult>(
  input: SigningEngineExportKeypairWithUIInput,
  execute: (args: SigningEngineExportKeypairWithUIInput & { flowId: string }) => Promise<TResult>,
): Promise<TResult> {
  const context = keyExportFlowContext(input);
  const flowId = createKeyExportFlowId(context.subject, context.chain);
  const accountId = input.walletSession.walletId;
  const eventData = context.data;

  emitKeyExportEvent(input.options.onEvent, {
    phase: KeyExportEventPhase.STEP_01_STARTED,
    status: 'running',
    flowId,
    accountId: String(accountId),
    interaction: { kind: 'none', overlay: 'none' },
    data: eventData,
  });

  try {
    return await execute({ ...input, flowId });
  } catch (error: unknown) {
    const cancelled = isUserCancellationError(error);
    emitKeyExportEvent(input.options.onEvent, {
      phase: cancelled ? KeyExportEventPhase.CANCELLED : KeyExportEventPhase.FAILED,
      status: cancelled ? 'cancelled' : 'failed',
      flowId,
      accountId: String(accountId),
      interaction: { kind: 'none', overlay: 'hide' },
      error: {
        message: errorMessage(error) || (cancelled ? 'Key export cancelled' : 'Key export failed'),
      },
      data: eventData,
    });
    throw error;
  }
}

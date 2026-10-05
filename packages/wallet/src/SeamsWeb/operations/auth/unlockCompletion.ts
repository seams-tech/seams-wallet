import type {
  AfterCall,
  CreateUnlockFlowEventInput,
  LoginHooksOptions,
} from '@/core/types/sdkSentEvents';
import { createUnlockFlowEvent, UnlockEventPhase } from '@/core/types/sdkSentEvents';
import type { LoginAndCreateSessionResult, LoginResult, WalletAuthMethod } from '@/core/types/seams';
import type { LoginWebContext } from '@/SeamsWeb/signingSurface/types';
import { toError } from '@shared/utils/errors';

type EmitUnlockEventInput = Omit<CreateUnlockFlowEventInput, 'accountId' | 'flowId'>;

export function emitUnlockEvent(
  onEvent: LoginHooksOptions['onEvent'] | undefined,
  unlockSubjectId: string,
  event: EmitUnlockEventInput,
): void {
  onEvent?.(
    createUnlockFlowEvent({
      flowId: `unlock:${unlockSubjectId}`,
      accountId: unlockSubjectId,
      ...event,
    }),
  );
}

export async function finalizeLoginSuccess(args: {
  context: LoginWebContext;
  authMethod: WalletAuthMethod;
  unlockSubjectId: string;
  loginResult: LoginResult;
  onEvent?: LoginHooksOptions['onEvent'];
  afterCall?: AfterCall<LoginAndCreateSessionResult>;
}): Promise<LoginAndCreateSessionResult> {
  const { context, authMethod, unlockSubjectId, loginResult, onEvent, afterCall } = args;
  if (loginResult.success) {
    context.signingEngine.setWalletAuthenticated({
      kind: 'authenticated',
      walletId: loginResult.walletId,
      authMethod,
    });
  }
  emitUnlockEvent(onEvent, unlockSubjectId, {
    phase: UnlockEventPhase.STEP_07_COMPLETED,
    status: 'succeeded',
    data: {
      ...(loginResult.success && loginResult.kind === 'near_wallet_unlocked'
        ? { operationalPublicKey: loginResult.operationalPublicKey ?? '' }
        : { walletId: loginResult.success ? String(loginResult.walletId) : '' }),
    },
  });
  await afterCall?.(true, loginResult);
  return loginResult;
}

export async function finalizeLoginError(args: {
  unlockSubjectId: string;
  message: string;
  error?: unknown;
  onEvent?: LoginHooksOptions['onEvent'];
  onError?: (error: Error) => void;
  afterCall?: AfterCall<LoginAndCreateSessionResult>;
  callOnError?: boolean;
  callAfterCall?: boolean;
  cancelled?: boolean;
}): Promise<LoginAndCreateSessionResult> {
  const {
    message,
    unlockSubjectId,
    error,
    onEvent,
    onError,
    afterCall,
    callOnError = true,
    callAfterCall = true,
    cancelled = false,
  } = args;

  if (callOnError) {
    onError?.(toError(error));
  }

  emitUnlockEvent(onEvent, unlockSubjectId, {
    phase: cancelled ? UnlockEventPhase.CANCELLED : UnlockEventPhase.FAILED,
    status: cancelled ? 'cancelled' : 'failed',
    ...(cancelled ? {} : { message }),
    interaction: {
      kind: 'passkey_assert',
      overlay: 'hide',
    },
    error: {
      message,
    },
  });

  if (callAfterCall) {
    await afterCall?.(false);
  }
  return { success: false, error: message };
}


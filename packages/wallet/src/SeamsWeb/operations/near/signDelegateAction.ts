import type { NearSigningWebContext } from '@/SeamsWeb/signingSurface/types';
import { resolvePrimaryNearRpcUrl } from '@/core/config/chains';
import type { WalletSessionRef } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { AccountId } from '@/core/types/accountIds';
import { toAccountId } from '@/core/types/accountIds';
import type { DelegateActionInput } from '@/core/types/delegate';
import type { DelegateActionHooksOptions } from '@/core/types/sdkSentEvents';
import { SigningEventPhase } from '@/core/types/sdkSentEvents';
import type { SignDelegateActionResult } from '@/core/types/seams';
import { toError } from '@shared/utils/errors';
import { resolveNearCommandSubject } from './commandSubject';
import { emitNearSigningEvent } from './signingEventHelpers';
async function yieldForUiPaint(): Promise<void> {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    await new Promise<void>(waitForUiPaint);
    return;
  }
  await Promise.resolve();
}
export async function signDelegateAction(args: {
  context: NearSigningWebContext;
  nearAccountId: AccountId;
  walletSession: WalletSessionRef;
  delegate: DelegateActionInput;
  options: DelegateActionHooksOptions;
}): Promise<SignDelegateActionResult> {
  const { context, delegate, options } = args;
  const nearAccountId = toAccountId(String(args.nearAccountId));
  const title = options?.confirmerText?.title;
  const body = options?.confirmerText?.body;
  const resolvedDelegate: DelegateActionInput = {
    ...delegate,
    senderId: delegate.senderId || String(nearAccountId),
  };
  emitNearSigningEvent(options?.onEvent, nearAccountId, {
    phase: SigningEventPhase.STEP_01_STARTED,
    status: 'started',
    message: 'Preparing delegate action inputs',
    interaction: { kind: 'none', overlay: 'none' },
  });
  await yieldForUiPaint();
  try {
    const coreResult = await context.signingEngine.signNear({
      chain: 'near',
      kind: 'delegateAction',
      args: {
        commandSubject: resolveNearCommandSubject({
          nearAccountId,
          walletSession: args.walletSession,
        }),
        delegate: resolvedDelegate,
        rpcCall: {
          nearRpcUrl: resolvePrimaryNearRpcUrl(context.configs.network.chains),
          nearAccountId: String(nearAccountId),
        },
        signerSlot: options?.signerSlot,
        confirmationConfigOverride: options?.confirmationConfig,
        title,
        body,
        onEvent: options?.onEvent,
      },
    });
    const result: SignDelegateActionResult = {
      hash: coreResult.hash,
      signedDelegate: coreResult.signedDelegate,
      nearAccountId: String(nearAccountId),
      logs: coreResult.logs,
    };
    emitNearSigningEvent(options?.onEvent, nearAccountId, {
      phase: SigningEventPhase.STEP_15_COMPLETED,
      status: 'succeeded',
      message: 'Delegate action signed',
      interaction: { kind: 'none', overlay: 'none' },
      data: { hash: result.hash },
    });
    await options?.afterCall?.(true, result);
    return result;
  } catch (error: unknown) {
    const e = toError(error);
    options?.onError?.(e);
    await options?.afterCall?.(false);
    emitNearSigningEvent(options?.onEvent, nearAccountId, {
      phase: SigningEventPhase.FAILED,
      status: 'failed',
      message: e.message,
      interaction: { kind: 'none', overlay: 'hide' },
      error: { message: e.message },
    });
    throw e;
  }
}
function waitForUiPaint(resolve: () => void): void {
  window.requestAnimationFrame(resolve);
}

import type { UiConfirmContext } from '../uiConfirm.types';
import type { NormalizedConfirmationConfig } from '@/core/types/confirmationConfig';
import { determineConfirmationConfig } from './determineConfirmationConfig';
import {
  TransactionSummary,
  UserConfirmationType,
  type UserConfirmDecision,
} from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import { errorMessage } from '@shared/utils/errors';
import {
  createUserConfirmScopedWorker,
  sendConfirmResponse,
  sanitizeForPostMessage,
} from '@/core/signingEngine/stepUpConfirmation/channel/confirmCommon';
import { getIntentDigest } from './flows/adapters/request';
import {
  assertNoForbiddenMainThreadSigningSecrets,
  assertSigningRequestContext,
} from './flows/adapters/request';
import type { UserConfirmPromptEnvelope } from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import { coerceThemeMode } from '@shared/utils/theme';
import type { ThemeMode } from '@/core/types/seams';
import { handleIntentDigestSigningFlow, handleTransactionSigningFlow } from './flows/signing';
import type { ConfirmUISurfaceSource } from '../ui/confirm-ui';

/**
 * Handles secure confirmation requests from the worker with robust error handling
 * => UserConfirmMessageType.PROMPT_USER_CONFIRM_IN_JS_MAIN_THREAD
 * and proper data validation. Supports both transaction and registration confirmation flows.
 */
export async function handlePromptFromWorker(
  ctx: UiConfirmContext,
  message: UserConfirmPromptEnvelope,
  worker: Worker,
  options?: {
    signingSurface: ConfirmUISurfaceSource;
    onDecision?: (decision: UserConfirmDecision) => void;
  },
): Promise<void> {
  const scopedWorker = createUserConfirmScopedWorker(worker, {
    channelToken: message.channelToken,
    onDecision: options?.onDecision,
  });

  const request = message.data;
  let confirmationConfig: NormalizedConfirmationConfig;
  let transactionSummary: TransactionSummary;
  let theme: ThemeMode;

  try {
    assertSigningRequestContext(request);
    assertNoForbiddenMainThreadSigningSecrets(request);
    confirmationConfig = determineConfirmationConfig(ctx, request);
    theme = coerceThemeMode(ctx.getTheme?.()) ?? 'dark';

    const intentDigest = getIntentDigest(request);

    transactionSummary = sanitizeForPostMessage({
      ...request.summary,
      ...(intentDigest ? { intentDigest } : {}),
    });
  } catch (e: unknown) {
    console.error('[UserConfirm][Host] validateAndParseRequest failed', e);
    sendConfirmResponse(scopedWorker, {
      requestId: request.requestId,
      confirmed: false,
      error: errorMessage(e) || 'Invalid secure confirm request',
    });
    return;
  }

  try {
    const flowOptions = {
      confirmationConfig,
      transactionSummary,
      theme,
      surface: options?.signingSurface ?? { kind: 'mount_new' as const },
    };
    switch (request.type) {
      case UserConfirmationType.AUTHORIZE_KEY_EXPORT:
      case UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI: {
        const { handleLocalOnlyFlow } = await import('./flows/localOnly');
        await handleLocalOnlyFlow(ctx, request, scopedWorker, flowOptions);
        break;
      }
      case UserConfirmationType.REGISTER_ACCOUNT:
      case UserConfirmationType.LINK_DEVICE: {
        const { handleRegistrationFlow } = await import('./flows/registration');
        await handleRegistrationFlow(ctx, request, scopedWorker, flowOptions);
        break;
      }
      case UserConfirmationType.SIGN_TRANSACTION:
      case UserConfirmationType.SIGN_NEP413_MESSAGE:
        await handleTransactionSigningFlow(ctx, request, scopedWorker, flowOptions);
        break;
      case UserConfirmationType.SIGN_INTENT_DIGEST:
        await handleIntentDigestSigningFlow(ctx, request, scopedWorker, flowOptions);
        break;
      default:
        assertNever(request);
    }
  } catch (e: unknown) {
    console.error('[UserConfirm][Host] handler failed', e);
    // Best-effort: always respond to the worker so worker-side requests don't hang indefinitely.
    sendConfirmResponse(scopedWorker, {
      requestId: request.requestId,
      intentDigest: getIntentDigest(request),
      confirmed: false,
      error: errorMessage(e) || 'Secure confirmation failed',
    });
  }
}

function assertNever(_request: never): never {
  throw new Error('Unsupported secure confirmation request');
}

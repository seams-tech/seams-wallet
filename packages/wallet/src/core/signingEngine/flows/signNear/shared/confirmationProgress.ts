import type { AccountId } from '@/core/types/accountIds';
import {
  createSigningFlowEvent,
  type CreateSigningFlowEventInput,
  type SigningFlowEvent,
} from '@/core/types/sdkSentEvents';
import type {
  SigningAuthPlan,
  UserConfirmProgressEvent,
} from '@/core/signingEngine/stepUpConfirmation/types';
import {
  mapSigningConfirmationProgress,
  resolveSigningConfirmationAuthMethod,
} from '../../shared/signingConfirmation';

function emitNearSigningEvent(
  onEvent: ((event: SigningFlowEvent) => void) | undefined,
  accountId: AccountId | string,
  event: Omit<CreateSigningFlowEventInput, 'flowId' | 'accountId'>,
): void {
  try {
    onEvent?.(
      createSigningFlowEvent({
        ...event,
        flowId: `signing:near:${String(accountId)}:${event.phase}`,
        accountId: String(accountId),
      }),
    );
  } catch {}
}

export function emitNearSigningConfirmationProgress(
  args: {
    onEvent: ((event: SigningFlowEvent) => void) | undefined;
    nearAccountId: AccountId | string;
    signingAuthPlan: SigningAuthPlan;
  },
  progress: UserConfirmProgressEvent,
): void {
  const authMethod = resolveSigningConfirmationAuthMethod(args.signingAuthPlan);
  if (progress.phase === 'confirmation.complete') {
    if (authMethod === 'passkey' && progress.status === 'succeeded') return;
  } else if (
    authMethod !== 'passkey' ||
    (progress.phase !== 'auth.passkey.prompt.started' &&
      progress.phase !== 'auth.passkey.prompt.succeeded')
  ) {
    return;
  }
  const event = mapSigningConfirmationProgress(progress, authMethod);
  if (!event) return;
  emitNearSigningEvent(args.onEvent, args.nearAccountId, { ...event, authMethod });
}

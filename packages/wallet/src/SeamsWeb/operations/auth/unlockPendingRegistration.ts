import { readNearProvisioningState } from '@/core/signingEngine/flows/registration/nearProvisioningRegistry';
import type { WalletAuthWebContext } from '@/SeamsWeb/signingSurface/types';
import type { LoginHooksOptions } from '@/core/types/sdkSentEvents';
import { UnlockEventPhase } from '@/core/types/sdkSentEvents';
import type { LoginAndCreateSessionResult } from '@/core/types/seams';
import { isUserCancellationError, toError } from '@shared/utils/errors';
import {
  recoverPendingRegistration,
  type PendingEcdsaRegistrationCommit,
  type PendingRegistrationRecoverySigningSurface,
} from '../registration/pendingRegistrationRecovery';
import { getWalletSession } from './login';
import { resolveUnlockSessionPolicy } from './unlockSessionPolicy';
import { emitUnlockEvent, finalizeLoginError, finalizeLoginSuccess } from './unlockCompletion';

type PendingRegistrationAuthContext = WalletAuthWebContext & {
  signingEngine: PendingRegistrationRecoverySigningSurface;
};

export async function unlockPendingRegistration(args: {
  context: PendingRegistrationAuthContext;
  pending: PendingEcdsaRegistrationCommit;
  options: LoginHooksOptions | undefined;
}): Promise<LoginAndCreateSessionResult> {
  const { context, pending, options } = args;
  const unlockSubjectId = String(pending.walletId);
  emitUnlockEvent(options?.onEvent, unlockSubjectId, {
    phase: UnlockEventPhase.STEP_01_STARTED,
    status: 'started',
    authMethod: 'passkey',
  });
  try {
    if (pending.auth.kind !== 'passkey') {
      throw new Error('Pending registration requires its founding email authentication method');
    }
    const requireNear =
      options?.unlockSelection?.mode === 'ed25519_only' ||
      options?.unlockSelection?.mode === 'ed25519_and_ecdsa';
    if (requireNear && pending.signerPlanKind !== 'near_ed25519_and_evm_family_ecdsa') {
      throw new Error('wallet unlock is missing the requested capability subject');
    }
    const sessionPolicy = resolveUnlockSessionPolicy({
      defaults: context.configs.signing.sessionDefaults,
      override: options?.signingSession,
    });
    if (sessionPolicy.kind === 'disabled') {
      throw new Error('Pending registration recovery requires an enabled signing session policy');
    }
    const recovered = await recoverPendingRegistration({
      relayerUrl: context.configs.network.relayer.url,
      sessionPolicy,
      pending,
      exactMethod: { kind: 'passkey' },
      signingSurface: context.signingEngine,
      nearContext: context,
      nearCompletion: requireNear ? 'await' : 'background',
      onEvent: options?.onEvent,
    });
    const loginResult = await recoveredUnlockResult({
      context,
      walletId: pending.walletId,
      requireNear,
      signingSession: recovered.signingSession,
    });
    emitUnlockEvent(options?.onEvent, unlockSubjectId, {
      phase: UnlockEventPhase.STEP_06_SESSION_READY,
      status: 'succeeded',
      authMethod: 'passkey',
    });
    return await finalizeLoginSuccess({
      context,
      authMethod: 'passkey',
      unlockSubjectId,
      loginResult,
      onEvent: options?.onEvent,
      afterCall: options?.afterCall,
    });
  } catch (error: unknown) {
    const normalized = toError(error);
    return await finalizeLoginError({
      unlockSubjectId,
      message: normalized.message,
      error: normalized,
      cancelled: isUserCancellationError(normalized),
      onEvent: options?.onEvent,
      onError: options?.onError,
      afterCall: options?.afterCall,
    });
  }
}

async function recoveredUnlockResult(args: {
  context: WalletAuthWebContext;
  walletId: PendingEcdsaRegistrationCommit['walletId'];
  requireNear: boolean;
  signingSession: NonNullable<LoginAndCreateSessionResult['signingSession']>;
}): Promise<Extract<LoginAndCreateSessionResult, { success: true }>> {
  if (!args.requireNear) {
    return {
      success: true,
      kind: 'ecdsa_wallet_unlocked',
      walletId: args.walletId,
      signingSession: args.signingSession,
    };
  }
  const nearState = readNearProvisioningState(args.walletId);
  if (nearState?.status !== 'near_ready') {
    throw new Error(
      nearState?.status === 'near_failed_retryable'
        ? nearState.error
        : 'Pending NEAR registration did not establish the requested account',
    );
  }
  const session = await getWalletSession(args.context, args.walletId);
  if (
    session.appIdentity.kind !== 'resolved' ||
    !session.appIdentity.nearAccountId ||
    session.appIdentity.nearAccountId !== nearState.nearAccountId
  ) {
    throw new Error('Pending NEAR registration did not establish the requested account');
  }
  return {
    success: true,
    kind: 'near_wallet_unlocked',
    walletId: args.walletId,
    nearAccountId: session.appIdentity.nearAccountId,
    loggedInNearAccountId: session.appIdentity.nearAccountId,
    operationalPublicKey: session.appIdentity.nearOperationalPublicKey,
    signingSession: args.signingSession,
  };
}

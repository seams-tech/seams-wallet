import type { NearSigningWebContext } from '@/SeamsWeb/signingSurface/types';
import type { SignNEP413HooksOptions } from '@/core/types/sdkSentEvents';
import { SigningEventPhase } from '@/core/types/sdkSentEvents';
import type {
  SignNEP413MessageParams,
  SignNEP413MessageResult,
} from '@/core/types/sdkPublicResults';
import type { AccountId } from '@/core/types/accountIds';
import { base64Encode } from '@shared/utils/base64';
import type { WalletSessionRef } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { SignedVoiceVerdict } from '@/core/transactionFeatures/voiceVerdict';
import { emitNearSigningEvent } from './signingEventHelpers';
import { resolveNearCommandSubject } from './commandSubject';
import { assertString, requireCanonicalString } from '@shared/utils/validation';

export type { SignNEP413MessageParams, SignNEP413MessageResult };

/**
 * Sign a NEP-413 message using the active threshold-controlled NEAR key.
 *
 * This function implements the NEP-413 standard for off-chain message signing:
 * - Creates a payload with message, nonce, recipient, and callbackUrl
 * - Serializes using Borsh
 * - Adds NEP-413 prefix (2^31 + 413)
 * - Hashes with SHA-256
 * - Signs with Ed25519
 * - Returns base64-encoded signature
 *
 * @param context - SeamsWeb context
 * @param nearAccountId - NEAR account ID to sign with
 * @param params - NEP-413 signing parameters
 * @param options - Action options for event handling
 * @returns Promise resolving to signing result
 */
export async function signMessage(args: {
  context: NearSigningWebContext;
  nearAccountId: AccountId;
  walletSession: WalletSessionRef;
  params: SignNEP413MessageParams;
  options: SignNEP413HooksOptions;
  /**
   * Set only by the Speak-to-Sign route of the Wallet iframe, after Wallet core checked the
   * verdict of this exact message and nonce. The spoken sentence was the confirmation, so no
   * confirm shows, and the signing request carries the verdict for the Seams co-signer.
   */
  voice?: Readonly<{ nonce: string; verdict: SignedVoiceVerdict }>;
}): Promise<SignNEP413MessageResult> {
  const { context, nearAccountId, params, options, voice } = args;
  const confirmerText = options?.confirmerText;
  const confirmationConfigOverride = voice
    ? ({ uiMode: 'none', behavior: 'skipClick' } as const)
    : options?.confirmationConfig;
  const { signingEngine } = context;
  const signerSlot = options?.signerSlot;
  const hasValidSignerSlot =
    typeof signerSlot === 'number' && Number.isSafeInteger(signerSlot) && signerSlot >= 1;

  try {
    const callbackUrl =
      params.callbackUrl === undefined
        ? null
        : requireCanonicalString(params.callbackUrl, 'callbackUrl');
    const state = params.state === undefined ? null : assertString(params.state, 'state');
    // Emit preparation event
    emitNearSigningEvent(options?.onEvent, nearAccountId, {
      phase: SigningEventPhase.STEP_01_STARTED,
      status: 'started',
      message: 'Preparing NEP-413 message signing',
      interaction: { kind: 'none', overlay: 'none' },
    });

    // Get user data for NEP-413 signing.
    if (signerSlot !== undefined && !hasValidSignerSlot) {
      throw new Error(`Invalid signerSlot for NEP-413 signing: ${signerSlot}`);
    }
    const userData = hasValidSignerSlot
      ? await signingEngine.getUserBySignerSlot(nearAccountId, signerSlot)
      : await signingEngine.getLastUser();
    if (!userData || !userData.operationalPublicKey) {
      throw new Error(`Operational NEAR key data not found for ${nearAccountId}`);
    }

    // A voice verdict binds its own nonce. Otherwise the nonce is 32 new random bytes
    // (NEP-413 expects base64-encoded nonce bytes).
    const nonce = voice?.nonce ?? newNep413Nonce();

    // Emit signing progress event
    emitNearSigningEvent(options?.onEvent, nearAccountId, {
      phase: SigningEventPhase.STEP_10_COMMIT_STARTED,
      status: 'running',
      message: 'Signing NEP-413 message',
      interaction: { kind: 'none', overlay: 'none' },
    });

    // Send to SigningEngine for signing.
    // Note: NEP-413 uses UserConfirm-driven confirmTxFlow; this call triggers
    // its own confirmation + WebAuthn authentication as needed.
    const result = await context.signingEngine.signNear({
      chain: 'near',
      kind: 'nep413',
      args: {
        commandSubject: resolveNearCommandSubject({
          nearAccountId,
          walletSession: args.walletSession,
        }),
        onEvent: options?.onEvent,
        message: params.message,
        recipient: params.recipient,
        nonce,
        callbackUrl,
        state,
        signerSlot: hasValidSignerSlot ? signerSlot : undefined,
        title: confirmerText?.title,
        body: confirmerText?.body,
        confirmationConfigOverride,
        ...(voice ? { voiceVerdict: voice.verdict } : {}),
      },
    });

    if (result.success) {
      // Emit completion event
      emitNearSigningEvent(options?.onEvent, nearAccountId, {
        phase: SigningEventPhase.STEP_15_COMPLETED,
        status: 'succeeded',
        message: 'NEP-413 message signed successfully',
        interaction: { kind: 'none', overlay: 'none' },
      });

      return {
        success: true,
        accountId: result.accountId,
        publicKey: result.publicKey,
        signature: result.signature,
        nonce,
        ...(result.state !== undefined ? { state: result.state } : {}),
      };
    } else {
      throw new Error(`NEP-413 signing failed: ${result.error || 'Unknown error'}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Emit error event
    emitNearSigningEvent(options?.onEvent, nearAccountId, {
      phase: SigningEventPhase.FAILED,
      status: 'failed',
      message: `NEP-413 signing failed: ${errorMessage}`,
      interaction: { kind: 'none', overlay: 'hide' },
      error: { message: errorMessage },
    });

    options?.onError?.(error instanceof Error ? error : new Error(errorMessage));

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/** 32 random bytes as base64, the nonce of one NEP-413 message. */
export function newNep413Nonce(): string {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Secure random not available to generate NEP-413 nonce');
  }
  return base64Encode(crypto.getRandomValues(new Uint8Array(32)));
}

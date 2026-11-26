import { SigningEventPhase } from '@/core/types/sdkSentEvents';
import type { EmailOtpSigningSessionAuthLane } from '../../stepUpConfirmation/otpPrompt/authLane';
import {
  createSigningBoundaryTraceEvent,
  emitSigningBoundaryTrace,
} from '../../session/operationState/trace';
import {
  mpcMaterialActivationRefsEqual,
  type MpcMaterialActivationRef,
} from '@shared/utils/domainIds';
import {
  isEmailOtpWalletAuthAuthority,
  walletAuthAuthoritiesMatch,
  type EmailOtpWalletAuthAuthority,
  type WalletAuthAuthority,
} from '@shared/utils/walletAuthAuthority';
import type { CanonicalEvmFamilyEcdsaSigningCapability } from '../../session/material/ecdsaSigningCapability';
import type { WalletSessionRef } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { EvmFamilyChain, EvmFamilyLifecycleEventCallback } from './types';
import { emitEvmFamilySigningEvent } from './events';
import type { ResolvedEvmFamilyEcdsaSigningLane } from './ecdsaLanes';
import type { EmailOtpEcdsaSigningSessionCommittedLane } from './ecdsaSelection';
import type { EmailOtpTransactionSigningChallenge } from '../../session/emailOtp/publicTypes';
import { demoEmailOtpCodeFromDelivery } from '../../session/emailOtp/challengeDelivery';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';

export type EvmFamilyEmailOtpTransactionSigningBridge = {
  challenge: () => Promise<{
    challengeId: string;
    email: string;
  }>;
};

/** Auth-neutral material authorized by its own Email OTP factor. There is no
 * warm signing lane and no reauth anchor to name, so the authority is the
 * capability's own: the provider identity and email binding the manifest
 * already carries. The exact operation is named here too, so one challenge
 * cannot be minted for one operation and spent on another. */
type EmailOtpEcdsaCapabilityStepUpAuthority = {
  kind: 'capability_step_up';
  capabilityAuthority: EmailOtpWalletAuthAuthority;
  materialActivation: MpcMaterialActivationRef;
  operationFingerprint: string;
  committedLane?: never;
  reauthLane?: never;
};

export type EmailOtpEcdsaStepUpAuthority =
  | {
      kind: 'live_session';
      committedLane: EmailOtpEcdsaSigningSessionCommittedLane;
      reauthLane?: never;
      capabilityAuthority?: never;
      materialActivation?: never;
      operationFingerprint?: never;
    }
  | EmailOtpEcdsaCapabilityStepUpAuthority;

export type EmailOtpEcdsaChallengeAuthority =
  | {
      kind: 'live_session';
      authLane: Extract<EmailOtpSigningSessionAuthLane, { curve: 'ecdsa' }>;
      reauthLane?: never;
      capabilityAuthority?: never;
      materialActivation?: never;
      operationFingerprint?: never;
    }
  | (Omit<EmailOtpEcdsaCapabilityStepUpAuthority, 'committedLane' | 'reauthLane'> & {
      authLane?: never;
      reauthLane?: never;
    });

/** The capability is the authority. Anything the caller or the confirmation
 * plan supplies must agree with it exactly, or the OTP would be sent to a
 * different mailbox than the one bound to the material being signed with. */
export function emailOtpEcdsaCapabilityStepUpAuthority(args: {
  capability: CanonicalEvmFamilyEcdsaSigningCapability;
  materialActivation: MpcMaterialActivationRef;
  operationFingerprint: string;
  claimedAuthority?: WalletAuthAuthority;
}): EmailOtpEcdsaCapabilityStepUpAuthority {
  const capabilityAuthority = args.capability.authority;
  if (!isEmailOtpWalletAuthAuthority(capabilityAuthority)) {
    throw new Error(
      '[SigningEngine] Email OTP operation step-up requires an Email OTP capability authority',
    );
  }
  if (
    args.claimedAuthority &&
    !walletAuthAuthoritiesMatch(capabilityAuthority, args.claimedAuthority)
  ) {
    throw new Error(
      '[SigningEngine] Email OTP step-up authority does not match the selected capability',
    );
  }
  if (
    !mpcMaterialActivationRefsEqual(
      args.capability.manifest.activation.materialActivation,
      args.materialActivation,
    )
  ) {
    throw new Error(
      '[SigningEngine] Email OTP step-up material activation does not match the selected capability',
    );
  }
  const operationFingerprint = String(args.operationFingerprint || '').trim();
  if (!operationFingerprint) {
    throw new Error(
      '[SigningEngine] Email OTP operation step-up requires an operation fingerprint',
    );
  }
  return {
    kind: 'capability_step_up',
    capabilityAuthority,
    materialActivation: args.materialActivation,
    operationFingerprint,
  };
}

function emailOtpEcdsaChallengeAuthority(
  authority: EmailOtpEcdsaStepUpAuthority,
): EmailOtpEcdsaChallengeAuthority {
  switch (authority.kind) {
    case 'live_session':
      if (authority.committedLane.authority.factor.kind !== 'email_otp') {
        throw new Error('[SigningEngine][ecdsa] Email OTP challenge requires Email OTP authority');
      }
      return {
        kind: 'live_session',
        authLane: authority.committedLane.authLane,
      };
    case 'capability_step_up':
      return {
        kind: 'capability_step_up',
        capabilityAuthority: authority.capabilityAuthority,
        materialActivation: authority.materialActivation,
        operationFingerprint: authority.operationFingerprint,
      };
  }
}

export function createEmailOtpEcdsaTransactionSigningBridge(args: {
  walletId: string;
  walletSession: WalletSessionRef;
  chain: EvmFamilyChain;
  selectedLane?: ResolvedEvmFamilyEcdsaSigningLane;
  authority: EmailOtpEcdsaStepUpAuthority;
  operationFingerprintDigest: DigestB64u;
  onEvent?: EvmFamilyLifecycleEventCallback;
  requestEmailOtpTransactionSigningChallenge?: (args: {
    walletSession: WalletSessionRef;
    chain: EvmFamilyChain;
    authority: EmailOtpEcdsaChallengeAuthority;
    operationFingerprintDigest: DigestB64u;
  }) => Promise<EmailOtpTransactionSigningChallenge>;
}): EvmFamilyEmailOtpTransactionSigningBridge {
  // One challenge belongs to one operation. A capability step-up mints its
  // challenge against the operation named in the authority, so re-minting for
  // a different operation would let a code approved for one transaction
  // authorize another.
  let mintedForOperationFingerprint: string | null = null;
  return {
    challenge: async () => {
      if (typeof args.requestEmailOtpTransactionSigningChallenge !== 'function') {
        throw new Error('[SigningEngine] Email OTP ECDSA signing step-up is not configured');
      }
      if (args.authority.kind === 'capability_step_up') {
        if (
          mintedForOperationFingerprint !== null &&
          mintedForOperationFingerprint !== args.authority.operationFingerprint
        ) {
          throw new Error(
            '[SigningEngine] Email OTP step-up challenge is bound to a different operation',
          );
        }
        mintedForOperationFingerprint = args.authority.operationFingerprint;
      }
      emitEvmFamilySigningEvent(args.onEvent, {
        phase: SigningEventPhase.STEP_06_AUTH_EMAIL_OTP_CHALLENGE_STARTED,
        status: 'running',
        walletId: args.walletId,
        interaction: { kind: 'none', overlay: 'none' },
      });
      emitSigningBoundaryTrace(
        'evm-family',
        createSigningBoundaryTraceEvent({
          event: 'auth_side_effect_started',
          lane: args.selectedLane,
          sideEffect: 'email_otp_challenge',
          phase: 'confirmed',
        }),
      );
      const challenge = await args.requestEmailOtpTransactionSigningChallenge({
        walletSession: args.walletSession,
        chain: args.chain,
        authority: emailOtpEcdsaChallengeAuthority(args.authority),
        operationFingerprintDigest: args.operationFingerprintDigest,
      });
      const challengeId = String(challenge.challengeId || '').trim();
      if (!challengeId) {
        throw new Error('[SigningEngine] Email OTP challenge response did not include challengeId');
      }
      emitEvmFamilySigningEvent(args.onEvent, {
        phase: SigningEventPhase.STEP_06_AUTH_EMAIL_OTP_INPUT_REQUIRED,
        status: 'waiting_for_user',
        walletId: args.walletId,
        interaction: { kind: 'otp_input', overlay: 'show' },
        data: {
          emailHint: challenge.emailHint,
          demoOtpCode: demoEmailOtpCodeFromDelivery(challenge.delivery),
        },
      });
      return {
        challengeId,
        email: String(challenge.emailHint || '').trim(),
      };
    },
  };
}

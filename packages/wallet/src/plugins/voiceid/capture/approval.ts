import type { ParentToChildEnvelope } from '@/SeamsWeb/walletIframe/shared/messages';
import {
  walletHostExecutionFingerprint,
  type ConfiguredWalletHost,
} from '@/SeamsWeb/walletIframe/shared/configuration';
import { resolveNearNetwork } from '@/core/config/chains';
import {
  parseTransactionReviewWire,
  TransactionReviewError,
  type TransactionReviewWire,
} from '@/SeamsWeb/walletIframe/shared/transactionReview';
import { ActionType } from '@shared/near/actions';
import { isPlainObject } from '@shared/utils/validation';
import { listenForVoiceApproval, sameVoiceBinding, type VoiceBinding } from './bridge';

export type VoiceIdPolicy =
  | { readonly kind: 'disabled'; readonly approval?: never }
  | { readonly kind: 'required'; readonly approval: VoiceIdApproval };

type ApprovalState =
  | { readonly kind: 'pending' }
  | {
      readonly kind: 'listening';
      readonly binding: VoiceBinding;
      readonly deadline: number;
      readonly signal: AbortSignal;
    }
  | {
      readonly kind: 'approved';
      readonly binding: VoiceBinding;
      readonly deadline: number;
      readonly signal: AbortSignal;
    }
  | { readonly kind: 'consumed' }
  | { readonly kind: 'closed' };

function assertNever(value: never): never {
  throw new Error(`Unexpected voice outcome: ${String(value)}`);
}

function freezeRequestValue(value: unknown): void {
  if (!isPlainObject(value) && !Array.isArray(value)) return;
  for (const child of Object.values(value)) freezeRequestValue(child);
  Object.freeze(value);
}

// The iframe receives a structured clone. Hash the complete request and execution
// configuration before runtime code can normalize or change either value.
export async function voiceIdPolicyForRequest(
  request: ParentToChildEnvelope,
  configuration: ConfiguredWalletHost,
): Promise<VoiceIdPolicy> {
  switch (request.type) {
    case 'PM_SIGN_TX_WITH_ACTIONS':
    case 'PM_SIGN_DELEGATE_ACTION':
    case 'PM_SIGN_NEP413':
    case 'PM_SIGN_TEMPO':
      throw unsupportedVoiceOperation();
    case 'PM_SIGN_AND_SEND_TX': {
      if (resolveNearNetwork(configuration.config.network.chains) !== 'testnet') {
        throw new TransactionReviewError(
          'review_unsupported_mode',
          'This VoiceID prototype requires NEAR testnet.',
        );
      }
      const executionFingerprint = walletHostExecutionFingerprint(configuration.config);
      const payload = request.payload;
      if (
        !payload ||
        payload.transaction.actions.length !== 1 ||
        payload.transaction.actions[0].type !== ActionType.Transfer ||
        !('transactionReview' in request)
      ) {
        throw unsupportedVoiceOperation();
      }
      const review = parseTransactionReviewWire(request.transactionReview);
      if (review.validity.kind !== 'expires_at') {
        throw new TransactionReviewError(
          'review_invalid_input',
          'VoiceID requires a review deadline.',
        );
      }
      freezeRequestValue(request);
      const bytes = new TextEncoder().encode(
        JSON.stringify({
          domain: 'seams-voiceid-operation-v1',
          origin: location.origin,
          executionFingerprint,
          request,
        }),
      );
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      let operationHash = '';
      for (const byte of new Uint8Array(hash)) operationHash += byte.toString(16).padStart(2, '0');
      return { kind: 'required', approval: VoiceIdApproval.forReview(review, operationHash) };
    }
    default:
      return { kind: 'disabled' };
  }
}

function unsupportedVoiceOperation(): TransactionReviewError {
  return new TransactionReviewError(
    'review_unsupported_mode',
    'This VoiceID prototype requires a reviewed NEAR transfer.',
  );
}

export class VoiceIdApproval {
  readonly messages = {
    prompt: 'Select Confirm, then say “I approve this operation” or “I cancel this operation”.',
    starting: 'Starting VoiceID. Wait for the microphone to be ready.',
    listening: 'Microphone is ready. Say “I approve this operation” or “I cancel this operation”.',
    approved: 'Voice approved this operation.',
  };
  private state: ApprovalState = { kind: 'pending' };

  private constructor(
    private readonly reviewExpiresAtMs: number,
    private readonly operationHash: string,
  ) {}

  static forReview(review: TransactionReviewWire, operationHash: string): VoiceIdApproval {
    if (review.validity.kind !== 'expires_at' || !/^[0-9a-f]{64}$/.test(operationHash)) {
      throw new TransactionReviewError(
        'review_invalid_input',
        'VoiceID requires a bounded operation.',
      );
    }
    return new VoiceIdApproval(review.validity.atMs, operationHash);
  }

  async approve(signal: AbortSignal, onListening: () => void): Promise<void> {
    if (this.state.kind === 'approved') {
      if (
        signal.aborted ||
        performance.now() >= this.state.deadline ||
        Date.now() >= this.state.binding.expiresAtMs
      ) {
        throw new Error('Voice approval expired or closed.');
      }
      return;
    }
    if (this.state.kind !== 'pending') throw new Error('Voice approval already started.');
    if (
      !navigator.userActivation.isActive ||
      document.visibilityState !== 'visible' ||
      !document.hasFocus()
    ) {
      throw new Error('Open the Wallet review and select Confirm to start voice capture.');
    }
    const remaining = Math.min(25_000, this.reviewExpiresAtMs - Date.now());
    if (remaining < 250 || signal.aborted)
      throw new Error('This voice review has expired or closed.');
    const binding = Object.freeze({
      attemptId: crypto.randomUUID(),
      operationHash: this.operationHash,
      expiresAtMs: Date.now() + remaining,
    });
    const deadline = performance.now() + remaining;
    this.state = { kind: 'listening', binding, deadline, signal };
    try {
      const outcome = await listenForVoiceApproval(binding, remaining, signal, onListening);
      this.assertListening(binding);
      if (signal.aborted || performance.now() >= deadline || Date.now() >= binding.expiresAtMs) {
        throw new Error('Voice approval expired or closed.');
      }
      switch (outcome) {
        case 'approved':
          this.state = { kind: 'approved', binding, deadline, signal };
          return;
        case 'cancelled':
          throw new Error('The speaker cancelled this operation.');
        case 'rejected':
          throw new Error('VoiceID could not approve this operation. Start a new review.');
        case 'failed':
          throw new Error('VoiceID is unavailable. Start a new review.');
        default:
          assertNever(outcome);
      }
    } catch (error) {
      this.state = { kind: 'closed' };
      throw error;
    }
  }

  consume(): void {
    const state = this.state;
    this.state = { kind: 'consumed' };
    if (
      state.kind !== 'approved' ||
      state.signal.aborted ||
      performance.now() >= state.deadline ||
      Date.now() >= state.binding.expiresAtMs
    ) {
      throw new Error('A current voice approval is required before signing.');
    }
  }

  private assertListening(binding: VoiceBinding): void {
    if (this.state.kind !== 'listening' || !sameVoiceBinding(binding, this.state.binding)) {
      throw new Error('This voice attempt has closed.');
    }
  }
}

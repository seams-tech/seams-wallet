import { VoicePrompt } from './prompt';
import { newConfirmationPhrase, type SpokenPhrase } from '../browser/phrase';
import { parseVoiceConfirmation, type VoiceConfirmation } from '../browser/confirmationCommand';
import { prepareVoiceModelWithProgress } from '../browser/progress';
import type { VoiceIdTranscriptionModel } from '@seams/wallet/voiceid-host';
import type { AuthMethodApprovalResult } from '@seams/wallet/voiceid-host';
import type { ParentToChildEnvelope } from '@seams/wallet/voiceid-host';
import {
  walletHostExecutionFingerprint,
  type ConfiguredWalletHost,
} from '@seams/wallet/voiceid-host';
import { resolveNearNetwork } from '@seams/wallet/voiceid-host';
import {
  parseTransactionReviewWire,
  TransactionReviewError,
  type TransactionReviewWire,
} from '@seams/wallet/voiceid-host';
import { ActionType } from '@seams/wallet/voiceid-host';
import { isPlainObject } from '@seams/wallet/voiceid-host';
import { listenForVoiceApproval, sameVoiceBinding, type VoiceBinding } from './bridge';
import { walletForHostRequest } from '@seams/wallet/voiceid-host';
import { IndexedDBManager } from '@seams/wallet/voiceid-host';
import { resolveVoiceEnrollmentScope } from '../browser/enrollmentStore';
import type { WalletId } from '@seams/wallet/voiceid-host';

export type VoiceIdPolicy =
  | { readonly kind: 'disabled'; readonly approval?: never }
  | { readonly kind: 'required'; readonly approval: VoiceIdApproval };

type ApprovalState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'preparing' }
  | { readonly kind: 'prepared' }
  | { readonly kind: 'authorizing' }
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
  model: VoiceIdTranscriptionModel,
): Promise<VoiceIdPolicy> {
  switch (request.type) {
    case 'PM_SIGN_TX_WITH_ACTIONS':
    case 'PM_SIGN_DELEGATE_ACTION':
    case 'PM_SIGN_NEP413':
      throw unsupportedVoiceOperation();
    case 'PM_SIGN_TEMPO': {
      const payload = request.payload;
      if (!payload || payload.operationKind !== 'evm_transaction')
        throw unsupportedVoiceOperation();
      const { tx } = payload.request;
      const target = payload.chainTarget;
      const configured = configuration.config.network.chains.some(isConfiguredArcTestnet);
      if (
        !configured ||
        target.kind !== 'evm' ||
        target.namespace !== 'eip155' ||
        target.networkSlug !== 'arc-testnet' ||
        target.chainId !== 5_042_002 ||
        payload.request.chain !== 'evm' ||
        payload.request.kind !== 'eip1559' ||
        payload.request.senderSignatureAlgorithm !== 'secp256k1' ||
        tx.chainId !== target.chainId ||
        typeof tx.to !== 'string' ||
        !/^0x[0-9a-fA-F]{40}$/.test(tx.to) ||
        (tx.data !== undefined && tx.data !== '0x') ||
        (tx.accessList !== undefined && tx.accessList.length !== 0) ||
        tx.abi !== undefined
      ) {
        throw unsupportedVoiceOperation();
      }
      return await reviewedVoiceIdPolicy(
        request,
        configuration,
        parseVoiceConfirmation(payload.options?.voiceId),
        model,
      );
    }
    case 'PM_SIGN_AND_SEND_TX': {
      if (resolveNearNetwork(configuration.config.network.chains) !== 'testnet') {
        throw new TransactionReviewError(
          'review_unsupported_mode',
          'This VoiceID prototype requires NEAR testnet.',
        );
      }
      const payload = request.payload;
      if (
        !payload ||
        payload.transaction.actions.length !== 1 ||
        payload.transaction.actions[0].type !== ActionType.Transfer ||
        !('transactionReview' in request)
      ) {
        throw unsupportedVoiceOperation();
      }
      return await reviewedVoiceIdPolicy(
        request,
        configuration,
        parseVoiceConfirmation(payload.options.voiceId),
        model,
      );
    }
    default:
      return { kind: 'disabled' };
  }
}

function isConfiguredArcTestnet(
  chain: ConfiguredWalletHost['config']['network']['chains'][number],
): boolean {
  return chain.network === 'arc-testnet' && chain.chainId === 5_042_002;
}

function encodeOperationValue(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? { bigint: value.toString() } : value;
}

async function reviewedVoiceIdPolicy(
  request: Extract<ParentToChildEnvelope, { type: 'PM_SIGN_AND_SEND_TX' | 'PM_SIGN_TEMPO' }>,
  configuration: ConfiguredWalletHost,
  confirmation: VoiceConfirmation,
  model: VoiceIdTranscriptionModel,
): Promise<VoiceIdPolicy> {
  const review = parseTransactionReviewWire(request.transactionReview);
  if (review.validity.kind !== 'expires_at') {
    throw new TransactionReviewError('review_invalid_input', 'VoiceID requires a review deadline.');
  }
  freezeRequestValue(request);
  const bytes = new TextEncoder().encode(
    JSON.stringify(
      {
        domain: 'seams-voiceid-operation-v1',
        origin: location.origin,
        executionFingerprint: walletHostExecutionFingerprint(configuration.config),
        request,
      },
      encodeOperationValue,
    ),
  );
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  let operationHash = '';
  for (const byte of new Uint8Array(hash)) operationHash += byte.toString(16).padStart(2, '0');
  const walletId = walletForHostRequest(request, null);
  if (!walletId) throw new Error('VoiceID review requires a wallet identity.');
  return {
    kind: 'required',
    approval: VoiceIdApproval.forReview(review, operationHash, walletId, confirmation, model),
  };
}

function unsupportedVoiceOperation(): TransactionReviewError {
  return new TransactionReviewError(
    'review_unsupported_mode',
    'VoiceID requires a reviewed NEAR or Arc testnet transfer.',
  );
}

export class VoiceIdApproval {
  private phrase: SpokenPhrase;
  private readonly prompt: VoicePrompt;
  readonly surface: HTMLElement;
  get messages() {
    return {
      confirm: 'Confirm with VoiceID',
      approved: 'Voice approved this operation.',
    };
  }
  private state: ApprovalState = { kind: 'pending' };

  private constructor(
    private readonly reviewExpiresAtMs: number,
    private readonly operationHash: string,
    private readonly walletId: WalletId,
    private readonly confirmation: VoiceConfirmation,
    private readonly model: VoiceIdTranscriptionModel,
  ) {
    this.phrase = newConfirmationPhrase(confirmation, null);
    // The receipt that follows a signature takes the checking segments over as its tracks.
    this.prompt = new VoicePrompt(
      document,
      'Approve transfer with VoiceID',
      this.phrase,
      'segments',
    );
    this.prompt.record.hidden = true;
    // The confirmation card's toolbar closes the review, so the card has no close of its own.
    this.prompt.cancel.hidden = true;
    this.surface = this.prompt.element;
  }

  static forReview(
    review: TransactionReviewWire,
    operationHash: string,
    walletId: WalletId,
    confirmation: VoiceConfirmation,
    model: VoiceIdTranscriptionModel,
  ): VoiceIdApproval {
    if (review.validity.kind !== 'expires_at' || !/^[0-9a-f]{64}$/.test(operationHash)) {
      throw new TransactionReviewError(
        'review_invalid_input',
        'VoiceID requires a bounded operation.',
      );
    }
    return new VoiceIdApproval(review.validity.atMs, operationHash, walletId, confirmation, model);
  }

  async prepare(signal: AbortSignal): Promise<void> {
    if (this.state.kind !== 'pending') throw new Error('VoiceID preparation already started.');
    this.state = { kind: 'preparing' };
    this.prompt.title.textContent = 'VoiceID';
    this.prompt.status.textContent = 'Loading VoiceID…';
    try {
      await prepareVoiceModelWithProgress(this.prompt.progress, signal, this.model);
      signal.throwIfAborted();
      if (this.state.kind !== 'preparing') throw new Error('VoiceID preparation was interrupted.');
      if (Date.now() >= this.reviewExpiresAtMs) {
        throw new TransactionReviewError('review_expired', 'This review has expired.');
      }
      this.prompt.progress.replaceChildren();
      this.prompt.title.textContent = 'Read aloud';
      this.state = { kind: 'prepared' };
    } catch (error) {
      this.state = { kind: 'closed' };
      throw error;
    }
  }

  async approve(signal: AbortSignal): Promise<AuthMethodApprovalResult> {
    if (this.state.kind === 'approved') {
      if (
        signal.aborted ||
        performance.now() >= this.state.deadline ||
        Date.now() >= this.state.binding.expiresAtMs
      ) {
        throw new Error('Voice approval expired or closed.');
      }
      return { kind: 'approved' };
    }
    if (this.state.kind !== 'prepared') throw new Error('Prepare VoiceID before voice approval.');
    if (
      !navigator.userActivation.isActive ||
      document.visibilityState !== 'visible' ||
      !document.hasFocus()
    ) {
      throw new Error('Open the Wallet review and select Confirm to start voice capture.');
    }
    this.state = { kind: 'authorizing' };
    try {
      const selected = await IndexedDBManager.resolveSelectedWalletAuthority(this.walletId);
      if (
        selected.kind !== 'resolved' ||
        selected.authMethod.kind !== 'voiceid' ||
        selected.selection.lockState !== 'unlocked'
      ) {
        throw new Error('Unlock this wallet with VoiceID before voice approval.');
      }
      const scope = await resolveVoiceEnrollmentScope(
        this.walletId,
        selected.authMethod.walletAuthMethodId,
      );
      let attempt = this.beginAttempt(signal);
      for (;;) {
        const { binding, deadline, remaining } = attempt;
        const outcome = await listenForVoiceApproval(
          scope,
          binding,
          remaining,
          signal,
          this.prompt.capture,
          this.phrase,
          this.model,
        );
        this.assertListening(binding);
        if (signal.aborted || performance.now() >= deadline || Date.now() >= binding.expiresAtMs) {
          throw new Error('Voice approval expired or closed.');
        }
        switch (outcome.kind) {
          case 'approved':
            this.state = { kind: 'approved', binding, deadline, signal };
            return outcome;
          case 'retry':
            // A miss keeps the card open with a new phrase. Try again is the
            // gesture that lets the browser open the microphone once more.
            this.phrase = newConfirmationPhrase(this.confirmation, this.phrase);
            this.prompt.setPhrase(this.phrase);
            this.prompt.record.textContent = 'Try again';
            this.prompt.ready(outcome.message);
            await this.waitForRetry(signal);
            attempt = this.beginAttempt(signal);
            break;
          default:
            return assertNever(outcome);
        }
      }
    } catch (error) {
      this.state = { kind: 'closed' };
      throw error;
    }
  }

  /** Binds one listening attempt to the operation and to what remains of the review. */
  private beginAttempt(signal: AbortSignal): Readonly<{
    binding: VoiceBinding;
    deadline: number;
    remaining: number;
  }> {
    const remaining = Math.min(25_000, this.reviewExpiresAtMs - Date.now());
    if (remaining < 250 || signal.aborted)
      throw new Error('This voice review has expired or closed.');
    const binding = Object.freeze({
      attemptId: crypto.randomUUID(),
      operationHash: this.operationHash,
      expiresAtMs: Date.now() + remaining,
    });
    const deadline = performance.now() + remaining;
    this.prompt.record.hidden = true;
    this.prompt.status.textContent = 'Opening microphone…';
    this.state = { kind: 'listening', binding, deadline, signal };
    return { binding, deadline, remaining };
  }

  /** Resolves when the person selects Try again; rejects when the review closes or expires. */
  private waitForRetry(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const record = this.prompt.record;
      const settle = (retry: boolean): void => {
        clearTimeout(expiry);
        record.removeEventListener('click', tryAgain);
        signal.removeEventListener('abort', close);
        if (retry) resolve();
        else reject(new Error('This voice review has expired or closed.'));
      };
      const tryAgain = settle.bind(null, true);
      const close = settle.bind(null, false);
      const expiry = setTimeout(close, Math.max(0, this.reviewExpiresAtMs - Date.now()));
      record.addEventListener('click', tryAgain);
      signal.addEventListener('abort', close);
      if (signal.aborted) close();
      record.focus();
    });
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

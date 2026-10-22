import { TransactionReviewAdmission } from '@/core/signingEngine/uiConfirm/transactionReviewAdmission';
import {
  voiceIdPolicyForRequest,
  type VoiceIdPolicy,
} from '@/core/signingEngine/uiConfirm/voiceId/approval';
import {
  mountConfirmUI,
  type MountedConfirmUIHandle,
} from '@/core/signingEngine/uiConfirm/ui/confirm-ui';
import {
  parseTransactionReviewWire,
  type TransactionReviewStateMessage,
} from '@/SeamsWeb/walletIframe/shared/transactionReview';
import type { ParentToChildEnvelope } from '@/SeamsWeb/walletIframe/shared/messages';
import { walletIframeRequestIdFromBoundary } from '@/core/types/walletIframeIdentity';
import { ActionType, toActionArgsWasm } from '@shared/near/actions';
import type { Variant } from '@shared/utils/variant';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';
import {
  applyWalletConfigurationUpdate,
  createWalletHostConfig,
} from '@/SeamsWeb/walletIframe/shared/configuration';

type TransferRequest = Variant<ParentToChildEnvelope, 'type', 'PM_SIGN_AND_SEND_TX'>;
type MountedReview = {
  kind: 'mounted';
  admission: TransactionReviewAdmission;
  policy: VoiceIdPolicy;
  handle: MountedConfirmUIHandle;
  request: TransferRequest;
};
type JourneyState =
  | { kind: 'idle' }
  | { kind: 'preparing'; admission: TransactionReviewAdmission; handle?: never }
  | MountedReview
  | {
      kind: 'settled';
      policy: VoiceIdPolicy;
      result: 'ready_to_sign' | 'cancelled';
      error: string;
    };

class WalletJourney {
  private state: JourneyState = { kind: 'idle' };
  private generation = 0;
  private signingBoundaryCount = 0;
  private error = '';
  private signingDelayMs = 0;
  private readonly phases: string[] = [];

  async begin(timeoutMs: number, amount: string): Promise<void> {
    this.cancel();
    this.error = '';
    this.generation += 1;
    const request = transferRequest(this.generation, timeoutMs, amount);
    const policy = await voiceIdPolicyForRequest(request, journeyConfiguration('near-testnet'));
    const metadata = parseTransactionReviewWire(request.transactionReview);
    const admission = new TransactionReviewAdmission(
      metadata,
      'mpc',
      this.reviewState,
      this.rejected,
      policy,
    );
    this.state = { kind: 'preparing', admission };
    const requestId = walletIframeRequestIdFromBoundary(metadata.requestId);
    const handle = await mountConfirmUI({
      ctx: {
        surfaceMeasurementBinding: {
          kind: 'wallet_iframe',
          requestId,
          transactionReview: admission,
          postMeasurement: ignoreMeasurement,
        },
      },
      summary: { title: 'Review NEAR transfer' },
      txSigningRequests: [
        {
          receiverId: 'receiver.testnet',
          actions: [toActionArgsWasm({ type: ActionType.Transfer, amount })],
        },
      ],
      loading: false,
      theme: 'light',
      uiMode: 'modal',
    });
    const mounted: MountedReview = { kind: 'mounted', admission, policy, handle, request };
    this.state = mounted;
    void this.complete(mounted);
  }

  private readonly reviewState = (message: TransactionReviewStateMessage): void => {
    this.phases.push(`${message.phase}:${this.state.kind}`);
    if (
      message.phase !== 'prepared' ||
      (this.state.kind !== 'preparing' && this.state.kind !== 'mounted')
    )
      return;
    this.state.admission.activate({
      connectionId: message.connectionId,
      requestId: message.requestId,
      surfaceId: message.surfaceId,
      generation: message.generation,
      phase: 'activated',
    });
  };

  private readonly rejected = (error: Error): void => {
    this.error = error.message;
  };

  private async complete(review: MountedReview): Promise<void> {
    const decision = await review.handle.takeDecision();
    let result: 'ready_to_sign' | 'cancelled' = 'cancelled';
    let error = this.error;
    if (decision.kind === 'confirmed') {
      try {
        if (this.signingDelayMs > 0)
          await new Promise<void>(waitBeforeSigning.bind(null, this.signingDelayMs));
        // This is the same hook that the production Yao signing flow invokes.
        // The journey counts admission to that boundary. It sends no transaction.
        review.admission.beforeSigning();
        this.signingBoundaryCount += 1;
        result = 'ready_to_sign';
      } catch (failure) {
        error = errorText(failure);
      }
    } else if (decision.error) error = decision.error;
    review.handle.close(decision.kind === 'confirmed');
    review.admission.finish();
    if (this.state === review) {
      this.state = { kind: 'settled', policy: review.policy, result, error };
    }
  }

  cancel(): void {
    if (this.state.kind !== 'mounted' && this.state.kind !== 'preparing') return;
    this.state.admission.cancel(new Error('The application cancelled this review.'));
  }

  trySigningWithoutVoice(): string {
    if (this.state.kind !== 'mounted') throw new Error('Expected a mounted review');
    try {
      this.state.admission.beforeSigning();
      return 'unexpected_signing';
    } catch (error) {
      return errorText(error);
    }
  }

  setSigningDelay(milliseconds: number): void {
    this.signingDelayMs = milliseconds;
  }

  async requestMainnetApproval(): Promise<void> {
    const request = transferRequest(++this.generation, 10_000, '1000');
    await voiceIdPolicyForRequest(request, journeyConfiguration('near-mainnet'));
  }

  async requestWithoutReview(): Promise<void> {
    const reviewed = transferRequest(++this.generation, 10_000, '1000');
    const request: TransferRequest = {
      type: reviewed.type,
      requestId: reviewed.requestId,
      payload: reviewed.payload,
    };
    await voiceIdPolicyForRequest(request, journeyConfiguration('near-testnet'));
  }

  trySecondConsumption(): string {
    if (this.state.kind !== 'settled' || this.state.policy.kind !== 'required')
      throw new Error('Expected a required voice approval');
    try {
      this.state.policy.approval.consume();
      return 'unexpected_reuse';
    } catch (error) {
      return errorText(error);
    }
  }

  tryChangingOperation(): boolean {
    if (this.state.kind !== 'mounted' || !this.state.request.payload)
      throw new Error('Expected a mounted transfer');
    try {
      this.state.request.payload.transaction.receiverId = 'changed.testnet';
    } catch {
      return true;
    }
    return false;
  }

  snapshot(): {
    kind: string;
    result: string;
    error: string;
    signingBoundaryCount: number;
    phases: readonly string[];
    inert: boolean | null;
    ready: string | null;
  } {
    return {
      kind: this.state.kind,
      result: this.state.kind === 'settled' ? this.state.result : 'pending',
      error: this.state.kind === 'settled' ? this.state.error : this.error,
      signingBoundaryCount: this.signingBoundaryCount,
      phases: this.phases,
      inert: this.state.kind === 'mounted' ? this.state.handle.element.inert : null,
      ready:
        this.state.kind === 'mounted'
          ? (this.state.handle.element.dataset.seamsConfirmReady ?? null)
          : null,
    };
  }
}

function transferRequest(generation: number, timeoutMs: number, amount: string): TransferRequest {
  const requestId = crypto.randomUUID();
  return {
    type: 'PM_SIGN_AND_SEND_TX',
    requestId,
    transactionReview: {
      kind: 'transaction_review_v1',
      connectionId: 'voiceid-browser-journey',
      requestId,
      surfaceId: crypto.randomUUID(),
      generation,
      validity: { kind: 'expires_at', atMs: Date.now() + timeoutMs },
    },
    payload: {
      walletId: 'owner.testnet',
      nearAccountId: 'owner.testnet',
      transaction: {
        receiverId: 'receiver.testnet',
        actions: [{ type: ActionType.Transfer, amount }],
      },
      options: { confirmationConfig: { uiMode: 'modal', behavior: 'requireClick' } },
    },
  };
}

function journeyConfiguration(network: 'near-testnet' | 'near-mainnet') {
  const config = buildConfigsFromEnv({
    relayer: { url: location.origin },
    iframeWallet: { walletOrigin: location.origin },
    chains: [{ network, rpcUrl: location.origin, explorerUrl: location.origin }],
  });
  return applyWalletConfigurationUpdate(
    { kind: 'unconfigured' },
    {
      kind: 'configure',
      config: createWalletHostConfig(config),
      assetsBaseUrl: `${location.origin}/sdk`,
    },
  );
}

function ignoreMeasurement(): void {}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function waitBeforeSigning(milliseconds: number, resolve: () => void): void {
  setTimeout(resolve, milliseconds);
}

declare global {
  interface Window {
    voiceJourney: WalletJourney;
  }
}
window.voiceJourney = new WalletJourney();

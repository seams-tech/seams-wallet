import type { AppearanceConfig, SeamsConfigsReadonly } from '@/core/types/seams';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import type { MountedConfirmUIHandle } from '@/core/signingEngine/uiConfirm/ui/confirm-ui-types';
import { TouchIdPrompt } from '@/core/signingEngine/stepUpConfirmation/passkeyPrompt/touchIdPrompt';
import { redactCredentialExtensionOutputs } from '@/core/signingEngine/webauthnAuth/credentials/credentialExtensions';
import { passkeyCredentialIdB64uFromAuthentication } from '@/SeamsWeb/operations/authMethods/passkey/ecdsaBootstrap';
import type { WalletCustodyFactorProof } from '@/core/rpcClients/relayer/walletRecoveryRotate';
import type { ExternalOwnerChallenge } from '@shared/auth/externalAuth';

type OwnerApprovalContext = {
  readonly configs: Pick<SeamsConfigsReadonly, 'ui'>;
  readonly signingEngine: {
    getRpId(): string;
    getWalletIframeSurfaceMeasurementBinding(): UiConfirmSurfaceMeasurementBinding;
  };
};

export type ExternalOwnerApprovalRequest = Readonly<{
  challenge: ExternalOwnerChallenge;
  signal: AbortSignal;
  assertCurrent: () => void;
}>;

export type ExternalOwnerApproval = (
  input: ExternalOwnerApprovalRequest,
) => Promise<WalletCustodyFactorProof>;

export class ExternalOwnerApprovalError extends Error {
  constructor(readonly code: 'cancelled' | 'expired') {
    super(code === 'expired' ? 'Owner approval expired' : 'Owner approval was cancelled');
    this.name = 'ExternalOwnerApprovalError';
  }
}

class ExternalIdentityApproval {
  private state: 'reviewing' | 'collecting_proof' | 'approved' | 'cancelled' | 'expired' =
    'reviewing';
  private surface: MountedConfirmUIHandle | null = null;
  private readonly controller = new AbortController();
  private readonly cancelBound = this.cancel.bind(this);
  private readonly expireBound = this.expire.bind(this);

  constructor(
    private readonly input: ExternalOwnerApprovalRequest,
    private readonly appearance: AppearanceConfig,
    private readonly measurement: UiConfirmSurfaceMeasurementBinding,
    private readonly rpId: string,
  ) {}

  private assertCurrent(): void {
    this.input.assertCurrent();
    if (this.input.challenge.expiresAtMs <= Date.now()) this.expire();
    if (this.state === 'expired') throw new ExternalOwnerApprovalError('expired');
    if (this.input.signal.aborted || this.controller.signal.aborted || this.state === 'cancelled') {
      this.cancel();
      throw new ExternalOwnerApprovalError('cancelled');
    }
  }

  private cancel(): void {
    if (this.state === 'cancelled' || this.state === 'expired' || this.state === 'approved') return;
    this.state = 'cancelled';
    this.controller.abort();
    this.surface?.close(false);
  }

  private expire(): void {
    if (this.state === 'cancelled' || this.state === 'expired' || this.state === 'approved') return;
    this.state = 'expired';
    this.controller.abort();
    this.surface?.close(false);
  }

  async approve(): Promise<WalletCustodyFactorProof> {
    this.assertCurrent();
    const challenge = this.input.challenge;
    const timeout = setTimeout(this.expireBound, Math.max(0, challenge.expiresAtMs - Date.now()));
    this.input.signal.addEventListener('abort', this.cancelBound, { once: true });
    let unsubscribe: (() => void) | undefined;
    try {
      if (this.measurement.kind !== 'wallet_iframe')
        throw new Error('Owner approval requires the Wallet origin');
      const { mountConfirmUI } = await import('@/core/signingEngine/uiConfirm/ui/confirm-ui');
      this.assertCurrent();
      this.surface = await mountConfirmUI({
        ctx: { surfaceMeasurementBinding: this.measurement },
        summary: {
          title:
            challenge.kind === 'associate'
              ? 'Connect this app to your wallet?'
              : 'Remove this app connection?',
          body: [
            `Application: ${challenge.identity.issuer}`,
            `Account: ${JSON.stringify(challenge.identity.subject)}`,
            `Wallet: ${challenge.walletId}`,
            '',
            challenge.kind === 'associate'
              ? 'Allow this account to view wallet settings. Signing still requires your confirmation.'
              : 'Remove settings access for this account.',
          ].join('\n'),
        },
        securityContext: { rpId: this.rpId },
        appearance: this.appearance,
        uiMode: 'modal',
      });
      this.surface.element.dataset.seamsExternalOwnerApproval = challenge.kind;
      this.surface.update({
        confirmText: challenge.kind === 'associate' ? 'Connect app' : 'Remove connection',
        cancelText: 'Cancel',
      });
      unsubscribe = this.surface.onCancel?.(this.cancelBound);
      const decision = await this.surface.takeDecision();
      if (decision.kind !== 'confirmed') this.cancel();
      this.assertCurrent();
      this.state = 'collecting_proof';
      this.surface.update({ preparing: true });
      const credential = await new TouchIdPrompt(
        this.rpId,
      ).getAuthenticationCredentialsSerializedForChallengeB64u({
        subjectId: challenge.walletId,
        challengeB64u: challenge.challengeB64u,
        includeSecondPrfOutput: false,
        cancellation: { kind: 'abort_signal', signal: this.controller.signal },
      });
      this.assertCurrent();
      const credentialIdB64u = passkeyCredentialIdB64uFromAuthentication(credential);
      if (!credentialIdB64u) throw new Error('Owner approval did not receive a passkey credential');
      this.state = 'approved';
      return {
        kind: 'passkey',
        walletId: challenge.walletId,
        rpId: this.rpId,
        credentialIdB64u,
        challenge_digest: challenge.challengeB64u,
        webauthn_authentication: redactCredentialExtensionOutputs(credential),
      };
    } catch (error) {
      if (this.state === 'expired') throw new ExternalOwnerApprovalError('expired');
      if (
        this.controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'NotAllowedError')
      ) {
        throw new ExternalOwnerApprovalError('cancelled');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      this.input.signal.removeEventListener('abort', this.cancelBound);
      unsubscribe?.();
      this.surface?.close(false);
      this.surface = null;
      this.controller.abort();
    }
  }
}

export async function approveExternalOwnerOperation(
  getContext: () => OwnerApprovalContext,
  input: ExternalOwnerApprovalRequest,
): Promise<WalletCustodyFactorProof> {
  const context = getContext();
  const approval = new ExternalIdentityApproval(
    input,
    context.configs.ui.appearance,
    context.signingEngine.getWalletIframeSurfaceMeasurementBinding(),
    context.signingEngine.getRpId(),
  );
  return approval.approve();
}

import type { AppearanceConfig, SeamsConfigsReadonly } from '@/core/types/seams';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import type { MountedConfirmUIHandle } from '@/core/signingEngine/uiConfirm/ui/confirm-ui-types';
import { TouchIdPrompt } from '@/core/signingEngine/stepUpConfirmation/passkeyPrompt/touchIdPrompt';
import { redactCredentialExtensionOutputs } from '@/core/signingEngine/webauthnAuth/credentials/credentialExtensions';
import { passkeyCredentialIdB64uFromAuthentication } from '@/SeamsWeb/operations/authMethods/passkey/ecdsaBootstrap';
import type { WalletCustodyFactorProof } from '@/core/rpcClients/relayer/walletRecoveryRotate';
import type { ExternalOwnerChallenge } from '@shared/auth/externalAuth';
import type { WalletId } from '@shared/utils/domainIds';

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

type OwnerPasskeyApprovalResult = Readonly<{
  rpId: string;
  credentialIdB64u: string;
  webauthnAuthentication: Extract<
    WalletCustodyFactorProof,
    { kind: 'passkey' }
  >['webauthn_authentication'];
}>;

export class ExternalOwnerApprovalError extends Error {
  constructor(readonly code: 'cancelled' | 'expired') {
    super(code === 'expired' ? 'Owner approval expired' : 'Owner approval was cancelled');
    this.name = 'ExternalOwnerApprovalError';
  }
}

/** A wallet-origin review followed by a passkey assertion over one fresh challenge. */
export type OwnerPasskeyApprovalRequest = Readonly<{
  title: string;
  body: string;
  confirmText: string;
  surfaceMarker: Readonly<{ name: string; value: string }>;
  subjectId: WalletId;
  challengeB64u: string;
  /** Limits the browser prompt to this passkey. Without it, any passkey for the RP can answer. */
  credentialIdB64u?: string;
  expiresAtMs: number;
  signal: AbortSignal;
  assertCurrent: () => void;
}>;

class OwnerPasskeyApproval {
  private state: 'reviewing' | 'collecting_proof' | 'approved' | 'cancelled' | 'expired' =
    'reviewing';
  private surface: MountedConfirmUIHandle | null = null;
  private readonly controller = new AbortController();
  private readonly cancelBound = this.cancel.bind(this);
  private readonly expireBound = this.expire.bind(this);

  constructor(
    private readonly input: OwnerPasskeyApprovalRequest,
    private readonly appearance: AppearanceConfig,
    private readonly measurement: UiConfirmSurfaceMeasurementBinding,
    private readonly rpId: string,
  ) {}

  private assertCurrent(): void {
    this.input.assertCurrent();
    if (this.input.expiresAtMs <= Date.now()) this.expire();
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

  async approve(): Promise<OwnerPasskeyApprovalResult> {
    this.assertCurrent();
    const request = this.input;
    const timeout = setTimeout(this.expireBound, Math.max(0, request.expiresAtMs - Date.now()));
    this.input.signal.addEventListener('abort', this.cancelBound, { once: true });
    let unsubscribe: (() => void) | undefined;
    try {
      if (this.measurement.kind !== 'wallet_iframe')
        throw new Error('Owner approval requires the Wallet origin');
      const { mountConfirmUI } = await import('@/core/signingEngine/uiConfirm/ui/confirm-ui');
      this.assertCurrent();
      this.surface = await mountConfirmUI({
        ctx: { surfaceMeasurementBinding: this.measurement },
        summary: { title: request.title, body: request.body },
        securityContext: { rpId: this.rpId },
        appearance: this.appearance,
        uiMode: 'modal',
      });
      this.surface.element.dataset[request.surfaceMarker.name] = request.surfaceMarker.value;
      this.surface.update({ confirmText: request.confirmText, cancelText: 'Cancel' });
      unsubscribe = this.surface.onCancel?.(this.cancelBound);
      const decision = await this.surface.takeDecision();
      if (decision.kind !== 'confirmed') this.cancel();
      this.assertCurrent();
      this.state = 'collecting_proof';
      this.surface.update({ preparing: true });
      const credential = await new TouchIdPrompt(
        this.rpId,
      ).getAuthenticationCredentialsSerializedForChallengeB64u({
        subjectId: request.subjectId,
        challengeB64u: request.challengeB64u,
        ...(request.credentialIdB64u
          ? {
              allowCredentials: [
                { id: request.credentialIdB64u, type: 'public-key' as const, transports: [] },
              ],
            }
          : {}),
        includeSecondPrfOutput: false,
        cancellation: { kind: 'abort_signal', signal: this.controller.signal },
      });
      this.assertCurrent();
      const credentialIdB64u = passkeyCredentialIdB64uFromAuthentication(credential);
      if (!credentialIdB64u) throw new Error('Owner approval did not receive a passkey credential');
      this.state = 'approved';
      return {
        rpId: this.rpId,
        credentialIdB64u,
        webauthnAuthentication: redactCredentialExtensionOutputs(credential),
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

export async function approveWithOwnerPasskey(
  context: OwnerApprovalContext,
  input: OwnerPasskeyApprovalRequest,
): Promise<OwnerPasskeyApprovalResult> {
  const approval = new OwnerPasskeyApproval(
    input,
    context.configs.ui.appearance,
    context.signingEngine.getWalletIframeSurfaceMeasurementBinding(),
    context.signingEngine.getRpId(),
  );
  return await approval.approve();
}

export async function approveExternalOwnerOperation(
  getContext: () => OwnerApprovalContext,
  input: ExternalOwnerApprovalRequest,
): Promise<WalletCustodyFactorProof> {
  const { challenge } = input;
  const approved = await approveWithOwnerPasskey(getContext(), {
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
    confirmText: challenge.kind === 'associate' ? 'Connect app' : 'Remove connection',
    surfaceMarker: { name: 'seamsExternalOwnerApproval', value: challenge.kind },
    subjectId: challenge.walletId,
    challengeB64u: challenge.challengeB64u,
    expiresAtMs: challenge.expiresAtMs,
    signal: input.signal,
    assertCurrent: input.assertCurrent,
  });
  return {
    kind: 'passkey',
    walletId: challenge.walletId,
    rpId: approved.rpId,
    credentialIdB64u: approved.credentialIdB64u,
    challenge_digest: challenge.challengeB64u,
    webauthn_authentication: approved.webauthnAuthentication,
  };
}

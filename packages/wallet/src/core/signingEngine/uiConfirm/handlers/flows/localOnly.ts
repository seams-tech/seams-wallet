import type { UiConfirmContext } from '../../uiConfirm.types';
import type { NormalizedConfirmationConfig } from '@/core/types/confirmationConfig';
import { silentConfirmationConfig } from '@/core/types/confirmationConfig';
import {
  UserConfirmationType,
  TransactionSummary,
  LocalOnlyUserConfirmRequest,
  type AuthorizeKeyExportPayload,
  type LocalOnlyExportSubject,
  type ShowSecurePrivateKeyUiPayload,
  type SerializableCredential,
} from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import type { UserConfirmSecurityContext } from '@/core/types';
import { __isWalletIframeHostMode } from '@/core/browser/walletIframe/host-mode';
import {
  isUserCancelledUserConfirm,
  ERROR_MESSAGES,
  type UserConfirmResponsePort,
} from '@/core/signingEngine/stepUpConfirmation/channel/confirmCommon';
import { getIntentDigest } from './adapters/request';
import { errorMessage } from '@shared/utils/errors';
import { base64UrlEncode } from '@shared/utils/encoders';
import { createConfirmSession, createConfirmTxFlowAdapters } from './adapters/adapters';
import type { ThemeMode } from '@/core/types/seams';
import {
  upsertExportViewerHost,
  removeExportViewerHostIfPresent,
  type UpsertExportViewerHostArgs,
} from '../../ui/export-viewer-host';
import {
  collectAuthenticationCredentialForExactNearChallengeB64u,
  collectAuthenticationCredentialForExactWalletChallengeB64u,
} from '@/core/signingEngine/webauthnAuth/credentials/collectAuthenticationCredentialForChallengeB64u';
import { resolveUiAppearance } from '../../ui/appearance';

function createRandomChallengeB64u(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes.buffer);
}

function localOnlyExportSubjectId(subject: LocalOnlyExportSubject): string {
  switch (subject.kind) {
    case 'near_wallet':
      return subject.nearAccountId;
    case 'evm_wallet':
      return subject.walletId;
    default: {
      const exhaustive: never = subject;
      throw new Error(`Unsupported local key export subject: ${String(exhaustive)}`);
    }
  }
}

async function mountExportViewer(
  ctx: UiConfirmContext,
  payload: ShowSecurePrivateKeyUiPayload,
  confirmationConfig: NormalizedConfirmationConfig,
  theme: ThemeMode,
): Promise<void> {
  const hostArgs: UpsertExportViewerHostArgs = {
    theme: payload.theme || theme || 'dark',
    variant: payload.variant || (confirmationConfig.uiMode === 'drawer' ? 'drawer' : 'modal'),
    accountId: localOnlyExportSubjectId(payload.subject),
    sessionId: payload.viewerSessionId,
    publicKey: payload.publicKey,
    privateKey: payload.privateKey,
    keys: Array.isArray(payload.keys) ? payload.keys : undefined,
    guidance: payload.guidance,
    appearance: resolveUiAppearance({
      getAppearance: ctx.getAppearance,
      requestedMode: payload.theme,
    }),
    loading: payload.loading === true,
    errorMessage: payload.errorMessage,
    onLifecycle: payload.onLifecycle,
    surfaceMeasurementBinding: ctx.surfaceMeasurementBinding,
  };
  await upsertExportViewerHost(hostArgs);
}

type ConfirmTxFlowAdapters = ReturnType<typeof createConfirmTxFlowAdapters>;

function buildLocalOnlySecurityContext(
  adapters: ConfirmTxFlowAdapters,
): Partial<UserConfirmSecurityContext> {
  try {
    return { rpId: adapters.security.getRpId() };
  } catch {
    return {};
  }
}

async function collectLocalOnlyExportCredentialWithPRF(args: {
  ctx: UiConfirmContext;
  payload: AuthorizeKeyExportPayload;
  challengeB64u: string;
}): Promise<SerializableCredential> {
  switch (args.payload.subject.kind) {
    case 'near_wallet':
      return await collectAuthenticationCredentialForExactNearChallengeB64u({
        touchIdPrompt: args.ctx.touchIdPrompt,
        nearAccountId: args.payload.subject.nearAccountId,
        credentialIdB64u: args.payload.credentialIdB64u,
        challengeB64u: args.challengeB64u,
        includeSecondPrfOutput: true,
      });
    case 'evm_wallet':
      return await collectAuthenticationCredentialForExactWalletChallengeB64u({
        touchIdPrompt: args.ctx.touchIdPrompt,
        walletId: args.payload.subject.walletId,
        credentialIdB64u: args.payload.credentialIdB64u,
        challengeB64u: args.challengeB64u,
        includeSecondPrfOutput: true,
      });
    default: {
      const exhaustive: never = args.payload.subject;
      throw new Error(`Unsupported local key export subject: ${String(exhaustive)}`);
    }
  }
}

export async function handleLocalOnlyFlow(
  ctx: UiConfirmContext,
  request: LocalOnlyUserConfirmRequest,
  worker: UserConfirmResponsePort,
  opts: {
    confirmationConfig: NormalizedConfirmationConfig;
    transactionSummary: TransactionSummary;
    theme: ThemeMode;
  },
): Promise<void> {
  const { confirmationConfig, transactionSummary, theme } = opts;
  const adapters = createConfirmTxFlowAdapters(ctx);
  const session = createConfirmSession({
    adapters,
    worker,
    request,
    confirmationConfig,
    transactionSummary,
    theme,
    surface: { kind: 'mount_new' },
  });

  // SHOW_SECURE_PRIVATE_KEY_UI: purely visual; keep UI open and return confirmed immediately
  if (request.type === UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI) {
    try {
      await mountExportViewer(
        ctx,
        request.payload as ShowSecurePrivateKeyUiPayload,
        confirmationConfig,
        theme,
      );
      // Keep viewer open; do not close here.
      session.confirmAndCloseModal({
        requestId: request.requestId,
        intentDigest: getIntentDigest(request),
        confirmed: true,
      });
      return;
    } catch (err: unknown) {
      return session.confirmAndCloseModal({
        requestId: request.requestId,
        intentDigest: getIntentDigest(request),
        confirmed: false,
        error: errorMessage(err) || 'Failed to render export UI',
      });
    }
  }

  // AUTHORIZE_KEY_EXPORT: collect an authentication credential (with PRF extension results)
  // and return it; wallet-origin code extracts PRF outputs for signer-worker requests.
  if (request.type === UserConfirmationType.AUTHORIZE_KEY_EXPORT) {
    // Fail closed on stale export UI: a new export authorization must not reuse
    // a previously mounted key viewer while Touch ID is still pending.
    removeExportViewerHostIfPresent();

    const effectiveConfirmationConfig = __isWalletIframeHostMode()
      ? silentConfirmationConfig()
      : confirmationConfig;

    const challengeB64u =
      String((request.payload as { challengeB64u?: unknown })?.challengeB64u || '').trim() ||
      createRandomChallengeB64u();
    // When this flow is initiated via worker→host messaging (wallet-iframe mode),
    // there is typically no transient user activation. If confirmationConfig chooses
    // a visible UI mode (modal/drawer), prompt first so the click lands inside the
    // wallet iframe and grants activation for the subsequent WebAuthn call.
    if (effectiveConfirmationConfig.kind !== 'silent') {
      // Provide a sensible title/body for non-transaction flows so the confirmer
      // doesn't fall back to "Register with Passkey" (txSigningRequests is empty).
      try {
        const op = transactionSummary.operation;
        const warning = transactionSummary.warning;
        if (!transactionSummary.title) transactionSummary.title = op || 'Export Private Key';
        if (!transactionSummary.body) {
          transactionSummary.body = warning || 'Confirm to authenticate with your passkey.';
        }
      } catch {}

      const securityContext = buildLocalOnlySecurityContext(adapters);

      const { confirmed, error: uiError } = await session.promptUser({ securityContext });
      if (!confirmed) {
        return session.confirmAndCloseModal({
          requestId: request.requestId,
          intentDigest: getIntentDigest(request),
          confirmed: false,
          error: uiError,
        });
      }
    }
    try {
      const credential = await collectLocalOnlyExportCredentialWithPRF({
        ctx,
        payload: request.payload as AuthorizeKeyExportPayload,
        challengeB64u,
      });
      // No modal to keep open; export viewer will be shown by a subsequent request.
      return session.confirmAndCloseModal({
        requestId: request.requestId,
        intentDigest: getIntentDigest(request),
        confirmed: true,
        credential,
      });
    } catch (err: unknown) {
      const cancelled = isUserCancelledUserConfirm(err);
      return session.confirmAndCloseModal({
        requestId: request.requestId,
        intentDigest: getIntentDigest(request),
        confirmed: false,
        error: cancelled
          ? ERROR_MESSAGES.cancelled
          : errorMessage(err) || ERROR_MESSAGES.collectCredentialsFailed,
      });
    }
  }
}

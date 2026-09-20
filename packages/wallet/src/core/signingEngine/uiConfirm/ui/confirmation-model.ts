import type { AppearanceConfig } from '@/core/types/seams';
import type { DisplayChain } from '@/core/signingEngine/interfaces/display';
import type { ConfirmUIUpdate } from './confirm-ui-types';
import type { TreeNode } from './transaction-display/tree';
import type { ConfirmSurfaceModel } from './preact/mountConfirmationSurface';
import type { ConfirmationContentModel } from './preact/ConfirmationContent';
import type { ConfirmationStatusText } from './preact/ConfirmHeader';
import type { EmailOtpVerificationState } from './preact/email-otp-session';
import { buildConfirmationBody } from './confirmation-body-model';

export type ConfirmationPresentationInput = Pick<
  ConfirmUIUpdate,
  | 'model'
  | 'securityContext'
  | 'loading'
  | 'title'
  | 'body'
  | 'errorMessage'
  | 'confirmText'
  | 'cancelText'
  | 'signingAuthMode'
  | 'emailOtpPrompt'
  | 'nearExplorerUrl'
  | 'tempoExplorerUrl'
  | 'evmExplorerUrl'
>;

export type ConfirmationCallbacks = {
  confirm: () => void;
  cancel: () => void;
  submitEmail: (code: string, challengeId: string) => void;
};

export type ConfirmationModelResult =
  | { ok: true; model: ConfirmSurfaceModel; error?: never }
  | { ok: false; error: 'missing_email_challenge'; model?: never };

export function normalizeConfirmationModel(input: {
  presentation: ConfirmationPresentationInput;
  appearance: AppearanceConfig;
  tree: TreeNode | null;
  callbacks: ConfirmationCallbacks;
}): ConfirmationModelResult {
  const source = input.presentation;
  const errorMessage = source.errorMessage ?? '';
  const cancelText = source.cancelText ?? 'Cancel';
  const registration = source.securityContext?.passkeyRegistration;
  if (registration?.kind === 'passkey_registration_confirm_display_v1') {
    return {
      ok: true,
      model: {
        appearance: input.appearance,
        content: {
          kind: 'registration',
          registration: {
            display: registration,
            heading: source.title?.trim() || 'Create your passkey',
            body:
              source.body?.trim() ||
              'Use Touch ID or your device passkey to create credentials for this account.',
            cancelText,
            errorMessage,
            decision: source.loading
              ? { kind: 'creating' }
              : { kind: 'ready', onConfirm: input.callbacks.confirm },
            onCancel: input.callbacks.cancel,
          },
        },
      },
    };
  }

  let prompt: Extract<ConfirmationContentModel, { kind: 'transaction' }>['prompt'];
  switch (source.signingAuthMode) {
    case 'emailOtp': {
      const email = source.emailOtpPrompt;
      const challengeId = email?.challengeId.trim();
      if (!email || !challengeId) return { ok: false, error: 'missing_email_challenge' };
      prompt = {
        kind: 'email',
        email: {
          prompt: {
            challengeId,
            title: email.title,
            body: email.body,
            helperText: email.helperText,
            emailHint: email.emailHint,
            resendDebounceMs: email.resendDebounceMs,
            onResend: email.onResend,
          },
          verification: emailVerification(source.loading === true, errorMessage),
          onSubmit: input.callbacks.submitEmail,
        },
      };
      break;
    }
    case 'warmSession':
      prompt = { kind: 'session' };
      break;
    case 'webauthn':
    case undefined:
      prompt = { kind: 'passkey' };
      break;
    default:
      return assertNever(source.signingAuthMode);
  }

  const body = buildConfirmationBody(source.body ?? '');
  return {
    ok: true,
    model: {
      appearance: input.appearance,
      content: {
        kind: 'transaction',
        header: {
          heading: confirmationHeading(source),
          website: statusText(source.securityContext?.rpId?.trim() ?? ''),
          chainDetails: chainStatus(source, source.loading === true || body.kind === 'status'),
          errorMessage,
        },
        body,
        prompt,
        transaction: {
          tree: input.tree,
          theme: input.appearance.theme.mode,
          explorers: {
            near: source.nearExplorerUrl || 'https://testnet.nearblocks.io',
            tempo: source.tempoExplorerUrl,
            evm: source.evmExplorerUrl,
          },
          decision: source.loading
            ? { kind: 'preparing' }
            : { kind: 'ready', onConfirm: input.callbacks.confirm },
          confirmText:
            source.signingAuthMode === 'emailOtp'
              ? 'Confirm Code'
              : (source.confirmText ?? 'Confirm'),
          cancelText,
          errorMessage,
          onCancel: input.callbacks.cancel,
        },
      },
    },
  };
}

function emailVerification(pending: boolean, error: string): EmailOtpVerificationState {
  if (pending) return { kind: 'pending' };
  if (error) return { kind: 'rejected', message: error };
  return { kind: 'ready' };
}

function confirmationHeading(source: ConfirmationPresentationInput): string {
  const passkeyHeading =
    (source.model?.operations.length ?? 0) === 0 ? 'Register with Passkey' : 'Confirm with Passkey';
  switch (source.signingAuthMode) {
    case 'emailOtp':
      return source.emailOtpPrompt?.title?.trim() || 'Enter email code to sign';
    case 'warmSession':
      return 'Review transaction';
    case 'webauthn':
      return passkeyHeading;
    case undefined:
      return source.title?.trim() || passkeyHeading;
    default:
      return assertNever(source.signingAuthMode);
  }
}

function statusText(text: string): ConfirmationStatusText {
  return text ? { kind: 'ready', text } : { kind: 'loading' };
}

function chainStatus(
  source: ConfirmationPresentationInput,
  pending: boolean,
): ConfirmationStatusText {
  const model = source.model;
  if (model?.chainId)
    return { kind: 'ready', text: `${chainLabel(model.chain)} | ChainID: ${model.chainId}` };
  const blockHeight = String(source.securityContext?.blockHeight || '').trim();
  if (blockHeight) return { kind: 'ready', text: `block ${blockHeight}` };
  return pending ? { kind: 'loading' } : { kind: 'ready', text: 'block' };
}

function chainLabel(chain: DisplayChain): string {
  switch (chain) {
    case 'near':
      return 'NEAR';
    case 'evm':
      return 'EVM';
    case 'tempo':
      return 'Tempo';
    case 'unknown':
      return 'Unknown';
    default:
      return assertNever(chain);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected confirmation presentation: ${String(value)}`);
}

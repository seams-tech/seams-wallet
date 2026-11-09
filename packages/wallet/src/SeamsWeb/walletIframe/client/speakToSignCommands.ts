import type {
  SpeakToSignEnrollmentRequest,
  SpeakToSignEnrollmentResult,
  SpeakToSignTransferRequest,
  SpeakToSignTransferResult,
} from '@/core/transactionFeatures/hostPlugin';
import type { WalletIframeCoordinator } from '../coordinator';
import {
  parseSpeakToSignEnrollmentResult,
  parseSpeakToSignEnrollPayload,
  parseSpeakToSignTransferPayload,
  parseSpeakToSignTransferResult,
  type PMSpeakToSignEnrollPayload,
  type PMSpeakToSignTransferPayload,
} from '../shared/speakToSign';

type SpeakToSignPost = (
  request:
    | {
        readonly type: 'PM_SPEAK_TO_SIGN_TRANSFER';
        readonly payload: PMSpeakToSignTransferPayload;
      }
    | {
        readonly type: 'PM_SPEAK_TO_SIGN_ENROLL';
        readonly payload: PMSpeakToSignEnrollPayload;
      },
  // The owner speaks, and a step-up asks for a passkey, so the request has no deadline.
  options: { readonly timeout: 'interactive' },
) => Promise<{ readonly result?: unknown }>;

export type SpeakToSignTransferCommand = (
  request: SpeakToSignTransferRequest,
) => Promise<SpeakToSignTransferResult>;

export type SpeakToSignEnrollCommand = (
  request: SpeakToSignEnrollmentRequest,
) => Promise<SpeakToSignEnrollmentResult>;

export type SpeakToSignCommands = Readonly<{
  requestTransfer: SpeakToSignTransferCommand;
  enroll: SpeakToSignEnrollCommand;
}>;

export function createIframeSpeakToSignCommands(post: SpeakToSignPost): SpeakToSignCommands {
  return {
    requestTransfer: requestTransferFromHost.bind(null, post),
    enroll: enrollFromHost.bind(null, post),
  };
}

async function requestTransferFromHost(
  post: SpeakToSignPost,
  request: SpeakToSignTransferRequest,
): Promise<SpeakToSignTransferResult> {
  const payload = parseSpeakToSignTransferPayload({
    walletId: request.walletId,
    receiver: request.receiver,
    amount: request.amount,
  });
  const response = await post(
    { type: 'PM_SPEAK_TO_SIGN_TRANSFER', payload },
    { timeout: 'interactive' },
  );
  return parseSpeakToSignTransferResult(response.result);
}

async function enrollFromHost(
  post: SpeakToSignPost,
  request: SpeakToSignEnrollmentRequest,
): Promise<SpeakToSignEnrollmentResult> {
  const payload = parseSpeakToSignEnrollPayload({ walletId: request.walletId });
  const response = await post(
    { type: 'PM_SPEAK_TO_SIGN_ENROLL', payload },
    { timeout: 'interactive' },
  );
  return parseSpeakToSignEnrollmentResult(response.result);
}

/** The app-side commands. Each one waits for the Wallet iframe router first. */
export function createApplicationSpeakToSignCommands(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
): SpeakToSignCommands {
  return {
    requestTransfer: requestTransferFromIframe.bind(null, iframe),
    enroll: enrollFromIframe.bind(null, iframe),
  };
}

async function requestTransferFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: SpeakToSignTransferRequest,
): Promise<SpeakToSignTransferResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.requestTransfer(request);
}

async function enrollFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: SpeakToSignEnrollmentRequest,
): Promise<SpeakToSignEnrollmentResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.enroll(request);
}

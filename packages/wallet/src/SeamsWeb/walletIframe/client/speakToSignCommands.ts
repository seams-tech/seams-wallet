import type {
  SpeakToSignTransferRequest,
  SpeakToSignTransferResult,
} from '@/core/transactionFeatures/hostPlugin';
import type { WalletIframeCoordinator } from '../coordinator';
import {
  parseSpeakToSignTransferPayload,
  parseSpeakToSignTransferResult,
  type PMSpeakToSignTransferPayload,
} from '../shared/speakToSign';

type SpeakToSignPost = (
  request: {
    readonly type: 'PM_SPEAK_TO_SIGN_TRANSFER';
    readonly payload: PMSpeakToSignTransferPayload;
  },
  // The owner speaks and then approves the vault call, so the request has no deadline.
  options: { readonly timeout: 'interactive' },
) => Promise<{ readonly result?: unknown }>;

export type SpeakToSignTransferCommand = (
  request: SpeakToSignTransferRequest,
) => Promise<SpeakToSignTransferResult>;

export function createIframeSpeakToSignCommands(post: SpeakToSignPost): {
  readonly requestTransfer: SpeakToSignTransferCommand;
} {
  return { requestTransfer: requestTransferFromHost.bind(null, post) };
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

export function createApplicationSpeakToSignTransfer(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
): SpeakToSignTransferCommand {
  return requestTransferFromIframe.bind(null, iframe);
}

async function requestTransferFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: SpeakToSignTransferRequest,
): Promise<SpeakToSignTransferResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.requestTransfer(request);
}

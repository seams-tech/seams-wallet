import type {
  SpeakToSignEnrollmentRequest,
  SpeakToSignEnrollmentResult,
  SpeakToSignNoteRequest,
  SpeakToSignNoteResult,
  SpeakToSignProgress,
  SpeakToSignMergeApprovalRequest,
  SpeakToSignRatingRequest,
  SpeakToSignTransferRequest,
  SpeakToSignTransferResult,
} from '@/core/transactionFeatures/hostPlugin';
import type { WalletIframeCoordinator } from '../coordinator';
import type { ProgressPayload } from '../shared/messages';
import {
  parseSpeakToSignEnrollmentResult,
  parseSpeakToSignEnrollPayload,
  parseSpeakToSignNotePayload,
  parseSpeakToSignNoteResult,
  parseSpeakToSignTransferPayload,
  parseSpeakToSignTransferResult,
  type PMSpeakToSignEnrollPayload,
  type PMSpeakToSignNotePayload,
  type PMSpeakToSignTransferPayload,
} from '../shared/speakToSign';

type SpeakToSignPost = (
  request:
    | {
        readonly type: 'PM_SPEAK_TO_SIGN_TRANSFER';
        readonly payload: PMSpeakToSignTransferPayload;
      }
    | {
        readonly type: 'PM_SPEAK_TO_SIGN_NOTE';
        readonly payload: PMSpeakToSignNotePayload;
      }
    | {
        readonly type: 'PM_SPEAK_TO_SIGN_ENROLL';
        readonly payload: PMSpeakToSignEnrollPayload;
      },
  // The owner speaks, and a step-up asks for a passkey, so the request has no deadline.
  options: {
    readonly timeout: 'interactive';
    readonly onProgress?: (payload: ProgressPayload) => void;
  },
) => Promise<{ readonly result?: unknown }>;

/** Passes the Speak-to-Sign progress messages to the app's listener. A throwing listener is ignored. */
function progressListener(
  onProgress: ((progress: SpeakToSignProgress) => void) | undefined,
): ((payload: ProgressPayload) => void) | undefined {
  if (!onProgress) return undefined;
  return (payload) => {
    if (!('event' in payload) || payload.event !== 'speak_to_sign_progress_v1') return;
    try {
      onProgress(payload.progress);
    } catch {}
  };
}

export type SpeakToSignTransferCommand = (
  request: SpeakToSignTransferRequest,
) => Promise<SpeakToSignTransferResult>;

export type SpeakToSignEnrollCommand = (
  request: SpeakToSignEnrollmentRequest,
) => Promise<SpeakToSignEnrollmentResult>;

export type SpeakToSignCommands = Readonly<{
  requestTransfer: SpeakToSignTransferCommand;
  requestNote(request: SpeakToSignNoteRequest): Promise<SpeakToSignNoteResult>;
  requestRating(request: SpeakToSignRatingRequest): Promise<SpeakToSignNoteResult>;
  requestMergeApproval(request: SpeakToSignMergeApprovalRequest): Promise<SpeakToSignNoteResult>;
  enroll: SpeakToSignEnrollCommand;
}>;

export function createIframeSpeakToSignCommands(post: SpeakToSignPost): SpeakToSignCommands {
  return {
    requestTransfer: requestTransferFromHost.bind(null, post),
    requestNote: requestNoteFromHost.bind(null, post),
    requestRating: requestRatingFromHost.bind(null, post),
    requestMergeApproval: requestMergeApprovalFromHost.bind(null, post),
    enroll: enrollFromHost.bind(null, post),
  };
}

async function requestNoteFromHost(
  post: SpeakToSignPost,
  request: SpeakToSignNoteRequest,
): Promise<SpeakToSignNoteResult> {
  return await postNoteAction(post, request, {
    kind: 'community_note',
    contract: request.contract,
    postId: request.postId,
    text: request.text,
    summary: request.summary,
  });
}

async function requestRatingFromHost(
  post: SpeakToSignPost,
  request: SpeakToSignRatingRequest,
): Promise<SpeakToSignNoteResult> {
  return await postNoteAction(post, request, {
    kind: 'note_rating',
    contract: request.contract,
    noteId: request.noteId,
    rating: request.rating,
  });
}

async function requestMergeApprovalFromHost(
  post: SpeakToSignPost,
  request: SpeakToSignMergeApprovalRequest,
): Promise<SpeakToSignNoteResult> {
  return await postNoteAction(post, request, {
    kind: 'merge_approval',
    contract: request.contract,
    repo: request.repo,
    pullRequest: request.pullRequest,
    base: request.base,
    headCommit: request.headCommit,
  });
}

async function postNoteAction(
  post: SpeakToSignPost,
  request: SpeakToSignNoteRequest | SpeakToSignRatingRequest | SpeakToSignMergeApprovalRequest,
  action: PMSpeakToSignNotePayload['action'],
): Promise<SpeakToSignNoteResult> {
  const payload = parseSpeakToSignNotePayload({ walletId: request.walletId, action });
  const response = await post(
    { type: 'PM_SPEAK_TO_SIGN_NOTE', payload },
    { timeout: 'interactive', onProgress: progressListener(request.onProgress) },
  );
  return parseSpeakToSignNoteResult(response.result);
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
    { timeout: 'interactive', onProgress: progressListener(request.onProgress) },
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
    requestNote: requestNoteFromIframe.bind(null, iframe),
    requestRating: requestRatingFromIframe.bind(null, iframe),
    requestMergeApproval: requestMergeApprovalFromIframe.bind(null, iframe),
    enroll: enrollFromIframe.bind(null, iframe),
  };
}

async function requestNoteFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: SpeakToSignNoteRequest,
): Promise<SpeakToSignNoteResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.requestNote(request);
}

async function requestRatingFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: SpeakToSignRatingRequest,
): Promise<SpeakToSignNoteResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.requestRating(request);
}

async function requestMergeApprovalFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: SpeakToSignMergeApprovalRequest,
): Promise<SpeakToSignNoteResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.requestMergeApproval(request);
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

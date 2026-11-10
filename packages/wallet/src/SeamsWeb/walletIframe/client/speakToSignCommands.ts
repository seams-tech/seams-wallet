import type {
  SpeakToSignBetRequest,
  SpeakToSignDelegateRequest,
  SpeakToSignSignedDelegateResult,
  SpeakToSignSignedTransactionResult,
  SpeakToSignEnrollmentRequest,
  SpeakToSignEnrollmentResult,
  SpeakToSignMessageRequest,
  SpeakToSignMessageResult,
  SpeakToSignNoteRequest,
  SpeakToSignNoteResult,
  SpeakToSignProgress,
  SpeakToSignMergeApprovalRequest,
  SpeakToSignRatingRequest,
  SpeakToSignTransactionRequest,
  SpeakToSignTransferRequest,
  SpeakToSignTransferResult,
} from '@/core/transactionFeatures/hostPlugin';
import { parseSpeakableUsdc } from '@/core/transactionFeatures/spokenBet';
import type { TransactionDelivery } from '@/core/transactionFeatures/spokenNote';
import { toActionArgsWasm, type ActionArgs } from '@/core/types/actions';
import type { SignTransactionResult } from '@/core/types/seams';
import type { WalletIframeCoordinator } from '../coordinator';
import type { WalletSurfacePresentation } from '../shared/walletStep';
import { dispatchWithPresentation, type TransactionDispatch } from './transactionReviewReservation';
import type { ProgressPayload } from '../shared/messages';
import {
  parseSpeakToSignEnrollmentResult,
  parseSpeakToSignEnrollPayload,
  parseSpeakToSignMessageResult,
  parseSpeakToSignNotePayload,
  parseSpeakToSignNoteResult,
  parseSpeakToSignSignedDelegateResult,
  parseSpeakToSignSignedTransactionResult,
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
    readonly transactionDispatch?: TransactionDispatch;
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

/** A Speak-to-Sign request can show its VoiceID card in the app's own dialog. */
export type WithPresentation<T> = T &
  Readonly<{
    /** Shows the VoiceID card in the app's own dialog. Omitted: the Wallet's own modal. */
    presentation?: WalletSurfacePresentation;
  }>;

export type SpeakToSignTransferCommand = (
  request: WithPresentation<SpeakToSignTransferRequest>,
) => Promise<SpeakToSignTransferResult>;

export type SpeakToSignEnrollCommand = (
  request: WithPresentation<SpeakToSignEnrollmentRequest>,
) => Promise<SpeakToSignEnrollmentResult>;

export type SpeakToSignCommands = Readonly<{
  requestTransfer: SpeakToSignTransferCommand;
  requestNote(request: WithPresentation<SpeakToSignNoteRequest>): Promise<SpeakToSignNoteResult>;
  requestRating(
    request: WithPresentation<SpeakToSignRatingRequest>,
  ): Promise<SpeakToSignNoteResult>;
  requestMergeApproval(
    request: WithPresentation<SpeakToSignMergeApprovalRequest>,
  ): Promise<SpeakToSignNoteResult>;
  requestBet(request: WithPresentation<SpeakToSignBetRequest>): Promise<SpeakToSignNoteResult>;
  requestTransaction(
    request: WithPresentation<SpeakToSignTransactionRequest>,
  ): Promise<SpeakToSignNoteResult>;
  requestSignedTransaction(
    request: WithPresentation<SpeakToSignTransactionRequest>,
  ): Promise<SpeakToSignSignedTransactionResult>;
  requestDelegateAction(
    request: WithPresentation<SpeakToSignDelegateRequest>,
  ): Promise<SpeakToSignSignedDelegateResult>;
  requestMessage(
    request: WithPresentation<SpeakToSignMessageRequest>,
  ): Promise<SpeakToSignMessageResult>;
  enroll: SpeakToSignEnrollCommand;
}>;

/** Only an anchored request carries a dispatch, so an ordinary request is posted as before. */
function speakToSignDispatch(request: WithPresentation<object>): {
  readonly transactionDispatch?: TransactionDispatch;
} {
  const dispatch = dispatchWithPresentation({ kind: 'ordinary' }, request.presentation);
  return dispatch.kind === 'ordinary' ? {} : { transactionDispatch: dispatch };
}

/**
 * `signedTransaction` turns the plain signed transaction from the channel into the SDK's own
 * object again, as the normal `signTransaction` call does.
 */
export function createIframeSpeakToSignCommands(
  post: SpeakToSignPost,
  signedTransaction: (result: SignTransactionResult) => SignTransactionResult,
): SpeakToSignCommands {
  return {
    requestSignedTransaction: requestSignedTransactionFromHost.bind(null, post, signedTransaction),
    requestDelegateAction: requestDelegateActionFromHost.bind(null, post),
    requestTransfer: requestTransferFromHost.bind(null, post),
    requestNote: requestNoteFromHost.bind(null, post),
    requestRating: requestRatingFromHost.bind(null, post),
    requestMergeApproval: requestMergeApprovalFromHost.bind(null, post),
    requestBet: requestBetFromHost.bind(null, post),
    requestTransaction: requestTransactionFromHost.bind(null, post),
    requestMessage: requestMessageFromHost.bind(null, post),
    enroll: enrollFromHost.bind(null, post),
  };
}

async function requestNoteFromHost(
  post: SpeakToSignPost,
  request: WithPresentation<SpeakToSignNoteRequest>,
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
  request: WithPresentation<SpeakToSignRatingRequest>,
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
  request: WithPresentation<SpeakToSignMergeApprovalRequest>,
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

async function requestBetFromHost(
  post: SpeakToSignPost,
  request: WithPresentation<SpeakToSignBetRequest>,
): Promise<SpeakToSignNoteResult> {
  // The channel carries exact base units, so an amount that cannot be said stops here.
  const amountUnits = typeof request.amount === 'string' ? parseSpeakableUsdc(request.amount) : null;
  if (amountUnits === null) {
    return { kind: 'refused', reason: 'bet_not_valid', detail: 'amount' };
  }
  return await postNoteAction(post, request, {
    kind: 'market_bet',
    contract: request.contract,
    token: request.token,
    marketId: request.marketId,
    outcome: request.outcome,
    amountUnits: amountUnits.toString(),
  });
}

const ACTIONS_NOT_VALID = {
  kind: 'refused',
  reason: 'transaction_not_valid',
  detail: 'actions',
} as const;

/** The channel form of a general transaction, or null for actions that have no wire form. */
function transactionAction(
  transaction: Readonly<{ receiverId: string; actions: readonly ActionArgs[] }>,
  summary: string,
  delivery: TransactionDelivery,
): PMSpeakToSignNotePayload['action'] | null {
  try {
    const actions = transaction.actions.map(toActionArgsWasm);
    return {
      kind: 'transaction',
      transaction: { receiverId: transaction.receiverId, actions },
      summary,
      delivery,
    };
  } catch {
    return null;
  }
}

async function requestTransactionFromHost(
  post: SpeakToSignPost,
  request: WithPresentation<SpeakToSignTransactionRequest>,
): Promise<SpeakToSignNoteResult> {
  const action = transactionAction(request.transaction, request.summary, 'send');
  return action ? await postNoteAction(post, request, action) : ACTIONS_NOT_VALID;
}

async function requestSignedTransactionFromHost(
  post: SpeakToSignPost,
  signedTransaction: (result: SignTransactionResult) => SignTransactionResult,
  request: WithPresentation<SpeakToSignTransactionRequest>,
): Promise<SpeakToSignSignedTransactionResult> {
  const action = transactionAction(request.transaction, request.summary, 'sign');
  if (!action) return ACTIONS_NOT_VALID;
  const result = parseSpeakToSignSignedTransactionResult(await postAction(post, request, action));
  return result.kind === 'signed_transaction'
    ? { ...result, signed: signedTransaction(result.signed) }
    : result;
}

async function requestDelegateActionFromHost(
  post: SpeakToSignPost,
  request: WithPresentation<SpeakToSignDelegateRequest>,
): Promise<SpeakToSignSignedDelegateResult> {
  const { delegate } = request;
  const action = transactionAction(delegate, request.summary, {
    nonce: String(delegate.nonce),
    maxBlockHeight: String(delegate.maxBlockHeight),
    publicKey: delegate.publicKey,
  });
  if (!action) return ACTIONS_NOT_VALID;
  return parseSpeakToSignSignedDelegateResult(await postAction(post, request, action));
}

/** A message travels as a note action; its answer is a signature, not a transaction. */
async function requestMessageFromHost(
  post: SpeakToSignPost,
  request: WithPresentation<SpeakToSignMessageRequest>,
): Promise<SpeakToSignMessageResult> {
  const result = await postAction(post, request, {
    kind: 'signed_message',
    message: request.message,
    recipient: request.recipient,
    ...(request.callbackUrl === undefined ? {} : { callbackUrl: request.callbackUrl }),
    ...(request.state === undefined ? {} : { state: request.state }),
    summary: request.summary,
  });
  return parseSpeakToSignMessageResult(result);
}

/** A request that travels as one note action. */
type NoteActionRequest = WithPresentation<
  Readonly<{ walletId: string; onProgress?: (progress: SpeakToSignProgress) => void }>
>;

/** Posts one note action and returns the iframe's unparsed answer. */
async function postAction(
  post: SpeakToSignPost,
  request: NoteActionRequest,
  action: PMSpeakToSignNotePayload['action'],
): Promise<unknown> {
  const payload = parseSpeakToSignNotePayload({ walletId: request.walletId, action });
  const response = await post(
    { type: 'PM_SPEAK_TO_SIGN_NOTE', payload },
    {
      timeout: 'interactive',
      onProgress: progressListener(request.onProgress),
      ...speakToSignDispatch(request),
    },
  );
  return response.result;
}

async function postNoteAction(
  post: SpeakToSignPost,
  request: NoteActionRequest,
  action: PMSpeakToSignNotePayload['action'],
): Promise<SpeakToSignNoteResult> {
  return parseSpeakToSignNoteResult(await postAction(post, request, action));
}

async function requestTransferFromHost(
  post: SpeakToSignPost,
  request: WithPresentation<SpeakToSignTransferRequest>,
): Promise<SpeakToSignTransferResult> {
  const payload = parseSpeakToSignTransferPayload({
    walletId: request.walletId,
    receiver: request.receiver,
    amount: request.amount,
  });
  const response = await post(
    { type: 'PM_SPEAK_TO_SIGN_TRANSFER', payload },
    {
      timeout: 'interactive',
      onProgress: progressListener(request.onProgress),
      ...speakToSignDispatch(request),
    },
  );
  return parseSpeakToSignTransferResult(response.result);
}

async function enrollFromHost(
  post: SpeakToSignPost,
  request: WithPresentation<SpeakToSignEnrollmentRequest>,
): Promise<SpeakToSignEnrollmentResult> {
  const payload = parseSpeakToSignEnrollPayload({ walletId: request.walletId });
  const response = await post(
    { type: 'PM_SPEAK_TO_SIGN_ENROLL', payload },
    { timeout: 'interactive', ...speakToSignDispatch(request) },
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
    requestBet: requestBetFromIframe.bind(null, iframe),
    requestTransaction: requestTransactionFromIframe.bind(null, iframe),
    requestSignedTransaction: async (request) =>
      await (await iframe.requireRouter()).speakToSign.requestSignedTransaction(request),
    requestDelegateAction: async (request) =>
      await (await iframe.requireRouter()).speakToSign.requestDelegateAction(request),
    requestMessage: requestMessageFromIframe.bind(null, iframe),
    enroll: enrollFromIframe.bind(null, iframe),
  };
}

async function requestNoteFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: WithPresentation<SpeakToSignNoteRequest>,
): Promise<SpeakToSignNoteResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.requestNote(request);
}

async function requestRatingFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: WithPresentation<SpeakToSignRatingRequest>,
): Promise<SpeakToSignNoteResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.requestRating(request);
}

async function requestMergeApprovalFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: WithPresentation<SpeakToSignMergeApprovalRequest>,
): Promise<SpeakToSignNoteResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.requestMergeApproval(request);
}

async function requestBetFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: WithPresentation<SpeakToSignBetRequest>,
): Promise<SpeakToSignNoteResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.requestBet(request);
}

async function requestTransactionFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: WithPresentation<SpeakToSignTransactionRequest>,
): Promise<SpeakToSignNoteResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.requestTransaction(request);
}

async function requestMessageFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: WithPresentation<SpeakToSignMessageRequest>,
): Promise<SpeakToSignMessageResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.requestMessage(request);
}

async function requestTransferFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: WithPresentation<SpeakToSignTransferRequest>,
): Promise<SpeakToSignTransferResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.requestTransfer(request);
}

async function enrollFromIframe(
  iframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  request: WithPresentation<SpeakToSignEnrollmentRequest>,
): Promise<SpeakToSignEnrollmentResult> {
  const router = await iframe.requireRouter();
  return await router.speakToSign.enroll(request);
}

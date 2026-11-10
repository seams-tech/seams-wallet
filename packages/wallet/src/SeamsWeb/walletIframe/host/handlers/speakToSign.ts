import type { AuthMethodAvailability } from '@/core/authMethods/availabilityTypes';
import type {
  AuthMethodEnrollmentRecording,
  AuthMethodPhraseRequest,
  WalletAuthMethodHostPlugin,
} from '@/core/authMethods/hostPlugin';
import { prepareVoiceIdActivation } from '@/core/authMethods/voiceId/prepareActivation';
import type { WalletAuthMethodPlugin } from '@/core/authMethods/plugins';
import {
  nearAccountRefFromAccountId,
  toWalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type {
  SpeakToSignEnrollmentResult,
  SpeakToSignHostOperations,
  SpeakToSignHostPlugin,
  SpeakToSignMessageResult,
  SpeakToSignNoteResult,
  SpeakToSignTransferResult,
  SpeakToSignUnavailableReason,
} from '@/core/transactionFeatures/hostPlugin';
import {
  adoptVoiceIdRecordings,
  createSpeakToSignHostOperations,
  type AdoptedRecordings,
} from '@/core/transactionFeatures/hostOperations';
import {
  findWalletTransactionFeature,
  type SpeakToSignFeaturePlugin,
  type WalletTransactionFeaturePlugin,
} from '@/core/transactionFeatures/plugins';
import { fromTransactionInputsWasm, type TransactionInput } from '@/core/types/actions';
import type { WorkerOperationContext } from '@/core/signingEngine/workerManager/executeWorkerOperation';
import { sha256 } from '@shared/speakToSign/spokenRequest';
import { SigningEventPhase } from '@/core/types/sdkSentEvents';
import type {
  SignedVoiceVerdict,
  VoiceApprovedSigning,
} from '@/core/transactionFeatures/voiceVerdict';
import type { SpokenMessageAction } from '@/core/transactionFeatures/spokenMessage';
import { routerAbEd25519Nep413CanonicalMessageB64uV2 } from '@/core/rpcClients/relayer/routerAbNormalSigning';
import { signAndSendVoiceApprovedTransaction } from '@/SeamsWeb/operations/near/actions';
import { newNep413Nonce, signMessage as signNep413Message } from '@/SeamsWeb/operations/near/signNEP413';
import { base64UrlDecode } from '@shared/utils/base64';
import type { WalletId } from '@shared/utils/domainIds';
import type { ProgressPayload } from '../../shared/messages';
import type {
  PMSpeakToSignNotePayload,
  PMSpeakToSignTransferPayload,
} from '../../shared/speakToSign';
import type { SpokenNoteAction } from '@/core/transactionFeatures/spokenNote';
import { respondOkResult, withProgress } from './shared';
import type { HandlerDeps, HandlerMap, Req } from './walletIframeHandler.types';

/** The browser stores and loader that the handler reads. Tests pass fakes. */
export type SpeakToSignWalletPorts = Readonly<{
  readVoiceIdAvailability(walletId: WalletId): Promise<AuthMethodAvailability>;
  readOperationCredential(walletId: WalletId): Promise<string>;
  loadHost(features: readonly WalletTransactionFeaturePlugin[]): Promise<SpeakToSignHostPlugin>;
  /** The VoiceID host plugin shows the sentence and records the clip, so its prompt loads from VoiceID. */
  loadVoiceIdHost(methods: readonly WalletAuthMethodPlugin[]): Promise<WalletAuthMethodHostPlugin>;
  /**
   * The Borsh of the transaction's actions, as the signer worker writes them into the unsigned
   * transaction. A spoken transaction binds their SHA-256.
   */
  nearActionsBorsh(
    workerContext: () => WorkerOperationContext,
    ownerAccountId: string,
    transaction: TransactionInput,
  ): Promise<Uint8Array<ArrayBuffer>>;
  fetch: typeof fetch;
}>;

/** The host checks cancellation by request id, so the handler turns it into a signal. */
const CANCELLATION_POLL_MS = 200;

export function createSpeakToSignWalletIframeHandlers(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
): HandlerMap {
  return {
    PM_SPEAK_TO_SIGN_TRANSFER: handleTransfer.bind(null, deps, ports),
    PM_SPEAK_TO_SIGN_NOTE: handleNote.bind(null, deps, ports),
    PM_SPEAK_TO_SIGN_ENROLL: handleEnrollment.bind(null, deps, ports),
  };
}

type SpeakToSignRequest =
  | Req<'PM_SPEAK_TO_SIGN_TRANSFER'>
  | Req<'PM_SPEAK_TO_SIGN_NOTE'>
  | Req<'PM_SPEAK_TO_SIGN_ENROLL'>;

function handleTransfer(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
  request: Req<'PM_SPEAK_TO_SIGN_TRANSFER'>,
): Promise<void> {
  return handleSpeakToSign(deps, request, runTransfer.bind(null, deps, ports, request));
}

function handleNote(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
  request: Req<'PM_SPEAK_TO_SIGN_NOTE'>,
): Promise<void> {
  return handleSpeakToSign(deps, request, runNote.bind(null, deps, ports, request));
}

function handleEnrollment(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
  request: Req<'PM_SPEAK_TO_SIGN_ENROLL'>,
): Promise<void> {
  return handleSpeakToSign(deps, request, runEnrollment.bind(null, deps, ports, request));
}

/** Turns host cancellation into a signal and answers with the flow's result. */
async function handleSpeakToSign(
  deps: HandlerDeps,
  request: SpeakToSignRequest,
  run: (
    signal: AbortSignal,
  ) => Promise<
    | SpeakToSignTransferResult
    | SpeakToSignNoteResult
    | SpeakToSignMessageResult
    | SpeakToSignEnrollmentResult
  >,
): Promise<void> {
  const controller = new AbortController();
  const timer = setInterval(
    abortWhenCancelled.bind(null, deps, request.requestId, controller),
    CANCELLATION_POLL_MS,
  );
  try {
    const result = await run(controller.signal);
    if (deps.respondIfCancelled(request.requestId)) return;
    respondOkResult(deps, request.requestId, result);
  } catch (error) {
    // A cancelled request already received its cancellation message.
    if (controller.signal.aborted && deps.respondIfCancelled(request.requestId)) return;
    throw error;
  } finally {
    clearInterval(timer);
  }
}

function abortWhenCancelled(
  deps: HandlerDeps,
  requestId: string | undefined,
  controller: AbortController,
): void {
  if (deps.isCancelled(requestId)) controller.abort();
}

/** What both flows need: the feature, the owner, the loaded plugin and its scoped operations. */
type PreparedFlow =
  | Readonly<{
      kind: 'ready';
      walletId: WalletId;
      feature: SpeakToSignFeaturePlugin;
      ownerAccountId: string;
      plugin: SpeakToSignHostPlugin;
      operations: SpeakToSignHostOperations;
    }>
  | Readonly<{ kind: 'unavailable'; reason: SpeakToSignUnavailableReason; detail: string }>;

async function prepareFlow(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
  request: SpeakToSignRequest,
  signal: AbortSignal,
  adopted?: AdoptedRecordings,
): Promise<PreparedFlow> {
  const runtime = deps.getWalletRuntime();
  const features = runtime.configs.transactionFeatures;
  const feature = findWalletTransactionFeature(features, 'speak_to_sign');
  if (!feature) throw new Error('Enable Speak-to-Sign in the SDK configuration before using it.');
  const walletId = toWalletId(request.payload.walletId);

  // The owner records on the VoiceID surface, so VoiceID must be active for this wallet.
  const voiceId = await ports.readVoiceIdAvailability(walletId);
  if (voiceId.kind !== 'enabled') {
    return { kind: 'unavailable', reason: 'voiceid_unavailable', detail: voiceId.kind };
  }
  const serverUrl = String(runtime.configs.network.relayer?.url || '').trim();
  if (!serverUrl) {
    return { kind: 'unavailable', reason: 'verifier_unavailable', detail: 'no Seams server' };
  }
  // The session names the wallet's NEAR account for every registration path. The NEAR
  // provisioning record exists only when registration deferred the account.
  const session = await runtime.auth.getSession(walletId);
  const ownerAccountId =
    session.appIdentity.kind === 'resolved' ? session.appIdentity.nearAccountId : null;
  if (!ownerAccountId) throw new Error('The NEAR account of this wallet is not ready.');
  signal.throwIfAborted();

  const plugin = await ports.loadHost(features);
  signal.throwIfAborted();
  const operations = createSpeakToSignHostOperations({
    feature,
    ownerAccountId,
    serverUrl,
    nearClient: runtime.getContext().nearClient,
    operationCredential: readCredential.bind(null, ports, walletId),
    signVoiceApprovedTransaction: signVoiceApproved.bind(
      null,
      deps,
      request.requestId,
      walletId,
      ownerAccountId,
    ),
    signVoiceApprovedMessage: signVoiceApprovedMessage.bind(
      null,
      deps,
      request.requestId,
      walletId,
      ownerAccountId,
    ),
    signMessage: signMessage.bind(null, deps, request.requestId, walletId, ownerAccountId),
    openPhrase: openPhrase.bind(null, ports, runtime.configs.authMethods),
    prepareSigning: async () => {
      const context = runtime.getContext();
      await context.signingEngine
        .getNonceCoordinator()
        .prefetchNearContext({ kind: 'initialized_state', nearClient: context.nearClient });
    },
    progress: (progress) =>
      withProgress(deps, request.requestId).onEvent({
        event: 'speak_to_sign_progress_v1',
        progress,
      }),
    fetch: ports.fetch,
    adopted,
  });
  return { kind: 'ready', walletId, feature, ownerAccountId, plugin, operations };
}

async function runTransfer(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
  request: Req<'PM_SPEAK_TO_SIGN_TRANSFER'>,
  signal: AbortSignal,
): Promise<SpeakToSignTransferResult> {
  const flow = await prepareFlow(deps, ports, request, signal);
  if (flow.kind === 'unavailable') return flow;
  const payload: PMSpeakToSignTransferPayload = request.payload;
  return await flow.plugin.requestTransfer({
    walletId: flow.walletId,
    network: flow.feature.network,
    signal,
    transfer: {
      ownerAccountId: flow.ownerAccountId,
      receiver: payload.receiver,
      amount: payload.amount,
      surfaceMeasurementBinding: deps.surfaceMeasurementBinding(),
      operations: flow.operations,
    },
  });
}

async function runNote(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
  request: Req<'PM_SPEAK_TO_SIGN_NOTE'>,
  signal: AbortSignal,
): Promise<SpeakToSignNoteResult | SpeakToSignMessageResult> {
  const flow = await prepareFlow(deps, ports, request, signal);
  if (flow.kind === 'unavailable') return flow;
  const { action } = request.payload;
  if (action.kind === 'signed_message') {
    return await flow.plugin.requestMessage({
      walletId: flow.walletId,
      network: flow.feature.network,
      signal,
      message: {
        ownerAccountId: flow.ownerAccountId,
        action: await messageAction(action),
        surfaceMeasurementBinding: deps.surfaceMeasurementBinding(),
        operations: flow.operations,
      },
    });
  }
  return await flow.plugin.requestNoteAction({
    walletId: flow.walletId,
    network: flow.feature.network,
    signal,
    note: {
      ownerAccountId: flow.ownerAccountId,
      action: await noteAction(deps, ports, flow.ownerAccountId, action),
      surfaceMeasurementBinding: deps.surfaceMeasurementBinding(),
      operations: flow.operations,
    },
  });
}

type NotePayloadAction = PMSpeakToSignNotePayload['action'];

/**
 * The Wallet draws the nonce before the owner speaks, so the verdict binds the exact bytes that
 * the key signs later.
 */
async function messageAction(
  action: Extract<NotePayloadAction, { kind: 'signed_message' }>,
): Promise<SpokenMessageAction> {
  const nonce = newNep413Nonce();
  const callbackUrl = action.callbackUrl ?? null;
  const signedBytes = base64UrlDecode(
    routerAbEd25519Nep413CanonicalMessageB64uV2({
      message: action.message,
      recipient: action.recipient,
      nonce,
      callbackUrl,
    }),
  );
  return {
    message: action.message,
    recipient: action.recipient,
    nonce,
    callbackUrl,
    state: action.state ?? null,
    payloadSha256: await sha256(new Uint8Array(signedBytes)),
    summary: action.summary,
  };
}

/**
 * The channel carries ids as safe integers; core's action holds them as `u64` values. A general
 * transaction gets the digest of its actions from the signer's own bytes.
 */
async function noteAction(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
  ownerAccountId: string,
  action: Exclude<NotePayloadAction, { kind: 'signed_message' }>,
): Promise<SpokenNoteAction> {
  switch (action.kind) {
    case 'transaction': {
      const [transaction] = fromTransactionInputsWasm([action.transaction]);
      const actions = await ports.nearActionsBorsh(
        () => deps.getWalletRuntime().getContext().signingEngine.getSignerWorkerContext(),
        ownerAccountId,
        transaction,
      );
      return {
        kind: 'transaction',
        transaction,
        actionsSha256: await sha256(actions),
        summary: action.summary,
      };
    }
    case 'community_note':
      return { ...action, postId: BigInt(action.postId) };
    case 'note_rating':
      return { ...action, noteId: BigInt(action.noteId) };
    case 'merge_approval':
      return { ...action, pullRequest: BigInt(action.pullRequest) };
    case 'market_bet':
      return {
        kind: 'market_bet',
        contract: action.contract,
        token: action.token,
        marketId: BigInt(action.marketId),
        outcome: action.outcome,
        amountUnits: BigInt(action.amountUnits),
      };
  }
}

/**
 * A wallet without VoiceID gets it first, and the three samples of that VoiceID enrollment are
 * also the Speak-to-Sign recordings, so the owner records one set for both.
 */
async function runEnrollment(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
  request: Req<'PM_SPEAK_TO_SIGN_ENROLL'>,
  signal: AbortSignal,
): Promise<SpeakToSignEnrollmentResult> {
  const walletId = toWalletId(request.payload.walletId);
  let adopted: AdoptedRecordings | undefined;
  if ((await ports.readVoiceIdAvailability(walletId)).kind === 'not_enrolled') {
    const activation = await activateVoiceId(deps, ports, walletId);
    if (activation.kind === 'cancelled') return { kind: 'cancelled' };
    signal.throwIfAborted();
    if (activation.recordings) adopted = await adoptVoiceIdRecordings(activation.recordings);
  }
  const flow = await prepareFlow(deps, ports, request, signal, adopted);
  if (flow.kind === 'unavailable') return flow;
  return await flow.plugin.enroll({
    walletId: flow.walletId,
    network: flow.feature.network,
    signal,
    ownerAccountId: flow.ownerAccountId,
    surfaceMeasurementBinding: deps.surfaceMeasurementBinding(),
    operations: flow.operations,
    recordings: adopted?.recordings ?? null,
  });
}

/** VoiceID activation in this request, which keeps the samples of a new enrollment. */
async function activateVoiceId(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
  walletId: WalletId,
): Promise<
  | Readonly<{ kind: 'activated'; recordings: readonly AuthMethodEnrollmentRecording[] | null }>
  | Readonly<{ kind: 'cancelled' }>
> {
  const runtime = deps.getWalletRuntime();
  const voiceId = await ports.loadVoiceIdHost(runtime.configs.authMethods);
  let recordings: readonly AuthMethodEnrollmentRecording[] | null = null;
  const result = await voiceId.activate({
    walletId,
    surfaceMeasurementBinding: deps.surfaceMeasurementBinding(),
    prepareActivation: prepareVoiceIdActivation.bind(null, runtime.getContext(), walletId),
    keepRecordings: (kept) => {
      recordings = kept;
    },
  });
  if (result.kind === 'cancelled') return result;
  return { kind: 'activated', recordings };
}

async function readCredential(
  ports: SpeakToSignWalletPorts,
  walletId: WalletId,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  return await ports.readOperationCredential(walletId);
}

async function openPhrase(
  ports: SpeakToSignWalletPorts,
  methods: readonly WalletAuthMethodPlugin[],
  request: AuthMethodPhraseRequest,
) {
  const voiceId = await ports.loadVoiceIdHost(methods);
  request.signal.throwIfAborted();
  return await voiceId.openPhrase(request);
}

async function signVoiceApproved(
  deps: HandlerDeps,
  requestId: string | undefined,
  walletId: WalletId,
  ownerAccountId: string,
  transaction: TransactionInput,
  voice: VoiceApprovedSigning,
  signal: AbortSignal,
  onBroadcast: () => void,
  onIncluded: ((transactionHash: string) => void) | null,
) {
  signal.throwIfAborted();
  const progress = withProgress(deps, requestId, {});
  return await signAndSendVoiceApprovedTransaction({
    context: deps.getWalletRuntime().getContext(),
    nearAccountId: nearAccountRefFromAccountId(ownerAccountId).accountId,
    walletSession: { walletId, walletSessionUserId: String(walletId) },
    transactionInput: transaction,
    voice,
    options: { ...progress, onEvent: forwardProgress.bind(null, progress.onEvent, onBroadcast) },
    onIncluded,
  });
}

async function signVoiceApprovedMessage(
  deps: HandlerDeps,
  requestId: string | undefined,
  walletId: WalletId,
  ownerAccountId: string,
  action: SpokenMessageAction,
  verdict: SignedVoiceVerdict,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  return await signNep413Message({
    context: deps.getWalletRuntime().getContext(),
    nearAccountId: nearAccountRefFromAccountId(ownerAccountId).accountId,
    walletSession: { walletId, walletSessionUserId: String(walletId) },
    params: {
      message: action.message,
      recipient: action.recipient,
      ...(action.callbackUrl === null ? {} : { callbackUrl: action.callbackUrl }),
      ...(action.state === null ? {} : { state: action.state }),
    },
    options: withProgress(deps, requestId, {}),
    voice: { nonce: action.nonce, verdict },
  });
}

/** Forwards each signing event to the app and tells the open prompt when the broadcast starts. */
function forwardProgress(
  post: (payload: ProgressPayload) => void,
  onBroadcast: () => void,
  payload: ProgressPayload,
): void {
  post(payload);
  if ('phase' in payload && payload.phase === SigningEventPhase.STEP_12_BROADCAST_STARTED) {
    onBroadcast();
  }
}

async function signMessage(
  deps: HandlerDeps,
  requestId: string | undefined,
  walletId: WalletId,
  ownerAccountId: string,
  params: Readonly<{ message: string; recipient: string }>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  return await deps.getWalletRuntime().near.signMessage({
    walletSession: { walletId, walletSessionUserId: String(walletId) },
    nearAccount: nearAccountRefFromAccountId(ownerAccountId),
    params: { message: params.message, recipient: params.recipient },
    options: withProgress(deps, requestId, {}),
  });
}

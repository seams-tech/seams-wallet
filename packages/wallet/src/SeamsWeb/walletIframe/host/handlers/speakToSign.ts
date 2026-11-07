import type { AuthMethodAvailability } from '@/core/authMethods/availabilityTypes';
import type {
  AuthMethodPhraseRequest,
  WalletAuthMethodHostPlugin,
} from '@/core/authMethods/hostPlugin';
import type { WalletAuthMethodPlugin } from '@/core/authMethods/plugins';
import {
  nearAccountRefFromAccountId,
  toWalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type {
  SpeakToSignHostPlugin,
  SpeakToSignTransferResult,
} from '@/core/transactionFeatures/hostPlugin';
import { createSpeakToSignHostOperations } from '@/core/transactionFeatures/hostOperations';
import {
  findWalletTransactionFeature,
  type WalletTransactionFeaturePlugin,
} from '@/core/transactionFeatures/plugins';
import type { TransactionInput } from '@/core/types/actions';
import type { WalletId } from '@shared/utils/domainIds';
import type { PMSpeakToSignTransferPayload } from '../../shared/speakToSign';
import { respondOkResult, withProgress } from './shared';
import type { HandlerDeps, HandlerMap, Req } from './walletIframeHandler.types';

/** The browser stores and loader that the handler reads. Tests pass fakes. */
export type SpeakToSignWalletPorts = Readonly<{
  readVoiceIdAvailability(walletId: WalletId): Promise<AuthMethodAvailability>;
  readOperationCredential(walletId: WalletId): Promise<string>;
  loadHost(features: readonly WalletTransactionFeaturePlugin[]): Promise<SpeakToSignHostPlugin>;
  /** The VoiceID host plugin records the clip, so its prompt and models load from VoiceID. */
  loadVoiceIdHost(methods: readonly WalletAuthMethodPlugin[]): Promise<WalletAuthMethodHostPlugin>;
  fetch: typeof fetch;
}>;

/** The host checks cancellation by request id, so the handler turns it into a signal. */
const CANCELLATION_POLL_MS = 200;

export function createSpeakToSignWalletIframeHandlers(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
): HandlerMap {
  return { PM_SPEAK_TO_SIGN_TRANSFER: handleSpeakToSignTransfer.bind(null, deps, ports) };
}

async function handleSpeakToSignTransfer(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
  request: Req<'PM_SPEAK_TO_SIGN_TRANSFER'>,
): Promise<void> {
  const controller = new AbortController();
  const timer = setInterval(
    abortWhenCancelled.bind(null, deps, request.requestId, controller),
    CANCELLATION_POLL_MS,
  );
  try {
    const result = await runTransfer(deps, ports, request, controller.signal);
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

async function runTransfer(
  deps: HandlerDeps,
  ports: SpeakToSignWalletPorts,
  request: Req<'PM_SPEAK_TO_SIGN_TRANSFER'>,
  signal: AbortSignal,
): Promise<SpeakToSignTransferResult> {
  const payload: PMSpeakToSignTransferPayload = request.payload;
  const runtime = deps.getWalletRuntime();
  const features = runtime.configs.transactionFeatures;
  const feature = findWalletTransactionFeature(features, 'speak_to_sign');
  if (!feature) throw new Error('Enable Speak-to-Sign in the SDK configuration before using it.');
  const walletId = toWalletId(payload.walletId);

  // The verifier compares the sentence with the owner's VoiceID template.
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
    signAndSendTransaction: signAndSend.bind(null, deps, request.requestId, walletId, ownerAccountId),
    recordPhrase: recordPhrase.bind(null, ports, runtime.configs.authMethods),
    fetch: ports.fetch,
  });
  return await plugin.requestTransfer({
    walletId,
    vault: feature.vault,
    network: feature.network,
    signal,
    transfer: {
      ownerAccountId,
      receiver: payload.receiver,
      amount: payload.amount,
      surfaceMeasurementBinding: deps.surfaceMeasurementBinding(),
      operations,
    },
  });
}

async function readCredential(
  ports: SpeakToSignWalletPorts,
  walletId: WalletId,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  return await ports.readOperationCredential(walletId);
}

async function recordPhrase(
  ports: SpeakToSignWalletPorts,
  methods: readonly WalletAuthMethodPlugin[],
  request: AuthMethodPhraseRequest,
) {
  const voiceId = await ports.loadVoiceIdHost(methods);
  request.signal.throwIfAborted();
  return await voiceId.recordPhrase(request);
}

async function signAndSend(
  deps: HandlerDeps,
  requestId: string | undefined,
  walletId: WalletId,
  ownerAccountId: string,
  transaction: TransactionInput,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  return await deps.getWalletRuntime().near.signAndSendTransaction({
    walletSession: { walletId, walletSessionUserId: String(walletId) },
    nearAccount: nearAccountRefFromAccountId(ownerAccountId),
    receiverId: transaction.receiverId,
    actions: transaction.actions,
    options: withProgress(deps, requestId, {}),
  });
}

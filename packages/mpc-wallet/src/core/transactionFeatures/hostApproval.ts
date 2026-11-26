// What the Speak-to-Sign host plugin gets for one spoken request or one enrollment. Core binds
// the owner, the sentence and the thing to sign before it calls the plugin, so the plugin
// passes none of them back:
//   - `record` takes no sentence: core opened the card with the sentence of the intent;
//   - `verify` takes a clip handle only: core builds the verifier input and seals the audio;
//   - `sign` takes no intent: core signs the intent of this flow, or nothing;
//   - the plugin holds no audio: a handle has no bytes, and core keeps the recording.
// The operations stop when the plugin's call settles. The plugin runs in the Wallet origin, so
// this is a rule for its author and not a wall. A fault in the plugin cannot sign another
// intent or send a recording.

import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import { base64Encode } from '@shared/utils/base64';
import type { WalletId } from '@shared/utils/domainIds';
import { signingForm } from './hostOperations';
import type {
  SpeakToSignApprovalResult,
  SpeakToSignClipHandle,
  SpeakToSignEnrollmentRecording,
  SpeakToSignEnrollmentReply,
  SpeakToSignEnrollmentResult,
  SpeakToSignHostOperations,
  SpeakToSignHostPlugin,
  SpeakToSignPaymentHooks,
  SpeakToSignPrompt,
  SpeakToSignRecording,
  SpeakToSignRequestView,
  SpeakToSignSigning,
  SpeakToSignVerifyReply,
} from './hostPlugin';
import type { SpeakToSignNetwork } from './plugins';
import {
  intentRefusal,
  intentVerifyRequest,
  renderIntent,
  type SpokenIntent,
} from './spokenIntent';
import { displayAmount } from './spokenTransfer';

const YOCTO_PER_HUNDREDTH = 10n ** 22n;

/** The owner reads these three phrases. The verifier needs exactly three recordings. */
export const ENROLLMENT_PHRASES = [
  'My voice is my signature for this wallet.',
  'I send money only when I say so.',
  'Please learn how I sound today.',
] as const;

/** What every flow of the plugin needs from the Wallet route. */
type FlowInput = Readonly<{
  plugin: SpeakToSignHostPlugin;
  /** Core's own operations of this flow. The plugin never gets them. */
  operations: SpeakToSignHostOperations;
  walletId: WalletId;
  network: SpeakToSignNetwork;
  ownerAccountId: string;
  /** Core's signal. The operations check it, whatever the plugin does with its copy. */
  signal: AbortSignal;
  surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
  /** Each card of the flow records when it opens, with no press on Record. The app chose it. */
  autoStart: boolean;
}>;

/** The recordings of one flow, by handle. Only core reads them. */
class FlowClips {
  private readonly audio = new Map<SpeakToSignClipHandle, Uint8Array<ArrayBuffer>>();

  add(
    wav: Uint8Array<ArrayBuffer>,
    speechMs: number,
    endOfSpeechAt: number,
  ): SpeakToSignClipHandle {
    const handle: SpeakToSignClipHandle = Object.freeze({
      kind: 'captured',
      speechMs,
      endOfSpeechAt,
    });
    this.audio.set(handle, wav);
    return handle;
  }

  /** The audio of a handle of this flow, or null for any other object. */
  read(handle: SpeakToSignClipHandle): Uint8Array<ArrayBuffer> | null {
    return this.audio.get(handle) ?? null;
  }

  /** Sets the audio of the handle to zero. The handle then names no recording. */
  clear(handle: SpeakToSignClipHandle): void {
    this.audio.get(handle)?.fill(0);
    this.audio.delete(handle);
  }

  clearAll(): void {
    for (const wav of this.audio.values()) wav.fill(0);
    this.audio.clear();
  }
}

/**
 * The time in which the plugin may use its operations: until its call settles. After that, a
 * new operation throws, a late recording is cleared, and core waits for a signature that is
 * still in progress before it answers the application.
 */
class Lease {
  live = true;
  /** Resolves when the flow ends. A hook of the plugin that still waits then answers "no". */
  readonly ended: Promise<void>;
  private finish: () => void = () => {};
  private readonly open = new Set<Promise<unknown>>();

  constructor() {
    this.ended = new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  /** Throws when the flow ended or core's signal aborted. */
  use(signal: AbortSignal): void {
    if (!this.live) throw new Error('This Speak-to-Sign flow has ended.');
    signal.throwIfAborted();
  }

  /** An operation that must finish before the flow answers, such as a signature. */
  track<T>(operation: Promise<T>): Promise<T> {
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    this.open.add(settled);
    void settled.then(() => this.open.delete(settled));
    return operation;
  }

  /** Ends the flow and waits for the tracked operations. */
  async end(): Promise<void> {
    this.live = false;
    this.finish();
    await Promise.all(this.open);
  }
}

/**
 * Runs one spoken request: core refuses what it cannot sign, opens the card with the sentence
 * of the intent and gives the plugin the bound operations.
 */
export async function runSpeakToSignApproval(
  input: FlowInput & Readonly<{ intent: SpokenIntent }>,
): Promise<SpeakToSignApprovalResult> {
  const { intent, operations, signal } = input;
  signal.throwIfAborted();
  const refusal = intentRefusal(input.network, intent);
  if (refusal) return { kind: 'refused', reason: refusal };
  if (intent.kind === 'account_transfer') {
    // A transfer to a missing account would fail on chain, after the verifier ran.
    const missing = await receiverRefusal(operations, intent.receiver, signal);
    if (missing) return missing;
  }
  const rendered = renderIntent(intent);
  const verifyRequest = await intentVerifyRequest(intent);
  signal.throwIfAborted();
  const opened = await operations.openPrompt({
    sentence: rendered.displayText,
    // A note's card shows the note above its summary, so the author sees what the words sign.
    ...(intent.kind === 'community_note' ? { context: { label: 'Your note', text: intent.text } } : {}),
    autoStart: input.autoStart,
    signal,
    surfaceMeasurementBinding: input.surfaceMeasurementBinding,
  });
  if (opened.kind === 'unavailable') return voiceIdUnavailable(opened.detail);
  const { prompt } = opened;
  const clips = new FlowClips();
  const lease = new Lease();
  try {
    return await input.plugin.approve({
      walletId: input.walletId,
      network: input.network,
      signal,
      ownerAccountId: input.ownerAccountId,
      request: requestView(intent, rendered),
      surface: {
        show: async (view) => {
          lease.use(signal);
          return await prompt.show(view);
        },
      },
      operations: {
        record: async () => {
          lease.use(signal);
          return await recordHandle(prompt, clips, lease);
        },
        verify: async (clip) => {
          lease.use(signal);
          const wav = clips.read(clip);
          if (!wav) return { kind: 'failed', code: 'unknown_recording' };
          try {
            return await operations.verify(
              {
                op: 'verify',
                owner: input.ownerAccountId,
                request: verifyRequest,
                contacts: [],
                audio_wav_b64: base64Encode(wav),
              },
              signal,
            );
          } finally {
            clips.clear(clip);
          }
        },
        sign: async (verifierOutput, hooks) => {
          lease.use(signal);
          // A step-up question that the plugin still shows when the flow ends is a "no".
          const bound: SpeakToSignPaymentHooks = {
            ...hooks,
            approveStepUp: async (policyText) =>
              await Promise.race([
                hooks.approveStepUp(policyText),
                lease.ended.then(() => false),
              ]),
          };
          return await lease.track(signIntent(operations, intent, verifierOutput, signal, bound));
        },
      },
    });
  } finally {
    // The card closes first, so a recording that still waits ends. A signature in progress
    // finishes before the application gets its answer.
    prompt.close();
    await lease.end();
    clips.clearAll();
  }
}

/** The one operation of core that signs this intent. The plugin cannot choose another. */
async function signIntent(
  operations: SpeakToSignHostOperations,
  intent: SpokenIntent,
  verifierOutput: unknown,
  signal: AbortSignal,
  hooks: SpeakToSignPaymentHooks,
): Promise<SpeakToSignSigning> {
  if (intent.kind === 'account_transfer') {
    return await operations.payWithVerdict(intent, verifierOutput, signal, hooks);
  }
  if (intent.kind === 'signed_message') {
    return await operations.signMessageWithVerdict(intent.message, verifierOutput, signal, hooks);
  }
  return await operations.signNoteWithVerdict(intent, verifierOutput, signal, hooks);
}

function requestView(
  intent: SpokenIntent,
  rendered: Readonly<{ displayText: string; spokenText: string }>,
): SpeakToSignRequestView {
  const view = {
    kind: intent.kind,
    form: signingForm(intent),
    displayText: rendered.displayText,
    spokenText: rendered.spokenText,
    counterparty: null,
    amount: null,
    summary: null,
  };
  switch (intent.kind) {
    case 'account_transfer':
      return {
        ...view,
        counterparty: intent.receiver,
        amount: displayAmount(intent.amountYocto / YOCTO_PER_HUNDREDTH),
      };
    case 'transaction':
      return { ...view, counterparty: intent.transaction.receiverId };
    case 'signed_message':
      return { ...view, counterparty: intent.message.recipient };
    case 'community_note':
      return { ...view, summary: intent.summary };
    default:
      return view;
  }
}

async function receiverRefusal(
  operations: SpeakToSignHostOperations,
  receiver: string,
  signal: AbortSignal,
): Promise<Extract<SpeakToSignApprovalResult, { kind: 'refused' | 'unavailable' }> | null> {
  try {
    if (await operations.receiverExists(receiver, signal)) return null;
  } catch (error) {
    signal.throwIfAborted();
    const detail = error instanceof Error ? error.message.slice(0, 200) : 'account view failed';
    return { kind: 'unavailable', reason: 'verifier_unavailable', detail };
  }
  return { kind: 'refused', reason: 'receiver_missing' };
}

async function recordHandle(
  prompt: SpeakToSignPrompt,
  clips: FlowClips,
  lease: Lease,
): Promise<SpeakToSignRecording> {
  const clip = await prompt.record();
  if (clip.kind !== 'captured') return clip;
  if (!lease.live) {
    // The flow ended while the owner spoke. No one can use this recording.
    clip.wav.fill(0);
    throw new Error('This Speak-to-Sign flow has ended.');
  }
  return clips.add(clip.wav, clip.speechMs, clip.endOfSpeechAt);
}

function voiceIdUnavailable(
  detail: string,
): Readonly<{ kind: 'unavailable'; reason: 'voiceid_unavailable'; detail: string }> {
  return { kind: 'unavailable', reason: 'voiceid_unavailable', detail };
}

/**
 * Runs one enrollment. `adopted` holds the samples of the VoiceID enrollment that this flow
 * made just before, or null: with them, the owner records nothing more.
 */
export async function runSpeakToSignEnrollment(
  input: FlowInput &
    Readonly<{ adopted: readonly SpeakToSignEnrollmentRecording[] | null }>,
): Promise<SpeakToSignEnrollmentResult> {
  const { operations, signal, adopted } = input;
  signal.throwIfAborted();
  const clips = new FlowClips();
  const lease = new Lease();
  let card: SpeakToSignPrompt | null = null;
  const open = async (sentence: string) => {
    card?.close();
    card = null;
    const opened = await operations.openPrompt({
      sentence,
      autoStart: input.autoStart,
      signal,
      surfaceMeasurementBinding: input.surfaceMeasurementBinding,
    });
    if (opened.kind === 'opened') card = opened.prompt;
    return opened;
  };
  try {
    // Core holds the adopted audio from the first statement, so every exit clears it. Another
    // count than the verifier needs cannot be enrolled: the owner then records the phrases.
    const adoptedHandles = (adopted ?? []).map((recording) => clips.add(recording.wav, 0, 0));
    let handles: SpeakToSignClipHandle[] | null = null;
    if (adopted && adopted.length === ENROLLMENT_PHRASES.length) {
      // The card opens on the last sentence that the owner read for VoiceID.
      const sentence = adopted.at(-1)?.sentence || ENROLLMENT_PHRASES[ENROLLMENT_PHRASES.length - 1];
      const opened = await open(sentence);
      if (opened.kind === 'unavailable') return voiceIdUnavailable(opened.detail);
      handles = adoptedHandles;
    }
    return await input.plugin.enroll({
      walletId: input.walletId,
      network: input.network,
      signal,
      ownerAccountId: input.ownerAccountId,
      phraseCount: ENROLLMENT_PHRASES.length,
      clips: handles,
      operations: {
        record: async (index) => {
          lease.use(signal);
          const sentence = ENROLLMENT_PHRASES[index];
          if (sentence === undefined) throw new RangeError('No such enrollment phrase.');
          const opened = await open(sentence);
          if (opened.kind === 'unavailable') return opened;
          return await recordHandle(opened.prompt, clips, lease);
        },
        show: async (view) => {
          lease.use(signal);
          if (!card) throw new Error('No enrollment card is open.');
          return await card.show(view);
        },
        enrollClips: async (enrolled, onAuthorized) => {
          lease.use(signal);
          return await lease.track(enrollClips(input, clips, enrolled, onAuthorized));
        },
      },
    });
  } finally {
    (card as SpeakToSignPrompt | null)?.close();
    await lease.end();
    clips.clearAll();
  }
}

/** The owner signs for exactly these clips of the flow, then core sends them, sealed. */
async function enrollClips(
  input: FlowInput,
  clips: FlowClips,
  enrolled: readonly SpeakToSignClipHandle[],
  onAuthorized: () => void,
): Promise<SpeakToSignEnrollmentReply> {
  const { operations, signal } = input;
  const wavs: Uint8Array<ArrayBuffer>[] = [];
  for (const handle of new Set(enrolled)) {
    const wav = clips.read(handle);
    if (!wav) return { kind: 'not_signed', error: 'Only recordings of this enrollment can be enrolled.' };
    wavs.push(wav);
  }
  // Core checks the count and that it recorded each clip in this flow.
  const signed = await operations.authorizeEnrollment(wavs, signal);
  if (signed.kind === 'not_signed') return signed;
  onAuthorized();
  let reply: SpeakToSignVerifyReply;
  try {
    reply = await operations.verify(
      {
        op: 'enroll',
        owner: input.ownerAccountId,
        audio_wav_b64: wavs.map(base64Encode),
        authorization: signed.authorization,
      },
      signal,
    );
  } finally {
    for (const handle of enrolled) clips.clear(handle);
  }
  return reply;
}

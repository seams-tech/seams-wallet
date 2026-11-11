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

/** Throws once the plugin's call settled, so that operations which it kept do nothing. */
type Lease = { live: boolean };

function use(lease: Lease, signal: AbortSignal): void {
  if (!lease.live) throw new Error('This Speak-to-Sign flow has ended.');
  signal.throwIfAborted();
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
    signal,
    surfaceMeasurementBinding: input.surfaceMeasurementBinding,
  });
  if (opened.kind === 'unavailable') return voiceIdUnavailable(opened.detail);
  const { prompt } = opened;
  const clips = new FlowClips();
  const lease: Lease = { live: true };
  try {
    return await input.plugin.approve({
      walletId: input.walletId,
      network: input.network,
      signal,
      ownerAccountId: input.ownerAccountId,
      request: requestView(intent, rendered),
      surface: {
        show: async (view) => {
          use(lease, signal);
          return await prompt.show(view);
        },
      },
      operations: {
        record: async () => {
          use(lease, signal);
          return await recordHandle(prompt, clips);
        },
        verify: async (clip) => {
          use(lease, signal);
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
          use(lease, signal);
          return await signIntent(operations, intent, verifierOutput, signal, hooks);
        },
      },
    });
  } finally {
    lease.live = false;
    clips.clearAll();
    prompt.close();
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
): Promise<SpeakToSignRecording> {
  const clip = await prompt.record();
  if (clip.kind !== 'captured') return clip;
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
  const lease: Lease = { live: true };
  let card: SpeakToSignPrompt | null = null;
  const open = async (sentence: string) => {
    card?.close();
    card = null;
    const opened = await operations.openPrompt({
      sentence,
      signal,
      surfaceMeasurementBinding: input.surfaceMeasurementBinding,
    });
    if (opened.kind === 'opened') card = opened.prompt;
    return opened;
  };
  try {
    let handles: SpeakToSignClipHandle[] | null = null;
    if (adopted) {
      // The card opens on the last sentence that the owner read for VoiceID.
      const sentence = adopted.at(-1)?.sentence || ENROLLMENT_PHRASES[ENROLLMENT_PHRASES.length - 1];
      const opened = await open(sentence);
      if (opened.kind === 'unavailable') return voiceIdUnavailable(opened.detail);
      handles = adopted.map((recording) => clips.add(recording.wav, 0, 0));
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
          use(lease, signal);
          const sentence = ENROLLMENT_PHRASES[index];
          if (sentence === undefined) throw new RangeError('No such enrollment phrase.');
          const opened = await open(sentence);
          if (opened.kind === 'unavailable') return opened;
          return await recordHandle(opened.prompt, clips);
        },
        show: async (view) => {
          use(lease, signal);
          if (!card) throw new Error('No enrollment card is open.');
          return await card.show(view);
        },
        enrollClips: async (enrolled, onAuthorized) => {
          use(lease, signal);
          return await enrollClips(input, clips, enrolled, onAuthorized);
        },
      },
    });
  } finally {
    lease.live = false;
    clips.clearAll();
    (card as SpeakToSignPrompt | null)?.close();
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

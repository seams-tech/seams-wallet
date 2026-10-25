import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceBeam } from 'voice-glow';
import { MicrophonePreview } from './microphone';
import { FRAME_MS, VoiceCapture } from './voiceCapture';
import { Waveform, type TracePhase } from './Waveform';
import './style.css';

const INITIAL_PHRASE = 'Let us go home now.';
const RETRY_PHRASE = 'I can hear the music.';
type Phrase = typeof INITIAL_PHRASE | typeof RETRY_PHRASE;
type State =
  | { kind: 'ready'; phrase: Phrase }
  | { kind: 'opening'; phrase: Phrase }
  | { kind: 'listening'; phrase: Phrase; source: 'microphone' | 'demo' }
  | { kind: 'checking'; phrase: Phrase }
  | { kind: 'approved'; phrase: Phrase }
  | { kind: 'retry'; phrase: Phrase }
  | { kind: 'captured'; phrase: Phrase }
  | { kind: 'error'; phrase: Phrase; message: string }
  | { kind: 'cancelled'; phrase: Phrase };
type Update = React.Dispatch<React.SetStateAction<State>>;

const stages: ReadonlyArray<{ label: string; state: State }> = [
  { label: 'Ready', state: { kind: 'ready', phrase: INITIAL_PHRASE } },
  { label: 'Listening demo', state: { kind: 'listening', phrase: INITIAL_PHRASE, source: 'demo' } },
  { label: 'Checking', state: { kind: 'checking', phrase: INITIAL_PHRASE } },
  { label: 'Approved', state: { kind: 'approved', phrase: INITIAL_PHRASE } },
  { label: 'Retry', state: { kind: 'retry', phrase: RETRY_PHRASE } },
];

// Generated speech for the Listening demo and the stage buttons: four words over
// room tone, a desk tap in the pause, then the pause that ends the capture.
const DEMO_WORDS: ReadonlyArray<readonly [number, number]> = [
  [500, 780],
  [840, 1_060],
  [1_140, 1_420],
  [1_500, 2_250],
];
const DEMO_TAP_MS = 3_000;
const DEMO_REPEAT_MS = 900;

function demoRms(ms: number): number {
  let speech = 0;
  for (const [from, to] of DEMO_WORDS) {
    if (ms <= from || ms >= to) continue;
    const word = Math.sin(((ms - from) / (to - from)) * Math.PI) ** 0.6;
    speech = 0.055 * word * (0.75 + 0.25 * Math.sin(ms / 37));
  }
  const room = 0.0018 * (0.75 + 0.5 * Math.abs(Math.sin(ms / 23) * Math.sin(ms / 71)));
  const tap = Math.abs(ms - DEMO_TAP_MS) < FRAME_MS ? 0.009 : 0;
  return Math.hypot(speech, room, tap);
}

function recordDemo(): VoiceCapture {
  const capture = new VoiceCapture();
  while (!capture.ended) capture.push(demoRms(capture.frames.length * FRAME_MS));
  return capture;
}

class DemoSpeech {
  // A finished capture for the Checking, Approved and Retry stages.
  private readonly finished = recordDemo();
  private current = new VoiceCapture();
  private startedAt = performance.now();

  restart(): void {
    this.current = new VoiceCapture();
    this.startedAt = performance.now();
  }

  // Frames follow the clock; the demo starts again shortly after each capture ends.
  readonly capture = (): VoiceCapture => {
    const repeatAt = this.startedAt + this.current.frames.length * FRAME_MS + DEMO_REPEAT_MS;
    if (this.current.ended && performance.now() > repeatAt) this.restart();
    const due = Math.floor((performance.now() - this.startedAt) / FRAME_MS);
    while (this.current.frames.length < due && !this.current.ended)
      this.current.push(demoRms(this.current.frames.length * FRAME_MS));
    return this.current;
  };

  readonly finishedCapture = (): VoiceCapture => this.finished;

  readonly level = (): number => this.capture().level();
}

function createMicrophone(): MicrophonePreview {
  return new MicrophonePreview();
}
function createDemo(): DemoSpeech {
  return new DemoSpeech();
}
function cleanup(microphone: MicrophonePreview): () => void {
  return microphone.stop;
}
function silent(): number {
  return 0;
}
function noCapture(): null {
  return null;
}
function levelSource(state: State, microphone: MicrophonePreview, demo: DemoSpeech): () => number {
  if (state.kind !== 'listening') return silent;
  return state.source === 'microphone' ? microphone.level : demo.level;
}

function captureSource(
  state: State,
  microphone: MicrophonePreview,
  demo: DemoSpeech,
): () => VoiceCapture | null {
  switch (state.kind) {
    case 'listening':
      return state.source === 'microphone' ? microphone.capture : demo.capture;
    case 'captured':
      return microphone.capture;
    case 'checking':
    case 'approved':
    case 'retry':
      return demo.finishedCapture;
    case 'ready':
    case 'opening':
    case 'error':
    case 'cancelled':
      return noCapture;
    default:
      return assertNever(state);
  }
}

function tracePhase(state: State): TracePhase {
  switch (state.kind) {
    case 'listening':
      return 'live';
    case 'captured':
    case 'checking':
    case 'approved':
    case 'retry':
      return state.kind;
    case 'ready':
    case 'opening':
    case 'error':
    case 'cancelled':
      return 'rest';
    default:
      return assertNever(state);
  }
}

function show(microphone: MicrophonePreview, demo: DemoSpeech, update: Update, state: State): void {
  microphone.stop();
  if (state.kind === 'listening') demo.restart();
  update(state);
}

function failed(update: Update, phrase: Phrase, message: string): void {
  update({ kind: 'error', phrase, message });
}

function record(microphone: MicrophonePreview, update: Update, phrase: Phrase): void {
  update({ kind: 'opening', phrase });
  void microphone.start(
    update.bind(null, { kind: 'listening', phrase, source: 'microphone' }),
    update.bind(null, { kind: 'captured', phrase }),
    failed.bind(null, update, phrase),
  );
}

function status(state: State): string {
  switch (state.kind) {
    case 'ready':
      return 'Start recording when you’re ready';
    case 'opening':
      return 'Opening microphone…';
    case 'listening':
      return state.source === 'microphone' ? 'Listening' : 'Listening · demo';
    case 'checking':
      return 'Checking your voice…';
    case 'approved':
      return 'Voice verified';
    case 'retry':
      return 'Words didn’t match. Try this phrase.';
    case 'captured':
      return 'Recording complete · preview only';
    case 'error':
      return state.message;
    case 'cancelled':
      return 'Recording cancelled';
    default:
      return assertNever(state);
  }
}

function canRecord(state: State): boolean {
  switch (state.kind) {
    case 'ready':
    case 'retry':
    case 'captured':
    case 'error':
    case 'cancelled':
      return true;
    case 'opening':
    case 'listening':
    case 'checking':
    case 'approved':
      return false;
    default:
      return assertNever(state);
  }
}

function assertNever(state: never): never {
  throw new Error(`Unexpected preview state: ${String(state)}`);
}

function MicrophoneIcon(): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1M12 18v3M9 21h6" />
    </svg>
  );
}

function StageButton(
  microphone: MicrophonePreview,
  demo: DemoSpeech,
  update: Update,
  current: State,
  stage: (typeof stages)[number],
): React.ReactNode {
  return (
    <button
      key={stage.label}
      aria-pressed={current.kind === stage.state.kind}
      onClick={show.bind(null, microphone, demo, update, stage.state)}
    >
      {stage.label}
    </button>
  );
}

function App(): React.ReactNode {
  const [state, update] = useState<State>({ kind: 'ready', phrase: INITIAL_PHRASE });
  const [microphone] = useState(createMicrophone);
  const [demo] = useState(createDemo);
  useEffect(cleanup.bind(null, microphone), [microphone]);
  const level = levelSource(state, microphone, demo);
  return (
    <div className="preview">
      <header className="preview-header">
        <span className="wordmark">seams</span>
        <span>VoiceID · Voice prompt</span>
        <span className="concept-tag">Interactive preview</span>
      </header>
      <main>
        <p className="context">AFTER TRANSACTION REVIEW</p>
        <section className="voice-card" aria-label="Voice prompt preview" data-state={state.kind}>
          <VoiceBeam
            className="voice-beam"
            theme="dark"
            level={level}
            active={state.kind === 'listening' || state.kind === 'checking'}
            processing={state.kind === 'checking'}
            idle={0}
            scale={0.6}
            style={{ borderRadius: 28 }}
          >
            <button
              className="close"
              aria-label="Cancel recording"
              onClick={show.bind(null, microphone, demo, update, {
                kind: 'cancelled',
                phrase: state.phrase,
              })}
            >
              ×
            </button>
            <div className="voice-content">
              <h1>Read aloud</h1>
              <p className="phrase">{state.phrase}</p>
              <Waveform
                capture={captureSource(state, microphone, demo)}
                phase={tracePhase(state)}
              />
              <p className="status" role="status" aria-live="polite">
                {status(state)}
              </p>
              <div className="record-slot">
                {canRecord(state) ? (
                  <button
                    className="record"
                    onClick={record.bind(null, microphone, update, state.phrase)}
                  >
                    <MicrophoneIcon />
                    {state.kind === 'ready' ? 'Record' : 'Record again'}
                  </button>
                ) : null}
              </div>
            </div>
          </VoiceBeam>
        </section>
        <p className="privacy">Audio stays on this device.</p>
      </main>
      <footer className="preview-controls">
        <div role="group" aria-label="Preview states">
          {stages.map(StageButton.bind(null, microphone, demo, update, state))}
        </div>
        <p>
          Select Record for live microphone feedback.
          <br />
          This preview checks no identity and sends no transaction.
        </p>
      </footer>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Preview root is unavailable');
createRoot(root).render(<App />);

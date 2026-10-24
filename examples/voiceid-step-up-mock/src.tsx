import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceBeam } from 'voice-glow';
import { MicrophonePreview } from './microphone';
import { Waveform } from './Waveform';
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

function createMicrophone(): MicrophonePreview {
  return new MicrophonePreview();
}
function cleanup(microphone: MicrophonePreview): () => void {
  return microphone.stop;
}
function silent(): number {
  return 0;
}
function demoLevel(): number {
  const time = performance.now() / 1_000;
  return Math.max(0, Math.sin(time * 1.7)) * (0.2 + 0.65 * Math.abs(Math.sin(time * 9.3)));
}
function levelSource(state: State, microphone: MicrophonePreview): () => number {
  if (state.kind !== 'listening') return silent;
  return state.source === 'microphone' ? microphone.level : demoLevel;
}

function show(microphone: MicrophonePreview, update: Update, state: State): void {
  microphone.stop();
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
  update: Update,
  current: State,
  stage: (typeof stages)[number],
): React.ReactNode {
  return (
    <button
      key={stage.label}
      aria-pressed={current.kind === stage.state.kind}
      onClick={show.bind(null, microphone, update, stage.state)}
    >
      {stage.label}
    </button>
  );
}

function App(): React.ReactNode {
  const [state, update] = useState<State>({ kind: 'ready', phrase: INITIAL_PHRASE });
  const [microphone] = useState(createMicrophone);
  useEffect(cleanup.bind(null, microphone), [microphone]);
  const level = levelSource(state, microphone);
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
              onClick={show.bind(null, microphone, update, {
                kind: 'cancelled',
                phrase: state.phrase,
              })}
            >
              ×
            </button>
            <div className="voice-content">
              <h1>Read aloud</h1>
              <p className="phrase">{state.phrase}</p>
              <Waveform level={level} />
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
          {stages.map(StageButton.bind(null, microphone, update, state))}
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

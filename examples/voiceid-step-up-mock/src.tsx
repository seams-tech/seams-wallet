import React, { useEffect, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceBeam } from 'voice-glow';
import './style.css';

const INITIAL_PHRASE = 'Let us go home now.';
const RETRY_PHRASE = 'I can hear the music.';
type Phrase = typeof INITIAL_PHRASE | typeof RETRY_PHRASE;
type State =
  | { kind: 'preparing'; progress: number }
  | { kind: 'ready'; phrase: Phrase }
  | { kind: 'listening'; seconds: number; phrase: Phrase }
  | { kind: 'verifying'; phrase: Phrase }
  | { kind: 'approved'; phrase: Phrase }
  | { kind: 'retry'; phrase: Phrase }
  | { kind: 'cancelled' };
type Action = { kind: 'show'; state: State } | { kind: 'tick' };
type Dispatch = React.Dispatch<Action>;

const stages: ReadonlyArray<{ label: string; state: State }> = [
  { label: 'Prepare', state: { kind: 'preparing', progress: 35 } },
  { label: 'Ready', state: { kind: 'ready', phrase: INITIAL_PHRASE } },
  { label: 'Listening', state: { kind: 'listening', seconds: 8, phrase: INITIAL_PHRASE } },
  { label: 'Verifying', state: { kind: 'verifying', phrase: INITIAL_PHRASE } },
  { label: 'Approved', state: { kind: 'approved', phrase: INITIAL_PHRASE } },
  { label: 'Try again', state: { kind: 'retry', phrase: RETRY_PHRASE } },
];

function reducer(state: State, action: Action): State {
  if (action.kind === 'show') return action.state;
  switch (state.kind) {
    case 'preparing':
      return state.progress >= 95
        ? { kind: 'ready', phrase: INITIAL_PHRASE }
        : { kind: 'preparing', progress: state.progress + 15 };
    case 'listening':
      return state.seconds <= 1
        ? { kind: 'verifying', phrase: state.phrase }
        : { kind: 'listening', seconds: state.seconds - 1, phrase: state.phrase };
    case 'verifying':
      return { kind: 'approved', phrase: state.phrase };
    case 'ready':
    case 'approved':
    case 'retry':
    case 'cancelled':
      return state;
    default:
      return assertNever(state);
  }
}

function advance(dispatch: Dispatch): void {
  dispatch({ kind: 'tick' });
}

function schedule(state: State, dispatch: Dispatch): (() => void) | undefined {
  let delay: number;
  switch (state.kind) {
    case 'preparing':
      delay = 550;
      break;
    case 'listening':
      delay = 1_000;
      break;
    case 'verifying':
      delay = 2_400;
      break;
    case 'ready':
    case 'approved':
    case 'retry':
    case 'cancelled':
      return;
    default:
      return assertNever(state);
  }
  const timer = window.setTimeout(advance.bind(null, dispatch), delay);
  return window.clearTimeout.bind(window, timer);
}

function show(dispatch: Dispatch, state: State): void {
  dispatch({ kind: 'show', state });
}

function simulatedLevel(): number {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0.35;
  const time = performance.now() / 1_000;
  return 0.28 + 0.48 * Math.abs(Math.sin(time * 3.4) * Math.cos(time * 1.3));
}

function presentation(state: State): { title: string; hint: string; button: string } {
  switch (state.kind) {
    case 'preparing':
      return {
        title: 'Preparing VoiceID',
        hint: 'One small download. Saved for next time.',
        button: 'Preparing voice verification…',
      };
    case 'ready':
      return {
        title: 'Confirm with your voice',
        hint: 'Read the phrase after listening starts.',
        button: 'Confirm with voice',
      };
    case 'listening':
      return {
        title: 'Listening to you',
        hint: 'Read slowly, then pause. You have eight seconds.',
        button: `Listening · ${state.seconds}s`,
      };
    case 'verifying':
      return {
        title: 'Checking your voice',
        hint: 'Checking your voice and the spoken phrase.',
        button: 'Verifying…',
      };
    case 'approved':
      return {
        title: 'Voice verified',
        hint: 'Approved for this transfer. Continuing to signing.',
        button: 'Continuing to signing…',
      };
    case 'retry':
      return {
        title: 'The words didn’t match',
        hint: 'Read this new phrase. Your transfer is unchanged.',
        button: 'Try again',
      };
    case 'cancelled':
      return {
        title: 'Verification cancelled',
        hint: 'No transaction was signed or sent in this preview.',
        button: 'Start again',
      };
    default:
      return assertNever(state);
  }
}

function assertNever(state: never): never {
  throw new Error(`Unexpected preview state: ${String(state)}`);
}

function MicIcon(): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1M12 18v3M9 21h6" />
    </svg>
  );
}

function LockIcon(): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="10" width="14" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function CheckIcon(): React.ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}

function StageButton(
  dispatch: Dispatch,
  current: State,
  stage: (typeof stages)[number],
): React.ReactNode {
  return (
    <button
      key={stage.label}
      className="stage-button"
      aria-pressed={current.kind === stage.state.kind}
      onClick={show.bind(null, dispatch, stage.state)}
    >
      {stage.label}
    </button>
  );
}

function App(): React.ReactNode {
  const [state, dispatch] = useReducer(reducer, { kind: 'ready', phrase: INITIAL_PHRASE });
  useEffect(schedule.bind(null, state, dispatch), [state]);
  const copy = presentation(state);
  const busy =
    state.kind === 'preparing' ||
    state.kind === 'listening' ||
    state.kind === 'verifying' ||
    state.kind === 'approved';
  const phrase = 'phrase' in state ? state.phrase : INITIAL_PHRASE;
  return (
    <div className="preview">
      <header className="preview-header">
        <a className="wordmark" href="#">
          seams<span>◈</span>
        </a>
        <span className="preview-title">VoiceID / Step-up approval</span>
        <span className="concept-tag">Interactive concept</span>
      </header>
      <main className="stage">
        <aside className="design-note">
          <span className="eyebrow">VOICEID · UI INTEGRATION</span>
          <h1>
            Your voice.
            <br />
            This transfer.
          </h1>
          <p>
            Keep the transaction in view.
            <br />
            Make the next action clear.
          </p>
          <div className="design-rule">
            <span>01</span>
            <div>
              <strong>One review surface</strong>
              <p>Amount, recipient, and voice approval stay together.</p>
            </div>
          </div>
          <div className="design-rule">
            <span>02</span>
            <div>
              <strong>A phrase with room to breathe</strong>
              <p>Large, readable words. A clear listening state.</p>
            </div>
          </div>
          <div className="design-rule">
            <span>03</span>
            <div>
              <strong>Familiar voice feedback</strong>
              <p>The existing voice-glow responds while you speak.</p>
            </div>
          </div>
          <p className="simulation-note">
            <span />
            Simulated audio. No microphone access.
            <br />
            This preview cannot sign or send.
          </p>
        </aside>
        <section
          className="wallet"
          aria-label="VoiceID transaction review preview"
          data-state={state.kind}
        >
          <header className="wallet-header">
            <span className="origin">
              <LockIcon />
              localhost
            </span>
            <button
              className="close"
              aria-label="Cancel preview"
              onClick={show.bind(null, dispatch, { kind: 'cancelled' })}
            >
              ×
            </button>
          </header>
          <div className="review-heading">
            <span className="eyebrow">TRANSACTION REVIEW</span>
            <h2>Confirm transfer</h2>
          </div>
          <section className="transfer" aria-label="Transfer details">
            <div className="amount-row">
              <span className="near-icon">N</span>
              <div>
                <strong>
                  1 <span>yoctoNEAR</span>
                </strong>
                <small>Smallest NEAR unit</small>
              </div>
              <span className="network">
                <span />
                Testnet
              </span>
            </div>
            <div className="recipient">
              <span>To</span>
              <div>
                <strong>Your account</strong>
                <span className="address">c66c7627…23fe926</span>
              </div>
              <span className="self-tag">Self-transfer</span>
            </div>
            <details>
              <summary>
                Transaction details<span>⌄</span>
              </summary>
              <dl>
                <dt>Recipient</dt>
                <dd>c66c7627b5adb5d43c24692c85fba0e98d06dab9853648943470c99b323fe926</dd>
                <dt>Amount</dt>
                <dd>0.000000000000000000000001 NEAR</dd>
                <dt>Network</dt>
                <dd>NEAR testnet</dd>
              </dl>
            </details>
          </section>
          <VoiceBeam
            className="voice-panel"
            theme="dark"
            level={state.kind === 'listening' ? simulatedLevel : 0}
            active={state.kind === 'listening' || state.kind === 'verifying'}
            processing={state.kind === 'verifying'}
            idle={0}
            style={{ borderRadius: 20 }}
          >
            <div className="voice-content">
              <div className="voice-heading">
                <span className="voice-icon">
                  {state.kind === 'approved' ? <CheckIcon /> : <MicIcon />}
                </span>
                <span>VoiceID</span>
                <span className="local-label">
                  <LockIcon />
                  On this device
                </span>
              </div>
              <div className="voice-status" role="status" aria-live="polite">
                <span className="status-dot" />
                {copy.title}
              </div>
              {state.kind === 'preparing' ? (
                <div className="download">
                  <progress max="100" value={state.progress} aria-label="Phrase model download" />
                  <span>{state.progress}% · Phrase recognition</span>
                </div>
              ) : (
                <p className="phrase">“{phrase}”</p>
              )}
              <p className="hint">{copy.hint}</p>
              <div className="waveform" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
          </VoiceBeam>
          <footer className="wallet-actions">
            <button
              className="primary"
              disabled={busy}
              onClick={show.bind(null, dispatch, { kind: 'listening', seconds: 8, phrase })}
            >
              {state.kind === 'approved' ? <CheckIcon /> : <MicIcon />}
              {copy.button}
            </button>
            <button
              className="cancel"
              disabled={state.kind === 'approved'}
              onClick={show.bind(null, dispatch, { kind: 'cancelled' })}
            >
              Cancel
            </button>
            <p className="privacy">
              <LockIcon />
              Audio stays on your device
            </p>
          </footer>
          <div className="wallet-brand">
            Secured by{' '}
            <strong>
              seams<span>◈</span>
            </strong>
          </div>
        </section>
      </main>
      <footer className="preview-controls">
        <div>
          <span className="eyebrow">PREVIEW A STATE</span>
          <p>Or select Confirm with voice to play the flow.</p>
        </div>
        <div className="state-list" role="group" aria-label="Preview state">
          {stages.map(StageButton.bind(null, dispatch, state))}
        </div>
      </footer>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Preview root is unavailable');
createRoot(root).render(<App />);

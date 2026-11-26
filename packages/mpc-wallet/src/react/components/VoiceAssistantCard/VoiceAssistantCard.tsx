import React from 'react';
import { VoiceBeam, type VoiceBeamLevel } from 'voice-glow';

export type VoiceAssistantInput =
  | {
      readonly kind: 'level';
      /** 0–1, or a getter sampled by the glow without React renders. */
      readonly level: VoiceBeamLevel;
      readonly stream?: never;
    }
  | {
      readonly kind: 'microphone';
      readonly stream: MediaStream;
      readonly level?: never;
    };

export type VoiceAssistantState =
  | { readonly kind: 'idle'; readonly input?: never }
  | { readonly kind: 'listening'; readonly input: VoiceAssistantInput }
  | { readonly kind: 'processing'; readonly input?: never };

export type VoiceAssistantCardProps = {
  readonly name: string;
  readonly initials: string;
  readonly description: string;
  readonly message: string;
  readonly transcript: React.ReactNode;
  readonly state: VoiceAssistantState;
  readonly theme: 'dark' | 'light';
  readonly onToggle: () => void;
  readonly className?: string;
  readonly style?: React.CSSProperties;
};

/** Controlled presentation. The caller owns audio, transcripts, and work. */
export function VoiceAssistantCard(props: VoiceAssistantCardProps): React.ReactNode {
  const titleId = React.useId();
  const drive = beamDrive(props.state);
  const listening = props.state.kind === 'listening';
  return (
    <section
      className={`voice-assistant-card ${props.className ?? ''}`}
      style={props.style}
      data-theme={props.theme}
      data-state={props.state.kind}
      aria-labelledby={titleId}
    >
      <VoiceBeam
        className="voice-assistant-beam"
        theme={props.theme}
        level={drive.level}
        stream={drive.stream}
        processing={drive.processing}
      >
        <div className="voice-assistant-content">
          <header className="voice-assistant-header">
            <span className="voice-assistant-avatar" aria-hidden="true">
              {props.initials}
            </span>
            <div className="voice-assistant-identity">
              <h2 id={titleId}>{props.name}</h2>
              <p>{props.description}</p>
            </div>
          </header>
          <div className="voice-assistant-divider" aria-hidden="true" />
          <div className="voice-assistant-body">
            <div className="voice-assistant-bubble-row">
              <p className="voice-assistant-bubble">
                <span>{props.message}</span>
              </p>
            </div>
            <div className="voice-assistant-transcript">{props.transcript}</div>
          </div>
          <footer className="voice-assistant-footer">
            <div className="voice-assistant-caption" aria-hidden="true">
              <span data-visible={props.state.kind === 'idle'}>Tap to speak</span>
              <span data-visible={listening}>Listening…</span>
              <span data-visible={props.state.kind === 'processing'}>One moment</span>
            </div>
            <span className="voice-assistant-status" role="status">
              {stateCaption(props.state)}
            </span>
            <button
              type="button"
              className="voice-assistant-mic"
              aria-label={listening ? 'Stop speaking' : 'Start speaking'}
              aria-pressed={listening}
              onClick={props.onToggle}
            >
              <span className="voice-assistant-wave" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            </button>
          </footer>
        </div>
      </VoiceBeam>
    </section>
  );
}

function stateCaption(state: VoiceAssistantState): string {
  switch (state.kind) {
    case 'idle':
      return 'Tap to speak';
    case 'listening':
      return 'Listening…';
    case 'processing':
      return 'One moment';
    default:
      return assertNeverVoiceAssistantVariant(state);
  }
}

// Adapt the strict state to the dependency's permissive input API once.
function beamDrive(state: VoiceAssistantState): {
  level: VoiceBeamLevel;
  stream: MediaStream | null;
  processing: boolean;
} {
  switch (state.kind) {
    case 'idle':
      return { level: 0.06, stream: null, processing: false };
    case 'processing':
      return { level: 0.06, stream: null, processing: true };
    case 'listening':
      switch (state.input.kind) {
        case 'level':
          return { level: state.input.level, stream: null, processing: false };
        case 'microphone':
          return { level: 0, stream: state.input.stream, processing: false };
        default:
          return assertNeverVoiceAssistantVariant(state.input);
      }
    default:
      return assertNeverVoiceAssistantVariant(state);
  }
}

function assertNeverVoiceAssistantVariant(value: never): never {
  throw new Error(`Unexpected voice assistant variant: ${String(value)}`);
}

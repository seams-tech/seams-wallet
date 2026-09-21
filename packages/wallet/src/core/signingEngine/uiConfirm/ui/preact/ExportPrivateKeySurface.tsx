/** @jsxImportSource preact */
import { Component, createRef } from 'preact';
import type {
  ExportGuidance,
  ExportPrivateKeyScheme,
} from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import {
  advanceRevealState,
  createSpinningState,
  maskedPrivateKey,
  settlingState,
  type PrivateKeyRevealState,
} from '../export-private-key-reveal';
import { copySurfaceText } from './clipboard';
import { CopyStatusIcon } from './CopyStatusIcon';

export type ExportKeyMaterial =
  | { kind: 'loading'; value?: never }
  | { kind: 'unavailable'; value?: never }
  | { kind: 'ready'; value: string };

export type ExportKeyViewModel = {
  id: string;
  scheme: ExportPrivateKeyScheme;
  label: string;
  publicKey: string;
  address: string;
  material: ExportKeyMaterial;
};

export type ExportPrivateKeyViewModel = {
  accountId: string;
  guidance?: ExportGuidance;
} & (
  | {
      kind: 'loading';
      entries: Array<
        Omit<ExportKeyViewModel, 'material'> & { material: { kind: 'loading'; value?: never } }
      >;
      message?: never;
    }
  | {
      kind: 'ready';
      entries: Array<
        Omit<ExportKeyViewModel, 'material'> & {
          material: Exclude<ExportKeyMaterial, { kind: 'loading' }>;
        }
      >;
      message?: never;
    }
  | { kind: 'failed'; message: string; entries?: never }
);

export function ExportPrivateKeySurface({ model }: { model: ExportPrivateKeyViewModel }) {
  const entries = model.kind === 'failed' ? [] : model.entries;
  const showAccount = entries.length === 0 || entries.some(isNearKey);
  return (
    <div
      class="seams-export-key-viewer"
      data-seams-drawer-no-drag
      onPointerDown={stopDrag}
      onMouseDown={stopDrag}
      onTouchStart={stopDrag}
    >
      <div class="content">
        <h2 class="title">Exported Keys</h2>
        {model.kind === 'failed' && (
          <div class="error-banner" role="alert">
            {model.message}
          </div>
        )}
        <div class="fields">
          {showAccount && (
            <div class="field">
              <div class="field-label">Near Account ID</div>
              <div class="field-value">
                <span class="value">{model.accountId || '—'}</span>
              </div>
            </div>
          )}
          {entries.length > 0 ? (
            entries.map(renderKey)
          ) : (
            <div class="field">
              <div class="field-value">
                <span class="muted">
                  {model.kind === 'loading' ? 'Preparing private key…' : 'No keys available'}
                </span>
              </div>
            </div>
          )}
        </div>
        {model.guidance && <ExportGuidanceContent guidance={model.guidance} />}
        <div class="warning">
          Warning: your private keys grant full control of your account and funds. Keep it in a
          secret place.
        </div>
      </div>
    </div>
  );
}

function isNearKey(entry: ExportKeyViewModel): boolean {
  return entry.scheme === 'ed25519';
}

function renderKey(entry: ExportKeyViewModel) {
  return <ExportKeyCard key={entry.id} entry={entry} />;
}

function stopDrag(event: Event): void {
  event.stopPropagation();
}

function ExportGuidanceContent({ guidance }: { guidance: ExportGuidance }) {
  return (
    <div class="warning">
      <strong>{guidance.title || 'Next Steps'}</strong>
      {guidance.body && <div>{guidance.body}</div>}
      {guidance.steps?.length ? <ol>{guidance.steps.map(renderGuidanceStep)}</ol> : null}
    </div>
  );
}

function renderGuidanceStep(step: string, index: number) {
  return <li key={index}>{step}</li>;
}

type CopyField = 'public' | 'private';
type CardState = {
  reveal: PrivateKeyRevealState | null;
  publicCopied: boolean;
  privateCopied: boolean;
};

class ExportKeyCard extends Component<{ entry: ExportKeyViewModel }, CardState> {
  state: CardState = { reveal: null, publicCopied: false, privateCopied: false };
  private readonly root = createRef<HTMLDivElement>();
  private frame: number | null = null;
  private readonly timers = new Map<CopyField, number>();
  private generation = 0;
  private copyLifetime = new AbortController();
  private active = false;

  componentDidMount(): void {
    this.active = true;
    this.reset(this.props.entry);
  }

  componentWillReceiveProps(next: { entry: ExportKeyViewModel }): void {
    if (!sameKey(this.props.entry, next.entry)) this.reset(next.entry);
  }

  componentDidUpdate(): void {
    this.schedule();
  }

  componentWillUnmount(): void {
    this.active = false;
    this.clearPending();
    this.state.reveal = null;
  }

  private clearPending(): void {
    this.generation += 1;
    this.copyLifetime.abort();
    const view = this.root.current?.ownerDocument.defaultView;
    if (this.frame !== null) view?.cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const timer of this.timers.values()) view?.clearTimeout(timer);
    this.timers.clear();
  }

  private reset(entry: ExportKeyViewModel): void {
    this.clearPending();
    this.copyLifetime = new AbortController();
    const view = this.root.current!.ownerDocument.defaultView!;
    const reduced = view.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const now = view.performance.now();
    let reveal: PrivateKeyRevealState | null = null;
    switch (entry.material.kind) {
      case 'loading':
        reveal = createSpinningState(entry.id, entry.scheme, reduced, now);
        break;
      case 'ready':
        reveal = reduced
          ? { kind: 'settled', entryKey: entry.id }
          : settlingState(
              createSpinningState(entry.id, entry.scheme, false, now),
              maskedPrivateKey(entry.material.value),
              now,
            );
        break;
      case 'unavailable':
        break;
      default:
        assertNever(entry.material);
    }
    this.setState({ reveal, publicCopied: false, privateCopied: false });
  }

  private schedule(): void {
    const reveal = this.state.reveal;
    if (!this.active || this.frame !== null || !reveal || reveal.kind === 'settled') return;
    const view = this.root.current!.ownerDocument.defaultView!;
    if (view.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.frame = view.requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.frame = null;
    const reveal = this.state.reveal;
    if (!this.active || !reveal || reveal.kind === 'settled') return;
    const next = advanceRevealState(reveal, now);
    if (next !== reveal) this.setState({ reveal: next });
    this.schedule();
  };

  private copyPublic = (): void => {
    void this.copy('public');
  };
  private copyPrivate = (): void => {
    void this.copy('private');
  };
  private clearPublic = (): void => {
    this.timers.delete('public');
    if (this.active) this.setState({ publicCopied: false });
  };
  private clearPrivate = (): void => {
    this.timers.delete('private');
    if (this.active) this.setState({ privateCopied: false });
  };

  private async copy(field: CopyField): Promise<void> {
    const entry = this.props.entry;
    if (!this.active) return;
    if (
      field === 'private' &&
      (entry.material.kind !== 'ready' || this.state.reveal?.kind !== 'settled')
    )
      return;
    let value = entry.publicKey;
    if (field === 'private') {
      if (entry.material.kind !== 'ready') return;
      value = entry.material.value;
    }
    if (!value) return;
    const generation = this.generation;
    const root = this.root.current!;
    const view = root.ownerDocument.defaultView!;
    view.focus();
    const copied = await copySurfaceText(root, value, this.copyLifetime.signal).catch(copyFailed);
    if (!copied || !this.active || generation !== this.generation) return;
    const previous = this.timers.get(field);
    if (previous !== undefined) view.clearTimeout(previous);
    if (field === 'public') this.setState({ publicCopied: true });
    else this.setState({ privateCopied: true });
    this.timers.set(
      field,
      view.setTimeout(field === 'public' ? this.clearPublic : this.clearPrivate, 3000),
    );
  }

  render() {
    const entry = this.props.entry;
    const privateReady = entry.material.kind === 'ready' && this.state.reveal?.kind === 'settled';
    return (
      <div class="key-card" ref={this.root}>
        <div class="key-title">{entry.label}</div>
        {entry.address && (
          <div class="field">
            <div class="field-label">Address</div>
            <div class="field-value">
              <span class="value">{entry.address}</span>
            </div>
          </div>
        )}
        {entry.scheme === 'ed25519' && (
          <button
            type="button"
            class={`field copy-field${this.state.publicCopied ? ' copied' : ''}`}
            aria-label={this.state.publicCopied ? 'Public key copied' : 'Copy public key'}
            disabled={!entry.publicKey}
            onClick={this.copyPublic}
          >
            <div class="field-label">Public Key</div>
            <div class="field-value">
              <span class="value">{entry.publicKey || '—'}</span>
              <CopyStatusIcon />
            </div>
          </button>
        )}
        <button
          type="button"
          class={`field copy-field${this.state.privateCopied ? ' copied' : ''}`}
          aria-label={this.state.privateCopied ? 'Private key copied' : 'Copy private key'}
          disabled={!privateReady}
          onClick={this.copyPrivate}
        >
          <div class="field-label">Private Key</div>
          <div class="field-value">
            <span class="value private-key">
              <PrivateKeyText material={entry.material} reveal={this.state.reveal} />
            </span>
            <CopyStatusIcon />
          </div>
        </button>
      </div>
    );
  }
}

function sameKey(left: ExportKeyViewModel, right: ExportKeyViewModel): boolean {
  return (
    left.id === right.id &&
    left.scheme === right.scheme &&
    left.publicKey === right.publicKey &&
    left.material.kind === right.material.kind &&
    left.material.value === right.material.value
  );
}

function copyFailed(): false {
  return false;
}

function PrivateKeyText({
  material,
  reveal,
}: {
  material: ExportKeyMaterial;
  reveal: PrivateKeyRevealState | null;
}) {
  if (reveal && reveal.kind !== 'settled') {
    return (
      <>
        <span class="private-key-reel" aria-hidden="true">
          <span class="reel-prefix">{reveal.prefix}</span>
          {renderSlots(reveal)}
        </span>
        <span class="seams-sr-only" role="status">
          Decrypting private key
        </span>
      </>
    );
  }
  if (material.kind !== 'ready') return <span class="muted">—</span>;
  return (
    <>
      <span>{maskedPrivateKey(material.value)}</span>
      <span class="seams-sr-only" role="status">
        Private key ready
      </span>
    </>
  );
}

function renderSlots(reveal: Exclude<PrivateKeyRevealState, { kind: 'settled' }>) {
  const lockedSlots = reveal.kind === 'settling' ? reveal.lockedSlots : 0;
  const slots = [];
  for (let index = 0; index < reveal.slots.length; index += 1) {
    slots.push(
      <span key={index} class={`reel-slot${index < lockedSlots ? ' settled' : ''}`}>
        {reveal.slots[index].glyph}
      </span>,
    );
  }
  return slots;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected export key material: ${String(value)}`);
}

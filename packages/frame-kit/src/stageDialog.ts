import { secureRandomId } from '@shared/utils/secureRandomId';
import { createFrame as createFrameIn } from './frameTransport';
import {
  isStageSize,
  readStageViewport,
  sameStageBox,
  stageBox,
  type StageBox,
} from './stageGeometry';
import {
  STAGE_HOST_VERSION,
  type FrameSpec,
  type Stage,
  type StageDismissReason,
  type StageHost,
  type StageRequest,
  type StageSize,
} from './stageHost';
import { StageRules } from './stageStyles';
import { LaterTopLayer } from './topLayerWatch';

/** A move from one stage to the next: the box eases and the content crossfades. */
const STAGE_MOVE_MS = 320;
const STAGE_MOVE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** A new size for the stage on screen. */
const STAGE_RESIZE_MS = 180;
const STAGE_RESIZE_EASING = 'cubic-bezier(0.2, 0.7, 0.2, 1)';
const BACKDROP_FADE_MS = 180;

type LayerState = 'idle' | 'measuring' | 'shown';

type Entry = {
  readonly instance: string;
  readonly request: StageRequest;
  /** The element that the dialog places: the frame itself, or a wrapper of an app element. */
  readonly layer: HTMLElement;
  size: StageSize | null;
  observer: ResizeObserver | null;
  closed: boolean;
};

type Press = { readonly pointerId: number; readonly instance: string };

export type StageDialog = StageHost & {
  /** Removes the dialog, its frames and its rules. */
  dispose(): void;
};

/** One dialog for each page. Each package that shows a stage gets it as a `StageHost`. */
export function createStageDialog(doc: Document = document): StageDialog {
  return new StageDialogHost(doc);
}

function px(value: number): string {
  return `${value}px`;
}

function boxFrame(box: StageBox): Keyframe {
  return { left: px(box.left), top: px(box.top), width: px(box.width), height: px(box.height) };
}

function isOutside(event: PointerEvent, rect: DOMRect): boolean {
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
}

class StageDialogHost implements StageDialog {
  readonly stageHostVersion = STAGE_HOST_VERSION;
  private readonly doc: Document;
  private readonly view: Window;
  private readonly laterTopLayer: LaterTopLayer;
  private dialog: HTMLDialogElement | null = null;
  private clip: HTMLElement | null = null;
  private rules: StageRules | null = null;
  private readonly frames = new Set<HTMLIFrameElement>();
  private current: Entry | null = null;
  /** The stage that stays on screen until the current stage has a size. */
  private leaving: Entry | null = null;
  private revealed = false;
  private box: StageBox | null = null;
  private motion: Animation[] = [];
  private motionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Close events that this dialog caused itself. They arrive after the next show. */
  private quietCloses = 0;
  private press: Press | null = null;
  private restoreFocus: HTMLElement | null = null;
  private watchingViewport = false;

  constructor(doc: Document) {
    const view = doc.defaultView;
    if (!view) throw new Error('The stage dialog needs a document that has a window');
    this.doc = doc;
    this.view = view;
    this.laterTopLayer = new LaterTopLayer(doc);
  }

  createFrame(spec: FrameSpec): HTMLIFrameElement {
    const { clip } = this.ensureDialog();
    const frame = createFrameIn(clip, spec);
    frame.classList.add('seams-stage-layer');
    frame.dataset.stageLayer = secureRandomId('layer', 9);
    this.setLayerState(frame, 'idle');
    this.frames.add(frame);
    return frame;
  }

  show(request: StageRequest): Stage {
    const { clip } = this.ensureDialog();
    const entry: Entry = {
      instance: secureRandomId('stage', 16),
      request,
      layer: this.layerFor(request, clip),
      size: null,
      observer: null,
      closed: false,
    };
    this.makeCurrent(entry);
    if (request.content.kind === 'element') this.observe(entry);
    return {
      instance: entry.instance,
      isCurrent: () => this.current === entry,
      resize: (size) => this.resizeFromOwner(entry, size),
      isUnobstructed: () => this.isUnobstructed(entry),
      close: () => this.closeEntry(entry),
    };
  }

  dispose(): void {
    this.endMotion();
    for (const entry of [this.current, this.leaving]) entry?.observer?.disconnect();
    this.current = null;
    this.leaving = null;
    this.hide();
    this.unwatchViewport();
    const dialog = this.dialog;
    if (dialog) {
      dialog.removeEventListener('cancel', this.onCancel);
      dialog.removeEventListener('close', this.onClose);
      dialog.removeEventListener('pointerdown', this.onPointerDown);
      dialog.removeEventListener('pointerup', this.onPointerUp);
      dialog.removeEventListener('pointercancel', this.onPointerCancel);
      dialog.remove();
    }
    this.rules?.clear();
    this.frames.clear();
    this.dialog = null;
    this.clip = null;
    this.rules = null;
  }

  private ensureDialog(): { dialog: HTMLDialogElement; clip: HTMLElement } {
    if (this.dialog && this.clip) {
      if (!this.dialog.isConnected) this.doc.body.appendChild(this.dialog);
      return { dialog: this.dialog, clip: this.clip };
    }
    const dialog = this.doc.createElement('dialog');
    dialog.id = secureRandomId('seams-stage', 12);
    dialog.className = 'seams-stage-dialog';
    dialog.dataset.state = 'hidden';
    dialog.inert = true;
    dialog.setAttribute('aria-hidden', 'true');
    const clip = this.doc.createElement('div');
    clip.className = 'seams-stage-clip';
    dialog.appendChild(clip);
    dialog.addEventListener('cancel', this.onCancel);
    dialog.addEventListener('close', this.onClose);
    dialog.addEventListener('pointerdown', this.onPointerDown);
    dialog.addEventListener('pointerup', this.onPointerUp);
    dialog.addEventListener('pointercancel', this.onPointerCancel);
    this.rules = new StageRules(this.doc);
    this.doc.body.appendChild(dialog);
    this.dialog = dialog;
    this.clip = clip;
    return { dialog, clip };
  }

  private layerFor(request: StageRequest, clip: HTMLElement): HTMLElement {
    const { content } = request;
    if (content.kind === 'frame') {
      if (!this.frames.has(content.frame) || content.frame.parentElement !== clip) {
        throw new Error('A frame stage needs a frame that this stage dialog made');
      }
      return content.frame;
    }
    const wrapper = this.doc.createElement('div');
    wrapper.className = 'seams-stage-layer';
    wrapper.dataset.stageLayer = secureRandomId('layer', 9);
    wrapper.tabIndex = -1;
    this.setLayerState(wrapper, 'idle');
    wrapper.appendChild(content.element);
    clip.appendChild(wrapper);
    return wrapper;
  }

  private makeCurrent(entry: Entry): void {
    const previous = this.current;
    this.current = entry;
    this.press = null;
    const replaced = previous && previous.layer !== entry.layer ? previous.layer : null;
    if (!this.revealed) {
      this.endMotion();
      if (replaced) this.setLayerState(replaced, 'idle');
      this.setLayerState(entry.layer, 'shown');
      this.prepare(entry);
      return;
    }
    if (entry.layer.dataset.layer === 'shown') {
      // The same frame, or the stage that waited on screen, is current again.
      this.endMotion();
      if (replaced) this.setLayerState(replaced, 'idle');
      this.setLayerState(entry.layer, 'shown');
      return;
    }
    if (replaced?.dataset.layer === 'shown' && previous) {
      // The stage on screen stays there, inert, until the new one has a size.
      this.endMotion();
      this.leaving = previous;
      replaced.inert = true;
    } else if (replaced) {
      // The stage that was replaced never showed, so the stage that waits stays.
      this.setLayerState(replaced, 'idle');
    }
    this.setLayerState(entry.layer, 'measuring');
  }

  /** The dialog lays the stage out, invisible and inert. The page keeps its focus. */
  private prepare(entry: Entry): void {
    const dialog = this.dialog;
    if (!dialog) return;
    const active = this.doc.activeElement;
    if (
      !this.restoreFocus &&
      active instanceof HTMLElement &&
      active !== this.doc.body &&
      !dialog.contains(active)
    ) {
      this.restoreFocus = active;
    }
    dialog.dataset.state = 'preparing';
    dialog.dataset.presentation = entry.request.presentation;
    dialog.inert = true;
    dialog.setAttribute('aria-hidden', 'true');
    this.applyBox(stageBox(readStageViewport(this.view), entry.request.presentation, null));
    // The open attribute renders the dialog without moving focus, which show() would do.
    if (!dialog.open) dialog.open = true;
    this.watchViewport();
  }

  private observe(entry: Entry): void {
    const observer = new ResizeObserver((records) => {
      const record = records[records.length - 1];
      const border = record?.borderBoxSize?.[0];
      const width = border ? border.inlineSize : entry.layer.offsetWidth;
      const height = border ? border.blockSize : entry.layer.offsetHeight;
      if (width > 0 && height > 0) {
        this.applySize(entry, { widthCssPx: Math.ceil(width), heightCssPx: Math.ceil(height) });
      }
    });
    observer.observe(entry.layer);
    entry.observer = observer;
  }

  private resizeFromOwner(entry: Entry, size: StageSize): void {
    if (entry.closed || !isStageSize(size)) return;
    entry.observer?.disconnect();
    entry.observer = null;
    this.applySize(entry, size);
  }

  private applySize(entry: Entry, size: StageSize): void {
    if (entry.closed) return;
    entry.size = size;
    if (entry !== this.current) return;
    const next = stageBox(readStageViewport(this.view), entry.request.presentation, size);
    if (!this.revealed) this.reveal(entry, next);
    else if (this.leaving && this.motion.length === 0) this.move(entry, next);
    else this.ease(next, STAGE_RESIZE_MS, STAGE_RESIZE_EASING);
  }

  private reveal(entry: Entry, next: StageBox): void {
    const dialog = this.dialog;
    if (!dialog || !this.rules) return;
    this.applyBox(next);
    dialog.dataset.state = 'shown';
    dialog.dataset.presentation = entry.request.presentation;
    dialog.setAttribute('aria-label', entry.request.title);
    this.rules.adopt();
    this.closeQuietly(dialog);
    dialog.inert = false;
    dialog.removeAttribute('aria-hidden');
    dialog.showModal();
    this.revealed = true;
    this.laterTopLayer.start(dialog);
    if (entry.request.presentation === 'modal' && !this.reducedMotion()) {
      dialog.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: BACKDROP_FADE_MS,
        easing: 'ease-out',
        pseudoElement: '::backdrop',
      });
    }
    this.focus(entry);
  }

  /** The current stage replaces the one that waited on screen for it. */
  private move(entry: Entry, next: StageBox): void {
    const dialog = this.dialog;
    const leaving = this.leaving;
    const from = this.box;
    if (!dialog || !leaving || !from) return;
    // The old content keeps its size while the box eases, so it does not reflow.
    this.rules?.set(this.layerSelector(leaving.layer), {
      width: px(from.width),
      height: px(from.height),
    });
    this.applyBox(next);
    dialog.dataset.presentation = entry.request.presentation;
    dialog.setAttribute('aria-label', entry.request.title);
    this.setLayerState(entry.layer, 'shown');
    this.focus(entry);
    if (this.reducedMotion()) {
      this.endMotion();
      return;
    }
    const timing = { duration: STAGE_MOVE_MS, easing: STAGE_MOVE_EASING, fill: 'both' } as const;
    this.motion = [
      dialog.animate([boxFrame(from), boxFrame(next)], { ...timing, fill: 'none' }),
      leaving.layer.animate(
        [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(-8px)', offset: 0.55 },
          { opacity: 0, transform: 'translateY(-8px)' },
        ],
        timing,
      ),
      entry.layer.animate(
        [
          { opacity: 0, transform: 'translateY(12px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        timing,
      ),
    ];
    this.motionTimer = setTimeout(() => this.endMotion(), STAGE_MOVE_MS);
  }

  private ease(next: StageBox, duration: number, easing: string): void {
    const dialog = this.dialog;
    const from = this.box;
    this.endMotion();
    this.applyBox(next);
    if (!dialog || !from || sameStageBox(from, next) || this.reducedMotion()) return;
    this.motion = [dialog.animate([boxFrame(from), boxFrame(next)], { duration, easing })];
    this.motionTimer = setTimeout(() => this.endMotion(), duration);
  }

  /** Ends a running move or resize at its end state. */
  private endMotion(): void {
    if (this.motionTimer !== null) clearTimeout(this.motionTimer);
    this.motionTimer = null;
    for (const animation of this.motion) animation.cancel();
    this.motion = [];
    const leaving = this.leaving;
    if (!leaving) return;
    this.leaving = null;
    this.rules?.delete(this.layerSelector(leaving.layer));
    leaving.layer.inert = false;
    if (leaving.layer !== this.current?.layer) this.setLayerState(leaving.layer, 'idle');
  }

  private closeEntry(entry: Entry): void {
    if (entry.closed) return;
    entry.closed = true;
    entry.observer?.disconnect();
    entry.observer = null;
    if (this.leaving === entry) this.endMotion();
    if (this.current === entry) {
      this.current = null;
      this.endMotion();
      this.hide();
    }
    if (entry.request.content.kind === 'element') entry.layer.remove();
    else if (entry.layer !== this.current?.layer) this.setLayerState(entry.layer, 'idle');
  }

  private hide(): void {
    const dialog = this.dialog;
    this.revealed = false;
    this.box = null;
    this.press = null;
    this.laterTopLayer.stop();
    this.unwatchViewport();
    if (!dialog) return;
    this.rules?.delete(`#${dialog.id}`);
    for (const frame of this.frames) {
      if (frame !== this.current?.layer) this.setLayerState(frame, 'idle');
    }
    dialog.dataset.state = 'hidden';
    dialog.inert = true;
    dialog.setAttribute('aria-hidden', 'true');
    dialog.removeAttribute('aria-label');
    this.closeQuietly(dialog);
    if (this.current) return;
    const focusTarget = this.restoreFocus;
    this.restoreFocus = null;
    if (focusTarget?.isConnected && !focusTarget.closest('[inert]')) {
      focusTarget.focus({ preventScroll: true });
    }
  }

  private closeQuietly(dialog: HTMLDialogElement): void {
    if (!dialog.open) return;
    this.quietCloses += 1;
    dialog.close();
  }

  private applyBox(box: StageBox): void {
    const dialog = this.dialog;
    if (!dialog || !this.rules) return;
    this.box = box;
    dialog.dataset.box = box.kind;
    this.rules.set(`#${dialog.id}`, {
      left: px(box.left),
      top: px(box.top),
      width: px(box.width),
      height: px(box.height),
      '--seams-stage-room-width': px(box.roomWidth),
    });
  }

  private layerSelector(layer: HTMLElement): string {
    return `#${this.dialog?.id ?? ''} [data-stage-layer="${layer.dataset.stageLayer ?? ''}"]`;
  }

  private setLayerState(layer: HTMLElement, state: LayerState): void {
    layer.dataset.layer = state;
    layer.inert = state !== 'shown';
    if (state === 'shown') layer.removeAttribute('aria-hidden');
    else layer.setAttribute('aria-hidden', 'true');
  }

  private focus(entry: Entry): void {
    const { layer } = entry;
    if (layer.contains(this.doc.activeElement)) return;
    const target =
      entry.request.content.kind === 'element'
        ? (layer.querySelector<HTMLElement>('[autofocus]') ?? layer)
        : layer;
    target.focus({ preventScroll: true });
  }

  private isUnobstructed(entry: Entry): boolean {
    const dialog = this.dialog;
    if (
      !dialog ||
      entry !== this.current ||
      !this.revealed ||
      this.leaving ||
      this.motion.length > 0 ||
      !dialog.open
    ) {
      return false;
    }
    const { layer } = entry;
    for (const element of [dialog, layer]) {
      const style = this.view.getComputedStyle(element);
      if (style.opacity !== '1' || style.visibility !== 'visible') return false;
    }
    const rect = layer.getBoundingClientRect();
    const viewport = readStageViewport(this.view);
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.left < viewport.left - 0.5 ||
      rect.top < viewport.top - 0.5 ||
      rect.right > viewport.left + viewport.width + 0.5 ||
      rect.bottom > viewport.top + viewport.height + 0.5
    ) {
      return false;
    }
    if (this.laterTopLayer.covers(rect)) return false;
    for (const x of [0.04, 0.5, 0.96]) {
      for (const y of [0.04, 0.5, 0.96]) {
        const hit = this.doc.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
        if (!hit || (hit !== layer && !layer.contains(hit))) return false;
      }
    }
    return true;
  }

  private reducedMotion(): boolean {
    return this.view.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private watchViewport(): void {
    if (this.watchingViewport) return;
    this.watchingViewport = true;
    this.view.addEventListener('resize', this.onViewportChange);
    this.view.visualViewport?.addEventListener('resize', this.onViewportChange);
    this.view.visualViewport?.addEventListener('scroll', this.onViewportChange);
  }

  private unwatchViewport(): void {
    if (!this.watchingViewport) return;
    this.watchingViewport = false;
    this.view.removeEventListener('resize', this.onViewportChange);
    this.view.visualViewport?.removeEventListener('resize', this.onViewportChange);
    this.view.visualViewport?.removeEventListener('scroll', this.onViewportChange);
  }

  private dismiss(reason: StageDismissReason): void {
    const entry = this.current;
    if (entry && this.revealed) entry.request.onDismiss?.(reason);
  }

  private readonly onViewportChange = (): void => {
    // A stage that waits for the next one keeps its own box; a running move ends at once.
    const waiting = this.leaving !== null && this.motion.length === 0;
    if (!waiting) this.endMotion();
    const entry = waiting ? this.leaving : this.current;
    if (!entry) return;
    this.applyBox(stageBox(readStageViewport(this.view), entry.request.presentation, entry.size));
  };

  private readonly onCancel = (event: Event): void => {
    event.preventDefault();
    this.dismiss('escape');
  };

  private readonly onClose = (): void => {
    if (this.quietCloses > 0) {
      this.quietCloses -= 1;
      return;
    }
    // The browser closed the dialog itself, for example after a second Escape. The stage stays
    // current and shows again with its next size, if its owner keeps it.
    const wasRevealed = this.revealed;
    this.hide();
    if (wasRevealed) this.current?.request.onDismiss?.('escape');
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    const dialog = this.dialog;
    const entry = this.current;
    this.press = null;
    if (!dialog || !entry || !this.revealed || event.target !== dialog) return;
    if (isOutside(event, dialog.getBoundingClientRect())) {
      this.press = { pointerId: event.pointerId, instance: entry.instance };
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const press = this.press;
    this.press = null;
    const dialog = this.dialog;
    if (
      !press ||
      !dialog ||
      press.pointerId !== event.pointerId ||
      press.instance !== this.current?.instance ||
      event.target !== dialog ||
      !isOutside(event, dialog.getBoundingClientRect())
    ) {
      return;
    }
    this.dismiss('backdrop');
  };

  private readonly onPointerCancel = (): void => {
    this.press = null;
  };
}

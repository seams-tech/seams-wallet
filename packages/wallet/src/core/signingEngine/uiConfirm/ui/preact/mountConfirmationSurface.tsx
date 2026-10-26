/** @jsxImportSource preact */
import { render } from 'preact';
import { withWalletLocale } from './WalletLocale';
import type { AppearanceConfig } from '@/core/types/seams';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import { confirmationDocumentStyles } from './confirmation-styles';
import { appearanceTokenCssRule } from '../appearance-token-vars';
import { ConfirmationContent, type ConfirmationContentModel } from './ConfirmationContent';
import { ConfirmationModal } from './ConfirmationModal';
import { ConfirmationDrawer } from './ConfirmationDrawer';
import { TransactionReceipt } from './TransactionReceipt';
import { PadlockIcon } from './PadlockIcon';
import { receiptIsPending, type TransactionReceiptModel } from '../transaction-receipt';

export { normalizeConfirmationModel } from '../confirmation-model';

export type ConfirmSurfaceModel = {
  appearance: AppearanceConfig;
  content: ConfirmationContentModel;
};

export type ConfirmationSurfaceHandle = {
  readonly element: HTMLElement;
  update(model: ConfirmSurfaceModel): void;
  showReceipt(model: TransactionReceiptModel): void;
  close(): void;
  dispose(): void;
};

type MountConfirmationInput = {
  parent: HTMLElement;
  presentation: {
    variant: 'modal' | 'drawer';
    context: 'standalone' | 'wallet-iframe';
  };
  model: ConfirmSurfaceModel;
  onClosed: () => void;
};

type SurfaceState =
  | { kind: 'mounted' | 'closing'; model: ConfirmSurfaceModel; onClosed: () => void }
  | { kind: 'disposed'; model?: never; onClosed?: never };

const RECEIPT_MORPH_DURATION_MS = 360;
/** A replaced auth method capture fades where it is, while its progress segments travel on. */
const CAPTURE_FADE_MS = 120;
const RECEIPT_MORPH_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const RECEIPT_ANCHORS = [
  '.seams-receipt-symbol',
  '[role="status"]',
  '.seams-review-amount',
] as const;

type ProgressSegment = Readonly<{ bounds: DOMRect; opacity: string; color: string }>;
type LeavingCapture = Readonly<{
  element: HTMLElement;
  bounds: DOMRect;
  segments: readonly ProgressSegment[];
}>;

type ReceiptAnchor = {
  selector: (typeof RECEIPT_ANCHORS)[number];
  text: string | null;
  bounds: DOMRect;
  fontSize: string;
};

function captureReceiptAnchors(surface: HTMLElement): ReceiptAnchor[] {
  const anchors: ReceiptAnchor[] = [];
  for (const selector of RECEIPT_ANCHORS) {
    const element = surface.querySelector<HTMLElement>(selector);
    if (!element) continue;
    anchors.push({
      selector,
      text: element.textContent,
      bounds: element.getBoundingClientRect(),
      fontSize: getComputedStyle(element).fontSize,
    });
  }
  return anchors;
}

/**
 * The progress segments a capture draws while it checks, as they look now. A line
 * that has not split yet hands over its thirds.
 */
function progressSegments(capture: HTMLElement): ProgressSegment[] {
  const line = capture.querySelector<SVGElement>('[data-seams-progress-line]');
  if (!line) return [];
  const color = getComputedStyle(line).color;
  const drawn = Array.from(line.querySelectorAll<SVGGraphicsElement>('[data-seams-progress-segment]'));
  if (drawn.length === 3 && drawn.every(isPainted)) {
    return drawn.map((segment) => ({
      bounds: segment.getBoundingClientRect(),
      opacity: segment.getAttribute('opacity') ?? '1',
      color,
    }));
  }
  const box = line.getBoundingClientRect();
  const width = box.width / 3;
  return [0, 1, 2].map((index) => ({
    bounds: new DOMRect(box.left + index * width, box.top + box.height / 2, width, 0),
    opacity: '0.55',
    color,
  }));
}

function isPainted(segment: SVGGraphicsElement): boolean {
  return segment.getAttribute('opacity') !== '0';
}

let nextSurfaceId = 0;

class MountedConfirmationSurface implements ConfirmationSurfaceHandle {
  readonly element: HTMLElement;
  private readonly styles: CspStylesheetManager;
  private readonly presentation: MountConfirmationInput['presentation'];
  private state: SurfaceState;
  private receipt: TransactionReceiptModel | null = null;
  private receiptMotion: Animation[] = [];
  private receiptShell: HTMLElement | null = null;
  private receiptGhost: HTMLElement | null = null;
  private receiptSegments: HTMLElement[] = [];

  private clearReceiptMotion = (): void => {
    for (const animation of this.receiptMotion) animation.cancel();
    this.receiptMotion = [];
    this.receiptShell?.remove();
    this.receiptShell = null;
    this.receiptGhost?.remove();
    this.receiptGhost = null;
    for (const segment of this.receiptSegments) segment.remove();
    this.receiptSegments = [];
    this.element.removeAttribute('data-receipt-segments');
    this.element.removeAttribute('data-receipt-morphing');
  };

  constructor(input: MountConfirmationInput) {
    const document = input.parent.ownerDocument;
    this.styles = confirmationDocumentStyles(document);
    this.presentation = {
      variant: input.presentation.variant,
      context: input.presentation.context,
    };
    this.state = { kind: 'mounted', model: input.model, onClosed: input.onClosed };
    this.element = document.createElement('div');
    this.element.id = `seams-confirmation-surface-${++nextSurfaceId}`;
    this.element.className = 'seams-wallet-ui seams-confirmation-surface';
    this.element.dataset.seamsConfirmSurface = input.presentation.context;
    this.element.dataset.seamsConfirmVariant = input.presentation.variant;
    this.element.addEventListener('cancel', this.cancel);
    input.parent.appendChild(this.element);
    try {
      this.update(input.model);
    } catch (error) {
      this.remove();
      throw error;
    }
  }

  update(model: ConfirmSurfaceModel): void {
    if (this.state.kind !== 'mounted') return;
    this.state.model = model;
    this.element.dataset.confirmationKind = model.content.kind;
    this.element.dataset.seamsConfirmReady = String(
      model.content.kind === 'transaction' && model.content.transaction.decision.kind === 'ready',
    );
    this.element.lang = model.appearance.locale ?? 'en';
    this.element.dataset.theme = model.appearance.theme.mode;
    this.styles.setDynamicRule(
      this.element.id,
      appearanceTokenCssRule(this.element.id, model.appearance),
    );
    this.renderSurface();
  }

  close(): void {
    if (this.state.kind !== 'mounted') return;
    this.state = { kind: 'closing', model: this.state.model, onClosed: this.state.onClosed };
    if (this.presentation.variant === 'modal') this.dispose();
    else this.renderSurface();
  }

  showReceipt(model: TransactionReceiptModel): void {
    if (this.state.kind !== 'mounted' || this.state.model.content.kind !== 'transaction') return;
    const viewChanged = this.receipt?.view !== model.view;
    const previousShell = this.receiptShell ?? this.element.querySelector('.modal-container-root');
    const previousBounds = previousShell?.getBoundingClientRect();
    const anchors = viewChanged ? captureReceiptAnchors(this.element) : [];
    const leaving = viewChanged ? this.liveCapture() : null;
    const previousRadius = previousShell ? getComputedStyle(previousShell).borderRadius : '26px';
    if (viewChanged) this.clearReceiptMotion();
    this.receipt = model;
    this.element.dataset.receiptView = model.view;
    this.element.dataset.seamsConfirmSurface = 'wallet-iframe';
    this.element.dataset.seamsConfirmVariant = 'modal';
    this.renderSurface();
    const target = this.element.querySelector<HTMLElement>('.modal-container-root');
    if (
      viewChanged &&
      previousBounds &&
      target &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      const bounds = target.getBoundingClientRect();
      // The shell and shared content travel independently, keeping text undistorted.
      const shell = this.element.ownerDocument.createElement('div');
      shell.className = 'seams-receipt-morph-shell';
      shell.setAttribute('aria-hidden', 'true');
      this.element.appendChild(shell);
      this.receiptShell = shell;
      this.element.setAttribute('data-receipt-morphing', '');
      const morph = shell.animate(
        [
          {
            left: `${previousBounds.left}px`,
            top: `${previousBounds.top}px`,
            width: `${previousBounds.width}px`,
            height: `${previousBounds.height}px`,
            borderRadius: previousRadius,
          },
          {
            left: `${bounds.left}px`,
            top: `${bounds.top}px`,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
            borderRadius: getComputedStyle(target).borderRadius,
          },
        ],
        { duration: RECEIPT_MORPH_DURATION_MS, easing: RECEIPT_MORPH_EASING, fill: 'both' },
      );
      this.receiptMotion = [morph];
      const handedOver = leaving ? this.handOverCapture(leaving, target) : false;
      const shared = new Set<HTMLElement>();
      for (const anchor of anchors) {
        const element = target.querySelector<HTMLElement>(anchor.selector);
        if (!element || element.textContent !== anchor.text) continue;
        const destination = element.getBoundingClientRect();
        shared.add(element);
        const scale = parseFloat(anchor.fontSize) / parseFloat(getComputedStyle(element).fontSize);
        this.receiptMotion.push(
          element.animate(
            [
              {
                transform: `translate(${anchor.bounds.left - destination.left}px, ${anchor.bounds.top - destination.top}px) scale(${scale})`,
                transformOrigin: 'top left',
              },
              {
                transform: 'translate(0, 0) scale(1)',
                transformOrigin: 'top left',
              },
            ],
            { duration: RECEIPT_MORPH_DURATION_MS, easing: RECEIPT_MORPH_EASING },
          ),
        );
      }
      const details = target.querySelectorAll<HTMLElement>(
        '.seams-transaction-receipt > :not(.seams-receipt-heading), ' +
          '.seams-receipt-heading > .seams-receipt-symbol, .seams-receipt-heading h2, ' +
          '.seams-receipt-heading p, .seams-transaction-toast > :not(.seams-transaction-toast-text, .seams-toast-progress), ' +
          '.seams-transaction-toast-text > *',
      );
      let order = 0;
      for (const detail of details) {
        if (shared.has(detail)) continue;
        // A capture's card had the same toolbar row, so the receipt's takes its place at once.
        if (leaving && detail.matches('.seams-review-toolbar')) continue;
        this.receiptMotion.push(
          detail.animate(
            [
              { opacity: 0, transform: 'translateY(8px)' },
              { opacity: 1, transform: 'translateY(0)' },
            ],
            leaving
              ? {
                  // The steps settle before their segments land; the rest follows top to bottom.
                  duration: 200,
                  delay:
                    handedOver && detail.matches('.seams-receipt-steps')
                      ? 100
                      : 100 + Math.min(order, 6) * 40,
                  fill: 'backwards',
                  easing: 'cubic-bezier(0.2, 0, 0, 1)',
                }
              : {
                  duration: 120,
                  delay: model.view === 'toast' ? 240 : 180 + Math.min(order, 4) * 15,
                  fill: 'backwards',
                  easing: 'ease-out',
                },
          ),
        );
        order += 1;
      }
      morph.onfinish = this.clearReceiptMotion;
    }
  }

  /** The auth method capture still on screen, measured before the receipt replaces it. */
  private liveCapture(): LeavingCapture | null {
    if (this.state.kind !== 'mounted' || this.state.model.content.kind !== 'transaction') return null;
    const element = this.state.model.content.capture;
    if (!element?.isConnected) return null;
    return { element, bounds: element.getBoundingClientRect(), segments: progressSegments(element) };
  }

  /**
   * The capture's copy fades out where it was. When it drew progress segments,
   * they travel on and become the receipt's tracks. Returns whether they did.
   */
  private handOverCapture(leaving: LeavingCapture, target: HTMLElement): boolean {
    const ghost = this.element.ownerDocument.createElement('div');
    ghost.className = 'seams-receipt-capture-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.append(leaving.element);
    this.element.appendChild(ghost);
    this.receiptGhost = ghost;
    const place = {
      left: `${leaving.bounds.left}px`,
      top: `${leaving.bounds.top}px`,
      width: `${leaving.bounds.width}px`,
      height: `${leaving.bounds.height}px`,
    };
    this.receiptMotion.push(
      ghost.animate([{ ...place, opacity: 1 }, { ...place, opacity: 0 }], {
        duration: CAPTURE_FADE_MS,
        easing: 'ease-in',
        fill: 'both',
      }),
    );
    const tracks = target.querySelectorAll<HTMLElement>('.seams-receipt-track');
    if (leaving.segments.length === 0 || tracks.length !== leaving.segments.length) return false;
    this.element.setAttribute('data-receipt-segments', '');
    for (const [index, track] of tracks.entries()) {
      const from = leaving.segments[index];
      const to = track.getBoundingClientRect();
      const complete = track.closest<HTMLElement>('.seams-receipt-step')?.dataset.state === 'complete';
      const segment = this.element.ownerDocument.createElement('div');
      segment.className = 'seams-receipt-segment';
      segment.setAttribute('aria-hidden', 'true');
      this.element.appendChild(segment);
      this.receiptSegments.push(segment);
      this.receiptMotion.push(
        segment.animate(
          [
            {
              left: `${from.bounds.left}px`,
              top: `${from.bounds.top + from.bounds.height / 2 - 0.5}px`,
              width: `${from.bounds.width}px`,
              height: '1px',
              borderRadius: '1px',
              opacity: from.opacity,
              backgroundColor: from.color,
            },
            {
              left: `${to.left}px`,
              top: `${to.top}px`,
              width: `${to.width}px`,
              height: `${to.height}px`,
              borderRadius: getComputedStyle(track).borderRadius,
              opacity: 1,
              backgroundColor: getComputedStyle(track, complete ? '::after' : null).backgroundColor,
            },
          ],
          { duration: RECEIPT_MORPH_DURATION_MS, easing: RECEIPT_MORPH_EASING, fill: 'both' },
        ),
      );
    }
    return true;
  }

  dispose = (): void => {
    if (this.state.kind === 'disposed') return;
    const onClosed = this.state.onClosed;
    this.remove();
    onClosed();
  };

  private remove(): void {
    this.clearReceiptMotion();
    this.state = { kind: 'disposed' };
    this.element.removeEventListener('cancel', this.cancel);
    render(null, this.element);
    this.styles.deleteDynamicRule(this.element.id);
    this.element.remove();
  }

  private cancel = (): void => {
    if (this.state.kind !== 'mounted') return;
    if (this.receipt) {
      if (receiptIsPending(this.receipt)) this.receipt.onView('toast');
      else this.receipt.onDismiss();
      return;
    }
    const content = this.state.model.content;
    if (content.kind === 'registration') content.registration.onCancel();
    else content.transaction.onCancel();
  };

  private confirm = (): void => {
    if (this.state.kind !== 'mounted') return;
    const content = this.state.model.content;
    const decision =
      content.kind === 'registration'
        ? content.registration.decision
        : content.transaction.decision;
    if (decision.kind === 'ready') decision.onConfirm();
  };

  private submitOtp = (code: string, challengeId: string): void => {
    if (this.state.kind !== 'mounted') return;
    const content = this.state.model.content;
    if (content.kind === 'transaction' && content.prompt.kind === 'email') {
      content.prompt.email.onSubmit(code, challengeId);
    }
  };

  private renderSurface(): void {
    const state = this.state;
    if (state.kind === 'disposed') return;
    const source = state.model.content;
    const model = this.contentModel(source, state.kind === 'closing');
    const content =
      this.receipt && source.kind === 'transaction' ? (
        <TransactionReceipt
          receipt={this.receipt}
          data={source.review}
          explorers={source.transaction.explorers}
        />
      ) : (
        <ConfirmationContent
          model={model}
          styles={this.styles}
          variant={this.presentation.variant}
        />
      );
    const label =
      source.kind === 'registration' ? source.registration.heading : source.header.heading;
    if (this.receipt || this.presentation.variant === 'modal') {
      render(
        withWalletLocale(
          state.model.appearance.locale ?? 'en',
          <ConfirmationModal
            context={this.receipt ? 'wallet-iframe' : this.presentation.context}
            label={label}
            onCancel={this.cancel}
          >
            {content}
          </ConfirmationModal>,
        ),
        this.element,
      );
      return;
    }
    const decision =
      source.kind === 'registration' ? source.registration.decision : source.transaction.decision;
    render(
      withWalletLocale(
        state.model.appearance.locale ?? 'en',
        <ConfirmationDrawer
          context={this.presentation.context}
          label={label}
          origin={
            source.kind === 'transaction' && source.header.website.kind === 'ready' ? (
              <>
                <PadlockIcon />
                {source.header.website.text}
              </>
            ) : undefined
          }
          errorMessage={
            source.kind === 'registration'
              ? source.registration.errorMessage
              : source.transaction.errorMessage
          }
          styles={this.styles}
          state={
            state.kind === 'closing'
              ? { kind: 'closing', onClosed: this.dispose }
              : { kind: 'open', interaction: decision.kind === 'ready' ? 'ready' : 'busy' }
          }
          onCancel={this.cancel}
        >
          {content}
        </ConfirmationDrawer>,
      ),
      this.element,
    );
  }

  private contentModel(
    source: ConfirmationContentModel,
    closing: boolean,
  ): ConfirmationContentModel {
    switch (source.kind) {
      case 'registration':
        return {
          kind: 'registration',
          registration: {
            ...source.registration,
            decision:
              !closing && source.registration.decision.kind === 'ready'
                ? { kind: 'ready', onConfirm: this.confirm }
                : { kind: 'creating' },
            onCancel: this.cancel,
          },
        };
      case 'transaction':
        return {
          kind: 'transaction',
          capture: source.capture,
          header: source.header,
          body: source.body,
          review: source.review,
          prompt:
            source.prompt.kind === 'email'
              ? {
                  kind: 'email',
                  email: {
                    prompt: source.prompt.email.prompt,
                    verification: closing ? { kind: 'pending' } : source.prompt.email.verification,
                    onSubmit: this.submitOtp,
                  },
                }
              : source.prompt,
          transaction: {
            ...source.transaction,
            decision:
              !closing && source.transaction.decision.kind === 'ready'
                ? { kind: 'ready', onConfirm: this.confirm }
                : { kind: 'preparing' },
            onCancel: this.cancel,
          },
        };
      default:
        return assertNever(source);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected confirmation content: ${String(value)}`);
}

export function mountConfirmationSurface(input: MountConfirmationInput): ConfirmationSurfaceHandle {
  return new MountedConfirmationSurface(input);
}

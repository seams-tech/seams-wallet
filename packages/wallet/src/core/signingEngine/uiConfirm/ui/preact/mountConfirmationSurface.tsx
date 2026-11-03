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
import {
  announceSurfaceResize,
  CONFIRM_SURFACE_HEIGHT_DRIVEN_VAR,
} from '../confirm-surface-resize';

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

const RECEIPT_MORPH_DURATION_MS = 640;
const RECEIPT_MORPH_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const RECEIPT_ANCHORS = [
  '.seams-receipt-symbol',
  '[role="status"]',
  '.seams-review-amount',
  '.seams-receipt-footer',
] as const;

type ReceiptAnchor = {
  selector: (typeof RECEIPT_ANCHORS)[number];
  text: string | null;
  bounds: DOMRect;
  fontSize: string;
  textGeometry: { bounds: DOMRect; lineCount: number } | null;
};

type ReceiptResize = {
  element: HTMLElement;
  animations: Animation[];
  fromHeight: number;
  toHeight: number;
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
      textGeometry: element.matches('[role="status"]') ? receiptTextGeometry(element) : null,
    });
  }
  return anchors;
}

function receiptTextGeometry(element: HTMLElement): { bounds: DOMRect; lineCount: number } {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  return { bounds: range.getBoundingClientRect(), lineCount: range.getClientRects().length };
}

function receiptAnchorTransform(anchor: ReceiptAnchor, element: HTMLElement): string {
  const destination = element.getBoundingClientRect();
  const fontScale = parseFloat(anchor.fontSize) / parseFloat(getComputedStyle(element).fontSize);
  let scaleX = fontScale;
  let scaleY = fontScale;
  let left = anchor.bounds.left - destination.left;
  let top = anchor.bounds.top - destination.top;
  if (anchor.textGeometry) {
    const text = receiptTextGeometry(element);
    const source = anchor.textGeometry.bounds;
    const target = text.bounds;
    if (anchor.textGeometry.lineCount === text.lineCount && target.width > 0 && target.height > 0) {
      // System fonts can change optical metrics with size. Match the text
      // fragment bounds across the two layouts.
      scaleX = source.width / target.width;
      scaleY = source.height / target.height;
      left = source.left - destination.left - (target.left - destination.left) * scaleX;
      top = source.top - destination.top - (target.top - destination.top) * scaleY;
    }
  }
  return `translate(${left}px, ${top}px) scale(${scaleX}, ${scaleY})`;
}

function ignoreCancelledMotion(): void {}

let nextSurfaceId = 0;

class MountedConfirmationSurface implements ConfirmationSurfaceHandle {
  readonly element: HTMLElement;
  private readonly styles: CspStylesheetManager;
  private readonly presentation: MountConfirmationInput['presentation'];
  private state: SurfaceState;
  private receipt: TransactionReceiptModel | null = null;
  private receiptMotion: Animation[] = [];
  private receiptShell: HTMLElement | null = null;
  private receiptResize: ReceiptResize | null = null;

  private clearReceiptMotion = (): void => {
    this.element
      .querySelector('.seams-receipt-footer--hosted')
      ?.classList.remove('seams-receipt-footer--hosted');
    this.receiptResize?.element.classList.remove('seams-surface-height-driven');
    this.receiptResize = null;
    this.styles.deleteDynamicRule(`${this.element.id}-receipt-resize`);
    for (const animation of this.receiptMotion) animation.cancel();
    this.receiptMotion = [];
    this.receiptShell?.remove();
    this.receiptShell = null;
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
    const shouldMorph = this.receipt?.view !== model.view || this.receiptMotion.length > 0;
    const previousShell = this.receiptShell ?? this.element.querySelector('.modal-container-root');
    const previousBounds = previousShell?.getBoundingClientRect();
    const anchors = shouldMorph ? captureReceiptAnchors(this.element) : [];
    const previousRadius = previousShell ? getComputedStyle(previousShell).borderRadius : '26px';
    if (shouldMorph) this.clearReceiptMotion();
    this.receipt = model;
    this.element.dataset.receiptView = model.view;
    this.element.dataset.seamsConfirmSurface = 'wallet-iframe';
    this.element.dataset.seamsConfirmVariant = 'modal';
    this.renderSurface();
    const target = this.element.querySelector<HTMLElement>('.modal-container-root');
    if (
      shouldMorph &&
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
      const geometryAnimations = [morph];
      const shared = new Set<HTMLElement>();
      for (const anchor of anchors) {
        const element = target.querySelector<HTMLElement>(anchor.selector);
        if (!element || element.textContent !== anchor.text) continue;
        shared.add(element);
        const animation = element.animate(
          [
            {
              transform: receiptAnchorTransform(anchor, element),
              transformOrigin: 'top left',
            },
            {
              transform: 'translate(0, 0) scale(1)',
              transformOrigin: 'top left',
            },
          ],
          { duration: RECEIPT_MORPH_DURATION_MS, easing: RECEIPT_MORPH_EASING },
        );
        this.receiptMotion.push(animation);
        geometryAnimations.push(animation);
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
        const stationary = detail.matches('.seams-receipt-footer');
        this.receiptMotion.push(
          detail.animate(
            stationary
              ? [{ opacity: 0 }, { opacity: 1 }]
              : [
                  { opacity: 0, transform: 'translateY(8px)' },
                  { opacity: 1, transform: 'translateY(0)' },
                ],
            {
              duration: 120,
              delay: model.view === 'toast' ? 240 : 180 + Math.min(order, 4) * 15,
              fill: 'backwards',
              easing: 'ease-out',
            },
          ),
        );
        order += 1;
      }
      this.resizeReceipt({
        element: target,
        animations: geometryAnimations,
        fromHeight: previousBounds.height,
        toHeight: bounds.height,
      });
      // The details outlast the card's morph, so the overlays leave after the last one.
      const motion = this.receiptMotion;
      void Promise.all(motion.map((animation) => animation.finished)).then(() => {
        if (this.receiptMotion === motion) this.clearReceiptMotion();
      }, ignoreCancelledMotion);
    }
  }

  private resizeReceipt(resize: ReceiptResize): void {
    if (Math.abs(resize.toHeight - resize.fromHeight) < 1) return;
    this.receiptResize = resize;
    for (const animation of resize.animations) {
      animation.pause();
      animation.effect?.updateTiming({ easing: 'linear' });
    }
    resize.element.classList.add('seams-surface-height-driven');
    this.setReceiptHeight(resize, resize.fromHeight);
    const hosted = announceSurfaceResize(resize.element, {
      reason: 'receipt-transition',
      fromCssPx: resize.fromHeight,
      toCssPx: resize.toHeight,
      setHeightCssPx: this.setReceiptHeight.bind(this, resize),
      finish: this.finishReceiptResize.bind(this, resize),
    });
    if (hosted) {
      this.fitReceiptToViewport(resize);
      return;
    }
    this.receiptResize = null;
    resize.element.classList.remove('seams-surface-height-driven');
    this.styles.deleteDynamicRule(`${this.element.id}-receipt-resize`);
    for (const animation of resize.animations) {
      animation.effect?.updateTiming({ easing: RECEIPT_MORPH_EASING });
      animation.play();
    }
  }

  private fitReceiptToViewport(resize: ReceiptResize): void {
    const footer = resize.element.querySelector('.seams-receipt-footer');
    // Viewport units follow iframe layout before JavaScript receives the next
    // resize frame, including a fast reversal of the parent's animation.
    for (const animation of resize.animations) {
      const effect = animation.effect;
      if (!(effect instanceof KeyframeEffect)) continue;
      if (effect.target === this.receiptShell) {
        this.receiptShell?.classList.add('seams-receipt-morph-shell--hosted');
        const frames = effect.getKeyframes();
        for (const frame of frames) {
          delete frame.height;
          delete frame.width;
        }
        effect.setKeyframes(frames);
      } else if (footer && effect.target === footer) {
        const frames = effect.getKeyframes();
        for (const frame of frames) delete frame.transform;
        effect.setKeyframes(frames);
      }
    }
    footer?.classList.add('seams-receipt-footer--hosted');
  }

  private setReceiptHeight(resize: ReceiptResize, height: number): void {
    if (this.receiptResize !== resize) return;
    this.styles.setDynamicDeclarations(
      `${this.element.id}-receipt-resize`,
      `#${resize.element.id}`,
      {
        [CONFIRM_SURFACE_HEIGHT_DRIVEN_VAR]: `${height}px`,
        '--seams-receipt-target-height': `${resize.toHeight}px`,
      },
    );
    const progress = (height - resize.fromHeight) / (resize.toHeight - resize.fromHeight);
    for (const animation of resize.animations) {
      animation.currentTime = Math.max(0, Math.min(1, progress)) * RECEIPT_MORPH_DURATION_MS;
    }
  }

  private finishReceiptResize(resize: ReceiptResize): void {
    if (this.receiptResize !== resize) return;
    this.receiptResize = null;
    resize.element.classList.remove('seams-surface-height-driven');
    resize.element
      .querySelector('.seams-receipt-footer--hosted')
      ?.classList.remove('seams-receipt-footer--hosted');
    this.styles.deleteDynamicRule(`${this.element.id}-receipt-resize`);
    for (const animation of resize.animations) animation.finish();
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

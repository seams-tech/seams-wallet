/**
 * Notes the top-layer elements that open after a stage dialog: popovers, modal dialogs and a
 * fullscreen element. Each one paints above the stage. While the stage is modal, the rest of the
 * page is inert, and hit testing skips inert elements, so `elementFromPoint` never finds them.
 */
export class LaterTopLayer {
  private readonly doc: Document;
  private readonly opened = new Set<Element>();
  private own: HTMLDialogElement | null = null;
  private observer: MutationObserver | null = null;

  constructor(doc: Document) {
    this.doc = doc;
  }

  start(own: HTMLDialogElement): void {
    this.stop();
    this.own = own;
    this.doc.addEventListener('toggle', this.onToggle, true);
    this.doc.addEventListener('fullscreenchange', this.onFullscreen);
    const view = this.doc.defaultView;
    if (!view) return;
    this.observer = new view.MutationObserver(this.onOpenChanges);
    this.observer.observe(this.doc.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });
  }

  stop(): void {
    this.own = null;
    this.opened.clear();
    this.doc.removeEventListener('toggle', this.onToggle, true);
    this.doc.removeEventListener('fullscreenchange', this.onFullscreen);
    this.observer?.disconnect();
    this.observer = null;
  }

  /** A later modal dialog or fullscreen element covers all; a popover covers its own box. */
  covers(box: DOMRect): boolean {
    for (const element of this.opened) {
      if (!element.isConnected || !this.isOpenTopLayer(element)) {
        this.opened.delete(element);
        continue;
      }
      if (element.tagName === 'DIALOG' || element === this.doc.fullscreenElement) return true;
      const other = element.getBoundingClientRect();
      if (
        other.left < box.right &&
        other.right > box.left &&
        other.top < box.bottom &&
        other.bottom > box.top
      ) {
        return true;
      }
    }
    return false;
  }

  private isOpenTopLayer(element: Element): boolean {
    if (element === this.doc.fullscreenElement) return true;
    try {
      return element.matches(':popover-open') || element.matches('dialog:modal');
    } catch {
      // A browser without popovers knows no :popover-open.
      return element.matches('dialog[open]');
    }
  }

  private note(element: Element | null): void {
    const own = this.own;
    if (!own || !element || element === own || own.contains(element)) return;
    this.opened.add(element);
  }

  private readonly onToggle = (event: Event): void => {
    if ((event as ToggleEvent).newState === 'open' && event.target instanceof Element) {
      this.note(event.target);
    }
  };

  private readonly onFullscreen = (): void => {
    this.note(this.doc.fullscreenElement);
  };

  private readonly onOpenChanges = (records: MutationRecord[]): void => {
    for (const record of records) {
      const target = record.target;
      if (target instanceof Element && target.tagName === 'DIALOG' && target.hasAttribute('open')) {
        this.note(target);
      }
    }
  };
}

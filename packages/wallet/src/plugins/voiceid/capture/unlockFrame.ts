import { createElement, render } from 'preact';
import {
  createCspStylesheetManager,
  getDefaultCspNonce,
} from '@/core/browser/walletIframe/csp-stylesheet';
import { SeamsWordmark } from '@/core/signingEngine/uiConfirm/ui/preact/SeamsWordmark';
import { backIcon } from '@/SeamsWeb/walletIframe/host/ui/auth-menu/icons';
import type { VoicePrompt } from './prompt';

const CSS = `
.seams-voiceid-activation-surface.seams-voiceid-unlock {
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid var(--seams-colors-borderPrimary, #303b41);
  border-radius: var(--seams-shape-card, 24px);
  background: var(--seams-colors-colorBackground, #192024);
  color: var(--seams-colors-textPrimary, #eff2f3);
  font-family: var(--seams-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
}
.seams-voiceid-unlock-header {
  padding: 1rem 1.25rem 0;
}
.seams-voiceid-unlock-header .seams-menu-origin {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.5rem;
  font-size: 0.8125rem;
  color: var(--seams-colors-textSecondary, #9cabb3);
}
.seams-voiceid-unlock-header .seams-menu-origin svg {
  width: 14px;
  height: 14px;
}
.seams-voiceid-unlock-back {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-inline-start: -0.5rem;
  padding: 0;
  border: 0;
  border-radius: var(--seams-shape-control, 10px);
  background: transparent;
  color: var(--seams-colors-textSecondary, #9cabb3);
  cursor: pointer;
}
.seams-voiceid-unlock-back svg {
  width: 20px;
  height: 20px;
}
.seams-voiceid-unlock-back:focus-visible {
  outline: none;
  color: var(--seams-colors-textPrimary, #eff2f3);
}
.seams-voiceid-unlock .seams-voiceid-prompt {
  width: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0.75rem 1.5rem 1.5rem;
  grid-template-rows: auto minmax(6rem, auto) 5rem minmax(3.375rem, auto) auto auto;
}
.seams-voiceid-unlock .seams-voiceid-record-slot:has(button[hidden]) {
  display: none;
}
.seams-voiceid-unlock-footer {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.625rem 1rem;
  border-top: 1px solid color-mix(in srgb, var(--seams-colors-borderPrimary, #303b41) 60%, transparent);
  color: var(--seams-colors-textSecondary, #9cabb3);
  font-size: 0.6875rem;
  line-height: 1rem;
  letter-spacing: 0.01em;
}
.seams-voiceid-unlock-footer .seams-receipt-wordmark {
  flex: none;
  width: 3.125rem;
  height: 0.625rem;
}
@media (hover: hover) {
  .seams-voiceid-unlock-back:hover {
    color: var(--seams-colors-textPrimary, #eff2f3);
  }
}
`;
const styles = new WeakMap<Document, ReturnType<typeof createCspStylesheetManager>>();

export class VoiceUnlockFrame {
  private readonly footer: HTMLElement;
  constructor(
    element: HTMLElement,
    private readonly prompt: VoicePrompt,
  ) {
    const document = element.ownerDocument;
    let stylesheet = styles.get(document);
    if (!stylesheet) {
      stylesheet = createCspStylesheetManager({
        doc: document,
        baseCss: CSS,
        nonce: getDefaultCspNonce,
      });
      styles.set(document, stylesheet);
    }
    stylesheet.ensureBase();
    element.classList.add('seams-voiceid-unlock');
    const header = document.createElement('div');
    header.className = 'seams-voiceid-unlock-header';
    prompt.cancel.className = 'seams-voiceid-unlock-back';
    prompt.cancel.setAttribute('aria-label', 'Back');
    prompt.cancel.replaceChildren();
    render(backIcon(), prompt.cancel);
    header.append(prompt.cancel);
    element.prepend(header);
    this.footer = document.createElement('div');
    this.footer.className = 'seams-voiceid-unlock-footer';
    render(
      [createElement('span', null, 'Secured by'), ' ', createElement(SeamsWordmark, {})],
      this.footer,
    );
    element.append(this.footer);
  }
  /** After an unlock the back control cannot act, so it fades and the success centers under the origin. */
  succeed(): Readonly<{ top: number; bottom: number }> {
    const back = this.prompt.cancel;
    back.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 150,
      easing: 'ease-in',
      fill: 'forwards',
    });
    return { top: back.getBoundingClientRect().top, bottom: this.footer.getBoundingClientRect().top };
  }
  dispose(): void {
    render(null, this.prompt.cancel);
    render(null, this.footer);
  }
}

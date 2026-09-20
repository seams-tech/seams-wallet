import { html, type PropertyValues } from 'lit';
import { LitElementWithProps } from '../LitElementWithProps';
import DrawerElement from '../Drawer';
// Tokens for this component now come from seams-components.css host scoping.
// We no longer map full color sets from DARK_THEME/LIGHT_THEME here.
import { dispatchLitCancel, dispatchLitCopy } from '../../lit-events';
import { ensureExternalStyles } from '../css/css-loader';
import type {
  ExportGuidance,
  ExportPrivateKeyDisplayEntry,
} from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';

import {
  createSpinningState,
  maskedPrivateKey,
  settlingState,
  advanceRevealState,
  privateKeyEntryKey,
  type PrivateKeyRevealState,
} from '../../export-private-key-reveal';

export type ExportViewerTheme = 'dark' | 'light';
export type ExportViewerVariant = 'drawer' | 'modal';

function renderCopyStatusIcon() {
  return html`
    <span class="copy-icon" aria-hidden="true">
      <span class="copy-icon-check">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M20 6 9 17l-5-5"></path>
        </svg>
      </span>
      <span class="copy-icon-copy">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
        </svg>
      </span>
    </span>
  `;
}


function prefersReducedMotion(ownerDocument: Document | undefined): boolean {
  return (
    ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

export class ExportPrivateKeyViewer extends LitElementWithProps {
  // Ensure drawer definition is kept/loaded in the child iframe runtime
  static keepDefinitions = [DrawerElement];
  static properties = {
    theme: { type: String, reflect: true },
    variant: { type: String, reflect: true },
    accountId: { type: String, attribute: 'account-id' },
    publicKey: { type: String, attribute: 'public-key' },
    privateKey: { type: String, attribute: 'private-key' },
    keys: { attribute: false },
    guidance: { attribute: false },
    loading: { type: Boolean },
    errorMessage: { type: String },
    showCloseButton: { type: Boolean, attribute: 'show-close-button' },
  } as const;

  declare theme: ExportViewerTheme;
  declare variant: ExportViewerVariant;
  declare accountId?: string;
  declare publicKey?: string;
  declare privateKey?: string;
  declare keys?: ExportPrivateKeyDisplayEntry[];
  declare guidance?: ExportGuidance;
  declare loading: boolean;
  declare errorMessage?: string;
  declare showCloseButton: boolean;
  private copiedFields = new Set<string>();
  private copyTimers = new Map<string, number>();
  private revealStates = new Map<string, PrivateKeyRevealState>();
  private revealAnimationFrame: number | null = null;
  // Styles gating to avoid FOUC under strict CSP (no inline styles)
  private _stylesReady = false;
  private _stylePromises: Promise<void>[] = [];
  private _stylesAwaiting: Promise<void> | null = null;

  // Static styles moved to external CSS (export-viewer.css) for strict CSP

  constructor() {
    super();
    this.theme = 'dark';
    this.variant = 'drawer';
    this.keys = undefined;
    this.guidance = undefined;
    this.loading = false;
    this.showCloseButton = false;
  }

  protected getComponentPrefix(): string {
    return 'export';
  }

  protected createRenderRoot(): HTMLElement | DocumentFragment {
    // Prefer Shadow DOM to scope styles when constructable stylesheets are supported.
    // Fallback to light DOM for strict-CSP engines (document-level <link> will style it).
    const supportsConstructable =
      typeof ShadowRoot !== 'undefined' &&
      'adoptedStyleSheets' in ShadowRoot.prototype &&
      typeof CSSStyleSheet !== 'undefined' &&
      'replaceSync' in CSSStyleSheet.prototype;
    const root = supportsConstructable
      ? super.createRenderRoot()
      : (this as unknown as HTMLElement);
    // Adopt export-viewer.css for structural + visual styles
    const p1 = ensureExternalStyles(
      root as ShadowRoot | DocumentFragment | HTMLElement,
      'export-viewer.css',
      'data-seams-export-viewer-css',
    );
    this._stylePromises.push(p1);
    p1.catch(() => {});
    // Shared copy-affordance crossfade (also used by the recovery-code backup dialog)
    const pCopyIcon = ensureExternalStyles(
      root as ShadowRoot | DocumentFragment | HTMLElement,
      'copy-icon.css',
      'data-seams-copy-icon-css',
    );
    this._stylePromises.push(pCopyIcon);
    pCopyIcon.catch(() => {});
    // Also adopt token sheet so color/background vars are available even without host styles
    const p2 = ensureExternalStyles(
      root as ShadowRoot | DocumentFragment | HTMLElement,
      'seams-components.css',
      'data-seams-components-css',
    );
    this._stylePromises.push(p2);
    p2.catch(() => {});
    // Ensure drawer structural styles are available before first paint to prevent transparent background
    const p3 = ensureExternalStyles(
      root as ShadowRoot | DocumentFragment | HTMLElement,
      'drawer.css',
      'data-seams-drawer-css',
    );
    this._stylePromises.push(p3);
    p3.catch(() => {});
    return root;
  }

  // Avoid FOUC: block first paint until external styles are applied
  protected shouldUpdate(_changed: Map<string | number | symbol, unknown>): boolean {
    if (this._stylesReady) return true;
    if (!this._stylesAwaiting) {
      const settle = Promise.all(this._stylePromises).then(
        () =>
          new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      );
      this._stylesAwaiting = settle.then(() => {
        this._stylesReady = true;
        this.requestUpdate();
      });
    }
    return false;
  }

  protected updated(changed: PropertyValues) {
    super.updated(changed);
    if (changed.has('theme')) this.updateTheme();
  }

  protected willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    this.syncRevealStates();
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.updateTheme();
    // Prevent drawer drag initiation from content area so text can be selected
    this.addEventListener('pointerdown', this._stopDragStart as EventListener);
    this.addEventListener('mousedown', this._stopDragStart as EventListener);
    this.addEventListener(
      'touchstart',
      this._stopDragStart as EventListener,
      { passive: false } as AddEventListenerOptions,
    );
  }

  disconnectedCallback(): void {
    this.removeEventListener('pointerdown', this._stopDragStart as EventListener);
    this.removeEventListener('mousedown', this._stopDragStart as EventListener);
    this.removeEventListener('touchstart', this._stopDragStart as EventListener);
    for (const timeoutId of this.copyTimers.values()) {
      clearTimeout(timeoutId);
    }
    this.copyTimers.clear();
    this.resetRevealStates();
    super.disconnectedCallback();
  }

  private onRevealAnimationFrame = (now: number): void => {
    this.revealAnimationFrame = null;
    if (this.ownerDocument?.hidden) {
      this.scheduleRevealAnimation();
      return;
    }

    let changed = false;
    for (const [entryKey, state] of this.revealStates) {
      if (state.kind === 'settled') continue;
      const nextState = advanceRevealState(state, now);
      if (nextState !== state) {
        this.revealStates.set(entryKey, nextState);
        changed = true;
      }
    }
    if (changed) this.requestUpdate();
    this.scheduleRevealAnimation();
  };

  private scheduleRevealAnimation(): void {
    if (this.revealAnimationFrame !== null || prefersReducedMotion(this.ownerDocument)) return;
    const hasActiveReveal = Array.from(this.revealStates.values()).some(
      (state) => state.kind === 'spinning' || state.kind === 'settling',
    );
    if (!hasActiveReveal) return;
    const view = this.ownerDocument?.defaultView;
    if (!view) return;
    this.revealAnimationFrame = view.requestAnimationFrame(this.onRevealAnimationFrame);
  }

  private cancelRevealAnimation(): void {
    if (this.revealAnimationFrame === null) return;
    this.ownerDocument?.defaultView?.cancelAnimationFrame(this.revealAnimationFrame);
    this.revealAnimationFrame = null;
  }

  private resetRevealStates(): void {
    this.cancelRevealAnimation();
    this.revealStates.clear();
  }

  private syncRevealStates(): void {
    if (String(this.errorMessage || '').trim()) {
      this.resetRevealStates();
      return;
    }

    const reducedMotion = prefersReducedMotion(this.ownerDocument);
    const now = this.ownerDocument?.defaultView?.performance.now() ?? performance.now();
    const entries = this.resolveKeyEntries();
    const activeEntryKeys = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      const entryKey = privateKeyEntryKey(index, entry.scheme);
      activeEntryKeys.add(entryKey);
      const currentState = this.revealStates.get(entryKey);
      if (this.loading) {
        if (!currentState || currentState.kind === 'settled') {
          this.revealStates.set(
            entryKey,
            createSpinningState(entryKey, entry.scheme, reducedMotion, now),
          );
        }
        continue;
      }

      const privateKey = String(entry.privateKey || '').trim();
      if (!currentState && privateKey) {
        const spinningState = createSpinningState(entryKey, entry.scheme, reducedMotion, now);
        this.revealStates.set(
          entryKey,
          reducedMotion
            ? { kind: 'settled', entryKey }
            : settlingState(spinningState, maskedPrivateKey(privateKey), now),
        );
      } else if (currentState?.kind === 'spinning' && privateKey) {
        this.revealStates.set(
          entryKey,
          reducedMotion
            ? { kind: 'settled', entryKey }
            : settlingState(currentState, maskedPrivateKey(privateKey), now),
        );
      } else if (!privateKey) {
        this.revealStates.delete(entryKey);
      }
    }

    for (const entryKey of this.revealStates.keys()) {
      if (!activeEntryKeys.has(entryKey)) this.revealStates.delete(entryKey);
    }
    this.scheduleRevealAnimation();
  }

  private _stopDragStart = (e: Event) => {
    // Do not preventDefault to allow text selection, just stop bubbling to drawer
    e.stopPropagation();
  };

  private updateTheme() {
    // Reflect theme to document root so host-scoped tokens respond
    try {
      const docEl = this.ownerDocument?.documentElement as HTMLElement | undefined;
      if (docEl && this.theme) {
        docEl.setAttribute('data-seams-theme', this.theme);
      }
    } catch {}
  }

  private fieldKey(index: number, type: 'publicKey' | 'privateKey'): string {
    return `${index}:${type}`;
  }

  private isCopied(index: number, type: 'publicKey' | 'privateKey'): boolean {
    return this.copiedFields.has(this.fieldKey(index, type));
  }

  private markCopied(index: number, type: 'publicKey' | 'privateKey'): void {
    const field = this.fieldKey(index, type);
    this.copiedFields.add(field);
    const existingTimer = this.copyTimers.get(field);
    if (typeof existingTimer === 'number') clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      this.copiedFields.delete(field);
      this.copyTimers.delete(field);
      this.requestUpdate();
    }, 3000);
    this.copyTimers.set(field, timer);
  }

  private async copy(type: 'publicKey' | 'privateKey', value?: string, index: number = 0) {
    if (!value) return;
    try {
      this.ownerDocument?.defaultView?.focus?.();
      (this as unknown as HTMLElement).focus?.();
      let ok = false;
      try {
        await navigator.clipboard.writeText(value);
        ok = true;
      } catch (err) {
        ok = this.copyViaTextareaFallback(value);
        if (!ok) throw err;
      }
      if (ok) {
        dispatchLitCopy(this, { type, value });
      }
      this.markCopied(index, type);
      this.requestUpdate();
    } catch (e) {
      console.warn('Copy failed', e);
    }
  }

  private copyViaTextareaFallback(text: string): boolean {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'seams-offscreen';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  private renderReel(state: Extract<PrivateKeyRevealState, { kind: 'spinning' | 'settling' }>) {
    const lockedSlots = state.kind === 'settling' ? state.lockedSlots : 0;
    return html`
      <span class="private-key-reel" aria-hidden="true">
        <span class="reel-prefix">${state.prefix}</span>${state.slots.map(
          (slot, index) =>
            html`<span class="reel-slot ${index < lockedSlots ? 'settled' : ''}"
              >${slot.glyph}</span
            >`,
        )}
      </span>
      <span class="seams-sr-only" role="status">Decrypting private key</span>
    `;
  }

  private renderPrivateKey(index: number, entry: ExportPrivateKeyDisplayEntry, privateKey: string) {
    const entryKey = privateKeyEntryKey(index, entry.scheme);
    const state = this.revealStates.get(entryKey);
    if (state?.kind === 'spinning' || state?.kind === 'settling') {
      return this.renderReel(state);
    }
    if (!privateKey) return html`<span class="muted">—</span>`;
    return html`
      <span>${maskedPrivateKey(privateKey)}</span>
      ${state?.kind === 'settled'
        ? html`<span class="seams-sr-only" role="status">Private key ready</span>`
        : null}
    `;
  }

  private privateKeyCopyDisabled(
    index: number,
    entry: ExportPrivateKeyDisplayEntry,
    privateKey: string,
  ): boolean {
    if (!privateKey || this.loading) return true;
    const state = this.revealStates.get(privateKeyEntryKey(index, entry.scheme));
    return state?.kind === 'spinning' || state?.kind === 'settling';
  }

  private resolveKeyEntries(): ExportPrivateKeyDisplayEntry[] {
    const provided = Array.isArray(this.keys)
      ? this.keys.filter((item) => {
          if (!item || typeof item !== 'object') return false;
          const publicKey = String((item as ExportPrivateKeyDisplayEntry).publicKey || '').trim();
          const privateKey = String((item as ExportPrivateKeyDisplayEntry).privateKey || '').trim();
          return !!publicKey || !!privateKey;
        })
      : [];
    if (provided.length > 0) return provided;

    const publicKey = String(this.publicKey || '').trim();
    const privateKey = String(this.privateKey || '').trim();
    if (!publicKey && !privateKey) return [];

    return [
      {
        scheme: 'ed25519',
        label: 'NEAR Ed25519',
        publicKey,
        privateKey,
      },
    ];
  }

  render() {
    const entries = this.resolveKeyEntries();
    const showAccountId =
      entries.length === 0 || entries.some((entry) => entry.scheme !== 'secp256k1');
    const guidanceTitle = String(this.guidance?.title || '').trim();
    const guidanceBody = String(this.guidance?.body || '').trim();
    const guidanceSteps = Array.isArray(this.guidance?.steps)
      ? this.guidance!.steps.map((entry) => String(entry || '').trim()).filter(
          (entry) => entry.length > 0,
        )
      : [];
    const errorMessage = String(this.errorMessage || '').trim();
    return html`
      ${this.showCloseButton
        ? html`<button
            aria-label="Close"
            title="Close"
            class="close-btn"
            @click=${() => dispatchLitCancel(this)}
          >
            ×
          </button>`
        : null}
      <div class="content">
        <h2 class="title">Exported Keys</h2>
        ${errorMessage ? html`<div class="error-banner">${errorMessage}</div>` : null}
        <div class="fields">
          ${showAccountId
            ? html`
                <div class="field">
                  <div class="field-label">Near Account ID</div>
                  <div class="field-value">
                    <span class="value">
                      ${this.accountId ? this.accountId : html`<span class="muted">—</span>`}
                    </span>
                  </div>
                </div>
              `
            : null}
          ${entries.length
            ? entries.map((entry, index) => {
                const label =
                  String(entry.label || '').trim() ||
                  (entry.scheme === 'secp256k1' ? 'EVM secp256k1' : 'NEAR Ed25519');
                const showPublicKey = entry.scheme !== 'secp256k1';
                const publicKey = String(entry.publicKey || '').trim();
                const privateKey = String(entry.privateKey || '').trim();
                const address = String(entry.address || '').trim();
                return html`
                  <div class="key-card">
                    <div class="key-title">${label}</div>
                    ${address
                      ? html`
                          <div class="field">
                            <div class="field-label">Address</div>
                            <div class="field-value">
                              <span class="value">${address}</span>
                            </div>
                          </div>
                        `
                      : null}
                    ${showPublicKey
                      ? html`
                          <button
                            type="button"
                            class="field copy-field ${this.isCopied(index, 'publicKey')
                              ? 'copied'
                              : ''}"
                            aria-label=${this.isCopied(index, 'publicKey')
                              ? 'Public key copied'
                              : 'Copy public key'}
                            title=${this.isCopied(index, 'publicKey')
                              ? 'Copied'
                              : 'Copy public key'}
                            ?disabled=${!publicKey}
                            @click=${() => this.copy('publicKey', publicKey, index)}
                          >
                            <div class="field-label">Public Key</div>
                            <div class="field-value">
                              <span class="value">
                                ${publicKey ? publicKey : html`<span class="muted">—</span>`}
                              </span>
                              ${renderCopyStatusIcon()}
                            </div>
                          </button>
                        `
                      : null}
                    <button
                      type="button"
                      class="field copy-field ${this.isCopied(index, 'privateKey') ? 'copied' : ''}"
                      aria-label=${this.isCopied(index, 'privateKey')
                        ? 'Private key copied'
                        : 'Copy private key'}
                      title=${this.isCopied(index, 'privateKey') ? 'Copied' : 'Copy private key'}
                      ?disabled=${this.privateKeyCopyDisabled(index, entry, privateKey)}
                      @click=${() => this.copy('privateKey', privateKey, index)}
                    >
                      <div class="field-label">Private Key</div>
                      <div class="field-value">
                        <span class="value private-key">
                          ${this.renderPrivateKey(index, entry, privateKey)}
                        </span>
                        ${renderCopyStatusIcon()}
                      </div>
                    </button>
                  </div>
                `;
              })
            : html`
                <div class="field">
                  <div class="field-value">
                    <span class="muted"
                      >${this.loading ? 'Preparing private key…' : 'No keys available'}</span
                    >
                  </div>
                </div>
              `}
        </div>
        ${guidanceTitle || guidanceBody || guidanceSteps.length
          ? html`
              <div class="warning">
                <strong>${guidanceTitle || 'Next Steps'}</strong>
                ${guidanceBody ? html`<div>${guidanceBody}</div>` : null}
                ${guidanceSteps.length
                  ? html`
                      <ol>
                        ${guidanceSteps.map((step) => html`<li>${step}</li>`)}
                      </ol>
                    `
                  : null}
              </div>
            `
          : null}
        <div class="warning">
          Warning: your private keys grant full control of your account and funds. Keep it in a
          secret place.
        </div>
      </div>
    `;
  }
}

if (!customElements.get('seams-export-key-viewer')) {
  customElements.define('seams-export-key-viewer', ExportPrivateKeyViewer);
}

// Ensure DrawerElement is kept by bundlers (used as container in iframe bootstrap)
export default ExportPrivateKeyViewer;

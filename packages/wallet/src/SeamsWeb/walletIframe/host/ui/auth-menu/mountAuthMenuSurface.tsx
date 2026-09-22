/** @jsxImportSource preact */
import { render } from 'preact';
import {
  createCspStylesheetManager,
  getDefaultCspNonce,
  type CspStylesheetManager,
} from '@/core/browser/walletIframe/csp-stylesheet';
import { appearanceTokenCssRule } from '@/core/signingEngine/uiConfirm/ui/appearance-token-vars';
import type { AuthMenuIntent, AuthMenuViewModel } from '../../auth-menu/domain';
import { AuthMenuSurface } from './AuthMenuSurface';

export type AuthMenuSurfaceHandle = {
  readonly element: HTMLElement;
  update(viewModel: AuthMenuViewModel): void;
  dispose(): void;
};

type MountAuthMenuSurfaceInput = {
  readonly parent: HTMLElement;
  readonly viewModel: AuthMenuViewModel;
  readonly onIntent: (intent: AuthMenuIntent) => void;
};

const documentStyles = new WeakMap<Document, CspStylesheetManager>();
let nextSurfaceId = 0;

function authMenuStyles(document: Document): CspStylesheetManager {
  let styles = documentStyles.get(document);
  if (!styles) {
    styles = createCspStylesheetManager({
      doc: document,
      baseCss: '',
      dynamicStyleDataAttr: 'data-seams-auth-menu-dynamic',
      nonce: getDefaultCspNonce,
    });
    documentStyles.set(document, styles);
  }
  return styles;
}

class MountedAuthMenuSurface implements AuthMenuSurfaceHandle {
  readonly element: HTMLElement;
  private readonly styles: CspStylesheetManager;
  private state:
    | { kind: 'mounted'; onIntent: (intent: AuthMenuIntent) => void }
    | { kind: 'disposed' };

  constructor(input: MountAuthMenuSurfaceInput) {
    const document = input.parent.ownerDocument;
    this.styles = authMenuStyles(document);
    this.element = document.createElement('div');
    this.element.className = 'seams-wallet-ui seams-auth-menu-surface';
    this.element.id = `seams-auth-menu-${++nextSurfaceId}`;
    this.state = { kind: 'mounted', onIntent: input.onIntent };
    this.element.addEventListener('cancel', this.cancel);
    input.parent.appendChild(this.element);
    try {
      this.update(input.viewModel);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  update(viewModel: AuthMenuViewModel): void {
    if (this.state.kind === 'disposed') return;
    this.element.dataset.theme = viewModel.appearance.theme.mode;
    this.styles.setDynamicRule(
      this.element.id + '-appearance',
      appearanceTokenCssRule(this.element.id, viewModel.appearance),
    );
    render(
      <AuthMenuSurface
        element={this.element}
        viewModel={viewModel}
        onIntent={this.state.onIntent}
        styles={this.styles}
      />,
      this.element,
    );
  }

  dispose(): void {
    if (this.state.kind === 'disposed') return;
    this.state = { kind: 'disposed' };
    this.element.removeEventListener('cancel', this.cancel);
    render(null, this.element);
    this.styles.deleteDynamicRule(this.element.id + '-appearance');
    this.element.remove();
  }

  // The host's generic PM_CANCEL boundary can dismiss the surface without loading a renderer.
  private cancel = (): void => {
    if (this.state.kind === 'mounted') {
      this.state.onIntent({ kind: 'close', reason: 'close_button' });
    }
  };
}

export function mountAuthMenuSurface(input: MountAuthMenuSurfaceInput): AuthMenuSurfaceHandle {
  return new MountedAuthMenuSurface(input);
}

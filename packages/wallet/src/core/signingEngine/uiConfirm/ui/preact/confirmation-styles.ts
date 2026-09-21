import {
  createCspStylesheetManager,
  getDefaultCspNonce,
  type CspStylesheetManager,
} from '@/core/browser/walletIframe/csp-stylesheet';

const documentStyles = new WeakMap<Document, CspStylesheetManager>();

export function confirmationDocumentStyles(document: Document): CspStylesheetManager {
  const marker = 'data-seams-wallet-ui-css';
  const link = document.head.querySelector<HTMLLinkElement>(`link[rel="stylesheet"][${marker}]`);
  try {
    if (link?.sheet && !link.disabled && link.sheet.cssRules.length > 0) {
      let styles = documentStyles.get(document);
      if (!styles) {
        styles = createCspStylesheetManager({
          doc: document,
          baseCss: '',
          dynamicStyleDataAttr: 'data-seams-confirmation-dynamic',
          nonce: getDefaultCspNonce,
        });
        documentStyles.set(document, styles);
      }
      return styles;
    }
  } catch {
    // Failed or inaccessible styles cannot establish a styled first measurement.
  }
  throw new Error(`Wallet confirmation stylesheet unavailable: ${marker}`);
}

import {
  createCspStylesheetManager,
  getDefaultCspNonce,
  type CspStylesheetManager,
} from '@/core/browser/walletIframe/csp-stylesheet';

const documentStyles = new WeakMap<Document, CspStylesheetManager>();

export function confirmationDocumentStyles(document: Document): CspStylesheetManager {
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

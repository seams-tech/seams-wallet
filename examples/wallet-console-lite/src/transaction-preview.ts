import '../../../packages/wallet/dist/esm/sdk/wallet-ui.css';
import '../../../tests/browser-app/receipt-preview.js';

function resizePreviewFrame() {
  const frame = window.frameElement;
  if (!frame) return;

  const height = Math.max(850, Math.ceil(document.body.getBoundingClientRect().height) + 48);
  frame.setAttribute('height', String(height));
}

const resizeObserver = new ResizeObserver(resizePreviewFrame);
resizeObserver.observe(document.body);
resizePreviewFrame();

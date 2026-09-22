import '../../../packages/wallet/dist/esm/sdk/wallet-ui.css';
import '../../../tests/browser-app/receipt-preview.js';

function resizePreviewFrame() {
  const frame = window.frameElement;
  if (!frame) return;

  const content = document.querySelector('.seams-drawer-content');
  const controls = document.querySelector('.seams-drawer-controls');
  const drawerHeight = (content?.scrollHeight ?? 0) + (controls?.getBoundingClientRect().height ?? 0);
  const height = Math.ceil(Math.max(850, document.body.getBoundingClientRect().height + 48, drawerHeight + 48));
  frame.setAttribute('height', String(height));
}

function observePreviewContent() {
  resizeObserver.disconnect();
  resizeObserver.observe(document.body);
  for (const element of document.querySelectorAll('.seams-drawer-content, .seams-drawer-controls')) {
    resizeObserver.observe(element);
  }
  resizePreviewFrame();
}

const resizeObserver = new ResizeObserver(resizePreviewFrame);
const contentObserver = new MutationObserver(observePreviewContent);
contentObserver.observe(document.body, { childList: true, subtree: true });
observePreviewContent();

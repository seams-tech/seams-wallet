import '../../../packages/wallet/dist/esm/sdk/wallet-ui.css';
import '../../../tests/browser-app/receipt-preview.js';
import {
  addSurfaceResizeBeginListener,
  type SurfaceResizeBeginDetail,
  type SurfaceResizeDriver,
} from '@wallet-preview/core/signingEngine/uiConfirm/ui/surface-resize-events';

let modalResize: { driver: SurfaceResizeDriver; started: number; frame: number } | null = null;

function finishModalResize() {
  if (!modalResize) return;
  cancelAnimationFrame(modalResize.frame);
  modalResize.driver.setProgress(1);
  modalResize.driver.finish();
  modalResize = null;
}

function animateModalResize(now: number) {
  if (!modalResize) return;
  const progress = Math.min(1, (now - modalResize.started) / 260);
  modalResize.driver.setProgress(1 - (1 - progress) ** 3);
  if (progress === 1) {
    finishModalResize();
    return;
  }
  modalResize.frame = requestAnimationFrame(animateModalResize);
}

function beginModalResize(event: CustomEvent<SurfaceResizeBeginDetail>) {
  if (event.detail.reason !== 'confirm-body' || !(event.target instanceof Element)) return;
  if (!event.target.matches('.modal-container-root')) return;
  finishModalResize();
  const driver = event.detail.claim();
  if (!driver) return;
  modalResize = { driver, started: performance.now(), frame: 0 };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    finishModalResize();
    return;
  }
  modalResize.frame = requestAnimationFrame(animateModalResize);
}

addSurfaceResizeBeginListener(document, beginModalResize);

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

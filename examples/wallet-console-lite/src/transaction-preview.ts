import '../../../packages/wallet/dist/esm/sdk/wallet-ui.css';
import '../../../tests/browser-app/receipt-preview.js';

function canScrollVertically(target: EventTarget | null, deltaY: number): boolean {
  let element = target instanceof Element ? target : null;

  while (element) {
    const overflowY = getComputedStyle(element).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') {
      const remaining = deltaY > 0
        ? element.scrollHeight - element.clientHeight - element.scrollTop
        : element.scrollTop;
      if (remaining > 0) return true;
    }
    element = element.parentElement;
  }

  return false;
}

function scrollParentPage(event: WheelEvent) {
  if (!window.frameElement || event.defaultPrevented || event.ctrlKey || event.deltaY === 0) return;
  if (canScrollVertically(event.target, event.deltaY)) return;

  let deltaY = event.deltaY;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    deltaY *= 16;
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    deltaY *= window.innerHeight;
  }
  window.parent.scrollBy(0, deltaY);
  event.preventDefault();
}

document.addEventListener('wheel', scrollParentPage, { passive: false });

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

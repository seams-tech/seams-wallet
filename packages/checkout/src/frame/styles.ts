/**
 * The styles of the checkout frame. The frame adopts them as a constructed stylesheet, so its
 * document needs no inline style and no style file.
 */
export const FRAME_CSS = `
:root {
  --co-accent: #1f2937;
  --co-radius: 10px;
  --co-button-height: 48px;
  --co-font: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif;
  --co-text: #111827;
  --co-muted: #6b7280;
  --co-line: #d1d5db;
  --co-surface: #ffffff;
  --co-soft: #f3f4f6;
  --co-danger: #b91c1c;
  color-scheme: light;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: transparent; }
body { font: 16px/1.5 var(--co-font); color: var(--co-text); -webkit-text-size-adjust: 100%; }
.co { background: var(--co-surface); padding: 20px; display: grid; gap: 16px; }
.co[data-presentation="modal"] { border-radius: 16px; }
.co-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.co-title { margin: 0; font-size: 20px; line-height: 1.3; font-weight: 650; }
.co-close {
  width: 40px; height: 40px; border: 0; border-radius: 50%; background: transparent;
  color: var(--co-muted); font-size: 22px; line-height: 1; cursor: pointer;
}
.co-close:hover { background: var(--co-soft); color: var(--co-text); }
.co-summary { border: 1px solid var(--co-line); border-radius: var(--co-radius); padding: 0 14px; }
.co-summary > summary {
  display: flex; justify-content: space-between; gap: 12px; padding: 12px 0;
  cursor: pointer; font-weight: 600; list-style: none;
}
.co-summary > summary::-webkit-details-marker { display: none; }
.co-lines { margin: 0; padding: 0 0 12px; list-style: none; display: grid; gap: 6px; }
.co-lines li { display: flex; justify-content: space-between; gap: 12px; color: var(--co-muted); }
.co-amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
.co-form { display: grid; gap: 16px; margin: 0; }
.co-methods { border: 0; margin: 0; padding: 0; min-width: 0; display: grid; gap: 8px; }
.co-methods > legend { padding: 0 0 8px; font-weight: 600; }
.co-method {
  border: 1px solid var(--co-line); border-radius: var(--co-radius); background: var(--co-surface);
}
.co-method:has(input:checked) { border-color: var(--co-accent); box-shadow: 0 0 0 1px var(--co-accent); }
.co-method > label {
  display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 14px; cursor: pointer;
}
.co-method input { width: 18px; height: 18px; margin: 0; accent-color: var(--co-accent); }
.co[data-layout="tabs"] .co-methods { grid-auto-flow: column; grid-auto-columns: 1fr; }
.co[data-layout="tabs"] .co-method > label { justify-content: center; }
.co[data-layout="tabs"] .co-method input { position: absolute; opacity: 0; pointer-events: none; }
.co[data-layout="tabs"] .co-method:has(input:focus-visible) { outline: 2px solid var(--co-accent); outline-offset: 2px; }
.co-panel { display: grid; gap: 12px; }
.co[data-layout="accordion"] .co-method > .co-panel { padding: 0 14px 14px; }
.co-field { display: grid; gap: 6px; }
.co-field > span { font-size: 14px; font-weight: 600; }
.co-field > input {
  height: 44px; padding: 0 12px; border: 1px solid var(--co-line); border-radius: var(--co-radius);
  font: inherit; color: inherit; background: var(--co-surface); width: 100%;
}
.co-field > input:focus-visible, .co-pay:focus-visible, .co-close:focus-visible, .co-link:focus-visible {
  outline: 2px solid var(--co-accent); outline-offset: 2px;
}
.co-provider { min-height: 44px; }
.co-pay {
  height: var(--co-button-height); width: 100%; border: 0; border-radius: var(--co-radius);
  background: var(--co-accent); color: #ffffff; font: inherit; font-weight: 650; cursor: pointer;
}
.co-pay:disabled { opacity: 0.45; cursor: default; }
.co-error { margin: 0; color: var(--co-danger); font-size: 14px; }
.co-error:empty { display: none; }
/* The live region stays in the page when it is empty, so a new text is announced. */
.co-status:empty { position: absolute; }
.co-status { margin: 0; color: var(--co-muted); font-size: 14px; }
.co-screen { display: grid; gap: 12px; justify-items: center; text-align: center; padding: 20px 0 4px; }
.co-screen h2 { margin: 0; font-size: 20px; line-height: 1.3; }
.co-screen p { margin: 0; color: var(--co-muted); }
.co-mark {
  width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center;
  background: var(--co-accent); color: #ffffff; font-size: 28px; line-height: 1;
}
.co-spinner {
  width: 32px; height: 32px; border-radius: 50%;
  border: 3px solid var(--co-soft); border-top-color: var(--co-accent);
  animation: co-spin 0.8s linear infinite;
}
@keyframes co-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .co-spinner { animation-duration: 2.4s; } }
`;

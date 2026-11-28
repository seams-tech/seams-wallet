/** The styles of the account frame. The dialog of the page draws the card, its radius and its shadow. */
export const ACCOUNT_FRAME_CSS = `
:root {
  color-scheme: light dark;
  --auth-text: #14171a;
  --auth-muted: #5b6470;
  --auth-surface: #ffffff;
  --auth-line: #d7dce2;
  --auth-accent: #1f6f4a;
  --auth-accent-text: #ffffff;
  --auth-danger: #b3261e;
  --auth-control-radius: 12px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --auth-text: #f2f4f6;
    --auth-muted: #a3acb8;
    --auth-surface: #16191d;
    --auth-line: #353b44;
    --auth-accent: #58b98a;
    --auth-accent-text: #0c1a13;
    --auth-danger: #f2b8b5;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--auth-surface); color: var(--auth-text); }
body { font: 16px/1.5 system-ui, -apple-system, 'Segoe UI', 'Noto Sans JP', sans-serif; }
.menu { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.menu[hidden] { display: none; }
.head { display: flex; align-items: flex-start; gap: 12px; }
.head h1 { flex: 1; margin: 0; font-size: 20px; line-height: 1.3; font-weight: 650; }
.subtitle { margin: -8px 0 0; color: var(--auth-muted); }
.stack { display: flex; flex-direction: column; gap: 12px; }
button, input { font: inherit; color: inherit; }
.button {
  min-height: 48px; padding: 0 16px; border-radius: var(--auth-control-radius);
  border: 1px solid var(--auth-line); background: transparent; cursor: pointer;
  font-weight: 600; text-align: center;
}
.button.primary { background: var(--auth-accent); border-color: var(--auth-accent); color: var(--auth-accent-text); }
.button.quiet { border-color: transparent; color: var(--auth-muted); min-height: 40px; font-weight: 500; }
.button.icon { min-height: 32px; width: 32px; padding: 0; border-color: transparent; font-size: 20px; line-height: 1; }
.button:disabled { opacity: 0.55; cursor: default; }
.button:focus-visible, .field:focus-visible { outline: 2px solid var(--auth-accent); outline-offset: 2px; }
.field {
  min-height: 48px; width: 100%; padding: 0 14px; border-radius: var(--auth-control-radius);
  border: 1px solid var(--auth-line); background: transparent;
}
.field.code { font-size: 22px; letter-spacing: 0.35em; text-align: center; font-variant-numeric: tabular-nums; }
label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; color: var(--auth-muted); }
.divider { height: 1px; background: var(--auth-line); margin: 4px 0; }
.error { margin: 0; color: var(--auth-danger); font-size: 14px; }
.error:empty { display: none; }
.purpose { margin: 0; padding: 12px 14px; border-radius: var(--auth-control-radius); border: 1px solid var(--auth-line); }
.row { display: flex; align-items: center; gap: 12px; min-height: 48px; }
.row .name { flex: 1; }
.row .label { color: var(--auth-muted); font-size: 14px; }
.surface[hidden] { display: none; }
@media (prefers-reduced-motion: no-preference) {
  .button { transition: opacity 120ms ease; }
}
`;

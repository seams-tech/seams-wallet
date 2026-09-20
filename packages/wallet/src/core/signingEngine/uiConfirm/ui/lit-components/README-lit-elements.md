# WebAuthn Iframe Lit Components

## What Are Iframe Lit Components?

Lit‑based web components that power the wallet UI in the wallet iframe (wallet origin):

- `<seams-modal-tx-confirmer>` and `<seams-drawer-tx-confirmer>` render directly in the wallet iframe.
- Shared building blocks include `<seams-drawer>`, `<seams-tx-tree>`, `<seams-halo-border>`, and `<seams-passkey-halo-loading>`.
- Private-key export is rendered by the Preact surface in `ui/preact/ExportPrivateKeySurface.tsx`.

All components are CSP‑safe: static CSS is externalized under `/sdk/*` and dynamic values are applied via constructable stylesheets (no inline styles or `<style>` tags). TxTree defaults to light DOM (opt‑in Shadow DOM via `shadow-dom`).

## Components

- IframeTxConfirmer: modal and drawer variants for confirmation UI
- Drawer: reusable sliding container used by the drawer variant
- TxTree: lightweight, themeable transaction tree
- HaloBorder and PasskeyHaloLoading: animated visuals used in confirm flows

See the component index below for file paths and tags.

## Runtime Architecture

- Confirmer UI elements run in the wallet iframe (wallet origin) and never require parent DOM access.
- Components render in the wallet iframe and communicate through the wallet protocol.

## Editing Components and Styles

These components use a small base helper and a variable‑driven styling approach:

- `LitElementWithProps.ts` handles the Lit upgrade race and exposes `applyStyles()` that maps JS objects to `--seams-*` CSS variables.
- Component themes (e.g., tooltip tree, modal) are plain objects applied through `applyStyles` so you can override any section without touching the component internals.

For guidance on editing properties, style sections, and the CSS variable naming convention, see:

- `./lit-element-with-props.md` – how properties are upgraded and how `applyStyles` maps section/key pairs to CSS vars.

## Styles and CSP

We no longer inject inline styles or `<style>` tags. All components follow strict CSP (no `unsafe-inline`) using:

- External CSS files served under the SDK base (default `/sdk/*`).
- Constructable stylesheets (adoptedStyleSheets) for both static CSS and dynamic CSS variables.
- First‑paint gating to avoid FOUC while styles load.

Key utilities:

- `css/css-loader.ts` → `ensureExternalStyles(root, assetName, marker)` adopts external CSS (ShadowRoot, srcdoc import, or head `<link>` fallback).
- `LitElementWithProps#setCssVars(vars)` writes variables via constructable stylesheets (never `element.style`).

Tokens and scoping:

- Theme tokens come from `css/seams-components.css`.
- Component variables follow `--seams-${component}__${section}__${prop}`.

Other notes:

- Base resolution: `asset-base.ts#resolveEmbeddedBase()` prefers `window.__SEAMS_WALLET_SDK_BASE__`, else `/sdk/`.
- Shadow vs light DOM: TxTree defaults to light DOM; others use Shadow DOM and adopt styles there.

### CSS assets by component

- Shared theme/tokens: `css/seams-components.css`
- TxTree visuals: `css/tx-tree.css`
- Tx confirmer layout/tokens: `css/tx-confirmer.css`
- Drawer (when used): `css/drawer.css`
- Halo ring + loading icon: `css/halo-border.css`, `css/passkey-halo-loading.css`, `css/padlock-icon.css`
- Export private key UI: `ui/preact/export-private-key.css` (included by `confirmation-ui.css`)

These assets are emitted under the SDK base and are loaded at runtime through `ensureExternalStyles()`.

Examples omitted for brevity; see HaloBorder, PasskeyHaloLoading, and Modal viewer for usage.

## Subcomponent Docs

- TxTree: `./TxTree/README.md`

## Confirm UI API

- File: `client/src/core/signingEngine/uiConfirm/ui/confirm-ui.ts`
- Element contract: `client/src/core/signingEngine/uiConfirm/ui/confirm-ui-types.ts`

Confirm UI is container‑agnostic and driven by `uiMode: 'none' | 'modal' | 'drawer'`.

- Element contract: `ConfirmUIElement` supports `deferClose` and `close(confirmed)`.
- Helpers: `mountConfirmUI()` and `awaitConfirmUIDecision()` mount and coordinate lifecycle.

## Editing Guide (brief)

When adding or refactoring components:

- Expose a single defining module that calls `customElements.define()`.
- If moving/renaming, update build entries and re‑exports so the defining chunk still emits under `/sdk/*`.
- In the wallet host, dynamically import the element module before `document.createElement()`.
- Ensure required CSS assets exist in `css/` and are adopted via `ensureExternalStyles()`.

## Component Index

- IframeTxConfirmer/
  - `viewer-modal.ts` — `<seams-modal-tx-confirmer>`
  - `viewer-drawer.ts` — `<seams-drawer-tx-confirmer>`
  - `tx-confirmer-wrapper.ts` — inline wrapper selects variant

- Drawer/ — `index.ts` — `<seams-drawer>`
- TxTree/ — `index.ts` — `<seams-tx-tree>` (light DOM by default)
- HaloBorder/ — `index.ts` — `<seams-halo-border>`
- PasskeyHaloLoading/ — `index.ts` — `<seams-passkey-halo-loading>`

- Base / helpers
  - `LitElementWithProps.ts` — CSP‑safe CSS variable application
  - `confirm-ui.ts`, `confirm-ui-types.ts` — confirm UI API and types
  - `css/css-loader.ts` — external CSS adoption
  - `registry.ts` — tag names and ensure-defined helpers

## Importing and Composing (quick checklist)

- Define the element in a standalone module and `customElements.define()` it.
- In wallet host paths, dynamically `await import('<module>')` before `document.createElement('<tag>')`.
- When composing, keep required sub‑elements referenced so they aren’t tree‑shaken (e.g., private field or `static keepDefinitions`).
- For iframe bootstraps, set variant flags before element creation.
- Use two‑phase close (`deferClose`) for animated flows; close after animation.
- Validate in dev: `/sdk/*.js` 200; element upgrades; READY/SET\_\* messages flow.

## Troubleshooting Styles + FOUC

- Unstyled component: ensure correct SDK base; confirm a single head `<link data-seams-…>` or adopted sheet; check `/sdk/*.css` fetches succeed without CSP errors.
- FOUC: gate first paint on `ensureExternalStyles()` settling (see HaloBorder, PasskeyHaloLoading, Modal viewer patterns).
- CSP violations: never write `element.style`; use `setCssVars()` + external CSS.

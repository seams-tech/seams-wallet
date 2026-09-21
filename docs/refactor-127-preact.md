# Refactor 127: replace internal Lit surfaces with Preact

**Status:** Proposed. This plan changes the wallet's internal UI renderer while
preserving wallet behavior, iframe protocols, strict-CSP guarantees, and public
React APIs.

The `w3a-*` to `seams-*` rename is complete: Wallet commit `52a9c7d`
and monorepo commit `823fc40`. This refactor starts from that state. Consumer
release adoption remains pending; source migration and published-package
integration must be verified separately.

## Decision

Use native Preact for wallet-owned hosted browser surfaces. Public React UI
continues to use native React. Do not use
`preact/compat`.

Keep lifecycle and domain state in the existing controllers, sessions, and
discriminated view models. Preact owns rendering and local presentation state.
Every production surface mounts through an explicit function, receives a fully
normalized model plus typed callbacks, and returns an explicit update/dispose
handle.

The target architecture has:

- no wallet-owned custom elements;
- no `LitElement`, `lit-html`, or `@lit/react` dependency;
- no import whose purpose is to execute `customElements.define()`;
- no observer for elements that failed to upgrade;
- no component-owned stylesheet fetching or first-render stylesheet gates;
- no Shadow DOM in wallet-owned surfaces;
- one externally linked, render-blocking wallet UI stylesheet per wallet
  document;
- dynamic imports only at real code-splitting boundaries.

The public generic `registerWalletUI` / `mountWalletUI` extension API currently
accepts custom-element tag definitions. It is separate from the built-in Lit
surfaces and has no built-in registry entries. Preserve it during this refactor,
rename its implementation from `lit` to `custom-element`, and document that the
caller owns definition registration. Removal of that public extension API is a
separate product/API decision.

## Why Preact

- Preact keeps the iframe renderer small while providing conventional typed
  components, refs, effects, and explicit roots.
- The repository already uses TSX extensively. Preact files can use the
  automatic JSX runtime through `@jsxImportSource preact` without adding a
  Solid or Svelte compiler pipeline.
- Preact renders ordinary DOM, so the wallet document's existing external CSS
  can style every surface under strict CSP.
- Native callback props replace custom DOM-event plumbing between components
  owned by the same renderer.
- The public `@seams/wallet/react` package remains React. Preact stays inside
  wallet-origin embedded bundles and does not leak Preact types into the React
  API.

Add `preact` as a direct dependency. Externalize it from preserved public ESM
library modules and bundle it into the browser-embedded wallet entries, as is
already done for other embedded runtime dependencies. Do not alias `react` or
`react-dom` to Preact.

## Goals

1. Preserve the current auth-menu, confirmation, key-export, and recovery-code
   behavior.
2. Preserve WebAuthn user activation, iframe measurement, focus restoration,
   keyboard handling, drag behavior, and close/decision semantics.
3. Preserve strict CSP with `style-src-attr 'none'`; Preact components must not
   use `style={...}` or inject `<style>` elements.
4. Make surface loading deterministic and make failures explicit.
5. Reduce shipped UI infrastructure and keep total production-compressed
   wallet UI JavaScript at or below the current baseline.
6. Leave one understandable render path for each surface and delete the
   replaced Lit path in the same slice.

## Non-goals

- Rewriting signing, authentication, recovery, or wallet-session domain state.
- Changing wallet iframe RPC/message semantics unless a message exists only to
  support retired Lit registration.
- Moving the public React package to Preact.
- Adding SSR or hydration to wallet-origin surfaces.
- Introducing Preact Signals, a global UI store, a router, a component library,
  CSS-in-JS, or a second styling system.
- Preserving wallet-owned custom-element tag APIs after their surface has moved
  to Preact.

## Current inventory

| Responsibility | Current implementation | Target |
| --- | --- | --- |
| Shared Lit lifecycle, property upgrade, definition retention, appearance variables | `packages/wallet/src/core/signingEngine/uiConfirm/ui/lit-components/LitElementWithProps.ts` | Delete. Normalize props before mounting; apply appearance through the document-level CSP stylesheet manager. |
| Tag registry and definition repair | `packages/wallet/src/core/signingEngine/uiConfirm/ui/registry.ts` | Delete for built-in surfaces. Import a surface module and call its exported mount function. |
| External stylesheet adoption | `packages/wallet/src/core/signingEngine/uiConfirm/ui/lit-components/css/css-loader.ts` | Delete after the final Lit surface is removed. Static CSS is owned by wallet-service HTML. |
| Un-upgraded-element observer | `packages/wallet/src/SeamsWeb/walletIframe/host/bootstrap.ts` | Delete after the last built-in custom-element consumer is migrated. |
| Auth menu | `host/lit-ui/auth-menu/seams-auth-menu-surface.ts` | `host/ui/auth-menu/AuthMenuSurface.tsx` plus `mountAuthMenuSurface.tsx`. |
| Auth-menu domain model | `host/lit-ui/auth-menu/auth-menu-domain.ts` | Move to `host/ui/auth-menu/auth-menu-domain.ts` without changing its discriminated states. |
| Auth-menu orchestration | `host/auth-menu/session.ts` | Keep as owner of lifecycle state; replace element creation/property writes/events with a Preact surface handle. |
| Transaction confirmation | `IframeTxConfirmer/*` | One Preact subtree under `ui/surfaces/tx-confirm/`; keep the existing `ConfirmUIHandle` boundary. |
| Transaction tree parsing and formatting | `TxTree/abi/*`, `TxTree/renderers/*`, `tx-tree-utils.ts`, `common/formatters.ts` | Move unchanged framework-neutral logic under `ui/model/tx-tree/`; render it with Preact components. |
| Drawer, halo, passkey loader, padlock | Lit elements beneath `lit-components/` | Plain Preact components and inline SVG/ordinary DOM. They are internal primitives, with no standalone custom-element registration. |
| Key export | `ExportPrivateKey/iframe-host.ts`, `viewer.ts`, and `export-viewer-host.ts` | `ExportPrivateKeySurface.tsx` plus an imperative `mountExportPrivateKeySurface()` handle. |
| Recovery-code backup | `RecoveryCodeBackup/host.ts`, `viewer.ts`, `events.ts` | `RecoveryCodeBackupSurface.tsx` with typed result callbacks. |
| Surface measurement | `host/lit-ui/surface-measurement-reporter.ts` | Move to `host/ui/surface-measurement-reporter.ts`; keep it framework-neutral. |
| Generic iframe UI extension | `iframe-lit-elem-mounter.ts`, `iframe-lit-element-registry.ts` | Rename to `iframe-custom-element-mounter.ts` and `iframe-custom-element-registry.ts`; do not use it for built-in Preact surfaces. |
| React adapters | `LitDrawer.tsx`, `LitHaloBorder.tsx`, `LitPasskeyHaloLoading.tsx` | Delete. Use native React components in the public React tree; reuse existing React `HaloBorder` where appropriate. |
| Build inputs and static CSS emission | `packages/wallet/rolldown.config.ts`, `plugin-utils.ts`, static-asset assertions | Point entries at Preact mount modules and emit a consolidated wallet UI stylesheet. |
| Browser coverage | `tests/lit-components/*`, `tests/wallet-iframe/*` | Move renderer-independent surface tests to `tests/wallet-ui/*`; retain wallet-iframe integration tests. |

Pure model, parsing, formatting, measurement, and CSP-rule code must move out
of directories named after Lit. Avoid rewriting correct domain logic while
moving it.

## Target surface contract

Each surface gets a branch-specific mount API. Do not introduce a broad
`Record<string, unknown>` component abstraction for built-in UI.

For example, the auth menu should expose the equivalent of:

```ts
type AuthMenuSurfaceHandle = {
  readonly element: HTMLElement;
  update(viewModel: AuthMenuViewModel): void;
  dispose(): void;
};

function mountAuthMenuSurface(input: {
  parent: HTMLElement;
  viewModel: AuthMenuViewModel;
  onIntent: (intent: AuthMenuIntent) => void;
}): AuthMenuSurfaceHandle;
```

`update()` renders a complete valid view model. It does not accept partial raw
props. `dispose()` renders `null`, removes the owned root, cancels effects and
animation frames, releases measurement observers, and clears references to
sensitive display data.

The confirmation and export surfaces follow the same ownership pattern with
their own exact models and callbacks. Keep `ConfirmUIHandle` as the integration
boundary. Its `element` becomes the actual Preact surface root, while `update`,
`close`, `onCancel`, and `takeDecision` retain their current behavior.

Normalize the existing optional `ConfirmUIUpdate` patch at the imperative
boundary into a complete internal `ConfirmSurfaceModel`. Preact components must
receive a valid branch rather than reconstructing state from optional fields.

## Rendering and event rules

- The controller/session owns workflow state. A Preact component may hold only
  local presentation state such as an expanded tree node, copied indicator,
  current input text, drag position, or focus target.
- Parent-to-surface changes use `handle.update(completeModel)`.
- Surface-to-parent communication uses typed callbacks. Custom DOM events remain
  only where an actual external DOM boundary consumes them.
- A click that begins WebAuthn must invoke its controller callback synchronously
  in the trusted event stack. Do not defer the callback through an effect,
  timeout, state transition, or promise microtask.
- Use native Preact event names intentionally. Form input changes use
  `onInput`; keyboard and pointer handlers consume browser events directly.
- Attach measurement reporters to the rendered surface element after the first
  committed render. CSS must already be available, so the first reported size
  is styled and stable.
- Use stable class names and `data-*` state selectors. Do not retain custom tags
  merely as CSS selectors.

## Styling and strict CSP

The production wallet-service HTML already places external stylesheet links in
`<head>` before the module entry. Make that document boundary authoritative.

1. Emit one ordered `wallet-ui.css` containing the current wallet-service,
   component token, auth-menu, drawer, transaction tree, confirmer, halo,
   passkey loading, key-export, copy-icon, and recovery-code rules.
2. Link `wallet-ui.css` before the wallet host module in
   `buildWalletServiceHtml()`. Verify startup and first measurement with delayed
   CSS under the actual document loading sequence. A render-blocking link alone
   is insufficient evidence that every programmatic mount waits for CSS.
   If explicit readiness is needed, own it once at document bootstrap with a
   defined failure path. Remove surface gates only after this contract passes.
3. Convert custom-tag and `:host` selectors to scoped classes beneath a wallet
   UI root, for example `.seams-wallet-ui .seams-tx-confirm-surface`.
4. Keep `createCspStylesheetManager` for genuinely dynamic values such as
   measured geometry, drag translation, and configured appearance colors.
   Prefer classes and `data-*` attributes for finite states. Sanitize dynamic
   property names and values once before writing a keyed document rule.
5. Remove per-instance constructed stylesheets, stylesheet fetching, CSS marker
   attributes, and `shouldUpdate()` first-paint gates after the last Lit surface
   is gone.
6. Make the browser-test harness link `wallet-ui.css` explicitly before mounting
   a surface. Tests must not rely on a component silently fetching its own CSS.

The iframe remains the style/isolation boundary for hosted surfaces. Inventory
supported inline, standalone, and host-document mounts before implementation:
each document needs an explicit static stylesheet owner, scoped selectors, and
the existing appearance contract. Public React components retain their own
stylesheet entry. Multiple simultaneous surfaces must not share mutable rule
ownership or leak styles into one another.

Implement stylesheet ownership in Phase 2 and consolidation in Phase 8.
During the intervening phases, documents may link separate surface stylesheets;
each static rule has one authoritative source.

## Delivery phases

Each numbered phase is a review checkpoint. Subphases are separate changes
where practical. Finish a phase's exit checks before starting its dependent
renderer cutover. The initial implementation task is Phase 0.

### Rules for every phase

- [ ] Record the starting commit, affected surfaces, supported mount contexts,
  and the focused commands that establish their current behavior.
- [ ] Add missing behavioral coverage against the existing implementation
  before replacing it. Preserve assertions for supported behavior; adapt only
  renderer-specific setup/selectors during the cutover.
- [ ] Separate moves of pure code, renderer changes, CSS consolidation, and
  domain bug fixes into reviewable changes. Keep changes to a surface's DOM and
  matching CSS together where they are inseparable.
- [ ] Keep controllers, protocols, and state transitions stable. If a renderer
  cannot express the existing contract, resolve that issue before expanding
  the migration.
- [ ] Maintain one active renderer per surface. Different surfaces may use
  different renderers during migration. Add no renderer flags, duplicate
  production implementations of the same surface, or fallback render paths.
- [ ] Delete a replaced surface's implementation in its cutover change.
  Delete shared Lit infrastructure only after its final live consumer is gone.
- [ ] Run focused behavior and neighboring-surface smoke tests, production
  build/type checks, CSP checks, and relevant bundle measurements.
- [ ] Investigate every new failure before advancing. Revert the complete
  phase change if it cannot meet its gate; use Git history for rollback.
  No runtime compatibility switch is introduced.
- [ ] Record actual results and remaining prerequisites here. Do not mark a
  checkbox complete solely because implementation exists.

### 0. Establish a trustworthy regression baseline

**Scope:** verification and baseline tooling; current renderers stay active.

- [x] Complete the namespace cutover in Wallet and monorepo.
- [x] Verify the cutover's Wallet production build, both repository type checks,
  Lit suite (63/63), and React theme/account-menu tests (5/5), as recorded on
  2026-09-20.
- [ ] Reproduce the reported wallet-iframe result (44/52) and record each of the
  eight failures: exact test, invariant, failure output, reproduction command,
  and baseline commit. The claim that they are unrelated remains unverified
  until this triage is complete.
- [ ] Classify each failure as `production_regression`,
  `valid_test_needs_update`, `obsolete_test_or_fixture`, or
  `environment_or_infrastructure_failure`. Fix supported production behavior
  separately; repair valid tests; remove obsolete tests with the rationale.
- [ ] Require green tests for a surface's affected invariants before migrating
  it. An unrelated failure may remain documented with its owner and scope;
  a failure in measurement, overlays, focus, or decision handling blocks the
  dependent surface's cutover. Do not skip or weaken assertions to proceed.
- [ ] Repair `report-wallet-iframe-bundle-size.mjs` to measure static imports,
  lazy UI imports, and direct browser entries. Deduplicate shared chunks within
  each document graph and report cold-load and incremental feature bytes.
- [ ] Record raw, gzip, and Brotli totals for boot, auth, confirmation, export,
  recovery, and CSS, with build command and commit. Track per-flow bytes and
  the union of reachable UI assets so moved imports cannot hide growth.
- [ ] Capture the visual baseline described below for every registered
  wallet-owned Lit element. Use deterministic synthetic account, transaction,
  key, and recovery-code fixtures.
- [ ] Inventory supported wallet-service, standalone, inline, host-document,
  and public React entrypoints, including external event consumers and
  stylesheet ownership.
- [ ] Identify the authoritative Wallet tests and private consumer tests.
  Resolve the monorepo React theme test's missing `tests/setup/bootstrap`
  dependency through current test ownership before relying on that suite.
- [ ] Record the supported browser matrix and which tests need actual
  WebAuthn/browser evidence beyond Chromium's virtual authenticator.

**Exit:** every baseline failure is classified, affected invariants have
passing tests, and reproducible behavior/visual/size baselines are recorded.
A blanket claim of a green suite is insufficient while failures remain.

The earlier artifact measurements are provisional reference values:

| Artifact | Gzip size |
| --- | ---: |
| `LitElementWithProps` shared chunk | 10.3 KiB |
| halo standalone bundle | 10.2 KiB |
| passkey-loading standalone bundle | 11.0 KiB |
| export viewer | 17.1 KiB |
| transaction confirmer | 39.4 KiB |
| complete transaction UI entry | 46.0 KiB |
| currently preloaded component CSS set | 28.7 KiB |

Replace these with measured dependency-graph totals before using them as
budgets. Temporary coexistence of Lit and Preact across different surfaces
may increase the whole-package total. Record that cost; enforce per-flow
budgets during migration and the final total budget after Lit is removed.

#### Visual baseline artifacts

Keep visual evidence outside Git under the already ignored directory
`.artifacts/refactor-127/visual/`:

```text
.artifacts/refactor-127/visual/
  manifest.json
  lit-before/<element>/<fixture>.png
  preact-after/<element>/<fixture>.png
  diff/<element>/<fixture>.png
```

Do not commit these screenshots. Keep the directory for the duration of the
refactor and copy it outside the checkout before deleting or recreating the
worktree. The manifest records the baseline commit, build command, browser and
browser version, operating system, viewport, device scale factor, theme,
reduced-motion setting, locale, fixture name, capture selector, and image path.
Use no real account, transaction, private-key, recovery-code, or email data.

Capture with the same Playwright/browser build before and after each migration.
Wait for `document.fonts.ready`, explicit component readiness, settled layout,
and the intended animation frame. Disable animation only for static-state
captures; add named intermediate captures for motion or drag behavior when
that state is part of the component contract. Prefer an element screenshot for
the component itself and add a page/context screenshot for overlays, drawers,
portals, or iframe sizing whose surrounding geometry is meaningful.

Inventory every currently registered wallet-owned Lit element and its minimum
baseline states:

| Lit element | Minimum visual fixtures |
| --- | --- |
| `seams-auth-menu-surface` | Registration and login; waiting; Google Email OTP; recovery; device linking; validation/error; light, dark, custom theme, and narrow viewport. |
| `seams-drawer` | Open, representative dragged position, closing/settled, narrow viewport, and reduced motion. |
| `seams-tx-tree` | NEAR, EVM, Tempo, and fallback models; collapsed/expanded; long values; light/dark. |
| `seams-halo-border` | Default and active/loading appearance around representative content; light/dark. |
| `seams-passkey-halo-loading` | Initial, active loading, and settled content; light/dark. |
| `seams-padlock-icon` | Default rendered icon at its production size and inherited color. |
| `seams-tx-confirm-content` | Ready, loading, error, Email OTP, and representative chain content. |
| `seams-modal-tx-confirmer` | Ready, loading, error, confirmation pending, and narrow viewport. |
| `seams-drawer-tx-confirmer` | Ready, loading, error, expanded tree, and drawer transition states. |
| `seams-tx-confirmer` | Modal, drawer, and inline routing with the same representative model. |
| `seams-export-key-viewer` | Loading, masked, revealed, copied, multi-key, and error using synthetic keys. |
| `seams-export-viewer-iframe` | Modal and drawer hosts, first stable measurement, loading, revealed, and error. |
| `seams-recovery-code-backup-viewer` | Summary, opening, displayed codes, acknowledgement, and error using synthetic codes. |
| `seams-recovery-code-backup-host` | Modal/host context, first stable measurement, cancellation, and completed state. |

The capture harness must fail when an inventoried element or fixture is missing.
After a surface moves to Preact, capture the matching fixtures under
`preact-after/` and produce side-by-side plus pixel-diff images under `diff/`.
Review all differences. Accept only changes that are intentional and recorded
in the manifest; update the Lit baseline only for a separately approved visual
change made before that surface's migration.

### 1. Stabilize integration contracts and move pure code

**Depends on:** Phase 0 classification of the affected contracts.

- [ ] Characterize auth intent delivery; confirmation mount/update/reuse and
  exactly-once decisions; export/recovery completion and cancellation.
- [ ] Cover cancellation while a lazy import is pending, disposal before its
  completion, duplicate close/confirm events, and updates during closing.
  Late work must not recreate a disposed surface.
- [ ] Move only pure auth-domain, transaction parsing/formatting, and
  measurement code out of Lit directories. Keep algorithms and behavior intact.
- [ ] Preserve existing handle APIs. Introduce complete discriminated render
  models at the existing imperative boundary only where required; normalize
  optional patches there and use branch-specific inputs internally.
- [ ] Add type fixtures for newly introduced domain/lifecycle unions, including
  rejected invalid combinations, plus behavioral tests for boundary updates.
- [ ] Establish ownership of roots, measurements, timers, focus restoration,
  and dynamic stylesheet rules using existing controllers.

**Exit:** existing Lit surfaces still pass their focused contracts after the
moves. No renderer, stylesheet cascade, or public API change ships in this phase.

### 2. Establish document styling and the Preact build path

**Depends on:** Phase 1.

#### 2a. Document-owned static styling

- [ ] Make each supported document link the static CSS needed by its surfaces
  before initialization; preserve current stylesheet order and selectors.
  Keep working Shadow DOM adoption for surfaces still using Lit.
- [ ] Give the browser harness the same explicit stylesheet contract as its
  production entrypoint.
- [ ] Test cold cache, delayed CSS, failed CSS, and failed lazy module loading.
  No unstyled interactive prompt or provisional first size may be published.
  A resource failure must settle the pending operation and permit cleanup.
- [ ] Verify dynamic geometry and appearance rules through the existing CSP
  manager under production policy, including the supported fallback path.
  Keep rule removal scoped to its owning surface.
- [ ] Preserve motion timings, selectors, and appearance while establishing
  ownership. Defer stylesheet concatenation and global selector cleanup.

**Exit:** current surfaces look and behave the same under the document contract.
CSS failure behavior is explicit and no CSP relaxation is required.

#### 2b. Native Preact build support

- [ ] Add `preact` and configure its TSX runtime per Preact file.
- [ ] Verify development and production output use the intended JSX runtime;
  React entrypoints continue to use React.
- [ ] Keep public ESM externals and embedded bundle dependencies consistent.
  Verify a mounted Preact root can update and dispose under the production CSP
  using the same build path planned for the auth menu.
- [ ] Keep renderer imports out of the headless/runtime boot path until a
  surface needs them. Record bundle changes.

**Exit:** build support works without changing a production surface's renderer.

### 3. Migrate the auth menu as the pilot

**Depends on:** Phase 2; auth and measurement baseline gates pass.

- [ ] Render the existing `AuthMenuViewModel` with `AuthMenuSurface.tsx`.
  Cover registration, login, recovery, Google Email OTP, device link, input
  validation, waiting, and failure states.
- [ ] Add `mountAuthMenuSurface()` and make `AuthMenuSession` own its handle.
  Preserve session state, messages, preparation, and recovery orchestration.
- [ ] Wire exact typed callbacks and invoke activation-sensitive controller
  actions synchronously from trusted handlers.
- [ ] Convert only auth-menu selectors to scoped ordinary DOM classes.
  Preserve computed styles and appearance overrides, including fonts/spacing.
- [ ] Attach the existing measurement reporter after a committed render and
  document readiness. Test initial size and size changes during transitions.
- [ ] Run baseline screenshots and input/focus/Escape tests, host integration
  tests, cancellation during load, repeated open/close, and auth-to-confirm
  handoff while confirmation still uses Lit.
- [ ] Capture matched Preact auth-menu fixtures and review every image diff
  against `.artifacts/refactor-127/visual/lit-before/`.
- [ ] Remove the old auth element, its registration, property mutation, event
  bridge, and readiness fields in the cutover change.
- [ ] Retain the shared registry, upgrade observer, and CSS loader for their
  remaining Lit consumers. Remove the auth menu from their built-in lists.
- [ ] Compare pilot code and per-flow compressed bytes with the baseline.
  Record any new infrastructure and whether it serves a demonstrated need.

**Exit:** all auth branches pass behavioral, visual, CSP, supported-browser,
and size checks. Resolve pilot regressions before starting another surface.

### 4. Migrate confirmation with its required primitives

**Depends on:** Phase 3; confirmation and overlay baseline gates pass.

#### 4a. Characterize primitives and build the confirmation subtree

- [ ] Cover drawer pointer capture, dismissal thresholds, interrupted
  transitions, focus trapping/restoration, reduced motion, and resizing.
- [ ] Cover transaction tree expansion, chain-specific formatting, explorer
  links, copy, long values, and error/loading content.
- [ ] Implement Preact primitives only as the confirmation subtree needs them:
  drawer, halo, passkey loader, padlock, and transaction tree.
- [ ] Reuse framework-neutral parsing/formatting and measurement algorithms.
  Keep geometry writes on the existing keyed CSP rule path.
- [ ] Develop against the established surface contract in the test harness;
  the production switch and deletion form one reviewable cutover.

#### 4b. Switch the complete confirmation surface

- [ ] Replace wrapper/modal/drawer/content rendering together with a
  discriminated `TxConfirmSurface`; preserve `ConfirmUIHandle`.
- [ ] Normalize complete internal models at `confirm-ui.ts`, preserving
  security context, display data, appearance, signing mode, and Email OTP.
- [ ] Preserve preparation reuse, two-phase close, onCancel subscriptions,
  takeDecision semantics, exactly-once settlement, and opened/closed messages.
- [ ] Keep a single feature import that returns a mount API.
  `prewarmTxConfirmerUi()` warms code without registration side effects.
- [ ] Verify every supported chain and mount context, including standalone
  modal/drawer and inline entrypoints. Test CSS isolation in host documents.
- [ ] Capture matched confirmer, drawer, transaction-tree, halo, passkey-loader,
  and padlock fixtures and review every image diff.
- [ ] Test rapid confirm/cancel, replacement while closing, delayed imports,
  and auth-to-confirm-to-auth handoff with no stale state or focus.
- [ ] Delete confirmation's Lit subtree and registrations. Keep shared Lit
  primitives still needed by export, recovery, or React adapters.

**Exit:** confirmation contracts, screenshots, CSP, measurement, supported
browsers, and per-flow size gates pass through the public integration boundary.

### 5. Migrate private-key export

**Depends on:** Phase 4's verified primitives.

- [ ] Replace host/viewer rendering with `ExportPrivateKeySurface` behind
  `upsertExportViewerHost()` and an explicit mount/update/dispose handle.
- [ ] Preserve modal/drawer behavior, masking, reveal timing, multi-key
  updates, copy feedback, guidance, and measured height.
- [ ] Verify close during loading/reveal, reopening with different keys,
  repeated exports, import failure, and parent disposal.
- [ ] On completion/error/dispose, unmount and release UI references, timers,
  listeners, observers, and owned appearance rules. Verify old keys cannot
  reappear on reopening; do not claim JavaScript memory erasure.
- [ ] Preserve activation requirements of clipboard/download actions.
- [ ] Capture matched export viewer/host fixtures and review every image diff.
- [ ] Remove export's Lit host/viewer, registration imports, and event bridge.
  Retain shared primitives with remaining live consumers.

**Exit:** export integration, synthetic-key visual tests, cleanup, CSP, browser,
and size checks pass.

### 6. Migrate recovery-code backup

**Depends on:** Phase 5; registration/recovery baseline gates pass.

- [ ] Implement the existing summary, opening, code display, acknowledgement,
  failure, and cancellation states with exact typed callbacks.
- [ ] Preserve `WalletRecoveryCodeBackupAcknowledgementV1`, download filenames,
  clipboard behavior, native dialog cancellation, focus, and live status.
- [ ] Test registration-time and account-menu entrypoints, cancellation before
  load, failed opening, repeated open/close, and explicit acknowledgement.
- [ ] Verify disposal releases displayed codes, pending callbacks, timers,
  and rules; reopening must not display a previous operation's codes.
- [ ] Capture matched recovery viewer/host fixtures and review every image diff.
- [ ] Replace host creation with an explicit lazy mount and delete the
  recovery host/viewer custom elements and internal event module.

**Exit:** recovery UI and enclosing registration/account flows pass behavior,
visual, CSP, cleanup, browser, and size checks.

### 7. Remove React's remaining Lit dependencies

**Depends on:** baseline coverage of public React usage; execute as a separate
change from hosted-surface cutovers.

- [ ] Inventory actual callers and package exports of `LitDrawer`,
  `LitHaloBorder`, and `LitPasskeyHaloLoading`. Confirm whether any are
  supported public APIs before deletion; resolve any API change explicitly.
- [ ] Use the existing React halo implementation where its contract matches.
  Supply native React replacements for used drawer/loading behavior; remove
  unused adapters without inventing replacement components.
- [ ] Preserve public props, children composition, SSR importability, mounting
  under StrictMode, controlled theme, custom colors, and focus behavior.
- [ ] Run the React theme regression and account-menu tests against built
  artifacts, including scoped tokens and the normalized auth-menu CSS names.
- [ ] Verify public React output introduces no Preact types or React aliasing.
- [ ] Delete `@lit/react` and obsolete adapters after their callers are migrated.

**Exit:** public React behavior passes independently of the hosted renderer,
and no React consumer keeps a built-in Lit primitive alive.

### 8. Consolidate CSS and delete orphaned infrastructure

**Depends on:** Phases 3–7; all built-in Lit consumers are gone.

#### 8a. Remove orphaned Lit glue

- [ ] Recheck imports and runtime consumers before removing the built-in
  registry, upgrade observer, `LitElementWithProps`, `ensureDefined`,
  `css-loader`, and component readiness gates.
- [ ] Preserve measurement/animation frames that implement visible behavior;
  delete only frames whose purpose was retired stylesheet/upgrade readiness.
- [ ] Move remaining pure files, then delete the empty Lit directories.
- [ ] Rename the generic extension implementation to `iframe-custom-element-*`
  and preserve its public registration/mount contract and supported messages.
  Verify an external custom element still mounts and disposes.
- [ ] Remove `lit` and obsolete embedded entries once all imports are gone.

#### 8b. Consolidate static CSS as a separate change

- [ ] Emit one ordered `wallet-ui.css` from the current authoritative sources.
  Preserve rule order, specificity, asset URLs, and document-context scoping.
- [ ] Replace the hosted document's component stylesheet links and prefetches;
  retain required public React/standalone stylesheet contracts.
- [ ] Compare computed styles and baseline screenshots before/after
  consolidation, including simultaneous surfaces with different appearance.
- [ ] Rerun cold-cache, delayed/failed stylesheet, first-measurement, resize,
  and CSP tests after the link change.
- [ ] Delete obsolete generated assets, markers, generators, and assertions
  only when their actual consumers have been replaced.

**Exit:** static CSS is document-owned, dynamic rules have explicit owners,
and no built-in surface needs registration repair or component CSS fetching.

### 9. Verify the complete package and consumer release

**Depends on:** Phase 8.

- [ ] Finish migrating surface tests to `tests/wallet-ui/` and update scripts.
  Preserve behavior assertions and retire architecture-only tests with their
  classification.
- [ ] Run the full affected Wallet UI/iframe suites and intended lifecycle
  contracts that exercise auth, confirmation, export, and recovery.
- [ ] Run the recorded browser matrix; distinguish actual passes from missing
  browser/infrastructure coverage.
- [ ] Exercise sequential and simultaneous surfaces, repeated open/close,
  cancellation, failures, and iframe disconnects under production CSP.
- [ ] Compare final screenshots and gzip/Brotli graph totals with Phase 0.
  Require complete manifest coverage and resolve unexplained visual differences
  or size growth before declaring completion.
- [ ] Verify package exports/declarations and all hosted entry variants.
  Check bundle dependency metadata for absence of Lit and duplication of
  Preact within each document graph.
- [ ] Update the relevant architecture docs, examples, asset assertions, and
  package descriptions.
- [ ] Test the release candidate artifact through real consumer entrypoints
  using the repository's existing package validation workflow.
- [ ] Publish through the normal release process, then update exact consumer
  versions and lockfiles together with required asset references. Verify the
  deployed SDK/stylesheet pairing before deployment of consumers.

**Exit:** published-package consumers and hosted surfaces pass the supported
contracts, final size goals hold, and remaining failures/coverage gaps are
explicitly reported. Publishing/deployment use their existing authorization
process; this document does not itself authorize those operations.

## Test migration and verification

Update tests with each surface rather than at the end. Existing behavioral
invariants remain authoritative; renderer-specific mechanics do not.

### Focused behavior

- Auth menu renders every discriminated state, emits the exact typed intent,
  preserves trusted user activation, and restores focus on close.
- Confirmation mounts once, accepts complete updates, reuses preparation
  surfaces, resolves one decision, and cleans up after confirm/cancel.
- Modal and drawer variants preserve backdrop, Escape, drag, transition, and
  reduced-motion behavior.
- Transaction trees preserve chain-specific content, expansion, copy, links,
  wrapping, and height-change choreography.
- Export preserves masking, reveal timing, copy feedback, key-array updates,
  close behavior, and viewport-independent measured height.
- Recovery backup preserves summary loading, opening failure, code display,
  download/copy, acknowledgement, cancellation, and focus semantics.

### Integration and CSP

- Hosted auth-menu, confirmation, export, and recovery-code iframe tests pass
  against the real wallet-service document.
- No CSP violation is emitted under the production policy.
- Preact components write no `style` attributes or component-owned `<style>`
  elements. Dynamic stylesheet operations remain centralized in the existing
  CSP manager; verify its supported CSSOM/nonce paths against actual policy.
- The first reported surface measurement is non-zero and styled, and later
  measurements follow the intended animation/resize choreography.
- Light/dark themes and configured appearance colors remain scoped to the
  intended mounted surface.
- Multiple sequential surfaces leave no stale document rules, listeners,
  observers, timers, or DOM roots.

### Build and size

Run the narrowest focused Playwright file during each phase. Run these shared
checks when their build/integration boundaries change and at final acceptance:

```sh
pnpm type-check
pnpm -C packages/wallet build:prod
pnpm -C tests test:wallet-browser:representative
pnpm -C packages/wallet check:bundle-size
node packages/wallet/scripts/checks/assert-runtime-entry-bundles.mjs
node packages/wallet/scripts/checks/assert-static-wallet-assets.mjs
```

The final production build must satisfy:

- total gzip and Brotli size of the wallet host plus all reachable UI chunks is
  no larger than the Phase 0 baseline;
- each direct browser entry is no larger than its replaced entry unless the
  change is explained and approved;
- Preact occurs once per independently loaded document graph;
- no standalone halo/passkey bundles remain;
- no Lit package or Lit registration helper remains in output;
- the public main/runtime entry still avoids eagerly pulling UI renderers into
  consumers that never open a hosted surface.

## Risks and controls

| Risk | Control |
| --- | --- |
| WebAuthn loses transient user activation | Invoke controller callbacks synchronously from Preact's native click/input handler and cover it with a browser test. |
| First measurement observes an unstyled or provisional surface | Verify document readiness with delayed/failed CSS; attach reporters to the committed root and assert the first measurement. |
| Light-DOM selectors leak across simultaneous surfaces | Root every component stylesheet under a surface class and test auth/confirm/export sequentially and simultaneously in one document. |
| Optional imperative patches create invalid Preact props | Normalize patches into a complete discriminated internal model before rendering. |
| Effects retain private keys or recovery codes | Keep sensitive data in the smallest surface model, cancel timers, render `null`, and release handles on every completion/error path. |
| Preact is accidentally exposed through the React package | Keep Preact source out of `src/react`, expose no Preact component publicly, and inspect preserved-module exports. |
| JSX compiles against React by mistake | Require `@jsxImportSource preact` in Preact TSX and assert emitted imports/bundles. |
| The migration recreates every Lit class one-for-one | Migrate by user-visible surface; move pure logic, then compose a smaller Preact tree around it. |
| Dynamic imports continue to hide registration failures | Every lazy module exports a mount function; callers handle import/mount failure explicitly; imports have no UI side effect. |

## Completion criteria

The refactor is complete when:

1. All wallet-owned hosted UI renders through native Preact.
2. No built-in surface calls `customElements.define()`, `ensureDefined()`,
   `ensureExternalStyles()`, or `customElements.whenDefined()`.
3. `LitElementWithProps`, its property-upgrade/definition-retention logic, the
   upgrade observer, and component first-paint gates are deleted.
4. Static styling comes from the wallet document's external stylesheet and
   dynamic CSP rules have explicit centralized owners.
5. The public React package contains no `@lit/react` adapter and remains a
   React API.
6. Current intended UI behavior, accessibility, strict-CSP operation, and
   iframe measurement pass in supported browsers.
7. Production-compressed wallet UI size meets the Phase 0 budget.
8. The codebase and documentation use the completed `seams-*` naming with no
   legacy aliases or duplicate paths.

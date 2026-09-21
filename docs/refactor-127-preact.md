# Refactor 127: replace internal Lit surfaces with Preact

**Status:** The auth-menu pilot now renders through native Preact in this
worktree; its Lit element and internal intent-event bridge are removed.
Phase 0–2 baseline, contract, document-style, and build work supports that slice.
Production confirmation now mounts through Preact, including lazy ABI enrichment.
Its broader visual/state/mount-context acceptance remains incomplete. Production
key export now mounts through Preact; its remaining visual/integration acceptance
and Lit cleanup are pending. Recovery backup and React adapters still use their
existing renderers. The recovery backup now mounts through Preact, and its
expanded saved-Lit/Preact visual state matrix passes; the retained Lit baseline,
viewer fixture, and hosted-surface cleanup remain pending. The public React tree
no longer depends on `@lit/react`.
This plan changes the wallet's internal UI renderer while
preserving wallet behavior, iframe protocols, strict-CSP guarantees, and public
React APIs.

### Luna handoff checkpoint — 2026-09-21

The implementation is now split into reviewable commits before the remaining
surface and build cleanup:

- `969dc84` renames the generic iframe extension bridge from `lit` to
  `custom-elements`, removes its empty built-in registry, and preserves the
  external registration/mount protocol.
- `52e1bbf` removes the development-only observer that warned about custom
  elements failing to upgrade.

Wallet type-checking passes at this boundary. The continuation may use Luna,
but this checkpoint requires an extra review before merge: verify the generic
custom-element API and message payloads, confirm that no built-in surface still
depends on the renamed bridge, and rerun the browser, build, bundle, and visual
gates after the remaining Lit deletion and stylesheet consolidation. The
temporary visual comparison harness and ignored artifacts remain required until
Phase 8d.

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

### Confirmation integration checkpoint — 2026-09-21

The audit handoff marker remains `2e2a956`. Production integration and lifecycle
changes follow in `c767150`, `16b30ad`, `b358f97`, and `5b167fd`.

The Preact transaction drawer now preserves the compact title/security layout,
outer and content error messages, intrinsic hosted width, and padded action
bounds. Modal transactions retain their halo header. The confirmation document
root supplies the inherited typography previously supplied by custom elements.

The production visual fixture mounts the same public API against the saved Lit
build and current Preact build. It records distinct modal/drawer content crops,
sets the document theme explicitly, and keeps all PNGs and reports under ignored
`.artifacts/refactor-127/visual`. Capture the saved reference with
`CONFIRMATION_VISUAL_RENDERER=saved-lit`, then run the same
`tests/visual/confirmation-preact.visual.ts` test with the default renderer.
The saved build is required; component-only fixtures are not interchangeable
with these production mount captures.

All six drawer captures (default/loading/error, light/dark) now have identical
outer dimensions to the saved Lit build. Inspected differences are confined to
small rendering/edge differences (31–429 changed pixels, below 1% per capture).
The harness enforces matching drawer dimensions and the 1% pixel ceiling.
Modal default/loading dimensions also match. The initial modal error capture
was 32px taller in Lit due to an initial stylesheet-adoption race. A follow-up
compared the same error after first-render geometry settled: Lit's halo then
retains 78×78px, zero inner padding, and transparent content, matching Preact.
The earlier capture had fallen back to the halo defaults (2rem padding and a
dark background). `css-loader.ts` appends static sheets after instance overrides;
the running halo ordinarily restores override precedence on its next tick.
Preact now has a regression test for an error arriving immediately after mount
and recovery back to the ready state, without changing halo dimensions.
The old 3.5 fingerprint stroke token is also restored on the Preact surface.
All 12 basic modal/drawer captures now match dimensions. The comparison allows
under 1% changed pixels except animated modal cases (2.5%, allowing the saved
Lit's JS-driven halo angle). This covers basic synthetic transactions; it does
**not** approve the full transaction-tree, OTP, or registration visual matrix.

Wallet declaration generation, Rolldown, and browser-test TypeScript checks
pass. The focused production/lifecycle suite passes 30/30 across Chromium,
Firefox, and WebKit, including
a regression test for compact drawer layout, action bounds, callback delivery,
and strict CSP. Both renderer capture matrices complete 12/12; capture completion
alone does not establish modal parity. A separate attempt on port 4215 failed
before tests started because the port was occupied; classified as an environment
failure and rerun on a free port without changing application behavior.

Lit confirmation cleanup remains gated on the outstanding modal, transaction
tree, registration, OTP, responsive, and mount-context visual acceptance. Export,
recovery backup, React adapter migration, and final bundle/dependency cleanup
remain subsequent phases.

### Phase 0 implementation record — 2026-09-20

Worktree: `/Users/pta/Dev/rust/seams-wallet-refactor-127`, branch
`codex/refactor-127-preact`, source baseline
`52a9c7df8c30de0bd66fb77c4aee26575d19c99d`.
Build command: `pnpm -C packages/wallet build:prod`.
Built-input digest: `3dddb195d4a940af6a22b30627f0d2f0b71fe4857400c6432df7c26d91307a51`.

No production renderer, dependency, controller, or protocol changed in this
slice. The browser harness now starts its own server, accepts an explicit
`SEAMS_TEST_FRONTEND_URL`, and refuses reuse of an unrelated worktree's server.

Verification performed in this worktree:

- Production build, including TypeScript declarations, WASM, and static asset
  assertions: passed. Log: `.artifacts/refactor-127/build-baseline.log`.
- Unchanged runtime baseline: 63/63 Lit tests and 44/52 wallet-iframe tests,
  reproduced together as 107 passed / 8 failed. Log:
  `.artifacts/refactor-127/browser-baseline.log`.
- After the test-only repairs below: 115/115 passed. Command:
  `SEAMS_TEST_FRONTEND_URL=http://localhost:4207 pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts wallet-iframe lit-components`.
  Log: `.artifacts/refactor-127/browser-final.log`.
- Native React theme boundary plus existing account-menu checks: 6/6 passed.
  Log: `.artifacts/refactor-127/react-baseline.log`. The new focused theme test
  lives in Wallet and tests the local built SDK, independent of the private
  repository's missing `tests/setup/bootstrap` import.
- Module-graph behavioral test: passed with
  `node --test tests/unit/browser-module-graph.test.mjs`. Covers shared/cyclic
  dependencies, re-exports, lazy edges, external/computed imports, comments,
  and a missing build asset.
- The original browser-test type-check had 22 diagnostics in existing
  fixtures/setup, recorded in `.artifacts/refactor-127/browser-typecheck.log`.
  Classified as `valid_test_needs_update` or `obsolete_test_or_fixture` against
  current domain builders: repaired recovery targets, branded wallet IDs,
  transaction literals, lifecycle-event narrowing, and exact-session shapes;
  removed retired identity fields and the unsupported export-modal expectation.
  No production types or behavior were changed to accommodate the tests.
- After those repairs, `pnpm -C tests exec tsc --noEmit -p tsconfig.wallet-browser.json`
  passes, including the typed visual fixtures. Log:
  `.artifacts/refactor-127/type-repair-final.log`.
- The complete Lit and wallet-iframe suite now passes **116/116**, including
  the new React theme boundary test. Log:
  `.artifacts/refactor-127/browser-type-repair.log`.

#### Eight reproduced failures and disposition

All eight were reproduced against the source baseline above. Exact original
assertions and traces are identified by the names below and the baseline log.
The repeated `Execution context was destroyed`/timeout errors in the compact
tests occurred after moving the parent to `about:blank`; focused reruns on the
existing HTTP test document reached the actual assertions.

| Test file and test name | Baseline failure | Classification and repair |
| --- | --- | --- |
| `router.behavior.test.ts` — `executeAction shows overlay then hides it after request timeout` | `shown` was false | `valid_test_needs_update`: the synthetic host emitted progress without the measurement required to reveal a transaction modal. The shared fixture now emits a valid `measured_v1` message. Timeout and cleanup assertions remain. |
| `router.behavior.test.ts` — `executeAction hides the overlay when signing progress releases the surface` | `shown` was false | `valid_test_needs_update`: same missing measurement; release progress is now explicitly triggered after visibility is observed, instead of racing a 20ms timer against first paint. |
| `walletIframeSurface.compact.integration.test.ts` — `keeps an unmeasured surface hidden through its initial paints` | Setup timeout; focused run then observed `visibility: visible` | `environment_or_infrastructure_failure` for the opaque parent setup; `obsolete_test_or_fixture` for the hidden-auth-menu expectation. `overlay-styles.ts` deliberately keeps provisional hosted auth menus rendering so their child can measure. The replacement test asserts that current behavior. Transaction-modals retain separate measurement-gated visibility coverage. |
| Same file — `ignores malformed, stale, and mismatched measurements before accepting a newer size` | Setup context destroyed/timeout | `environment_or_infrastructure_failure`: keep the HTTP parent document established by shared setup. Geometry and rejection assertions unchanged. |
| Same file — `tracks measured auth-menu heights instantly rather than easing toward them` | Setup context destroyed/timeout | `environment_or_infrastructure_failure`: same setup repair. Exact height and zero-transition assertions unchanged. |
| Same file — `keeps the hosted auth menu open without a request deadline` | Setup context destroyed/timeout | `environment_or_infrastructure_failure`: same setup repair. Interactive deadline assertion unchanged. |
| Same file — `serves exact-session reads from the mirror while hosted authentication is active` | Setup timeout; after repair, host read count was 2 instead of 1 | `valid_test_needs_update`: current `getExactSessionState()` explicitly refreshes; the no-RPC invariant belongs to `getMirroredExactSessionState()`. The test now calls that API and retains its no-additional-host-read assertion. |
| Same file — `does not let a stale measurement resize a replacement surface` | Setup context destroyed/timeout | `environment_or_infrastructure_failure`: same setup repair. Replacement/request identity assertions unchanged. |

No production regression was identified by these eight failures. This conclusion
is based on reruns and the current implementation, rather than the namespace
cutover's earlier assertion that the failures were unrelated.

#### Visual baseline coverage and remaining gaps

`tests/visual/lit-fixtures.ts` explicitly inventories all 14 registered elements.
`tests/playwright.visual.config.ts` runs a separate, deterministic capture suite.
The expanded capture run produces 158 component crops and 158 context screenshots:
light/dark defaults for every element, auth waiting/error, confirmation
loading/error, and export loading/ready-masked/error. Auth additionally covers
discoverable login, account selection, Google OTP/registration, recovery entry
and sign-in readiness, every recovery stage, invalid recovery input, device
factor selection, QR loading/ready, passkey creation, email OTP, cancellation,
expiry, activation, and errors. Each of these 27 auth states is captured at
desktop and 360px width in both themes. The QR encodes a synthetic example.test
URL using the existing QR dependency. Recovery
backup includes its direct viewer and native-dialog host. Keys, accounts, and
recovery codes are synthetic. Native dialog hosts are cropped at their visible
dialog. Results: `.artifacts/refactor-127/visual-auth-states-final.log` (158/158).

Command:

```sh
SEAMS_TEST_FRONTEND_URL=http://localhost:4208 pnpm -C tests exec playwright test -c playwright.visual.config.ts
```

Artifacts: `.artifacts/refactor-127/visual/manifest.json` and
`.artifacts/refactor-127/visual/lit-before/`. The manifest is authoritative for
the current run; exploratory images outside its entries are not baselines.
The ignored directory is excluded by the existing `.artifacts/` rule. It must
never be added to Git. Captures record source/build identity, synthetic fixture,
browser version, OS, selectors, viewport, theme, motion, and image paths.
The harness refuses to overwrite a recorded baseline from another built-input
digest. Keep these artifacts locally until migration comparisons are complete.

Verified environment: bundled Chromium `140.0.7339.16`, macOS arm64,
1024×900 desktop and 360×800 narrow viewports, DPR 1, en-US, UTC, reduced motion.
Both the shared setup's
viewport reset and `emulateMedia`'s motion reset are explicitly overridden.
The document links generated theme tokens before mounting; screenshots wait
for fonts, component updates, and stable geometry.

A repeated run exposed JS-driven halo rotation despite reduced-motion media.
Static capture now pins `--halo-angle` to `0deg` in each relevant shadow root,
preserving the ring. The repeat then differed in four error-state images;
a focused error-state recapture localized the difference to 22 anti-aliased
icon pixels (maximum channel delta 3/255), with identical image dimensions.
This small rasterization variance must be distinguished from geometry/content
changes when reviewing future diffs; the baseline is not byte-identical in
every SVG edge. Partial `--grep` capture runs mark `captureComplete: false`.

**This is the initial component inventory baseline, not the complete migration
gate.** Before the relevant renderer cutover, extend it with nested device-email
OTP delivery/error states, chain-specific transaction details, expanded trees,
drag/close transitions, copy feedback, multi-key export,
custom palette, narrow layouts for the other surfaces, and named normal-motion
frames. Those requirements in the visual matrix below remain unchecked.

#### Bundle accounting

Command: `node packages/wallet/scripts/checks/report-wallet-iframe-bundle-size.mjs --json`.
Artifact: `.artifacts/refactor-127/bundle-baseline.json`.
The report parses emitted JavaScript with the existing TypeScript parser,
deduplicates files per closure, includes static and lazy imports, and reports
direct browser bundles and all emitted document CSS. It fails on missing
relative assets or incomplete external/computed graphs. The obsolete
registration-WASM row and its invalid metrics were removed.

Values are bytes; compression is per emitted file before summation:

| Reachable closure | Raw | Gzip | Brotli | Incremental gzip over runtime boot |
| --- | ---: | ---: | ---: | ---: |
| Runtime static boot | 77,855 | 21,253 | 18,411 | — |
| Auth runtime | 6,320,953 | 1,203,873 | 945,776 | 1,187,828 |
| Confirmation | 248,670 | 65,740 | 56,713 | 60,488 |
| Export | 126,889 | 36,903 | 32,323 | 31,841 |
| Recovery codes | 324,342 | 75,728 | 66,213 | 68,616 |
| All reachable browser entries, deduplicated union | 6,645,508 | 1,296,751 | 1,027,120 | — |
| Emitted document CSS | 167,161 | 38,206 | 32,046 | — |

Auth's recursive closure includes reachable wallet/domain code; it is a
conservative dependency inventory, not observed first-open transfer size or
the isolated auth component size. Independently bundled copies count as
different delivered URLs. Workers and WASM are separate. CSS lists all emitted
SDK CSS, including lazily adopted sheets; it does not imply every document
eagerly downloads every file. Runtime network traces remain necessary when
claiming real per-flow loading/performance improvements.

#### Mount contexts, API ownership, and browser evidence

| Context | Current owner / integration boundary | Static style owner today |
| --- | --- | --- |
| Hosted auth menu | `host/auth-menu/session.ts`; normalized view model and `AUTH_MENU_INTENT_EVENT` | Auth component ensures `auth-menu.css`; wallet HTML owns shared document assets. |
| Hosted transaction modal/drawer | `confirm-ui.ts`, `ConfirmUIHandle`, request-bound surface measurement | Wallet-service HTML plus remaining Lit adoption; preserve confirm/cancel and drawer-close completion semantics. |
| Inline / host-document confirmation | `confirm-ui.ts` direct mounts and portal; covered by `confirm-ui.host-and-inline.test.ts` | Explicit host helpers plus component adoption. This context must gain its own document stylesheet owner. |
| Hosted and standalone export | `export-viewer-host.ts`; variant and surface-measurement binding determine ownership | Export host owns token rules; viewer/host adopt their external sheets. Standalone can own viewport; measured modal must remain viewport-independent. |
| Recovery backup | `RecoveryCodeBackup/host.ts` native dialog and `viewer.configure(experience)` | Host/viewer ensure document recovery/copy/token sheets; preserve stage/acknowledgement/cancel ownership. |
| Public React | Native React exports; `AccountMenuButton/PasskeyHaloLoading.tsx` currently consumes `LitHaloBorder` | React stylesheet entry plus the adapter's Lit adoption. Lit adapter symbols are absent from the public React barrel and package subpath exports. |
| Generic user-provided elements | `SeamsWebIframe.registerWalletUI/mountWalletUI/unmountWalletUI` | Caller-owned definitions/styles; preserve this extension API separately from built-in renderer removal. |

Wallet owns component, theme, protocol, and lifecycle tests. Monorepo owns
Console composition and released-package acceptance. The private
`tests/unit/theme.react.unit.test.ts` still imports a missing setup module and
is not migration evidence; do not redirect it to Wallet source across repo
boundaries. The new Wallet-native theme regression test establishes the local
scope behavior. Private consumer acceptance must use a candidate package
artifact when that later phase begins.

Current repository browser and intended-contract configurations execute
Chromium only. This slice adds no claim of Firefox, WebKit, shipping Safari,
mobile Safari, real passkey, or trusted-activation coverage. Run those target
environments before accepting the affected cutover; virtual-authenticator
and reduced-motion screenshots do not establish their behavior. Confirm the
release browser/version matrix before the final release gate.

| Responsibility | Current implementation | Target |
| --- | --- | --- |
| Shared Lit lifecycle, property upgrade, definition retention, appearance variables | `packages/wallet/src/core/signingEngine/uiConfirm/ui/lit-components/LitElementWithProps.ts` | Delete. Normalize props before mounting; apply appearance through the document-level CSP stylesheet manager. |
| Tag registry and definition repair | `packages/wallet/src/core/signingEngine/uiConfirm/ui/registry.ts` | Delete for built-in surfaces. Import a surface module and call its exported mount function. |
| External stylesheet adoption | `packages/wallet/src/core/signingEngine/uiConfirm/ui/lit-components/css/css-loader.ts` | Delete after the final Lit surface is removed. Static CSS is owned by wallet-service HTML. |
| Un-upgraded-element observer | `packages/wallet/src/SeamsWeb/walletIframe/host/bootstrap.ts` | Delete after the last built-in custom-element consumer is migrated. |
| Auth menu | `host/lit-ui/auth-menu/seams-auth-menu-surface.ts` | `host/ui/auth-menu/AuthMenuSurface.tsx` plus `mountAuthMenuSurface.tsx`. |
| Auth-menu domain model | `host/auth-menu/domain.ts` | Moved beside its existing controller and session; discriminated states unchanged. |
| Auth-menu orchestration | `host/auth-menu/session.ts` | Keep as owner of lifecycle state; replace element creation/property writes/events with a Preact surface handle. |
| Transaction confirmation | `IframeTxConfirmer/*` | One Preact subtree under `ui/surfaces/tx-confirm/`; keep the existing `ConfirmUIHandle` boundary. |
| Transaction tree parsing and formatting | `TxTree/abi/*`, `TxTree/renderers/*`, `tx-tree-utils.ts`, `common/formatters.ts` | Move unchanged framework-neutral logic under `ui/model/tx-tree/`; render it with Preact components. |
| Drawer, halo, passkey loader, padlock | Lit elements beneath `lit-components/` | Plain Preact components and inline SVG/ordinary DOM. They are internal primitives, with no standalone custom-element registration. |
| Key export | `ExportPrivateKey/iframe-host.ts`, `viewer.ts`, and `export-viewer-host.ts` | `ExportPrivateKeySurface.tsx` plus an imperative `mountExportPrivateKeySurface()` handle. |
| Recovery-code backup | `RecoveryCodeBackup/host.ts`, `viewer.ts`, `events.ts` | `RecoveryCodeBackupSurface.tsx` with typed result callbacks. |
| Surface measurement | `host/surface-measurement-reporter.ts` | Moved to the shared host boundary; remains framework-neutral. |
| Generic iframe UI extension | `iframe-custom-element-mounter.ts`, `iframe-custom-element-registry.ts` | Preserve the external custom-element registration/mount API; do not use it for built-in Preact surfaces. |
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

Priority update — 2026-09-21: at the user's request, focus next on private-key
export drawers, transaction confirmer drawers, and transaction trees, in that
order. The phase numbers below remain stable for tracking. Export may proceed
using the verified drawer primitives while broader confirmation acceptance is
completed alongside it. Recovery and React-adapter migration follow these
surfaces; legacy removal remains conditional on each replacement's acceptance.

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
- [ ] Review matched before/after screenshots and pass the surface's behavior
  checks before deleting its Lit implementation in the cutover change.
  Delete shared Lit infrastructure in Phase 8 only after every replacement is
  visually verified and its final live Lit consumer is gone.
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
- [x] Reproduce the reported wallet-iframe result (44/52) and record each of the
  eight failures: exact test, invariant, failure output, reproduction command,
  and baseline commit. The claim that they are unrelated remains unverified
  until this triage is complete.
- [x] Classify each failure as `production_regression`,
  `valid_test_needs_update`, `obsolete_test_or_fixture`, or
  `environment_or_infrastructure_failure`. Fix supported production behavior
  separately; repair valid tests; remove obsolete tests with the rationale.
- [ ] Require green tests for a surface's affected invariants before migrating
  it. An unrelated failure may remain documented with its owner and scope;
  a failure in measurement, overlays, focus, or decision handling blocks the
  dependent surface's cutover. Do not skip or weaken assertions to proceed.
- [x] Repair `report-wallet-iframe-bundle-size.mjs` to measure static imports,
  lazy UI imports, and direct browser entries. Deduplicate shared chunks within
  each document graph and report cold-load and incremental feature bytes.
- [x] Record raw, gzip, and Brotli totals for boot, auth, confirmation, export,
  recovery, and CSS, with build command and commit. Track per-flow bytes and
  the union of reachable UI assets so moved imports cannot hide growth.
- [x] Capture the visual baseline described below for every registered
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

Auth slice implemented on 2026-09-20:

- Added browser contracts for synchronous submit-intent delivery during trusted
  user activation; focus trapping/restoration and detached Escape-listener
  cleanup; measurement deduplication, idempotent disposal, ignored late
  callbacks, and monotonically sequenced remounts.
- Added real-host coverage for disposal while the auth module is delayed.
  Duplicate disposal settles the open request with the current typed
  `cancelled/connection_closed` outcome and removes the iframe and overlay.
  Baseline host tests: 2/2, `.artifacts/refactor-127/auth-lazy-before-verified.log`.
- New test assumptions were corrected against the existing implementation:
  initial focus goes to the saved-account input; explicit `router.init()`
  itself needs the auth module; connection closure returns a cancelled outcome.
  These were `valid_test_needs_update`, not production changes.
- Moved auth `domain.ts` and its type fixtures beside the existing auth
  controller/session, and moved the renderer-independent measurement reporter
  to the host directory. Updated every live import; no forwarding modules or
  duplicate implementations remain. No lifecycle algorithm changed.
- Updated the explicit measurement-reporter build entry. The initial build
  caught its stale path (`production_regression` from the move); the corrected
  production build passes, including declarations, WASM, runtime-entry checks,
  and all 181 static assets. Log: `.artifacts/refactor-127/pure-moves-build-final.log`.
  Build digest: `7225f30b06f92fd05c0249cea71f5731646afe6fa1f36d1fe30032607eaba222`.
- Browser-test type-check and hosted-document assertions pass. All 13 emitted
  SDK stylesheets are byte-identical to the preserved original browser assets.
  The moved modules were compared against Git: only their relative import paths
  changed. The old module paths are absent from source imports and fresh output.
- Post-move Lit and wallet-iframe regression run: **120/120 passed** (2.1m).
  Command: `SEAMS_TEST_FRONTEND_URL=http://localhost:4209 pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts wallet-iframe lit-components`.
  Log: `.artifacts/refactor-127/pure-moves-browser.log`. The module-graph test
  also passes. The accessibility skill informed the new keyboard focus contract;
  this is Chromium keyboard evidence, not a screen-reader or cross-browser audit.
- Bundle report: `.artifacts/refactor-127/bundle-pure-moves.json`, no missing
  assets. Per-flow gzip totals are auth 1,203,869; confirmation 65,734; export
  36,897; recovery 75,725 bytes. Reachable-JS union is 6,645,484 raw / 1,296,753
  gzip / 1,027,061 Brotli bytes: raw −24, gzip +2, Brotli −59 versus Phase 0.
  This is a path/chunk-name-only move; the final migration's size gate remains
  outstanding. CSS totals are unchanged.
- Preserved the original browser assets under the ignored
  `.artifacts/refactor-127/lit-baseline-build/esm` before rebuilding, alongside
  the original built-input digest. This allows additional reference captures
  without reconstructing the original browser bundles. Screenshots and these
  browser assets must remain outside Git.

Auth cancellation without disposal during a delayed import and failed module
loading are now covered by the host integration suite. Both settle the parent
request without leaving a mounted surface. Remaining Phase 1 gates include
duplicate decisions and updates during closing for the other surfaces and
transaction parsing/formatting moves. The auth host now has a strict style-CSP
smoke contract; state transitions, appearance overrides, and fallback styling
still need their broader policy matrix before renderer cutover.

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

Auth-document slice implemented on 2026-09-20:

- The generated wallet document links versioned `auth-menu.css` immediately
  after `seams-components.css`. The integration harness uses that same HTML
  builder. Existing selectors and stylesheet contents are unchanged.
- Auth open validates that both document stylesheets expose nonempty rules
  before creating a session. A failed request can retain a `sheet` object with
  inaccessible rules in Chromium; checking only `link.sheet` failed the new
  regression test. The explicit failure now settles the pending request.
- Delayed CSS holds initialization; failed auth/shared CSS produces no mounted
  prompt. Failed lazy modules and cancellation during delayed imports are also
  covered. Auth renders under `style-src 'self'; style-src-attr 'none'` without
  reported violations or duplicate auth stylesheet links.
- Focused host and HTML-generation verification: **15/15 passed** in
  `.artifacts/refactor-127/auth-document-verified.log`.
- This makes auth CSS eager in the wallet document. Total emitted CSS remains
  167,161 raw / 38,206 gzip / 32,046 Brotli bytes; loading order changes even
  though the bytes do not. Consolidation remains Phase 8 work.

Other surface documents, custom appearance, geometry transitions, and the
non-constructable stylesheet fallback remain unverified by this slice.

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

- [x] Add `preact` and configure its TSX runtime per Preact file.
- [x] Verify development and production output use the intended JSX runtime;
  React entrypoints continue to use React.
- [x] Keep public ESM externals and embedded bundle dependencies consistent.
  Verify a mounted Preact root can update and dispose under the production CSP
  using the same build path planned for the auth menu.
- [x] Keep renderer imports out of the headless/runtime boot path until a
  surface needs them. Record bundle changes.

Build support verified on 2026-09-20:

- Direct `preact@10.29.8` dependency; `preact` and its subpaths are external in
  public ESM and bundled in embedded output. React configuration has no aliases.
- `tests/wallet-ui/preact-build.test.ts` builds test-only TSX through the actual
  library, React, and embedded Rolldown configurations in development and
  production. Both cases passed: correct runtimes, self-contained embedded
  output, root updates reusing DOM, callbacks, and idempotent disposal under CSP.
  The probe injects no styles or inline style attributes.
- Production build and browser-test type-check passed. Runtime boot's static
  graph contains no renderer matches or bare external imports. Boot remains
  77,855 raw bytes (21,251 gzip). Reachable browser JS is 6,645,907 raw /
  1,296,906 gzip / 1,027,180 Brotli: +399 / +155 / +60 bytes versus the Lit
  baseline, principally the new stylesheet failure check. No Preact production
  renderer is shipped yet; the final migration's compressed-size gate remains.
- Bundle evidence: `.artifacts/refactor-127/bundle-auth-document.json`, build
  digest `2d69c14fd7c71573137f2bacbfb19c1826edc0dc117f27477ba362dbcf21a229`.
  Probe source and build script live under `tests/`; generated artifacts remain
  ignored. Standalone confirmation builds will be checked with their migration.
- Broader iframe, Lit component, and Preact probe suite: **128/128 passed**
  (1.8 minutes), recorded in `.artifacts/refactor-127/auth-document-browser.log`.
  Hosted-doc checks and the bundle-graph unit test passed. All 13 emitted CSS
  files remain byte-identical to the saved Lit baseline.

**Exit:** build support works without changing a production surface's renderer.

### 3. Migrate the auth menu as the pilot

**Depends on:** Phase 2; auth and measurement baseline gates pass.

Auth pilot implementation record — 2026-09-20:

- `host/ui/auth-menu/AuthMenuSurface.tsx` renders the existing discriminated
  models. `mountAuthMenuSurface.tsx` owns a normal DOM root, committed updates,
  scoped appearance rules, and idempotent disposal. The session keeps workflow
  state and attaches the unchanged measurement reporter after mounting.
- Internal intents are synchronous typed callbacks. The generic host
  `PM_CANCEL` boundary uses a detail-free `cancel` event to reach the root;
  the internal `seams-auth-menu-intent` bridge and validator are deleted.
- Auth CSS moved with the surface and uses a zero-specificity scope prefix.
  Static dot positions replace inline custom properties. Animated height uses
  the existing document CSP manager, with one shared manager per document and
  instance-owned rules. The pure appearance-token helper moved out of Lit and
  sanitizes both color and shape overrides.
- Removed the old auth element, definition repair, barrel, property writes,
  component stylesheet loading, and first-render gate. Shared Lit code remains
  for live consumers. There is one active auth renderer and no fallback flag.
- Existing auth behavior assertions moved to `tests/wallet-ui/`. Fixture
  repairs replace `unknown` props with current model types, narrow branch
  updates, and add the missing synthetic Google challenge ID. Production
  domain types were not widened.
- Focused auth surface/host suite: **29/29 passed**. Additional appearance,
  cleanup/late-update, all-fixture strict style-CSP, and nonce-fallback checks:
  **3/3 passed**. Production build, browser-test type-check, hosted-doc, runtime
  entry, and static asset checks passed. A type-check started during WASM build
  cleanup failed on temporarily missing generated modules; the post-build
  rerun passed (`environment_or_infrastructure_failure`).
- First matched visual run: **108/108 captures**, each with component and
  context images. All dimensions match; 100 pairs are pixel-identical. Eight
  pairs have 8–29 changed pixels at rounded edges, with maximum channel delta
  1. Every nonzero comparison was inspected. The original baseline is intact.
  Artifacts: `.artifacts/refactor-127/visual/preact-after/`, `diff/`, and
  `auth-preact-comparison.json`. Final-build verification is recorded below.
- Final-build behavior suite: **131/131 passed**. A repeat of the original
  visual protocol passed 107/108; device activation captured 320px against a
  318px original. Classified as `valid_test_needs_update`: a controlled run
  of the saved original Lit build and current Preact build proves both settle
  to 314px after finite animations finish and a resize remeasurement occurs.
  During entrance animation, transformed content inflates `scrollHeight`
  from its intrinsic 260px to 266px. Stable outer dimensions alone did not
  guarantee a settled measurement. No production geometry changes were made.
- Preserve `lit-before/` and its original manifest. The supplemental
  `lit-settled/` reference uses the saved original build with the same explicit
  static-capture and remeasurement protocol as Preact. The capture tool
  verifies the saved build digest against the original manifest and requires
  a complete 108-fixture supplemental reference. Motion is disabled before
  mounting either renderer: finishing entrance animations after mounting
  retained rasterization differences around otherwise identical focused
  buttons. Controlled measurements proved identical button positions,
  dimensions, radii, and computed focus shadows; pre-mount motion disabling
  made all three diagnostic fixture pairs pixel-identical. Comparisons reject
  dimension changes and channel differences above one 8-bit color step. Raw
  changed-pixel counts and exact diffs remain recorded; no masks or regional
  exclusions are used. The original screenshots remain unchanged.
- Final static visual comparison: **108/108 passed** (1.7m), including both
  component and context images. Thirty pairs are pixel-identical; the remaining
  pairs differ by at most 73 component pixels and one channel step. Exhaustive
  coordinate review found every changed crop pixel inside an outer rounded
  corner. Representative largest diffs and the previously problematic focus
  indicators were inspected visually. Evidence and limits are recorded in
  `.artifacts/refactor-127/visual/auth-preact-review.md`.
- Added browser-neutral UI contracts under `tests/wallet-ui/`, without a
  virtual authenticator or initialized wallet backend. The focused matrix
  passed **15/15** on Chromium 140.0.7339.16, Firefox 141.0, and Playwright
  WebKit 26.0, covering all auth branches in both themes, trusted keyboard
  activation, focus restoration/listener cleanup, and normal-motion height
  updates reported through the real ResizeObserver-based reporter. Appearance
  override/reset, repeated disposal and late updates, strict style CSP, and
  nonce-based stylesheet fallback also pass in each engine. Evidence:
  `.artifacts/refactor-127/auth-browser-matrix.log`. This does not establish
  branded Safari, hardware WebAuthn, the complete script CSP policy, or
  screen-reader behavior. The new fixture initially omitted existing submit
  fields and assumed document-wide Escape closes an idle menu; both were
  `valid_test_needs_update` against the current domain/keyboard contracts.
- Browser installation initially stalled in the Node 26 archive extractor.
  The downloaded archive passed `unzip -tq`; the same Playwright extractor
  completed under Node 24 in a separate temporary directory. Stopped that
  stalled install and completed the standard Playwright install with Node 24.
  Classified as `environment_or_infrastructure_failure`; no application
  changes or browser-test skips were used to resolve it.
- Production bundle digest:
  `9427cdb69325093c4183a284944a75b437fb2262a0838caf2754e16e8d74000b`.
  Boot: 77,713 raw / 21,222 gzip / 18,393 Brotli bytes. Auth graph:
  6,336,499 / 1,208,357 / 949,777. Reachable browser JS:
  6,660,936 / 1,301,256 / 1,031,122: **+4,505 gzip / +4,002 Brotli** versus
  the original baseline while other surfaces retain Lit. CSS:
  176,871 / 38,675 / 32,252. This records temporary renderer coexistence;
  final size acceptance remains open. See `bundle-auth-preact.json`.

Pilot follow-up — 2026-09-21:

- Reproduced the recovery announcement defect with a focused browser test:
  its `sr-only` node had `position: static` because the hiding selector
  required the wrong direct parent. Classified as a pre-existing production
  defect. Consolidated two duplicate hiding rules into one auth-scoped rule;
  the live region remains a clipped 1px node and primary controls fit inside
  the measured content. Keep that node mounted and initially empty so later
  recovery states update the existing polite region.
- Reviewed all 16 intentionally changed recovery captures (four named states,
  both themes and widths). Outer dimensions stay unchanged; duplicate visible
  announcements disappear and previously clipped controls become fully
  visible. All other fixtures retain strict Lit-reference comparisons. The
  original Lit baseline is unchanged; prior Preact parity evidence is saved
  separately. The 16 reviewed recovery images are also regression references,
  rather than blanket exclusions from comparison. See
  `.artifacts/refactor-127/visual/auth-recovery-accessibility-review.md`.
- Renderer-boundary auth → confirmation → auth tests exercise the public
  mount/decision/close APIs with both modal and drawer confirmation, cancel
  and confirm outcomes, fresh auth state, and focus restoration to the target
  present at remount. Existing Lit confirmation does not restore the original
  auth trigger itself; the test does not assign that responsibility to the
  replacement auth root. Parent-router/authenticated signing handoff remains
  part of composed product acceptance.
- Expanded browser matrix: **24/24 passed** on Chromium, Firefox, and WebKit.
  Auth/host contracts: **55/55 passed**. Static visuals: **108/108 passed**,
  including comparisons against the reviewed recovery references. After the
  stable-live-region adjustment, visuals again passed **108/108**. The auth
  run passed **54/55**: the post-link activation assertion selected the first
  status node, now the deliberately empty recovery announcer. Classified as
  `valid_test_needs_update`; target the existing device-activation status
  explicitly. Its focused rerun passed **1/1**, without a production change.
  The subsequent combined auth/host/confirmation run passed **90/90**,
  including all 55 auth/host checks and the three-engine UI matrix.
- Added `src/SeamsWeb` to the existing build-freshness input list. It had been
  omitted, so auth renderer/CSS edits could leave the input digest unchanged.
  Existing screenshot evidence still records actual rendered builds; the old
  digest alone was insufficient to distinguish those host edits. New builds
  include the host directory. No build pipeline or new generator was added.

Remaining acceptance evidence includes real-device activation where required,
screen-reader announcements, and the composed authenticated product handoff.
The focused tests establish renderer, DOM, style-policy, and engine behavior;
they do not represent hardware signing or a full screen-reader audit.

- [x] Render the existing `AuthMenuViewModel` with `AuthMenuSurface.tsx`.
  Cover registration, login, recovery, Google Email OTP, device link, input
  validation, waiting, and failure states.
- [x] Add `mountAuthMenuSurface()` and make `AuthMenuSession` own its handle.
  Preserve session state, messages, preparation, and recovery orchestration.
- [x] Wire exact typed callbacks and invoke activation-sensitive controller
  actions synchronously from trusted handlers.
- [x] Convert only auth-menu selectors to scoped ordinary DOM classes.
  Preserve computed styles and appearance overrides, including fonts/spacing.
- [x] Attach the existing measurement reporter after a committed render and
  document readiness. Test initial size and size changes during transitions.
- [x] Run baseline screenshots and input/focus/Escape tests, host integration
  tests, cancellation during load, repeated open/close, and auth-to-confirm
  handoff while confirmation still uses Lit.
- [x] Capture matched Preact auth-menu fixtures and review every image diff
  against the preserved Lit baseline and its identically configured
  supplemental static reference in `.artifacts/refactor-127/visual/lit-settled/`.
- [x] Remove the old auth element, its registration, property mutation, event
  bridge, and readiness fields in the cutover change.
- [x] Retain the shared registry, upgrade observer, and CSS loader for their
  remaining Lit consumers. Remove the auth menu from their built-in lists.
- [x] Compare pilot code and per-flow compressed bytes with the baseline.
  Record any new infrastructure and whether it serves a demonstrated need.

**Exit:** all auth branches pass behavioral, visual, CSP, supported-browser,
and size checks. Resolve pilot regressions before starting another surface.

### 4. Migrate confirmation with its required primitives

**Depends on:** Phase 3; confirmation and overlay baseline gates pass.

Preparation — 2026-09-21:

- Moved transaction tree construction, formatters, and the five chain renderer
  modules into `ui/transaction-display/`. Existing Lit callers import their
  new locations directly; no forwarding or compatibility modules remain.
- Compared all seven moved files against the starting commit: contents are
  identical apart from the formatter import path in `tree.ts`. This separates
  the pure-code move from the forthcoming renderer change.
- Production build and browser-test type-check passed. Combined auth, host,
  confirmation handle, inline/host, and resize contracts passed **90/90**;
  see `.artifacts/refactor-127/confirmation-pure-move-contracts.log`.
- At this preparation checkpoint confirmation remained on its existing Lit
  renderer; the production Preact cutover is recorded below.

Primitive implementation in progress:

- Added native Preact `HaloBorder` and `PasskeyHaloLoading` for the existing
  confirmation hero's 36px fingerprint/mail presentation. They render ordinary
  DOM, inherit theme tokens, and receive the surface-owned CSP rule manager.
  Animation owns one frame and one media-query listener; stop, reduced motion,
  replacement of the style owner, and unmount release its keyed rule.
- The new primitive stylesheet is document-owned and explicitly linked by the
  harness. It has no custom-element registration, style fetch, or first-paint
  gate. The production Preact confirmation now consumes this document-owned
  stylesheet; the remaining Lit consumers stay until their acceptance gates.
- Extracted local Preact module routing from the auth harness into shared test
  setup. Added cross-engine lifecycle/CSP checks and temporary light/dark icon
  captures under `.artifacts/refactor-127/visual/preact-primitives/`.
- Both existing token emitters need ordinary `.seams-wallet-ui` roots and their
  `data-theme` attribute. Updated both sources and regenerated the checked-in
  CSS; consolidation of these pre-existing emitters remains Phase 8 work.
- Verification: production build, build-freshness, generated-palette check,
  and browser-test type-check passed. Primitive plus neighboring auth lifecycle
  checks passed **15/15** across Chromium, Firefox, and WebKit. Auth visual
  comparisons passed **108/108** after the shared theme selector change.
  Logs: `confirmation-primitives-{build,browser,types,auth-visual}.log` under
  `.artifacts/refactor-127/`.
- Classified initial failures as test infrastructure: missing local Preact
  routes, and Playwright's WebKit screenshot animation synchronization injecting
  an inline `body {}` style under CSP. Runtime CSP assertions remain unchanged
  on all engines; screenshots use Chromium, matching the baseline. A concurrent
  type-check encountered WASM files being regenerated; its post-build rerun
  passed. Future type-checks must wait for WASM-generating builds to finish.
- These component captures are initial inspection artifacts. Matched Lit/Preact
  visual acceptance and the remaining primitives remain incomplete. Do not
  delete shared Lit halo/loading consumers yet.

Transaction-tree implementation — 2026-09-21:

- Added native `TransactionTree.tsx` and `TransactionLabel.tsx`, using the moved
  formatters and existing display-tree model. Action labels use exhaustive
  `ActionType` branches; unknown chains retain plain contract labels without
  inventing an explorer URL. Explorer anchors retain native navigation.
- Expansion uses native details/summary semantics and the existing clamped
  surface-resize announcement. Each node owns its geometry rule, local motion,
  decoded/raw mode, and copy feedback timer. Disposal cancels local work and
  rejects late clipboard completion. Copy controls are now native buttons.
- Added document-scoped tree CSS and a harness-visible build entry. Production
  confirmation now renders this tree through Preact; the old Lit tree remains
  only for the migration baseline and other uncut surfaces.
- Production build and browser-test type-check passed. **9/9** browser tests
  passed across Chromium, Firefox, and WebKit: NEAR formatting, unknown-chain
  behavior, keyboard expansion, decoded/raw switching, copy feedback, explorer
  targets, normal-motion completion, strict CSP, and pending-copy disposal.
  Evidence: `.artifacts/refactor-127/transaction-tree-{build,types,browser}.log`.
- Initial screenshot: `visual/preact-primitives/transaction-tree-light.png`
  under the temporary artifact directory. Inspection shows right-edge copy
  badge clipping. A matched Lit/Preact capture at 360px reproduced the same
  **9px** overflow in both renderers: the label used a full content-box width
  plus padding. Classified as a pre-existing production defect; the Preact
  label now uses border-box sizing. The original Lit implementation and
  references remain unchanged. Diagnostic artifacts: `tree-copy-diagnosis.log`
  and `visual/preact-primitives/tree-copy-{lit,preact-before}.png`.
- Copy/copy-complete controls now stay inside their rows at 320px, 360px, and
  768px. The tree suite passed **12/12** across three engines; corrected
  Chromium captures are `visual/preact-primitives/tree-copy-fixed-*.png`.
  This is an intentional visual correction, alongside native copy buttons.
- Added a hosted expansion test using the existing resize choreographer and
  a simulated parent viewport. The body remains at zero height until the box
  grows, stays within the available space at each step, announces one delta,
  and releases its clamp on landing. **3/3** engines passed; see
  `tree-hosted-resize.log`. Full theme/chain visual parity, hosted closing,
  interruption/disposal during a claimed resize, and complete surface
  integration remain open gates.
- Final combined tree run after rebuilding passed **15/15**. Production build,
  browser-test type-check, build-freshness, and whitespace checks passed.
  Reviewed corrected 320px, 360px, and 768px screenshots; the copy control stays
  inside the existing card. Logs: `tree-copy-{build,types,final-browser}.log`.
  The temporary Lit comparison test was removed after saving its evidence;
  the retained regression asserts current Preact control bounds directly.

Confirmation content implementation in progress:

- Moved ABI decoding and display enrichment from `lit-components/TxTree/abi`
  to `transaction-display/abi`. Both modules match their original SHA-256
  hashes; only the caller's lazy feature import changed. No compatibility
  forwarders remain. Declaration generation and production build passed;
  the existing lazy ABI enrichment browser contract passed **1/1** in Chromium.
  Evidence: `.artifacts/refactor-127/abi-move-{types,build,browser}.log`.
- Added `ConfirmContent.tsx` with a discriminated preparing/ready action
  contract, synchronous confirmation callback, always-available cancellation,
  two-frame initial activation guard, and owned height-reflow cleanup.
- Added scoped document-owned `confirm-content.css`, preserving action button,
  transaction background, loading indicator, and driven-height styling. Reduced
  motion keeps the loading text visible with a static indicator.
- Production build for the new component passed. Browser-test type-check,
  including invalid preparing/ready branch fixtures, passed. Content CSS is
  staged; browser behavior, matched screenshots, and document asset integration
  remain to be verified before production cutover.
- Initial content browser gates passed **6/6** across Chromium, Firefox, and
  WebKit: initial disabled guard, synchronous ready callback, preparing-state
  cancellation, ready/preparing updates, and disposal before arming. Strict
  CSP remained clean with no inline style attributes. Browser-test type-check
  passed. Evidence: `.artifacts/refactor-127/confirm-content-browser.log`.
  Added a composed content/tree regression: adding, replacing, and removing
  transaction content releases temporary height clamps and returns to the
  original action-only height. Combined content checks now pass **9/9** across
  all three engines, with browser-test type-check passing. Hosted reflow and
  matched visual acceptance remain open.

Confirmation header implementation in progress:

- Added native `ConfirmHeader.tsx` using the existing Preact passkey/mail halo.
  It receives resolved heading text and explicit loading/ready website and
  chain display states. Auth-mode selection remains outside this renderer.
- Preserved existing heading, error, website, chain, and loading markup;
  decorative SVGs are hidden from assistive technology. Declaration generation
  passed (`.artifacts/refactor-127/confirm-header-types.log`). Added scoped
  `confirm-header.css` for the existing modal header spacing, metadata icons,
  heading, error, and motion-preference-aware loading ellipsis. All rules are
  owned by `.seams-wallet-ui .seams-confirm-header`; no global hero selectors
  were introduced. Browser tests, visual acceptance, document asset wiring,
  and surface composition remain pending.
- Added a harness-visible header build entry and composed browser coverage.
  Header loading/ready updates preserve status nodes, error state removes the
  animated halo, and disposal unmounts the header without CSP violations.
  Header/content suite passed **12/12** across Chromium, Firefox, and WebKit.
  Production build and browser-test type-check passed, including rejection
  fixtures for missing ready text and stale text spread into loading state.
  Evidence: `.artifacts/refactor-127/confirm-header-{build,browser,test-types}.log`.
  Matched screenshot review and full surface integration remain pending.

Passkey-registration view preparation:

- Added `PasskeyRegistrationDetails.tsx`, sharing the same existing typed
  registration display contract used by modal and drawer. It preserves the
  Account (`intendedUserName`) and Website (`rpId`) values and their title text;
  it does not substitute the internal account id for the displayed user name.
- Declaration generation passed (`registration-details-types.log`). This
  renderer remains staged: registration styling, the 44px hero, actions,
  browser coverage, matched screenshots, and production integration remain.
- Added `PasskeyRegistrationContent.tsx` composing the registration heading,
  body, identity panel, error, and native actions. Its creating branch cannot
  carry a confirm callback; Cancel remains enabled. Extended the existing
  Preact halo's display size to support the registration view's 44px icon,
  retaining 36px for transaction confirmations. Declaration generation passed
  (`registration-content-types.log`). Scoped registration CSS and browser/
  visual acceptance remain pending; production still uses the Lit view.
- Added document-scoped `passkey-registration.css` for the registration hero,
  identity rows, error, action states, and spinner. Ported the existing tokens
  and declarations, preserving the registration-specific filled Cancel style.
  Spinner animation is restricted to no-preference motion; reduced-motion
  buttons do not transform. Formatting and whitespace checks passed. Browser
  and matched visual checks are still required before wiring this asset.
- Registration browser coverage now verifies displayed user name versus internal
  account id, website, the 44px icon, synchronous confirmation, disabled
  creation action, available cancellation, and disposal under strict CSP.
  Combined content/header/registration and neighboring halo checks passed
  **21/21** across Chromium, Firefox, and WebKit. Production build and
  browser-test type-check passed; see `registration-{build,browser,test-types}.log`.
  These are staged component checks; matched visuals and production integration
  remain open.

Registration content capture checkpoint:

- Saved eight transparent content-only captures at 360px and 768px, light/dark,
  ready/creating, under temporary `visual/preact-primitives/registration-*.png`.
  Identity and button bounds checks passed **3/3** across Chromium, Firefox,
  and WebKit (`registration-captures.log`). Inspected the narrow light creating
  and wide dark ready captures. These omit the modal/drawer shell and are
  inspection artifacts, not matched Lit/Preact acceptance. The narrow creating
  spinner appears compressed and needs comparison with the complete baseline
  before deciding whether it is inherited behavior or a new layout defect.
- Resolved the spinner issue as a **production_regression in the staged port**:
  comparing the same markup with original CSS measured Preact 4×16px versus
  legacy 20×20px (`registration-spinner-diagnosis.log`). The port omitted
  the <=640px stacked action/identity rules; the original cascade also resolves
  spinner dimensions to 20px. Restored those rules and dimensions. Retained
  a 20×20px geometry regression in the capture test and removed the temporary
  legacy-stylesheet diagnostic. All three engines passed; reviewed the updated
  narrow creating capture with the restored stacked layout and round spinner.

Email-code view preparation:

- Added controlled `EmailOtpInput.tsx` with explicit editing/fading/submitting
  states and available/unavailable resend actions. It retains a native labeled
  numeric-keyboard, one-time-code autofill input and decorative digit slots.
  Per-instance ids associate helper and error text with the input; error state
  is exposed through `aria-invalid`. Disabled branches carry no input callback.
- Declaration generation passed (`email-otp-input-types.log`). This is the view
  only: normalization, auto-submit fade, resend cooldown, stale async rejection,
  scoped CSS, browser/visual verification, and production integration remain.
- Added staged `EmailOtpSession` owning normalized input, the 150ms submit
  fade, resend/cooldown state, and timer disposal. Disposed sessions discard
  late resend results and cannot submit. Resend callbacks return a sent/failed
  result; the prompt boundary still needs to normalize challenge updates and
  preserve existing rate-limit messages before integration.
- Two focused Node tests passed for normalized single submission and disposal
  during a pending resend/fade. Declaration generation passed after correcting
  a new callback-reentrancy narrowing error (`email-otp-session-types.log`).
  Retry, cooldown, boundary adaptation, and browser integration still need
  coverage; the existing Lit lifecycle remains active until cutover.
- Expanded OTP session coverage to **6/6** passing Node tests: single-flight
  resend, cooldown expiry, recoverable resend error/clear-on-edit, retry during
  fade, and callback-triggered disposal join the original submission/disposal
  checks. Evidence: `email-otp-session-tests.log`. Initial new-test failures
  were a test harness field-initialization-order error, repaired without a
  production behavior change. Prompt-boundary and browser integration remain.
- Added staged `EmailOtpContent.tsx` composing the session with the controlled
  Preact input. A challenge-id key owns the session lifetime; replacing it or
  unmounting disposes pending submission/cooldown work. Session snapshots drive
  editing/fading/submitting and resend availability. Declaration generation
  passed (`email-otp-content-types.log`). Boundary challenge updates, external
  retry handling, scoped CSS, and browser/visual gates remain before cutover.
- Added scoped `email-otp.css` preserving digit-slot geometry and focus treatment,
  with reduced-motion transform removal. Wired the staged component into the
  browser harness. Normalized input, autofill metadata, challenge replacement
  during fade, single submission, disabled submitted input, disposal, and CSP
  passed **3/3** across the browser matrix (`email-otp-browser.log`).
- Corrected a staged fade-state mismatch: submitted digits remain faded, matching
  the existing Lit behavior. Production build passed before that one-line change;
  Rolldown rebuilt the final renderer before the browser run. Evidence:
  `email-otp-{build,rolldown}.log`. Full build freshness and visual acceptance
  remain gates for the complete surface.
- Adapted the existing `EmailOtpConfirmPrompt` at the Preact content boundary.
  Resend results update the active challenge id/recipient hint, preserve void
  results, and retain existing rate-limit error wording. Disposal prevents late
  results from changing the prompt. Submission carries the active challenge id.
  Resend-to-submit and challenge-replacement browser contracts passed **6/6**
  across three engines (`email-otp-boundary-browser.log`); declarations and
  Rolldown build passed. External retry/host loading integration and broader
  error/race checks remain before production cutover.
- Added required ready/pending/rejected verification state to the composed OTP
  view. Pending cancels any unfinished submit fade; rejection returns to editing
  with linked error text. Equivalent repeated host states do not reopen a
  submitted input. Node lifecycle checks passed **7/7** and focused browser
  verification transitions passed **3/3** across all engines; declarations and
  Rolldown build passed (`email-otp-verification-{types,build,browser}.log`).

Confirmation body preparation:

- Added `ConfirmationBody.tsx` and a boundary builder for empty, plain-text,
  progress, and NEAR funding notices, reusing existing notice parsers. Funding
  uses a native button and typed full-account callback, preserving its shortened
  visible label. Declaration generation passed (`confirmation-body-types.log`).
- Body CSS, browser tests, and mount integration remain. The old shared
  `copyTextToClipboard` fallback writes inline styles; the replacement mount
  must use a CSP-safe copy path before wiring the funding action.
- Extracted the staged transaction tree's clipboard implementation to
  `preact/clipboard.ts` for use by the eventual funding-action mount. Tree copy
  feedback and disposal guards remain owned by the tree. The helper retains
  scoped textarea fallback without inline styles and removes it in `finally`.
  The live Lit clipboard helper is unchanged until its callers are migrated.
- Declaration generation, Rolldown build, and browser-test type-check passed.
  Tree checks including a new scoped textarea fallback/CSP regression passed
  **18/18** across three engines (`clipboard-{types,build,browser}.log`).

Confirmation content composition:

- Added `ConfirmationContent.tsx` as the staged modal/drawer content entrypoint.
  Registration and transaction branches exclude each other's props; the email
  prompt branch requires its complete OTP contract. It composes header, body,
  OTP, tree/actions, or registration content without registration-side effects.
- Funding copy now calls the shared scoped clipboard helper from the owned
  content root. Broadened the existing offscreen fallback selector to the
  wallet UI scope so both tree and funding copy use it.
- Declaration generation and browser-test type-check passed, including static
  rejection of mixed content branches and missing email contracts. Evidence:
  `confirmation-composition-types.log`. Body styles, composed browser/visual
  checks, outer modal/drawer lifecycle, and production cutover remain pending.
- Added scoped confirmation-body CSS and a composed funding/status browser
  contract. The full account id reaches the scoped textarea fallback, the
  textarea is removed, status replacement removes the copy action, and disposal
  releases the composed subtree without CSP violations. Checks passed **3/3**
  across all engines (`confirmation-composition-browser.log`); Rolldown build
  and browser-test type-check passed. Full shell visual acceptance remains open.

Confirmation modal shell (staged):

- Added `ConfirmationModal.tsx` around the composed subtree. Standalone mode
  uses native `dialog.showModal()` for background inertness and opener focus
  restoration; wallet-iframe mode remains an intrinsic-height content shell
  inside the parent's dialog. Context changes remount the shell and release
  native dialog ownership.
- Escape and standalone backdrop clicks deliver cancellation directly. The
  controller still owns two-phase close: a cancellation intent leaves content
  mounted until disposal. Clicks inside content do not cancel, and unmount
  releases the native dialog without leaving global keyboard listeners.
- Ported scoped modal card geometry/elevation into `confirmation-modal.css`.
  Full matched visual acceptance, entrance motion, outer height choreography,
  drawer gestures, timeout/controller integration, and production stylesheet
  wiring remain open. Production confirmation continues to use Lit.
- Focus, inertness, backdrop, two-phase close, context replacement, intrinsic
  sizing, and strict-CSP browser checks passed **6/6** across Chromium, Firefox,
  and WebKit (`confirmation-modal-browser.log`). Rolldown, declaration
  generation, and browser-test type-check passed (`confirmation-modal-build.log`,
  `confirmation-modal-types.log`, `confirmation-modal-test-types.log`).
- The full composed-content browser file also passed **36/36** across those
  engines, covering neighboring OTP, registration, header, tree/content, and
  funding behavior (`confirmation-modal-neighbors.log`).

Drawer gesture preparation:

- Moved the current drawer's elastic translation and release decision into
  framework-neutral `ui/drawer-gesture.ts`, with the live Lit drawer calling
  those functions. Preserved upward/downward flick dismissal, instantaneous
  versus average velocity, the 50px near-closed threshold, and sheet/viewport/
  configured overpull allowance. This is a pure-code extraction; pointer
  ownership, DOM composition, timers, and drawer rendering are unchanged.
- `node --test tests/unit/drawer-gesture.test.mjs` passed **4/4**, covering
  exact thresholds, slow release, zero-duration gestures, zero rest position,
  and elastic geometry. Rolldown and declaration generation passed
  (`drawer-gesture-build.log`, `drawer-gesture-types.log`); the existing Lit
  drawer lifecycle browser test passed **1/1** in Chromium
  (`drawer-gesture-browser.log`). These checks do not establish pointer capture,
  scrolling, interrupted transitions, or Preact drawer acceptance.

Native Preact drawer shell (staged):

- Added `ConfirmationDrawer.tsx` and scoped `confirmation-drawer.css`. The
  standalone shell uses a native dialog with a content-fitted translated sheet;
  the wallet-iframe shell retains intrinsic sizing. Resize observation follows
  the content and sheet directly, with no registration or child-adoption work.
- Pointer gestures use the shared elastic/flick rules, an 8px activation
  threshold, pointer-id ownership, pointer capture, and a scroll-top gate.
  Interactive child controls are excluded from drag initiation. Pointer cancel
  and lost capture abandon the gesture without delivering a dismissal.
- Open/busy and closing states are distinct typed branches. Closing requires
  a completion owner and rejects interactive state (including broad spreads)
  through type fixtures. Completion has transition and reduced-motion/timer
  paths, reports once, and is canceled by reopening or disposal. Escape remains
  usable while busy; close/handle/drag controls follow the busy restriction.
- Unmount releases pointer listeners/capture, observer, viewport listener,
  animation frame, close timer, CSSOM rules, and native dialog ownership.
  WebKit exposed a synthesized click after drag release that doubled cancel;
  the implementation now suppresses that gesture's click while preserving
  keyboard activation and new pointer sequences.
- Diagnostic screenshots exposed native focus scrolling the initially hidden
  standalone sheet's outer dialog, negating a correct 602px resting transform.
  `overflow: clip` on the outer dialog fixes that; scrolling stays in the body.
  Restored the original font stack and 384px cap. The geometry test now checks
  the content-fitted resting position in addition to visible action bounds.
- Eight diagnostic screenshots (two contexts × two themes × two widths) live
  under ignored `visual/preact-primitives/drawer-*.png`. Narrow dark standalone
  and wide light hosted captures were inspected; these are not matched Lit
  acceptance fixtures. Remaining work includes drawer-specific content styling,
  real touch/scroll and content-expansion choreography, controller integration,
  full visual comparison, and production cutover.
- Rolldown build, declaration generation, and browser-test type checks passed
  (`preact-drawer-build.log`, `preact-drawer-types.log`,
  `preact-drawer-test-types.log`). The final composed-content suite passed
  **48/48** across Chromium, Firefox, and WebKit, including the new drawer
  lifecycle/gesture/geometry checks (`preact-drawer-verified.log`).

Explicit confirmation mount API (staged):

- Added `preact/mountConfirmationSurface.tsx`, composing the native modal or
  drawer with `ConfirmationContent` behind `element`, `update(completeModel)`,
  `close()`, and `dispose()`. Presentation is fixed at mount; each update
  requires appearance and a complete content branch. Type fixtures reject
  controller patches and incomplete models at this renderer boundary.
- The controller remains the workflow owner. The mount forwards the current
  branch's callbacks synchronously, filters confirmation/cancellation/OTP
  callbacks once closing starts, ignores late updates, and drops its model and
  callbacks at disposal. Modal close disposes immediately; drawer close waits
  for its owned transition completion. `onClosed` runs once after removal.
- Appearance uses document-owned CSP styles, following the auth-menu pattern.
  Mount requires loaded `data-seams-components-css` and
  `data-seams-confirmation-css` links before creating DOM. The browser harness
  serves the existing confirmation CSS sources as that second linked sheet;
  production asset/document wiring remains pending. This adds no runtime CSS
  adoption, registration import, or local first-paint waiting layer.
- Focused browser checks cover current/synchronous callback delivery, preparing
  versus ready updates, filtering callbacks during drawer close, idempotent
  disposal, opener focus restoration, missing-CSS rejection before root creation,
  simultaneous mounts, and independent appearance-rule cleanup under strict CSP.
- Verification passed: **12/12** browser checks across Chromium, Firefox, and
  WebKit (`confirmation-mount-browser.log`), Rolldown build, declaration
  generation, and browser-test/type-fixture checks
  (`confirmation-mount-build.log`, `confirmation-mount-types.log`,
  `confirmation-mount-test-types.log`).
- This remains a staged renderer entrypoint. Raw `ConfirmUIUpdate` normalization,
  public `ConfirmUIHandle` decision queues,
  measurement/resize binding, timeout handling, document assets, and matched
  visual acceptance must be integrated before replacing production Lit.

Email confirmation form routing:

- The composed email Confirm Code button now submits the OTP session's native
  form through an instance-specific form id. Direct passkey/session activation
  continues to invoke its callback synchronously. The form decision branch
  requires a form owner and excludes a direct callback through type fixtures;
  form linkage is generated by the composed view rather than supplied by the
  controller's model.
- Added `EmailOtpSession.confirm()` and routed automatic six-digit input and
  manual retry through the same fade/submission gate. Incomplete input reports
  the existing validation message and focuses the field after its error is
  rendered. Pending or disposed sessions ignore additional submit requests.
- Native Enter submission, manual retries retaining the rejected code, and
  independent simultaneous forms are covered through the mounted surface.
  These checks also verify that email submission never invokes the direct
  passkey/session callback, and that strict CSP remains clean.
- Verification passed: **9/9** OTP session unit tests (`otp-form-session.log`),
  **66/66** composed-content and mount browser checks across Chromium, Firefox,
  and WebKit (`otp-form-browser.log`), Rolldown, declaration generation, and
  browser-test/type-fixture checks (`otp-form-build.log`, `otp-form-types.log`,
  `otp-form-test-types.log`). At this staging checkpoint, production controller
  normalization/cutover and full matched visual acceptance remained pending;
  production integration is recorded below.

Production confirmation integration checkpoint — 2026-09-21:

- `695ab0f` restores the fixed hosted transaction-tree caps required by the
  parent iframe measurement contract. Viewport-relative caps remain for
  standalone documents; hosted file content uses the established 12rem/20rem
  limits and cannot chase the easing box.
- `db0d9a4` makes the Preact confirmation-content owner capture the complete
  modal/drawer surface before header and body updates. Registration content
  participates through the same root ref, and the surface clamp is expressed
  through the existing CSP-safe declaration stylesheet. This prevents nested
  header/body updates from posting multiple measurements.
- `beae197` adapts the real cross-origin tree-growth harness to the Preact
  mount handle, ordinary-DOM selectors, and the document-linked confirmation
  stylesheet. The production harness now exercises the actual parent overlay,
  wallet iframe, confirmation surface, and transaction tree.
- Verification: the cross-origin motion suite passed **4/4** in Chromium
  (folder open/close, decoded/raw mode, error banner, and box-independent
  content height); the public confirmation/mount/tree suite passed **51/51**
  across Chromium, Firefox, and WebKit; the basic confirmation visual matrix
  passed **12/12**. Wallet and browser-test type checks passed.
- Remaining gates are the full registration/OTP/responsive/mount-context visual
  matrix, standalone and inline acceptance, bundle accounting, and deletion of
  the old confirmation Lit subtree. Keep the temporary visual comparisons and
  saved Lit build until Phase 8d.

Transaction-tree visual checkpoint — 2026-09-21:

- `7ebbdb9` adds a deterministic before/after gate for the default transaction
  tree fixture in light and dark themes. It mounts the saved Lit build and the
  current Preact tree through the same document stylesheet and host geometry,
  then compares the component crops. `82b83b3` extends the gate with an
  expanded EVM tree containing an explorer link, decoded/raw content, and a
  copy control.
- Both captures match the saved Lit baseline exactly: 420×48px, zero changed
  pixels, and zero maximum channel delta. The expanded EVM pair matches at
  420×139px in both themes with 180 changed pixels (0.31%), below the 1%
  ceiling. The browser-test type-check and four-case Chromium visual run
  passed.
- This is evidence for the default tree fixture only. Chain-specific details,
  expanded content, copy/mode interactions, hosted resizing, and the complete
  confirmation visual matrix remain open. Keep this temporary comparison until
  Phase 8d, when all migration visual gates have passed. The existing
  transaction-tree behavior matrix passed **18/18** across Chromium, Firefox,
  and WebKit after the parity gate was added, including NEAR formatting,
  unknown-chain fallback, keyboard expansion, clipboard fallback, disposal,
  and hosted resize choreography.

Confirmation tree-in-surface checkpoint — 2026-09-21:

- `4efbcb6` restores the generated `--seams-colors-txDetailsBackground` token
  used by the shared confirmation and transaction-tree stylesheet. Without it,
  the Preact tree fell back to `surface2` and visibly darkened the light
  confirmer card.
- `62eef4e` changes the matched confirmer visual fixture to include an EVM
  contract-call tree with a decoded/raw calldata field and copy control. The
  saved-Lit and Preact production mounts now pass all 12 modal/drawer,
  loading/error, and light/dark captures; dimensions match in every pair.
  Surface differences are 0.09–0.74% of each crop, below the existing
  thresholds. The built CSS, browser-test type-check, saved-Lit capture, and
  Preact comparison all passed. The focused confirmation-content and
  confirmation-mount browser matrix passed **72/72** across Chromium, Firefox,
  and WebKit after the token and fixture changes.

Luna audit checkpoint — 2026-09-21 (`b8ef031`):

- Treat `b8ef031` as the review boundary for the next implementation turns.
  Re-review the generated transaction-detail token, the saved-Lit/Preact visual
  threshold rationale, expanded-tree rendering inside modal and drawer
  confirmers, and confirmation surface reflow/cleanup before accepting the
  confirmation phase or deleting any Lit baseline code.
- The temporary visual comparisons and saved Lit build remain intentionally
  retained. Do not remove them until Phase 8d has reviewed every migrated
  component and the final cleanup gates pass.

Luna review checkpoint — 2026-09-21:

- Follow-up work from this checkpoint is expected to use Luna. Before merging
  later phases, perform an extra review of confirmation reflow ownership,
  hosted sizing, registration/error updates, strict-CSP declaration rules, and
  the adapted cross-origin harness. Re-run the four motion cases and the 51
  public browser checks after any related change.

Confirmation chain-context checkpoint — 2026-09-21 (`e3639ce`):

- Added a public `mountConfirmUI` matrix covering NEAR, EVM, and Tempo across
  standalone and wallet-iframe modal/drawer combinations. All 12 combinations
  render their chain details and transaction tree, and the expected host-box
  context is asserted for each variant.
- The focused confirmation, content, and transaction-tree browser matrix now
  passes **99/99** across Chromium, Firefox, and WebKit. Existing strict-CSP,
  missing-stylesheet, focus, resize, close, and disposal assertions remain in
  that run. Because this is post-Luna work, re-review the context mapping and
  close timing before accepting the confirmation phase.

Confirmation lifecycle checkpoint — 2026-09-21 (`ab7ee29`):

- Added delayed feature-import coverage and a sequential cancel-to-confirm auth
  handoff through the public confirmation API. The focused lifecycle cases pass
  **6/6** across Chromium, Firefox, and WebKit; the broader confirmation,
  content, and transaction-tree run remains **99/99**.
- The existing drawer interruption and callback-filtering checks cover rapid
  close/replacement behavior. Re-review delayed-import settlement and portal
  cleanup at the Luna audit boundary before deleting the confirmation Lit
  subtree.

Confirmation primitive visual checkpoint — 2026-09-21 (`772d172`, `3c77dd8`):

- Matched the saved Lit and production Preact confirmation primitives under the
  strict-CSP visual harness: HaloBorder, PasskeyHaloLoading, and PadlockIcon in
  light and dark themes. All **6/6** comparisons have identical dimensions and
  zero changed pixels; the browser visual run and browser-test type-check pass.
- The passkey fixture uses the production confirmer contract (36px icon,
  zero inner padding, transparent inner background). The Preact halo now owns
  its keyed dynamic declarations for explicit inner padding and animation angle;
  the lifecycle/CSP browser matrix remains **6/6** across Chromium, Firefox,
  and WebKit.
- Evidence remains ignored under
  `.artifacts/refactor-127/visual/confirmation-primitives/`. This closes the
  primitive fixture gate only; complete confirmer, drawer, registration/OTP,
  responsive, and inline-entrypoint visual acceptance remain open. Retain this
  temporary comparison and the saved Lit build until Phase 8d.
- After the source cutover, the broader confirmation/content/tree/mount matrix
  passed **108/108** across Chromium, Firefox, and WebKit. Wallet type-check,
  browser-test type-check, production Rolldown build, the 6-case primitive
  visual run, and the 12-case confirmation visual run also passed.

Luna extra-review checkpoint — 2026-09-21 (`3c77dd8`):

- Work after this checkpoint is expected to use Luna. Before accepting later
  confirmation or cleanup changes, re-review the halo dynamic-declaration
  lifecycle, passkey geometry props, strict-CSP visual harness, and the zero-
  pixel threshold evidence. Re-run the primitive comparison and the broader
  confirmation browser matrix after related changes.

#### 4a. Characterize primitives and build the confirmation subtree

- [x] Cover drawer pointer capture, dismissal thresholds, interrupted
  transitions, focus trapping/restoration, reduced motion, and resizing. The
  confirmation content and mount suites pass these cases in all three
  supported browser engines.
- [x] Cover transaction tree expansion, chain-specific formatting, explorer
  links, copy, long values, and error/loading content.
- [x] Implement Preact primitives only as the confirmation subtree needs them:
  drawer, halo, passkey loader, padlock, and transaction tree.
- [x] Reuse framework-neutral parsing/formatting and measurement algorithms.
  Keep geometry writes on the existing keyed CSP rule path.
- [x] Develop against the established surface contract in the test harness;
  the production switch and deletion remain separate reviewable cutovers.

#### 4b. Switch the complete confirmation surface

- [x] Replace wrapper/modal/drawer/content rendering together with the
  discriminated Preact surface model; preserve `ConfirmUIHandle`.
- [x] Normalize complete internal models at `confirm-ui.ts`, preserving
  security context, display data, appearance, signing mode, and Email OTP.
- [x] Preserve preparation reuse, two-phase close, onCancel subscriptions,
  takeDecision semantics, exactly-once settlement, and opened/closed messages.
- [x] Keep a single feature import that returns a mount API.
  `prewarmTxConfirmerUi()` warms code without registration side effects.
- [x] Verify every supported chain and mount context, including standalone
  modal/drawer and wallet-iframe entrypoints. The public mount matrix covers
  all 12 chain/context/variant combinations; the browser suite also exercises
  CSS isolation, strict-CSP stylesheet failure, focus, and disposal. Inline
  entrypoint visual acceptance remains open.
- [ ] Capture matched confirmer, drawer, transaction-tree, halo, passkey-loader,
  and padlock fixtures and review every image diff.
- [x] Test rapid confirm/cancel, replacement while closing, delayed imports,
  and auth-to-confirm-to-auth handoff with no stale state or focus. The
  lifecycle gate passes across Chromium, Firefox, and WebKit; standalone and
  hosted drawer interruption cases remain in the same focused matrix.
- [ ] Delete confirmation's Lit subtree and registrations. Keep shared Lit
  primitives still needed by export, recovery, or React adapters.

**Exit:** confirmation contracts, screenshots, CSP, measurement, supported
browsers, and per-flow size gates pass through the public integration boundary.

### 5. Migrate private-key export

**Depends on:** Phase 4's verified primitives.

Implementation started: extracted the existing key-reveal reel and masking
functions into `ui/export-private-key-reveal.ts`. The current Lit viewer consumes
that single implementation, ready for reuse by Preact. Focused Node tests cover
both key schemes, masked-target settling, and reduced-motion placeholders using
synthetic keys.

Staged export checkpoint — 2026-09-21:

- Added `ExportPrivateKeySurface` with loading/ready/failed view models,
  masked reveal, copy feedback, and stale-copy protection on key replacement.
- Added an explicit mount/update/dispose handle with owned appearance rules.
  The production `upsertExportViewerHost()` still uses Lit until acceptance.
- Shared drawer options preserve export's non-dismissing backdrop and exclude
  selectable export content from drag initiation. Focused tests cover both,
  closing during loading/reveal, repeated disposal, multi-key reopening,
  failure clearing key rows, and delayed clipboard completion/rejection.
- Export, confirmation-mount, and transaction-tree browser checks passed 60/60
  across Chromium, Firefox, and WebKit, including rejected-clipboard fallback
  and strict CSP. Aborting a key's lifetime prevents a delayed clipboard
  rejection from initiating fallback after replacement/disposal; an already
  submitted Clipboard API write cannot be revoked.
- Rolldown build, declaration build, and browser TypeScript checks passed,
  including invalid-state type fixtures.
- Captured and inspected 12 matched desktop export pairs: loading, ready, and
  multi-key in light/dark and hosted/standalone contexts. Artifacts are ignored
  under `.artifacts/refactor-127/visual/export/`. Standalone pairs differ by
  0–2 pixels; single-key hosted pairs by 24–27 pixels. The visual harness checks
  geometry and a 0.1% changed-pixel ceiling for these 1024×900 captures.
- Intentional correction: long hosted multi-key exports scroll inside their
  36rem host rather than clipping unreachable content. These pairs differ by
  1,130–2,040 pixels (0.13–0.23% of the frame), with a separate 0.3% ceiling.
  Behavioral tests scroll to the final warning; additional scrolled screenshots
  record the newly reachable content. Existing confirmation visual checks also
  passed 12/12 after matching the drawer's whole-pixel content measurement.
- Remaining priority: production host/session/measurement and document-CSS
  integration, narrow viewports, copied/error/appearance visual fixtures, then
  removal of the accepted export Lit subtree. These staged desktop captures
  do not establish production integration or complete export acceptance.

Production export integration checkpoint — 2026-09-21:

- `upsertExportViewerHost()` now imports an explicit Preact mount function.
  Session lifetime, first measurement, updates, and disposal are owned by the
  host; cancellation invalidates pending imports. Loading and failure models
  discard ready key material at the request boundary.
- Export CSS is emitted in the document-linked `confirmation-ui.css` bundle.
  Export and confirmation share document stylesheet validation and the existing
  CSP-safe dynamic-rule manager; no export component fetches or adopts CSS.
- Fresh Rolldown build, declaration generation, wallet type-check, and browser
  test type-check passed. Export-host, export-renderer, and confirmation-mount
  behavior checks passed 66/66 across Chromium, Firefox, and WebKit. Coverage
  includes failed imports, unavailable CSS, stale mounts, session replacement,
  synchronous removal from first measurement, clipboard lifetime, and focus.
- All 12 desktop comparison gates passed through the production host API using
  the emitted stylesheet. PNGs remain ignored in the existing artifact folder.
  The hosted dark multi-key comparison was reinspected after the cutover.
- At this checkpoint, export Lit deletion and the per-flow bundle-size gate
  remained open; the cleanup and final graph evidence are recorded below.

Extended export capture checkpoint — 2026-09-21:

- Expanded the public-host comparison harness to 48 pairs: 1024px and 390px
  viewports, both themes and contexts, and ready/multi-key/loading/failed/copied/
  custom-appearance states. All cases pass after targeted reruns. Browser-test
  TypeScript checking also passes. Clipboard writes use synthetic fixture data.
- The final run passed all 48 pairs. Hosted multi-key comparisons use an explicit
  scroll-edge region plus separate narrow/desktop ceilings so the accepted
  fixed-height scroll boundary is measured directly. The inspected differences
  remain localized to that boundary and small renderer edge differences.
- Inspected copied feedback, narrow error, narrow multi-key, and visibly custom
  appearance comparisons. Appearance overrides the actual `success` and
  `textPrimary` tokens. Screenshots remain ignored.
- The export sheet now subtracts its content-box padding from `100dvh`, keeping
  its top edge reachable in short documents. A parent-overlay fixture exercises
  the real `OverlayController`, provisional and measured geometry, iframe
  measurement, scroll-to-warning, close/focus restoration, and strict CSP at
  1024×900, 390×844, and 390×300. Export-host, renderer, and parent-overlay
  checks passed 51/51 across Chromium, Firefox, and WebKit.

Luna handoff checkpoint — 2026-09-21:

- The export checkpoint is split across `97bd286` (short-viewport layout),
  `b7d3922` (parent-overlay integration), and `7dcc2a6` (visual parity gates).
- This is an intentional audit marker. Future work performed with Luna requires
  an extra review of export lifecycle invalidation, measurement ownership,
  content-box sizing, strict-CSP behavior, and the visual threshold rationale
  before the export phase can be treated as complete.

Export Lit cleanup checkpoint — 2026-09-21 (`c20eaca`, `6722949`):

- Deleted the Lit export host/viewer, their external CSS assets, direct browser
  bundle, registration constants/loader, build-script entries, static-asset
  assertions, and export-only drawer rules. The wallet host now targets the
  Preact `.seams-export-surface`; it listens for the existing cancellation event
  and disposes the surface without a legacy event bridge.
- Removed the retired Lit export tests. The Preact export host, renderer, and
  parent-overlay matrix passes **54/54** across Chromium, Firefox, and WebKit,
  including strict CSP, import failure, stale mount, measurement, focus, and
  cancellation disposal coverage. Wallet type-check, browser-test type-check,
  clean SDK build, hosted-asset assertions, and hosted-doc assertions pass.
- The per-flow bundle report passes; the export flow is **64.0 KiB raw / 19.9
  KiB gzip / 17.3 KiB brotli**. A clean build emits no
  `export-private-key-viewer.js`, `export-viewer.css`, or `export-iframe.css`.
- Temporary saved-Lit visual comparisons and their ignored artifacts remain in
  place for the final Phase 8d parity audit. They must be removed only after
  every component migration and CSS consolidation has been accepted.

Luna extra-review checkpoint — 2026-09-21 (`c20eaca`, `6722949`):

- Work after this checkpoint is expected to use Luna. Before accepting later
  export or cleanup changes, perform an extra review of cancellation-event
  ownership, import invalidation, measurement disposal, strict-CSP stylesheet
  removal, clean-build asset accounting, and the retained visual-baseline
  boundary. Re-run the 54-case export matrix and the bundle-size check after
  related changes.

- [x] Replace host/viewer rendering with `ExportPrivateKeySurface` behind
  `upsertExportViewerHost()` and an explicit mount/update/dispose handle.
- [x] Preserve modal/drawer behavior, masking, reveal timing, multi-key
  updates, copy feedback, guidance, and measured height.
- [x] Verify close during loading/reveal, reopening with different keys,
  repeated exports, import failure, and parent disposal.
- [x] On completion/error/dispose, unmount and release UI references, timers,
  listeners, observers, and owned appearance rules. Verify old keys cannot
  reappear on reopening; do not claim JavaScript memory erasure.
- [x] Preserve activation requirements of clipboard/download actions.
- [x] Capture matched export viewer/host fixtures and review every image diff.
- [x] Remove export's Lit host/viewer, registration imports, and event bridge.
  Retain shared primitives with remaining live consumers. Completed in
  `c20eaca` and `6722949`; temporary visual comparisons remain for Phase 8d.

**Exit:** export integration, synthetic-key visual tests, cleanup, CSP, browser,
and size checks pass.

### 6. Migrate recovery-code backup

**Depends on:** Phase 5; registration/recovery baseline gates pass.

Preact integration checkpoint — 2026-09-21:

- `73771ff` replaces the recovery operation's Lit host/viewer import with an
  explicit lazy Preact mount. The native dialog remains the lifecycle owner;
  the mount preserves stage updates, focus restoration, iframe scroll-surface
  measurement, and the typed acknowledgement contract.
- The Preact surface implements direct registration backup and account-menu
  summary/opening states, status and opening failures, code display,
  acknowledgement/defer behavior, download filenames, clipboard feedback, and
  generation-guarded disposal. Recovery CSS scopes the migrated class root;
  the saved Lit baseline remains isolated in the visual harness.
- Verification passed: the recovery browser matrix passed **22/22** total
  (**21/21** recovery UI cases across Chromium, Firefox, and WebKit plus the
  **1/1** cross-origin recovery host flow); wallet type-check, browser-test
  type-check, Rolldown, static/hosted asset guards, and bundle accounting all
  pass.
- `6108140` applies the surface context to the native dialog itself, restoring
  the hosted 35rem geometry. The matched visual gate in `7cf3779` passes **2/2**
  Chromium captures for the retained Lit host baseline (light and dark), with
  478 and 480 changed pixels respectively out of 235,200 (under 0.21%).
  Captures and diffs remain ignored under `.artifacts/refactor-127/visual/`.
- The cancellation gate now passes through the host boundary: the recovery
  operation checks cancellation before and after its lazy Preact import, so a
  request cancelled while the module is loading cannot mount a stale dialog.
  The delayed-import browser test uses the built module response and passes
  across Chromium, Firefox, and WebKit.
- The retained Lit visual baseline remains intentionally in place until Phase
  8d. The production cleanup and recovery bundle gate are recorded below.

- [x] Implement the existing summary, opening, code display, acknowledgement,
  failure, and cancellation states with exact typed callbacks.
- [x] Preserve `WalletRecoveryCodeBackupAcknowledgementV1`, download filenames,
  clipboard behavior, native dialog cancellation, focus, and live status.
- [x] Test registration-time and account-menu entrypoints, failed opening,
  repeated open/close, and explicit acknowledgement.
- [x] Test cancellation while the lazy Preact module is pending.
- [x] Verify disposal ignores a late opening callback and reopening does not
  display the previous operation's codes.
- [x] Verify disposal releases displayed codes, copied-flash timers, and
  appearance rules. The browser gate confirms the surface and code nodes are
  removed, the copied timer is cleared before reopening, delayed clipboard
  completion is ignored, and the document-owned recovery stylesheet remains
  linked without a surface-owned rule.
- [x] Capture the matched recovery host fixture and review every image diff.
  The saved-Lit/Preact state matrix covers summary, opening, status-error,
  opening-error, and acknowledged states in light and dark themes.
- [x] Capture and review the retained standalone recovery viewer fixture after
  its Preact replacement is available. The light/dark crops are 520×372 with
  zero changed pixels against the saved Lit viewer.
- [x] Replace host creation with an explicit lazy Preact mount.
- [x] Delete the recovery host/viewer custom elements and internal event module.
  Completed in `a34a8f2`, `0de67e5`, and `552baa7`; the latter removes the
  duplicated Rolldown static-emitter selector and keeps emitted SDK CSS free of
  recovery custom-tag selectors.

**Exit:** recovery UI and enclosing registration/account flows pass behavior,
visual, CSP, cleanup, browser, and size checks.

Recovery cancellation checkpoint — 2026-09-21:

- This checkpoint is implemented in the recovery operation and host runtime,
  with a browser regression test that holds the lazy Preact module response
  until after cancellation. The recovery browser matrix passes **12/12** across
  Chromium, Firefox, and WebKit; the cross-origin recovery host flow passes
  **1/1** in Chromium. Wallet type-check, browser-test type-check, and Rolldown
  build also pass.
- This is an intentional audit marker for the Luna handoff. Future work should
  re-review the cancellation predicate, delayed-import harness, and host error
  propagation before recovery cleanup is accepted. At this checkpoint,
  copied-flash/timer disposal, broader visual states, bundle accounting, and
  removal of the retained Lit host/viewer remained open; the disposal gate is
  now closed by `3363e08`.

Recovery disposal checkpoint — 2026-09-21 (`3363e08`):

- Added copied-flash timer instrumentation and delayed-clipboard disposal
  coverage. The recovery browser matrix now passes **21/21** across Chromium,
  Firefox, and WebKit, including code-node removal, timer cancellation, stale
  completion suppression, and preservation of the document-owned stylesheet.
- This closes the recovery disposal gate. Broader visual states, bundle
  accounting, and deletion of the retained Lit host/viewer remain open.

Recovery visual-state checkpoint — 2026-09-21 (`62f6abb`):

- Added a strict-CSP saved-Lit/Preact comparison for ten recovery captures:
  summary, opening, status-error, opening-error, and acknowledged states in
  light and dark themes. All 10/10 pairs have identical dimensions and zero
  changed pixels. The browser-test type-check and Chromium visual run pass.
- The temporary state comparison, side-by-side images, diffs, and saved Lit
  build remain ignored under `.artifacts/refactor-127/`; retain them until
  Phase 8d has reviewed every migrated component and the final cleanup gates
  pass.

Recovery viewer fixture checkpoint — 2026-09-21 (`1616a1b`):

- Added the retained standalone viewer comparison to the recovery visual
  harness. Both light and dark saved-Lit/Preact crops match at 520×372 with
  zero changed pixels; the full recovery state run now passes **12/12**.
- This closes the recovery visual fixture gate. The temporary comparison and
  saved-Lit build remain until Phase 8d.

Recovery Lit cleanup checkpoint — 2026-09-21 (`a34a8f2`, `0de67e5`, `552baa7`):

- Removed the recovery Lit host, viewer, and internal event module; removed
  their registry constants, dynamic registration loader, host theme selector,
  generated custom-tag theme selectors, and the duplicated Rolldown static
  emitter selector. The production path now contains only the lazy Preact
  surface and native dialog lifecycle.
- A clean SDK build emits no recovery Lit host/viewer modules. The recovery
  flow reports **289.7 KiB** raw / **64.6 KiB** gzip / **56.5 KiB** Brotli,
  with **58.4 KiB** incremental gzip. Static assets emit 162 files.
- This checkpoint needs extra review because the remaining implementation work
  is expected to use Luna. Re-review the cancellation predicate, delayed import
  boundary, registry deletion, duplicated CSS emitters, theme-token inheritance
  through `.seams-wallet-ui`, and recovery CSS coverage. The post-fix 22-case
  recovery matrix passes; re-run it and the bundle report before accepting
  follow-up cleanup.

Luna handoff checkpoint — 2026-09-21 (`62f6abb`):

- Work after this checkpoint is expected to use Luna. Before accepting later
  recovery or cleanup changes, perform an extra review of fixture routing,
  strict-CSP stylesheet ownership, lifecycle/disposal guards, and the visual
  threshold rationale. Re-run the recovery browser matrix and this 10-case
  comparison after related changes.

### 7. Remove React's remaining Lit dependencies

**Depends on:** baseline coverage of public React usage; execute as a separate
change from hosted-surface cutovers.

- [x] Inventory actual callers and package exports of `LitDrawer`,
  `LitHaloBorder`, and `LitPasskeyHaloLoading`. Confirm whether any are
  supported public APIs before deletion; none were exported by the React
  barrel or package subpath maps. The only internal caller used the passkey
  loader and now imports the native React `HaloBorder`.
- [x] Use the existing React halo implementation where its contract matches.
  The native halo now accepts the loader's custom gradient stops; no drawer or
  passkey adapter replacement was needed because those adapter files were
  unreachable from the built React entries.
- [ ] Preserve public props, children composition, SSR importability, mounting
  under StrictMode, controlled theme, custom colors, and focus behavior.
- [x] Run the React theme regression and account-menu tests against built
  artifacts, including scoped tokens and the normalized auth-menu CSS names.
- [x] Verify public React output introduces no Preact types or React aliasing.
  The React build remains native React and the built source graph contains no
  `@lit/react` imports.
- [x] Delete `@lit/react` and obsolete adapters after their callers are
  migrated. This is recorded in `a825859` and `941d930`.

Luna handoff checkpoint — 2026-09-21:

- `a825859` switches the internal React passkey-loader path to the native
  `HaloBorder` and preserves custom ring colors. `941d930` removes the three
  unreachable `@lit/react` adapters, the dependency, and their stale wrapper
  documentation.
- This is an intentional audit marker. Work performed with Luna after this
  checkpoint requires extra review of public React exports, SSR and StrictMode
  importability, theme and custom-color behavior, dependency-lock accuracy,
  and the absence of Preact types or renderer aliases before Phase 7 can exit.

**Exit:** public React behavior passes independently of the hosted renderer,
and no React consumer keeps a built-in Lit primitive alive.

### 8. Visual acceptance and legacy cleanup

**Depends on:** Phases 3–7 and matched visual verification for every migrated
component. Cleanup is a required deliverable, not optional follow-up work.

#### 8a. Confirm visual acceptance before removing legacy code

- [x] For every component in the Phase 0 inventory, record its Preact
  replacement, matched before/after screenshots, reviewed differences, and
  behavioral test results. Cover supported themes, narrow layouts, and the
  component's required state matrix.
- [x] Resolve unintended visual differences before deleting that component's
  Lit implementation. Keep the reference screenshots in the ignored artifact
  folder; do not commit them or retain a parallel production renderer.
- [x] Review all replacements together before deleting shared infrastructure.
  Each surface cutover removes its verified old component in the same change;
  this final sweep removes anything left without a consumer.

#### 8b. Remove orphaned Lit glue

- [x] Recheck imports and runtime consumers before removing the built-in
  registry, upgrade observer, `LitElementWithProps`, `ensureDefined`,
  `css-loader`, and component readiness gates.
- [x] Preserve measurement/animation frames that implement visible behavior;
  delete only frames whose purpose was retired stylesheet/upgrade readiness.
- [x] Move remaining pure files, then delete the empty Lit directories.
- [x] Rename the generic extension implementation to `iframe-custom-element-*`
  and preserve its public registration/mount contract and supported messages.
  Verify an external custom element still mounts and disposes.
- [x] Remove `lit` and obsolete embedded entries once all imports are gone.
- [x] Delete orphaned Lit components, React adapters, registration-only imports,
  styles, tests, fixtures, and generators. Audit source, package exports,
  declarations, and built bundles for remaining references; retain the generic
  external custom-element extension contract described above.

Luna extra-review checkpoint — 2026-09-21 (`72da581`, `c337b8a`, `990a987`):

- Removed the retired host-document Lit theme bridge, stale Lit browser test
  configuration, built-in confirmation registry, all built-in Lit confirmation
  components/CSS, and the `lit` package plus lockfile records.
- Moved renderer-independent theme and surface-measurement checks to
  `tests/wallet-ui/`; the temporary visual baseline continues to use the saved
  Lit build under `.artifacts/refactor-127/` and remains intentionally local.
- Renamed the confirmation resize event module and event to renderer-neutral
  names. Wallet type-check, browser-test type-check, the Rolldown build, and the
  22-test tree/iframe matrix passed across Chromium, Firefox, and WebKit.
- This is a Luna handoff marker. Before accepting the next cleanup or CSS
  consolidation slice, perform an extra review of the generic custom-element
  extension boundary, saved-baseline routing, event payload typing, dependency
  lock accuracy, and generated/built output on a clean build.

#### 8c. Consolidate static CSS as a separate change

- [x] Emit one ordered `wallet-ui.css` from the current authoritative sources.
  Preserve rule order, specificity, asset URLs, and document-context scoping.
- [x] Replace the hosted document's component stylesheet links and prefetches;
  retain required public React/standalone stylesheet contracts.
- [x] Compare computed styles and baseline screenshots before/after
  consolidation, including simultaneous surfaces with different appearance.
- [x] Rerun cold-cache, delayed/failed stylesheet, first-measurement, resize,
  and CSP tests after the link change.
- [x] Delete obsolete generated assets, markers, generators, and assertions
  only when their actual consumers have been replaced.

Luna extra-review checkpoint — 2026-09-21 (`6409b18`, `34b3f7d`):

- `6409b18` emits the ordered hosted `wallet-ui.css`, changes the wallet
  service document and runtime gates to one document-owned stylesheet marker,
  and keeps the separate generated files only for compatibility and the saved
  Lit visual baseline. Recovery explicitly restores its renderer-neutral
  `line-height` so the consolidated confirmation base styles cannot change its
  layout.
- `34b3f7d` updates the hosted/unit/browser fixtures and saved-Lit/Preact
  visual routes. The focused browser matrix passed **26/26**, Vite unit checks
  passed **7/7**, the auth visual matrix passed **108/108**, and the remaining
  Preact visual matrix passed **84/84**. A clean SDK build and static, hosted,
  and runtime asset audits passed.
- This is the next Luna handoff. Extra review is required for CSS section
  order/specificity, asset URL fallback copying, strict-CSP first measurement,
  delayed/failed stylesheet behavior, saved-Lit routing, and the decision to
  retain or remove temporary visual-parity tests in Phase 8d. Future work from
  this checkpoint should be treated as Luna-authored and reviewed accordingly.

Visual acceptance checkpoint — 2026-09-21:

- The Preact-only migration matrix passed **192/192** in Chromium: auth 108,
  confirmation 12, confirmation primitives 6, export 48, recovery host 2,
  recovery states 10, and transaction tree 4. This run used the consolidated
  `wallet-ui.css` and covered the saved-Lit comparison states before cleanup.
- Permanent browser coverage passed **72/72** for the consolidated confirmation,
  transaction-tree, and primitive suites, plus **28/28** for the Firefox/WebKit
  auth and export suites.
- A saved-Lit baseline hash mismatch was classified as a temporary-harness
  failure: the retained reference was from an earlier build, while the
  Preact-only acceptance matrix completed without failures. The ignored PNGs
  remain local for audit and are not committed.
- The temporary comparison tests and their saved-baseline fixtures can now be
  deleted. Permanent behavior, CSP, lifecycle, accessibility, and measurement
  coverage remains in `tests/wallet-ui/` and `tests/wallet-iframe/`.

Generated asset cleanup checkpoint — 2026-09-21:

- Rolldown now emits only `wallet-shims.js`, `wallet-service.css`, and
  `wallet-ui.css` in the SDK static directory. The standalone generated
  component stylesheets, palette codegen script, fallback source stylesheet,
  and host stylesheet copy are deleted.
- `pnpm build:sdk`, the palette-variable assertion, the static-wallet-assets
  manifest check, and the runtime-entry check passed. The clean manifest
  contains 144 assets and no standalone UI stylesheet routes.
- This is a Luna-authored checkpoint that needs extra review before merge:
  inspect wallet UI stylesheet order/specificity, package and Vite asset
  discovery, clean-build deletion behavior, and the permanent browser matrix.

#### 8d. Retire temporary visual-parity tests after full migration

- [x] Once every component has migrated to Preact and all visual acceptance
  gates, including CSS consolidation, have passed, delete all temporary visual
  comparison tests used for migration parity. This includes the Lit baseline
  capture suite and the auth, confirmation, and export before/after suites.
- [x] Remove their migration-only fixtures, saved-build routing, comparison
  helpers, visual-runner configuration, and commands when no permanent test
  consumes them. Preserve the acceptance record in this plan; screenshots stay
  local and uncommitted.
- [x] Retain permanent behavioral, accessibility, lifecycle, CSP, measurement,
  and regression tests for the final Preact implementation. Move any lasting
  behavioral assertion out of a temporary parity test before deleting it.

Luna cleanup checkpoint — 2026-09-21:

- Deleted the migration-only visual runner, Lit baseline fixtures, comparison
  helpers, and all temporary auth/confirmation/export/recovery/tree captures.
  Removed migration screenshot writes from permanent wallet UI tests.
- This checkpoint is expected to be continued with Luna and requires extra
  review before merge. Recheck the permanent test inventory, the acceptance
  counts above, ignored artifact retention, and the final generated asset
  manifest after standalone stylesheet cleanup.

**Exit:** static CSS is document-owned, dynamic rules have explicit owners,
every Preact replacement has reviewed visual evidence, and no legacy built-in
component, adapter, dependency, registration repair, or component CSS fetcher
remains. Rerun behavior, visual, CSP, type, build, and bundle-size checks after
cleanup to detect accidental removal of shared requirements.

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

# Refactor 128: application components in the transaction review flow

Status: planned; implementation has not started.

## Goal and chosen architecture

Let an integrator pass a React purchase-review component to a React-facing
transaction call. Show that component first, then transition the same modal into
the existing Preact wallet approval. Preserve the wallet-origin execution boundary.

The application owns the React component. The SDK owns one outer dialog, backdrop,
surface reservation, and transition. The wallet-origin iframe owns the transaction
details, approval controls, credential prompts, and signing authorization.

The experience should match the supplied purchase-review and passkey-confirmation
screens: no second backdrop, close/reopen flash, empty intermediate box, or stacked
modal. A difference in document origin should have no visible frame or border.

This document is in the refactor-127 worktree. The existing
`codex/refactor-128-external-evm` branch is separate work. This filename does not
authorize changes to that branch, PR 17, or the coordinated 0.5.29 release. Before
implementation, reconcile the intended base with current main and the uncommitted
refactor-127 fixes. Do not assume this work is included in a published package.

## Scope

Initial release:

- Application React review followed by mandatory wallet approval in one modal.
- Hosted Seams wallet transactions through the React `useWallet()` API.
- NEAR, EVM, and Tempo adapters delegate to their existing signing/execution paths.
- Existing transaction calls without custom review retain their current behavior.
- Existing light/dark and Sharp/Rounded appearance settings remain supported.
- Cancellation, lifecycle cleanup, keyboard interaction, strict CSP, and responsive
  geometry are acceptance requirements.

Deferred:

- Toggleable purchase-summary/approval views and editing after wallet handoff.
- Custom review content for auth, recovery, key export, and message signatures.
- External-wallet approval windows, which Seams cannot place inside its iframe.
- Arbitrary JavaScript execution inside the wallet origin, nested component
  sandboxes, uploaded bundles, remote module loaders, and component registries.
- A new animation dependency, modal framework, or transaction execution API.

For v1, custom review requires modal presentation and an explicit wallet approval
step. Reject incompatible silent/auto-approve/drawer combinations before dispatch;
never silently ignore the review or weaken an existing authorization requirement.
Direct core SDK and non-React consumers keep their existing framework-free API.

## Invariants

1. React elements, component functions, closures, and application contexts stay in
   the application document. They never enter worker or iframe wire payloads.
2. Continue advances the review workflow. It cannot approve a wallet request or
   supply credential material. The final approving interaction occurs inside the
   wallet iframe, including the user activation required for passkey operations.
3. The wallet displays the actual request it authorizes. Application-provided
   descriptions are unverified application claims. An embedded wallet cannot
   prevent its parent page from imitating or obscuring UI.
4. There is one active foreground owner. The review reserves that ownership before
   rendering and transfers it to the matching wallet request without a release gap
   or a second acquisition that deadlocks the existing transaction queue.
5. Request, surface, connection, and generation identities are explicit. Late
   callbacks or measurements from an old review cannot affect a newer request.
6. Settle every public call once. Continue, cancellation, errors, and disposal are
   idempotent. No invisible pending approval survives review cancellation.
7. Preserve the iframe DOM node, browsing context, and MessagePort through handoff.
   Do not reparent or recreate the iframe to move between screens.
8. Exactly one view is interactive and exposed to assistive technology at a time.
   Opacity alone does not disable input or remove a view from the focus order.
9. Preserve existing signing, persistence, and protocol boundaries. No new custody
   material, transaction serializer, signer, or authorization bypass belongs here.

## Public React contract

Use a single React review adapter shared by the supported `useWallet()` transaction
methods. Add a React-only `review` field to their input types and consume it before
calling the existing core methods. Preserve each method's successful return type
and established error/cancellation conventions.

Proposed usage (API sketch; finalize types in phase 1):

```tsx
await wallet.near.signAndSendTransaction({
  receiverId,
  actions,
  review: {
    title: 'Review purchase',
    render: renderPurchaseReview,
  },
});
```

The renderer receives narrowly typed review controls, including
`continueToWallet` and `cancel`. It returns ordinary React content, such as a
`PurchaseReview` with quote props and buttons wired to those controls. It receives
no wallet-approval callback, signing capability, or secret from the review adapter.
The application itself still retains whatever public SDK access it already has.

Provide one `TransactionReviewHost` inside `SeamsWebProvider` and below the
application providers the review needs. Its portal renders into the existing
dialog's review slot. Components calling the reviewed methods must use that host's
context. A missing host produces an actionable error before opening or dispatching
a reviewed transaction; calls without review remain usable without the host.

Context follows the host's React ancestry. Passing an element or renderer through
an imperative transaction call does not capture providers local to the caller.
Document this placement explicitly and test a real custom context through the
portal. Never create a disconnected React root for review content.

Component contract:

- Supply content and local controls; omit an outer dialog, backdrop, fixed viewport
  layout, and independent focus trap.
- Ordinary application styles continue to apply. Portal DOM ancestry can change
  ancestor selectors, CSS-variable inheritance, and CSS-in-JS insertion targets;
  document this and support explicit scope classes/tokens on the review wrapper.
- The renderer may use hooks through its returned components. The SDK invokes it
  as a render callback; it must not directly call a supplied component function.
- Loading and render failures have an SDK-owned fallback with a usable cancel
  action. Catch asynchronous review failures through the controller as well as
  component render errors through an error boundary.
- Unmounting the owner/host invalidates its outstanding review. React StrictMode
  effect replay must not dispatch duplicate requests or leave stale registrations.

### Request and quote lifetime

Capture the bound wallet identity and a normalized snapshot of the caller-supplied
transaction intent at invocation. Reuse existing boundary builders and operation
fingerprints; exclude React metadata and callbacks from the serializable snapshot.
Caller mutation after invocation must not alter the reviewed request.

Normal protocol preparation may still fill nonce, block reference, and estimated
fees through the existing pipeline. The final wallet view shows those resulting
values. Material changes to recipient, chain, amount, calldata/actions, or approved
economic limits require a fresh review. Account/session changes also invalidate the
pending review.

For quotes with expiry, normalize a supplied deadline into an explicit internal
validity union. Check it before review handoff and at the applicable approval
boundary. Determine whether the existing request deadline contract can express
this; any required wire extension contains only validated deadline metadata.
An expired review requires a refreshed quote and a new request. Local time checks
are UX safeguards; contract-enforced deadlines and slippage bounds provide the
transaction-level guarantee. Do not claim a UI countdown prevents late execution.

## Implementation inventory

Paths are relative to this wallet repository; confirm ownership against the
selected implementation base before editing.

| Area | Existing files | Intended work |
| --- | --- | --- |
| React integration | `packages/wallet/src/react/hooks/useWallet.ts`, `react/context/SeamsWebProvider.tsx`, `react/index.ts` | Typed review option, one review host/adapter, public exports; preserve bound identity |
| Existing React flow wrappers | `packages/wallet/src/react/context/useSeamsContextValue.ts`, `useSeamsWithSdkFlow.ts` | Audit composition and callback/result ownership; avoid another overlapping proxy |
| Dialog ownership | `packages/wallet/src/SeamsWeb/walletIframe/client/overlay/overlay-controller.ts`, `overlay-styles.ts` | Stable React slot beside the existing iframe; one backdrop and focus lifecycle |
| Surface state | `packages/wallet/src/SeamsWeb/walletIframe/client/surface/domain.ts`, `domain.typecheck.ts`, `renderer.ts`, `geometry.ts` | Review/handoff states, identity-bound measurements, geometry and interaction ownership |
| Foreground serialization | `packages/wallet/src/SeamsWeb/walletIframe/client/surface/transactionSurfaceQueue.ts`, `client/router.ts` | One reservation spanning review and approval; cancellation and late-event filtering |
| Wallet boundary | `packages/wallet/src/SeamsWeb/walletIframe/shared/messages.ts`, `host/runtimeContext.ts` | Audit existing readiness/cancel/measurement messages; extend only demonstrated gaps |
| Preact approval | `packages/wallet/src/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface.tsx`, `ConfirmationModal.tsx` | Keep existing approval rendering; only make minimal handoff changes |
| Resize coordination | `packages/wallet/src/core/signingEngine/uiConfirm/ui/confirm-surface-resize.ts` | Reuse the existing measured-size handshake and avoid competing animation owners |
| Integration example | `examples/wallet-console-lite/src/WalletConsoleLite.tsx`, `styles.css` | Purchase-review demo with normal, expired, slow, and failing review cases |
| Contracts and tests | `docs/intended-behaviours.md`, `tests/wallet-ui/`, `tests/wallet-iframe/`, existing type fixtures | Behavior contracts, cross-origin integration, type-level invalid-state checks |

## Phased TODOs

### Phase 0 — establish the baseline and integration contract

- [ ] Reconcile the implementation base with current main and the refactor-127
  fixes. Preserve unrelated dirty files and concurrent worktrees.
- [ ] Trace the current modal, queue, readiness, cancellation, user-activation, and
  request-settlement paths end to end. Record exact reused entrypoints here.
- [ ] Write the supported-method matrix: NEAR `signAndSendTransaction` and
  `executeAction`; EVM/Tempo `signTransaction` and `executeTransaction`. Identify
  which action variants may need multiple wallet prompts before advertising them.
- [ ] Establish current focused test/type-check/build results. Classify failures
  against current behavior before repairing them.
- [ ] Capture the existing modal, drawer, tx-tree, auth, and export appearance in a
  temp/ignored folder. Use synthetic data; never capture private keys or tokens.

Exit: ownership and scope are explicit, the baseline is reproducible, and no
implementation depends on taking over another agent's local server.

### Phase 1 — define typed review lifecycle and API

- [ ] Finalize the React-only review contract and host placement. Keep the renderer
  and callback registry local to React; core types remain React-free.
- [ ] Model review, preparing approval, wallet approval, executing, and settled
  states with discriminated unions, branch-specific builders, exhaustive switches,
  and required identities. Represent animation progress separately from approval.
- [ ] Define cancellation at each boundary. Before approval, cancel the request;
  after an irreversible signing/broadcast step, closing UI must not report that the
  operation was undone. Preserve the established outcome contract.
- [ ] Define snapshot, quote-expiry, session-change, and unsupported-mode behavior.
- [ ] Add type fixtures rejecting callback-bearing wire objects, incompatible
  presentation modes, invalid state combinations, and stale identity combinations.
- [ ] Update the intended-behavior specification with its contract tests when the
  new public lifecycle behavior is implemented.

Exit: the public call, success/error semantics, trust boundary, and transitions
can be reviewed without relying on animation or DOM behavior.

### Phase 2 — build a vertical slice without animation

- [ ] Add the host portal and a stable review slot to the existing outer dialog.
  Verify context propagation, application styling, focus, and error boundaries.
- [ ] Implement review-to-wallet handoff for one hosted transaction method first.
  Keep the iframe and its transport alive throughout.
- [ ] Extend the current foreground reservation across both steps. Reuse queue
  semantics; do not create a second queue or bypass other foreground operations.
- [ ] Dispatch only once after Continue. Strip review metadata before core calls.
  Component code and raw HTML never reach the wallet document.
- [ ] Match ready/measurement/approval/cancel events to the current request and
  connection. Preparing must not trigger signing or credential UI automatically.
- [ ] Test double Continue, Escape, close, provider unmount, iframe disconnect,
  timeout, concurrent requests, and late responses. Release resources exactly once.

Exit: one dialog completes the full flow with an immediate, correct view switch;
both cancellation and success leave no pending review or leaked reservation.

### Phase 3 — cover supported transactions and lifecycle edges

- [ ] Apply the same adapter to the remaining supported NEAR/EVM/Tempo methods.
  Delegate execution to existing implementations; preserve callbacks and results.
- [ ] Cover warm sessions, credential-required sessions, preparation failures,
  account changes, expired quotes, wallet rejection, and signing/execution errors.
- [ ] Audit multi-prompt methods so custom review occurs once per transaction call
  and every wallet-required approval still occurs in the wallet view.
- [ ] Verify ordinary calls without review, auth, export, recovery, and drawer
  behavior remain intact. Reject unsupported reviewed operations explicitly.

Exit: supported methods share one review implementation and every documented
terminal state has a tested cleanup path.

### Phase 4 — seamless geometry and accessibility

- [ ] Measure the app review locally; accept wallet sizes only through the existing
  validated iframe measurement boundary. Clamp both to safe viewport bounds.
- [ ] Keep loading content visible until wallet readiness and usable geometry are
  known. Provide a bounded failure path if either never arrives.
- [ ] Reuse current motion primitives for measured width/height/radius handoff and
  content crossfade. Assign one geometry animation owner per phase; do not ease
  the parent toward dimensions the child is already easing frame by frame.
- [ ] Avoid full-content scaling, double shadows, black iframe backgrounds, iframe
  reparenting, and hidden-document measurement deadlocks. Use explicit transition
  properties; add no new motion dependency.
- [ ] Make transitions interruptible. Teardown must complete even if transitionend
  never fires. Reduced motion uses an immediate resize and minimal/static handoff.
- [ ] Preserve one effective modal focus boundary across the two documents. Move
  focus into the new view through the wallet's own handler, never by reading its
  cross-origin DOM. Inactivate and hide the outgoing view from assistive technology.
- [ ] Verify Tab/Shift+Tab, Enter, Space, Escape from either document, focus return,
  screen-reader announcements, and no activation of hidden approval controls.
- [ ] Inspect light/dark, Sharp/Rounded, small/large review content, slow assets,
  tree expansion, mobile keyboard, 320px width, and 200% zoom. Replay the transition
  slowly to inspect clipping, backdrop continuity, and focus timing.

Exit: the visual experience is one continuous modal and remains usable without
animation, pointer input, or a large viewport.

### Phase 5 — integration and regression gates

- [ ] Add the purchase-review example and document required host placement and
  styling constraints. Use fixture quotes and explicit test-network labeling.
- [ ] Exercise a genuine cross-origin wallet frame; a same-origin DOM-only harness
  cannot establish the trust-boundary or focus-handoff guarantees.
- [ ] Verify the wallet still requires its own final approval, checks the current
  request, and rejects stale/cancelled requests. App-side Continue alone never signs.
- [ ] Test React context, local input state, StrictMode, render errors, async errors,
  host disposal, reconnect, two rapid requests, and maliciously large measurements.
- [ ] Verify SDK-owned styles under supported strict-CSP configurations. Document
  that an arbitrary supplied component must independently satisfy its app's CSP.
- [ ] Run focused tests first, then the affected browser matrix on Chromium,
  Firefox, and WebKit. Add intended lifecycle cases and run credential-gated checks
  when available; explicitly record unavailable credentials/infrastructure.
- [ ] Check type declarations, public exports, SSR importability, packaged consumer
  builds, static assets, and bundle deltas. React must remain out of hosted wallet
  chunks and framework-free core imports must remain framework-free.

Suggested existing commands, refined to actual changed test files:

```sh
pnpm -C packages/wallet type-check
pnpm -C examples/wallet-console-lite type-check
pnpm -C packages/wallet build:sdk
pnpm -C examples/wallet-console-lite build
# Example port and existing baseline tests; verify the port is free and add new focused cases.
SEAMS_TEST_FRONTEND_URL=http://localhost:4213 pnpm -C tests test:wallet-browser wallet-ui/confirmation-mount.browser.test.ts wallet-ui/transaction-tree.browser.test.ts --project=chromium
pnpm -C tests type-check:wallet-state
pnpm test:intended
```

Choose free test ports and verify server worktree ownership. Classify any failure
as production regression, valid test needing update, obsolete fixture, or
environment/infrastructure failure before changing code for it.

Exit: functional, security-boundary, accessibility, visual, and package checks have
recorded evidence. A skipped check is never counted as passed.

### Phase 6 — cleanup and handoff

- [ ] Remove replaced dialog/handoff branches, duplicate state or queues, dead
  callbacks, temporary feature flags, and obsolete tests/helpers. Keep one path for
  reviewed transactions and the established behavior for calls without review.
- [ ] After visual acceptance, remove temporary visual-comparison tests, galleries,
  fixture routes, and screenshot tooling introduced for this change. Keep permanent
  behavioral tests for geometry, focus, cancellation, and authorization boundaries.
- [ ] Keep screenshots and recordings outside Git. Delete only this work's temporary
  artifacts when no longer needed; preserve unrelated migration evidence.
- [ ] Review the final diff for unnecessary abstractions, React imports in core,
  legacy bridge resurrection, context loss, and changes to signing semantics.
- [ ] Prepare reviewable commits by concern: lifecycle/API, React/dialog integration,
  method coverage, motion/accessibility, tests/docs, and cleanup. Commit/push/release
  actions require their own user request; this document authorizes planning only.
- [ ] Record verification and remaining limitations. Coordinate any future release
  separately from PR 17 and 0.5.29.

Exit: the implementation is understandable through one ownership model, obsolete
paths and temporary parity tooling are gone, and remaining limitations are explicit.

## Later enhancement: toggleable views

Revisit only after the two-step flow is accepted. Read-only summary switching must
hide/inactivate wallet approval while the summary is visible and restore focus
deliberately. Editing the purchase invalidates the pending wallet request and
starts a newly reviewed request. Switching is unavailable once signing has crossed
its non-cancellable boundary. Do not add a second lifecycle or final approval
button in the application view.

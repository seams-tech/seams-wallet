# Refactor 140: application components in the transaction review flow

Status: implemented in `codex/refactor-140-custom-components`, based on checkpoint
`55f091d`. The explicit React host, all six bound transaction adapters, shared FIFO
reservation, wallet activation/admission, expiry and disposal paths are connected
and exported. Consumer setup is in [transaction-review.md](transaction-review.md).
Credential-backed intended contracts and release checks are recorded below.

## Goal and chosen architecture

Let an integrator pass a React purchase-review component to a React-facing
transaction call. Show that component first, then transition the same modal into
the existing Preact wallet approval. Preserve the wallet-origin execution boundary.

The application owns the React component. The SDK owns one outer dialog, backdrop,
surface reservation, and transition. The wallet-origin iframe owns the transaction
details, approval controls, credential prompts, and signing authorization.

The experience should present purchase review and wallet confirmation as one
continuous modal: no second backdrop, close/reopen flash, empty intermediate box,
or stacked modal. A difference in document origin should have no visible frame
or border. Visual acceptance uses the criteria below; no external mockup is needed.

The inspected wallet checkout is clean on `dev` at `3f382bf`, including transaction
receipt/toast behavior; its package manifest is `0.5.30`. These are local baseline
facts, not evidence of publication. Start implementation from this revision or a
descendant containing these changes. Recheck HEAD and dirty files before editing;
preserve concurrent work. Historical references to the refactor-127 dirty fixes,
the transaction-receipt worktree, PR 17, and the 0.5.29 release are superseded for
this plan. No commit, push, release, or changes to another checkout are authorized
by this document.

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

Public usage:

```tsx
await wallet.near.signAndSendTransaction({
  receiverId,
  actions,
  review: {
    title: 'Review purchase',
    render: renderPurchaseReview,
    validity: { kind: 'expires_at', atMs: quote.expiresAtMs },
  },
});
```

Export these React-only types and `TransactionReviewHost` from `@seams/wallet/react`:

```tsx
type TransactionReviewValidity =
  | { readonly kind: 'unbounded'; readonly atMs?: never }
  | { readonly kind: 'expires_at'; readonly atMs: number };

type TransactionReviewControls = {
  readonly continueToWallet: () => void;
  readonly cancel: () => void;
  readonly fail: (error: unknown) => void;
};

type TransactionReview = {
  readonly title: string;
  readonly validity: TransactionReviewValidity;
  readonly render: (controls: TransactionReviewControls) => React.ReactNode;
  readonly className?: string;
};
```

`review` is optional because ordinary calls remain supported. Within a reviewed
call, title, render, and validity are required. A nonempty title and a positive
safe-integer Unix timestamp in milliseconds are validated before opening UI.
Use `unbounded` explicitly for transactions without quote expiry. `className`
scopes application styles on the review wrapper; use the existing theme/token
mechanism rather than adding another token configuration object.

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

The host is an explicit wrapper, with `children: React.ReactNode`; it is not
automatically inserted by `SeamsWebProvider`:

```tsx
<SeamsWebProvider config={config}>
  <PurchaseContext.Provider value={purchaseContext}>
    <TransactionReviewHost>
      <Checkout />
    </TransactionReviewHost>
  </PurchaseContext.Provider>
</SeamsWebProvider>
```

One host may register per SDK/router instance. Reject a second live registration
with an actionable error, including nested hosts; independent SDK instances may
have independent hosts. The owner is the `useWallet()` hook instance that created
the bound method. Its disposal cancels its queued or pre-signing calls. The host
owns portal rendering, and its disposal invalidates all its outstanding calls.
Use generation-bound registrations and defer effect-disposal confirmation until
the next microtask so StrictMode setup/cleanup/setup retains the live owner.
Calls through a disposed bound method fail before opening UI.

Controls are stable for one request. Continue synchronously leaves `reviewing`,
disables its controls, and begins handoff once. Later invocations, including stale
Cancel or fail callbacks after handoff, do nothing. `fail` normalizes an async
failure into the same SDK error fallback used by the render boundary. Support
`React.lazy`/Suspense with SDK loading content and a cancel action. Never invoke
an async renderer or await arbitrary component return values. Applications report
event-handler/fetch failures with `fail`; an error boundary cannot intercept them.
Render/fail errors show the fallback until dismissal, expiry, or disposal; dismissal
settles with the stored failure. Retry requires a new transaction call.

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
Caller mutation after invocation must not alter the reviewed request. Complete
the copy synchronously before the first await: copy nested action/call arrays,
plain argument objects, and byte buffers using the existing boundary encoding
semantics. Separate callbacks, abort probes, and React content from data; JSON
round-tripping the whole input is forbidden. Resolve chain selectors and effective
configuration once before showing review. Freeze ordinary internal records and
keep copied byte buffers private. Do not give the renderer mutable snapshot data.

Reuse `toActionArgsWasm` and existing chain-target/request boundary builders at
their established boundaries. Existing nonce-operation fingerprints include
prepared protocol data and are not a universal review-intent fingerprint. Do not
add a second transaction serializer or require a new digest for review. Retaining
one private normalized intent and passing it to existing preparation is sufficient;
test mutation of nested data and protocol preparation separately. Application
closures can still display changing claims; the SDK does not certify those claims.

Normal protocol preparation may still fill nonce, block reference, and estimated
fees through the existing pipeline. The final wallet view shows those resulting
values. Material changes to recipient, chain, amount, calldata/actions, or approved
economic limits require a fresh review. Account/session changes also invalidate the
pending review.

Bind wallet/account plus router connection and local session generation before
review becomes visible. Capture the exact session identity from
`shared/exactSessionState.ts` when available; represent absence explicitly for
credential-required wallets. Recheck after queue acquisition and immediately
before dispatch. Wallet/account selection changes, explicit lock/logout, exact
session expiry/replacement, and reconnect invalidate queued/reviewing calls even
if the wallet id later returns to the same value. Do not silently rebind.
After handoff, request-owned credential step-up may establish its required signing
session; that transition is admitted only for the active request. Unrelated
identity/session replacement still cancels before signing. Observe authoritative
session state and request ownership, never diagnostic event text.

For quotes with expiry, use the validity union above. Check at invocation, queue
grant, Continue, and inside the wallet immediately before entering signing. Recheck
after credential acquisition. If a composed call requires later signatures, check
before each one; expiry prevents additional signatures and preserves any already
completed work in the existing core failure outcome. Expiry is
`Date.now() >= atMs`. While queued/reviewing, a deadline timer settles and cleans up
the request; after dispatch it requests host cancellation and waits for arbitration.
Recheck on document visibility restoration. Before signing,
wallet expiry cancels pending approval and credential work through existing probes.
Once a signing step starts, expiry does not cancel that step or suppress its real
result. Long deadlines use capped/rescheduled timers; transport progress never
extends quote validity.

Router transport timeouts begin at dispatch today and are distinct from quote
validity. Add validated serializable review validity to the reviewed transaction
wire branch and retain it in host request context; ordinary requests keep their
existing branch. This metadata contains no React values or caller functions.
All relevant transaction handlers enforce it through one shared host admission
check. Reject a malformed reviewed branch before execution. The API defines an
approval deadline, not a guarantee about the eventual execution time.
An expired review requires a refreshed quote and a new request. Local time checks
are UX safeguards; contract-enforced deadlines and slippage bounds provide the
transaction-level guarantee. Do not claim a UI countdown prevents late execution.

## Implementation inventory

### Supported methods and result ownership

| React method | Reviewed unit | Success and terminal core outcomes |
| --- | --- | --- |
| `near.signAndSendTransaction` | One transaction, one receiver, existing `ActionArgs[]` | Preserve `ActionResult` and existing rejection behavior |
| `near.executeAction` | One transaction, one receiver; normalize a single action to an array | Preserve `ActionResult`, including `success: false`, and `afterCall` behavior |
| `evm.signTransaction` | One EIP-1559 request | Preserve `EvmSignedResult`; no broadcast or execution receipt is added |
| `tempo.signTransaction` | One EIP-2718 request, including its calls | Preserve `TempoSignedResult`; no broadcast or execution receipt is added |
| `evm.executeTransaction` | One existing sign/broadcast/finalization operation | Preserve `ExecuteEvmFamilyTransactionResult`, lifecycle callbacks, and finalization hooks |
| `tempo.executeTransaction` | One existing sign/broadcast/finalization operation | Same ownership as EVM execution, using the existing Tempo pipeline |

All currently accepted public NEAR `ActionArgs` variants remain accepted: account
creation, contract/global-contract deployment and selection, function call,
transfer, stake, key addition/deletion, and account deletion. The inspected public
`ActionArgs` union excludes signed delegates; those exist in the internal WASM
action union. This adapter preserves the public union without adding a new action
or delegate-signing API.
The current NEAR implementation signs one transaction for the whole action array;
review does not add per-action prompts. Wallet-required credential/authorization
prompts remain intact. Tempo multicall likewise gets one application review.
Do not add review support to the separate delegate-signing API, message signing,
fee-token preference mutation, or external-wallet adapters.

Reviewed input types distribute over existing method branches. They narrow explicit
confirmation overrides to modal/requireClick. At runtime resolve the existing
per-call override over stored/default preferences, reject an effective `none`,
`drawer`, or `skipClick`, then pin modal/requireClick for this request. Validate
before showing review and revalidate at the wallet boundary. Changes to defaults
afterward do not change the captured configuration. JavaScript callers receive
the same validation as TypeScript callers. No configuration is silently upgraded.

Adapter failures before core dispatch reject the returned Promise for all six
methods, including `executeAction`. Export `TransactionReviewError` with a `code`
union: `cancelled`, `review_expired`, `review_invalid_input`,
`review_host_unavailable`, `review_owner_disposed`, `review_unsupported_mode`,
`review_identity_changed`, `review_render_failed`, and `review_prepare_timeout`.
Retain the existing router busy/connection error types. Pre-dispatch failures emit
no signing lifecycle events and invoke no core callbacks: core has not started.
Document this distinction from `executeAction`'s core `success: false` result.
After dispatch, forward the core outcome and callbacks unchanged; the adapter
never synthesizes duplicate `onError`, `afterCall`, or finalization notifications.
Host-side review expiry uses `review_expired` through existing wire error mapping;
preserve that code in methods that reject, and existing failure-result semantics
where applicable. Add no new signing-event vocabulary for the app review.

### Reservation, lifecycle, and cancellation

Reuse the router's `WalletIframeTransactionSurfaceQueue`, request-id allocation,
surface reducer, and pending-request cleanup. Add internal branch-specific
reservation/dispatch entrypoints accessible to the React adapter through the
existing SDK assembly; keep them out of the public core API. Pass an explicit
request-local reservation through the existing transaction implementation into
`post()`. Avoid ambient flags, proxy interception, or a second queue.

Admission order is: snapshot input and bound wallet/account plus local owner/session
generation, validate owner and raw options, initialize the iframe connection without
opening approval, reject any identity change during initialization, resolve effective
configuration and exact session binding, allocate a
request identity, acquire the FIFO transaction lease, recheck validity/identity,
then claim the foreground surface and render review. Waiting calls render nothing.
An existing non-transaction foreground surface rejects admission with the current
busy error. Auth/export attempts during review receive that same busy behavior.
Receipt replacement follows the rule below. A cancelled waiter is removed from
the queue before it can be granted a surface.

The reservation owns call id, request/surface identity, connection, owner generation,
session binding, validity, and the lease. `post()` either acquires its ordinary
lease or consumes the matching reserved lease, never both. Validate identity and
connection before consumption. The reducer has an explicit review-to-wallet
transition for the same identity; ordinary start events cannot steal ownership.
Retain ownership across any request-owned credential or subsequent approval step.
If an existing composed method issues multiple RPCs, map their request identities
to the same owning call, sequentially, and return lease ownership to that call
between RPCs. Release exactly once when its foreground workflow ends; permit no
unrelated RPC to consume that reservation. Test the composed execute paths.

Lifecycle branches are `queued`, `reviewing`, `review_failed`, `preparing_approval`,
`wallet_approval`, `signing`, `executing`, and `settled`. Builders require only
identities/resources valid in that branch; animation state is separate. The host
owns the authoritative pre-signing/signing transition and cancellation arbitration.
Add a validated request-scoped phase/cancel acknowledgement only where existing
messages cannot convey that decision. UI close must not settle a dispatched call
as cancelled merely because a cancel message was sent.
The current host `PM_CANCEL` path marks cancellation and closes confirmers without
phase arbitration; update this path for reviewed requests. Its generic PONG is
not an acknowledgement that signing was prevented. Scope cancellation to the
matching request so delayed cancels cannot close a later request's confirmer.
Use a 30-second cancellation-acknowledgement bound; if no authoritative outcome
arrives, reject with the existing transport timeout error and clean up local
ownership. This is an unknown operation outcome, never proof of cancellation.

| Boundary | Close, Escape, disposal, or cancellation | Public settlement |
| --- | --- | --- |
| Queued or reviewing | Remove waiter/review; release owned resources | Reject with the adapter error code |
| Review failed | Dismiss SDK fallback; never dispatch | Reject stored `review_render_failed` |
| Preparing or wallet approval, including credential acquisition | Host arbitrates cancellation before signing, aborts approval/credential work, and acknowledges | Preserve core cancellation convention after acknowledgement |
| Signing started, including sign-only calls | Detach application review resources; close/minimize UI where existing wallet behavior permits; do not cancel signing | Await actual core outcome |
| Broadcast/finalization | Preserve existing receipt/toast and operation tracking | Await actual core outcome |
| Connection lost after dispatch | Existing transport failure and cleanup; no automatic retry | Preserve connection error; never claim signing/broadcast was undone |
| Settled or stale callback | No effect on this or any newer call | No second settlement |

Continue versus review cancellation is decided by the first synchronous controller
transition. Approval versus cancel/expiry is decided by the host before the signing
transition; receipt or diagnostic events cannot make that decision. An unmounted
host does not orphan a dispatched operation: core/router retain settlement ownership.
After signing begins, later prompts for the same composed operation keep their
existing core cancellation semantics; do not claim earlier work was rolled back.

### Receipt coexistence

Preserve current `TRANSACTION_ACTIVITY` and `PM_SET_TRANSACTION_VIEW` behavior.
Executing transactions may retain an expanded receipt after their Promise settles
and collapse to a toast on close. Sign-only methods do not gain an execution receipt.
Dispose React review content at handoff completion; remove its registry on terminal
settlement. Receipt ownership remains in the existing wallet/router implementation.

Release the call's queue lease when the core call settles; an existing receipt is
replaceable presentation, not an active signing reservation. When the next call
wins admission, close the previous receipt/toast by its exact request id and claim
the new review surface in one renderer update. Do not render an intermediate hidden
dialog. Late receipt measurements/activity cannot reopen or resize the new review.
Retain existing call-start replacement behavior for ordinary transactions.

### Handoff readiness and visual acceptance

`READY` establishes transport availability only. `SURFACE_MEASUREMENT` provides
validated request geometry; it does not prove approval is interactive. Extend the
existing surface protocol with request-scoped prepared/activate/activated states
where no equivalent exists. Include connection binding, request/surface identity,
and handoff generation, validated at the message boundary. No callback crosses it.

The wallet prepares its confirmation inert and without credential requests, reports
prepared after required UI styles/content are ready, and reports a valid measurement.
The parent retains visible SDK loading content until both are known, then
inactivates review and crossfades to the inert wallet view. At fade completion
(or its timer fallback), it hides review and requests wallet activation. Reduced
motion performs this handoff immediately. The wallet enables its visible view,
focuses its own initial control,
and acknowledges activation. Preparing may expose a credential-required view first,
but initiating credentials still requires its wallet-origin button. Never require
credentials to obtain the first usable prepared view. Loading and the wallet view
must not be simultaneously interactive; no hidden approval control accepts activation.
Forward Escape from the wallet to the existing close owner. Use existing focus
behavior when sufficient; add only the missing identity-bound handshake. The outer
dialog supplies the single modal boundary and returns focus to the original trigger.

Preparation has a 30-second bound from Continue, including activation acknowledgement,
shortened by quote expiry. Transport initialization uses existing connection timeout
behavior. Preparation timeout cancels through host arbitration and cleans up; if
signing has already won the race, preserve the signing outcome instead. Reading
time in a ready review is unbounded unless the quote expires. A suspended review
uses the same 30-second loading bound, which ends when its content commits.

Use existing motion duration/easing, geometry clamps, and CSP stylesheet manager.
Do not invent dimensions or timings for pixel parity. No reference screenshots are
attached to this plan; the current modal and purchase demo establish the baseline.
Required visual evidence: one continuous backdrop, no empty intermediate paint,
no iframe reload/reparent, no duplicate shadow, and no clipped controls at 320px
width or 200% zoom. Content exceeding viewport limits scrolls within the active
view. Reduced motion skips geometry interpolation. Transition completion has a
timer fallback and never gates cancellation/resource release.

Verify parent and wallet documents under external stylesheet loading with
`style-src 'self'; style-src-attr 'none'`, plus the existing nonce fallback tests.
Reuse `createCspStylesheetManager` for dynamic geometry/theme rules. No CSP weakening,
inline style attributes, eval, or new remote script/module loading is allowed.
The React component must independently meet the application's script/style policy.

### Files and reused entrypoints

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
| Dispatch and session binding | `packages/wallet/src/SeamsWeb/publicApi/near.ts`, `publicApi/types.ts`, `assembly/`, `walletIframe/shared/exactSessionState.ts`, `walletIframe/host/requestRouter.ts`, `walletIframe/host/index.ts`, `walletIframe/host/handlers/` | Thread reserved dispatch through existing implementations; enforce host validity/cancellation and session binding |
| Receipt integration | `packages/wallet/src/SeamsWeb/walletIframe/client/router.ts`, `client/surface/renderer.ts` | Preserve receipt/toast lifecycle and atomically replace an old receipt at review admission |
| Preact approval | `packages/wallet/src/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface.tsx`, `ConfirmationModal.tsx` | Keep existing approval rendering; only make minimal handoff changes |
| Resize coordination | `packages/wallet/src/core/signingEngine/uiConfirm/ui/confirm-surface-resize.ts` | Reuse the existing measured-size handshake and avoid competing animation owners |
| Integration example | `examples/wallet-console-lite/src/WalletConsoleLite.tsx`, `styles.css` | Purchase-review demo with normal, expired, slow, and failing review cases |
| Contracts and tests | `docs/intended-behaviours.md`, `tests/wallet-ui/`, `tests/wallet-iframe/`, existing type fixtures | Behavior contracts, cross-origin integration, type-level invalid-state checks |

## Phased acceptance checklist

Status is based on the verification record below. VoiceOver/manual screen-reader
acceptance was waived by the user on 2026-09-22. Unchecked items are evidence gaps,
not passing checks.

### Phase 0 — establish the baseline and integration contract

- [x] Verify the implementation base contains inspected `dev` revision `3f382bf`
  and receipt/toast behavior. Preserve unrelated dirty files and worktrees.
- [x] Trace the current modal, queue, readiness, cancellation, user-activation, and
  request-settlement paths end to end. Record exact reused entrypoints here.
- [x] Trace each method in the supported-method matrix through public boundary,
  router RPCs, credential prompts, signing, and settlement. Use that trace to
  thread the reservation; any discrepancy with the specified behavior is a blocker
  to that method's implementation, not permission to silently narrow coverage.
- [x] Establish current focused test/type-check/build results. Classify failures
  against current behavior before repairing them.
- [ ] Capture the existing modal, drawer, tx-tree, auth, and export appearance in a
  temp/ignored folder. Use synthetic data; never capture private keys or tokens.

Exit: ownership and scope are explicit, the baseline is reproducible, and no
implementation depends on taking over another agent's local server.

### Phase 1 — define typed review lifecycle and API

- [x] Implement the specified React-only review contract and host placement. Keep
  the renderer and callback registry local to React; core types remain React-free.
- [x] Model queued, reviewing, review-failed, preparing approval, wallet approval,
  signing, and settled states with discriminated unions and required identities.
  The signing state retains ownership through execution and settlement; core owns
  execution progress. Animation progress is separate from approval.
- [x] Implement the cancellation table at each boundary. Before signing, cancel the request;
  after an irreversible signing/broadcast step, closing UI must not report that the
  operation was undone. Preserve the established outcome contract.
- [x] Implement snapshot, quote-expiry, session-change, and unsupported-mode contracts.
- [x] Add type fixtures rejecting callback-bearing wire objects, incompatible
  presentation modes, invalid state combinations, direct construction and broad
  spread escape hatches. Use boundary parser tests to reject extra wire keys and
  runtime tests for stale identity values; branded types alone cannot prove two
  same-typed request ids match. Keep unsafe casts out of the new implementation.
- [x] Update the intended-behavior specification with its contract tests when the
  new public lifecycle behavior is implemented.

Exit: the public call, success/error semantics, trust boundary, and transitions
can be reviewed without relying on animation or DOM behavior.

### Phase 2 — build a vertical slice without animation

- [x] Add the host portal and a stable review slot to the existing outer dialog.
  Verify context propagation, application styling, focus, and error boundaries.
- [x] Implement review-to-wallet handoff for one hosted transaction method first.
  Keep the iframe and its transport alive throughout.
- [x] Extend the current foreground reservation across both steps. Reuse queue
  semantics; do not create a second queue or bypass other foreground operations.
- [x] Dispatch only once after Continue. Strip React review metadata before core
  calls; carry validated validity/reservation metadata through the internal path.
  Component code and raw HTML never reach the wallet document.
- [x] Match ready/measurement/approval/cancel events to the current request and
  connection. Preparing must not trigger signing or credential UI automatically.
- [x] Implement host-owned cancellation arbitration and activation acknowledgement.
  Keep the public Promise pending until dispatched cancellation is acknowledged
  or transport fails; prove a cancellation race cannot hide a signed result.
- [x] Test double Continue, Escape, close, provider unmount, iframe disconnect,
  timeout, concurrent requests, and late responses. Release resources exactly once.

Exit: one dialog completes the full flow with an immediate, correct view switch;
both cancellation and success leave no pending review or leaked reservation.

### Phase 3 — cover supported transactions and lifecycle edges

- [x] Apply the same adapter to the remaining supported NEAR/EVM/Tempo methods.
  Delegate execution to existing implementations; preserve callbacks and results.
- [x] Cover warm sessions, credential-required sessions, preparation failures,
  account changes, expired quotes, wallet rejection, and signing/execution errors.
- [x] Audit multi-prompt methods so custom review occurs once per transaction call
  and every wallet-required approval still occurs in the wallet view.
- [x] Preserve execution receipts/toasts. Test Promise settlement before receipt
  dismissal, atomic replacement by a reviewed transaction, and ignored late receipt
  activity. Existing ordinary-call replacement remains in the router path.
- [x] Verify ordinary calls without review, auth, export, recovery, and drawer
  behavior remain intact. Reject unsupported reviewed operations explicitly.

Exit: supported methods share one review implementation and every documented
terminal state has a tested cleanup path.

### Phase 4 — seamless geometry and accessibility

- [x] Measure the app review locally; accept wallet sizes only through the existing
  validated iframe measurement boundary. Clamp both to safe viewport bounds.
- [x] Keep loading content visible until wallet readiness and usable geometry are
  known. Provide a bounded failure path if either never arrives.
- [x] Reuse the existing measured width/height animation and theme radii, with a
  content crossfade at handoff. The parent owns geometry; the child does not ease
  dimensions while the parent is already interpolating them.
- [x] Avoid full-content scaling, double shadows, black iframe backgrounds, iframe
  reparenting, and hidden-document measurement deadlocks. Use explicit transition
  properties; add no new motion dependency.
- [x] Make transitions interruptible. Teardown must complete even if transitionend
  never fires. Reduced motion uses an immediate resize and minimal/static handoff.
- [x] Preserve one effective modal focus boundary across the two documents. Move
  focus into the new view through the wallet's own handler, never by reading its
  cross-origin DOM. Inactivate and hide the outgoing view from assistive technology.
- [x] Verify Tab/Shift+Tab, Enter, Space, Escape from either document, focus return,
  and no activation of hidden approval controls.
- Manual screen-reader announcements: waived by the user; no pass is claimed.
- [x] Inspect light/dark, Sharp/Rounded, small/large review content, Suspense loading,
  tree expansion, 320px width, and actual desktop 200% zoom.
- [ ] Verify physical mobile-keyboard viewport changes; no device is connected.
- [x] Inspect handoff frames at 25%, 50% and 75% opacity progress for clipping and
  backdrop continuity. Verify inertness during the fade and wallet activation
  after completion; screenshots remain outside Git.

Exit: the visual experience is one continuous modal and remains usable without
animation, pointer input, or a large viewport.

### Phase 5 — integration and regression gates

- [x] Add the purchase-review example and document required host placement and
  styling constraints. Use fixture quotes and explicit test-network labeling.
- [x] Exercise a genuine cross-origin wallet frame; a same-origin DOM-only harness
  cannot establish the trust-boundary or focus-handoff guarantees.
- [x] Verify the wallet still requires its own final approval, checks the current
  request, and rejects stale/cancelled requests. App-side Continue alone never signs.
- [x] Test React context, local input state, StrictMode, render errors, async errors,
  host disposal, reconnect, two rapid requests, and maliciously large measurements.
- [x] Cover nested input mutation, queued expiry/cancellation, same-wallet session
  replacement, owned credential step-up, inherited skipClick/drawer rejection,
  preference changes during review, Suspense timeout, and duplicate hosts.
- [x] Cover cancellation versus approval and credential completion, late receipt
  events after replacement, missing activation acknowledgement, and post-signing
  disposal. Assert outcomes and resource ownership, not just modal disappearance.
- [x] Verify SDK-owned styles under supported strict-CSP configurations. Document
  that an arbitrary supplied component must independently satisfy its app's CSP.
- [x] Run focused tests first, then the affected browser matrix on Chromium,
  Firefox, and WebKit. Add intended lifecycle cases and run credential-gated checks
  when available; explicitly record unavailable credentials/infrastructure.
- [x] Check type declarations, public exports, SSR importability, packaged consumer
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

- [x] Remove replaced dialog/handoff branches, duplicate state or queues, dead
  callbacks, temporary feature flags, and obsolete tests/helpers. Keep one path for
  reviewed transactions and the established behavior for calls without review.
- [x] After visual acceptance, remove temporary visual-comparison tests, galleries,
  fixture routes, and screenshot tooling introduced for this change. Keep permanent
  behavioral tests for geometry, focus, cancellation, and authorization boundaries.
- [x] Keep screenshots and recordings outside Git. Delete only this work's temporary
  artifacts when no longer needed; preserve unrelated migration evidence.
- [x] Review the final diff for unnecessary abstractions, React imports in core,
  legacy bridge resurrection, context loss, and changes to signing semantics.
- [x] Prepare reviewable commits by concern: lifecycle/API, React/dialog integration,
  method coverage, motion/accessibility, tests/docs, and cleanup. Commit/push/release
  actions require their own user request; this document authorizes planning only.
- [x] Record verification and remaining limitations. Coordinate any future release
  separately from this implementation.

Exit: the implementation is understandable through one ownership model, obsolete
paths and temporary parity tooling are gone, and remaining limitations are explicit.

## Verification record

Implementation checkout: `/Users/pta/Dev/rust/seams-wallet-custom-components`, branch
`codex/refactor-140-custom-components`, based on the user-authorized `55f091d`
checkpoint. The implementation, packaging correction, and fixture updates are
recorded in separate commits on this branch.

Reused ownership paths: `createPublicApi` capability factories → the existing
transaction methods → `WalletIframeRouter.post` → the existing host handlers.
`WalletIframeTransactionSurfaceQueue` owns the single lease. The host passes its
request admission object through `runtimeContext` and the confirmation binding;
this avoids a duplicated registry across boot/runtime bundles. Signer callbacks
capture that request before asynchronous preparation. Cancellation retains the
lease until core unwinds, and aborts pre-signing WebAuthn through the existing
prompt cancellation channel.

Verification on 2026-09-22:

- SDK type check, wallet-state type fixtures and browser-test type check passed.
- Development SDK build and `NODE_ENV=production pnpm -C packages/wallet build:sdk`
  passed, including hosted static-asset and runtime-boundary checks. Generated
  WASM packages were reused unchanged; this TypeScript/UI change did not rebuild Rust.
- Bundle report: hosted boot path 88.3 KiB raw / 23.9 KiB gzip; browser JS union
  6.24 MiB raw / 1.19 MiB gzip. The new review admission/metadata chunks contain no React.
- External consumer declaration check passed. Wallet Console Lite type check and
  production build passed with the new testnet purchase example.
- Reviewed transaction tests: nine cases passed in each of Chromium, Firefox and
  WebKit (27 total). An additional missing-activation-acknowledgement case and
  the handoff/CSP case passed across the three browsers (six checks). The suite exercises a
  real cross-origin frame and production admission/Preact confirmation components,
  while its signer result is a fixture. It covers context, StrictMode, immutable
  input, explicit wallet approval, FIFO expiry, disposal, stale controls, fallback,
  viewport clamping, reduced motion, signing/cancellation arbitration, all six
  adapters' core failures/callbacks, host registration, and Suspense timeout.
- Focused router/session/geometry and contract/snapshot/deadline regression run:
  26 Chromium cases passed; the final geometry/snapshot subset passed 14 cases. Confirmation/receipt regression cases passed in all
  three browsers in the matrix run (33 cases).
- Parent and child use external wallet CSS under `style-src 'self';
  style-src-attr 'none'`. The WebKit keyboard-focus/CSP handoff check passed.
  Temporary screenshots were inspected outside Git and capture code was removed.
- `pnpm test:intended` passed its type check, then stopped before execution because
  the Google ID token is missing. This is an environment failure, not a passing
  credential/signing contract run.

Completion follow-up on 2026-09-22:

- Added the missing expired, slow-loading, and failing purchase-demo cases.
- Added keyboard/local-input, same-wallet session replacement, render-boundary,
  and post-signing host-disposal tests. All fourteen review cases have passing
  results in Chromium, Firefox, and WebKit, plus five contract/snapshot checks.
  The combined run passed 46 checks; its WebKit keyboard case passed on rerun
  using macOS Option-Tab for traversal of native buttons.
- Corrected two fixtures: the simulated signer now reports wallet cancellation,
  and the session test imports the bridge from the React build's module tree.
- Removed a redundant review type and fixed visibility-listener cleanup when a
  quote expires immediately as its controller starts.
- Added shared-memory byte mutation to the snapshot contract. The check exposed
  that `structuredClone` retains shared storage; public `Uint8Array` intents now
  copy into private byte storage before review begins.
- Production SDK/example builds, example type check, browser-test type check,
  and wallet-state type fixtures passed during the follow-up.
- Reused the existing Google test service-account configuration to refresh a
  token into the ignored worktree-local environment. The original checkout and
  cloud IAM configuration were not changed. The initial missing-token blocker
  is resolved. Local Wallet service Rust/WASM builds completed successfully.
- The isolated passkey registration contract passed in 28.2 seconds, including
  Tempo, NEAR, and EVM signatures and post-unlock signing. Its first run stalled
  because the shared intended harness left a completed receipt over the next
  action. The harness now closes that receipt after operation settlement,
  including its concurrent Tempo/EVM signing path.
- After the startup-expiry cleanup fix, the final SDK build and intended type
  check passed; six cancellation/FIFO-expiry checks passed across all browsers.
- The full intended run passed its first nine cases, then encountered the Yao
  fault-injection infrastructure guard: it requires `https://localhost:4101`,
  while this repository's isolated runner starts `http://127.0.0.1:4100`. The
  required server-side fault-header implementation is absent here. Both Yao
  fault-injection cases remain blocked; their expectations and guard are intact.
- The remaining twelve intended contracts passed after completing the shared
  receipt cleanup. Total: 21 intended contracts passed, two blocked by the missing
  fault-injection proxy. Coverage includes recovery, code reuse refusal, failed
  and lost-response finalization, auth-method addition, export, sustained signing,
  session step-up, refresh, and cold unlock.
- The four snapshot/wire/configuration checks passed after the shared-memory
  byte-copy correction, along with the wallet-state type fixtures.

Release verification follow-up on 2026-09-22:

- Restored the request-scoped Yao fault controller in the local Wallet gateway,
  using the existing private-repository implementation. Fault arming now targets
  the isolated runner's exact `http://127.0.0.1:4100` origin. The local Worker
  validates the origin, registration path, method, mode, and opaque token; the
  deployed hosted Worker does not import the fault controller.
- The exact-request replay and terminal-burn contracts now pass. Four focused
  checks also pass for request isolation, local-only arming, opaque tokens, and
  rejection of changed replay bodies or retries after a terminal result.
- Fixed local service teardown discovered during these runs: the test supervisor
  launches the Wallet system directly, and nested supervisors use ordered,
  bounded cleanup deadlines that also stop detached descendants after their
  launcher exits. The initial terminal contract passed its assertions but its
  runner required interruption during teardown. Final isolated runs passed replay
  in 26.0 seconds and terminal failure in 33.0 seconds, with clean runner exits and
  no remaining test-service listeners. All 23 intended contracts now have passing
  results across the verification runs.
- Server build, intended type check, and launcher syntax checks passed. A temporary
  build/startup overlap was classified as infrastructure failure and rerun after
  the build completed.
- Thirty-six additional review-to-wallet checks passed: Light/Dark ×
  Sharp/Rounded × 1280×800, 640×400, and 320×568 viewports × Chromium, Firefox,
  and WebKit. Captured 72 review/approval images outside Git and inspected
  representative narrow and short-window handoffs. Approval controls remained
  inside the wallet frame. Removed the temporary visual tests and probe afterward.
  These viewport checks do not establish desktop browser zoom or physical keyboard
  behavior.

Live signing and desktop zoom acceptance on 2026-09-22:

- Added a permanent intended contract using the public React-bound EVM signer
  under `TransactionReviewHost`. The test registers a real local MPC wallet,
  enters a review note, verifies that Continue exposes a separate wallet approval,
  and signs an Arc testnet EIP-1559 transaction. It independently decodes the
  signed bytes and recovers the registered signer address, checking the chain,
  recipient, and zero value. It passed in 34.1 seconds. No transaction is broadcast;
  the existing intended harness still supplies external RPC fixtures and virtual
  WebAuthn credentials. This adds a 24th passing intended contract.
- Corrected two assertions in that new test against existing contracts:
  `txHashHex` is the unsigned signing digest, and viem omits the decoded zero-value
  field. These were test errors; production signing behavior was unchanged.
- Verified actual Chromium desktop zoom at 200% through the native browser
  controls, with a matching doubled device-pixel ratio. The review and wallet
  handoff, expanded transaction details, full visibility of the focused Confirm
  button, and Enter approval passed. Screenshots are outside Git. The final check
  passed in 39.0 seconds; temporary acceptance tooling was removed afterward.
- Added a permanent short-viewport keyboard/scroll regression case. It passed in
  Chromium, Firefox, and WebKit, including full Confirm visibility after expanding
  transaction details. No production scrolling change was needed.
- Intended and browser TypeScript checks passed. The ordinary registration/signing
  regression passed in 32.1 seconds with the review host mounted.
- Physical-device discovery returned no connected devices. VoiceOver could not
  be launched during this pass. The user subsequently waived manual screen-reader
  acceptance; physical mobile-keyboard acceptance remains unverified.

Final lifecycle and package audit on 2026-09-22:

- Added double-Continue and disconnect checks before and after dispatch. All nine
  browser checks pass across Chromium, Firefox, and WebKit. Before dispatch, the
  existing disconnect error has no code; after dispatch it carries the existing
  `connection_closed` code. The initial new assertion incorrectly required a code
  in both phases and was corrected without changing production behavior.
- Added iframe reload/reconnect checks; all three pass across the browser matrix.
  The old review rejects, stale controls cannot dispatch, and a fresh connection
  can complete a new reviewed transaction.
- Added receipt and preference-change checks; all six checks pass across the same
  browsers. A settled receipt leaves the Promise resolved and the dialog open.
  The next review closes the receipt by its exact request id without closing the
  dialog, and late expanded/toast/closed events cannot reclaim the new review.
  A mid-review preference change to drawer/skipClick preserves the reserved modal
  and explicit wallet approval.
- Found and fixed a compile-time wire-boundary gap: object spreads could include
  a renderer in `TransactionReviewWire`. An explicit `render?: never` field now
  rejects that shape. Type fixtures cover the spread and missing connection id;
  the runtime parser already rejected extra wire keys.
- SDK, wallet-state and browser-test type checks passed. A fresh production SDK
  build passed static-asset and runtime-entry checks.
- Built baseline `55f091d` in a temporary source snapshot with the same installed
  dependencies, existing WASM outputs and `NODE_ENV=production` SDK command.
  Compared both builds with the repository's bundle reporter; neither report has
  missing assets. Hosted boot gzip grew from 20,653 to 24,495 bytes (+3,842 bytes).
  Reachable browser JS gzip grew from 1,234,628 to 1,247,242 bytes (+12,614 bytes).
  These deltas include all branch changes since the baseline, including the
  packaging correction. WASM gzip sizes are unchanged. Reports remain outside Git; the temporary baseline build was removed.
- Completed the missing content crossfade using the existing 180 ms motion
  duration. The outgoing React view stays mounted and inert until the fade ends;
  wallet activation follows the fade. Teardown cancels the fade immediately,
  reduced motion switches immediately, and a timer handles absent animation
  completion events. Chromium inspection at 25%, 50% and 75% opacity progress
  shows continuous backdrop and unclipped content. Temporary screenshot tooling
  was removed. Escape during a paused fade cancels within one second in all three
  browsers, before the deliberately slowed fallback timer can complete.
- The final review matrix passed all 66 checks in 7.9 minutes. The final focused
  animation run passed six checks, including three additional Escape-during-fade
  cases: 23 distinct review cases now pass in Chromium, Firefox and WebKit
  (69 distinct browser checks). Browser and wallet-state type checks passed again
  after retaining the permanent cancellation and animation-fallback tests.
- The live reviewed Arc signing contract passed again in 35.1 seconds after the
  motion change, including independent signer recovery from the signed bytes.
- VoiceOver/manual screen-reader acceptance is waived at the user's request.
  Keyboard, focus, inertness and strict-CSP checks remain part of acceptance.

Failures classified and resolved during verification:

- Test fixture corrections: startup prefetch response, enabled signing capability,
  wallet-origin module/CSS URLs, and deterministic keyboard opener focus in Safari.
- The existing drawer-close test used an obsolete `Cancel` aria-label. Its valid
  callback/cleanup invariant now targets the existing `Close` button.
- A real bundle-boundary defect in the initial implementation was fixed by passing
  the admission object explicitly between boot and runtime bundles.
- Consumer build exposed a pre-existing packaging defect: viem's extensionless v1
  noble hash import was externalized against the SDK's v2 dependency. The library
  build now retains viem's own dependency; direct SDK v2 imports stay external.
- Bare Node import of the broad React entry encounters existing CSS imports;
  Vite SSR import passed with the exported review host present.

Limitations: the focused cross-browser review fixtures simulate signer results;
the new reviewed EVM intended contract executes local MPC signing with virtual
credentials and external RPC fixtures. Broadcast and hardware credentials are not
covered by that contract. Manual screen-reader acceptance is waived. A physical
mobile-keyboard session remains unverified because no device is connected. The
phase checklist also records the missing historical pre-change screenshot set;
current visual and behavior checks do not retroactively establish that baseline.
Publication and deployment are separate actions.

## Later enhancement: toggleable views

Revisit only after the two-step flow is accepted. Read-only summary switching must
hide/inactivate wallet approval while the summary is visible and restore focus
deliberately. Editing the purchase invalidates the pending wallet request and
starts a newly reviewed request. Switching is unavailable once signing has crossed
its non-cancellable boundary. Do not add a second lifecycle or final approval
button in the application view.

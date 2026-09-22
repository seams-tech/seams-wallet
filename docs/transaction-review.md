# Custom React transaction review

Mount one `TransactionReviewHost` inside `SeamsWebProvider`, below every application
provider the review needs. Components that call reviewed methods must descend from
that host. Context follows the host's ancestry; a provider local to the calling
button is not captured by passing a renderer.

```tsx
import { TransactionReviewHost, useWallet } from '@seams/wallet/react';

<SeamsWebProvider config={config}>
  <PurchaseContext.Provider value={purchase}>
    <TransactionReviewHost><Checkout /></TransactionReviewHost>
  </PurchaseContext.Provider>
</SeamsWebProvider>
```

Pass `review` to `near.signAndSendTransaction`, `near.executeAction`, or the EVM and
Tempo `signTransaction` and `executeTransaction` methods returned by `useWallet()`.
The existing result and lifecycle callbacks retain their meanings.

```tsx
await wallet.near.signAndSendTransaction({
  receiverId,
  actions,
  review: {
    title: 'Review purchase',
    validity: { kind: 'expires_at', atMs: quote.expiresAtMs },
    render: controls => <PurchaseReview quote={quote} controls={controls} />,
  },
});
```

Use `{ kind: 'unbounded' }` explicitly for transactions without a quote expiry.
Effective confirmation settings must be `uiMode: 'modal'` and
`behavior: 'requireClick'`. Incompatible saved preferences or per-call overrides
reject before review opens. Accepted settings and transaction data are captured
for the request; changing them requires another call.

The component supplies content and buttons wired to `continueToWallet`, `cancel`,
and `fail(error)`. Continue reveals wallet approval. The user must still approve
inside the wallet. Supply no outer dialog, backdrop, viewport positioning, or
independent focus trap. Render callbacks return React content synchronously;
return components that use hooks, and use `React.lazy`/Suspense for loading.
Report event-handler and fetch failures through `fail`. The SDK shows a dismissible
error fallback and a cancellable loading fallback.

Application CSS remains available, but the portal changes DOM ancestry. Ancestor
selectors, inherited CSS variables, and CSS-in-JS insertion targets may need an
explicit `className` on the review. SDK light/dark and shape tokens remain available.
Application content must independently satisfy the application's CSP.

Calls queue with ordinary wallet transactions. Cancelling or unmounting the owner
or host invalidates queued and pre-signing work. After signing starts, the call
preserves the wallet's actual result. Expiry prevents approval and additional
signatures; it cannot undo a signature already started. Use contract deadlines
and slippage limits for transaction-level economic guarantees.

Before dispatch, adapter errors reject with `TransactionReviewError.code` and
invoke no signing callbacks. This includes `executeAction`, whose dispatched core
operation may otherwise return `success: false`. Codes include `cancelled`,
`review_expired`, `review_invalid_input`, `review_host_unavailable`,
`review_owner_disposed`, `review_unsupported_mode`, `review_identity_changed`,
`review_render_failed`, and `review_prepare_timeout`. Existing router busy and
connection errors retain their types. Refresh expired quotes and make a new call.

See `examples/wallet-console-lite/src/PurchaseReviewExample.tsx` for an interactive
prediction-market preview using the shared review and wallet approval modal.
Choose **Preview component** at `http://localhost:4001/`; no sign-in or signing is required.

Wallet approval includes **Back to review** when opened from an application review.
Back preserves the review component's local state and the original quote deadline.
Continue resumes the same pending approval without dispatching another transaction.
The shared modal resizes and crossfades in both directions. Back is available until
wallet approval is submitted; changing transaction inputs requires a new call.

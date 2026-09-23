---
title: Custom transaction review
description: Show your React component before wallet approval, with explicit expiry and cancellation.
---

# Custom transaction review

Pass a `review` object to a transaction method returned by `useWallet()` to show
your own React component before wallet approval. The flow is:

**Your review → Continue to wallet → wallet approval → transaction result.**

## Mount the host

Mount one `TransactionReviewHost` beneath `SeamsWebProvider` and every app
provider your review needs. The component that submits the transaction must
also descend from this host.

```tsx [Partial example]
import { SeamsWebProvider, TransactionReviewHost } from '@seams/wallet/react';

<SeamsWebProvider config={config}>
  <TransactionReviewHost>
    <App />
  </TransactionReviewHost>
</SeamsWebProvider>
```

Reviews inherit context from the host's ancestry. Providers mounted only around
the calling button do not supply context to the review.

## Pass a React component

The `render` callback receives the controls and returns your component. That
component can use hooks, context, local state, and `React.lazy`/Suspense.

```tsx [Partial example]
review: {
  title: 'Review purchase',
  validity: { kind: 'unbounded' },
  render: (controls) => (
    <PurchaseReview quote={quote} controls={controls} />
  ),
}
```

Here, `PurchaseReview` and `quote` belong to your application. Return JSX from
the synchronous callback; place hooks inside the returned component.

The SDK supplies the dialog, backdrop, and focus management. Supply content and
buttons without another dialog or focus trap.

| Control | Effect |
| --- | --- |
| `continueToWallet()` | Shows wallet approval. The user must approve there before signing. |
| `cancel()` | Cancels the review. |
| `fail(error)` | Shows the SDK's dismissible error fallback. Use for event-handler or fetch failures. |

## Choose validity explicitly

`validity` is required so each call explicitly chooses whether the reviewed
transaction has a deadline.

- `{ kind: 'unbounded' }`: no review deadline, suitable for a transfer without an expiring quote.
- `{ kind: 'expires_at', atMs: quote.expiresAtMs }`: use the quote's deadline as
  a positive safe-integer Unix timestamp in **milliseconds**.

Expiry prevents approval and additional signatures. It cannot undo a signature
already started. Refresh an expired quote and make a new call; changing an
existing quote does not update the captured transaction. Use contract deadlines
and slippage limits for transaction-level economic guarantees.

## Runnable NEAR example

Render this button beneath the host with a signed-in NEAR account. It sends a
zero-value self-transfer; gas fees apply. Use a testnet wallet to try it.

<<< ../examples/transaction-review.tsx

## Supported methods and settings

| Signer from `useWallet()` | Methods accepting `review` |
| --- | --- |
| `near` | `signAndSendTransaction`, `executeAction` |
| `evm` | `signTransaction`, `executeTransaction` |
| `tempo` | `signTransaction`, `executeTransaction` |

Custom reviews require a hosted wallet iframe and effective confirmation
settings of `uiMode: 'modal'` and `behavior: 'requireClick'`. Set them explicitly
as in the example to override incompatible saved preferences. Automatic approval
delays are unsupported. Core SDK calls, message signing, export, and authentication
do not accept this React review API.

The SDK captures transaction inputs and confirmation settings when called. The
returned promise and lifecycle callbacks retain the method's existing meaning;
Continue alone does not resolve the transaction. Calls queue with other wallet
transactions. Cancelling or unmounting the caller or host invalidates queued and
pre-signing work. After signing starts, the call preserves the wallet's actual result.

## Errors and styling

Before dispatch, review failures reject with `TransactionReviewError` and invoke
no signing callbacks. This also applies to `executeAction`; after dispatch, its
normal `success: false` result remains possible. Existing connection and router
errors retain their types.

| `TransactionReviewError.code` | Meaning |
| --- | --- |
| `cancelled` | The review was cancelled. |
| `review_expired` | The deadline passed; obtain a fresh quote and retry. |
| `review_invalid_input` | The review configuration or transaction input is invalid. |
| `review_host_unavailable` | A usable review host is missing. |
| `review_owner_disposed` | The caller or host was disposed. |
| `review_unsupported_mode` | The runtime or confirmation mode does not support review. |
| `review_identity_changed` | The wallet identity changed during the flow. |
| `review_render_failed` | Rendering failed or the app called `fail(error)`. |
| `review_prepare_timeout` | Review loading or wallet preparation timed out. |

The optional `review.className` styles the review wrapper. App CSS is available,
but the portal changes DOM ancestry: ancestor selectors, inherited CSS variables,
and CSS-in-JS insertion targets may need adjustment. SDK light/dark and shape
tokens remain available. Your content must satisfy your application's CSP.

Wallet approval includes **Back to review** when opened from an application review.
Back preserves the review component's local state and the original quote deadline.
Continue resumes the same pending approval without dispatching another transaction.
The shared modal resizes and crossfades in both directions. Back is available until
wallet approval is submitted; changing transaction inputs requires a new call.

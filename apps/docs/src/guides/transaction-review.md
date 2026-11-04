---
title: Custom review components
description: Show your React component before wallet approval, then hand off to the wallet in the same modal.
---

# Custom review components {#custom-transaction-review}

Pass a `review` object to a transaction method on `useSeams().wallet` to show
your own React component before wallet approval. When the person continues, the
same modal changes from your component to wallet approval. The person sees one
dialog, not a second popup. The flow is:

**Your review → Continue to wallet → wallet approval → transaction result.**

<div class="review-handoff">
  <figure>
    <img src="/images/custom-components/review.webp" width="860" height="990" alt="A purchase review drawn by the application: the market claim, the amount to pay, the payout, the fees, a quote countdown, a Confirm in wallet button, and a Back to market link.">
    <figcaption>1. Your component shows the terms of the purchase.</figcaption>
  </figure>
  <figure>
    <img src="/images/custom-components/wallet-approval.webp" width="884" height="930" alt="Wallet approval in the same modal: the application origin, the contract address, the network, the signing account, and a Confirm with passkey button.">
    <figcaption>2. The same modal shows wallet approval for the exact transaction.</figcaption>
  </figure>
</div>

Try the flow in the **Custom Components** demo on [wallet.seams.sh](https://wallet.seams.sh/).

## How the handoff works

1. Your app calls a transaction method with `review`. The SDK opens a modal and
   renders your component in it. With `origin`, the modal grows from your own element.
2. The person reads your terms. Your button calls `controls.continueToWallet()`.
3. The modal crossfades to wallet approval in the same box: it keeps your
   component's width and top-left corner, and only its height changes. The wallet
   iframe draws this step from the captured transaction, at your component's
   width. The person confirms with a passkey.
4. The back arrow in wallet approval returns to your component. Your component
   keeps its local state, and the quote deadline does not change.

Your component cannot sign or change the transaction. It only decides when to
show wallet approval. The wallet origin shows the transaction that the person
signs, so an error in application UI cannot change what the wallet signs.

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

Here, `PurchaseReview` and `quote` belong to your application. Return JSX from the
synchronous callback. Place hooks inside the returned component.

The SDK supplies the dialog, backdrop, and focus management. Supply content and
buttons without another dialog or focus trap.

| Control | Effect |
| --- | --- |
| `continueToWallet()` | Shows wallet approval. The user must approve there before signing. |
| `cancel()` | Cancels the review. |
| `fail(error)` | Shows the SDK's dismissible error fallback. Use for event-handler or fetch failures. |

## Start from your own modal

Pass `origin` to grow the review from your own element. Use `onVisible` to learn when the
review or the wallet approval is on screen.

```tsx [Partial example]
review: {
  title: 'Review deposit',
  validity: { kind: 'unbounded' },
  origin: amountCard.getBoundingClientRect(),
  onVisible: ({ stage, rect }) => {
    if (stage === 'review') closeAmountModal();
    trackSurface(stage, rect);
  },
  render: (controls) => <DepositReview controls={controls} />,
}
```

`origin` is a rectangle in viewport pixels. The SDK reads it once when you call the method.
It applies only to the first review. Wallet approval never starts from application
geometry. With reduced motion, the review appears in place.

`onVisible` receives `stage` and `rect`. `stage` is `review` when your component is
visible, and `wallet` when wallet approval is ready. **Back to review** reports `review`
again. `rect` is the settled position in viewport pixels. An error from this callback does
not change the transaction.

The review opens above your modal. Close your modal in `onVisible`, so that no frame
shows an empty page. If your modal held focus, the SDK cannot return focus to it after you
remove it, so move focus yourself when the operation ends.

## Choose validity explicitly

`validity` is required so each call explicitly chooses whether the reviewed
transaction has a deadline.

- `{ kind: 'unbounded' }`: no review deadline, suitable for a transfer without an expiring quote.
- `{ kind: 'expires_at', atMs: quote.expiresAtMs }`: use the quote's deadline as
  a positive safe-integer Unix timestamp in **milliseconds**.

Expiry prevents approval and additional signatures. It cannot undo a signature already
started. Refresh an expired quote. Make a new call with that quote. Changing an existing
quote does not update the captured transaction. Use contract deadlines and slippage
limits for transaction-level economic guarantees.

## Runnable NEAR example

Render this button beneath the host with a signed-in NEAR account. It sends a zero-value
self-transfer. Gas fees apply. Use a testnet wallet to try it.

<<< ../examples/transaction-review.tsx

## Purchase example with an expiring quote

This EVM example follows the demo in the pictures. Your backend returns a quote
with a deadline and the call to your market contract. The component shows a
countdown and disables **Confirm in wallet** when the quote expires. `validity`
uses the same deadline, so the SDK also stops wallet approval after expiry. The
review grows from the **Buy Yes** button.

<<< ../examples/purchase-review.tsx

Set `chainTarget` to an EVM network in your provider config. A `review_expired`
error means that nothing was signed. Get a new quote and make a new call.

## Supported methods and settings

| Signer on `useSeams().wallet` | Methods accepting `review` |
| --- | --- |
| `near` | `signAndSendTransaction` |
| `evm` | `signTransaction`, `signAndSendTransaction` |
| `tempo` | `signTransaction`, `signAndSendTransaction` |

A readable wallet (`access: 'external'`) accepts `review` on
`near.prepareOwnerTransaction`. The review opens at `operation.approve()`, and the
outcome is typed. See [owner approval with an application session](/guides/application-auth#show-your-review-first).
That call always uses the modal with an explicit click, and it takes no confirmation settings.

Custom reviews require a hosted wallet iframe and effective confirmation
settings of `uiMode: 'modal'` and `behavior: 'requireClick'`. Set them explicitly
as in the example to override incompatible saved preferences. Automatic approval
delays are unsupported. Core SDK calls, message signing, export, and authentication
do not accept this React review API.

The SDK captures transaction inputs and confirmation settings when called. The returned
promise and lifecycle callbacks retain the method's existing meaning. Continue alone
does not resolve the transaction. Calls queue with other wallet transactions. Cancelling
or unmounting the caller or host invalidates queued and pre-signing work. After signing
starts, the call preserves the wallet's actual result.

## Errors and styling

NEAR returns the [transaction outcome](/reference/results-and-errors#signing-and-actions)
for review cancellation, pre-submission failure, and uncertain submission. Clear
pending state and offer another review only for `not_submitted`. Retain a hash
from `unresolved` until its chain outcome is known. Before dispatch, review
failures invoke no signing callbacks.

EVM and Tempo review failures before dispatch reject with `TransactionReviewError`.
Their signing and transport failures retain the canonical methods' error contracts.

| `TransactionReviewError.code` | Meaning |
| --- | --- |
| `cancelled` | The review was cancelled. |
| `review_expired` | The deadline passed. Obtain a fresh quote before retrying. |
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

Wallet approval includes **Back to review** when opened from an application review. Back
preserves the review component's local state and the original quote deadline. Continue
resumes the same pending approval without dispatching another transaction. The shared
modal resizes and crossfades in both directions. Back is available until wallet approval
is submitted. Changing transaction inputs requires a new call.

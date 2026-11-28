# Checkout shop example

A small shop that takes a card payment with [Seams Checkout](../../packages/checkout/README.md).
The shop's server makes the order, the page opens the checkout in a dialog or in the page, and
the server gets the result as a signed order event.

```bash
pnpm -C examples/checkout-shop dev
```

The script runs two origins on this computer:

- `http://localhost:4411`: the shop page and its server.
- `http://localhost:4410`: the checkout origin, with the frame document and the checkout Worker
  over a local D1 database.

## Provider keys

The checkout uses the merchant's own provider accounts. Give the script **test** keys through
the environment. Without keys, the page and the frame load, and a payment cannot start.

| Variable | Value |
| --- | --- |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` |
| `STRIPE_RESTRICTED_KEY` | `rk_test_...`, with write access to PaymentIntents. A secret key (`sk_`) is refused |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `KOMOJU_PUBLISHABLE_KEY`, `KOMOJU_SECRET_KEY`, `KOMOJU_WEBHOOK_SECRET` | The test keys and the webhook token |
| `CARD_RAIL` | `stripe` (default) or `komoju`: the rail of the card method |

Only a rail webhook marks an order as paid. The provider must reach the webhook URL that the
script prints. For Stripe, the Stripe CLI forwards test webhooks to it:

```bash
stripe listen --forward-to localhost:4410/checkout/webhooks/stripe/baumkuchen-shop
```

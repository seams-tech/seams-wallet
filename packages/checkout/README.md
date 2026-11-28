# Seams Checkout

`@seams/checkout` is a checkout for online shops. A shop accepts cards and Japanese payment
methods through its own Stripe and KOMOJU accounts. Seams never holds the money, and no card
number reaches a Seams server. The plan is
[Refactor 250](../../docs/refactor-250-seams-checkout.md).

The package has no required Seams dependency. All of its code is new: no file is a copy of a
wallet file.

## Where the code runs

| Folder | Runs in | Published as |
| --- | --- | --- |
| `src/server` | The merchant's backend | `@seams/checkout/server` |
| `src/worker` | The checkout Worker, with its own D1 database | Not a path. The services package builds it |
| `src/shared` | Each of the above | Bundled |
| `migrations` | The checkout Worker's D1 database | With the Worker |

## The merchant's backend

```ts
import { createCheckoutServer, verifyOrderEvent } from '@seams/checkout/server';

const checkout = createCheckoutServer({ checkoutOrigin, secretKey });
const order = await checkout.createOrder({
  reference: 'order-1042',
  currency: 'JPY',
  lines: [{ name: 'Plain baumkuchen', unitAmount: 1800, quantity: 1 }],
  shipping: { amount: 600 },
  customerEmail: 'buyer@example.com',
});
// order.id and order.clientToken go to the browser.

// In the route that receives the order events:
const event = await verifyOrderEvent({ body: rawBody, signature, secret: eventSecret });
if (event?.type === 'order.paid') {
  // Ship the order.
}
```

The browser result is a hint. Only a checked order event says that an order is paid.

## The checkout Worker

`createCheckoutWorker` in `src/worker/index.ts` makes the Worker from its parts:

- `db`: the D1 database with the migrations of `migrations/`.
- `rails`: the rails that the deployment loads, such as `stripeRail` and `komojuRail`.
- `keys`: the Worker's own secrets. One encryption key for each rail seals the provider keys of
  that rail. The KOMOJU secret key reaches all of a merchant's KOMOJU API, so it has its own
  encryption key and only the KOMOJU rail reads it.
- `credentials`: the checks of the project credentials. The host that deploys the Worker owns
  the keys and the allowed origins.

Rules that the code keeps:

- `computeOrderState` in `src/shared/orderState.ts` is the only place that decides an order
  state.
- An order has one active attempt. A unique index in the database refuses a second one.
- Only a verified rail webhook moves an attempt to `succeeded`. The Worker checks the signature
  on the raw body, then reads the payment from the provider and applies that state.
- Money that an order did not wait for becomes an unexpected payment. It marks the order for
  review and never changes the order state alone.

## Tests

```bash
pnpm -C tests test:checkout
```

The tests run the Worker over a local D1 database with rail fakes. No test moves money.

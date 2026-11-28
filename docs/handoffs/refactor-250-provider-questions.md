# Refactor 250: questions to the providers (T14 to T19)

Written on 2026-11-28 for [Refactor 250](../refactor-250-seams-checkout.md). Each text is ready
for the owner to send. Nobody sent one. Record each answer under its unknown in the plan, with
the date, and mark the task done.

## T14. KOMOJU: scoped keys or an IP allowlist (U12, D13)

> We integrate KOMOJU into a checkout service that stores each merchant's KOMOJU secret key on
> our server. Your documentation says that a secret key "grants access to all API resources".
>
> 1. Does KOMOJU have, or plan, API keys with a limited scope? We need only: create and read
>    sessions and payments, cancel a payment, refund a payment.
> 2. Can a merchant limit a secret key to a list of source IP addresses?
> 3. If neither exists: what do you recommend to a service that holds secret keys for many
>    merchants? Is the Platform Model the intended way?

## T15. KOMOJU: events of Hosted Fields (U3)

> We use `<komoju-fields>` in session mode inside our own page.
>
> 1. `fields.js` sends the events `komoju-invalid` and `komoju-session-change`, but the
>    documentation names only `komoju-error`. Are these two events a stable interface?
> 2. Is there an event, or a property, that says that the card fields are complete and valid
>    before `submit()`? We want to turn our pay button on and off.
> 3. In session mode, `submit()` resolves with no value. Is that the intended contract?
> 4. Which host serves the 3-D Secure dialog that `fields.js` opens? We need it for the
>    `frame-src` directive of our Content-Security-Policy.
> 5. `fields.js` adds a `<style id="komoju-fields-global-styles">` element to the page. Is
>    there a supported way to use the fields with a `style-src` that has no `'unsafe-inline'`?
> 6. The `theme` attribute: is a `data:text/css` URL a supported value? Which CSS variables
>    are supported besides the colour variables?

## T16. KOMOJU: Apple Pay and Google Pay in a frame (U5)

> Our page with `<komoju-fields>` runs in an iframe. The iframe's origin (our checkout origin)
> is not the origin of the merchant's page that embeds it.
>
> 1. For Apple Pay with Hosted Fields: which domain must the merchant register, the domain of
>    the top page, the domain of our iframe, or both? Which domain hosts the Apple domain
>    association file?
> 2. Does Apple Pay work in this cross-origin iframe case, and from which Safari version?
> 3. Does Google Pay work in Hosted Fields? Your eligibility page names only the hosted page
>    and WooCommerce, and a changelog of 2026-08-31 names Hosted Fields too.

## T17. Stripe: card fees for cards from outside Japan (U6)

> Our business is in Japan. Your pricing page lists 3.6% for each card brand and names no
> surcharge for a card that was issued outside Japan.
>
> 1. Please confirm in writing: does a card from outside Japan have a fee other than 3.6%,
>    when the payment is in JPY and needs no currency conversion?
> 2. When does the 2% currency conversion fee apply: when the presentment currency is not
>    JPY, or when the card's currency is not JPY?

## T18. Stripe: konbini cancel and cash balance returns (U11)

> 1. We cancel a konbini PaymentIntent before `expires_at`. What does the store show when the
>    customer then tries to pay with the old payment code? Can a payment still complete?
> 2. A customer sends a Japan bank transfer after we cancelled its PaymentIntent. The money
>    goes to the customer's cash balance. When we return it to the customer, does the ¥250
>    refund fee apply? Does it apply when Stripe returns unreconciled funds after 75 days?
> 3. Your changelog says that `payment_method_types` is refused on PaymentIntents from API
>    version `2026-09-30.endive`. Please confirm that `allowed_payment_method_types` with one
>    of `card`, `konbini`, `customer_balance` or `paypay` is the replacement, also together
>    with `confirm=true` and `payment_method_data`.

## T19. FastNEAR and Intear: limits for a transfer search (U13)

To FastNEAR:

> We plan to read each final block of NEAR mainnet from neardata
> (`https://mainnet.neardata.xyz/v0/block/<height>`) to find USDC transfers for a checkout.
> That is about 100 blocks each minute. On 2026-11-28 the keyless service answered HTTP 429
> with "rate-limit exceeded of 30 blocks per minute".
>
> 1. Which plan allows 100 blocks each minute, all day, and what does it cost?
> 2. Does the limit count for each IP address? Our reader runs on Cloudflare Workers, which
>    share egress addresses.
> 3. How long after finality is a block available on neardata?
> 4. Does the FastNEAR Transfers API return the `memo` of an `ft_transfer`, and is it
>    available for testnet?

To Intear:

> We consider the Intear transfers API (`transfers.query`, `transfers.subscribe`) to find
> USDC transfers to one receiver on NEAR mainnet.
>
> 1. What are the terms and the price after the beta? Is there a rate limit?
> 2. Does a transfer record have the `memo` of the `ft_transfer` call?
> 3. How long after finality does a transfer appear?

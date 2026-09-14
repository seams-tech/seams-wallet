# Refactor 130A — Escrow funding, agent budgets, and card accounting

Date created: August 29, 2026
Last revised: September 8, 2026

Status: implementation plan. R130A–D together deliver one testnet/sandbox demo.

## One operating path

```text
User funds their Seams wallet with testnet stablecoins
  -> spends stablecoins through the existing wallet flow, OR
  -> moves a chosen amount from the wallet into escrow for card spending
  -> Seams verifies escrow finality and credits card capacity once
  -> agent proposes a purchase through R130B
  -> Seams checks approval and reserves funding capacity and agent budget
  -> Airwallex sandbox authorizes and captures through R130D
  -> Seams reconciles card events, capacity, and budget
  -> R130C displays the receipt and updated balances
```

Use one host app, agent integration, merchant, escrow deposit path, token, chain,
and card currency. Wallet deposits remain available for ordinary stablecoin spending. The user
selects “Move to card balance” and submits that amount to escrow through the
existing wallet transfer flow. Only this escrow deposit funds card capacity.
Seams observes the finalized deposit; it does not sweep a wallet or send an
onchain merchant payment. No durable signed-transaction submission engine is
required in R130A.

[R130B](refactor-130B-agent-connections.md) owns authenticated agent API access,
[R130C](refactor-130C-agent-expense-console.md) owns the embedded flow, and
[R130D](refactor-130D-airwallex-card-rail.md) owns the Airwallex sandbox adapter.
D is required for the complete demo. Production funding and settlement remain
separate work; the issuer-side funding bridge is explicitly simulated here.

## Wallet balance and card balance

The wallet is the initial funding surface. Stablecoins held there can be spent
through the existing wallet APIs, or transferred into escrow for card spending.
Moving funds to escrow reduces the wallet's spendable balance onchain; the same
amount cannot remain available in both balances. Show the transfer as pending
until escrow finality and any sandbox funding step complete, then credit card
capacity once. A deposit into the ordinary wallet alone never credits a card.

Reuse wallet signing, submission, and status behavior for the user-initiated
transfer. This plan adds no new general transaction recovery subsystem; an
uncertain transfer remains pending and must not prompt a blind second transfer.
Existing direct stablecoin spending stays supported. Agent-controlled direct
merchant transfers are outside this card path; its single payment-rail variant
remains `AirwallexSandboxCard`.

## Minimal records and typed boundaries

- **Funding credit:** exact customer/escrow binding, finalized transfer identity,
  token amount, credited card-currency amount, and credit state. One finalized
  transfer produces at most one credit.
- **Agent Grant:** owner, funding account, agent, merchant, fixed budget,
  per-purchase limit, approval threshold, expiry, configured payment rail, and
  active/revoked state. Create, inspect, and revoke; rules remain immutable.
- **Purchase:** immutable commercial intent, grant, exact approval when required,
  budget/funding claim, operation identity, and card payment state. Link provider
  events through existing audit/storage patterns.

Keep the universal commercial schema and configurable payment-rail structures.
Implement one variant each for this flow:

```rust
enum PurchaseIntent {
    MerchantCheckout(MerchantCheckout),
}

enum PaymentRail {
    AirwallexSandboxCard(AirwallexSandboxCardConfig),
}

enum PaymentExecution {
    AirwallexSandboxCard(AirwallexSandboxCardExecution),
}
```

`MerchantCheckout` contains the merchant, immutable quote reference/digest,
expiry, reviewed items, and exact price breakdown and total in card currency.
Parse merchant/UCP checkout data once at the boundary. Preserve approval-relevant
cart and delivery details; changed quotes require a new purchase and approval.
A full UCP implementation and generic policy engine are unnecessary.

Rail configuration binds the supported sandbox account/environment and currency.
The admitted execution binds one purchase, card allocation, amount, currency,
and stable operation identity. Keep provider credentials in the adapter. Reuse
existing identity, amount, authorization, and lifecycle types with narrow builders
and exhaustive handling. No unused rail variants, provider registry, or routing UI.

## Finalized escrow deposit → one funding credit

Select the supported testnet, token, finality rule, and an escrow deposit mechanism
with authoritative customer attribution before implementing. Reuse an existing
controlled deposit facility if available; missing escrow support is an explicit
implementation prerequisite. A freely withdrawable source-wallet balance cannot
serve as escrow backing. Withdrawals and collateral release are outside the demo.

Verify chain, token, escrow recipient, customer attribution, amount, and finality
from authoritative chain data. Ignore browser success claims. Deduplicate by exact
transfer identity, such as chain + transaction hash + log index for an EVM token
transfer. Polling/refresh is sufficient; pre-final deposits remain pending.

Atomically insert the consumed deposit identity and credit the customer's funding
ledger. A unique constraint and conditional state transition prevent re-crediting
on replay, concurrent processing, or restart. Bind the identity to its customer
and amount so it cannot be reused with altered details.

Use one labeled test conversion rate with deterministic integer arithmetic and
explicit precision handling. The credited balance is Seams' allocation against
sandbox issuer capacity; escrow tokens are not sent to Airwallex. R130D supplies
sandbox funding evidence. Where an external funding simulation is needed, keep
credit pending until its outcome is confirmed; ambiguous responses require lookup
before retry. No real conversion or liquidity pool is required for this demo.

## Atomic budgets and idempotent card accounting

Card spending capacity represents available funding. An agent budget represents
permission to use it. Multiple agents share the funding account; granting budgets
does not create additional money.

In one database transaction, claim a purchase, validate the active grant and exact
approval, and reserve its amount against both the grant and account capacity:

```text
spent + reserved + purchase amount <= grant budget
purchase amount <= account available card capacity
```

Use database-enforced conditional writes and unique operation identity. Failed
admission rolls back both reservations and the claim. No network calls inside the
transaction; no process-local locks or separate read/check/write budget checks.
Approval can cross its threshold within the hard limits, never expand authority.
Serialize revocation and admission using existing authorization/fencing patterns.

One purchase has one payment operation even if callers supply new idempotency
keys. Bind request keys to authenticated scope and immutable content. Reuse with
different content fails; duplicates return the existing result or pending state.
Persist operation identity before calling Airwallex. An ambiguous provider response
never triggers a blind second authorization, funding request, or card creation.
Use supported provider idempotency or lookup; if the simulator cannot resolve an
uncertain request, retain it as unknown instead of creating another payment.

Airwallex owns card authorization/capture processing. Seams still deduplicates and
reconciles events into its own ledger. Apply each financial transition and its
processed marker atomically. Event receipt alone is not proof it was applied.
Authorization holds retain capacity; confirmed capture commits spend once;
definitive unpaid failure or reversal releases the applicable hold once. Refunds
restore funding capacity without automatically renewing the agent budget.
Unknown outcomes retain claims; duplicate or reordered events must not debit,
release, or refund twice. Query provider state when events are inconclusive.

Reuse existing operation claims and audit. Wallet Session quotas are a pattern
for atomic admission, not an implemented monetary ledger. Purchase status reads
can reconcile against R130D provider reads; no new background service is required.

## Delivery and proof

- [ ] Implement verified escrow deposit ingestion and atomic, one-time funding
      credit. Demonstrate replay and concurrent processing cannot credit twice.
- [ ] Implement grant create/inspect/revoke, typed purchase proposal, exact owner
      approval, and atomic reservation of budget plus shared account capacity.
- [ ] Integrate R130D's card events with idempotent accounting. Demonstrate duplicate
      Pay, webhook retries, and an interrupted provider request without a second
      credit, charge, or release.
- [ ] Complete one shared A/B/C/D demo: deposit, wait for finality, see card capacity,
      approve and pay a purchase, reload the result, and revoke agent authority.
- [ ] Verify two competing purchases cannot exceed one grant or shared account
      capacity. Add the required lifecycle type fixtures and narrow operating
      assertions; update intended-behaviour docs with implementation.

Complete when finalized deposits credit once, concurrent spending remains bounded,
and provider outcomes reconcile once. Direct onchain merchant payments, automated
sweeps, serialized signed-transaction storage, nonce recovery, additional rails,
withdrawals, production treasury, and full dashboards are outside this plan.

# Refactor 130D — Experimental stablecoin card funding sandbox

Date created: August 29, 2026
Last revised: September 8, 2026

Status: experimental sandbox adapter required for the shared R130A–D demo; consumes [R130A purchase admission](refactor-130A-agent-expense-domain.md).

## Direction and scope

Seams aims to provide stablecoin-backed funding and settlement infrastructure
for Airwallex and other virtual-card providers. Seams would own the funding
allocation, liquidity accounting, reconciliation, and agent spending controls.
Card partners would provide issuing and card-network processing. Production
responsibilities and funds movement depend on the eventual partner agreements.

R130D tests this role with one Airwallex sandbox account, one currency, and one
virtual card per approved purchase. Use real testnet stablecoin deposits and simulated issuer funding alongside
actual provider sandbox APIs. No real cash pool, mainnet customer funds, live
cards, or live conversion/settlement is required.
Airwallex is the first experimental adapter; do not build a multi-provider
framework or select a production funding model during this proof.

## One operating path

```text
User funds their Seams wallet and moves a selected amount into escrow
  -> R130A verifies finality and records one funding credit
  -> Seams shows card spending capacity against sandbox issuer funds
  -> user clicks Pay for an admitted purchase in the demo checkout
  -> Airwallex issuing simulator authorizes and captures by card ID
  -> R130A reconciles card events, account capacity, and agent budget
  -> demo shows receipt and updated balances
```

R130A owns chain observation, customer attribution, finality, deposit deduplication,
and funding accounting. This adapter supplies provider evidence and implements
sandbox card calls. Do not duplicate escrow ingestion or funding ledgers here.

Use a fixed, labeled test conversion rate. Airwallex's deposit simulation can
credit a sandbox Global Account when enabled; otherwise allocate against its
existing test Wallet balance. Report which path ran. Provider test funds alone
cannot credit a customer's balance; R130A requires a finalized escrow deposit.
If a funding call has an ambiguous response, reconcile it before retrying and
leave the corresponding credit pending. This simulates the fiat bridge;
Airwallex does not receive testnet tokens.

Build one small checkout in the existing demo app: order summary, sandbox card
selection, Pay, and receipt/status. Reuse the R130C views and R130A admission,
including exact approval when required. The backend invokes Airwallex's issuing
simulation by card ID after admission. Keep this simulator route sandbox-only.
No PAN/CVV entry or separate acquiring integration is needed.

Airwallex documents acquiring test-card checkout and issued-card simulation as
separate testing surfaces. A hosted checkout that charges this issued sandbox
card has not been verified. The first implementation uses the explicit simulator
flow above and labels it “Sandbox checkout.” A successful acquiring test payment
alone cannot prove the issued card's balance was debited.

Reuse R130A funding, grant, and purchase records. Add only provider allocation
and event evidence needed to link the card and payment. Retries
must reconcile ambiguous provider funding or payment results before attempting
another credit or charge. Funding accounting creates no second agent budget.

## Sandbox adapter

- Implement R130A's single sandbox-card execution variant. Consume
  its exact grant, immutable purchase, approval when required, budget claim, and
  operation identity. Blocked or pending purchases
  cannot create or dispatch a card payment.
- Require a fixed allowed sandbox origin and complete sandbox credentials.
  Normalize provider data once, use bounded calls, and keep secrets out of logs.
  Simulate transactions by card ID; Seams never handles PAN/CVV.
- Create a cardholder and purchase-bound card under stable request identity.
  Reconcile uncertain creation before retrying. Close the card after the run.
- Verify webhook signatures and timestamp bounds before parsing. Keep durable,
  retryable event processing so duplicates and reordered events converge.
- Reconcile capture, reversal, linked refund, and unknown outcomes against provider
  reads. Commit budget on authoritative payment success, release definitive
  unpaid failures, and retain uncertain claims until resolved. Refunds restore
  the applicable funding balance without automatically renewing the agent budget.

Use the provider controls available in the sandbox and record their limits.
Remote authorization is an optional experiment, not a completion dependency.
Without it, demonstrate Seams admission before simulation and the available card
controls; report any unproven enforcement of subsequent provider authorizations.
Unknown or unsupported events remain unresolved for inspection rather than being
silently treated as success. No merchant checkout automation is required.

## Proof and completion

- [ ] Fund the Seams wallet, move a selected amount into escrow, and show pending
      then confirmed card funding through R130A. Reload or replay detection without crediting twice.
- [ ] Create a sandbox card backed by the credited allocation and show its spending
      balance. Demonstrate pending or already-allocated funds cannot be reused.
- [ ] Pay for one demo order through R130A admission and the Airwallex issuing
      simulator. Show a receipt, provider transaction reference, and reduced
      spending capacity after capture; reload to verify durable state.
- [ ] Demonstrate insufficient-budget denial, duplicate Pay without a second
      charge, reversal, linked refund, and reconciliation of an ambiguous outcome.
      Use additional simulated transactions only where needed.
- [ ] Close the card after the run and retain safe request IDs and a short account
      of the real testnet/provider operations, simulated bridge, and limitations.

Complete when a user can move testnet stablecoins from their wallet into escrow,
see card spending
capacity credited, and spend it in the demo checkout with reconciled records.
A script-only simulation is insufficient. Use one opt-in operating test and the
existing demo app; no full dashboard or background reconciliation service.
Missing core sandbox issuing/simulation access blocks the proof. Missing optional
capabilities remain documented limitations.

## Beyond the experiment

Live custody, conversion, liquidity sourcing, collateral/withdrawal controls,
issuer funding, settlement obligations, customer onboarding, and operational
responsibilities need separate design and partner agreement. Real merchant
checkout needs a supported credential handoff. This experiment proves neither
production funding nor unrestricted card acceptance and requires no production
launch work. Its evidence informs the next plan for Seams' funding layer.

## Provider references

- [Sandbox environment](https://www.airwallex.com/docs/developer-tools/sandbox-environment)
- [Deposit simulation](https://www.airwallex.com/docs/api/simulation/deposits/create)
- [Issued-card simulation](https://www.airwallex.com/docs/api/simulation/issuing/create)
- [Acquiring test cards](https://www.airwallex.com/docs/payments/test-and-go-live/test-card-numbers)

Reviewed September 8, 2026. Confirm account capabilities and API versions when
implementing; hosted checkout interoperability remains unverified.

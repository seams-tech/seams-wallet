# Refactor 130D — Airwallex cards, then Wise, then bank transfers

Date created: August 29, 2026
Last revised: September 15, 2026

Status: implementation plan. Complete Airwallex card payments first, add Wise
second, and traditional bank transfers third. All phases consume
[R130A](refactor-130A-agent-expense-domain.md) authority and accounting.

## Delivery order

Card checkout is the first product path for broad merchant purchasing. Wise
extends it to transfers, followed by a selected traditional banking integration.
Implement each phase around the same proposal, approval, and payment services.

| Priority | Integration                | Required milestone                                                                                                              |
| -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Airwallex card payments    | Wallet-funded sandbox card proposal, exact approval, authorization/capture, receipt, and reconciliation.                        |
| 2        | Wise transfers             | Owner-authorized account and recipient, current quote, source debit/fees, and reviewable proposal; verify execution separately. |
| 3        | Traditional bank transfers | One selected bank/payment API and supported transfer route, exact beneficiary-bound proposal; verify execution separately.      |

Later phases do not gate the first card milestone. Add provider branches as their
phase is implemented. Bank transfer names an operation; Wise and Airwallex name
providers that can reach payment rails. Keep supported combinations explicit.

Proposal preparation is read/quote work plus a local Seams record. Owner-managed
account and recipient enrollment are separate from agent proposal tools. Provider
mutations that create a payable transfer, funding request, or card charge belong
to separately authorized execution.

## Shared adapter boundary

Resolve provider credentials to the exact owner, environment, and source account.
Normalize supported capabilities, saved recipients, balances, fees/quotes, and
payment evidence at the boundary. Use the provider's supported authorization
method and least required permissions. Keep secrets and sensitive bank details
out of agent context, browser bundles, logs, and public read models.

Account access does not establish agent authority. Every mutation that can move
money consumes R130A's admitted payment with stable operation identity and exact
terms. Do not accept a caller-selected provider URL, account, or raw request body.
Keep test and live connections separate through precise connection state.

Represent proposal preparation and execution capabilities separately. Missing
execution access can leave proposal support usable; missing required preparation
data must return an explicit unavailable result. Owner/provider authentication
requirements become action-required states. Approval alone cannot imply provider
submission, and submission alone cannot imply payment completion.

Persist references before subsequent provider steps. Use supported idempotency
and lookup to recover interrupted creation, funding, and submission. Each step
retains stable identity under one payment execution. Verify provider event
signatures using that provider's protocol, including replay checks where supported.
Apply event effects durably once; reconcile duplicate, reordered, or inconclusive
events with provider reads. R130A owns reservations and journal transitions.

## Priority 1 — Airwallex card payments

Preserve one testnet stablecoin, controlled escrow deposit path, card currency,
merchant, and Airwallex sandbox account. R130A verifies deposit finality, attribution,
and one-time credit. R130D supplies sandbox funding evidence using enabled deposit
simulation or existing sandbox funds, explicitly recording which path ran. The
issuer bridge uses a labeled test conversion rate; testnet tokens never become
real fiat or another provider account balance.

Create a cardholder and purchase-bound card under stable identities after admission.
Build the sandbox checkout in the existing reference app and invoke the issued-card
simulator by card ID. Seams handles no PAN/CVV in this path. Verify authorization,
capture, reversal, linked refund, and unknown outcomes; close the card after the run. Actual merchant
acceptance and credential handoff require separate evidence.

Record available issuer controls and their limits. Remote authorization remains
an optional sandbox experiment. A pre-simulation Seams check proves admission to
that operation; later card authorizations need their own issuer-control evidence
before claiming end-to-end enforcement for live cards.

Japan is a target market. As reviewed September 15, 2026, the
[Airwallex Japan card page](https://www.airwallex.com/ja-jp/spend-management/cards)
states that corporate cards and global accounts are currently unavailable in
Japan. Confirm contracting-entity, cardholder, and issuing-program eligibility
before a Japan launch. Merchant acceptance and local issuing eligibility need
separate evidence; sandbox success cannot establish either.

## Priority 2 — Wise transfers

Use [Wise Send Money](https://docs.wise.com/guides/product/send-money) for the
quote, recipient, transfer, and funding flow. Select the Wise-supported account
integration model before implementing authentication; access to one business
profile cannot imply permission to act for unrelated customers.

Prepare the proposal using the exact profile, saved recipient, funding method,
and [current quote](https://docs.wise.com/guides/product/send-money/quotes).
Bind source debit, recipient amount, currency pair, fees, and expiry. Recipient
or funding-method changes require fresh terms. An expired quote cannot be silently
replaced under an existing approval.

Preparation stops before transfer creation and funding. Sandbox execution performs
those steps only after R130A admission and records their references independently.
Recover an uncertain funding result against the same transfer. Map Wise processing
and returned-funds evidence through the shared payment lifecycle.

Target one Japan-relevant transfer flow. Wise documents
[JPY transfers](https://wise.com/help/articles/2932156/guide-to-jpy-transfers),
with requirements that depend on account location and funding method. Verify the
actual business profile, recipient details, currency pair, limits, and permitted
API operations. [Business API tokens](https://docs.wise.com/guides/developer)
have limited endpoint access; Japanese transfer availability alone cannot prove
all required automation is enabled. Complete proposal preparation before offering
separately verified sandbox execution.

## Priority 3 — Traditional bank transfers

Select one concrete bank/payment API, account authorization method, source currency,
beneficiary country, and supported transfer rail before implementation. Airwallex
payouts may be evaluated alongside its card account; existing issuing access does
not establish payout access. Do not build a generic bank connector or promise
coverage of every ACH, SEPA, local-transfer, or wire route.

Prepare an exact account/beneficiary-bound proposal with recipient amount, source
debit, fees, currency, reference, and payment method. Resolve beneficiary details
from owner-enrolled provider records. Preserve any provider-required human approval.
A requested payment date is a proposal term; autonomous scheduling is separate work.
Document the selected API's acceptance, processing, completion, failure, and return
semantics before implementing execution.

## Delivery and proof

### Phase 1: Airwallex

- [ ] Confirm sandbox issuing access, supported currency, and test facilities.
      Record eligibility for the target Japan business/cardholder separately.
- [ ] Complete the wallet-to-escrow funding and card proposal/approval journey.
      Prove one funding credit per finalized deposit and bounded shared capacity.
- [ ] Authorize/capture one purchase, show a receipt after reload, reconcile
      reversal/refund and unknown outcomes, and close the sandbox card.
- [ ] Record merchant acceptance, credential handoff, and issuer-control evidence
      still required before live card execution.

### Phase 2: Wise

- [ ] Confirm the Japan-relevant business profile and its account/API permissions.
- [ ] Prepare a provider-backed transfer proposal with exact recipient, source
      debit, fees, currency conversion, and expiry, without submitting a transfer.
- [ ] Show changed/expired terms, denied authority, and required provider actions.
      Verify creation, funding, status recovery, and returns in sandbox before
      offering execution.

### Phase 3: Traditional banking

- [ ] Select the concrete banking API, account authorization, and transfer route.
- [ ] Prepare a provider-backed beneficiary/account-bound proposal through the
      shared tools and owner approval flow.
- [ ] Verify provider submission, processing, failure/return, and required human
      authorization in its test environment before offering execution.

For every adapter with execution, prove insufficient funds, duplicate calls/events,
and ambiguous outcomes under the same durable payment identity. Report evidence
per phase and adapter; unsupported execution cannot be marked complete. Missing
account/API access is a concrete integration blocker. Local mocks support focused
tests and cannot replace provider-backed integration evidence. Use the existing
composed test harness and UI throughout.

Live execution requires confirmed account/program access, funding and settlement
responsibilities, and verified provider controls. Live custody, conversion,
liquidity, withdrawal, and unattended financial operations belong to subsequent
delivery work.

## References

Reviewed September 15, 2026. Confirm capabilities and API versions against the
actual connected accounts during implementation.

- [Airwallex Japan cards](https://www.airwallex.com/ja-jp/spend-management/cards)
- [Airwallex sandbox](https://www.airwallex.com/docs/developer-tools/sandbox-environment)
- [Airwallex issued-card simulation](https://www.airwallex.com/docs/api/simulation/issuing/create)
- [Airwallex remote authorization](https://www.airwallex.com/docs/issuing/card-controls/remote-authorization)
- [Wise Send Money](https://docs.wise.com/guides/product/send-money)
- [Wise quotes](https://docs.wise.com/guides/product/send-money/quotes)
- [Wise JPY transfers](https://wise.com/help/articles/2932156/guide-to-jpy-transfers)
- [Wise API access](https://docs.wise.com/guides/developer)
- [Airwallex payout network](https://www.airwallex.com/docs/payouts/payout-network)

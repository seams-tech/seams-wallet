# Refactor 130D — Wise business payments, then Airwallex and bank transfers

Date created: August 29, 2026
Last revised: September 15, 2026

Status: implementation plan. Deliver Wise payments for Japanese businesses first,
Airwallex cards for eligible programs second, and traditional bank transfers third.
All phases consume [R130A](refactor-130A-agent-expense-domain.md) authority and
accounting.

## Delivery order

Support for Japanese companies is a launch requirement. Wise is the first account
and payment integration. Start with transfer proposals and exact human approvals;
validate automated transfer execution and Wise card issuance as separate capabilities.
Implement each phase around the same proposal, approval, and payment services.

| Priority | Integration                | Required milestone                                                                                                                                                                  |
| -------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Wise business payments     | Eligible Japanese business profile, owner-authorized recipient, quote, source debit/fees, reviewable proposal, and exact approval; verify execution and card API access separately. |
| 2        | Airwallex card payments    | Eligible account/program and wallet-funded sandbox card proposal, exact approval, authorization/capture, receipt, and reconciliation.                                               |
| 3        | Traditional bank transfers | One selected bank/payment API and supported transfer route, exact beneficiary-bound proposal; verify execution separately.                                                          |

The Wise milestone requires no Seams escrow deposit or Airwallex account. Later
phases do not delay it. Add provider branches as their phase is implemented. Bank
transfer names an operation; Wise and Airwallex name providers that can reach
payment rails. Keep supported combinations explicit.

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

## Priority 1 — Wise business payments for Japanese companies

### Account eligibility and API access

Wise explicitly supports [Japanese businesses](https://wise.com/help/articles/2972549/how-do-i-verify-my-japanese-business),
including KK and GK companies, subject to business eligibility and verification.
The representative must own the account and reside in Japan. Human onboarding
establishes the business profile and authorized account access before agent use.

Select the [Wise-supported integration model](https://docs.wise.com/guides/developer)
before implementing authentication. Standard tokens serve the account owner's own
business; a customer-facing integration requires the appropriate partner access.
Access to one profile cannot authorize payments for unrelated customers.

Wise's [standard business API tokens](https://docs.wise.com/guides/developer/auth-and-security/personal-api-token)
support quotes, recipients, transfer creation, and tracking. For Japanese accounts,
API transfer funding and balance statements are unavailable through these tokens.
Expose required owner action in Wise and keep automatic execution unavailable
unless broader access is confirmed. Sandbox permissions cannot establish Japanese
production permissions. Record actual balance-read capabilities before enabling
R130A admission.

### Transfer proposals and separately verified execution

Use [Wise Send Money](https://docs.wise.com/guides/product/send-money) for the
quote, recipient, transfer, and funding flow. Prepare the proposal using the exact
Japanese business profile, saved recipient, funding method, and
[current quote](https://docs.wise.com/guides/product/send-money/quotes).
Bind source debit, recipient amount, currency pair, fees, and expiry. Recipient
or funding-method changes require fresh terms. An expired quote cannot be silently
replaced under an existing approval.

Preparation stops before provider transfer creation and funding, including when
Wise describes an unfunded transfer as a draft. Those provider mutations belong
to separately authorized execution. With verified access, sandbox execution
performs them after R130A admission and records their references independently.
Recover uncertain funding against the same transfer and map processing and return
evidence through the shared payment lifecycle.

Prove one supported route with a Japanese business as the payer. Record recipient
country, currency pair, funding method, limits, and permitted API operations.
[JPY transfer availability](https://wise.com/help/articles/2932156/guide-to-jpy-transfers)
depends on account location and funding method. Confirm any intended domestic
JPY route explicitly. Show provider action requirements and an inspectable approved
proposal while execution remains unavailable.

### Wise business debit cards

Wise lists Japan for [business cards and digital cards](https://wise.com/help/articles/2935775/can-my-business-get-a-wise-card).
Validate Wise as the first card candidate for Japanese businesses. Account/card
availability and [programmatic card issuance](https://docs.wise.com/guides/product/issue-cards)
have separate eligibility and API requirements.

Before adding agent card execution, confirm the Japanese business/cardholder
program, funding, card creation/closure, purchase limits, authorization controls,
transaction evidence, and protected credential handoff. Reuse R130A admission and
reconciliation. Publish card execution only after provider-backed proof; the
transfer-proposal milestone remains independently deliverable. Standard debit
card ownership supplies no claim of an enabled agent card API or credit facility.

## Priority 2 — Airwallex card payments for eligible programs

Preserve one testnet stablecoin, controlled escrow deposit path, card currency,
merchant, and Airwallex sandbox account. R130A verifies deposit finality, attribution,
and one-time credit. R130D supplies sandbox funding evidence using enabled deposit
simulation or existing sandbox funds, explicitly recording which path ran. The
issuer bridge uses a labeled test conversion rate; testnet tokens never become
real fiat or another provider account balance.

Create a cardholder and purchase-bound card under stable identities after admission.
Build the sandbox checkout in the existing reference app and invoke the issued-card
simulator by card ID. Seams handles no PAN/CVV in this path. Verify authorization,
capture, reversal, linked refund, and unknown outcomes; close the card after the
run. Actual merchant acceptance and credential handoff require separate evidence.

Record available issuer controls and their limits. Remote authorization remains
an optional sandbox experiment. A pre-simulation Seams check proves admission to
that operation; later card authorizations need their own issuer-control evidence
before claiming end-to-end enforcement for live cards.

As reviewed September 15, 2026, the
[Airwallex Japan card page](https://www.airwallex.com/ja-jp/spend-management/cards)
states that corporate cards and global accounts are currently unavailable in
Japan. Treat standard Japanese corporate card issuance as unsupported. Confirm
contracting-entity, cardholder, and issuing-program eligibility for any proposed
alternative arrangement. Keep Airwallex optional for the Japanese business launch.
Merchant acceptance and local issuing eligibility need separate evidence; sandbox
success cannot establish either.

## Priority 3 — Traditional bank transfers

Select one concrete bank/payment API that supports the target Japanese business
as payer, plus its authorization method, currency, beneficiary country, and
transfer rail before implementation. Airwallex payouts may be evaluated alongside
its card account; existing issuing access does
not establish payout access. Do not build a generic bank connector or promise
coverage of every ACH, SEPA, local-transfer, or wire route.

Prepare an exact account/beneficiary-bound proposal with recipient amount, source
debit, fees, currency, reference, and payment method. Resolve beneficiary details
from owner-enrolled provider records. Preserve any provider-required human approval.
A requested payment date is a proposal term; autonomous scheduling is separate work.
Document the selected API's acceptance, processing, completion, failure, and return
semantics before implementing execution.

## Delivery and proof

### Phase 1: Wise

- [ ] Confirm Japanese business eligibility and a verified payer profile; document
      the supported owner-account or partner access model and actual API permissions.
- [ ] Prepare a provider-backed transfer proposal with exact recipient, source
      debit, fees, currency conversion, and expiry, without creating a transfer.
- [ ] Complete the Console and agent approval journey; show changed/expired terms,
      denied authority, funding unavailable, and required provider actions.
- [ ] Verify creation, funding, recovery, and returns in sandbox before offering
      execution. Record Japanese production funding access as a separate gate.
- [ ] Record Wise card API eligibility and available controls for Japanese
      businesses. Keep agent card execution unavailable until separately proven.

### Phase 2: Airwallex

- [ ] Confirm sandbox issuing access, supported currency, and test facilities.
      Confirm the actual business/cardholder program's eligibility separately.
- [ ] Complete the wallet-to-escrow funding and card proposal/approval journey.
      Prove one funding credit per finalized deposit and bounded shared capacity.
- [ ] Authorize/capture one purchase, show a receipt after reload, reconcile
      reversal/refund and unknown outcomes, and close the sandbox card.
- [ ] Record merchant acceptance, credential handoff, and issuer-control evidence
      still required before live card execution.

### Phase 3: Traditional banking

- [ ] Select the concrete banking API, account authorization, and transfer route.
      Confirm support for the target Japanese payer company.
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

- [Wise Japanese business verification](https://wise.com/help/articles/2972549/how-do-i-verify-my-japanese-business)
- [Wise business card availability](https://wise.com/help/articles/2935775/can-my-business-get-a-wise-card)
- [Wise Send Money](https://docs.wise.com/guides/product/send-money)
- [Wise quotes](https://docs.wise.com/guides/product/send-money/quotes)
- [Wise JPY transfers](https://wise.com/help/articles/2932156/guide-to-jpy-transfers)
- [Wise API access](https://docs.wise.com/guides/developer)
- [Wise standard business API tokens](https://docs.wise.com/guides/developer/auth-and-security/personal-api-token)
- [Wise card issuance](https://docs.wise.com/guides/product/issue-cards)
- [Airwallex Japan cards](https://www.airwallex.com/ja-jp/spend-management/cards)
- [Airwallex sandbox](https://www.airwallex.com/docs/developer-tools/sandbox-environment)
- [Airwallex issued-card simulation](https://www.airwallex.com/docs/api/simulation/issuing/create)
- [Airwallex remote authorization](https://www.airwallex.com/docs/issuing/card-controls/remote-authorization)
- [Airwallex payout network](https://www.airwallex.com/docs/payouts/payout-network)

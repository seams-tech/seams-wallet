# Refactor 130A — Agent payment proposals, authority, and accounting

Date created: August 29, 2026
Last revised: September 15, 2026

Status: implementation plan. R130A–D deliver a shared proposal and approval flow
for business payments, with separately verified sandbox execution.

## Direction and ownership

An owner connects a funding account, grants an agent bounded authority, and
reviews proposed payments. Seams enforces the grant and records the outcome.
Implement in this order:

1. **Wise business payments:** connect an eligible Japanese business account and
   deliver transfer proposals, exact approvals, and durable status first. Verify
   transfer execution and Wise card API access separately.
2. **Airwallex card payments:** add the wallet-funded sandbox checkout, execution,
   and reconciliation journey for eligible account/issuing programs.
3. **Traditional bank transfers:** add one selected banking integration.

Support for Japanese companies is a launch requirement. The first milestone uses
Wise account funds and requires no wallet deposit or Airwallex issuing access.
Each phase has its own completion evidence. R130D records Japan account eligibility,
the standard Wise API's funding limits, and access required for automated execution.

```text
Owner connects an account and grants spending authority
  -> agent proposes a payment with recipient, amount, and purpose
  -> Seams resolves account access and obtains provider payment terms
  -> Seams records the policy decision and exact approval when required
  -> separately authorized execution reserves budget and funding capacity
  -> provider processes the payment
  -> Seams reconciles the result and Console displays the evidence
```

[R130B](refactor-130B-agent-connections.md) owns authenticated agent access,
[R130C](refactor-130C-agent-expense-console.md) owns the Console and embedded
experience, and [R130D](refactor-130D-wise-and-payment-rails.md) owns provider
integrations. [Spec 8](spec-8-agent-authority-spending-and-payment-rails.md) owns
the proposed shared architecture.

Implement hosted payment services and composed tests in `seams-monorepo`. Keep
Wallet custody, signing, and reusable Wallet contracts in `seams-wallet`; private
services consume its published packages. Reuse existing Console identity,
authorization, audit, journal, and reservation patterns.

## Minimal domain

Distinguish the account-owning business/customer, its authorized human, the
integration tenant, and the agent. Enrollment establishes their relationship.
An organization ID or provider account ID alone proves no authority over funds.

| Record            | Required meaning                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Funding account   | Owner, tenant/environment binding, currency, provider connection, and exact provider account or escrow-backed allocation.                                                 |
| Agent Grant       | Owner, agent, funding account, allowed operation/provider, recipients or merchant, fixed budget, per-payment limit, approval threshold, expiry, and active/revoked state. |
| Payment proposal  | Immutable operation, account, recipient, amount, purpose/reference, grant, and prepared payment terms.                                                                    |
| Payment approval  | Authorized human, exact proposal/terms digest, decision, and expiry.                                                                                                      |
| Payment execution | One proposal, durable operation identity, admitted terms, reservations, provider references, and execution state.                                                         |

Grant rules are immutable; changed rules require a new grant. Budget currency is
the funding account's debit currency. Count total source debit, including fees,
against both per-payment and grant limits. Use integer minor units and explicit
currency precision. Cross-currency proposals preserve source and recipient amounts,
fees, exchange rate, quote identity, and expiry.

Separate operation from provider. Start with Wise bank transfer terms and a
Japanese business source profile. Add merchant checkout and its cart/delivery
details for Airwallex in phase 2 and the selected banking provider in phase 3.
Wise business card availability does not establish access to card APIs; add that
operation only after R130D verifies the program and controls. Add types when their
operation is implemented. Use branch-specific builders for supported combinations;
independent enums must not admit invalid combinations.

Parse requests and provider data once. Core functions consume precise types with
required identity and lifecycle fields. Use discriminated states for preparation,
approval, account availability, and execution. Incomplete or expired terms cannot
construct an executable payment. Add type fixtures for invalid branch combinations,
object construction, and broad spreads. No generic provider registry, policy
language, or transport framework is needed.

## Proposal and approval

Creating a proposal records intent and may obtain a quote or validate a saved
recipient. It cannot create a payable transfer, fund a transfer, charge a card,
or submit a payout. Results distinguish blocked, pending approval, and ready for
admission. Missing capabilities or payment terms produce an explicit preparation
failure; guessed terms cannot become ready.

Approval binds account, operation/provider, beneficiary and destination, source
debit, recipient amount, fees, conversion terms, reference, and applicable checkout
details. A mutable provider default destination cannot alter an approved payment.
Changed approval-bound terms require a new proposal and any required approval;
expired quotes require fresh preparation. The provider call must execute admitted
terms or fail without silently accepting new terms.

Approval satisfies its threshold within hard grant limits. Recheck current
connection, grant, owner authority, and terms at admission. Serialize revocation
with admission: revocation blocks new admissions, including previously approved
proposals. Admitted operations still require reconciliation; provider cancellation
has separate semantics.

## Funding accounts

### Connected Wise and bank accounts

Wise is the first funding account. The authorized human establishes the Japanese
business profile and provider access. A Seams account connection cannot substitute
for Wise's business verification or enable unsupported API operations.

Resolve each connection to an owner-authorized account and supported currency and
capabilities. Connecting an account creates no funding credit. Keep provider
balances, Seams reservations, and agent budgets distinct. Platform billing credits
cannot fund a customer's payment.

Use one canonical local funding account per provider account/currency so multiple
agents and connections share its reservation boundary. Refresh provider availability
before admission and reconcile provider holds with unresolved local claims without
counting either twice. Local reservations bound Seams-originated payments; they
cannot lock funds against external spending. Provider acceptance and settlement
remain authoritative. Unavailable balance evidence blocks automated admission in
the first implementation. A proposal may remain reviewable while balance access
or transfer funding requires provider action or additional API permissions.

### Wallet-funded card capacity — phase 2

Retain the testnet wallet-to-escrow path for Airwallex sandbox cards. The owner
selects an amount and submits through existing Wallet APIs. Verify chain, token,
escrow recipient, customer attribution, amount, and finality from chain evidence.
Deduplicate exact transfer identity and atomically record one funding credit.
Ordinary wallet deposits cannot credit card capacity.

Select one testnet, token, finality rule, and controlled escrow facility before
implementation. Pending deposits stay pending. Use a labeled fixed test conversion
rate with integer arithmetic. Credit capacity after finalized escrow funding and
confirmed sandbox funding evidence. The issuer bridge is simulated; Airwallex
receives no testnet tokens. This branch creates no Wise or bank balance.
Withdrawals and live conversion remain separate work.

## Admission, retries, and accounting

In one local transaction, claim the proposal and reserve its total debit against
the grant and account's reconciled Seams spending capacity:

```text
spent + reserved + proposed debit <= grant budget
proposed debit <= available account capacity
```

Use conditional writes and uniqueness constraints. Failed admission rolls back
both reservations and the claim. Keep network calls outside the transaction.
Wallet Session quotas supply admission patterns; monetary accounting requires its
own journal and reservations.

One proposal has one execution even when callers change retry keys. Bind request
identity to authenticated scope and immutable content. Persist operation identity
before provider mutations. Reuse with changed content fails; duplicates return
the existing execution. Reconcile ambiguous mutations before retrying. Unsupported
provider recovery leaves the same operation unknown with its reservation held.

Normalize provider evidence into pending, succeeded, definitively failed, or
unknown execution states, preserving the provider's actual processing status.
Request acceptance alone cannot prove settlement. Card authorization retains a
hold; confirmed capture commits spend. Transfers commit against the provider's
documented payment outcome. Apply commit, release, and linked return/refund postings
atomically with processed markers. Duplicate or reordered events converge. Returned
funds restore applicable availability without renewing consumed agent budget. A
return after success stays linked to the original payment.

Use verified events and status-triggered provider reads for the first proof.
Persist unresolved work for inspection after reload. Autonomous scheduling and a
new background reconciliation service remain later work.

## Delivery and proof

- [ ] Implement account bindings, immutable grants, prepared proposals, exact
      approvals, and independently authorized execution admission.
- [ ] Phase 1: bind an eligible Japanese Wise business profile and prepare
      transfer proposals through the complete grant and exact approval flow.
      Keep funding/action-required and execution availability explicit.
- [ ] Phase 2: prepare and execute an Airwallex sandbox card purchase through
      wallet funding, grant, approval, and reconciliation for eligible programs.
- [ ] Phase 3: add proposals through one selected traditional banking integration.
- [ ] Prove cross-owner/account/recipient isolation and denial after revocation,
      changed terms, expired quotes, or insufficient authority.
- [ ] Prove competing payments stay within shared local allocations and budgets;
      validate external balance changes and provider rejection separately.
- [ ] Prove escrow deposits credit once and never fund another account branch.
- [ ] Reconcile sandbox execution without duplicate payment, debit, release, or
      refund; retain unknown outcomes across reload and retries.

Complete phase 1 with reviewable Wise proposals for a Japanese business through
one owner/agent journey. Then deliver the eligible Airwallex sandbox card path
and traditional bank proposals in order. Proposal preparation moves no money.
Record execution evidence separately under R130D; Wise's standard Japanese
business API access cannot establish automated transfer funding or card issuance.
Live banking, issuing, settlement, and agent-controlled direct onchain merchant
payments require separate delivery work.

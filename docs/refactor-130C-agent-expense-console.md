# Refactor 130C — Agent payments in Console and embedded apps

Date created: August 29, 2026
Last revised: September 15, 2026

Status: implementation plan; consumes the
[R130A domain](refactor-130A-agent-expense-domain.md) and
[R130B tools](refactor-130B-agent-connections.md).

## Goal

Make Wallet Console the human control surface for agent-proposed business
payments. Owners connect accounts, grant budgets, review exact payments, and
inspect outcomes. Embedded apps can present the same server read models and
approval actions within shopping or business workflows.

Deliver Wise transfer proposals for Japanese businesses first, the eligible
Airwallex card journey second, and traditional bank proposals third. Add views with
their phase. Implement in the private `apps/wallet-console` and existing server
packages. Reuse Console components, authentication, scope selection, audit, and
approval patterns.

## First owner journey

1. Sign in and select the account-owning Japanese business/customer. Connect its
   verified Wise profile through supported owner authorization. Show account
   readiness and permitted operations. The account uses its own funds; the first
   journey requires no wallet deposit. Add Airwallex wallet-to-card sandbox
   funding in phase 2 for eligible programs and a bank account in phase 3.
2. Enroll an agent and create an expiring grant: funding account, permitted
   operations/providers and recipients, fixed budget, per-payment limit, and
   approval threshold. Show proposal-only versus execution access clearly.
3. Ask the agent to prepare a Wise supplier transfer. Extend this interaction to
   an Airwallex card purchase in phase 2 and a bank transfer in phase 3.
   The backend prepares authoritative terms for the account, amount, and purpose.
4. Review the policy decision. When required, approve the exact account,
   beneficiary/destination, recipient amount, source debit including fees,
   conversion terms, and reference. Card proposals also show cart and delivery
   details. Expired terms require fresh preparation.
5. Inspect the approved or ready proposal. Execution is a separate authorized
   action offered only when supported by the connected provider. Awaiting execution
   cannot imply that a payment was submitted.
6. When funding requires action in Wise, show that requirement and keep the
   proposal inspectable after reload. Once execution access is verified, follow
   a sandbox transfer through pending, succeeded, failed, or unknown status and
   inspect its provider reference and reconciled budget usage.
7. Revoke the grant and observe denied admission of previously approved proposals.
   Accepted operations retain their status and reconciliation history.

## Minimal Console surfaces

| Surface                | Owner-facing information and actions                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts               | Wise first, eligible Airwallex card sources second, bank accounts third; owner, currency, connection status, observed balance/freshness or unavailable state, reservations, supported operations. |
| Agents                 | Agent, account grants, remaining budget, expiry, proposal/execution access, revoke action.                                                                                                        |
| Payments and approvals | Proposals, policy decisions, exact review, approve/deny, authorized execution, durable status.                                                                                                    |
| Activity               | Agent, approving human when required, decision reason, provider references, outcome, linked returns or refunds.                                                                                   |

Reuse existing routes and add only views needed by this journey. Show integration
settings in payment review when the owner must repair a connection. Agent chat
lives in the host runtime; a new chat system or agent-hosting platform is outside
this implementation.

Embedded apps use the same account, grant, proposal, and approval services. The
host owns conversation, cart, and order presentation. Payment confirmation and
merchant order acceptance remain distinct records.

## State and presentation rules

- Proposal, approval, provider submission, and confirmed outcome have distinct
  states. An approval or successful API request cannot display “Paid.”
- Show source debit, recipient amount, fees, conversion, and quote expiry. Changed
  approval-bound terms require a new proposal and any required approval.
- Separate provider-observed balances, Seams reservations, and spending budgets.
  Display freshness and connection failures; never invent available funds.
- Mask bank details in normal read models. Credentials and full destination data
  stay within their supported collection/storage boundaries.
- Execution retries retain payment identity. Unknown outcomes retain reservations
  and remain visible with an authorized status-refresh action.
- Label sandbox operations and the simulated card funding bridge. Unsupported
  execution remains unavailable; its local proposal stays inspectable.
- Japanese business support is required for the first Wise journey. Show transfer
  funding and card API availability separately from account/card ownership. Wise
  debit card availability alone cannot enable an “Issue agent card” action.

React consumes server-assembled read models and narrow mutations. The server
determines authority. Browser requests carry owner authentication; agent and
provider credentials remain on their respective backends.

## Delivery and proof

- [ ] Expose connected accounts, agent grants, proposals, exact approvals, and
      revocation in Console using existing components and services.
- [ ] Phase 1: complete the Wise account, proposal, and exact approval journey for
      a Japanese business from one agent integration, including the embedded view
      and explicit provider action requirements.
- [ ] Phase 2: add eligible Airwallex cards; phase 3: add traditional bank proposals.
- [ ] Demonstrate preparation and approval without money movement; execute only
      through a separately authorized supported sandbox path.
- [ ] Show denied access, changed/expired terms, provider action required, duplicate
      execution, unresolved outcomes, and reconciled results after reload.
- [ ] Run the shared composed journey in `seams-monorepo` tests. Reuse its harness
      and read its `tests/AGENTS.md` before editing tests.

Complete the owner-facing Wise journey first. Then add eligible Airwallex cards
and traditional bank proposals in order, reusing the same services. Each
milestone must represent execution capability and outcome accurately. Report
adapter sandbox evidence separately under
[R130D](refactor-130D-wise-and-payment-rails.md). A script-only proof is insufficient.

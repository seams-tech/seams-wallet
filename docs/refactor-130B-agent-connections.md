# Refactor 130B — Agent connections and payment tools

Date created: August 29, 2026
Last revised: September 15, 2026

Status: implementation plan; consumes the
[R130A payment domain](refactor-130A-agent-expense-domain.md).

## Goal

Let an agent runtime propose payments under owner-authorized spending grants.
Deliver Airwallex card payments first, Wise transfers second, and traditional bank
transfers third. Reuse the same services for Console and embedded apps. Start with
direct backend API calls and one registered agent integration; add each provider's
account bindings and operations when its phase is implemented.

```text
Owner enrolls integration and grants authority
  -> agent backend authenticates to Seams
  -> Seams resolves owner, agent, connection, account, and grant
  -> agent submits a payment proposal
  -> R130A prepares terms and records policy/approval state
```

Agent runtimes retain conversation, task planning, and business context. Seams
owns authority and durable payment state. Implement hosted connections and tools
in private Console/payment services. Provider account operations remain separate
from Wallet signing protocols.

## Identity and authorization

An integration credential identifies a registered backend actor within one tenant
and environment. Resolve its business/customer, agent, funding account, provider
connection, and grant from server-owned bindings. Caller-supplied IDs are lookup
inputs; they cannot establish account access or customer consent.

Owners connect accounts, enroll agents, create/revoke grants, and approve payments
through an authenticated owner surface. Verify the human's authority for the
account-owning business. A merchant or integration operator cannot grant itself
access to another customer's funds.

Keep three lifecycles distinct:

- **Agent connection:** credential binding, agent, API scopes, expiry, revocation.
- **Provider connection:** owner-bound account access and provider capabilities.
- **Agent Grant:** permission to spend from one account under R130A's limits.

Agent connection revocation denies new agent requests. Provider disconnection or
grant revocation prevents new admissions. Owner inspection and authorized
reconciliation remain available through the appropriate surface. Connection expiry
cannot establish that a pending payment failed.

Backend authentication establishes the registered agent actor. It does not prove
which model generated the request. Bind canonical requests and idempotency to that
actor; a separate agent-signature protocol is unnecessary for the first path.

## Payment tools

| Tool                     | Responsibility                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `get_spending_authority` | Return permitted operations, approved accounts/recipients, limits, remaining budget, and connection readiness.       |
| `propose_payment`        | Prepare an immutable payment and return blocked, pending approval, ready, or an explicit preparation failure.        |
| `get_payment_status`     | Read proposal, approval, execution, and reconciled outcome within authorized scope.                                  |
| `execute_payment`        | Request admission of an existing ready payment by ID; requires separate execution scope and current grant authority. |

A proposal-only connection receives no execution scope. Preparation may read
account capabilities, resolve saved recipients, and obtain quotes; it cannot
submit a payout, create/fund a payable transfer, or charge a card. Owner-managed
recipient enrollment uses provider-supported collection and verification.

Execution accepts the existing payment identity, never replacement terms. Approval
remains an owner operation. The server rechecks grant, exact terms, and required
approval and reserves capacity through R130A before R130D dispatch. Agent tools
cannot approve their own exception, increase a grant, or call arbitrary provider
APIs. Card and transfer actions share admission services.

Every mutation carries stable idempotency identity. Parse credentials and bodies
once; reject cross-tenant, cross-owner, wrong-environment, expired, or revoked
bindings before payment work. Return typed recoverable outcomes: approval required,
terms expired, insufficient budget, connection unavailable, pending payment, or
unknown outcome.

## Credentials and provider access

Reuse scoped credential enrollment, one-time display, secure server representation,
expiry, and revocation. Integrator credentials stay in the integrator backend;
provider credentials stay in private adapters. Neither enters browser bundles,
model context, logs, or public read models.

R130D resolves each provider-supported authorization method. Provider consent
establishes account access; an owner's Seams grant establishes agent authority.
Required owner/provider authentication becomes an explicit action-required result.

## Delivery and proof

- [ ] Enroll one backend agent with owner/account-bound credentials and grants.
- [ ] Phase 1: call the shared tools for Airwallex card proposals and sandbox
      execution from one reference agent integration.
- [ ] Phase 2: add Wise proposal support; phase 3: add traditional bank proposals.
      Reuse the same Console services and test harness in each phase.
- [ ] Prove proposal-only access cannot execute, approve, administer grants, or
      invoke arbitrary provider mutations.
- [ ] Prove another owner's account or grant cannot be selected and revoked
      credentials fail before payment work.
- [ ] Exercise ready and approval-required proposals, quote expiry, unknown
      execution, and duplicate requests through the shared R130 journey.

Complete the card milestone first, then extend proposal support to Wise and the
selected bank integration in order. Each phase must preserve exact account
authority and inspectable outcomes. Verify execution scope through the corresponding
sandbox adapter. Add MCP, agent-facing OAuth, or CLI when a concrete
integration requires them; all reuse these services. Provider OAuth, when required
to connect an account, belongs to its provider integration.

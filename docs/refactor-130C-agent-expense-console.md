# Refactor 130C — Embedded spending experience and Console

Date created: August 29, 2026
Last revised: September 8, 2026

Status: implementation plan; consume the minimal
[R130A domain](refactor-130A-agent-expense-domain.md) and
[R130B backend integration](refactor-130B-agent-connections.md).

## Goal

Let a customer set an embedded shopping agent's budget, approve an exact
purchase, and understand its outcome without leaving the host app's flow.
Use the existing embedded wallet/customer authentication surfaces and server
services. Reuse existing Console diagnostics when useful; new Console screens
are outside the MVP.

The host app owns conversation, catalog discovery, cart, and order presentation.
Seams supplies spending authority, budget, approval, and payment read models.
Start with one reference app integration; a generalized component library and
full expense dashboard are unnecessary for the first proof.

## First customer journey

1. Sign in to the host app and connect or select the customer's Seams funding
   wallet through the existing authorized customer flow and fund it with testnet
   stablecoins. Show the wallet balance and existing stablecoin spending action.
   Choose “Move to card balance” for a selected amount, submit the wallet-to-escrow
   transfer, and show pending finality followed by credited card capacity.
2. Review and create an expiring grant for this app's agent: merchant, budget,
   per-purchase limit, and approval threshold.
3. Ask the embedded agent to buy an item. The backend submits the final merchant
   quote and exact purchase to Seams.
4. See the policy decision and remaining budget. When required, approve the
   exact merchant, cart, total including fees, and execution constraints through
   verified customer authorization.
5. Pay in the demo checkout through R130D's Airwallex sandbox authorization and
   capture. Show the receipt, payment/order status, and updated card capacity.
6. Reload and inspect durable purchase activity and budget usage.
7. Revoke the grant and observe denied reuse.

A changed purchase requires fresh admission and any required approval. Display
pending and ambiguous payment states explicitly; retrying a UI action retains
the same operation identity. Distinguish payment confirmation from merchant
order acceptance.

## Minimal surfaces

- **Budget and authority:** funding source, granted limit, available spending
  budget, reserved amounts, expiry, and revocation. Show wallet balance separately
  from budget; a grant is permission to spend and does not create funds.
- **Purchase approval:** exact agent, merchant, cart, total, reason, expiry, and
  approve/deny action. The agent cannot use this customer authority.
- **Activity:** pending approval, executing, succeeded, failed, or unknown payment,
  with order reference and concise evidence. Show unresolved payment status and
  the reconciled result; a refund interface is deferred.
- **Revocation:** revoke the grant in the host app. Connection revocation can use
  the authenticated administration API during the MVP; no credential-management
  dashboard is required.

Routes consume server-assembled read models and narrow lifecycle mutations.
React never joins raw provider/storage records or decides spending permission.
Browser requests carry customer authentication through the supported boundary;
backend integration credentials remain on the server.

## Delivery and proof

- [ ] Integrate budget setup, exact approval, status, and revocation into one host
      app using existing UI and authentication patterns.
- [ ] Add only the server read models needed by that host app. Use one budget
      view with deposit/card capacity, an exact approval view, and a sandbox checkout
      and purchase status view; reuse existing
      components and avoid a new UI package.
- [ ] Demonstrate the shared A/B/C/D journey against real services and testnet,
      including reload, payment outcome, and revoked reuse. Extend the R117
      harness where it fits; avoid a parallel test harness. Read `tests/AGENTS.md`
      before editing tests.

Complete when a customer funds their wallet, moves an amount into escrow, waits
for finality, sees credited
card spending capacity, and pays for a demo order with the agent's budget enforced.
[R130D](refactor-130D-airwallex-card-rail.md) supplies the required sandbox adapter.
A script-only proof is insufficient. Full dashboards, policy templates, and
additional agent-management screens remain later work.

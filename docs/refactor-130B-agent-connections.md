# Refactor 130B — Embedded app agent connection

Date created: August 29, 2026
Last revised: September 8, 2026

Status: implementation plan; build the backend API path alongside the minimal
[R130A domain](refactor-130A-agent-expense-domain.md).

## Goal

Connect an agent embedded in a shopping or merchant app to Seams through the
app backend. Use the existing scoped API credential concept as the first
connection branch. OAuth, MCP, and CLI are later adapters to the same services.

```text
Customer in host app
  -> app backend / agent runtime
  -> authenticated Seams API request
  -> exact customer, agent, connection, and grant resolution
  -> R130A admission
```

Embedding describes where the customer interacts. Agent tools and privileged
credentials run on the backend; long-lived API credentials never enter browser
bundles, model context, logs, or public read models.

## Identity and authorization

The integration credential authenticates the calling app within one tenant and
environment. Each purchase also resolves the exact customer principal, agent,
connection, funding source, and active grant through server-owned bindings.
A caller-supplied customer or grant ID is a lookup input, never proof of access.

Use the existing authenticated customer/owner boundary for enrollment, grant
creation, and purchase approval. Bind the integration to that customer only
through this authorized flow. A merchant's credential cannot create shopper
consent, select another shopper's wallet, or widen spending authority.

Connection access and spending grants have independent lifecycles. A connection
names its credential binding, agent, scope, expiry policy, and revocation epoch.
Operation scopes govern API access; R130A governs merchant, amount, budget, and
payment policy. Revoking a connection denies new requests. Revoking a grant
prevents new spending while eligible status reads remain available.

For the first path, backend credential authentication establishes the registered
agent actor; do not claim that it proves an individual model generated a request.
Bind the canonical request and idempotency identity to that actor at the server
boundary. Separate agent request signatures are unnecessary for this path;
future signed adapters must normalize to the same authenticated actor contract.

## First API surface

Expose only the operations required by the embedded journey:

- `get_spending_authority`: grant rules and remaining budget;
- `propose_purchase`: allowed, blocked, or pending approval;
- `execute_purchase`: dispatch an admitted purchase under stable identity;
- `get_purchase_status`: durable decision and payment outcome.

Implement direct backend API calls for these four operations. A generic tool
registry, agent SDK wrapper, and transport plugin system are unnecessary. Start
with one registered agent integration; enforce per-customer grant isolation.

Customer grant administration and exact purchase approval use the owner surface,
separate from agent tools. Add cancellation only when its lifecycle semantics
are implemented. Return explicit recoverable results, including pending approval
and unknown payment outcome, through the host app.

Parse credentials and request bodies once. Reject cross-tenant, cross-customer,
wrong-environment, expired, or revoked bindings before purchase/payment work.
Every mutation carries stable idempotency identity. Reuse R130A orchestration.

## Delivery and proof

- [ ] Implement backend credential enrollment, one-time display, secure server
      representation, authentication, expiry, and revocation using existing
      patterns and an authenticated administration API. Keep identity and lifecycle
      fields required. Credential dashboards and seamless rotation are deferred;
      revocation and fresh enrollment provide the first replacement path.
- [ ] Bind one authenticated customer and agent to a customer-authorized grant.
- [ ] Call the minimal purchase tools from one embedded app backend and complete
      the shared R130A/R130C/R130D escrow-to-card journey; add no adapter-specific E2E harness.
- [ ] Verify another customer's grant cannot be used, retries do not duplicate
      payment, and revoked credentials fail before spending work.

Complete when one embedded app can make bounded purchases for its authenticated
customer without receiving wallet ownership or grant-administration authority.
Hosted/local adapter parity is not an exit requirement.

## Later adapters

Add remote MCP, OAuth, or local CLI only when a concrete integration needs one.
Use branch-specific lifecycle types as those adapters arrive; avoid speculative
fields or a framework covering every transport in advance.

MCP tool approval remains an extra checkpoint alongside R130A admission. OAuth
consent connects an integration; customer owner authorization establishes its
spending grant. Local CLI keys authenticate the agent without delivering wallet
MPC holder material. All adapters reuse the same expense services.

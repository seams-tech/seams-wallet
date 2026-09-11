---
title: Nonce lanes
description: Prevent EVM-family transaction conflicts with explicit nonce ownership, reconciliation, and replacement state.
---

# Nonce lanes

Nonce lanes prevent EVM-family transaction conflicts. They track which nonces
are available, in flight, finalized, dropped, or replaced for a concrete chain
target and signing lane.

## Default rule

Application code should not fetch or assign nonces for default Tempo/EVM
signing flows. The signing engine owns nonce preparation, broadcast reporting,
finalization reporting, and reconciliation.

## Lifecycle

1. Read chain nonce and local unresolved state.
2. Reserve a nonce for an admitted signing request.
3. Report broadcast accepted or rejected.
4. Report finalized, dropped, or replaced.
5. Reconcile when chain state and local state disagree.

Nonce state belongs to the concrete chain target and lane. It must not select a
different persistent ECDSA key or displayed signer address.

## Uncertain broadcasts and retries

A timeout or expired local lease does not prove that the chain rejected a
transaction. Preserve its transaction hash and request identifier, then let the
SDK reconcile the exact lane against chain state before submitting another
transaction. An identical retry keeps its operation fingerprint; a changed
payload is a new operation. Clearing local state does not cancel a transaction.

Nonce coordination and signing quota have separate owners. A broadcast failure
does not refund an already-consumed signing allowance, and resetting nonce
state cannot refill a Wallet Session. Browser coordination covers tabs on the
same origin; it does not provide cross-device exclusion.

NEAR signing also uses managed nonce coordination, scoped to the network,
account, and access key. Nonfinal acceptance remains protected until
reconciliation resolves it. An advanced access-key nonce with a missing
transaction hash requires chain reconciliation and does not establish an
EVM-style replacement.

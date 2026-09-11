# nonce

## Owns

Nonce lease state, durable nonce coordination, and nonce lifecycle persistence.

## May Import

Nonce persistence/RPC dependencies and primitive types.

## Must Not Import

`SigningEngine.ts`, `assembly/*`, `flows/*`, `session/*`, `stepUpConfirmation/*`,
`threshold/*`, or `chains/*`.

## Entrypoints

Current entrypoint: `NonceCoordinator.ts`.

## Coordination contract

Each managed transaction has one nonce lease bound to the exact operation ID,
operation fingerprint, lane, and nonce. Serialize lane mutations through the
coordinator. An EVM lane contains its concrete chain target, wallet subject,
sender, and optional nonce key; a NEAR lane contains its network, wallet,
account, and access key. Chain/RPC state determines confirmed nonce progress.

Same-origin durable leases and lane locks coordinate browser tabs. They do not
provide cross-device exclusion or signing-budget authority. Persist lease
metadata without signed transaction bytes or secrets. Recover unresolved
leases and reconcile against the chain after runtime loss. If coordination or
RPC state is unavailable, surface degraded state and preserve uncertainty
about possibly active nonces.

Before a signature exists, cancellation and authentication failure release the
nonce lease. After signing, retain the signed/broadcast lifecycle and reconcile
rejection, expiry, dropping, or replacement. A broadcast failure never refunds
an already-consumed signature allowance. Server authorization owns quota
consumption; the coordinator never decrements, refills, or derives budget from
nonce state.

## Stuck-lane recovery

Use the internal coordinator for diagnosis; applications should continue to
use the SDK's managed transaction APIs.

1. Capture `getDiagnostics({ accountId: walletId })` and record lease counts,
   states, concrete lane identity, and safe transaction/trace identifiers.
   Omit signed bytes, keys, factor material, tokens, and recovery codes.
2. Call `expireLeases({ walletId })` to process abandoned leases under the
   configured policy, then `reconcile({ lane })` using the exact failed lane.
   Keep a blocked lane blocked until chain evidence resolves the outstanding
   nonce. An expired local lease does not prove the chain rejected a signature.
3. Retry an identical operation only under its original fingerprint. A changed
   payload needs a fresh operation ID. Do not allocate another nonce over an
   unresolved operation merely because status polling failed.
4. `clearForWallet(walletId)` and `clearAll()` are runtime reset/teardown tools.
   They do not cancel chain transactions. Capture outstanding state first and
   fetch fresh chain state before signing after a reset.
5. Escalate repeated drops with network, sender/access key, nonce, transaction
   hash, finalization outcome, and trace IDs. Investigate RPC visibility and
   transaction/fee policy independently from signing quota.

NEAR reconciliation distinguishes `finalized`, `accepted_nonfinal`,
`nonce_advanced_hash_missing`, `expired_hash_missing_nonce_not_advanced`,
`invalid_or_rejected`, and `unknown`. Nonfinal acceptance keeps the lease
protected; an advanced nonce with a missing hash resolves through chain
reconciliation without claiming EVM-style replacement. Expired missing-hash
cases require fresh access-key context. Rejection handling depends on whether
the nonce advanced; unavailable or contradictory RPC evidence remains unknown.

`nonceTypes.ts` owns the exact API and outcome names. `NonceCoordinator.ts`
owns transitions and `nonceCoordinationRecordBoundary.ts` owns durable parsing.

# Refactor 126: durable encrypted ECDSA presignature cache

**Status:** Implemented. Release validation and production latency measurement
remain operational follow-up work.

## Decision

Persist each completed client-side ECDSA presignature as an encrypted,
one-use record in the wallet's existing IndexedDB database. Restore it lazily
inside the ECDSA worker when a transaction reserves it. Persist the matching
server half through the existing encrypted SigningWorker-private D1 adapter.
Separate the presign ceremony deadline from completed-material expiry and use
a 90-day maximum material lifetime for the first release.

The first implementation has two functional changes: client persistence and
expiry separation. It reuses the current signing path:

- IndexedDB retains the browser's encrypted client half.
- The existing private D1 adapter retains the encrypted server half and its
  revision-checked one-use lifecycle.
- The existing client and server pool lifecycle types remain the only state
  machines.
- Wallet unlock schedules local cache discovery and network refill in the
  background. Neither task delays successful unlock.
- A foreground signing request checks the local cache before it starts a new
  presign protocol.
- The IndexedDB cache holds at most three available client presignatures per
  exact pool identity. Three is both the refill target and admission limit.

Keep the current server storage, encryption keys, routing, and lifecycle.
Server-store migration, new infrastructure, cross-tab refill leadership,
protocol replacement, Shamir3pass, and keep-warm requests are outside this
refactor. A D1-to-Durable-Object migration needs separate evidence and a
separate plan; it is not a prerequisite for a cache hit after reload.

## Problem and current cause

Observed Tempo behavior is approximately 20 seconds for the first signature
after a cold page or worker lifetime and approximately 4 seconds for a later
signature. NEAR signing does not use this ECDSA presign path and completes in
approximately 1–2 seconds.

The current ECDSA pool has two volatile client layers:

1. `presignaturePool.ts` keeps public pool references in module-level maps.
2. `ecdsa-presign-client.worker.ts` and `opaqueEcdsaPresignAuthority.ts` keep
   the completed client material in worker memory.

`scheduleRouterAbEcdsaDerivationLoginPresignaturePrefill` starts a background
refill after authentication. A transaction submitted before the refill
finishes waits for the complete multi-round presign protocol. A page reload or
worker restart drops completed client material, so the next page must repeat
that work even when the server half still exists server-side.

The current expiry model also prevents useful persistence. Login prefill asks
for material expiring after roughly one minute, and the server uses one expiry
for both the short-lived presign ceremony and the completed material. Durable
storage alone would preserve an already-expired record. Implementation must
separate the ceremony deadline from the completed material lifetime.

Use existing request timing to measure the production latency change. Add a
dedicated metrics sink later if cache outcome metrics become necessary; the
first implementation does not create browser performance entries without a
consumer.

## Existing ownership to preserve

| Responsibility | Existing owner | Planned change |
| --- | --- | --- |
| Client pool scheduling and signing coordination | `packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool.ts` | Discover durable entries before scheduling refill and retry another entry when a pre-prepare claim loses a cross-tab race. |
| Client role-local lifecycle | `packages/wallet/src/core/signingEngine/workerManager/workers/ecdsa-presign-client.worker.ts` | Extend the existing `pending_admission` → `available` → `reserved` → `committed` lifecycle with an exact storage representation for the `available` branch. |
| Opaque secret ownership | `packages/wallet/src/core/signingEngine/workerManager/workers/opaqueEcdsaPresignAuthority.ts` | Seal completed material, open an atomically claimed record, and keep plaintext inside the crypto worker. |
| Canonical ECDSA material persistence | `packages/wallet/src/core/indexedDB/seamsWalletDB/ecdsaCapabilityManifestStore.ts` | Add a store for sealed available presignatures and reuse the active material's non-extractable AES-GCM sealing key with a separate AAD domain. |
| Presignature encoding and validation | `crates/router-ab-ecdsa-presign` and `wasm/router_ab_ecdsa_client` | Add one canonical 97-byte decoder and an opaque completed-material WASM type. |
| Login warmup | `packages/wallet/src/core/signingEngine/session/warmCapabilities/ecdsaLoginPrefill.ts` | Return from unlock immediately, then discover local entries and refill any deficit. |
| Server role-local lifecycle | `crates/router-ab-cloudflare/src/ecdsa_pool_lifecycle.rs` | Preserve `Available` → `Reserved` → `Consumed`/`Tombstone`, including durable consumption before finalization. |
| Server completed-material storage | `crates/router-ab-cloudflare/src/signing_worker/private_d1.rs` | Retain the existing encrypted records, compare-and-swap updates, and replay barriers. Store the negotiated material expiry in the current completed-record expiry field. |
| Server live presign sessions | `crates/router-ab-cloudflare/src/durable_object/ecdsa_presign_live_session.rs` and the existing pool-fill request/response boundaries | Carry separate ceremony and material deadlines without changing Durable Object routing or ownership. |

The Rust pool lifecycle already defines the commands for admission,
reservation, consumption, failure recovery, expiry, and retirement. It remains
normative. The existing private D1 adapter applies those commands and commits
the encrypted replacement with a revision-checked update. TypeScript
orchestration and client persistence must not reproduce those transitions.

The strict signing path uses the Rust
`RouterAbSigningWorkerPresignSessionDurableObject`, routed per presign session.
This change does not move completed pools into the TypeScript
`ThresholdStoreDurableObject` or turn ceremony objects into pool owners.

## Lifecycle model

### One client state machine

Keep the current `OpaquePresignMaterialState` as the client lifecycle. Make
the representation of its available branch explicit:

```ts
type AvailableClientPresignatureStorage =
  | {
      readonly kind: 'resident';
      readonly authorityPort: MessagePort;
      readonly durableRecordId?: never;
    }
  | {
      readonly kind: 'sealed_indexed_db';
      readonly durableRecordId: DurableClientPresignatureRecordId;
      readonly authorityPort?: never;
    };

type OpaquePresignMaterialState =
  | { readonly kind: 'pending_admission' }
  | {
      readonly kind: 'available';
      readonly storage: AvailableClientPresignatureStorage;
    }
  | {
      readonly kind: 'reserved';
      readonly requestBinding: string;
      readonly reservationId: string;
      readonly leaseExpiresAtMs: number;
    }
  | {
      readonly kind: 'committed';
      readonly requestBinding: string;
      readonly reservationId: string;
      readonly leaseExpiresAtMs: number;
    };
```

`resident` is the best-effort fallback when IndexedDB is unavailable or a
write fails. `sealed_indexed_db` is the normal path. Keep these variants inside
the existing lifecycle rather than introducing a cache lifecycle beside it.

Only an `available` presignature may be persisted. A reserved or committed
presignature must exist only in worker memory for its exact operation. A
terminal client record is deleted. The server's existing consumed/tombstone
record remains the durable replay barrier.

### Durable row

Define one exact, versioned boundary type. All fields are required.

```ts
type SealedAvailableClientPresignatureV1 = {
  readonly kind: 'sealed_available_client_presignature_v1';
  readonly recordId: DurableClientPresignatureRecordId;
  readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  readonly durableMaterialRef: EcdsaRoleLocalPersistedMaterialRef;
  readonly presignatureId: string;
  readonly groupPublicKey33B64u: string;
  readonly bigR33B64u: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly sealed: {
    readonly kind: 'ecdsa_activation_aes_gcm_v1';
    readonly sealingKeyId: EcdsaMaterialSealingKeyId;
    readonly iv12B64u: string;
    readonly ciphertextB64u: string;
    readonly ciphertextDigestB64u: string;
  };
};
```

Parse IndexedDB rows once at the repository boundary. Reject unknown fields,
non-canonical encodings, an invalid pool identity, invalid timestamps, an
unexpected protocol identifier, and inconsistent public metadata. Core
signing code receives only the parsed type.

The encrypted plaintext is the canonical 97-byte client presignature:

```text
compressed R (33 bytes) || k share (32 bytes) || sigma share (32 bytes)
```

Rust owns encoding and decoding. Decoding must validate the compressed curve
point and both scalar encodings before constructing `PresignOutput`. TypeScript
must not split, reinterpret, or construct the secret components.

### Admission and sealing

After both roles finish the presign protocol and the existing big-R and
presignature-ID checks pass:

1. Serialize the completed Rust `PresignOutput` into a canonical 97-byte
   buffer inside the derivation worker. Keep its owner unavailable to signing
   until admission finishes.
2. Encrypt it in the ECDSA derivation worker with AES-256-GCM.
3. Bind the ciphertext through AAD to the full canonical pool identity,
   durable material reference and binding digest, group public key, big R,
   presignature ID, creation and expiry times, and record version.
4. Recheck the active material binding and count the available entries for the
   exact pool identity, then store the row and its public lookup metadata in
   one IndexedDB transaction. If three entries already exist, destroy this
   surplus client output without publishing it; its server half follows
   existing expiry cleanup.
5. Zeroize the plaintext buffer and free the completed Rust object.
6. Expose the `available` reference only after the transaction commits.

Use the active ECDSA material's existing non-extractable AES-GCM sealing key.
Generate a fresh random 96-bit IV for every row and use a dedicated AAD domain
such as `seams/ecdsa-client-presignature/v1`. Reusing the existing
per-activation key keeps retirement coupled to the exact ECDSA activation and
avoids another browser key hierarchy.

If sealing fails or the write transaction definitely aborts, retain the
completed object as a resident available entry for the current page and
zeroize temporary bytes. Release the object only after a successful write.
Never publish both a resident and a sealed copy. An ambiguous write outcome
burns the entry and follows the normal refill path. The serialization API must
support this ownership handoff without consuming the only fallback object
before persistence succeeds.

### Atomic claim and lazy restore

Do not decrypt durable pool entries during wallet unlock. Public metadata is
enough to report pool depth. Decrypt only after the signing coordinator pops
an entry and calls the existing client reservation operation.

The reservation operation performs this sequence:

1. In one IndexedDB `readwrite` transaction with `durability: 'strict'`, read
   and delete the exact row.
2. Await transaction completion before decryption. This is the cross-tab
   one-use claim; completion of the delete request alone is insufficient.
3. Verify the exact pool identity and active material binding again.
4. Decrypt inside the ECDSA derivation worker.
5. Parse the 97 bytes in Rust and install one opaque completed-material object.
6. Zeroize the temporary plaintext.
7. Advance the existing client lifecycle to `reserved` with the exact request
   and reservation bindings.

Application recovery never reinserts a claimed row. A crash after the take
normally loses that client half. The matching server half expires or is
tombstoned through the existing lifecycle. If strict durability is unavailable,
use resident generation for that environment and do not claim sealed entries
through a weaker storage path.

Browser/profile restoration can reproduce old ciphertext even after deletion.
The server's durable reservation and consumed/tombstone state remains the
authoritative replay barrier. A restored client row must never obtain another
use of a previously attempted server half.

Two tabs may discover the same public row. Exactly one atomic take succeeds.
The loser receives a typed `claimed_elsewhere` result. Before submitting a
server prepare request, the signing coordinator removes the stale reference
and tries the remaining discovered entries, each at most once, before prepare.
It schedules a refill when no usable entry remains. This bounded retry must
not invalidate unrelated entries in the same pool.

### Server half in the existing private D1 store

Keep `ecdsa_pool_mutate_v1` and its encrypted `signing_worker_ecdsa_pool`
records as the single persistence authority. Preserve the canonical Rust
commands, current envelope/key ownership, and revision checks.

The existing sequence remains:

1. Admit completed material as `Available` after protocol validation.
2. Reserve the exact presignature for the authorized request binding.
3. Durably transition it to `Consumed` and remove its stored secret material
   before handing the one-use material to finalization.
4. Return a successful result only through the current terminal-response path.
   A failure or crash after consumption never returns the pair to `Available`.

Continue using the existing interruption, expiry, and retirement commands.
Use the D1 cleanup-deadline index for bounded expired-material cleanup; wire
the existing expiry command into cleanup where needed. Preserve terminal
replay protection when removing secret material. A lost client half may leave
an orphaned server half until expiry, so client pool depth must not be used
as a count of retained server records.

Server database recovery must discard restored presignatures and retire the
affected material activations before signing resumes. Restoring both an
available record and its old revision can erase a replay barrier; the cache
must never treat database restoration as permission to reuse material.

## Expiry policy

Separate these two deadlines in the pool-fill protocol and server session
record:

- `ceremonyExpiresAtMs`: a short deadline for the interactive multi-round
  presign exchange. Cap it at five minutes and the current authorization
  expiry.
- `materialExpiresAtMs`: the deadline for the completed one-use material.

For reusable material, choose:

```text
min(requested material expiry,
    active material/activation expiry,
    now + MAX_DURABLE_PRESIGNATURE_LIFETIME)
```

Set `MAX_DURABLE_PRESIGNATURE_LIFETIME` to 90 days for the first release.
Enforce the cap on the server and bind the client record to the returned
material expiry. Keep one server-owned constant and add no SDK tuning knob.
The activation bound means an actual material-lifecycle expiry; do not reuse
the sealed runtime's Wallet Session expiry as a material deadline. Completed
D1 records retain their existing expiry field with material-expiry semantics;
only the live ceremony needs both deadlines.

Set the available client presignature capacity to three per exact pool
identity. Use three as both the refill target and the admission limit. The
IndexedDB admission transaction must reject a fourth sealed available row for
that pool, and the resident fallback must stop refilling when its page-local
pool holds three available entries. Reserved or committed material is in
flight and does not count toward the available capacity.

This is a client cache bound, not a global server inventory guarantee. A
refill that loses admission leaves an orphaned server half until expiry, and
separate browser profiles or page-local resident fallbacks do not share an
IndexedDB admission transaction. Clean expired material through the existing
stores. Do not introduce a distributed refill lock or a new server capacity
subsystem in this change.

The approved retention policy is 90 days, to cover users returning after weeks
of inactivity. This changes the exposure window for both retained halves.
Combining both roles' `k` and `sigma` shares exposes the wallet private scalar
through `sigma = k * x`; online authorization cannot prevent offline reconstruction
from stolen halves. Preserve separate client/server ownership, existing encryption,
atomic one-use claims, revocation/retirement checks, and expiry cleanup. Existing
records keep their authenticated original expiry; never rewrite ciphertext
metadata to extend an already-issued entry.

The Wallet Session authorizes creation and later reservation. Its expiry does
not expire already-created material. Every later reservation still requires a
current Wallet Session or an operation-scoped step-up. Preserve current
SigningWorker authorization and active-material checks at prepare and finalize.
Revocation or retirement must reject old material before its material deadline,
including when stale client ciphertext remains in another tab or profile.

An operation-scoped step-up fill keeps material bounded by the operation and
ceremony expiry and stays resident. It is never admitted to the durable cache.

Completed material remains cryptographically bound to its key epoch,
activation epoch, protocol ID, public signing scope, and material activation.
A fresh signing operation still requires current Wallet Session or step-up
authorization. A cached presignature grants no signing authority by itself.

## Unlock and foreground behavior

Wallet unlock must keep its current completion point. After the active ECDSA
material and Wallet Session are available:

1. Return the successful unlock result to the caller.
2. Schedule durable metadata discovery for the exact pool.
3. Publish discovered entries into the existing pool map.
4. Schedule a network refill only for the remaining deficit up to the fixed
   capacity of three.

A signing request performs the same metadata discovery synchronously when the
background task has not completed. IndexedDB discovery and an eventual local
decrypt replace the 20-second network presign exchange on a hit. Concurrent
discovery and refill work must continue to coalesce through the existing
per-pool in-flight coordinator.

The first transaction on a brand-new browser profile, after explicit cache
deletion, or after all entries expire still incurs presign generation. No
client-side design can precompute a client secret before the browser has the
active ECDSA material. This plan removes repeated cold generation across
ordinary page and worker lifetimes while keeping unlock non-blocking.

After a successful signing operation, refill in the background when depth
reaches the existing low watermark. Persist each new entry before publishing
it as available, refill toward three, and reject admission of a fourth
available entry. Keep the capacity fixed for the first release. Any increase
requires production evidence that pools of three are regularly exhausted.

## Invalidation and failure rules

- Explicit logout deletes all cached rows for the wallet and clears resident
  pool state through the current logout and authorization-invalidation flow.
- Wallet lock clears resident decrypted material. Sealed rows may remain for
  the next successful unlock.
- Authority revocation, signing-root replacement, material activation
  replacement, recovery re-establishment, key-epoch retirement, and
  activation-epoch retirement delete matching rows before the new state is
  published.
- Invalidate in-flight refill work using the existing generation guard. Check
  the active material binding in the admission transaction so a late refill
  cannot repopulate retired material after cleanup.
- Expired rows are deleted during discovery and opportunistic cleanup.
- A missing sealing key makes the row corrupt and causes deletion.
- Authentication failure, AAD mismatch, malformed plaintext, big-R mismatch,
  and presignature-ID mismatch destroy the claimed client material and report
  a typed binding or corruption failure. They never fall back to plaintext or
  a weaker parser.
- IndexedDB denial, quota exhaustion, and definite transaction abort use the
  resident fallback during admission. Failure to take an existing sealed row
  uses fresh generation; it never decrypts without a committed claim. Storage
  errors preserve unlock and cold signing availability.
- A cancellation before client reservation leaves the sealed row available.
  A cancellation after client reservation burns the claimed client entry and
  follows the existing server cancellation/recovery transition.
- Any ambiguity after reservation burns both role-local halves according to
  the current persistent-pool lifecycle specification.

Do not add a plaintext schema, a legacy-row compatibility parser, or a repair
path that returns claimed material to `available`.

## Security boundary

The host page and the presign coordination worker may observe public pool
metadata, big R, timestamps, and opaque record handles. The 97-byte client
secret exists only inside the ECDSA derivation worker and Rust/WASM while it is
being sealed, opened, or consumed.

The ciphertext and non-extractable `CryptoKey` remain in IndexedDB. Sealing
keeps plaintext out of persisted application rows, and non-extractability
blocks WebCrypto key export. It does not guarantee protection against a copied
browser profile, device-storage access, or arbitrary code executing with the
wallet origin's privileges. Preserve current origin isolation, CSP, worker
boundaries, and authorization checks. The server never receives the cached
client half or its browser sealing key.

The server half stays encrypted under the existing SigningWorker-private D1
key ownership. Preserve durable consumption before finalization and the
existing current-authorization and activation checks. Neither local deletion
nor an expiry timestamp erases copies already taken by an attacker. Treat
both halves together as private-key-sensitive throughout retention and
operational recovery.

## Delivery phases

### 1. Confirm the latency and lifecycle boundaries

- [ ] Capture representative cold and warm Tempo signing traces. Confirm
  presign rounds account for the gap and verify the result after release.
- [x] Record the exact current server lifecycle tests that protect
  availability, reservation, consumption, interruption recovery, expiry, and
  retirement.
- [x] Add type fixtures for the revised available-storage union and reject
  missing bindings, resident-plus-sealed objects, reserved durable rows, broad
  spreads, and direct invalid construction.

**Exit:** The expected benefit is attributed by stage and the existing one-use
contract is explicit. This phase adds no observability platform or benchmark
project.

### 2. Add completed-material serialization and client persistence

- [x] Add a Rust decoder for the existing 97-byte encoding with exact length,
  point, and scalar validation.
- [x] Add an opaque completed-presignature WASM type that can be created from
  validated bytes, expose public big R, compute the online share once, and
  zeroize on drop. Support sealing while retaining the sole owner until the
  write outcome is known.
- [x] Refactor `OpaqueEcdsaPresignAuthorityV1` to own this completed type after
  a presign session finishes. Do not represent completed material as a live
  protocol session.
- [x] Add Rust round-trip vectors and malformed point/scalar cases. Use the
  production encoder and decoder in the tests.
- [x] Add a versioned object store and indexes for exact pool identity,
  material activation, wallet, and expiry.
- [x] Implement boundary parsing, domain-separated AAD construction, sealing,
  public metadata discovery, strict-durability atomic take, and deletion
  through the existing ECDSA capability repository.
- [x] Reuse the active material sealing key only after proving the manifest,
  durable material reference, sealing-key identity, and pool identity agree.
- [x] Keep all secret byte handling in the derivation worker and zeroize every
  temporary buffer.
- [x] Add bounded cleanup by wallet and activation. Avoid scanning unrelated
  wallets during a signing operation.

**Exit:** A completed client presignature survives a validated
seal/open/consume round trip. Two tabs produce one successful take, and write
failure leaves at most one available owner.

### 3. Separate expiry while retaining the server store

- [x] Replace the overloaded pool-fill expiry with required
  `ceremonyExpiresAtMs` and `materialExpiresAtMs` fields at request, live-
  session, and response boundaries. Pass the negotiated material expiry into
  the existing D1 admission record.
- [x] Keep the live protocol session short and admit completed reusable-
  session material with the bounded 90-day durable lifetime.
- [x] Stop deriving completed-material expiry from Wallet Session expiry.
  Require current authorization when the material is created and whenever it
  is reserved.
- [x] Preserve operation-step-up scope and short expiry for operation-bound
  fills.
- [x] Preserve the D1 encrypted envelope, revision checks, and consume-before-
  finalize ordering. Verify bounded expiry cleanup uses the existing index and
  Rust lifecycle commands and leaves replay protection intact.
- [x] Add server tests showing that an expired fill ceremony cannot advance,
  a still-valid material record can later be reserved under fresh signing
  authorization, and retirement prevents use before material expiry.

**Exit:** A fresh authorization can use unexpired cached material under the
same activation. Expired ceremonies and retired material are rejected. D1
remains the single completed-material authority.

### 4. Integrate discovery, admission, reservation, and invalidation

- [x] Seal on admission before publishing an available reference. Recheck the
  active binding and enforce the three-entry available capacity in that
  transaction.
- [x] Hydrate references through `listAvailableClientPresignatures`, then open
  sealed material during the existing reserve transition.
- [x] Add bounded typed pre-prepare retries for `claimed_elsewhere`, `expired`,
  and `not_found`. Keep post-prepare ambiguity terminal.
- [x] Wire logout, lock, authority retirement, recovery, and activation
  replacement to cleanup and existing refill invalidation.
- [x] Discover the local cache after unlock returns.
- [x] Let foreground signing await an in-flight local discovery, then fall
  through to the existing coalesced refill on a miss.
- [x] Refill after consumption toward the fixed capacity of three and retain
  the current concurrency limits.
- [ ] Run the remaining release verification and deploy the expiry
  split and client cache, populate caches naturally, and compare stage timings.

**Exit:** A cache hit after page reload performs no presign protocol rounds,
unlock timing does not regress, and cold fallback remains functional.

## Verification matrix

| Concern | Required evidence |
| --- | --- |
| Cryptographic encoding | Rust encoder/decoder vectors round-trip exactly; malformed point and scalar inputs fail. |
| Storage boundary | Application rows contain ciphertext, public metadata, and a non-extractable key; no plaintext secret bytes cross to the host or appear in logs. Make no device/profile-compromise guarantee. |
| Split-custody retention | The server never receives the client cache or its sealing key. Review the pair as private-key-sensitive and verify expired server secret material is cleaned up. |
| Exact binding | Wrong wallet, pool identity, activation, key epoch, protocol, public key, big R, or durable material reference cannot open the row. |
| One use across tabs | Concurrent atomic takes return one success and one `claimed_elsewhere`; the losing tab can use another entry. |
| Crash safety | Take awaits a strict transaction's completion. Application recovery never reinserts the row; a restored client copy cannot reuse attempted server material. A crash after durable server consumption and before response leaves the pair terminal. |
| Database recovery | The recovery procedure discards restored presignatures and retires affected activations before traffic resumes; old available records cannot be re-enabled. |
| Cancellation | Pre-reservation cancellation preserves availability; post-reservation cancellation burns the client entry and invokes existing server cleanup. |
| Retirement | Logout clears the local cache and invalidates pending refill; revocation, recovery, rotation, and activation replacement reject retired material even if stale client rows remain. Late refill cannot repopulate retired material. |
| Storage failure | A definite admission failure selects one resident owner. An ambiguous write burns the entry. A failed take never decrypts the row; cold generation remains available. |
| Authorization | Possessing a cached client row cannot prepare or finalize a signature without current Wallet Session or operation-step-up authority. |
| Session independence | Material survives reload and Wallet Session renewal under the same activation for up to 90 days, subject to fresh authorization. Session expiry alone does not delete it. |
| Single server authority | Existing encrypted D1 records and Rust lifecycle remain authoritative. Concurrent reservations have one winner; stale revisions cannot consume or resurrect records. |
| Refill and cleanup | The atomic IndexedDB admission rejects a fourth sealed available row for the exact pool identity. The resident fallback holds at most three available entries per page-local pool. Orphaned server halves expire and are cleaned up; three is not asserted as a global server retained-material bound. |
| Latency | On a cache hit, no presign-protocol requests run; existing request timing measures local take/decrypt overhead before the warm signing path. |
| Unlock | Cache discovery and refill begin after the unlock result; unlock acceptance timing stays within its existing baseline. |
| Cold fallback | A new profile, empty cache, or expired cache completes through the existing presign flow and seeds the durable pool. |

Run focused Rust tests in `crates/router-ab-ecdsa-presign`, WASM binding tests,
the existing pool lifecycle/D1 tests, live-session expiry tests, and Wallet
unit/type fixtures first. Then run the public intended-behaviour contracts and
the relevant Wallet check before release. Update affected intended-behaviour
specifications with their contract tests. Classify any failing lower-authority
fixture against current domain types before editing production behavior.

## Rollout and rollback

Ship the additive IndexedDB schema before it is read by signing. Existing
browsers begin with an empty durable pool and take one normal cold generation
path. No legacy material conversion is required.

Release the server expiry split first, followed by the matching client
reader/writer in the same coordinated release. Accept only the new exact
pool-fill request shape; remove the old overloaded request expiry. Already-open
clients using the old shape receive a clear request-shape error and must
reload before refilling. Verify this release boundary without adding a second
protocol parser or a long-lived compatibility path.

No server-store migration or material conversion is required. Existing server
records keep their original expiry and finish through the same D1 lifecycle.

Rollback removes client durable admission and discovery together, clears
cached rows and resident entries, and returns to fresh resident generation
using the split expiry contract. Preserve D1, consume-before-finalize, and
terminal records throughout rollback. Do not restore older database state or
add a permanent cache feature flag.

## Completion criteria

This refactor is complete when:

1. The client and server retain exactly one role-local lifecycle each.
2. Available client material survives an ordinary page or worker lifetime as
   an authenticated ciphertext bound to the exact active ECDSA material.
3. A cache hit reaches the existing warm signing path without network presign
   rounds.
4. Wallet unlock returns before cache discovery or refill completes.
5. Cross-tab races, cancellation, crash ambiguity, expiry, logout, revocation,
   recovery, and activation replacement preserve one-use safety.
6. Each exact pool identity holds at most three sealed available client
   presignatures in IndexedDB, and each page-local resident fallback holds at
   most three available entries.
7. Reusable material has a 90-day maximum lifetime independent of the
   Wallet Session that created it, and each use requires current authorization.
8. The existing encrypted private D1 store remains the single server-side
   persistence authority; consumption is durable before finalization.
9. Production telemetry demonstrates the first post-reload Tempo transaction
   no longer pays the repeated presign-generation latency when a valid cached
   entry exists.

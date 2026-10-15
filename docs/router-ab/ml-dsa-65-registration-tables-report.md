# ML-DSA authenticated registration tables — October 15, 2026

The registration core now stores authenticated table frames and consumes each frame at most once.
The native campaign exercises this boundary during real canonical key generation.
The Worker registration route and generic pool allocator remain unfinished.

## Storage and admission

Each frame uses the existing role-private authenticated encryption with a separate table domain.
Its authenticated metadata includes pool scope, participant, reservation, schedule digest, expiry, wrapping-key version, circuit binding, ordinal, and length.
Only participant B can store or read evaluator tables.
Frames contain at most 65,544 bytes and use the existing bounded ciphertext chunks.

The producer stores frames sequentially before it publishes private preparation.
Exact frame retries are idempotent. Changed retries fail.
Publication requires a live table index with all 35 circuit entries.
The trusted producer must still finish the complete key-generation preparation before publication.
The index check alone is not proof of a completed cryptographic protocol.

A read requires a committed private-preparation consume for the exact ceremony.
It authenticates the frame, deletes its ciphertext, and records consumption in one transaction.
The adapter returns bytes only after commit. Repeated reads fail.
An interrupted execution must obtain new private preparation and new tables.
Private preparation cannot be consumed after its table set starts retirement.

Each adapter mutation must run in one atomic storage transaction.
The native adapter uses the same core functions with transactional SQLite.
The pending Worker adapter must preserve these transaction boundaries.

## Cleanup

Cleanup processes at most 32 frames per transaction.
The first cleanup step closes the table set to reads and writes.
Subsequent steps delete both consumed records and unused fallback ciphertext.
A permanent retirement marker prevents a delayed producer from recreating the reservation.
Cancellation before the first frame also creates that marker.
Cleanup retries are idempotent.

Deletion removes storage rows. It does not claim physical erasure from storage-provider backups.
Database snapshot rollback still requires the separate restore procedure that discards old preparation.

## Native validation

The campaign uses actual prepared circuits and separate native A/B processes.
B writes all table frames through the authenticated store before private-state publication.
After private-state consumption and database reopen, key generation reads through the single-use table adapter.
The resulting public key is checked against the ordinary canonical implementation.

The campaign checks:

- Refusal before private-preparation consumption and for a different ceremony.
- Authentication failure with a wrong wrapping key or modified ciphertext.
- Rejection of a repeated frame read.
- Cleanup of unused fallback frames and zero remaining ciphertext chunks.
- Rejection of reads and writes after retirement.
- Cancellation before the first frame, followed by a refused delayed write.

The added decisions use public roles, coordinates, lengths, lifecycle state, and garbled-frame hashes.
Authenticated encryption uses the existing library implementation.
No new secret-dependent arithmetic or sampling rule is introduced.
This source review does not replace final composition review or hosted qualification.

## Remaining work

1. Add the generic pool allocator with paired reservation, expiry, capacity, and refill policy.
2. Connect authenticated table storage and private-state restoration to Worker key generation.
3. Deliver authorized wallet-derived role inputs and install each resulting share in its own participant.
4. Complete Gateway custody persistence and the existing two-role activation barrier.
5. Attach generic signing capacity before reporting immediate signing availability.
6. Measure complete hosted registration, including private-state restoration and table storage overhead.

The table adapter performs per-frame authenticated encryption and storage transactions.
Hosted measurement must determine the resulting latency, request count, storage cost, and need for batching.
Native results alone do not establish the five-second registration target.


## Recorded results

The [native artifact](../evidence/ml-dsa-65-registration-tables-native-20261015.json.gz) preserves all six cases.
The [source hashes](../evidence/ml-dsa-65-registration-tables-sources-20261015.json) identify the changed storage and test code.
The [signing lifecycle artifact](../evidence/ml-dsa-65-registration-tables-lifecycle-20261015.json) records the separate passing lifecycle campaign.

Every case produced the expected canonical key. Each evaluator stored 2,711 frames and consumed 643 during online execution.
Online reads covered 41,701,400 bytes. Cleanup retired all 2,711 frame records in 85 bounded steps.
A direct database count found zero remaining table ciphertext chunks after cleanup.

The four zero-delay cases, including the warm-up, took 0.945–1.105 seconds in online evaluator execution.
The 5 ms and 20 ms injected round-trip cases took 1.188 and 1.583 seconds respectively.
These timers include authenticated table reads and frame-consumption transactions, plus one rejected replay check.
They exclude private-state restoration, admission, post-execution cleanup, and public Wallet authentication.
Offline timing includes persistence and negative-case validation. It is not a pure preparation benchmark.

Cloudflare Wasm compilation passed. This campaign ran in native processes, not hosted Workers.
Wallet-seed recovery and ordinary-key validation remained part of the native campaign.

Reproduce the evidence with:

```sh
cargo run --release --locked --offline --manifest-path tools/ml-dsa-investigation/Cargo.toml -- prepared-keygen /private/tmp/ml-dsa-registration-tables-verified.json
cargo test --locked --offline --manifest-path crates/router-ab-cloudflare/Cargo.toml --test ml_dsa_durable_pool_e2e
cargo check --locked --offline --manifest-path crates/router-ab-cloudflare/Cargo.toml --target wasm32-unknown-unknown --features strict-worker-router-entrypoint
```

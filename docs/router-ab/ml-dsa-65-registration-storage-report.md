# ML-DSA registration preparation storage — October 15, 2026

Key-generation preparation can now cross encrypted storage before online key generation.
The native campaign confirms canonical keys after database reopen and atomic consumption.
The Worker registration route remains unfinished.

## Implemented boundary

`PreparedKeygen::into_storage` consumes the in-memory handle into a zeroizing buffer.
It stores the complete adaptive circuit layout, including fallback branches, with exact schedule digests and circuit ordinals.
The buffer allocates once. Serialization does not leave secret copies in old allocations after buffer growth.

`PreparedKeygen::from_consumed_storage` requires the expected role, reservation ID, and trusted schedules.
It validates bounded lengths and exact layout before returning an executable handle.
The parser does not establish authorization or freshness. The storage adapter must commit consumption first.

The generic registration store binds preparation to a pool scope, participant, reservation, schedule digest, expiry, and wrapping-key version.
It uses the existing authenticated role-private encryption with a distinct registration domain.
It stores ciphertext in 48 KiB chunks, sharing the signing pool's chunk implementation.
Each chunk's base64 representation is 64 KiB or smaller.

A transaction publishes Ready material. Exact delivery retries are idempotent.
Consumption deletes ciphertext chunks and writes a permanent Consumed record before returning the encrypted payload.
A duplicate consume or republish after consumption fails, including after reopening the database.
An uncertain ceremony must obtain fresh preparation.
Restoring an old database snapshot remains outside the protection of in-database consumption records.

This component is a storage primitive. It does not yet implement pool discovery, capacity policy, refill dispatch, or expired-record cleanup.
The caller must supply trusted scope and ceremony identity. There is no new public HTTP route.

## Privacy review of this change

The persisted secret fields are garbler labels and masked OT pairs for A, and OT choices, selected pads, and translation bits for B.
Neither record contains wallet input selected during online execution.
The role-specific format prevents restoring A's record as B's record.
Both roles retain independent wrapping secrets.

The added branches select public roles or validate public metadata and lengths.
Secret bytes are copied through fixed-size fields. They do not select branches, indexes, or loop bounds.
Existing cryptographic operations remain unchanged.
This source review does not replace the final composition and compiled-code review required before production.

## Native evidence

The native E2E prepares real circuits in separate A/B processes, encrypts each role's state, and reopens its SQLite store.
It commits consumption, reopens the store again, rejects replay, and restores the prepared handle.
It then performs the existing secure key generation and checks the canonical public key.

The [native evidence](../evidence/ml-dsa-65-registration-storage-native-20261015.json.gz) and [source hashes](../evidence/ml-dsa-65-registration-storage-sources-20261015.json) preserve the run.
All six cases passed. These include canonical wallet recovery and injected network round-trip delays.
The campaign also retained ordinary-key validation and the existing threshold-signing and recovery checks.
Negative cases rejected wrong roles, wrong reservations, expiry, truncated or extended state, missing schedules, and republishing consumed material.

| Item | Recorded size |
| --- | ---: |
| A's private prepared state | 10,264,121 bytes |
| B's private prepared state | 361,190 bytes |
| External garbled table frames for all prepared branches | 176,480,440 bytes |

The external table count includes fallback branches. It is separate from the private prepared-state records.
Table frames still use the disposable host adapter. Persistent authenticated table storage remains required for Worker integration.
The native storage test reopens database connections; it does not simulate an operating-system process restart.

The no-delay cases spent 539–548 ms in online circuit execution after restoration.
The 5 ms and 20 ms injected round-trip cases spent 666 ms and 1,046 ms respectively.
Those timers exclude storage validation and restoration. They are not full registration latency measurements.
Offline timing now includes the storage checks, so it is not directly comparable to earlier pure-preparation timings.

The native signing-pool lifecycle E2E passed after sharing the chunk implementation.
The library compiled for the Cloudflare Wasm target. No hosted performance claim follows from these results.

## Next integration

1. Add authenticated, bounded table-frame persistence and cleanup bound to each registration reservation.
2. Connect a durable generic pool and its allocator to admitted Worker key generation.
3. Deliver authenticated wallet-derived role inputs to that execution and install each output share locally.
4. Complete the existing two-role activation barrier and authoritative Gateway custody persistence.
5. Attach generic signing preparation before reporting immediate signing availability.
6. Measure the complete hosted registration flow, including storage restoration, against the five-second target.

Reproduce the native campaign with:

```sh
cargo run --release --locked --offline --manifest-path tools/ml-dsa-investigation/Cargo.toml -- prepared-keygen /private/tmp/ml-dsa-keygen-storage-final.json
cargo test --locked --offline --manifest-path crates/router-ab-cloudflare/Cargo.toml --test ml_dsa_durable_pool_e2e
cargo check --locked --offline --manifest-path crates/router-ab-cloudflare/Cargo.toml --target wasm32-unknown-unknown --features strict-worker-router-entrypoint
```

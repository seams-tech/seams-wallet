# ML-DSA refill guard and early failure propagation

The producer now skips a preparation lease when fresh paired stock makes it unnecessary.
The local baseline grows a full pool from sixteen to eighteen pairs. The guard retains sixteen pairs without participant claims or cryptographic work.
An oversized lease is also skipped when the deficit shrinks. A fresh, smaller job supplies the remaining pair.

The investigation also found a pre-existing signing failure path that waited for the operation deadline.
The corrected ordinary Worker run settles the injected input-load failure in about 250 milliseconds and preserves fifteen unopened pairs.
Hosted overhead and sustained throughput remain unmeasured for these changes.

## Implementation

The durable producer checks both participant inventories after acquiring its immutable lease and before claiming role material or connecting the preparation protocol.
It counts ready and reserved material under the existing readiness horizon.
It skips work when the target is full or when the admitted group count exceeds the current deficit.

`ProducerState::Unused` is persisted before releasing the lease.
Settlement follows the existing replay, restart, and fair-wakeup path.
`Outcome::Unused` preserves failure backoff. It neither records a preparation failure nor clears earlier failures.
The original job remains unchanged. A smaller replacement receives a fresh job identity.
Completion evidence reports zero produced candidates and an empty publication list for unused jobs.

The signing transport now installs its listener and accepts the authenticated socket before fallible input initialization.
Both entrypoints already authenticate and check the authoritative permit.
The second permit check remains before material loading and secret opening.
The existing error handler can therefore request close code 1011 when initialization fails.
Protocol frames, absolute deadlines, and conservative material fencing remain unchanged.

Preparation stays on Workers. Wallet-seed recovery, canonical FIPS export, two-at-once consumption, and the configured pool capacity remain unchanged.
No cryptographic kernel, circuit, sampling rule, or domain string changes.

## Local verification

The existing durable Worker E2E now covers:

- A lease issued against already-full stock, with no participant claims, cryptographic stages, or publications.
- Failed settlement before commit, a lost reply after commit, and producer restart.
- One execution of the skipped job, safe settlement replay, and protection of a newer lease.
- Preserved failure backoff and a fresh bounded top-up after the deficit shrinks.
- A pending 50-millisecond wake while an older controller waits for peer inventory and later schedules maintenance.
- Prompt input-load failure, an accepted socket that requests error closure, and retention of exact unopened material.
- Existing interruption recovery, durable handoff, replay controls, and standard signatures.

Two initial ordinary runs pass the full lifecycle and verify three routine signatures each.
The final ordinary and profiling runs pass the prompt-failure assertions.
They settle the injected failure in 250.0 and 247.7 milliseconds, request error closure, and retain fifteen pairs.
Their six routine signatures and two retained-material signatures verify independently; altered messages fail verification.
The baseline's expected failure and all intermediate artifacts remain retained.
These local tests use real release Worker bundles and durable storage with synthetic canonical key material.
They inject owner admission and controlled network failures. They do not measure public SDK or Cloudflare latency.

The local wake observation is an upper bound through subsequent inventory verification, rather than an exact scheduling delay.
The held-inventory interleaving preserves the pending wake and reaches another controller invocation within the three-second test bound.
It does not reproduce the earlier hosted twenty-seven-second dispatch gap.

## Failure classification

One intermediate profiling run fails the existing unopened-retention assertion.
All three intermediate runs contain the same pre-existing lost-input response path and wait until signing expiry.
In the failed run, conservative expiry cleanup wins the race against normal fencing and retires the remaining fifteen reservations.
The normative behavior permits that conservative cleanup.
This is a preservation-fixture precondition gap, classified as `valid_test_needs_update`, alongside the pre-existing failure-propagation defect.
It establishes no profiling-only cause and no retention regression from the refill guard.

The retention assertion remains intact.
The repaired failure path must settle within five seconds locally, request peer closure, and return a dispatch failure before expiry.
Both final runs satisfy those conditions and retain fifteen pairs.
The initial profiling failure remains in the evidence. Profiling is not established as its cause.

## Hosted follow-up

The same opt-in diagnostics now cover inventory and explicit wake commands, queue commits, and same-actor alarm before/after values.
The raw-tail filter and normalizer preserve those observations and the new guard stages.
These probes will distinguish wake scheduling from controller dispatch on Cloudflare.
Scheduling policy itself has not changed.

The prepared eight-Worker comparison uses two synthetic wallets, separate participant storage keys, and the existing policy.
It compares full-stock and shrinking-deficit leases on both configured producer slots.
Every baseline surplus, skipped lease, fresh top-up, and provider outcome must remain accounted.
Actual controller/producer versions and exact paired material IDs are acceptance checks.

The next hosted run must measure the added inventory lookup cost and useful refill throughput before a performance improvement claim.
The six/ten-second preparation goals and sustained capacity targets remain open.
GPU and native-service preparation remain deferred.

The required bloat check retains its inherited Rust duplication excess. No baseline is weakened.

[Verification evidence](../evidence/ml-dsa-65-refill-guard-20261029.json) records source and Worker hashes, signatures, raw local events, replay checks, and explicit limits.

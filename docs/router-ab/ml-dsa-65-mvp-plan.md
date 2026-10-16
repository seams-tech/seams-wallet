# ML-DSA wallet MVP

The MVP connects the existing hybrid Yao/GMW signer to real Wallet registration, signing, and recovery.
The current private Worker signer and local approval gate are experimental components.
They do not yet form a public Wallet registration flow.

## Fixed requirements

- Preserve two separate participant trust boundaries and passive, honest-execution privacy.
- Derive the canonical FIPS ML-DSA-65 key from the wallet custody seed. Preserve authorized ordinary-seed export.
- Keep full secret material inside secure computation during normal derivation and signing.
- Publish standard public keys and signatures. Preserve the declared public sampler and t0 disclosures.
- Default to one admitted operation per wallet every 60 seconds. Keep this policy configurable.
- Preserve service-wide capacity, durable single-use checks, and exact operation replay when wallet cooldown is disabled.
- Require ready capacity before admission. Return an explicit retry time when unavailable.
- Target less than five seconds from an authenticated request to durable registration or a successful signature, with preparation ready.
- Report human authentication, pool wait, refill time, failures, and complete reserve costs separately.
- Keep GPU work deferred. Preparation research can continue separately from integration.

## 1. Durable custody activation

- [x] Add explicit Installing and Active states at Router admission.
- [x] Keep signing and key-bound refill unavailable while installation is incomplete.
- [x] Read each role's exact durable installation before committing Active.
- [x] Allow exact delivery and activation retries without replacing installed material.
- [x] Reject stale activation completion after an epoch transition.
- [x] Verify the new barrier through the actual Worker HTTP routes and record the result.
- [x] Connect the barrier to admitted key generation, rather than synthetic material installation.

The Gateway's custody assertion remains a prerequisite. Client-supplied manifest data does not establish that assertion.
Activation status must remain distinct from signing-pool availability.
A completed activation does not promise that a signing batch is ready.

The [activation report](ml-dsa-65-activation-report.md) records the implementation and local E2E limits.

## 2. Admitted registration and canonical recovery

- [ ] Admit the custody operation through existing Wallet authentication and ownership checks.
- [ ] Discover authenticated role recipient keys and deliver only each role's encrypted input.
- [x] Add encrypted storage and consuming restoration for generic private key-generation state, with exact schedule and participant bindings.
- [x] Add authenticated, single-use external table storage and bounded cleanup, verified by native canonical key generation.
- [x] Connect the complete private-state and table reservation to Worker key generation.
- [x] Keep generic signing preparation ready before registration. Bind it to the new key without regenerating correlations.
- [ ] Distinguish durable key activation from signer readiness. Require the configured paired signing reserve before reporting immediate signing availability.
- [x] Atomically consume preparation before private input selection. Burn uncertain or interrupted reservations.
- [x] Execute real wallet-derived key generation on Workers and store each output share locally.
- [x] Check public-key agreement and bind the verified manifest to the durable activation.
- [ ] Publish the Wallet key only after both installations and custody persistence complete.
- [x] Recover the same canonical key with fresh shares, preparation, and an advanced epoch.
- [ ] Test interruption after each participant's installation and before public key publication.

Exit: SDK registration and recovery create a durable signer that survives Worker restart.

## 3. Public transaction signing

- [x] Add an explicit ML-DSA capability, wallet-key record, and exact owner-approval gate.
- [x] Compose the gate with private Router signing in local workerd.
- [ ] Load the signing target from authoritative custody and current owner records.
- [ ] Persist and claim exact operations through the authoritative admission store.
- [ ] Mount the public route with exact owner approval first.
- [ ] Add reusable sessions only after the ML-DSA authority and revocation projections exist.
- [ ] Connect SDK transaction review, encoding, signing, and submission.
- [ ] Verify the selected NEAR network's protocol support before key enrollment.
- [ ] Confirm a threshold-signed transaction through the complete SDK path.

Exit: public requests cannot select another wallet, key, epoch, transaction, or algorithm through approval reuse.

## 4. Hosted qualification

- [ ] Deploy matching Gateway, Router, A, and B builds to the authorized test environment.
- [x] Measure registration, successful signing, and recovery with prepared capacity available.
- [ ] Measure pool wait, refill throughput, full-reserve cost, and failures separately.
- [ ] Preserve typed exhaustion, transport, protocol, storage, and timeout outcomes in Worker evidence before qualifying availability.
- [ ] Exercise simultaneous wallets, rejection retries, empty pools, and service capacity.
- [ ] Inject lost responses, partial installation, Worker restart, and concurrent epoch replacement.
- [ ] Verify exact replay, no preparation reuse, and consistent cooldown charging after failure.
- [ ] Verify deadline behavior while legitimate preprocessing runs.
- [ ] Publish sample counts, distributions, failure rates, build hashes, and repeatable evidence.

Exit: the documented operating load meets the five-second target and has a measured sustainable refill rate.
A few local successes do not establish this result.

## 5. Limited pilot

- [ ] Complete privacy and constant-time review of the final composition.
- [ ] Test authorized canonical seed export using an independent ordinary ML-DSA implementation.
- [ ] Package exact SDK and Worker releases, configuration, monitoring, and recovery procedures.
- [ ] Consume the exact releases in the private monorepo and run composed acceptance tests.
- [ ] Start with conservative service capacity and explicit empty-pool behavior.

No production-readiness claim follows from an individual completed component.

## Private registration milestone — October 16, 2026

The [Worker registration report](ml-dsa-65-registration-worker-report.md) records complete private registration and canonical recovery on hosted Workers.
The first two hosted cases pass functional checks and fail the five-second latency target.
These completed private components do not satisfy the public SDK exit criteria.
Generic registration replenishment remains an explicit private operation. Automatic replenishment and production authority sources remain open.


## Registration CPU milestone — October 16, 2026

The [CPU report](ml-dsa-65-registration-cpu-report.md) records calibrated sampling, versioned ChaCha20-Poly1305 preparation storage, and the updated hosted campaign.
Canonical recovery, old-ciphertext rejection, and replay checks pass. Hosted registration remains above five seconds at 8.48/6.92 seconds.
The next performance work targets table I/O, activation, and initial signing-stock installation. Public SDK readiness and load qualification remain open.

## Bounded table-read milestone — October 16, 2026

The [bounded-read report](ml-dsa-65-batched-tables-report.md) records 83 transactions for 643 evaluator frames and concurrent read-only pool initialization.
Native corruption, rollback, restart, and cleanup checks pass. Local injected initialization stalls do not delay completed registration.
Hosted creation takes 5.67 seconds and recovery takes 6.69 seconds. Both preserve the canonical key.
Signing takes 4.98/7.94 seconds in the repeat campaign. The first campaign retains a failed signing request.
Next steps are explicit signing-failure diagnostics, WebSocket completion, bounded execution, and material-installation profiling before load qualification.

## Execution lifecycle milestone — October 16, 2026

The [execution report](ml-dsa-65-execution-diagnostics-report.md) records typed dispatch failures, public batch counts, and a bounded key-generation RPC.
The deadline E2E checks late delivery, failed replay after restart, and fresh canonical registration.
A now waits for B's normal close event after result agreement. Both final hosted requests verify without the previous runtime error.
They take 9.98/5.75 seconds and miss the latency target. Twelve/eight evaluated candidates show why one-batch timings are insufficient.
Next: complete lifecycle deadlines and fault injection, installation profiling, candidate-batch comparisons, and fixed-load qualification before public integration.


## Storage and candidate-batch control — October 16, 2026

The [storage report](ml-dsa-65-storage-latency-report.md) records grouped binary I/O, cached public schedules, eight-candidate batches, and authenticated public garbled tables.
Private preparation stays encrypted. Native and Worker checks preserve canonical wallet-seed recovery and ordinary FIPS export.
Table reads fall from 83 to 24 transactions for 643 frames.
Hosted registration takes 6.420 seconds, and recovery takes 5.732 seconds. Five verified one-batch signatures take 2.720–11.561 seconds.
The complete preparation reserve takes 203.543–273.996 seconds. A prior binary-only attempt times out before registration and remains in the evidence.
The five-second registration target remains unmet. Consistent multi-batch signing remains unqualified.
Next: isolate the 4.183–8.469-second inventory RPC delay from overlapping producer work. Then compare minimum admission-ready stock and bounded concurrent installation.
Keep GPU work and public Wallet integration deferred. Qualify refill capacity and lifecycle-wide deadlines before release.

## Preparation throughput checkpoint — October 16, 2026

The [preparation throughput report](ml-dsa-65-preparation-throughput-report.md) records durable asynchronous producer dispatch, grouped table writes, and the equivalent AES adapter.
All twelve hosted signatures verify in 1.34–3.55 seconds per successful online request. One operation consumes two batches.
After initial stock depletion, the observed rates are 0.895 paired batches and 0.795 successful signatures per minute.
Capacity waits raise the median demand time to 52.55 seconds and the maximum to 175.97 seconds.
The pool target remains four. The service runs one producer. A larger reserve does not establish lower preparation cost.
Canonical wallet-seed recovery and ordinary FIPS export remain intact. GPU work remains deferred.

Next: profile preparation stages and compare complete matched runs. Include CPU, traffic, interrupted attempts, and stock-depleted signing throughput.
Any producer-concurrency experiment must measure added compute and online interference. Public Wallet integration remains gated.

## Preparation stage optimization checkpoint — October 16, 2026

The [stage optimization report](ml-dsa-65-preparation-stage-optimization-report.md) records private AES inlining, retained bulk secret erasure, and equivalent public matrix generation.
The local four-batch reserve takes 48.097 seconds in the profiled run and 50.127 seconds in an unprofiled repeat.
Hosted preparation has a 33.441-second median. Observed refill after initial stock reaches 1.199 batches per minute with the unchanged four-batch cap.
Twelve signatures verify. Ten successful online requests finish below five seconds, while two reach 5.994 and 6.503 seconds.
One failed operation exhausts twenty-four candidates. Capacity waits keep the demand median at 58.317 seconds.
Canonical recovery and standard FIPS export remain intact. Public integration and GPU work remain deferred.
Next: isolate remaining private AES cost, hosted multi-batch signing, and registration overhead before capacity qualification.

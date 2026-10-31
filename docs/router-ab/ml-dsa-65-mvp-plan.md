# ML-DSA wallet MVP

The MVP connects the existing hybrid Yao/GMW signer to real Wallet registration, signing, and recovery.
The current private Worker signer and local approval gate are experimental components.
The first public registration flow adds ML-DSA to an existing passkey wallet. New wallets whose only signer is ML-DSA remain outside this scope.

## Current release gates — October 31, 2026

The [MVP gate report](ml-dsa-65-mvp-gates-report.md) records passing current local lifecycle, onward linking, ordinary-signer loading, and exact package acceptance.
A new reusable ML-DSA session now requires visible Wallet-origin consent for its operation budget and maximum duration.
Caller hidden or automatic approval settings cannot suppress that review. Signer configuration stays in Signing keys settings.

Remaining high-impact work is the corrected full Cloudflare lifecycle and an eight-active-wallet, two-group capacity screen with idle return and reserve accounting.
Fresh credential approval is pending. All fifteen temporary deployment configurations pass local dry runs.
The current source review remains bounded to the accepted passive model. The full composition proof remains incomplete.
Wallet-seed recovery, FIPS export, four-candidate preparation, two-at-once consumption, and per-wallet capacity remain unchanged.

## UX checkpoint — October 27, 2026

The current priority is signer UX and preparation efficiency. Earlier sections that defer UI work describe previous checkpoints.
The shared Signing keys screen and transaction-approval picker are implemented on `ml-dsa`.
Key details use separate screens. Recovery information stays visible without an expander.

Setup navigation is complete. Published keys survive leaving setup and canceled approval. Finalized NEAR enrollment is distinct from signing capacity. Both NEAR signer types expose default and export actions in key details.
The controlled browser scenario in `signing-keys.contract.test.ts` verifies cancellation, an RPC outage, resumption, and explicit default changes.

The [wait UI and retained-stock campaign](ml-dsa-65-waits-retained-stock-report.md) completes the next four tasks:

1. Signing receipts show preparation waits, service contention, and the server's cooldown. Cancellation preserves the approved operation and nonce state.
2. The hosted browser lifecycle passes through the new screens. Recovery, full-owner linking, export, restoration, and NEAR testnet finality pass. Ordinary flows skip optional ML-DSA cryptography.
3. Failed settlement preserves material only when both participants prove that it remains unopened. A controlled Worker failure preserves fifteen pairs. A later verified signature consumes four of those pairs.
4. Exact package and module checks pass. A bounded source review finds no blocker under the accepted passive model. It does not establish a complete composition proof.

The eight hosted SDK signing samples range from 2.74 to 6.36 seconds. Seven are below five seconds, and all are below eight.
These samples exclude preparation, deliberate cooldown sleeps, human response time, and NEAR finality.
All twelve temporary Workers are deleted. The cleanup also removes four databases and two buckets.

Remaining high-impact work:

1. Measure sustained multi-wallet refill with retained material. Count failed work, pool waits, and completed signatures at unchanged capacity.
2. Reduce the largest measured preparation cost and hosted failures. The current campaign establishes no new preparation speed or sustained throughput.
3. Integrate the reviewed package on `dev` and publish only when authorized. Preserve the documented security assumptions and performance limits.

The user accepts registration around 6–10 seconds and signing around 4–8 seconds while preparation improves.
These are working UX budgets, not measured guarantees. Sustained refill remains the main performance concern.
Wallet-seed recovery, standard FIPS export, separate participant boundaries, and Workers preparation remain required. GPU work stays deferred.

## Qualification checkpoint — October 25, 2026

The [expiry and admission campaign](ml-dsa-65-expiry-admission-report.md) verifies 48 and 89 hosted signatures with unchanged capacity and recovery/export rules.
No empty-pool response claims a signing slot. Newly refilled paired stock remains accounted for in both windows.
Observed load-and-restoration cycles reach 3.640 and 3.352 signatures/minute; eight-wallet complete demands still exceed the five-second target.
Investigate twelve B `loadShed` preparation failures and unexplained producer CPU variation before testing parallel refill. All six temporary Workers are deleted.

The [final hosted lifecycle report](ml-dsa-65-final-hosted-lifecycle-report.md) records passing Cloudflare browser campaigns for the full lifecycle, owner export, onward linking, and ordinary ECDSA.
Recovery and participant restoration preserve the canonical key. A restored signer reaches NEAR testnet finality.
Ordinary NEAR and ECDSA browser flows skip optional ML-DSA cryptography. Shared metadata and session helpers remain in common code.
Preparation throughput and admission headroom are the next performance priority. This lifecycle campaign establishes no sustained capacity or five-second guarantee.

The [sustained capacity campaign](ml-dsa-65-sustained-capacity-report.md) completes real Cloudflare loads at unchanged capacity.
Four active wallets produce 39 verified signatures, with 2.545 signatures/minute after starting stock cannot contribute.
Eight active wallets produce 46 verified signatures, with 1.417 signatures/minute after that bound.
Successful cloud calls take 0.452–5.182 seconds across these runs. Complete demands reach 767.428 seconds because admission and material waits accumulate.
Thirty newly prepared pairs become unavailable without use during the eight-wallet screen. Deadline and readiness evidence fits those losses.
Next, reduce expiry waste and measure empty-pool admission contention, then test controlled parallel refill with the same per-wallet capacity.
All six temporary Workers are deleted. Wallet-seed recovery, ordinary FIPS export, and two-at-once consumption remain unchanged.
The final composition security review and exact release-package acceptance remain separate release gates.

## Qualification checkpoint — October 21, 2026

The [SDK release qualification](ml-dsa-65-sdk-release-qualification.md) records the real Cloudflare browser lifecycle.
Recovery, full-owner QR linking, canonical FIPS export, participant restoration, and a finalized NEAR transaction pass.
Expired unpublished creation can restart under fresh owner approval and a higher epoch.
NEAR enrollment checks finalized protocol support before requesting AddKey approval.
Exact unpublished package candidates pass private product type checks and both Console activation acceptance scenarios.
The five-second target and broader production security review remain open.
The clean two-wallet capacity repeat records three verified signatures, then a stock wait reaches the Wallet RPC deadline.
Refill throughput and SDK backpressure remain release gates.
GPU preparation, product UI changes, and registry publication remain deferred.

The October 22 [browser cancellation campaign](ml-dsa-65-sdk-release-qualification.md#sdk-cancellation-and-deadlines)
passes seven controlled lifecycle scenarios. Wallet RPC timeout now stops later ML-DSA retries.
Late results preserve nonce state and cannot trigger automatic submission after cancellation.
This closes the client retry cancellation gap. Hosted backpressure, refill capacity, and five-second performance remain open.

## Current priority — October 22, 2026

Qualify hosted signing latency and sustained refill after the SDK lifecycle connection.
The [Worker exchange investigation](ml-dsa-65-worker-exchange-report.md) establishes no reliable gain from either runtime prototype. Both were removed.
Its final screen verifies seventeen signatures, with fifteen below five seconds. The target remains unmet.
Next, compare equivalent circuits with fewer dependent AND layers. Existing traces show 340 online exchanges per candidate pair.
Keep four-candidate preparation, two-candidate consumption, thirty-two candidates per wallet, and sixteen ready candidates for admission.
Preserve wallet-seed recovery, canonical FIPS seed/key export, separate participants, and the sixty-second production cooldown.
Measure complete demand, failed operations, and full reserve restoration separately from prepared signing execution.
Then repeat the composed SDK campaign with the selected implementation and complete the release security review.
GPU work, UI redesign, and package publication remain deferred.

## SDK lifecycle implementation — October 19, 2026

Complete the public SDK lifecycle before further latency optimization. Keep the current
Workers protocol, four-candidate preparation, two-candidate consumption, thirty-two-candidate
capacity, and sixteen-candidate admission minimum. Keep wallet-seed recovery and canonical
FIPS seed/key export. UI redesign and GPU work remain deferred.

Implement these steps in dependency order:

1. **Connect the SDK custody driver.** Add explicit establishment, existing-custody join,
   and recovery branches to the existing ceremony driver. Require recorded manifest
   continuity for recovery and a replacement factor for resealing. Discard the worker
   handle after transport failure. Run the driver through the real browser worker and
   Wasm, with separate participants, standard signature verification, and canonical export.
   This step returns proposed custody records. It grants no public signing authority.
2. **Admit and publish registration.** Connect the existing authentication and ownership
   records to ML-DSA registration. Extend the existing signer-activation and session
   projections, which currently cover Ed25519 and ECDSA. Obtain participant public keys through authenticated
   discovery. Allocate the operation, key identity, and epoch on the server. Bind encrypted
   input delivery to that operation. Publish the key only after both participant installations
   and custody persistence succeed. Test lost replies and retry after each publication boundary.
3. **Connect public signing.** Load the active ML-DSA key from authoritative storage.
   Admit an exact owner-approved operation through persistent operation claims. Dispatch
   through the existing private Router route. Connect SDK transaction review, encoding,
   signature verification, and submission. Verify network support before enrollment.
   Test changed transactions, duplicate requests, stale epochs, and exhausted pools.
4. **Connect public recovery and export.** Open the wallet seed through the existing recovery
   flow. Reproduce the recorded ML-DSA key, replace participant shares, retire old preparation,
   and commit the replacement factor. Keep retry identity across interrupted operations.
   Verify that an authorized exported FIPS seed imports into an ordinary implementation.
   Test recovery during an in-flight signature and restart before publication.
5. **Connect device authorization.** Extend the existing device enrollment and revocation
   flow to authorize the active server-held ML-DSA signer. Bind authorization to the wallet,
   key, device, enrollment, and current authority. Never transfer the wallet custody seed or
   either server share to the linked device. Verify target-device signing and rejection after
   revocation. Joining an owner custody envelope is a different flow and cannot qualify this step.
6. **Qualify the composed lifecycle.** Run registration, signing, recovery, and device linking
   through public SDK entry points against the Gateway and Workers. Save repeatable evidence
   for custody continuity, authorization failures, replay, restart, and single-use material.
   Then complete the final privacy review and package the release. Record performance separately.

The earlier checklists below retain their component-level completion state. A passing browser
custody test or private Worker test does not complete a public lifecycle entry point.

Step 1 now passes the [SDK custody-driver campaign](ml-dsa-65-sdk-custody-driver-report.md).
All twenty-four browser checks pass. Establishment, recovery, and existing-custody joining
preserve the same ordinary key and canonical exported seed.
Authenticated private recipient discovery also passes the [Worker campaign](ml-dsa-65-recipient-discovery-report.md).
The Gateway now pins the discovered keys to an existing-wallet add-signer admission.
The [Gateway publication report](ml-dsa-65-gateway-publication-report.md) records this boundary.
Fresh passkey approval authorizes the exact wallet and slot. The durable journal records both
participant installations and publishes their agreed public key. Seed envelopes and recovery
sets remain unchanged. The [public signing report](ml-dsa-65-public-signing-report.md) records
normal Wallet transaction signing, existing review UI, and dedicated ML-DSA grants.
The [lifecycle report](ml-dsa-65-wallet-lifecycle-report.md) describes canonical seed export and publication replay.

Participant relocation is explicitly refused after execution starts. Its future implementation
must transfer participant state and the publication journal together. Expired unused admissions
release their slots through versioned tombstones. An active custody owner can replace an expired,
unpublished creation with fresh preparation and a higher epoch. Published and interrupted restoration
records retain their existing protections.

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

- [x] Admit existing-wallet passkey add-signer operations through Wallet authentication and ownership checks.
- [x] Discover participant keys over authenticated private Gateway/Router/participant transport and use them for encrypted input delivery.
- [x] Add encrypted storage and consuming restoration for generic private key-generation state, with exact schedule and participant bindings.
- [x] Add authenticated, single-use external table storage and bounded cleanup, verified by native canonical key generation.
- [x] Connect the complete private-state and table reservation to Worker key generation.
- [x] Keep generic signing preparation ready before registration. Bind it to the new key without regenerating correlations.
- [ ] Distinguish durable key activation from signer readiness. Require the configured paired signing reserve before reporting immediate signing availability.
- [x] Atomically consume preparation before private input selection. Burn uncertain or interrupted reservations.
- [x] Execute real wallet-derived key generation on Workers and store each output share locally.
- [x] Check public-key agreement and bind the verified manifest to the durable activation.
- [x] Publish the added key after both installations and authenticated existing-custody completion. Preserve the existing seed envelope and recovery set.
- [x] Recover the same canonical key with fresh shares, preparation, and an advanced epoch.
- [ ] Test interruption after each participant's installation and before public key publication.

Exit: SDK registration and recovery create a durable signer that survives Worker restart.

## 3. Public transaction signing

- [x] Add an explicit ML-DSA capability, wallet-key record, and exact owner-approval gate.
- [x] Compose the gate with private Router signing in local workerd.
- [x] Load the signing target from durable publication and current owner records.
- [x] Persist exact operations in the authoritative operation store with atomic passkey counter and approval commits.
- [x] Mount public preparation and signing routes with fresh exact passkey approval.
- [x] Add reusable sessions only after the ML-DSA authority and revocation projections exist.
- [x] Expose native transaction display, signing, signature verification, and RPC submission through the advanced SDK.
- [x] Connect the standard Wallet transaction-review UI and iframe lifecycle.
- [x] Enforce the selected NEAR network's protocol support before on-chain key enrollment. The SDK reads finalized protocol configuration before AddKey approval. See the [release qualification](ml-dsa-65-sdk-release-qualification.md).
- [x] Confirm a threshold-signed transaction through the complete SDK path.

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
- [x] Test authorized canonical seed export using an independent ordinary ML-DSA implementation.
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

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
- [ ] Connect the barrier to admitted key generation, rather than synthetic material installation.

The Gateway's custody assertion remains a prerequisite. Client-supplied manifest data does not establish that assertion.
Activation status must remain distinct from signing-pool availability.
A completed activation does not promise that a signing batch is ready.

The [activation report](ml-dsa-65-activation-report.md) records the implementation and local E2E limits.

## 2. Admitted registration and canonical recovery

- [ ] Admit the custody operation through existing Wallet authentication and ownership checks.
- [ ] Discover authenticated role recipient keys and deliver only each role's encrypted input.
- [ ] Persist generic key-generation preparation with exact schedule and participant bindings.
- [ ] Keep generic signing preparation ready before registration. Bind it to the new key without regenerating correlations.
- [ ] Distinguish durable key activation from signer readiness. Require the configured paired signing reserve before reporting immediate signing availability.
- [ ] Atomically consume preparation before private input selection. Burn uncertain or interrupted reservations.
- [ ] Execute real wallet-derived key generation on Workers and store each output share locally.
- [ ] Check public-key agreement and bind the verified manifest to the durable activation.
- [ ] Publish the Wallet key only after both installations and custody persistence complete.
- [ ] Recover the same canonical key with fresh shares, preparation, and an advanced epoch.
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
- [ ] Measure registration, successful signing, and recovery with prepared capacity available.
- [ ] Measure pool wait, refill throughput, full-reserve cost, and failures separately.
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

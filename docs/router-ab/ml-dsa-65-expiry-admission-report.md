# ML-DSA expiry and admission candidate — October 25, 2026

The candidate retains newly refilled signing material for one hour and checks stock before claiming the global signing slot.
Hosted performance remains unmeasured until the new test credential uploads are approved.

## Changes

The refill deadline changes from ten minutes to one hour for new material only.
The deadline remains part of the sealed binding. Existing material is never renewed.
Initial registration stock retains its fifteen-minute deadline. Producer leases remain ninety seconds.
Recovery epochs, reservation deadlines, one-use consumption, and failed-operation cooldowns remain unchanged.

Admission first checks exact replay, custody authorization, cooldown, and service capacity without claiming a slot.
The Router then reads both participant inventories. Empty stock retains the exact request and retry time without claiming capacity.
For sufficient stock, Begin repeats all authoritative admission checks inside its transaction.
The Router repeats inventory and reconciliation under the exclusive claim before reservation.
A ready call gains two serial exchanges. Hosted latency must establish the cost.

Preparation stays on Workers. Each refill prepares four candidates, consumed two at a time.
Each wallet keeps thirty-two candidates, with sixteen required for admission.
The service retains one active signing operation and one active preparation job.
Wallet-seed recovery and ordinary FIPS seed/key export remain unchanged.

## Evidence and limits

The existing SQLite lifecycle E2E passes with new checks for capacity-free stock waits, restart, and the longer sealed lifetime.
The source review finds no blocking change to authorization, replay, cooldown, recovery fencing, or single-use handling.
The native lifecycle test uses synthetic encrypted preparation. The Worker lifecycle test exercises real cryptography separately.

The capacity instrument reproduces the prior four-wallet ledger, disposal bound, unused-material audit, producer profiles, and trace coverage.
The new admission counter distinguishes empty preflights from subsequent claims within the same Router invocation.
A synthetic calibration exercises one empty preflight and one ready claim. Hosted nonzero checks remain required.
The expiry analysis reads the campaign lifetime and recorded material deadlines.
A twenty-minute load may have no interval after all starting material becomes unusable under the one-hour policy.
The campaign must report this limitation and measure full reserve restoration separately.

The initial local Worker campaign reaches canonical registration, recovery, and signing, then fails a stale Gateway test assertion.
Classification: obsolete_test_or_fixture. The assertion expects conflict after a lost publication acknowledgement.
Current publication code rereads the durable result and returns the same receipt, as required by the lifecycle specification.
The fixture now checks the successful receipt and that fault injection occurred.
The repeat passes that check, then finds an obsolete error-code expectation for a changed signing assertion.
Current exact-approval validation rejects it as unauthorized. The fixture now expects that refusal.
The next repeat passes that assertion, then stops at the retained-signer recovery fixture.
That fixture creates an authority with only Ed25519 activation. Current signing requires explicit ML-DSA activation and correctly refuses it.
Classification: obsolete_test_or_fixture. That broader fixture repair remains separate. The full Gateway campaign is not qualified by this run.
The dedicated real-Worker pool E2E passes separately. It records three signing samples and checks empty-pool replay, automatic refill, restart, producer interruption, and reservation cleanup.
The [local evidence](../evidence/ml-dsa-65-expiry-admission-20261025.json) retains exact source and Worker hashes.
Its compressed artifact contains the complete local observations. It establishes no hosted throughput or latency result.

The bloat check retains its inherited failure: 13,972 duplicated Rust lines against the 13,754 baseline.
This candidate adds no duplicated Rust lines. The baseline remains unchanged.

## Diagnosis record

| Fact | Evidence | Status |
| --- | --- | --- |
| Thirty newly prepared pairs became unavailable without use in the prior eight-wallet run | Sustained capacity report and recorded deadlines | Measured; retirement cause remains unobserved |
| The previous admission path claimed the global slot before inventory RPCs | Prior coordinator and admission source | Source fact; occupancy contribution was not measured |
| The candidate empty path records a retry without an active slot or cooldown charge | Durable lifecycle E2E | Passed |
| Untouched material survives the prior deadline and disappears at its sealed deadline | Durable lifecycle E2E | Passed |
| The candidate adds two exchanges for a ready request | Coordinator source | Hosted latency cost remains unknown |

| Candidate cause | Fits prior evidence | Candidate prediction | Validation |
| --- | --- | --- | --- |
| Short material lifetime causes idle stock replacement | Deadline/readiness disappearance fits | Fewer unused refill pairs disappear | Hosted comparison pending |
| Empty inventory calls contend for the global slot | Source permits this | Empty preflights claim no slot | Local state checks pass; hosted counts pending |
| Producer execution remains the capacity ceiling | Prior median F4 preparation takes about eighteen seconds | Throughput remains bounded even if waste falls | Hosted producer profiles pending |
| Measurement assumes the old lifetime | Previous expiry guard used a ten-minute description and fifteen-minute upper bound | One-hour starting stock could invalidate that analysis | Guard corrected; baseline metrics reproduce |

The next campaign repeats four wallets for twelve minutes and eight wallets for twenty minutes.
It uses durable Cloudflare clients, exact Worker versions, independent signature verification, and bounded public traces.
It also checks complete demand latency, reserve restoration, expiry loss, replay, and matched A/B consumption.
These tests measure the private authenticated Worker path. Browser approval, public SDK/Gateway transport, and NEAR finality remain outside the timing boundary.

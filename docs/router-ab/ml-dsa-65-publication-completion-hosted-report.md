# ML-DSA durable publication: hosted rerun

The completion fix remains selected. It checks exact durable publication records before reporting a preparation failure.
This report records the hosted validation and its limits. It does not establish a causal speed improvement.

## Completion evidence

The local real-Worker test drops the final A publication reply after the write.
It verifies Published, both ready halves, lease release, publication evidence after actual consumption, and changed-expiry refusal.
Existing failure-backoff, restart, single-use, and deadline cases pass with three verified signatures.

The hosted archive contains 307 completion receipts.
It records 302 Published, 5 Failed, and 0 Interrupted receipts.
One ordinary error reconciliation confirms publication. No interrupted-producer recovery confirms publication in this hosted run.
Reported failures with evidence for every pair: 0.
Reported failures with any paired or taken material: 0.
A partially published group can supply valid independent pairs. This does not prove the whole group completed.
One hosted Run error confirms paired publication with one observed producer execution.
The deterministic lost-reply fault remains separate local workerd evidence.
Lease expiry retains the existing Interrupted behavior. Historical publication never restores signing rights.

## Hosted measurements

Eight target wallets use two preparation slots and sixteen pairs per wallet.
Consumption remains two candidates at a time. Ordinary refill jobs prepare four candidates.
One-pair deficits can use a two-candidate job. The runtime default remains one preparation slot.
Refill retention remains one hour. Preparation stays on Workers. GPU work stays deferred.
Wallet-seed recovery, standard FIPS export, and pool capacity remain unchanged.

All sixteen target registration/recovery cases reproduce their canonical key.
Registration/recovery seconds: 6.001 minimum, 7.774 median, 13.091 maximum.
These times exclude prior generic preprocessing.
Generic setup preprocessing seconds: 47.789 minimum, 74.919 median, 119.189 maximum.
Setup signing seconds: 1.240 minimum, 3.370 median, 15.072 maximum.
Setup signatures with failed outcomes: 0.

| Phase | Verified client signatures | HTTP seconds: min / median / max | Empty responses | Signatures/minute with reserve restoration | Cycle qualified |
| --- | ---: | --- | ---: | ---: | --- |
| warmup | 70 | 0.666 / 1.952 / 10.556 | 154 | 5.833 | False |
| completion | 43 | 0.742 / 3.037 / 7.970 | 0 | 5.260 | False |

Successful HTTP latency excludes earlier admission waits. Demand latency in the archive includes those waits.
The rates cover finite load plus restored reserves. They do not establish maximum capacity.
Qualification means the version, capture, and availability ledger checks passed. It does not mean every request succeeded.
These private Router calls exclude browser approval, public Gateway transport, and NEAR finality.

The following job measurements require positive completion receipts. Wall time includes waits.

| Phase | Producer | Jobs | A CPU median, seconds | A wall seconds: min / median / max |
| --- | --- | ---: | ---: | --- |
| warmup | preparer-a | 38 | 3.956 | 8.294 / 9.323 / 12.495 |
| warmup | preparer-a-secondary | 34 | 4.050 | 8.748 / 9.701 / 14.302 |
| completion | preparer-a | 22 | 3.922 | 8.244 / 9.326 / 69.932 |
| completion | preparer-a-secondary | 18 | 3.991 | 8.650 / 9.601 / 15.546 |

## Preserved failures and limits

An initial wallet-two run lost its exact duplicate-registration reply to ECONNRESET after registration returned HTTP 200.
An initial wallet-three preparation returned HTTP 500. Captured A execution threw an exception and B calls were canceled.
The preparation failure cause remains unresolved. Both failed records remain in the archive.
Separate synthetic identities replace those incomplete cases in the target load. No failed signing request is resubmitted.
Non-target preparation jobs observed in the phase profiles: 0.
Any such activity limits comparison with an isolated eight-wallet campaign.

Interrupted client requests reconciled by ordinary read-only status: 1.
The completion phase has one 45-second client timeout. Its later ordinary status is Declined, with no recovered signature.
Its last request-bound inventory contains exactly the twelve pairs missing from the availability ledger.
The inventory arrived 22.144 seconds after the claim. Both participants later report all twelve pairs retired.
Their material had 49–58 minutes remaining when readiness disappeared. Material expiry does not explain this loss.
The mutation that retired the pairs remains unknown. Reservation expiry is a hypothesis requiring further evidence.
Two warm-up ledger gaps fit the thirty-second readiness margin. Their physical retirement cause also remains unobserved.
Both cycles remain unqualified. These results do not meet a consistent latency or release-pass requirement.
The completion load records one preparer-B loadShed event. The warm-up load records none.
Original client results remain unchanged.
Retired pair inspections establish unavailability. They do not distinguish a physical burn from an unlogged consumption.
Readiness-loss timing supports an expiry-margin explanation only where the recorded deadlines match. It does not prove physical pruning.
The archive retains failed and unqualified runs.

## Remaining admission failure

| Fact | Instrument and boundary | Result |
| --- | --- | --- |
| Final inventory matches twelve gaps | Request-bound Router trace and closed cycle ledger | Exact identity match |
| Inventory arrives after claim | Same request timestamps | 22.144 seconds |
| Material remains live at disappearance | Recorded job deadlines and readiness snapshots | 49–58 minutes remain |
| All twelve become unavailable | Read-only A/B inspection | Retired at both participants |
| Client result remains failed | Original client artifact and ordinary status lookup | Timeout, then Declined |

| Candidate cause | Deadline evidence | Request and availability evidence | Status |
| --- | --- | --- | --- |
| Material expiry | Contradicts: substantial lifetime remains | Does not explain this loss | Removed |
| Reservation expiry in our code | Says nothing about material lifetime | Fits cancellation and retirement | Unproved |
| Other cleanup or unlogged consumption | Says nothing | Fits final unavailability | Unproved |
| Measurement omissions | Says nothing | Exact final inspection confirms unavailability, but mutation logs are incomplete | Still limits diagnosis |

Next, capture both participant reservation replies and the exact retirement reason, operation binding, and deadline.
Measure cancellation and recovery through the same Router path. These observations can distinguish reservation expiry from other cleanup.
The existing benchmark does not establish full public SDK parity or sustained maximum capacity.

## Reproduction and cleanup

The replay verifies 132 standard signatures and rejects all 132 changed messages.
It reproduces phase summaries, material accounting, publication outcomes, and observed-use checks without network access.
Run python3 replay.py after extracting the archive.
The closed capture uses stable fixed-window fingerprints and exact deployment versions through reserve restoration.
All eight temporary Workers are deleted. Independent deployment lookup confirms their absence.
Credential payloads are removed. Private fixture keys and raw authenticated tails are excluded from the public archive.
The required bloat check retains its inherited Rust duplication failure: 13,972 lines against a 13,754 baseline.

[Evidence index](../evidence/ml-dsa-65-publication-completion-hosted-20261026.json) and [replay archive](../evidence/ml-dsa-65-publication-completion-hosted-20261026.tar.gz).

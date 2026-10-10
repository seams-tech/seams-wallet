# Registration batching and allocation overlap — 10 October 2026

The candidate removes one Console request and six completed D1 calls from each
registration. This run does **not establish an overall latency improvement**.
The later baseline was slightly faster than the candidate. Keep the changes:
they remove work and serial dependencies without adding a second code path.
The 3–4 s registration-to-first-signature target remains unmet.

## Comparison

The run used three new wallets per group on existing staging testnet resources.
The client ran Chromium in Tokyo and used the APAC Gateway. Each wallet enabled
only NEAR signing, used an implicit account, and produced a NEP-413 signature.
Funding and blockchain confirmation were outside the flow.

The baseline used public `63acba09` and private `680bb10`. The candidate used
public `941e01b3` and private `535af1b`. The control repeated the exact baseline
Worker versions after the candidate. All three groups used the same browser
payload, four custody Worker versions, placement configuration, and tracing.
The candidate changed nine host Workers: Console, four Gateways, and four Runtimes.

The candidate combines ceremony identity reuse, setup-time home persistence,
the early recovery-code route claim, Console D1 batching, and allocation overlap.
This comparison cannot isolate the saving from any single commit.

## Results

These are paired SDK measurements. Registration excludes its measured WebAuthn
interaction. First signing excludes its measured confirmation interaction.
Signature proofs were verified independently after collection. Automation and
offline verification time are outside these SDK figures.

| Workload | Baseline median (range) | Candidate median (range) | Repeated baseline median (range) |
| --- | ---: | ---: | ---: |
| Registration, excluding WebAuthn | 5.184 s (5.119–5.823) | **4.354 s (3.782–4.716)** | 4.227 s (3.787–5.814) |
| Registration, including WebAuthn | 5.458 s (5.232–5.954) | 4.988 s (4.182–5.073) | 4.763 s (4.423–6.203) |
| First signature, excluding confirmation | 1.644 s (0.671–1.678) | 0.899 s (0.669–1.141) | 0.760 s (0.742–0.868) |
| Registration plus first signature, excluding interaction | 6.797 s (6.494–6.828) | **5.253 s (4.450–5.858)** | 4.970 s (4.547–6.682) |

Each cell contains three observations. The upper range value is the observed
maximum. Medians of separate stages or workloads must not be added.

| Stage median | Baseline | Candidate | Repeated baseline |
| --- | ---: | ---: | ---: |
| SDK setup | 848 ms | 585 ms | 454 ms |
| SDK respond | 419 ms | 635 ms | 388 ms |
| SDK custody execution | 2,318 ms | 1,674 ms | 1,988 ms |
| SDK finalization | 1,780 ms | 1,116 ms | 1,201 ms |
| Gateway finalization service | 1,449 ms | 796 ms | 874 ms |
| Router Yao execution | 1,822 ms | 1,324 ms | 1,698 ms |

Finalization was faster in the candidate than in either baseline group. Its
service median was 78 ms below the repeated baseline. Three samples per group
do not establish a stable saving. Custody versions were fixed, yet their timings
also changed substantially. Physical cold state and colocation were not proven.

## Requests and D1 work

Counts were identical across all three wallets within each group. These D1
counts include calls completed when the response was recorded. Setup and
finalization each still had one pending background call in every group.
No D1 trace entries were dropped. Counts exclude custody's own storage work.

| Completed calls per flow | Baseline | Candidate | Repeated baseline |
| --- | ---: | ---: | ---: |
| Gateway setup D1 | 5 | 5 | 5 |
| Gateway respond D1 | 7 | 6 | 7 |
| Gateway execute D1 | 2 | 2 | 2 |
| Gateway finalize D1 | 16 | 15 | 16 |
| Gateway sign prepare D1 | 3 | 3 | 3 |
| Gateway sign D1 | 4 | 4 | 4 |
| **Gateway D1 total** | **37** | **35** | **37** |
| **Console D1 total** | **18** | **14** | **18** |
| Console requests | 6 | 5 | 6 |
| Browser requests | 6 | 6 | 6 |
| Session-status requests | 0 | 0 | 0 |

Setup-time home persistence removes the continuation's Console home read and
one Gateway D1 batch. Ceremony identity reuse removes one finalization read.
Console batches remove two further D1 calls. Including both databases, completed
registration calls fall from 48 to 42. The subsequent signature adds seven
Gateway D1 calls in each group.

## Remaining measured costs

Candidate A-side preparation measured 198 ms median, and its peer connection
measured 277 ms. The protocol stage itself measured 274 ms on A and 230 ms on B.
These stages can overlap across roles. Their medians are not an additive budget.
The full SDK custody stage remains 1.674 s.

Candidate finalization still makes 15 Gateway D1 calls. Capability installation
measured 179 ms median, and session issuance with home publication measured
212 ms. The next code target is their serial persistence work. Inspect whether
capability installation and session issuance can share a transaction before
publication, while retaining exact retry, ownership checks, and recovery after
a lost reply. Any saving remains unmeasured.

The plan also records a separate staging role-database move. This comparison
uses the original bindings. Freeze new baseline versions after that cutover:
the versions saved here retain their old database bindings. Reusing them would
measure the old databases. Remeasure A-side preparation and peer-connection
admission before choosing further transport changes. The local 834.6 ms registration median remains a
separate benchmark with virtual WebAuthn and stub chain RPC; see the
[local benchmark](../optimization-12-NEAR-only-20261006.md).

## Verification and restoration

All nine registrations and signatures passed. Independent Node.js verification
reconstructed the NEP-413 payload and verified all nine Ed25519 signatures.
Changes to the message, recipient, nonce, or callback URL were rejected.
All 18 comparison checks passed, including invocation versions, early startup,
one startup per wallet, and zero session-status requests. All four stored role
object IDs matched the candidate's invocation logs for each of its three wallets.

Independent live readback verified all 13 original Worker versions and both
original Deriver schemas after restoration. Original tenant activation passed.
The additive address table remains in each of the four Gateway databases.
This experiment created no infrastructure and changed no production deployment.

The private artifact directory is `.artifacts/r155d-allocation-hosted` in
`seams-monorepo`. It retains frozen inputs, hashes, invocation traces, browser
artifacts, analysis programs, and cleanup records. The public
[machine-readable evidence](refactor-155d-allocation-hosted.json) contains the
sanitized measurements and independently verifiable public signature proofs.

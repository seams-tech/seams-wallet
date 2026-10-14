# ML-DSA-65 generic preparation and activation

Date: October 15, 2026. Branch: `ml-dsa`. Production integration remains paused.

## Result

The signer can now prepare nonce shares and silent-OT correlations before a wallet key exists.
Activation consumes that preparation and binds it to one canonical key and epoch.
Canonical wallet-seed recovery and standard signature verification still pass.

The complete product target remains open.
Each benchmark request still creates its own preparation, and an exhausted reservation returns no signature.
There is no persistent ready pool, automatic rollover, or production registration admission in this change.

## Measurements

The [generated summary](../evidence/ml-dsa-65-generic-preparation-screen-20261015.json) retains successful signatures, exhausted reservations, and every observed request.

| Measurement | Result | Scope |
| --- | ---: | --- |
| Native activation, four/eight candidates | 8.8 / 16.9 ms | Maximum role time in the final separate-process E2E |
| Local activation plus successful signing | 55.0–56.3 ms | Two signatures; one exhaustion |
| Hosted activation plus successful signing | **173.7–195.6 ms** | Three signatures; three exhaustions |
| Hosted generic preparation progress | 35.4–58.1 s | Client request start to generic-ready event receipt |
| Hosted post-generic gap to readiness | 3.19–4.71 s | Includes fixture key creation; activation follows the start message |
| Hosted complete initial readiness | 38.7–62.8 s | Includes fresh preparation for every request |

The [hosted campaign](../evidence/ml-dsa-65-client-activation-worker-hosted-20261015.json) has no infrastructure failure.
All six requests acknowledge cleanup and close normally.
All three successful client intervals satisfy five seconds. Exhaustion remains an unsuccessful request.
The three observed gaps from generic-ready receipt to a successful signature are 3.38–3.52 seconds.
These progress-event gaps are exploratory observations, not a client-controlled registration benchmark.

The [final native E2E](../evidence/ml-dsa-65-generic-native-20261015.json) verifies the eight-candidate signature and canonical wallet recovery.
Its four-candidate reservation exhausts. Both mismatch cases reject before commitment evaluation.
The [local client-timed campaign](../evidence/ml-dsa-65-client-activation-worker-local-20261015.json) predates only the online-counter correction.
The hosted campaign verifies the corrected gate and exchange totals.

For each successful four-candidate reservation, generic preparation transfers 4,482,753 bytes and activation plus signing transfers 2,404,936 bytes.
The total remains **6,887,689 bytes**.
Including the three exhausted reservations gives **13,768,423 bytes per verified signature** in this small campaign.
These protocol counters exclude fixture key creation and transport envelopes.

The [sanitized traces](../evidence/ml-dsa-65-client-activation-worker-traces-20261015.json) contain six complete invocations per role at the deployed versions.
Both roles use 259,915 CPU milliseconds across the campaign, including preparation, fixture key creation, exhaustion, and cleanup.
The maximum observed Wasm linear memory is 89,260,032 bytes. This excludes JavaScript and other isolate allocations.
No concurrent capacity follows from this single-request memory measurement.

The deployment versions are A `3a9a67ff-670b-4fe4-94f5-892e200291db` and B `01ad4839-efe7-42bb-8de2-75afc68c05d8`.
The summary filters traces by those explicit deployment identities.

## Implemented boundary

`prepare_gmw_reservation` takes a role, fresh preparation identifier, candidate count, circuit set, and transport.
It receives no wallet seed, signing share, public key, epoch, or message.
It creates jointly sampled nonce shares and all required private correlations.

The consuming `activate` method then:

1. Agrees on the canonical public key, epoch, preparation identifier, candidate count, and engine.
2. Opens the already accepted public `t0` value and expands the public matrix.
3. Computes each role's share of `A·y` locally.
4. Runs prepared private commitment decomposition.
5. Returns one activated signing reservation.

Activation has 113 dependent AND-layer exchanges, plus bindings and outputs.
Signing retains 227 dependent AND-layer exchanges. The corrected client interval includes both stages: 340 exchanges and 3,537,148 AND gates for four candidates.
The change moves correlation generation before key creation; it does not reduce these online depths.

The Worker performs generic preparation before it derives the fixture's canonical key.
The native harness loads existing role-local key material first, then exercises the same split API.
These are different evidence scopes.

## Privacy and lifecycle review

Independent review found no new blocker within the passive, disposable in-memory prototype.
Rejected commitments remain private when either secret bound fails.
The change adds no secret-dependent branch, private-buffer clone, or serialization path.
Existing zeroizing owners retain nonce shares, correlations, and signing shares.

A persistent adapter must durably burn a generic reservation **before activation**.
A failed or canceled activation must never restore that reservation.
An activated reservation also requires a durable burn before message-bound signing.
Rust ownership enforces consuming handles inside one process; it does not prevent rollback of external storage.

The separate-process E2E cases change only B's key or epoch.
Both roles reject each mismatch after sending and receiving exactly 64 bytes of public binding data.
No commitment evaluation follows the rejection.
Cancellation behavior has ownership review, without a new interruption E2E or a physical memory-wipe measurement.

The existing LPN assumption and classical base OT remain unchanged.
Direct uniform signing nonces still replace the exact FIPS hedged nonce procedure.
Exported seeds, public keys, and signatures retain their standard encodings.

## Next implementation steps

1. Share immutable circuit topology and compact retained private correlations so several independent batches fit in a Worker.
2. Add a bounded pool with consuming activation and signing states. Preserve only untouched batches for later messages.
3. On exhaustion, consume the next ready batch and include all failed attempts in latency and payload totals.
4. Test activation cancellation, signing interruption, replay, epoch changes, and concurrent requests. Define explicit empty-pool behavior.
5. Measure canonical key creation, activation, and first successful signature within one client-controlled registration flow.
6. Measure replenishment throughput and sustained demand before resuming Router A/B production integration.

An empty pool must return unavailable or expose its wait explicitly.
Preparation time cannot be hidden inside a claimed successful five-second registration.
The current samples establish no p95, p99, throughput limit, or cross-account Router-path result.

## Timing instrument correction

The first hosted control returned zero for both activation and generic preparation clocks, for both roles in all six requests.
Those values are invalid elapsed-time measurements.
Cloudflare documents that Worker timers advance only after I/O: [Performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/).
The corrected benchmark starts activation only after a client message and measures activation plus signing with the client clock.
Standalone hosted activation time remains unknown.

| Fact | Instrument | Result |
| --- | --- | --- |
| Native activation executes work | Separate-process monotonic host timer | About 9 ms for four candidates and 17 ms for eight |
| Local Worker activation is nonzero | [Local control](../evidence/ml-dsa-65-generic-worker-local-20261015.json) elapsed clock | 12–15 ms across both roles |
| Hosted activation timer does not advance | Hosted Worker elapsed clock | Twelve zero readings across six requests |
| Hosted signing completes real protocol work | External client clock and independent verifier | Three signatures; three exhausted reservations |

| Candidate cause | Native/local nonzero | Hosted zero | Conclusion |
| --- | --- | --- | --- |
| Activation has no work | Contradicts | Fits alone | Rejected |
| Worker clock cannot isolate activation | Fits | Fits documented timer behavior | Measurement limitation |
| Signature or activation implementation failed | Successful verification contradicts this explanation for completed signatures | Zero alone gives no evidence | No failure established |

The earlier zero timer values remain in the [hosted clock-control artifact](../evidence/ml-dsa-65-generic-worker-clock-control-20261015.json). Generic preparation uses client progress timestamps in the summary.
They must not be used as evidence for zero-cost activation or a five-second registration guarantee.


## Reproduction and cleanup

The [research README](../../tools/ml-dsa-investigation/research/README.md#generic-preparation-and-activation) gives the native, Worker, and summary commands.
Both temporary Workers and the temporary R2 bucket were deleted after the campaign.
Private benchmark-token and raw trace files were removed; only sanitized traces remain.
The [cleanup record](../evidence/ml-dsa-65-generic-preparation-cleanup-20261015.json) records these actions.
Production services were unchanged.

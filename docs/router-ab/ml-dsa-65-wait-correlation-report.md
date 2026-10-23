# ML-DSA registration failure correlation and wait measurements

Public failure correlation is verified. The observations classify storage and peer operations, but physical wait-time attribution remains unresolved.

Registration now records public request, job, operation, phase, and participant-call identifiers before each dispatch.
The forwarded Durable Object request retains those identifiers when its final result trace is absent.
Detailed wait observations are disabled by default. Set `ML_DSA_WAIT_DIAGNOSTICS=1` on A and B for a diagnostic run.

No signing protocol, storage mutation, persisted format, deadline, or admission policy changed.
Wallet-seed recovery, canonical FIPS export, four-candidate preparation, two-at-once consumption, and thirty-two-candidate capacity remain unchanged.
The wallet cooldown remains sixty seconds. The service admits one active signing operation.

## Measurement contract

Each observed storage transaction has a begin event and an end or error event with the same call ID and sequence.
The categories cover table writes, table reads, private preparation publication and consumption, and signing-stock writes.
Peer connection is a separate category. Peer event observations count futures that complete immediately or suspend.
Only the first pending peer event in a segment emits a begin event. A storage boundary starts a new segment.

A boundary interval includes work polled inside its future. Worker clocks can retain an earlier event time during CPU work.
These intervals are not pure disk or network wait times. Their sum is not an additive partition of invocation wall time.
A missing end can mean a reset, log truncation, cancellation, or incomplete trace capture.
A pending peer event proves asynchronous suspension. It does not prove that the physical network caused the delay.

Each call permits 640 normal boundary events and at most four additional terminal error events.
Scope and summary records add two events. The summary records whether the boundary limit was reached.
A reset can prevent the summary. Public headers and earlier dispatch records provide the correlation fallback.
The collector retains allowlisted public fields. It excludes credentials, encrypted inputs, raw errors, and complete request headers.
Diagnostic identifiers never authorize a request or select its protocol state.

## Local calibration

The existing real-Worker registration E2E wraps the actual B storage transaction and peer connection adapters.
The production Wasm receives no injected-delay code.
The fixture requests a 400 ms delay. Each measurement must enclose the exact injection timestamps.

| Boundary | Requested delay | Actual timer delay | Observed boundary |
| --- | ---: | ---: | ---: |
| Creation peer connection | 400 ms | 401 ms | 405 ms |
| Creation table read | 400 ms | 402 ms | 423 ms |
| Recovery peer connection | 400 ms | 530 ms | 533 ms |
| Recovery table read | 400 ms | 444 ms | 487 ms |

Creation and recovery reproduce the canonical key. Durable replay survives a runtime restart.
One creation signature verifies. Recovery signing preserves the wallet cooldown.
This local test does not establish hosted latency or claim two successful signatures.

A separate test throws inside the actual table-read transaction after its known delay.
The injected delay lasts 401 ms. The matching failed boundary lasts 411 ms.
The assertion follows the failed call to `execute_peer`, the Router job and operation, and the original HTTP 500 request.
There are no completed registration cases in this failure test.
This proves local error correlation. It does not reproduce a provider storage reset.

The first calibration attempt failed before key generation because its wrapper called a WorkerEntrypoint class as an object.
That failure is classified as a test-fixture error. The corrected wrapper extends the generated class.
The failed artifact remains in the evidence archive.

## Repeat the local checks

Build Router, A, and B with `scripts/build-strict-worker.sh ROLE ml-dsa` from `crates/router-ab-cloudflare`.
Use the ordinary forwarding Router build as the E2E's standard build root.
Run `tests/e2e/ml-dsa-registration-worker.e2e.mjs KEYS_DIRECTORY ARTIFACT_JSON` with `ML_DSA_REGISTRATION_CALIBRATE_WAITS=1`.
Add `ML_DSA_REGISTRATION_FAIL_STORAGE=1` for the separate failure probe.
Both modes reject hosted execution. Use fresh preparation material for each run.
The successful artifact exposes `calibratedWaitBoundaries`. The failure artifact exposes `failureCorrelation.passed`.
A failure probe deliberately leaves `functionalPassed=false` and retains its observed HTTP error.

## Hosted results

The off arm fails during initial preparation after 61.118 seconds.
Its request, job, and call IDs exactly identify A's registration Durable Object invocation.
A reports 6.642 seconds CPU, 59.708 seconds wall time, and three storage-timeout-reset messages within that one invocation.
B's matching Durable Object invocation reports cancellation, with 12.452 seconds CPU and 57.790 seconds wall time.
B's cancellation does not establish a separate storage failure.
All twelve retained invocations contain zero detailed wait events. Correlation remains enabled.

The first enabled attempt stops before participant dispatch because the shared preparation slot remains reserved.
The existing `prepare_until` lease lasts five minutes. A failed preparation can block another wallet in the same environment until that deadline.
This retry is retained as `on-blocked`; it supplies no participant wait measurements.

All six temporary Workers were then deleted and recreated for a fresh enabled run.
Every deployment version changed. Binary hashes, credential hashes, and policy match the off arm.
Only A and B enable detailed wait observations. Preparation services and the ordinary forwarding Router retain their settings.
A deployment retry was needed after the provider accepted an upload and returned Worker-not-found during subdomain configuration.
The receipts preserve that infrastructure failure and its successful retry.

| Fresh enabled run | Creation | Recovery |
| --- | ---: | ---: |
| Full registration preparation | 121.730 s | 118.214 s |
| Registration with client verification | 6.165 s | 15.954 s |
| Verified initial-stock signature | 23.556 s | 8.502 s |

Preparation includes generic key-generation material and sixteen initial signing candidates.
Both signatures verify. Recovery reproduces the same canonical public key.
These diagnostic samples miss the five-second target.
The failed off baseline and the small sample cannot estimate observer overhead or establish a latency regression.
The two arms also differ in fresh deployment versions and uncontrolled hosted conditions.

The fresh run retains 595 provider invocations and twelve wait scopes with summaries.
No retained invocation reports provider log truncation. No wait scope reaches its event limit; the largest emits 533 boundaries.
Thirteen provider invocations have canceled outcomes and no exceptions. These are invocation outcomes, not thirteen failed signatures.
The completed lifecycle and signatures must be considered when interpreting forwarding and alarm cancellation.

The measurements separate operation categories, but they do not yet separate physical storage time from protocol time:

- B performs 48 measured table-read transactions across creation and recovery. All suspend; all report zero elapsed milliseconds.
- B performs 340 table-write transactions. All suspend; 321 report zero. The maximum reported interval is 51 milliseconds.
- A's preparation connection intervals are 2,666 and 1,791 milliseconds. Its execution connection intervals are 114 and 653 milliseconds.
- One A execution reports 2,960 milliseconds in its peer counter against 2,890 milliseconds of provider invocation wall time.
- Provider console timestamps give the same interval differences as the Worker clock for these boundaries.

The peer counter therefore cannot partition provider wall time. Zero storage intervals do not prove free I/O.
Potential causes include clock behavior, cached storage completion, deferred durability gates, CPU work, and peer scheduling.
This screen cannot rank those causes. Detailed tracing remains disabled by default.

## Facts and remaining causes

| Fact | Instrument and check | Limit |
| --- | --- | --- |
| Known delays appear in the correct category. | Local real-Worker E2E with exact injection containment. | Hosted storage timing is not calibrated by this local result. |
| An injected read failure joins to its original HTTP request. | Local transaction failure, public call/job/operation IDs. | A controlled error is not a provider reset. |
| A hosted storage reset joins to the failed preparation request. | Off-arm provider headers, Router links, and participant dispatch links. | The exact storage operation is absent because detailed tracing is off. |
| The next preparation is refused while the lease remains active. | Provider error category and the existing five-minute `prepare_until` state. | No production retirement behavior changes in this patch. |
| Fresh hosted creation, recovery, and signing complete. | Client canonical-key and signature checks. | Two samples do not qualify reliability or latency. |
| Storage suspension frequently records zero duration. | Typed begin/end events and first-poll observations. | Suspension and zero timestamps cannot determine physical wait cost. |
| A peer counter exceeds its invocation's reported wall time. | Same-call summary and provider invocation record. | The two readings cannot be treated as additive time accounting. |

| Possible cause | Evidence | Status |
| --- | --- | --- |
| Application storage access or durability ordering contributes to resets. | A reports a storage reset; the active storage operation was not captured in that arm. | Open. |
| Provider storage/runtime behavior contributes. | The correlated reset category supports a storage boundary failure. | Open; platform-only attribution is unsupported. |
| Peer flow control, CPU work, or runtime scheduling contributes to long elapsed time. | Peer counters are large and include more than pure waits. | Open. |
| Detailed wait tracing is required to trigger the reset. | The off arm has zero detailed wait events and still resets. | Contradicted. |
| Baseline logging or enabled-observer overhead affects latency. | No successful off baseline exists for comparison. | Open. |
| The client invented the storage failure. | The request joins to the provider reset through exact identifiers. | Contradicted. |
| Larger pools produced these results. | Both scopes have identical policy and capacity. | Contradicted. |

An independent reviewer checked the local calibration, exact off-arm failure chain, fresh-run measurements, hashes, and coverage.
The review required exact delay containment, a bounded terminal-error allowance, and proof that the failure injection executed.
Those changes are included. The evidence archive preserves the failed fixture attempt and the blocked hosted retry.
The sanitized hosted records cover five roles; forwarding-front invocations are outside that dataset.
No truncation flag proves only that the retained records were not marked truncated. It does not prove complete tail coverage.
The successful enabled run has no instrumented storage reset. The exact active storage boundary during a hosted reset remains unobserved.

## Next high-impact work

1. Measure transaction completion and durable commit separately in a bounded diagnostic experiment. Include an externally timed control before attributing disk cost.
2. Measure peer completion gates and CPU work separately. Keep peer counters labeled as boundary observations until that calibration passes.
3. Add durable retirement of definitively failed generic preparation, with interruption and late-completion checks. Preserve consumed-material fences and the existing capacity.
4. After selecting a demonstrated cause, change that path and repeat full creation, recovery, signing, and sustained refill qualification.

No storage optimization is selected from this screen. Full browser recovery, QR linking, and export UI are outside these diagnostic tests.
GPU and UI work remain deferred.
The required bloat check still fails only at the inherited Rust duplication excess: 13,972 lines against the 13,754-line baseline.
The baseline remains unchanged.
All six temporary Worker names were removed after each campaign. Both cleanup receipts are retained.

The [evidence summary](../evidence/ml-dsa-65-wait-correlation-20261024.json) links the compressed source, artifacts, public traces, hashes, analysis scripts, and cleanup receipts.

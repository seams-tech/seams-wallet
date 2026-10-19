# ML-DSA bounded initial-stock delivery

Campaign: 2026-10-19 JST. Bounded delivery passes the local failure/retry tests and hosted functional checks.
Observed participant installation medians fall by about 15–17%, but complete registration does not improve in this screen.
Prepared registration median rises from 6.707 to 7.033 seconds. The five-second target remains unmet.

Registration now delivers at most two initial signing batches concurrently per participant.
A and B can therefore have up to four delivery futures across their separate trust boundaries.
The candidate count, pool capacity, wallet-seed derivation, FIPS export, and two-at-once signing consumption are unchanged.
Preparation remains on Workers. UI and GPU work remain deferred.

## Motivation and implementation

The previous profiling campaign measured 6.835–6.853 seconds in installation during its slowest recovery.
Execution was larger than installation in the other three ceremonies.
This experiment targets installation tails without claiming that installation dominates every registration.

Each participant processes ordinal pairs in order.
Both futures settle before the next pair starts or an ordinary error propagates.
An odd final ordinal runs alone. Each batch retains its own binding and installed marker.
The existing ciphertext is persisted before delivery. Retries use the same persisted payload, including ciphertext.

A mutex serializes installation requests for one registration Durable Object.
An exact concurrent retry therefore cannot start another delivery window while the first request is active.
The request checks authority before entering the gate and checks it again before new work after waiting.
A queued retry that finds the complete installed marker performs no new delivery.

The whole installation attempt is bounded by the existing registration claim deadline.
The bound includes authority checks, mutex waiting, share installation, batch delivery, and the final installed marker.
Expiry drops the local future and its mutex guard. Remote requests can still complete later.
Per-ordinal persistent data, target authority checks, and Router completion checks remain unchanged.
The two-future bound describes a live installation attempt. It does not claim that a timeout cancels remote execution.

No persistence format, signing protocol, or custody authority changes.
There is no compatibility mode or delivery-width flag.

## Validation design

The local fault fixture forwards real commands to the real participant-A pool.
It delays successful replies by 150 milliseconds and loses the first successful ordinal-zero reply.
The test requires these outcomes:

1. The first pair overlaps, and both local deliveries settle before the failed request returns.
2. No ordinal above one starts after that failure.
3. Restart preserves the original delivery data.
4. Two concurrent private installation retries complete with a maximum of two active deliveries.
5. Ordinal zero is sent twice with an identical complete request hash. Every other ordinal is sent once.
6. Finished claims cause no new deliveries.
7. Ordinary registration, canonical recovery, and standard signatures still pass.

A separate deadline probe holds a successful reply for forty-five seconds.
The request must end at its existing thirty-second claim deadline.
Expired retries must be refused promptly. This proves early expiry rejection, not independently that the mutex unlocked.
After the late reply completes, the public registration operation must remain failed.
This probe makes no successful-registration or recovery latency claim.

Hosted profiles use the same policy: four-candidate preparation, two-candidate consumption, thirty-two candidates per wallet, and sixteen ready candidates for admission.
Each profile creates and recovers two wallets, verifies initial-stock signatures, and restores full reserves.
This is a registration screen, not a sustained signing-throughput screen.
Sequential deployments retain uncontrolled placement and runtime variation.

## Measurement rules

Use complete client latency and enclosing Router/role invocation wall time for the performance comparison.
Per-ordinal spans overlap in the new implementation. Their sum is not installation elapsed time or the critical path.
The existing Worker stage clocks can remain fixed during real work and cannot partition storage, copying, or serialization costs.
Installation stage marks start after mutex acquisition. Enclosing invocation wall time includes any gate wait.
Count only unique operation/role/job records. Preserve missing and repeated records.
The concurrent-delivery count is a live-window bound, not a measurement of total Worker heap usage.

## Fact and cause record

| Fact | Instrument | Scope | Check |
| --- | --- | --- | --- |
| Previous slowest recovery has long installation calls | Platform wall/CPU and exact registration records | Previous hosted campaign | Reviewed retained evidence |
| Each batch has an independent persistent delivery and marker | Production storage flow | Current source | Exact replay test |
| A pending mutex can couple exact retries | Await graph | New installation gate | Existing deadline encloses the guarded attempt |

| Candidate cause | Distinguishing observation | Status |
| --- | --- | --- |
| Sequential deliveries add avoidable waiting | Local fixture observes two overlapping deliveries; hosted role installation medians decrease | Supported as an installation-stage experiment. No isolated causal speed estimate. |
| Other registration work limits the complete result | Installation medians fall while complete registration median rises | End-to-end benefit remains unproven. Execution and surrounding calls need further work. |
| New concurrency breaks retries or single-use state | Lost-reply, restart, concurrent retry, expiry, and standard signing tests pass | No failure found in the tested scenarios. |
| Placement/runtime variation changes latency | Control/candidate work varies without isolated code attribution | Comparison limitation |

## Results and cleanup

The normal local control and candidate both pass creation, recovery, replay, and initial-stock signature checks.
Local control creation/recovery takes 1.359/1.089 seconds. The bounded build takes 1.369/1.391 seconds.
These individual local observations do not establish a latency improvement.

The lost-reply test passes. Before restart, only ordinals zero and one were delivered, active delivery count is zero, and the observed maximum is two.
After two concurrent private installation retries, ordinal zero has exactly two attempts with the same complete payload hash.
Every ordinal from one through seven has one attempt. The maximum remains two.
Finished private claims receive HTTP 500 without another delivery. Standard public replay, canonical recovery, and subsequent signatures pass.
The fixture's 196.539-millisecond creation measurement covers the final resumed public request after private installation.
It is excluded from fresh-registration latency comparisons.

The deadline probe returns after 30.005 seconds. Expired private retries return in 8.962 milliseconds with HTTP 500.
One remote reply remains active at timeout and completes later. The public operation stays failed after that late reply.
This confirms the late-reply refusal scenario and prompt expiry rejection. Mutex release also relies on Rust's destruction of the canceled future and guard.

### Hosted registration comparison

Both profiles use fresh temporary Workers and identical policy. Each performs creation and recovery for two wallets.
Times below include client verification and exclude preceding preparation:

| Wallet | Control create / recovery | Bounded create / recovery |
| --- | ---: | ---: |
| 1 | 4.667 / 7.648 s | 5.290 / 6.971 s |
| 2 | 6.884 / 6.530 s | 7.888 / 7.094 s |
| Median across four ceremonies | 6.707 s | 7.033 s |
| Ceremonies below five seconds | 1/4 | 0/4 |

All eight hosted ceremonies verify their canonical public keys and authenticated results.
Creation, recovery, and both profiles reproduce the same key for each synthetic wallet.
All eight initial-stock signatures pass verification during the E2E.
The four candidate signatures are also retained and independently reverified, including rejection of altered messages and signatures.
The control and earlier local artifacts retained verification outcomes rather than signature bytes. They cannot support independent signature replay.

Each profile has all eight execution traces, eight installation traces, and sixty-four ordinal traces.
Every expected ordinal appears once per participant and ceremony.
The comparison uses enclosing participant invocation wall time:

| Measurement | Control | Bounded |
| --- | ---: | ---: |
| A installation median | 1.737 s | 1.444 s |
| B installation median | 2.178 s | 1.848 s |
| A installation range | 1.620–1.792 s | 1.174–1.759 s |
| B installation range | 1.742–2.659 s | 1.309–2.199 s |

The observed median reductions are 16.8% on A and 15.2% on B.
A and B run in parallel, so their wall times must not be added.
The sequential deployment screens do not isolate runtime placement, CPU variation, or every effect of the code change.
Only one of four paired complete-registration observations improves.
This evidence supports retaining the bounded scheduling implementation as experimental. It does not qualify registration below five seconds.

Both profiles restore sixteen ready pairs per role for each current wallet epoch, with no reserved pairs remaining.
The largest observed active inventory remains thirty-two candidates per role/wallet.
Preparation and signing consumption remain four candidates and two candidates respectively.
No pool size, admission minimum, production cooldown, or service-wide capacity increase hides the comparison.
This screen does not measure sustained signing throughput.

### Decision and next work

Keep the two-delivery bound and the new deadline coverage.
Keep persistence-before-delivery, exact payload replay, and per-ordinal installed markers.
Do not increase delivery concurrency based on this small screen.

Next, profile key-generation execution and the surrounding dispatch/activation calls with the same installed-stock policy.
Use complete invocation measurements where Worker clocks cannot partition work.
Continue body-delivery/copying/decoding investigation before choosing a new internal transport encoding.
UI work remains deferred. Wallet-seed recovery and standard FIPS export remain unchanged.

### Validation and cleanup

Strict release builds, JavaScript syntax, Rust formatting, whitespace checks, and the independent review pass.
All four local scenarios pass: normal control, normal candidate, lost-reply/restart/concurrent retry, and held-reply deadline.
The bloat gate remains red at unchanged inherited duplicate counts: Rust 13,984 against 13,754 and TypeScript 10,238 against 10,216.
All ten temporary Workers were deleted. Private campaign data was removed after sanitized evidence passed credential and hash checks.

- [Comparison](../evidence/ml-dsa-65-bounded-delivery-comparison-20261019.json)
- [Hosted evidence](../evidence/ml-dsa-65-bounded-delivery-hosted-20261019.json.gz)
- [Local fault and functional evidence](../evidence/ml-dsa-65-bounded-delivery-local-20261019.json.gz)
- [Source, runners, review, and deployment provenance](../evidence/ml-dsa-65-bounded-delivery-provenance-20261019.json.gz)
- [Validation and cleanup receipts](../evidence/ml-dsa-65-bounded-delivery-validation-20261019.json)

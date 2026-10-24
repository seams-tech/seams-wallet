# Optimization 11: NEAR registration and signing latency

Status, October 24, 2026: the original preparation and request-reduction work is
largely implemented. A current local and hosted baseline now exists.
One hosted registration failed during protocol execution. Its cause remains unresolved.
Temporary tracing produced 44 verified hosted joins through the SigningWorker wallet object.
The hosted capture passed 21 transaction signatures and one separate message signature.
Captured wallet-object invocations took 7–31 ms for transaction requests.
Elevated CPU readings in stateless Worker events remain unexplained.
The native profiler did not attribute those spikes to source functions.
All profiling additions from this investigation are removed after evidence collection, as requested.
The tracing investigation closed without a verified new performance improvement.
A separate relayer RPC comparison verified savings under controlled delays. Live RPC savings remain unproven. See P4.
The remaining proposals below are deferred. They do not require further profiling or implementation now.
The PostgreSQL role adapter now supports Workers and passes a local transaction E2E.
PostgreSQL integration and provisioning are deferred at the user's request.
Storage replacement has no established gain.

The new baseline froze wallet `dev` at `cb7fd391` and private source at `1542df3a`.
It used SDK/server `0.21.0`. The staging iframe manifest reported `0.21.0`, and all
14 recorded backend deployment IDs stayed unchanged. Hosted browser assets came
from a frozen local HTTPS site. The October 21 comparison below remains historical.

This document tracks completed work and remaining priorities. [R155L](./refactor-155L.md)
records client preparation and conditional server changes. [R155J](./refactor-R155J-p99.md)
owns unresolved registration outliers and acceptance of tail latency, the slowest part
of the latency distribution. Reuse those investigations and their existing artifacts.

## Objective, ownership, and scope

Reduce registration through durable NEAR readiness and the complete
system-controlled time to a verified Ed25519 signature.

- Retain the 1–2 second signing target. Include SDK preparation, authorization,
  transaction context, prepare, client share, finalize, verification, and result assembly.
  Report every breach of two seconds for each measured cohort.
- Report full registration and registration after passkey completion separately.
  R155J's existing targets apply to its matched workload and measurement boundary:
  median at most 2.3 seconds, post-passkey median below two seconds, p99 below four
  seconds, and fewer than 1% of registrations above four seconds.
  Those targets remain unaccepted and do not establish a global latency guarantee.
- Preserve mixed registration's ECDSA-ready return while NEAR continues.
  NEAR-only registration must persist custody and the session before reporting ready.
  Custody still derives owner signing roots and verifies the key manifest.
  Recovery-backup acknowledgement must precede the custody commit.
- Cover passkey and Email OTP, NEAR-only and mixed registration, first signing,
  warm reuse, refresh/unlock, and exact-operation step-up as separate cohorts.

Wallet owns SDK behavior, protocol code, storage adapters, and behavioral contracts.
`seams-monorepo` owns managed deployment, Console integration, and hosted acceptance.
Use exact package and artifact versions across that boundary.

This update authorizes no deployment, provider cutover, wallet reset, new credentials,
new resources, or additional benchmark spend. Use separately authorized environments
and budgets for hosted experiments. Preserve frozen controls and existing evidence.

## Completed work

Completion here means the implementation and its recorded checks exist.
Each linked report states its measured environment and release status.
The observations below come from different cohorts and cannot be added together.

| Work | Completed behavior and evidence | Measured limit |
| --- | --- | --- |
| Durable NEAR-only readiness | Repaired refresh persistence and verified reload, lock races, export, and step-up. [September baseline](./optimization-11-NEAR-local-breakdown.md) | The corrected local run passed 40 registrations and 80 verified signatures. It supersedes the earlier result that omitted persistence. |
| Early session sealing | Reused mixed registration's seal preparation and finalization response for NEAR-only registration. [October 6 report](./optimization-12-NEAR-only-20261006.md#early-near-only-session-preparation) | Local registration median fell from 912.8 to 834.6 ms. Exposed hydration fell from 139.1 to 41.3 ms. These are local results. |
| Signing preparation reuse | Reused lane/material preparation and reconciled fresh prepare authority before creating the client share. [Read reductions](./optimization-12-NEAR-only-20261006.md), [two-request samples](./evidence/refactor-155g-early-sign-prepare-hosted.md) | Later ordinary message-signing samples used only prepare and finalize, with no session-status POST. September's eight status calls are historical. |
| Prepare during confirmation | Started prepare while the NEP-413 confirmation dialog is open. Extended this to ready transactions and delegates. [Message comparison](./evidence/refactor-155g-early-sign-prepare-hosted.md), [transaction/delegate evidence](./evidence/refactor-155g-early-delegate-transaction-hosted.md) | Message signing after confirmation fell from 694 to 358 ms in six wallets per arm. Immediate-confirm transactions still need separate measurement. |
| Combined proof and execution | NEAR-only passkey respond verifies the proof and executes Yao in one request. [Implementation](./evidence/refactor-155h-one-request-registration.md) | The normal registration sequence is setup, combined respond/execute, then finalize. Other factors and mixed registration retain their required flows. |
| Root-store and finalization reads | Batched bound-root admission/read operations and reused compatible finalization snapshots. [Root-store comparison][hosted-signing-history], [finalization record](./refactor-155H.md) | The October 7 comparison reduced four loads from twenty D1 trips to eight. Batching alone did not improve total setup. |
| Protocol execution | Overlapped garbling and evaluation with table-frame yields and enabled release WASM SIMD. [Hosted comparison](./evidence/refactor-155h-yield-simd-hosted.md) | Browser execute median fell by about 180 ms with both changes. Sequential arms and nine wallets per arm limit the claim. |
| Router and B coordination | Moved registration orchestration into its wallet object and combined B's preparation/execution claim. [Implementation](./evidence/registration-router-orchestration-20261016.md) | Local medians were effectively unchanged. The verified reduction in calls and writes does not establish hosted savings. |
| Registration commits and allocation | Reused committed admission, committed custody with its terminal receipt, and batched unused object addresses. [October 19 record](./evidence/near-registration-optimizations-20261019.md) | Local allocation median fell from 4.48 to 0.94 ms. Full registration lacked a matched control. |
| Completed pair reply | Stopped waiting for B's preparation reply after A returns the completed A/B result. [Diagnosis and fix](./evidence/near-registration-followup-20261019.md) | One hosted trace identified a 2,698 ms unnecessary wait. Local fault coverage proves its removal. Hosted savings for that fix remain unmeasured. |
| Console publication | Persisted pending publication before responding, then sent Console completion with durable retry. [Release 0.13.0 evidence](./evidence/release-0130-staging-20261017.md) | Finalize p95 fell from 1,381 to 858 ms in the dated comparison. Registration tail acceptance remained open. |
| Browser preparation | Preloaded activation modules and the existing NEAR signer during passkey registration. Optimized default development session-sealing builds. [Implementation](./evidence/refactor-155l-near.md), [hosted comparison][hosted-speed-report] | First signing improved by 15.1% in the controlled comparison. Production sealing WASM was already optimized. |
| PostgreSQL adapter in Workers | Enabled the existing adapter on WASM and used the Workers retry timer. Native lifecycle and local Worker transaction E2Es pass. [October 24 evidence](./evidence/postgres-role-worker-20261024.md) | Deployed Derivers still use D1. Hosted Hyperdrive correctness and latency remain unverified. |
| Temporary signing traces | Matched Gateway, Router, SigningWorker, and wallet-object requests. [Local verification](./evidence/near-signing-trace-propagation-20261024.md), [hosted capture][hosted-trace-report] | Four local lifecycle contracts passed. The hosted capture matched 44 requests through the object. All 14 original versions were restored. The added profiling code, scripts, and assertions were subsequently removed. |

The [original local baseline](./optimization-11-NEAR-local-baseline.md),
[custody profiling](./near-custody-profiling.md), and
[Optimization 10 appendix](./optimization-10-appendix.md) remain historical evidence.
Their timings and request shapes do not describe the current release.

## Current evidence and remaining budgets

### Current baseline, October 24

The [baseline report][current-baseline-report] and [generated evidence][current-baseline-json]
retain the current measurements, source/build hashes, verification, and failures.
These runs establish a baseline. They do not estimate an optimization gain.

| Environment and boundary, ms | Count | Median | p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Local NEAR-only full SDK registration | 20 | 553.6 | 606.9 | 742.5 |
| Hosted full SDK registration | 20 | 3,322.4 | 4,573.9 | 4,670.8 |
| Hosted registration after passkey completion | 20 | 1,815.5 | 2,591.4 | 2,781.4 |
| Hosted first NEP-413 signature, including confirmation | 20 | 745.3 | 1,469.4 | 1,626.6 |

The 553.6 ms local result cannot be compared with the historical approximately
1,600 ms hosted post-passkey result. Their environments and timing boundaries differ.
That comparison does not establish a hosted speedup.

All 40 local registrations and 80 transaction signatures passed.
The 20 hosted message workflows passed. Separate transaction testing produced two
successful seven-signature cases and one registration failure before signing.
The failed registration took 47.54 seconds, including a 30.74-second setup interval
and protocol failure spans near 15 seconds. Keep it in the failure ledger.

The slowest warm transaction took 4.324 seconds. Its prepare request included
a 2.255-second Gateway proxy span. Current message signing's finalize exchange
measured 372.0 ms at the median. Correlate downstream waits before reducing small
local completion work. The failure does not establish D1 as its cause.

Four NEAR lifecycle checks passed. The Email OTP case passed after the existing
test-token helper repaired its environment. Reviewed transactions, delegates, and
the separate idle case also passed. A later diagnostic case verified seven signatures
and matched all 14 recorded request IDs to Gateway and Router events.
The [trace follow-up][signing-trace-report] preserves those joins and their clock limits.
That hosted capture lacks the identifier inside SigningWorker.
The [temporary implementation](./evidence/near-signing-trace-propagation-20261024.md) closed the propagation gap and returned ten downstream timing fields during collection.
The later hosted capture below joins requests through the object.
Exact persistence and dispatch costs remain unresolved.

P0 remains open for warm-message distributions, dedicated step-up latency,
bounded NEAR concurrency, and broader factor/device/geographic coverage.

### Hosted diagnostic capture, October 24

The [capture report][hosted-trace-report] and [evidence JSON][hosted-trace-json] retain 21 verified transaction signatures across three wallets.
One separate message qualification also passed, with offline verification of its public proof.
All 44 prepare/finalize requests matched Gateway, Router, SigningWorker, and wallet-object events.
Two diagnostic Worker versions served during capture. All 14 original backend versions matched after restoration.
Gateway retained its original version and tenant admission path.

| Transaction SDK signing, ms | Count | Median | Maximum | Above 2 seconds |
| --- | ---: | ---: | ---: | ---: |
| First transaction, including account funding | 3 | 6,609.4 | 6,850.5 | 3 |
| Warm signing | 6 | 1,404.4 | 2,923.0 | 1 |
| First signing after unlock | 3 | 843.8 | 1,426.9 | 0 |
| Consecutive signing after a fresh unlock | 9 | 1,058.9 | 2,191.4 | 1 |

These SDK times include automated confirmation. Signing after unlock excludes the separate unlock call.
First transaction context measured 4,282.7–4,947.9 ms and included account funding.
Separate funding from an already funded first-signing cohort in the next comparison.
Four confirmation-to-signing intervals exceeded two seconds: three first transactions and one warm signature.
The warm signature measured 2,060.8 ms after confirmation.

The slowest prepare had a 739 ms Gateway proxy span and a 22 ms SigningWorker-to-object call.
Its Router and SigningWorker platform CPU readings were 143 and 169 ms.
The slowest finalize had a 662 ms proxy span and a 33 ms object call.
Its corresponding CPU readings were 103 and 173 ms.
The object invocations measured 8 and 12 ms wall time for those two requests.
These separate observations cannot be summed or subtracted into an exact causal breakdown.

Seven detailed Worker timing fields read zero throughout the capture, including schema initialization and object execution.
Those fields cannot establish absent work because Workers clocks omit synchronous CPU intervals.
Use function profiles to identify expensive work before changing initialization, dispatch, or storage.
The [provider profiling guide](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/) describes this clock limit.

This diagnostic run has no matched control without instrumentation and establishes no optimization gain.
Its three registration samples and successful journeys do not replace the baseline or resolve its failed registration.
The temporary hosted wrapper stopped serving after capture.
The initial cleanup removed seven fields that always reported zero in that capture.
The final cleanup removes the remaining task-added timers, trace plumbing, recorder fields, profiling assertions, and scripts.
Existing ECDSA telemetry, coarse Gateway timings, and functional tests remain.
The cleanup establishes no hosted latency gain.
After complete removal, all four lifecycle E2Es and all five release Worker builds passed.
Type checks, Cargo lock checks, and the full bloat check passed.
Cleanup removed 11,769 temporary or copied files, totaling approximately 469 MB.
Numeric evidence and public signature proofs remain.

### Native CPU profiling follow-up

Three further hosted workflows passed 21 transaction signatures on unchanged deployed versions.
All 42 signing requests matched Gateway and Router events.
The sequence used a control, a profiling run, and another control.
The first control recorded a 145 ms Router CPU spike without the new timing code or an active profiler.
Those additions are therefore unnecessary for the observed spike.

The Router profile contained only idle samples.
During its API call window, three matched requests recorded 127, 104, and 145 ms of CPU time.
SigningWorker profiles contained only idle and garbage-collection frames, without request or isolate labels.
These profiles cannot identify the expensive functions or establish garbage collection as the request delay.
The [follow-up record][hosted-trace-report] retains the failed attribution and its evidence.

The next measurement must identify the execution that the profiler samples.
Use existing platform tools with a known nonzero control before proposing another implementation change.
First-use transaction funding remains a separate priority.
Its existing optimistic execution and short polling backoff already apply, so do not add duplicate retry logic.

### Controlled browser comparison, October 21

The [hosted report][hosted-speed-report] contains 20 fresh-context registrations and
first NEP-413 signatures per arm. All 40 primary journeys passed. All 14 recorded
backend versions matched before and after the comparison. The arms ran in repeated
blocks. Runtime cold state remained unknown. These are staging results with automated
passkeys and confirmation. Medians average the middle pair. The p95 values use
the nearest-rank method and remain descriptive at this sample size.

| Measurement, ms | Baseline median | Candidate median | Baseline p95 | Candidate p95 | Candidate maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full SDK registration | 2,418.5 | 2,283.4 | 3,426.7 | 3,257.9 | 4,311.5 |
| Registration after passkey completion | 1,080.5 | 1,080.0 | 1,919.0 | 1,537.0 | 1,559.0 |
| First NEP-413 signing, including confirmation | 604.2 | 513.0 | 831.3 | 814.6 | 833.8 |
| Preparation before confirmation | 86.8 | 7.2 | 168.0 | 9.1 | 9.1 |
| Registration plus first signing, SDK calls | 3,101.2 | 2,868.6 | 4,035.2 | 3,742.5 | 4,980.3 |

First signing improved. Registration after passkey completion stayed unchanged at
the median. The combined median improved by 7.5%, but its descriptive confidence
interval includes no improvement. Its independence assumption may fail with sequential
blocks. Both arms had zero first-signing samples above two seconds.
This small message-signing cohort does not establish acceptance for
transactions, refresh/unlock, step-up, other factors, mobile devices, or production.

### Candidate stage costs

The October 24 review recalculated these values from the same 20 candidate samples
in the [saved JSON][hosted-speed-json]. They describe stage costs. Savings remain
unproven. Respond includes Yao execution. Network exchanges include server
work and transport, so their entire duration cannot be assigned to storage.

| Stage, ms | Median | Maximum |
| --- | ---: | ---: |
| Registration setup | 322.9 | 934.4 |
| Registration respond | 663.6 | 1,224.8 |
| Registration finalization | 266.3 | 823.0 |
| Local completion after finalization | 33.4 | 40.1 |
| Signing finalize exchange | 210.0 | 415.9 |
| Client signature share | 3.6 | 4.1 |

Local completion sums publication, hydration, activation, export capability, and
final readiness within each sample before aggregation. Other rows are individual
stages. Do not sum stage medians or nested spans into an end-to-end result.
The JSON stores these under `analysis.samples.candidate[].phases`.

### Storage and dispatch evidence

The October 22 [standalone D1 diagnosis][d1-diagnosis] recorded 888 ms on Deriver B's
database and 754 ms on A's database, each with less than 0.5 ms of SQL execution.
Independent client receipts and a fast simultaneous database control confirmed
selective waits. The probe used no Wallet WASM or wallet Durable Object binding.

The exact internal cause remains unknown. The fixed five-second phase prediction
failed its prospective test. The fresh-database comparison produced no measurements.
These probes reproduce a delay class outside Wallet. They do not explain every
registration outlier or prove that replacement fixes it.

Other traces retain unexplained gaps before object handlers and during reply
delivery. Follow the [debugging method](./debugging-method.md) and R155J.
Attribute only the boundaries that the instruments can observe.

## Prioritized implementation plan

The current work ends with cleanup and retained evidence. No implementation priority is active.
If performance work resumes, P0 is the prerequisite for every comparison.
P2 requires function-level attribution before selecting a change.
P1 is deferred at the user's request on October 24, 2026.
Retain its completed adapter work and evidence. Resume PostgreSQL integration or provisioning only after the user requests it.

| Priority | Deliverable | Decision gate |
| --- | --- | --- |
| P0 | Current-build baseline and correlated traces | Exact artifacts, complete cohorts, and independently verified signatures |
| Deferred (P1) | Bounded role-store comparison through PostgreSQL/Hyperdrive | User requests resumption, followed by lifecycle checks and a controlled comparison |
| P2 | One demonstrated reduction in signing dispatch or finalization | Function-level attribution, then lower complete signing latency beyond control variation |
| P3 | One attributed registration dispatch or completion reduction | A removable dependency with validated retry behavior |
| P4 | Faster immediate-confirm transaction signing | Less exposed context/preparation time with correct nonce ownership |
| P5 | Existing signer prewarm applied to another measured cold path | Fewer late loads and lower complete signing latency |

### P0. Establish the current baseline

- [x] Freeze source, release WASM, SDK assets, and served iframe/Gateway/role versions.
  Verify that the completed optimizations above exist in each measured arm.
- [x] Reuse the [local benchmark](../tests/e2e/intended-behaviours/near-latency/passkey.registration.benchmark.test.ts)
  and private `tests/e2e/hosted-product/near-signing-latency.test.ts`.
  Extend existing diagnostics rather than adding another benchmark framework.
- [ ] Measure passkey NEAR-only registration, first and warm message signing,
  immediate-confirm transactions, and signing after refresh/unlock.
  Record Email OTP, mixed registration, and exhausted-budget step-up separately.
  Capture the SDK unlock boundary separately from its current harness timer, which includes automation.
- [ ] Separate fresh browser state, existing wallets, first requests after idle,
  and bounded concurrent traffic. Identify runtime cold starts from runtime evidence.
- [ ] Correlate browser timelines, Gateway stages, role calls, D1 trips/statements,
  and object wall/CPU observations with existing operation identifiers.
  Mark unavailable observations as unknown.
  The retained diagnostic records contain operation IDs and Cloudflare request IDs.
  A seven-signature check matched all 14 requests to Gateway and Router events.
  A later diagnostic capture matched all 44 requests through the SigningWorker object.
  Function-level CPU attribution and exact persistence waits remain incomplete.

Save a baseline with failures, retries, signature proofs, and source/deployment hashes.
Start with 20 interleaved control/candidate pairs for a representative experiment.
Expand only after a signal warrants it. Small-cohort p95 remains descriptive.

### P1. Compare the role-store path through PostgreSQL

Status: deferred at the user's request on October 24, 2026.
Do not integrate PostgreSQL into Deriver runtime construction or provision PostgreSQL databases or Hyperdrive resources.
The remaining checklist applies if the user resumes this work.

Use the existing [storage adapter](./storage-portability.md#cloudflare-workers-with-hyperdrive)
and [private implementation plan][postgres-plan]. Native PostgreSQL lifecycle tests
pass locally and against RDS. The adapter now builds for Workers.
Its local workerd transaction E2E passes through Workers sockets and local Hyperdrive bindings.
See [the implementation and evidence](./evidence/postgres-role-worker-20261024.md).

- [x] Complete the existing role adapter's WASM connection and retry-timer support.
  Reuse `RoleSqlSessionV1` and its batch semantics.
- [ ] Construct the PostgreSQL store in the Deriver runtime and cover the full lifecycle through Workers.
  The local fixture currently verifies the transaction driver. Deployed Derivers still construct D1 stores.
- [ ] Give A and B separate databases, runtime credentials, and Hyperdrive configurations.
  Disable query caching and verify TLS to the origin.
  Hyperdrive does not invalidate cached reads after writes. [Provider documentation](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
- [ ] Run the existing lifecycle E2E through the actual connection path.
  Verify coherent reads, conditional row counts, rollback, serialization retries,
  cancellation, and exact replay after a lost commit acknowledgement.
- [ ] Compare value-changing writes, concurrent admissions, and requests after idle.
  Match observed placement, workload, and intended durability settings.
- [ ] Then compare complete registration and subsequent verified signing with the
  role stores changed. Keep all other services fixed and report their remaining D1 work.

Accept a latency claim only after repeated controls show improvement beyond variation.
Preserve the documented access and transaction guarantees. Gateway, SigningWorker,
and Console ports remain separate work. A role-store improvement does not establish
their performance or remove local Durable Object storage waits.
Production data import and cutover remain outside this experiment.

### P2. Reduce measured work in signing dispatch and finalization

Inspect the [Gateway route](../packages/wallet-server/src/router/transport/fetch/routes/thresholdEd25519.ts),
[admission path](../packages/wallet-server/src/router/domains/signingOperations/routerAbEd25519NormalSigningRoute.ts),
and [client exchange](../packages/wallet/src/core/signingEngine/flows/signNear/shared/ed25519YaoNormalSigning.ts).

- [x] Capture hosted requests through Gateway, Router, SigningWorker, and its wallet object.
  The diagnostic cohort matched all 44 requests and verified all 22 signatures.
  Preserve its separation from the baseline and future optimization comparisons.
- [ ] Profile CPU in the existing Router and SigningWorker entry paths.
  Compare ordinary requests with the captured high-CPU cases and record runtime identity where available.
  The native API attempt did not capture the known Router activity and cannot establish a cause.
  Require a nonzero control and sampled-execution attribution through existing platform tools.
  Attribute initialization, parsing, allocation, authorization, dispatch, and response assembly before selecting a change.
  A local reproduction must exhibit the hosted signal before it supports a hosted cause.
- [ ] Isolate remaining operation/material lookup, persistence, and completion waits where they explain a slow request.
  Current transaction-object wall time spans 7–31 ms, and Gateway completion spans 9–22 ms.
  The zero-only object timing fields provide no CPU or storage breakdown.
  Worker timestamps and wall durations do not form an additive timeline.
  Object execution includes signing and storage. Its duration does not isolate SQL or commit acknowledgement.
- [ ] Identify repeated immutable facts or compatible reads within one consistent
  snapshot. Check existing snapshot reuse before adding any helper or cache.
- [ ] Remove one demonstrated repeated cost in the existing path.
  For storage, batch only compatible work within its existing transaction.
  Preserve fresh checks after asynchronous work.
- [ ] Compare complete SDK signing and its finalize span for first, warm, and
  step-up cohorts. Retain the change only with evidence or an independent correctness need.
- [x] Remove all profiling additions from this investigation at the user's request.
  Remove the task-added timers, trace parameters, header plumbing, recorder fields, and profiling-only assertions.
  Remove capture, analysis, and inspector scripts, compiled copies, and copied profiling bundles.
  Preserve pre-existing telemetry and functional behavior tests.
  Keep findings and numeric evidence, without executable profiling artifacts.

Keep prepare → client share → finalize. Prepare supplies the commitments needed
for the share. Preserve revocation, exact method/environment binding, quota,
one-use nonces, and durable replay. Operation completion must precede success.

### P3. Remove one demonstrated registration dependency

Use [registration persistence](../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationService.ts)
and [Router ceremony execution](../crates/router-ab-cloudflare/src/router_coordinator/ceremony_execution.rs).
The completed-pair reply fix and combined Router/B claims are already implemented.

- [ ] Capture slow and typical requests from the current build.
  Separate dispatch, handler entry, initialization, D1, local storage, and reply delivery.
- [ ] Compare the same wallet objects before and after idle.
  Record constructor occurrence, object identity, ownership generation, and actual locations.
- [ ] Remove a dependency only when its result is already validated or independent
  work can safely overlap. Preserve durable claims and completion checkpoints.
- [ ] Verify both arrival orders, cancellation, conflicting attempts, lost replies,
  restart replay, and ownership replacement with existing real-Worker E2Es.

An opaque provider wait can remain unresolved. Do not label the entire caller/handler
gap as network latency or cold start. Longer timeouts and extra retries do not prove
a latency fix. Router removal remains conditional on measured forwarding cost.
Service bindings normally execute on the same server and thread. [Provider documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)

### P4. Improve transactions when confirmation is immediate

Completed October 24: [`fetchRelayerTxContext`](../packages/wallet-server/src/core/nearRelayerAccountProvisioning.ts)
fetches the relayer access key and final block concurrently.
Both reads must succeed before signing or broadcasting.
This removes one sequential RPC wait from implicit-account funding and sponsored account creation.
The client nonce coordinator already fetches its access key and block concurrently.

The controlled comparison used real HTTP and signer WASM with a local RPC stub.
Each path ran 20 interleaved control/candidate pairs against the sequential source at `4f7fc083`.
Arm order alternated. One warm-up per arm/path was excluded before measurement.
Read delays alternated between 80/120 ms and 120/80 ms, with a 20 ms broadcast response.

| Complete provisioning call, ms | Sequential median | Concurrent median | Median paired saving |
| --- | --- | --- | --- |
| Implicit-account funding | 231.0 | 147.5 | 83.4 |
| Sponsored preparation and broadcast | 229.8 | 146.7 | 83.6 |

These boundaries include signing and the simulated broadcast response. They exclude the D1 sponsorship ownership claim and real chain execution.
All 80 measured signatures passed independent Ed25519 verification. Signed bytes matched between arms for each path.
Both read completion orders preserved the nonce, receiver, block hash, and requested finality.
Failures of either read prevented broadcast in both provisioning paths.
The existing D1 sponsorship E2E passed uncertain-broadcast recovery, cross-wallet rejection, and exact replay without rebroadcast.
These controlled savings do not establish hosted registration or full wallet-signing gains.

The live testnet RPC comparison ran 20 interleaved pairs with one excluded warm-up per arm.
Among 18 successful pairs, medians were 6,579.2 ms sequential and 6,576.5 ms concurrent.
The median paired saving was 1.6 ms. Nine pairs favored concurrency.
Four calls failed with HTTP 429, two per arm. All failures remain in the evidence.
This live comparison establishes no consistent improvement and includes no chain writes or hosted Wallet calls.

Retain the small concurrency change for its controlled reduction in exposed RPC wait.
The server type-check, server build, and bloat check passed.
All temporary measurement drivers and compiled bundles were removed. No production profiling code or additional tests remain.
[Evidence](./evidence/near-relayer-rpc-concurrency-20261024.json) retains summaries, public signature proofs, source hashes, and hashes of the raw local artifacts.

The [existing transaction benchmark](./evidence/refactor-155g-early-delegate-transaction-hosted.md)
waited for context and early prepare before confirming. Its automated confirmation
took 1.1–2.1 seconds. It does not establish immediate-confirm latency.

- [ ] Add an immediate-confirm cohort beside a fixed review-interval cohort in
  the existing hosted E2E. Include funded transactions and supported delegates.
  Separate first-use account funding from the first signing of an already funded account.
- [ ] Attribute chain RPC, durable nonce-lease recovery, material readiness, and
  prepare work that remains after confirmation.
- [ ] If context acquisition dominates, start independent work earlier through
  the existing [transaction flow](../packages/wallet/src/core/signingEngine/flows/signNear/signTransactions.ts)
  and nonce coordinator. Do not introduce another nonce manager or stale context cache.
- [ ] Verify concurrent signing, cancellation, refresh, and budget step-up.
  Confirm exact nonce ownership and independently verify signed transaction bytes.

Include RPC needed to construct a valid transaction in signing latency.
Report funding, broadcast, and chain finality separately.

### P5. Extend existing preloading where a cold-load cost remains

The [signer prewarm](../packages/wallet/src/SeamsWeb/operations/registration/registrationEd25519Yao.ts)
currently applies to passkey registration.

- [ ] Measure late signer script/WASM loads after Email OTP registration and refresh/unlock.
  Measure actual transfers and initialization. Browser request events alone are insufficient.
- [ ] If a delay remains, invoke the existing initializer at the earliest valid
  preparation point. Retain one shared instance and ordinary retry after failed warmup.
- [ ] Verify worker reset, lock, authority replacement, and failed warmup followed
  by successful signing. Keep secret ownership unchanged.

Use the existing hosted-menu challenge preparation where applicable.
`authMenu.prepare()` downloads code. Opening registration prepares the challenge.
Direct `registerWallet()` callers still include setup within their call.
Evaluate direct-caller preparation only if the measured setup wait justifies it.

## Deferred and rejected approaches

| Approach | Disposition |
| --- | --- |
| More client completion concurrency | Defer. The current measured local completion budget is about 33 ms. Lifecycle complexity needs a demonstrated benefit. |
| Remove the Router Worker | Defer. Required validation and downstream work obscure the removable contribution. Count reduction alone is insufficient. |
| More SQLite statement consolidation | Defer unless it removes a measured remote trip or durable transition. Statements inside one transaction may have little exposed cost. |
| More OT arithmetic work | Low priority. The isolated probe saved about 4.5 ms in local WASM. Protocol equivalence and constant-time verification remain prerequisites. [Probe](./evidence/registration-optimization-avenues-20261015.md#oblivious-transfer-arithmetic-probe) |
| Owner-storage startup and early peer acknowledgement | Reverted in `a0b4c9df` and `e1d52bf8`. No demonstrated latency gain justified retaining them. |
| Equal worker asset URLs | Discarded. Matching URLs still produced two server transfers. [Investigation](./evidence/refactor-155l-near.md#decisions-from-the-investigation) |
| Smaller release modules or faster development sealing as a hosted gain | Unsupported. Smaller Deriver modules showed no startup gain. Production sealing was already optimized. [Release comparison](./evidence/refactor-155g-final-staging.md) |
| Permanent keepalive pools or speculative authority caches | Excluded without new evidence and a valid lifecycle design. Existing observations do not replace mutable authority. |
| Yao execution before verified passkey proof | Rejected by the owner. Preserve preparation during the prompt and execution after proof verification. |
| Reply before required operation completion | Excluded. Canonical responses require durable completion and replay. Console publication uses its separate durable pending record. |

## Measurement and acceptance contract

Record a monotonic client timeline from SDK entry through usable readiness or the
assembled, verified signature. Include preparation and queueing before confirmation.
Report full elapsed time and system-controlled elapsed time. Exclude only measured
human-wait intervals using their interval union. Automated interaction subtraction
is a diagnostic and does not measure human wait or pure compute.

Retain `confirmed_to_signed` and `signature_total` as diagnostic subspans.
Correlate prepare and finalize with the same operation. Calculate totals and
differences per sample before percentiles. Separate SQL statements from remote trips.
Worker clock spans can omit synchronous CPU time. Use platform wall/CPU observations
and independent client elapsed time where available.

Keep normal CORS and browser caching behavior during timing runs. Use request
interception only for explicit correctness faults. Predeclare warm-up handling and
retain failures, incomplete attempts, and retries. Record actual placement, concurrency,
RPC mode, p50/p95/max, and signing counts above two seconds. Report p99 only with
an adequate population and its limits. Do not pool different factors or authorization paths.

Reuse artifacts under `.artifacts/optimization-11-near/` and linked experiment directories.
Retain commands, per-operation timings, proof verification, failures, source/assets,
deployment fingerprints, runtime identities, and a repeatable analysis command.
Keep publishable summaries sanitized. Never log credentials, factor secrets,
signing material, recovery codes, or request bodies.

Use focused intended-behavior E2Es. Add no unit tests or source-text guards.
Extend existing coverage only for a genuine behavior gap. Required affected scenarios:

- Registration loses a committed reply, resumes through exact-method unlock,
  signs, refreshes, and signs again with unchanged key identity.
- Lock or authority replacement races hydration/finalization. Late work cannot
  publish stale readiness. The journal remains repairable by unlock.
- Mixed registration signs EVM while NEAR waits, then completes NEAR with the
  same session identity, expiry, and remaining quota, including zero quota.
- Signing covers exhaustion, step-up, expiry, revocation, concurrency, and lost
  finalize replies. Verify nonce ownership, one-time consumption, and replay after restart.
- Storage changes cover rollback, concurrent admission, cancellation, and uncertain
  commits through the actual adapter. Preserve isolation between Deriver stores.

For shared changes, run affected contracts on VM, wallet-DO, and Workers D1 adapters,
plus any candidate adapter. Add type fixtures when shared lifecycle types change.
Classify failures against current domain behavior before changing code or fixtures.
Cryptographic changes additionally require the relevant vectors, wire contracts,
constant-time review, and formal verification.

Completion requires:

- [ ] Repeatable improvement beyond control variation, with failures and tails retained.
- [ ] Registration gains preserve mixed ECDSA readiness and durable NEAR readiness.
- [ ] Assess signing targets separately for first, warm, refresh/unlock, and
  step-up paths. Attribute remaining breaches or record explicit unknowns.
- [ ] Affected correctness contracts and necessary type/build checks pass.
  Remove replaced paths and temporary instrumentation.
- [ ] `pnpm report:bloat --check` passes before implementation commits on wallet `dev`.
- [ ] Record exact release/consumer versions and hosted acceptance needs.
  Production rollout remains a separate decision.

[hosted-signing-history]: https://github.com/seams-tech/seams-monorepo/blob/dev/docs/r155b-near-hosted-benchmarks-20261007.md
[hosted-speed-report]: https://github.com/seams-tech/seams-monorepo/blob/dev/docs/evidence/near-hosted-speed-20261021.md
[hosted-speed-json]: https://github.com/seams-tech/seams-monorepo/blob/dev/docs/evidence/near-hosted-speed-20261021.json
[d1-diagnosis]: https://github.com/seams-tech/seams-monorepo/blob/dev/docs/evidence/d1-write-path-diagnosis-20261022.json
[postgres-plan]: https://github.com/seams-tech/seams-monorepo/blob/dev/docs/future-plan-wallet-postgresql-preparation.md#potential-latency-upgrade-postgresql-through-hyperdrive
[current-baseline-report]: https://github.com/seams-tech/seams-monorepo/blob/dev/docs/evidence/near-current-baseline-20261024.md
[current-baseline-json]: https://github.com/seams-tech/seams-monorepo/blob/dev/docs/evidence/near-current-baseline-20261024.json
[signing-trace-report]: https://github.com/seams-tech/seams-monorepo/blob/dev/docs/evidence/near-current-baseline-20261024.md#gateway-to-router-trace-follow-up
[hosted-trace-report]: https://github.com/seams-tech/seams-monorepo/blob/dev/docs/evidence/near-hosted-trace-20261024.md
[hosted-trace-json]: https://github.com/seams-tech/seams-monorepo/blob/dev/docs/evidence/near-hosted-trace-20261024.json

# Optimization 10 appendix: measured progress

Date: September 24, 2026

This appendix consolidates the implementation, release, and performance evidence
collected during Optimization 10. The main plan remains
[optimization-10.md](./optimization-10.md). This file emphasizes measured changes,
the boundary each number covers, and the work that remains.

## Result summary

The largest observed gains came from separating ECDSA-ready registration from
NEAR provisioning, correcting release artifacts, moving frequently called services
closer to their storage, and keeping generated ECDSA material available outside
the transaction-signing wait.

### Hosted production-testnet results

| Measurement | Earlier observation | Later observation | Observed change |
| --- | ---: | ---: | ---: |
| ECDSA-ready mixed-registration return | 5.347 s average across four 0.6.0 samples | 3.091 s average across five post-0.6.2 samples | 2.256 s faster, about **42%** |
| Durable NEAR readiness | 8.978 s average across four 0.6.0 samples | 4.682 s average across five post-0.6.2 samples | 4.296 s faster, about **48%** |
| Cached ECDSA commit after SigningWorker placement | 3.610 s median across five baseline samples | 2.580 s median across three Osaka samples | 1.030 s faster, about **29%** |
| SigningWorker prepare span | 799 ms median | 137 ms median | about **83%** lower |
| SigningWorker finalize span | 1,188 ms median | 201 ms median | about **83%** lower |
| ECDSA presign network ceremony | 8.761 s median on 0.5.30 | 4.069 s median on 0.5.32 | about **54%** lower |
| Presign CORS preflight duration | 3.518 s total | 0.332 s total | about **91%** lower |

The registration comparison uses small diagnostic cohorts in the same hosted
product path. It establishes a substantial observed improvement and does not
establish population p50 or p95. The ECDSA placement and presign comparisons also
use small cohorts. The presign comparison spans multiple releases and includes
both the CORS cache and six-exchange protocol scheduling changes, so it is a
combined release observation rather than an isolated causal estimate.

### Controlled local results

| Measurement | Control | Optimized | Observed change |
| --- | ---: | ---: | ---: |
| Registration return after independent NEAR provisioning | 848.5 ms median | 601.0 ms median | about **29%** faster |
| Durable NEAR readiness in the same comparison | 1,059.3 ms median | 1,007.0 ms median | about **5%** faster |
| Passkey client-seal preparation overlap | 1,398.6 ms median | 1,351.6 ms median | 47.0 ms, about **3.4%** faster |
| Preparing the client seal during custody | 997.9 ms median | 978.6 ms median | 19.3 ms, about **1.9%** faster |
| SigningWorker package delivery with the correct release artifact | 373 ms | 7 ms | about **98%** lower |
| Router Yao execution with the correct release artifact | 673 ms | 316 ms | about **53%** lower |
| Browser custody join with the correct release artifact | 708.8 ms | 364.6 ms | about **49%** lower |
| Combined terminal-batch reservation path | 1,971.3 ms median | 1,933.8 ms median | 37.6 ms, about **1.9%** faster |

These experiments use different revisions, controls, and timing boundaries. Their
savings must not be added together. Local registration benchmarks use automated
authentication and stubbed public-chain edges. The release-artifact comparison
held the other role artifacts fixed and changed the SigningWorker build profile.

## Registration and NEAR readiness

### Independent NEAR provisioning

Mixed registration previously waited for NEAR custody work before returning the
ECDSA wallet. The new flow commits ECDSA activation and the planned NEAR
continuation durably, publishes the usable ECDSA wallet, and lets NEAR admission,
Yao execution, finalization, and local installation continue independently.

The continuation supports planned, prepared, joined, finalized, and installed
states. It preserves exact request identity, Wallet Session identity, quota,
expiry, revocation epoch, material generation, and replay outcomes. Reload,
worker restart, lost responses, lock, failed persistence, exhausted signing quota,
and both passkey and Email OTP flows have focused coverage.

In the controlled 20-pair comparison, registration return improved by 247.5 ms,
or 29%. Full NEAR readiness also improved by 52.3 ms, or 5%, because the two
branches overlap. The result validates the architectural split: ECDSA becomes
available earlier while NEAR remains durable and recoverable.

References:

- [Independent NEAR registration plan](./plan-independent-near-registration.md)
- [Independent registration latency report](./independent-near-registration-latency.md)
- [Intended lifecycle behavior](./intended-behaviours.md)

### Earlier passkey session preparation

Passkey client-seal preparation originally occurred after NEAR custody and left
serial work near the readiness boundary. Preparation now begins as soon as the
retained journal provides the exact NEAR session identity. The prepared client
ciphertext is reused through finalization, hydration, and signer installation.

One controlled benchmark measured a 47.0 ms median readiness reduction. Moving
preparation into the custody interval removed the remaining preparation wait and
measured another 19.3 ms median reduction in its controlled comparison. These are
small improvements relative to network and backend work, while retaining exact
session ownership, single-use consumption, expiry, and lock cleanup.

References:

- [Passkey client-seal preparation](./passkey-client-seal-preparation.md)
- [NEAR custody profiling](./near-custody-profiling.md)

### Development artifacts overwrote release outputs

The private-D1 development test built development WASM into the paths later used
by release benchmarks. A skip-build run could therefore consume a development
SigningWorker while appearing to exercise a release runtime. Development builds
now write under `build/dev/<role>`, release builds retain `build/<role>`, and the
package release workflow explicitly rebuilds production WASM.

Holding the rest of the local runtime fixed, release SigningWorker delivery fell
from 373 ms to 7 ms. Router Yao execution fell from 673 ms to 316 ms, and browser
custody join fell from 708.8 ms to 364.6 ms. The SigningWorker WASM also shrank
from about 27.0 MB to 6.8 MB. The protocol and cryptographic checks were unchanged.

References:

- [Registration deployment build audit](./registration-deployment-build-audit.md)
- [NEAR custody profiling](./near-custody-profiling.md)
- [Shamir release profile](./shamir-release-profile.md)
- [Server-seal release profile](./server-seal-release-profile.md)

### Hosted registration outcome

The initial four-sample 0.6.0 hosted diagnostic averaged 5.347 seconds to
ECDSA-ready return and 8.978 seconds to durable NEAR readiness. Five matched-flow
post-0.6.2 samples averaged 3.091 seconds and 4.682 seconds respectively. The
observed average savings were 2.256 seconds for registration return and 4.296
seconds for full readiness.

The implementation contributing to this result includes independent NEAR
provisioning, earlier seal preparation, finalization overlap, production artifact
construction, removal of duplicate NEAR admission, and the surrounding release
and deployment corrections. The cohort does not isolate each change's hosted
contribution.

Reference: [deployed 0.6.0 registration baseline](./deployed-registration-baseline.md).

## ECDSA signing

### Placement reduced cached prepare and finalize latency

The Gateway D1 primary was in Singapore and the SigningWorker private primary was
in Osaka. Placing the production-testnet SigningWorker near its private primary
reduced cached client commit times from a 3.610-second baseline median to a
2.580-second post-placement median. SigningWorker tail medians fell from 799 ms
to 137 ms for prepare and from 1,188 ms to 201 ms for finalize.

This confirmed that placement around the authoritative store can materially
reduce the online path. It also showed that Worker placement alone does not
resolve empty-pool generation or prove the location of the per-session Durable
Object.

### Durable five-entry pools removed generation from cached signing

ECDSA presignatures now have a coordinated 90-day retention policy and a durable
five-entry target. A live, unrevoked, correctly scoped Wallet Session can refill
the pool even after transaction-signing uses reach zero. Transaction signing
still enforces its quota and exact-operation authorization independently.

Hosted checks verified that encrypted entries survive reload, retain their
identities, are consumed once, and refill after consumption. A 24-signature
hosted Tempo cohort completed in 1.245–1.995 seconds with a 1.639-second median.
A post-reload cached signature completed in 1.365 seconds without foreground
generation. Later 0.5.32 cached signatures generally completed in 1.394–2.217
seconds, including fresh exact-operation step-up after the reusable allowance was
spent.

These results meet the 1–3-second target for the tested cached cohorts. They do
not establish production p95 or empty-pool acceptance.

Reference: [session-authorized refill design and checkpoint](./refactor-129-presignatures-refill.md).

### Fewer presign exchanges and cached preflight

Owner presigning originally used eight dependent HTTP exchanges. The optimized
schedule carries the first protocol message with initialization and the final
server message with completion, reducing the schedule to six authenticated
exchanges. Every exchange retains live authorization, immutable ceremony scope,
expiry, ordering, cancellation, and replay checks.

The hosted comparison recorded:

| Metric | 0.5.30 | 0.5.32 |
| --- | ---: | ---: |
| Successful fill POSTs for five ceremonies | 40 | 30 |
| OPTIONS requests | 13 | 2 |
| Total OPTIONS duration | 3.518 s | 0.332 s |
| Median network ceremony | 8.761 s | 4.069 s |
| Registration ready | 13.476 s | 8.456 s |
| First persisted entry after registration ready | 10.720 s | 3.812 s |

The CORS change advertises a 600-second preflight cache lifetime for allowed
origins. Actual requests continue to receive fresh authorization. The exchange
change and CORS change together cut network ceremony time by about 54% in this
small release comparison.

### Recovery, completion, and terminal-batch work

Several smaller changes removed recurring work and bounded tail failures:

- Foreground priority now covers cache lookup, replacement generation, and
  signing. Background maintenance cannot retake priority between those stages.
- Each presign exchange has a five-second response/body budget capped by ceremony
  expiry. Failed ceremonies restart with a fresh identity.
- Successful authorized-operation completion uses `UPDATE ... RETURNING` directly
  and avoids a separate read-back. Duplicate completion retains the durable
  first-result path.
- Successful signing-prepare responses are forwarded without cloning and fully
  buffering the response body at the Gateway.
- Fresh available and directly reserved material uses insert-first D1 admission,
  with collision reads preserving canonical idempotency and substitution checks.
- The final presign batch can carry the already complete, authorized signing
  request. The SigningWorker verifies the public candidate identity and scope,
  then publishes the result directly as Reserved.

The terminal-batch path reduced a five-sample local median from 1,971.3 ms to
1,933.8 ms. This modest 1.9% improvement is useful primarily because it removes
one online handoff while preserving one-use and replay invariants.

### Persistent transport was not justified

A local workerd comparison modeled the internal Gateway, Router, SigningWorker,
Durable Object, and fresh D1 admission path. HTTP and direct service-binding RPC
medians differed by roughly 2–3 ms for 4 KiB and 32 KiB bodies. A separate
browser-only HTTP/WebSocket experiment also showed only single-digit-millisecond
differences under its modeled delay.

The evidence did not justify a persistent transport rewrite. The production HTTP
path remains, avoiding a second transport lifecycle and its ordering, restart,
revocation, cancellation, and replay complexity.

## NEAR signing after Wallet 0.6.2

Wallet 0.6.2 removed redundant work from the online NEAR signing path and added
timing boundaries around the FROST prepare, client share, and finalize stages.

Three hosted signatures measured core signature totals of 1.379, 1.415, and
2.046 seconds, averaging 1.613 seconds. Their complete confirmed-to-signed times
were 5.237, 5.789, and 6.792 seconds, averaging 5.939 seconds. The average gap
outside the FROST core was therefore about 4.326 seconds.

A later fresh-wallet sample measured 1.234 seconds for the core and 8.710 seconds
from confirmation completion to the signed result. A retained-authenticator
sample measured a 2.683-second core and 6.801-second confirmed-to-signed result.
These samples show that FROST is no longer sufficient to explain the visible
delay.

The development trace now separates:

- durable nonce-lease recovery;
- signing-material resolution;
- transaction-context resolution;
- Wallet Session authorization;
- nonce-lease commit; and
- signed-result assembly.

That trace is committed on `dev` and still needs a release and hosted cohort.
The next optimization should target the largest observed post-confirmation stage.

## Correctness retained through the performance work

The optimizations retain the following boundaries:

- ECDSA-ready mixed registration remains independent of slow NEAR readiness.
- NEAR becomes ready only after durable finalization and successful local signer
  installation.
- Lost responses, reload, worker restart, and local persistence failure retain
  resumable or terminal states rather than silently repeating key creation.
- Presignatures and Ed25519 nonce material remain one-use.
- Exact Wallet Session, authority, material, scope, expiry, quota, and operation
  checks remain active at their existing boundaries.
- Role separation and the split custody model remain unchanged.
- Timing diagnostics exclude credentials, protocol secrets, shares, and raw
  signing material.

Verification across the work included intended registration, unlock, reload,
recovery, export, sustained Tempo/Arc, exact-operation step-up, concurrent pool,
replay, expiry, cancellation, lock, and real-workerd/private-D1 checks. Individual
release sections in [optimization-10.md](./optimization-10.md) record the exact
test counts and environment limitations.

## Release progression

| Release | Main performance contribution |
| --- | --- |
| 0.5.24–0.5.26 | Initial production attribution, signing placement, authorization-read reduction, and foreground priority |
| 0.5.27–0.5.30 | Session-authorized five-entry pools, 90-day retention, durable reload restoration, per-entry refill deadlines, and earlier registration refill |
| 0.5.31–0.5.32 | Cached CORS preflight and six-exchange owner presigning |
| 0.5.33–0.5.34 | One-snapshot operation authorization, stalled-exchange bounds, and foreground recovery fixes |
| 0.6.0 | Independent NEAR registration, passkey preparation overlap, release-artifact isolation, production WASM release build, and authenticated terminal-batch reservation |
| 0.6.1 | NEAR finalization overlap, registration timing exposure, and hosted ECDSA registration prewarm |
| 0.6.2 | Duplicate NEAR admission removal and shorter online NEAR signing path |

## Remaining work

- [ ] Release and deploy the granular NEAR post-confirmation trace.
- [ ] Capture first and warm NEAR signing in one retained-authenticator session.
- [ ] Optimize the largest measured stage outside the FROST core and repeat the
  same cohort.
- [ ] Exercise valid-session reuse, refill after the final signing use, explicit
  expired-session rejection, and supported reauthentication recovery.
- [ ] Collect useful hosted sample sizes for registration, first-sign, cached,
  empty-pool, reload, refill, recovery, and cold-runtime cohorts.
- [ ] Complete hosted ArcEVM acceptance and representative geographic p50/p95.
- [ ] Measure the actual presign-session Durable Object location before another
  placement change.
- [ ] Consider an Ed25519 nonce-commitment pool or further Yao changes only when
  new attribution shows that the protocol stage dominates the remaining latency.
- [ ] Keep the revised R150 conversion behind its separate latency, cost,
  concurrency, restart, isolation, one-use, and existing-wallet migration gates.

## Evidence limits

The figures in this appendix mix controlled local comparisons and small hosted
diagnostic cohorts. They establish engineering progress and locate remaining
work. They do not establish an SLA, population p95, mainnet behavior, or a
guaranteed improvement for every geography and device.

Percentages are calculated from the displayed cohort summaries. Nested spans are
not added together. Cross-release comparisons can include more than one change.
Future acceptance should publish sample counts, failures, release and Worker
versions, client geography, authentication mode, cache state, and percentile
method with every result.

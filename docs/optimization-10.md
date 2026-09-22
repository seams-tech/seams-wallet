# Optimization 10: registration readiness and MPC signing latency

Status: 0.5.25 released and measured on production testnet. Cached Tempo signing
meets the target in four diagnostic samples; immediate and sustained signing
still exceed it. Production p95 and Arc acceptance remain unverified.

Execution constraint: keep mixed registration's ECDSA-ready success asynchronous
while NEAR provisioning is slow. Reduce and measure the underlying NEAR work
before considering any change to completion semantics. Extending the registration
spinner is not an acceptable optimization.

## Goal

Reduce the delay between registration success and NEAR becoming usable,
and bring production ECDSA threshold signing for Tempo and ArcEVM into the
requested 1–3-second range, including subsequent transactions and cold starts.

The registration acceptance criterion is:

> Registration reports success as soon as ECDSA is ready. Slow NEAR activation
> continues asynchronously, and NEAR becomes usable as quickly as possible.

Measure ECDSA-ready registration success and NEAR readiness separately. The
long-term goal is immediate NEAR signing after registration, achieved by reducing
the underlying work. Preserve the existing pending/ready/failed NEAR state and
durable retry behavior while that work remains slow.

## Implementation findings

The first implementation pass identified three causes of unnecessary work or
contention and one failure exposed by sustained signing:

1. Synchronous pool misses used `background_presign_pool_refill`, so server
   admission treated user-blocking generation as background traffic. Foreground
   misses and retries now use `foreground_presign_pool_refill`.
2. Background refill could continue toward its target depth while foreground
   signing was reserving restored material. It now publishes available material
   and yields to active signing; the existing post-sign scheduler replenishes
   reusable sessions afterward.
3. The first derivation-to-presign worker connection invalidated the active pool
   generation. The first completed presignature was discarded, and first signing
   ran the entire generation exchange twice. Initial connection now preserves
   that generation. Authority replacement and worker resets retain invalidation.
4. After the reusable allowance and presignature cache were exhausted, step-up
   refill failed with HTTP 403. Preparation requested a new five-minute expiry
   beyond the existing wallet session expiry. Preparation now reads that exact
   session and bounds expiry before generating the authentication challenge.
   Server expiry checks, exact-operation authorization, and quota limits remain
   enforced.

The instrumented local run before fix 3 showed two foreground generations of
approximately 262 ms and 209 ms, followed by a 49–59 ms prepare/finalize exchange.
Subsequent local cache-hit signatures took approximately 46–48 ms within the
signer. These are individual local samples using stub chain RPCs, not production
percentiles. They establish the duplicate work and provide a comparison point;
they do not explain the complete production 13–15-second delay.

After fix 3, two local first-sign samples used one foreground generation and
took approximately 333 ms inside the signer (352–354 ms for commit through
transaction assembly). Local NEAR timing samples showed 342–360 ms for custody
join and 215–218 ms for the subsequent provisioning task, including 159–165 ms
for session installation. The join is already underway before the provisioning
task starts; these spans have different start points and should not be added
to registration duration without the event timeline.

Timing instrumentation now records:

- Commit queueing, material authorization/loading, pool lookup/restoration,
  refill waiting and generation rounds, reservation/commit, prepare/finalize,
  client share, verification, and transaction assembly.
- Presignature selection, authorization branch, refill scheduling/outcome, and
  foreground/background traffic class.
- Gateway authorization, admission, upstream proxy, and completion in
  `Server-Timing`, correlated with the client operation when diagnostics are on.
- Background NEAR custody join, server finalization, publication, session
  installation, activation, and durable readiness.

Use the existing `seams:debug:signing-session` local-storage flag for client
signing traces and `__SEAMS_REGISTRATION_BENCHMARK_DIAGNOSTICS` for registration
timings in the wallet iframe. Enable them before the operation. Timing records
contain stage/state metadata and identifiers, without secret material or
credentials. The gateway timings include downstream role/network/storage work
inside the proxy span; per-role production attribution is still required.

Registration completion behavior remains unchanged. No readiness gate was added.
The registration contract continues to sign Tempo immediately, then await NEAR
readiness before signing NEAR. The sustained ECDSA contract additionally exercises
ten Tempo and ten Arc signatures, verifies distinct consumed presignatures, and
checks that initial connection does not duplicate foreground generation. It
covers the three-use reusable session followed by exact-operation step-up;
a production reusable-session cohort beyond that budget is still needed.

Release `0.5.24` now includes these SDK and wallet-server changes. Hosted package
pins and frontend assets were updated, and the production-testnet backend smoke
checks passed. Production attribution and the 1–3-second acceptance measurements
remain open. Capture fresh deployed Worker version IDs with each signing trace;
the pre-release version IDs are no longer the comparison baseline.

The mainnet rollout exposed a separate deployment dependency: the Gateway's
tenant-binding lookup returned HTTP 404 from an older Console worker, which
caused public HTTP 500 responses. Deploying the current Console revision fixed
that mismatch. Mainnet now explicitly returns HTTP 503 with
`tenant_deployment_unavailable`: its Console has no active binding and its
production project environment is disabled. Infrastructure smoke accepts that
bootstrap state; it does not establish wallet availability. Enabling and
provisioning the intended production environment remains a separate prerequisite
for mainnet signing measurements.

Historical Cloudflare telemetry access returned HTTP 403 with the current login.
Live tails work and were sufficient to identify the mainnet exception. Use live
tails alongside client signing timings until historical telemetry access is
available.

The corrected sustained local run completed all 20 signatures with 20 unique
presignature IDs. It exercised 17 foreground generations and three background
generations. Commit-to-assembled-transaction durations were 62–356 ms for Tempo
and 63–287 ms for Arc. With only ten samples per chain, these ranges are useful
regression evidence and do not establish a production p95. Most later signatures
used exact-operation step-up and generated fresh material after the reusable
session budget was spent; production traces must identify this authorization
branch when diagnosing repeated slow signatures.

Verification completed on 2026-09-19:

- Wallet SDK build and type-check; wallet-server build and type-check; intended
  test and wallet-state type fixtures.
- Fifteen focused browser/unit checks covering pool coordination, foreground
  priority, refill progress, durable reservation, expiry, logout cleanup, and
  worker prewarming.
- Passkey registration → immediate Tempo signing → asynchronous NEAR readiness
  → NEAR signing.
- Twenty sustained Tempo/Arc signatures with unique presignature consumption,
  one initial foreground generation, and successful empty-pool step-up refill.
- Email OTP registration, unlock, refresh, exports, concurrent Tempo/Arc signing,
  and subsequent step-up signing.

The Email OTP run first stopped at an expired Google test token. The existing
`ensure:intended-google-token` tool refreshed it, and the lifecycle then passed.
Local Worker startup retries used Node 24 with `WRANGLER_SEND_METRICS=false`;
startup time is excluded from the per-signature timings above.

Remaining acceptance work:

1. Complete mainnet tenant activation for the intended production environment.
   The coordinated SDK/server/frontend release is now `0.5.24`; production-testnet
   is available for signing measurements independently of mainnet activation.
2. Extend the production Tempo measurements below to Arc and the remaining
   acceptance cohorts. Keep client timings and matching gateway/role traces,
   including cache misses, authorization, placement, deployed versions, and failures.
3. Optimize the dominant measured production stage and rerun the full first-use,
   sustained, reload, expiry, and cold-runtime cohorts against the 3-second target.
4. Use the NEAR activation spans to optimize its slow production stages while
   retaining asynchronous registration success. Protocol changes in Phases 4–5
   depend on those measurements.

## Production ECDSA acceptance cases

### Deployed measurements on 2026-09-19

The deployed `0.5.24` wallet at `wallet.seams.sh` was exercised against
`test.api.wallet.seams.sh` and `test.sign.seams.sh` from Japan. Chromium used a
virtual passkey with automatic user verification. MPC, storage, and Tempo RPC
requests used the deployed services. Human passkey time is therefore excluded;
these are signing measurements, not full click-to-chain-confirmation timings.
Two registrations and thirteen successful Tempo signatures were captured.
One signature configured the funded account's fee token; the remainder signed
the demo greeting transaction. These are small diagnostic cohorts, not p95s.

Registration succeeded in 8.17 and 8.33 seconds. The NEAR custody join took
3.53 and 3.98 seconds before success. The subsequent asynchronous provisioning
task took 4.11 and 2.75 seconds, including signer activation of 2.51 and 1.35
seconds. This verifies that slow NEAR activation remains outside the success
gate. The earlier custody join remains a registration optimization target;
it participates in proving the combined key manifest and cannot simply be
removed from that proof boundary.

Before measuring signing, the site exposed a separate startup regression:
optional mainnet discovery returned HTTP 503 without CORS, making browser
configuration loading fail. Monorepo PR 24 fixed the public unavailable
response. Mainnet deployment `35443614586` passed, and a fresh page reload
without interception verified the fix. Early measurements used a browser-only
CORS header correction for that optional discovery request; signing traffic
was never intercepted or mocked.

The baseline signing-worker version was
`a9c5e678-2efc-4139-9358-f171ea60b492`. The gateway and MPC router versions were
`cd65e890-59ef-4824-a264-06b8b9c6f169` and
`4d3974e4-b60f-4df0-8f93-f8e0f4718eed`. Live tails showed prepare/finalize
waiting in the signing worker with relatively small CPU time. Read-only D1
`SELECT 1` probes reported the gateway primary in Singapore (`SIN`) and the
signing-worker private primary in Osaka (`KIX`). The gateway targets Singapore;
the signing worker had no placement policy. Its source performs several
sequential primary reads and writes on the signing path.

A placement-only change put the production-testnet signing worker near Osaka
(`aws:ap-northeast-3`), producing version
`81eb18f1-3475-450e-9ca7-5a904904a290`. Bindings and cryptographic material were
unchanged. Monorepo PR 25 records this region in the existing deployment target
and renders it into the selected Wrangler environment. No other lane's
placement was changed. [Cloudflare's placement documentation](https://developers.cloudflare.com/workers/configuration/placement/)
supports placing a service-bound worker near its backend. Exact database
location should be rechecked before changing another lane.

PR 25 merged, and standard production-testnet deployment
[`35444951877`](https://github.com/seams-tech/seams-monorepo/actions/runs/35444951877)
completed successfully. A fresh settings read confirmed that Osaka placement
survived deployment; all five live Gateway smoke checks returned HTTP 200.
Its temporary build cache was removed after the deployment consumers finished.
The signing samples below were collected during the preceding placement
comparison, before this standard redeploy.

All durations below are seconds. Commit includes authorization after
confirmation, pool work, prepare/finalize, and transaction assembly. Refill is
nested inside commit and must not be added again. A dash means no foreground
generation was required.

| Sample | Placement | Authorization | Initial pool | Refill | Prepare | Finalize | Commit |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | Baseline | Reusable | Empty | 6.32 | 1.30 | 1.91 | 9.76 |
| 2 | Baseline | Reusable | Available | — | 2.27 | 2.74 | 5.63 |
| 3 | Baseline | Reusable | Available | — | 1.63 | 1.61 | 3.47 |
| 4 | Baseline, after unlock | Reusable | Empty | 6.74 | 1.47 | 1.91 | 10.55 |
| 5 | Baseline | Reusable | Available | — | 1.31 | 1.69 | 3.34 |
| 6 | Baseline | Reusable | Available | — | 1.35 | 1.93 | 3.65 |
| 7 | Baseline | Operation step-up | Available | — | 1.33 | 1.74 | 3.61 |
| 8 | Osaka | Operation step-up | Empty | 7.32 | 1.38 | 1.11 | 10.63 |
| 9 | Osaka, after unlock | Reusable | Empty | 5.32 | 0.99 | 1.26 | 7.88 |
| 10 | Osaka | Reusable | Available | — | 0.89 | 1.47 | 2.58 |
| 11 | Osaka | Reusable | Available | — | 1.00 | 1.17 | 2.46 |
| 12 | Osaka | Operation step-up | Available | — | 0.98 | 1.17 | 2.80 |
| 13 | Osaka | Operation step-up | Empty | 9.93 | 1.66 | 1.17 | 13.35 |

Cached signing improved from 3.34–5.63 seconds (five samples) to 2.46–2.80
seconds (three samples). After the change, the gateway's upstream proxy span
for these cached prepare/finalize requests was 0.29–0.74 seconds, compared with
0.82–1.30 seconds before it. Client share computation and signature verification
were milliseconds. Placement is useful, but the remaining empty-pool cohort
still fails the three-second target.

The live signing-worker tail independently supports the placement result:
prepare wall-time medians were 799 ms before and 137 ms afterward; finalize
medians were 1,188 ms before and 201 ms afterward. Seven baseline request pairs
and five post-change pairs were captured by that tail. These per-role spans are
nested inside the gateway proxy and client timings, rather than additional work.

Sample 13 reproduces the recurring slow transaction after the reusable signing
budget and precomputed material are consumed. Operation step-up with an empty
pool requires foreground generation. One init request and seven sequential
step requests precede signing; its step timings were 0.75–1.57 seconds apiece.
Post-sign refill is deliberately absent for operation-specific authorization.
Increasing the reusable allowance or weakening exact-operation authorization
would change the product's authorization policy and is not part of this fix.

The next implementation priorities are now:

1. Execute the [ECDSA implementation sequence](#ecdsa): instrument and consolidate
   repeated authorization reads, verify session placement, benchmark a persistent
   transport, and improve authorized refill timing. Implement and measure each
   change separately so its contribution remains attributable.
2. Keep empty-pool generation and cached prepare/finalize within one end-to-end
   budget. The existing 2.46–2.80-second cached samples leave little room for
   foreground generation; both paths need attention.
3. Resolve the explicit preprocessing-permission design in Phase 4 before
   enabling refill beyond the reusable signing allowance. Preserve current
   authorization semantics until that design is accepted and verified.
4. Optimize the measured 3.5–4.0-second NEAR custody join and 1.4–2.5-second
   asynchronous activation while preserving ECDSA-ready registration success.
5. Repeat the production matrix, including Arc, cold runtimes, concurrent
   requests, expired sessions, reload, and exhausted pools. Arc signing was
   blocked by the external faucet's CAPTCHA and has no production sample in
   this run. A separate attempt after the five-minute session expired stopped
   with `exact ECDSA Wallet Session is unavailable` before signing; reload and
   passkey unlock restored signing. That expiry case needs a focused lifecycle
   reproduction and must not be counted as a successful latency sample.

Mainnet activation remains separate: its production environment is disabled,
has no active binding, and its organization has zero prepaid balance. Stripe
integration is unfinished. No credit was issued, checkout performed, or billing
guard bypassed during this work. Testnet-backed production measurements remain
available independently of that decision.

### Fresh pre-release baseline: 0.5.24

Six additional Tempo signatures were measured on `wallet.seams.sh` after the
standard testnet deployment, from Japan, with real MPC, storage, and chain RPCs.
Chromium used an automatically verified virtual passkey; there was no response
interception. These are diagnostic samples, not a production p95 estimate.

| Sample | Authorization | Presignature source | Generation or refill wait (s) | Prepare (s) | Finalize (s) | Commit (s) |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | Reusable | Foreground generation | 6.57 | 1.26 | 1.58 | 9.79 |
| 2 | Reusable | Wait for background generation | 5.91 | 1.20 | 1.75 | 9.14 |
| 3 | Reusable | Wait for background generation | 4.84 | 0.92 | 0.97 | 6.97 |
| 4 | Operation step-up | Foreground generation | 6.63 | 1.57 | 2.05 | 10.95 |
| 5 | Operation step-up | Foreground generation | 7.80 | 1.96 | 1.29 | 11.63 |
| 6 | Operation step-up | Foreground generation | 8.91 | 0.92 | 1.18 | 11.69 |

The `available` selection event occurs after waiting for an in-flight refill.
Samples 2 and 3 therefore cannot be classified as cache hits. Classify pool
behavior using both selection and refill-wait timings.

The sanitized signing-worker tail captured all six generation ceremonies:
48 session-object invocations used 1,226 ms of CPU in total, approximately
204 ms per generation. Their combined wall time was 1,264 ms. The 48 enclosing
worker requests used 473 ms CPU and 9,185 ms wall time. These are nested spans;
do not add parent and child durations. Browser generation took several seconds
per ceremony, directing the next investigation toward transport and surrounding
authorization/storage waits. Ingress `NRT` metadata does not establish the
execution location of a Worker or Durable Object.

One attempt after session expiry failed before generation with
`exact ECDSA Wallet Session is unavailable`. Reload and full passkey unlock
restored signing. It remains a reliability failure, outside the six successful
latency samples.

Baseline signing-worker version: `ab81d5c3-078a-4463-8684-52de17b314f1`;
gateway version: `73fed18f-809a-47de-b527-6587e6aeba2b`.

The private gateway entrypoint also resolves the active tenant binding through
Console before entering the SDK handler. Console performs two sequential D1
reads for this lookup. The new SDK `ecdsa_presign_total` span excludes that
outer work. Capture gateway and Console runtime telemetry together; the
difference between browser duration and SDK total is not purely network time.
Normal ECDSA signing executes directly in Gateway and does not traverse the
separate Wallet Runtime service.

### Release 0.5.25: deployed results on 2026-09-19

Both public npm packages are published as `0.5.25` with signed provenance from
[release run 35452323708](https://github.com/seams-tech/seams-wallet/actions/runs/35452323708).
Wallet [PR 7](https://github.com/seams-tech/seams-wallet/pull/7) merged as
`1a61e44403ac3a38fac2a57e1cff2593fb1daf2e`. Exact private pins, lockfile,
and the existing release-age allowlist were updated in
[monorepo PR 28](https://github.com/seams-tech/seams-monorepo/pull/28), merged as
`c844f38db11c574c3f712438ea4ec705049ef154`. Local `pnpm check`, full application
build, and GitHub composition checks passed.

The coordinated [frontend deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/35455056375)
and [production-testnet backend deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/35455054477)
passed, including smoke checks and temporary backend cache cleanup. Both
`test.sign.seams.sh` and `sign.seams.sh` expose manifest version `0.5.25`.
Signing measurements below use the testnet backend. Mainnet activation remains
blocked independently; this release did not issue credits or change billing policy.

Measured gateway version: `352f7dd1-dd62-4a37-a94a-08f238f7f207`;
signing-worker version: `3ef722b9-5e58-4f52-8483-faa17fb5c295`.
The Console lookup service remained version
`9f005685-f13a-41ee-9eab-a2c9842ab219`.

Fourteen Tempo signatures completed successfully on `wallet.seams.sh`, using the
same Japan client and automatically verified virtual passkey as the fresh
baseline. Ten were consecutive after a full unlock. Four followed another
unlock, with a controlled 12-second pause before and between signatures to
allow authorized prefill. Commit includes post-confirmation authorization,
generation or refill waiting, signing, and transaction assembly; human prompt
time and chain confirmation are excluded.

| Cohort | Samples | Median commit (s) | Range (s) |
| --- | ---: | ---: | ---: |
| Immediate/consecutive reusable session, waiting for refill | 3 | 6.35 | 5.90–6.35 |
| Consecutive operation step-up, empty pool | 7 | 8.65 | 7.73–9.21 |
| Paced, cached material; three reusable and one step-up | 4 | 2.26 | 2.13–2.96 |

The fresh 0.5.24 reusable cohort had a 9.14-second median; its three empty-pool
step-up samples had an 11.63-second median. The new samples show improvement,
but these small cohorts do not establish a population p95 or isolate every
change's contribution. Cached signing meets the requested range in this run;
the immediate and sustained cohorts still fail acceptance.

Unlock prefill now demonstrably schedules and produces material. Duplicate
Tempo/Arc scheduling is coalesced by the existing pool key. Immediate signing
still waits 3.67–3.93 seconds for that generation. Once reusable authority is
exhausted, foreground generation takes 5.51–6.41 seconds. One background refill
was rejected with HTTP 503 / `wallet_session_unavailable` at the allowance
boundary; the next operation successfully used exact-operation step-up. Record
that rejected background attempt separately from the 14 successful signatures.

#### Remaining bottleneck: sequential authorization and transport

Each of the seven foreground ceremonies used one init and seven sequential step
requests. The table shows medians of per-ceremony summed timing spans. Rows are
nested or overlapping and must not be added together.

| Measurement | Median per ceremony (s) |
| --- | ---: |
| Foreground generation, client | 6.07 |
| Sum of browser request-to-response-start times | 5.53 |
| Sum of gateway runtime wall times | 4.51 |
| SDK presign handler total | 3.57 |
| Gateway authentication within SDK handler | 1.28 |
| Material resolution / admission within SDK handler | 0.11 / 0.27 |
| Gateway upstream proxy | 1.90 |
| Signing-worker measured total, nested in proxy | 0.83 |
| Session-object call, nested in worker total | 0.68 |

Across these ceremonies, gateway runtime wall time minus the SDK span has a
median of 0.90 seconds. The outer tenant-binding lookup is one uninstrumented
boundary. The Console
lookup itself has a 28 ms median wall time across the rapid batch, so the
Console function's compute/storage alone does not explain that whole gap.
Gateway proxy time minus the worker's measured total has a 1.02-second median
per ceremony. Browser response-start sums minus gateway wall sums add a further
0.97-second median. These residuals are diagnostic comparisons, not an exclusive
critical-path decomposition. [Cloudflare runtime wall time](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/#wall-time-per-execution)
includes `waitUntil()` work and can differ from response duration. Add explicit
request-path spans around the outer lookup and service calls before assigning
these gaps to network latency or storage.

The rapid batch's 80 session-object invocations used 1.96 seconds of wall time
in total, approximately 0.20 seconds per generation. Step calls had median
6 ms CPU and 6 ms wall time. Gateway presign queue spans were zero. Repeated
multi-second generation therefore persists with low session-object compute
and without measured admission queueing. Warm-up alone cannot address the
observed sequential request costs.

#### Next implementation sequence

1. Benchmark the existing persistent-transport proposal against the current
   eight-request exchange. Preserve protocol rounds, client/server custody,
   exact material binding, revocation, expiry, and atomic admission. Measure
   gateway-to-worker and worker-to-object dispatch separately, including actual
   object placement. A session-object call spans more than its crypto execution.
2. Reduce repeated gateway authentication/storage work using the measured
   request path. Investigate the outer Console round trip and its two reads;
   preserve fresh authority checks and avoid an unbounded tenant-binding cache.
   Measure each change separately before accepting a placement or transport change.
3. Keep authorized prefill running early and prevent futile refill scheduling
   after allowance exhaustion. Improving refill throughput remains necessary:
   the paced cohort hides generation, while rapid signing catches up with it.
   Separate preprocessing permission is still an explicit policy decision;
   no allowance expansion was included in this release.
4. Repeat immediate, rapid, cached, exhausted, reload, expiry, and cold cohorts
   after the next change. Arc remains blocked on test gas for benchmark address
   `0x1fce806a5b24a3a7005eaf7dc1bb28c13dcefcb4`; its production sign button was
   still disabled after this release. Do not infer Arc acceptance from Tempo.

Release artifact uploads succeeded in the public Wallet repository. Private
GitHub artifact quota recovery remains unverified; public uploads do not prove
that private uploads are available. Existing retention cleanup and exact-run
cache handoff remain in place.

### Follow-up: request-path attribution and tenant lookup, 2026-09-20

[Monorepo PR 29](https://github.com/seams-tech/seams-monorepo/pull/29) replaces
the two sequential Console binding reads with one LEFT JOIN. Each request still
reads the current active pointer, validates both records, and rejects a dangling
pointer. No cache or authorization relaxation was introduced. Eight focused
tests, full application checks/build, and CI passed.

The [Console deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/35484983679)
and [testnet backend deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/35484984736)
passed at monorepo revision `0e35b0192ef6ca2d5c53ff76e05e6df208994d7b`.
Gateway version is `580cdf3d-258d-4b72-9daf-d40b0ab80d67`; Console version is
`9daf7519-5425-4747-a353-b4f9fbdded43`. Public Wallet packages remain `0.5.25`.

New `wallet_gateway_binding` and `wallet_gateway_total` response timing spans
measure the awaited service call and entrypoint directly. Seven successful
foreground generations produced these median per-ceremony sums:

| Boundary | Seconds |
| --- | ---: |
| Client foreground generation | 5.15 |
| Browser request-to-response-start sum | 4.77 |
| Gateway entrypoint total | 3.19 |
| Outer binding service calls | 0.13 |
| SDK handler total | 3.04 |
| SDK authentication | 0.96 |
| SDK material / admission | 0.07 / 0.23 |
| Gateway upstream proxy | 1.81 |
| Signing-worker measured total, inside proxy | 0.91 |

The per-ceremony median of browser time minus gateway time is 1.49 seconds.
Entrypoint time outside the binding lookup and SDK handler is only 5 ms per
ceremony. These request-path spans supersede the earlier runtime-wall residual
as an attribution of synchronous outer work. The Console lookup is a small
remaining contributor; prioritize authentication and repeated transport.
Nested spans must still not be added together.

After unlock settled, ten signatures succeeded: three cached reusable signatures
took 1.93–2.17 seconds (median 2.11), and seven empty-pool operation step-ups took
6.99–7.82 seconds (median 7.50). Foreground generation took 4.94–5.63 seconds.
The preceding batch's corresponding step-up median was 8.65 seconds, but the
whole difference cannot be attributed to the JOIN: SDK authentication also
became faster despite unchanged code. These remain small, temporally separated
diagnostic cohorts, not a controlled p95 comparison.

One preceding immediate attempt failed with HTTP 503 `wallet_session_unavailable`
before producing a signature. It selected operation step-up, then background
reusable-session prefill completed afterward. This suggests an unlock/readiness
race, which needs a focused reproduction; the benchmark's wait for a visible
sign button does not establish completion of replacement-session installation.
Retain this failure separately from the ten settled-session successes.

Source inspection identified the next authorization optimization: exhausted
step-up first attempts reusable-session resolution, then rereads the credential
through the exact-status path, loads authority and auth-method records, and
resolves active material. Replace repeated resolution with one typed result
that distinguishes reusable, exhausted, unavailable, and rejected states.
Preserve current origin, identity, expiry, revocation, material, and atomic
operation-admission checks. Exercise both active and exhausted paths, plus
revocation between protocol rounds, before releasing that shared change.

Persistent transport should be benchmarked with the same fresh checks. A
WebSocket does not itself remove database work or protocol dependencies. Compare
browser-to-gateway and gateway-to-worker hops separately; retain the current
transport until the benchmark justifies a production replacement.

#### Concrete preprocessing-permission decision

For sustained 1–3-second signing after the reusable allowance is exhausted,
consider a distinct **presignature-only permission**, issued during an
authenticated unlock or registration. It would retain the existing target
depth of three and concurrency limits, expire no later than its wallet session,
and bind to the exact wallet, origin, authority, auth method, material activation,
and signing worker. Revocation, retirement, expiry, or material replacement
would stop replenishment. Existing generation rate limits and single-use
reservation/consumption remain mandatory.

This permission would allow background replenishment with zero reusable signing
uses. It would grant no transaction-signing authority: each transaction after
allowance exhaustion would still require fresh exact-operation step-up. That
is an authorization-policy change requiring an explicit decision. It has not
been implemented or enabled by the transport/lookup work above.

### Acceptance criteria

The user reports **10–20 seconds** waiting at “Creating transaction signature”
on `wallet.seams.sh`, including an approximately 13-second example with Tempo
selected and the account already funded. The screenshot identifies the
visible stage; the durations come from the user's observations.

The latest report narrows the problem further: **subsequent Tempo and ArcEVM
transactions also take approximately 13–15 seconds**, and the latency appears
in production while local signing appears fast. Treat recurring production
ECDSA threshold signing latency as the primary investigation. Cold startup
remains one measured component. Repeated transactions alone do not establish
that every server role is warm or that the presignature pool is hitting.

In the current site source, this toast maps to `signing.commit.started`. The
[EVM-family signing flow](../packages/wallet/src/core/signingEngine/flows/signEvmFamily/signingFlow.ts)
emits that event before acquiring the material-use queue, resolving current
signing material, authorizing a required operation step-up, and signing. It
emits `signing.transaction.signed` after transaction assembly and recording the
signed nonce reservation. Broadcasting and chain confirmation have later events.

The [ECDSA pool path](../packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool.ts)
can restore durable material, wait for an in-flight refill, or synchronously
refill an empty, expired, or unavailable pool before retrying signing. A long
wait at this toast therefore needs attribution across the entire commit path.
Verify the deployed release matches these event and pool behaviors first.

Use the following release targets for the requested 1–3-second experience:

| Measurement | Target |
| --- | --- |
| Authentication complete → signed transaction ready, including preparation and queueing | p95 ≤ 3 seconds per test cohort; aim for p50 around 1 second or faster |
| “Creating transaction signature” → signed transaction ready | Within the same 3-second total budget; the reported 10–20-second cases must pass |
| Click → completion, authentication prompt, broadcast, and chain confirmation | Report separately to expose the full experience and distinguish human/network waits |

For an already authorized session, start the signing budget when confirmation
is accepted and no further user action is needed. Measure real first-use
signing immediately after registration or unlock, after reload, and against
cold server runtimes. Cover valid cache hits and empty/expired pools separately;
report sample counts, failures, and tail outliers alongside percentiles. Apply
the target separately to Tempo and ArcEVM, including repeated transactions in
one unlocked session. Local results are a diagnostic comparison; production
results determine acceptance.

Earlier preparation must reduce the total wait. Keep registration/unlock
latency visible in the results, and run the immediate-sign test without an
artificial warmup interval. Meeting this target requires actual signature
completion; moving the toast or extending a disabled-button interval does
not satisfy it.

## Current implementation

- Mixed registration returns an ECDSA-ready wallet and completes NEAR
  provisioning separately.
- The NEAR custody join is already awaited earlier in registration. The visible
  tail also includes server finalization, session installation, local
  persistence, and signer activation.
- Sponsored named NEAR accounts require account creation during provisioning.
- A/B preparation is already concurrent, Yao already streams between roles, and
  hosted roles already use service bindings.
- A minute-based server prewarm job already exists.
- ECDSA already has a durable encrypted presignature cache.
- ECDSA pool hits still perform sequential prepare and finalize requests,
  with client share computation between them and signature verification afterward.
- The shared [secp256k1 signer](../packages/wallet/src/core/signingEngine/flows/signEvmFamily/signers/secp256k1.ts)
  schedules post-sign refill for reusable wallet-session authorization. Its
  operation-step-up branch does not schedule that refill. Production's actual
  authorization branch and refill outcome therefore matter on every transaction.
- The current Ed25519 signing implementation performs prepare followed by
  finalize for each signature.

Fresh deployed measurements are required to attribute the remaining latency.
Historical local Yao benchmarks are useful comparison points and do not
establish production latency or cold-start behavior.

## Phase 1: establish the baseline

Measure authentication-complete → all requested signers ready → first
signature. Break the registration path into:

- Yao execution;
- server finalization;
- account creation, when required;
- session installation;
- local persistence; and
- browser-worker initialization and signer activation.

Separately measure signing with a fresh browser, a fresh Worker isolate, an
empty presign pool, and a populated pool. A page reload, an empty pool, and a
cold server isolate are distinct conditions and must be recorded separately.

Start with a matched production/local comparison for both Tempo and ArcEVM:

- Record the actual site, SDK, backend, and WASM release versions and build
  settings. Establish whether local and deployed code are equivalent.
- Match the signing operation, authorization mode, account readiness, pool
  state, and client device/network as closely as possible. Use fresh transaction
  nonces and fresh one-use protocol material for every operation.
- Run at least ten sequential transactions per chain in the same unlocked
  session. Separate the first transaction from subsequent transactions, then
  repeat with rapid consecutive signing and normal pauses. This exercises
  sustained refill beyond the current three-entry pool capacity. Use enough
  repetitions to report meaningful p95 results rather than treating one short
  sequence as a release benchmark.
- Compare production and local timings stage by stage. Record role
  initialization, service/storage placement, authorization branches, cache
  hits/misses, refill outcomes, and request/retry counts. Keep differences in
  production transport and storage explicit in the comparison.

Record deployed p50/p95 latency, execution locations, storage calls, and release
versions. Reuse existing registration timing spans and measurement tooling.
Allocate stage budgets within the 3-second ECDSA ceiling using the measured
baseline.

Correlate browser events and server spans under one operation identifier,
recording the site/SDK/backend versions and cache outcome for each transaction.
Attribute client WASM initialization, material queueing and authorization,
durable cache discovery/decryption/reservation, refill wait and generation
rounds, signing prepare/finalize, client share computation and signature
verification, storage calls, and transaction assembly. Record each role's
initialization separately from request execution; use platform CPU/startup
profiling for compute attribution. Log timing and state metadata without
secret material or authentication credentials.

Use the trace to choose the fix:

| Observed result | Next action |
| --- | --- |
| Repeated slow signatures regenerate presignatures | Diagnose refill scheduling/failure, authorization mode, expiry, and pool identity changes; repair the demonstrated cause. |
| A confirmed pool hit still takes 13–15 seconds | Optimize measured authorization, prepare/finalize, role execution, storage, or client compute costs on the online signing path. |
| Delay occurs between requests or before work starts | Inspect material queues, browser-worker scheduling, contention, and retry/backoff, including competition from refill. |
| Production is slow in stages that are fast locally | Investigate deployed artifacts/configuration, network hops, storage placement, and per-request initialization in those stages. |

Preserve [Intended Behaviours](./intended-behaviours.md): mixed registration may
report ECDSA-ready success while NEAR is pending. The existing
[passkey registration contract](../tests/e2e/intended-behaviours/passkey.registration.contract.test.ts)
calls `awaitNearReady()` after registration. Keep that expectation while NEAR
activation is slow, and measure the interval separately for passkey and Email
OTP registration. Immediate ECDSA signing must continue to work during NEAR
provisioning.

**Deliverable:** an attributed latency baseline and measured budgets for
subsequent changes, with separate registration-success and NEAR-ready timings.

## Phase 2: shorten background NEAR activation

Optimize the
[registration orchestrator](../packages/wallet/src/SeamsWeb/operations/registration/registration.ts)
without moving deferred server finalization, session installation, or local
activation onto the registration-success path.

Reduce the underlying work by:

- reusing established custody material and session facts;
- combining redundant storage operations where their correctness requirements
  permit it;
- reducing repeated reads and hydration; and
- overlapping independent preparation as soon as its prerequisites exist.

Start with the later finalization and activation stages, because the NEAR
custody join is already awaited earlier. Trace the server side through
[the D1 registration service](../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationService.ts).

Preserve the internal durable commits needed for crash recovery. An
interruption must leave resumable registration state and retain already
committed material. Publish NEAR readiness only after durable activation and
live client readiness are established.

Preserve ECDSA-ready success and its pending NEAR state. Retain tests for
durability, exact replay, and recovery from interrupted commits.

Sponsored named-account creation must have its own timing span and remain part
of readiness when the configured account requires it.

**Exit criteria:**

- Passkey and Email OTP registration report success promptly while NEAR is slow.
- Background activation time shrinks, and total NEAR readiness p95 improves.
- NEAR signing becomes available only after activation actually succeeds.
- Interrupted registration preserves committed material and resumes through
  the existing durable authority and replay boundaries.

## Phase 3: reduce recurring ECDSA signing and deployment overhead

Begin with subsequent production transactions and confirmed pool hits. Time
operation authorization, prepare, client share computation, finalize, and
verification independently. Within server requests, separate role execution
from network and storage waits. Inspect serial reads/writes and repeated
configuration or WASM initialization that can recur on every request.

Remove demonstrated redundant work and overlap independent I/O. Preserve the
dependency between prepare and finalize: the client share uses the server's
prepare response. Collapsing those exchanges would be a protocol change and
requires separate evidence and review.

Use the existing
[startup measurement tooling](../crates/router-ab-cloudflare/scripts/measure-startup-latencies.mjs)
to inspect each released role separately.

Trim code and tables retained in the actual WASM bundles, remove repeated
initialization, and reuse immutable validated configuration where safe.
Role-specific builds, release optimization, and LTO already exist; inspect the
artifacts they actually produce.

Audit the existing
[prewarm handler](../packages/wallet-server/src/router/cloudflare/runtime/routerAbPrewarm.ts)
against lazy initialization exercised by real requests. Retain prewarming
where its benefit is demonstrated. Cloudflare does not guarantee that a later
request reaches the warmed isolate; see
[Worker lifecycle and distributed execution](https://developers.cloudflare.com/workers/reference/how-workers-works/).

Trace Gateway → Router → SigningWorker and A ↔ B alongside their D1/DO calls.
Tune placement around the complete request path, then remove redundant reads
and safely batch operations. Preserve role separation, current authorization
checks, and durable replay barriers.

**Exit:** measured improvements to first-request and warm signing latency,
with per-role startup and storage costs attributed separately. Together with
the ECDSA work below, production Tempo and ArcEVM must meet the 3-second
signing budget for each acceptance cohort, including sustained subsequent
signing. Scheduled prewarming alone cannot establish this.

## Phase 4: keep preprocessing out of the signing wait

### ECDSA

Status: steps 4.1 and 4.4 have local implementation. The next implementation
slice starts registration refill at the earliest durable authorization boundary
and adds a nested Durable Object timing span. Production comparison and the
remaining decision gates are open. Production generation still takes
5.32–9.93 seconds in the measured post-placement empty-pool samples. The share
attributable to authorization, network transit, protocol computation, and
completion storage has not yet been measured independently.

The [client handshake](../packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool.ts)
issues an initialization request followed by dependent step requests. The
[session Durable Object](../crates/router-ab-cloudflare/src/durable_object/ecdsa_presign_live_session.rs)
already keeps intermediate cryptographic state in memory. Trace the actual
Browser → Gateway → SigningWorker → session Durable Object path and its
database dependencies; generation does not require adding another cache or
moving both secret shares into one service.

#### 4.0 Start registration refill at the durable ECDSA boundary

Registration previously scheduled its fire-and-forget refill after passkey
export-root setup, deferred NEAR setup, pending-row cleanup, completion events,
and timing summaries. The exact ECDSA capability and Wallet Session are already
durable after the ECDSA persistence commit. Schedule the same authenticated
refill immediately after that commit so its first ceremony overlaps the
remaining registration bookkeeping.

Keep registration completion independent of refill. The scheduling call remains
fire-and-forget, uses the same precise preprocessing capability, and performs the
same live session-status read. Do not expose the wallet as authenticated before
the existing completion boundary. A later registration failure may leave only
material bound to the already committed ECDSA capability; it cannot make an
uncommitted capability usable.

**Exit:** registration and unlock contracts still report success without waiting
for pool fill, and production traces show the first presignature ceremony begins
earlier relative to registration completion.

#### 4.1 Instrument and consolidate repeated authorization reads

Implementation update: the local patch removes the duplicate material lookup
from step-up pool-fill admission. The remaining fresh lookup and atomic
material/operation admission still run on each request. Gateway `Server-Timing`
now separates queueing, authentication, material resolution, admission, proxy,
and total duration. Signing-worker metrics separate initial material loading,
the session-object call, terminal pool admission, and total duration. A shared
allowlist forwards only finite, nonnegative durations to client diagnostics.
Presign session IDs correlate these timings with the existing round trace.

The next timing layer records `ecdsa_presign_sw_do_total` inside the session
Durable Object and folds it through the SigningWorker and Gateway allowlists.
Comparing it with `ecdsa_presign_sw_session` separates time observed inside the
object handler from the complete worker-to-object call. Cloudflare runtime clocks
do not establish pure CPU time, so the deployed comparison must still include
runtime CPU telemetry.

Local verification passed: 197 Wallet unit tests, 46 Rust presign tests,
SDK/server type checks and builds, registration with immediate Tempo and
asynchronous NEAR readiness, and sustained Tempo/Arc signing with 20 unique
presignatures. The sustained contract verifies timing propagation and rejection
of changed material handles and expired step-up requests before worker dispatch.
The server build was rerun after the SDK build completed because simultaneous
builds briefly removed a generated WASM module it imports.

Production attribution remains open. These boundary spans include I/O and
cannot establish pure CPU duration: Cloudflare advances its runtime clock
across I/O. Use runtime CPU telemetry alongside them. Per-storage-call counts,
actual execution locations, and a deployed before/after comparison remain
necessary before selecting the placement or transport change below.

Start in the [pool-fill authorization handler](../packages/wallet-server/src/router/transport/fetch/routes/thresholdEcdsa.ts)
and its [operation admission helpers](../packages/wallet-server/src/router/domains/signingOperations/routerAbPrivateSigningWorker.ts).
Before this patch, the step-up handler resolved active material, validated it,
then resolved it again through `resolveFreshRouterAbEcdsaMaterialActivation`
before claiming the operation, on initialization and every step.

- Add correlated timings for gateway queueing, authentication, each material
  resolution, operation read/admission, the service-binding call, session-object
  transit/computation, and final pool admission. Include call counts, protocol
  stage, authorization branch, execution location, and deployed versions.
  Keep tokens, credentials, protocol payloads, and secret shares out of traces.
- Consolidate repeated material reads within one request around one fresh,
  validated result immediately before admission. Preserve the atomic material
  comparison and operation claim. Inspect the exhausted-session branch for
  additional duplicate work before changing its helpers.
- Batch or overlap independent reads only where the existing consistency
  contract permits it. Keep request parsing at boundaries and pass precise
  authorized state into core logic. Avoid cross-request authorization caches.
- Add focused behavioral coverage for active-material replacement, revocation,
  expiry, mismatched scope, and duplicate/replayed operation admission. Add
  type fixtures if shared authorization-state types change.

**Exit:** equivalent valid operations perform fewer storage calls; invalid or
revoked operations remain rejected. Deployed before/after traces identify the
actual reduction in generation and complete signing time.

#### 4.2 Verify and correct presign-session placement

Measure the session Durable Object separately from the worker and D1 primary.
The [object lookup](../crates/router-ab-cloudflare/src/durable_object/worker_storage.rs)
currently uses a deterministic per-session name without an explicit location
hint. Worker placement alone does not establish the object's location.

- Record where newly created session objects execute and the latency of each
  hop, including the gateway's own authorization storage. Compare fresh
  sessions under the existing placement with one controlled placement change.
- If traces show geographic detours, place new session objects near the
  measured signing path using the supported placement mechanism. Keep hosted
  configuration in the existing monorepo deployment target model.
- Verify the deployed effect. Cloudflare location hints apply at object
  creation and are best effort; existing objects do not automatically relocate.
  Use fresh ceremony IDs for the comparison and preserve durable pool and
  replay records. See [Durable Object data location](https://developers.cloudflare.com/durable-objects/reference/data-location/).

**Exit:** measured per-round transit decreases without regressing gateway
authorization or cached signing. Retain the current configuration if the
experiment shows no benefit; record the result before transport work.

#### 4.3 Benchmark and implement a persistent generation transport

Prototype one authenticated WebSocket through the existing service bindings
to the existing session Durable Object. Reuse the Rust presign state machine
and message codecs; keep each client's share in the client worker. Compare
the same ceremony over HTTP and WebSocket with equivalent authorization and
placement. Persistent transport retains the dependent MPC rounds and aims to
remove repeated request setup, dispatch, and avoidable admission work.

- Establish an immutable ceremony binding to wallet, material activation,
  presign session, authorization kind, and expiry. Step-up remains bound to
  its exact operation and permitted generation count.
- Separate initial admission from continuation handling only after specifying
  how continuation preserves the current revocation, material freshness,
  expiry, and quota guarantees. Reuse required checks until an equivalent
  mechanism is implemented; opening a socket must not prolong authority.
- Enforce message order, stage transitions, bounded payloads, backpressure,
  timeout, and cancellation. Flush immediately when a protocol dependency
  needs the peer's message; avoid adding batching delays to the critical path.
- Define disconnect, duplicate-message, terminal-response loss, and object
  restart behavior. Abort incomplete ceremonies safely and restart with fresh
  state when continuation cannot be proven safe. Preserve atomic admission,
  reservation, consumption, and replay protection for completed material.
- Account explicitly for eviction/hibernation of the in-memory session.
  A connected socket alone is insufficient recovery state; see
  [Cloudflare WebSocket lifecycle guidance](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).
- Run existing Rust protocol/vector checks plus focused transport interruption,
  replay, and authorization tests. Require byte/protocol equivalence for a
  transport-only change and update the lifecycle contracts for changed behavior.

**Exit:** the prototype demonstrates a meaningful end-to-end improvement and
equivalent security behavior. Ship the selected transport in a coordinated
SDK/server release; remove the superseded path after the release transition.
If it does not improve the measured bottleneck, retain HTTP and document the
decision instead of adding a second permanent transport.

#### 4.4 Restore and replenish material at the earliest authorized point

Implementation update: registration now schedules bounded refill after committing
its authenticated ECDSA session, without awaiting the pool or NEAR readiness.
Registration and unlock share the scheduling helper and report scheduling
outcomes through the existing signing diagnostics.

The registration contract exposed two existing prefill defects. Prefill required
a sealed warm-session record even though current registration signs through the
durable capability and exact Wallet Session. After correcting that resolution,
prefill still omitted the required key handle and stopped with `invalid_args`.
The scheduler now accepts the same authorized capability used for signing,
reads live quota through the existing resolver, and supplies the validated key
handle. The refill input requires the handle at compile time. The obsolete
sealed-record-only checks and duplicate authority resolver were removed.
Reload prefill uses this same corrected path. Prefill results identify the
Wallet Session with `walletSessionId`; the obsolete threshold-session result
field and dispense counters were removed. Prefill does not dispense signing
allowance.

The existing pool scheduler restores durable material before generation,
deduplicates shared-pool requests, publishes its first available entry, and yields
to foreground signing. Target depth, concurrency limits, minimum remaining uses,
expiry, one-use consumption, and server authorization are unchanged. Type
fixtures reject an unauthorized capability and a refill without a key handle.
The blocked-init registration contract passes, as does sustained signing with
20 distinct consumed presignatures. All 197 Wallet unit tests pass. Unlock
prefill shares the existing operation-scoped status reader so that preparing
Tempo and Arc does not add duplicate status reads. Passkey unlock, cold unlock
from empty browser storage, and the Email OTP registration/unlock/refresh/export
lifecycle pass. Production before/after refill measurements remain required.

The passkey refresh contract also exposed a pre-existing NEAR failure:
`local Ed25519 material lane is unavailable`. It reproduced on the unchanged
`0.5.24` source baseline. Rehydration read the lane inventory without the
selected owner scope, so the valid sealed lane was classified as requiring
authorization and failed exact-lane matching. Rehydration now uses the existing
selected-owner resolver; exact wallet, material, session, and quota checks are
retained. The refresh contract passes through key export, NEAR/Tempo/Arc signing,
budget exhaustion, and subsequent step-up signing. Seven focused owner-scope
and authorization tests, the SDK build, and Wallet type-check also pass.

Both packages are prepared as `0.5.25` in
[Wallet PR 7](https://github.com/seams-tech/seams-wallet/pull/7). This version has
not been published or deployed. Release CI and deployed comparison remain open;
the local lifecycle results do not establish the production latency target.

Reuse the [durable presignature cache](./refactor-126-durable-presignature-cache.md),
[login prefill](../packages/wallet/src/core/signingEngine/session/warmCapabilities/ecdsaLoginPrefill.ts),
pool scheduler, and reusable-session post-sign refill in the
[secp256k1 signer](../packages/wallet/src/core/signingEngine/flows/signEvmFamily/signers/secp256k1.ts).

- Restore valid material as soon as authorized signing material is accessible
  after registration, unlock, or reload. Schedule bounded refill at that point
  and below the existing low-water mark; measure actual start and completion.
- Let immediate signing consume the first available entry. Continue remaining
  refill outside that signature's wait, with foreground priority and bounded
  concurrency. Preserve exact pool identity and atomic cross-tab reservation.
- Record skipped/failed refill reasons and repair demonstrated scheduling,
  expiry, identity, and contention failures. Tune depth or concurrency from
  measured consumption and generation throughput; a larger initial pool alone
  does not establish sustained performance.
- Keep registration success independent of slow NEAR activation and presign
  pool filling. Report registration/unlock time alongside signing time so
  earlier preparation cannot hide a longer preceding wait.

**Exit:** authorized cache hits perform zero generation rounds, restoration
works across reload, and sustained signing validates refill throughput beyond
the initial pool. Immediate signing is tested without a warmup delay.

#### 4.5 Five-entry durable pools with session-authorized refill

The revised plan is [refactor-128](./refactor-128.md). The user selected the
simpler policy: retain reusable material for 90 days, restore and fill each exact
client pool to five while the client can execute with a valid session, and refill
after every consumption. This supersedes the separate long-lived preprocessing
credential proposal.

Decouple preprocessing from transaction signing quota. A live, unrevoked,
correctly scoped session may refill at zero remaining signing uses. Preprocessing
must not consume those uses. Preserve signing quota enforcement, session expiry,
authority revocation, active material checks, and exact-operation restrictions.
This requires both client eligibility and server pool-fill admission changes;
removing only the client minimum-use guard is insufficient.

Implementation checkpoints:

- [x] Draft coordinated 90-day retention limits in the client, TypeScript server,
  and Rust SigningWorker, preserving short ceremony and exact-operation limits.
- [x] Validate retention with 200 Wallet unit tests, Wallet/server type checks,
  state type fixtures, SDK build, and five focused Rust expiry tests. The completed
  refactor-128 implementation passes all 208 Wallet unit tests. IndexedDB
  coverage reopens a connection with a 30-day-old encrypted entry; it is not a
  production elapsed-time measurement. Changes remain unreleased in draft PR #11.
- [x] Separate preprocessing admission from signing-use quota while retaining
  live session and material authorization; cover zero-use and rejection cases.
- [x] Align capacity, login policy, and post-consumption refill at five entries.
- [x] Reconcile on startup/resume and consumption; continue bounded partial fills
  and transient retries while eligible, without blocking registration or unlock.
- [ ] Verify persisted cache hits and sustained production signing, including
  refill after the final signing use and rejection after session expiry.

Completed material survives ordinary session expiry under its own retention
policy. Explicit logout/reset and material-retirement cleanup retain their
existing semantics. Refill stops when the client cannot execute or its session
expires or is revoked. A returning user still needs fresh signing authorization.

#### 4.6 Validate the complete production path and release incrementally

Deploy 4.1 first, evaluate 4.2 next, then compare 4.3. Improve authorized refill
using 4.4 with its own before/after measurement. Implement the revised 4.5 inventory and admission policy
with its own authorization coverage and cache-hit measurements. Wallet owns SDK/server/Rust changes;
monorepo consumes exact package releases and owns placement and hosted rollout.

- Test Tempo and Arc independently: immediate first use, cached signing,
  empty/expired pools, reload, cold runtimes, concurrent tabs, and sustained
  signing after both the initial pool and reusable allowance are exhausted.
  Reproduce the observed expired-session failure and verify the supported
  reauthentication path instead of excluding it from reliability results.
- Run focused pool coordination, restoration, expiry, and durable-reservation
  tests; relevant Rust checks and type fixtures; and the intended-behavior
  registration, unlock, and sustained Tempo/Arc contracts for shared changes.
  Include cancellation, replay, material replacement, and mid-ceremony revocation.
- Publish sample counts, failures, retries, p50/p95, generation rounds, cache
  depth, and refill throughput with release IDs and client geography. Compare
  equivalent cohorts; small diagnostic samples remain exploratory evidence.
- Enforce **p95 ≤ 3 seconds from authentication completion to signed transaction
  ready for every acceptance cohort**, including foreground generation,
  preparation, queueing, prepare/finalize, and assembly. Existing cached times
  near 2.5 seconds leave little generation budget; continue Phase 3 work on
  prepare/finalize as needed. Keep human authentication and chain confirmation
  separately visible.

If attributed generation still cannot fit the total budget, benchmark the
dominant role on a persistent native service using the same protocol and
authorization. Compare its compute and transport costs before proposing a
deployment change. Keep role separation and client/server custody intact.

**Exit:** deployed hit and miss cohorts meet the target with sustained refill
and unchanged single-use and authorization guarantees. Mainnet availability
remains a separate prerequisite for mainnet acceptance; production testnet
results must be labeled accordingly.

### Ed25519

Design a separate one-use nonce-commitment pool. The
[current signing implementation](../packages/wallet/src/core/signingEngine/flows/signNear/shared/ed25519YaoNormalSigning.ts)
performs prepare followed by finalize. A populated pool could remove the
prepare round trip from the online signing exchange.

Keep transaction authorization at signing time. Bind entries to exact signing
material and enforce atomic consumption, cancellation handling, and nonce
non-reuse. This is a protocol-state change and requires its own review and
targeted verification. The
[FROST specification](https://www.rfc-editor.org/rfc/rfc9591.html#section-5.1)
separates commitment generation from message signing and requires one-use
nonces.

**Exit:** Ed25519 pool hits save one client round trip without weakening
consumption or authorization guarantees.

## Phase 5: optimize the remaining Yao cost

After the surrounding latency is attributed, profile garbling, evaluation,
framing, allocations, and WASM copies. Benchmark chunk sizes and the
[production WebSocket transport](../crates/router-ab-cloudflare/src/ed25519_yao_websocket.rs)
against equivalent streaming transport with the same protocol checks.

Pursue circuit changes or offline preprocessing when measurements justify
them. Preserve canonical Ed25519 identity, recovery/export behavior, and
recipient separation. Any preprocessing must retain fresh, one-use protocol
state. Update vectors and verification with any protocol change.

If startup or compute still dominates the target p95, benchmark persistent
native Rust role services as an architectural alternative, preserving the
existing role and custody boundaries.

**Exit:** deployed registration improvement with unchanged cryptographic and
lifecycle invariants.

## Follow-up: request-local authentication overhead (2026-09-20)

The deployed gateway JOIN change is recorded in the measurement report in
[PR #8](https://github.com/seams-tech/seams-wallet/pull/8). Its settled-session
sample measured cached Tempo signing at a 2.11-second median and foreground
step-up signing at a 7.50-second median. Foreground presignature generation
itself took 5.15 seconds. These are small diagnostic cohorts, not production p95.

Implemented in the next server patch:

- Read the fresh authority and auth-method records concurrently after resolving
  a reusable or exhausted operation credential. Existing validation remains.
- Reuse the active material returned by exhausted-session authentication in the
  same presign request. There is no intervening asynchronous operation before
  reuse. Each subsequent init/step request still authenticates and resolves
  material again; key handle, relayer, participant, activation, and atomic
  exact-operation admission checks remain.
- Promote the remaining rounds of an in-flight background ceremony while a
  signer is waiting for that pool. Passive readiness observers and signers
  already using cached material do not promote background work. The client
  retains the same ceremony and authorization; each round still passes through
  the existing gateway checks. A request already queued at the gateway cannot
  be reprioritized by this client change.

The previous cohort attributed 68 ms per ceremony to the duplicate material
read, so this is an incremental reduction. No deployed improvement is claimed
for this patch until it is released and measured.

Verification: server type-check and build, Wallet SDK build, and all 198 Wallet
unit tests passed across the initial run and an infrastructure-only rerun.
The new regression covers one material read per exhausted-session request,
replacement/retirement between requests, and mandatory exact-operation lookup.
The initial worktree lacked generated WASM and browser assets; restoring the
matching WASM artifacts and building the SDK resolved those setup failures.

Remaining work, in order:

1. Credential consolidation is implemented in the follow-up to PR #9. Exact
   ECDSA operation authentication now performs one live credential lookup for
   either quota state and returns the validated material. Reusable signing
   retains its positive-quota requirement. Both paths share the same persistence
   parser for live provenance, expiry, retirement, and record agreement; exact
   operation reads also validate quota identity and lifecycle consistency.
   Recovery's existing exhausted-candidate interface remains unchanged.
   Server type-check/build, type fixtures, and all 199 unit tests pass. Release
   and production measurement remain pending.
2. Reproduce the immediate-unlock failure seen in production. Two further
   production 0.5.25 attempts on September 20 succeeded: total commit latency
   9.057 s / 6.160 s, including background-generation waits of 6.430 s / 3.578 s.
   The second observed a failed background generation followed by an available
   replacement; transaction signing succeeded. These samples do not establish
   the cause of the earlier HTTP 503, and no readiness fix is claimed.
   Determine whether
   signing races installation of the replacement session or another authority
   transition. Add a lifecycle regression before changing readiness; use an
   explicit state transition rather than a fixed delay. Registration success
   must continue to allow pending NEAR activation.
3. Benchmark a persistent presign transport against the current eight HTTP
   requests using equivalent clients, regions, and session state. Separate
   browser/network time, gateway authentication, service-binding/DO transit,
   and protocol CPU. Preserve custody boundaries and fresh authorization
   requirements; a persistent connection does not grant durable authority.
4. Release the validated server changes and repeat first-use, immediate-unlock,
   rapid repeated, paced, and expired/exhausted-session cohorts. Record failures
   as well as successful timings. Measure Arc when the test wallet is funded.
5. Resolve the separate presignature-only permission proposal before changing
   refill authority after reusable signing quota reaches zero. Existing
   authority remains the implemented policy.

The coordinated package release candidate was **0.5.26**. Publication, deployment,
and post-release measurements are recorded in the following section.
The priority regression verifies a background init followed by a foreground
step under the same session and authorization, with no duplicate ceremony.
The combined candidate passes all 200 Wallet unit tests, Wallet type-checking,
and the SDK build; server checks and type fixtures passed for the unchanged
server portion. The production results below supersede the pending-measurement status.

## Deployed 0.5.26 results (2026-09-20)

Both Wallet packages were published from `a2900753fbf4651078c6c36767224151e90b7f0d`.
Private PR #30 merged as `2c576d60401fb3082e6fd742ee0ce84d98869932`.
[Frontend deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/35502825879)
and [testnet backend deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/35502827351)
passed, including smoke tests. Mainnet and testnet wallet asset manifests report
0.5.26. Mainnet backend activation remains blocked by the existing billing policy;
these signing measurements use the production-hosted testnet service.

The benchmark ran from Japan with Chromium, a virtual passkey, real MPC and chain
requests, and no response interception. The previous browser's passkey unlock
timed out, so a fresh isolated test wallet was registered and funded with testnet
tokens. Account identity and measurement time differ from the previous cohort.
These small diagnostic samples establish neither p95 nor a causal release gain.
Signing timings below use `commit_total`, excluding user interaction and chain
finality. The first failed harness attempts are excluded: they did not collect
usable signing timings. A further diagnostic attempt did not return a completed
result and was stopped; it is also excluded from latency statistics.

| Case | Samples | 0.5.26 observed signing time |
| --- | ---: | --- |
| Rapid-repeat transactions | 10 successful | 2.412–7.654 s |
| Immediate first signing after unlock, within that batch | 1 successful | 6.020 s; 3.654 s waiting for background generation |
| Empty-pool exact-operation step-up, batch samples 5–10 | 6 successful | median 7.413 s |
| Foreground generation, batch samples 2 and 5–10 | 7 | median 5.065 s |
| Paced transactions, 12-second preparation interval | 4 successful | 1.9995, 1.7949, 2.4836, 2.5470 s; median 2.242 s |

The paced cohort includes three reusable-session transactions and one exact-operation
step-up. All four used available presignatures. The previous diagnostic medians
were 7.499 s for empty-pool step-up and 5.150 s for foreground generation. The
small observed difference does not establish a material latency improvement.
The 1–3-second target is achieved in this cached cohort and remains unmet when
new preprocessing is required during signing.

For the six empty-pool exact-operation samples, each ceremony made eight HTTP
requests. The following are medians of per-ceremony sums. Spans are nested and
must not be added together as independent costs.

| Span | Median per ceremony |
| --- | ---: |
| Browser request start to response headers | 4.683 s |
| Gateway total | 3.329 s |
| Gateway service binding | 0.154 s |
| SDK presign route total | 3.166 s |
| Authentication | 1.010 s |
| Separate gateway material read | 0.000 s |
| Admission | 0.239 s |
| Worker proxy | 1.949 s |
| Signing worker total, inside proxy | 0.997 s |
| Worker session handling, inside worker total | 0.817 s |
| Foreground priority queue | 0.000 s |

The duplicate material-read span is removed as intended. Authentication remains
about one second across eight rounds; fresh authorization and storage work still
matter. Browser-to-gateway and gateway-to-worker transit also remain substantial.
Foreground scheduling was not the limiting factor in these samples.

The first signing sample observed one failed background generation followed by
a successful generation whose later rounds carried foreground priority. Seven
round events were foreground and one was background. This confirms promotion
on the measured path; it does not establish multi-user fairness. Background
pool-fill HTTP 503 responses were also observed. Successful transactions do not
close the earlier unlock/session failure investigation. Deployment-discovery
HTTP 503 responses were captured separately; their cause was not established by
the timing-only recorder.

### Returning after weeks of inactivity

The product requirement includes the first signature after days or weeks away,
using the same browser and unchanged key activation. The initial 24-hour cache
cap does not satisfy that requirement. A returning user with an unused retained
entry should use the cached signing path after fresh authentication; unlock must
not conceal presign generation by waiting for it.

Evaluate a 90-day retention policy for reusable completed material. This is a
proposal pending the focused retention review described in refactor-126, not a
change to current policy. Review both encrypted halves, actual activation expiry,
server cleanup, backups, and replay barriers before changing the coordinated
client/server limits. Preserve single-use claims and immediate invalidation on
retirement or revocation. Operation-scoped material remains operation-scoped.

Verify durable admission and restoration across page/worker restarts first, then
test equivalent clock advances of 1, 7, 30 and 90 days with a new authorized
Wallet Session. Below the selected expiry, an available retained entry must
produce zero presign-generation requests. Test the exact expiry boundary and
invalidation separately. Confirm real production reload restoration as well as
controlled-clock lifecycle behavior before claiming multi-week readiness.

Retention alone cannot protect a user who leaves with an empty pool. Replenish
promptly after consumption within current authority, and resolve the separate
presign-only authority proposal before promising replenishment after signing
quota exhaustion. Browser closure cannot guarantee completion of in-flight
generation. Track durable available depth and refill failure reasons so the
returning-user acceptance case can distinguish expiry, depletion, persistence
failure and activation replacement.

Next implementation priorities:

1. Preserve the cached-signing path and measure pool depth against consumption
   rate. A 12-second preparation interval succeeded in these samples, but sustained
   rapid signing still exhausts the pool. Resolve presignature-only authority as
   a separate policy decision before changing generation after reusable quota
   exhaustion; current authority remains unchanged.
2. Diagnose failed refill requests by their response code and authority transition.
   Distinguish an expected exhausted-quota rejection from an unlock race before
   changing readiness or retries. Preserve registration success while NEAR is pending.
3. Benchmark transport and placement against this eight-request baseline. Measure
   browser-to-gateway transit, gateway-to-worker transit, session storage and
   authentication separately. Keep fresh authorization and custody boundaries;
   persistent transport alone cannot remove storage or protocol dependencies.
4. Exercise multiple independent wallets concurrently and check foreground latency,
   background progress, and ownership isolation. The current per-instance gate has
   no tenant fairness guarantee. Add scheduling complexity only for demonstrated
   contention; existing presignatures must never be reassigned across owners.
5. Repeat Arc measurements after test funding is available, then collect larger
   geographically representative cohorts before claiming the target as an SLO.

Raw allowlisted traces, summaries, attribution and release metadata are retained
under the private monorepo's ignored `output/playwright/optimization-10-0.5.26-*`
artifacts. Public documentation intentionally contains aggregate measurements.

## Deployed 0.5.27 acceptance check (2026-09-21 JST)

Both public packages were published as `0.5.27` from
`1740d3aefe31122844a20c208a1fbd195391193f` in
[release run 35522750356](https://github.com/seams-tech/seams-wallet/actions/runs/35522750356).
Monorepo PR #31 merged as `ae633197a3225c98c2caf04b6a7438dbd21f7096`.
[Frontend deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/35525989475)
and [testnet backend deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/35525988159)
passed, including smoke checks. Both `sign.seams.sh` and `test.sign.seams.sh`
returned asset manifest version `0.5.27`. Mainnet backend rollout remains blocked
by billing; these measurements use the production-hosted testnet service.

A bounded check reused the existing funded Tempo test wallet in Chromium from
Japan. No signing requests or responses were intercepted. Three consecutive
signatures succeeded with cached presignatures; `commit_total` was **2.2705,
1.5145, and 1.3696 seconds** (median **1.5145 seconds**), excluding user interaction
and chain confirmation. The first selection reported four entries remaining,
consistent with a five-entry available pool. Background generation continued
while signing and completed another reusable-session ceremony after the third
signature exhausted its signing allowance.

The fourth attempt failed during fresh authorization before signature creation.
Diagnostics reported `wallet_session_reauthorization_required` and
`wallet_signing_budget_exhausted`, with retry blocked because an auth prompt had
already started. No HTTP failure was captured for that attempt. The original
virtual passkey's availability after browser restoration was not established;
the cause remains unclassified between harness authentication and application
behavior. Preserve this failed attempt separately from the three successful
latency samples. This run does not establish successful post-quota signing.

A read-only probe of the wallet iframe's IndexedDB presignature store after the
failed attempt found zero records. This does not establish when or why entries
were absent. Cached in-memory signing is proven; durable return-after-reload and
multi-week readiness are **not accepted** by this production check. Local encrypted
30-day restore, capacity, one-use, and sustained-signing contracts passed before
release, but they do not replace this missing hosted evidence.

Remaining focused follow-up: reproduce fresh step-up with a known available test
passkey; observe durable admission and cleanup before and after quota exhaustion;
then verify an unused retained entry survives reload and signs without generation
on the critical path. Arc and geographically representative p95 remain unmeasured.
The three successful samples meet the 1–3-second target and do not establish an
SLO or a controlled causal improvement over 0.5.26.

Sanitized measurement artifacts are retained in the private monorepo's ignored
`output/playwright/optimization-10-0.5.27-*` files.

## Execution order

1. Capture the recurring production Tempo/ArcEVM delay, compare equivalent
   local runs, and record the NEAR registration baseline in Phase 1.
2. Prioritize the measured shared ECDSA bottleneck using Phase 3 and the ECDSA
   sequence in Phase 4: repeated reads and timings → session placement →
   persistent transport benchmark → authorized refill timing → explicit
   preprocessing-permission decision. Validate the 1–3-second experience for
   sustained subsequent signing, first-use signing, and cold conditions in
   production after each deployed change.
3. Shorten background NEAR activation in Phase 2 while preserving prompt
   ECDSA-ready registration success.
4. Pursue the Ed25519 pool and remaining Yao work according to the attributed
   latency. The ECDSA fix can proceed independently of these protocol changes.

## Ownership and verification

Most implementation belongs in `seams-wallet`: the SDK, server, Rust/WASM
roles, public lifecycle specification, and contract tests.

`seams-monorepo` owns hosted deployment configuration, exact package upgrades,
and composed product benchmarks. Consume released Wallet packages there.

Each phase includes focused verification. Lifecycle and protocol changes also
require interruption/retry, reload, concurrency, and relevant vector/type
checks. Update the intended-behavior specification and its contract tests in
the same change set as the readiness change.

Classify failing tests against the intended behavior before repairing
them. Retain valid persistence and cryptographic invariants, and retire tests
that encode retired behavior. ECDSA-ready success with pending NEAR remains a
supported behavior.

Use the narrowest relevant checks during implementation, then run the broader
lifecycle and protocol verification required by shared behavior changes.
Compare deployed results against the same workload and release metadata used
for the baseline.


## 0.5.28 durable-pool correction and fresh authorization acceptance

The 0.5.27 persistence gap has two identified causes: comparing capability-instance
and MPC capability identifiers during admission, and connecting the durable-store
worker channel only during generation. The follow-up corrects both; see
[refactor-128.md](refactor-128.md#durable-restoration-follow-up-0528).

A fresh virtual-passkey wallet on hosted testnet verified authorization separately
from persistence. After funding's `setUserToken` confirmation, six Tempo signatures
completed in 1.50–1.74 seconds. A subsequent run completed 24/24 signatures with
`operation_step_up` authorization and available cached presignatures; each sent a
successful operation-step-up request. Their commit-total durations were
1.245–1.995 seconds, median 1.639 seconds. Background generation continued.
These are a single-browser smoke cohort on 0.5.27, not a population latency SLO
or evidence of durable restoration. The prior fresh-wallet funding timeout came
from an unhandled funding transaction confirmation in the benchmark workflow.

Allowlisted local measurement artifact: `output/playwright/opt27-exhaust-quota.txt`
in the private monorepo (ignored, no raw credentials).

Wallet and Wallet Server 0.5.28 were published from
`d0e4c263fb711b6cc2c6e9b4e9025ce68110acbd` in
[release run 35533982117](https://github.com/seams-tech/seams-wallet/actions/runs/35533982117).
Monorepo PR #32 merged as `6454e5a800168b62a37aca7c2692f182ff58c2d3`.
[Frontend deployment 35540453218](https://github.com/seams-tech/seams-monorepo/actions/runs/35540453218)
passed, and both `sign.seams.sh` and `test.sign.seams.sh` returned manifest version
0.5.28.

A new funded virtual-passkey wallet on the production-hosted testnet service reached
five durable entries, each carrying approximately 90-day expiry. Five hashed record
identifiers were unchanged across a page reload. The first post-reload Tempo sign
selected an available `reusable_wallet_session` presignature with four entries
remaining. It made no foreground presign-generation request and completed
`commit_total` in **1.365 seconds**. Background refill then returned the pool to five:
the selected entry's fingerprint disappeared and a new fingerprint appeared. This
proves hosted persistence across reload, atomic one-use consumption, and refill for
the tested browser profile. It does not simulate 90 days of elapsed wall time or
establish a population p95.

The first attempt of the coordinated
[testnet backend workflow 35540454569](https://github.com/seams-tech/seams-monorepo/actions/runs/35540454569)
built successfully, but GitHub refused to start the migration job because the
private repository's Actions billing was blocked. The hosted reload acceptance
therefore initially used the new frontend with the previous testnet backend. After
temporarily making the repository public, attempt 2 of the same workflow applied
the migration and deployed every backend role. Gateway smoke checks and ephemeral
cache cleanup passed. The repository returned to private after completion. Mainnet
backend rollout remains separately billing-blocked.

## Deployed 0.5.29–0.5.30 registration refill check (2026-09-22)

Wallet 0.5.29 exposed a registration refill failure on the production-hosted
testnet service: a fresh wallet retained only three of its intended five ECDSA
presignatures. The three successful ceremonies took **9.772, 11.033, and 6.933
seconds**. The 30-second `refillAttemptTimeoutMs` covered the entire sequential
batch, leaving the fourth ceremony with an almost-expired deadline. The
[0.5.30 correction](https://github.com/seams-tech/seams-wallet/pull/20) gives
each entry a fresh, bounded attempt window capped by authenticated session
expiry. It does not change the five-entry target, authorization, or one-use
consumption policy.

Both Wallet packages were published as 0.5.30 from
`4362356dffcd2ed5b2683e757ff679f514cddb29` in
[release run 35625446070](https://github.com/seams-tech/seams-wallet/actions/runs/35625446070).
Monorepo PR #34 merged as `c84397813bf1458195984ae4cf443321e28ee1d3`.
[Frontend deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/35681750563)
and the [coordinated testnet backend deployment](https://github.com/seams-tech/seams-monorepo/actions/runs/35681756231)
passed, including frontend and gateway smoke checks. Both hosted wallet asset
manifests report 0.5.30. Mainnet backend deployment remains a separate billing
blocker; this check uses testnet services hosted in production.

One fresh Chromium virtual-passkey wallet was registered from Japan without
request or response interception. The registration UI was ready **10.49 seconds**
after starting; the first durable entry appeared at **16.36 seconds**, so pool
completion did not hold registration success. All five ceremonies succeeded,
with durations **6.009, 5.538, 5.827, 5.800, and 5.406 seconds** (median **5.800
seconds**), and the durable pool reached **5/5**. All 40 observed fill requests
returned HTTP 200. Across those requests, median `ecdsa_presign_sw_do_total`
was **0 ms**, `ecdsa_presign_sw_session` was **23 ms**, and
`ecdsa_presign_proxy` was **184 ms**. Summed browser request-start-to-response
spans for each eight-request ceremony were **4.677–5.566 seconds**; these spans
include server computation, storage, scheduling, and network transit. The zero
object-handler timing cannot rule out CPU cost: deployed Cloudflare application
timers advance across I/O and remain frozen during CPU-only work. Use
[runtime CPU telemetry and profiling](https://developers.cloudflare.com/workers/runtime-apis/performance/)
to separate those costs before attributing the remaining wait to transport.

All five hashed record fingerprints remained unchanged after reload, with stored
expiry metadata approximately 90 days away. The first post-reload Tempo funding
signature consumed one saved presignature, made **zero foreground fill requests**,
and completed `commit_total` in **2.192 seconds**. The consumed entry was absent
after signing and background refill restored the pool to five with a new entry.
This checks hosted persistence, one-use consumption, and refill for one browser
profile. It does not prove 90 days of wall-clock survival, population p95, Arc
signing, or the 1–3-second target for empty-pool foreground generation.

Allowlisted local measurements are retained under the private monorepo's ignored
`output/playwright/presign-registration-attribution-0.5.30.*` and
`output/playwright/durable-reload-acceptance-0.5.30.*` artifacts. The remaining
performance task is to measure representative first-use and empty-pool cohorts,
then benchmark a lower-round-trip presign transport against the current eight
dependent requests per entry without changing custody or authorization.

### Immediate registration-to-sign comparison on 0.5.30

The public intended-behavior harness completed three local, fresh-passkey Tempo
registration-to-sign runs. Registration took **2.746–2.761 seconds**; the first
signature took **0.673–0.687 seconds** afterward. Two further local runs inspected
the durable pool at registration return: both already had **one** presignature,
and the first signature took **0.682–0.683 seconds**. These local runs exercise the
real Wallet SDK and managed local workers, but stub external chain edges. They
measure the cached path; they do not measure local foreground generation.

To isolate the miss path, the harness held the background presign-init request
until registration returned, verified pool depth **0**, then released it and
signed immediately. Two local runs took **0.681** and **0.700 seconds** from
registration return to completed Tempo signature (registration **2.707** and
**2.748 seconds**). This includes local presign generation and signing, and
passes the signature contract. The hold is a benchmark control, not product
behavior.

In two additional controlled local runs, delaying each presign step request by
**100 ms** or **250 ms** increased the empty-pool first-sign time to **1.454**
or **3.017 seconds**, respectively, from an undelayed **0.681–0.700 seconds**.
These are single-run injected-latency diagnostics, not a fitted network model.
They confirm that the dependent step exchanges materially amplify per-request
latency. The benchmark-only request interception was removed after measurement.
The existing native Rust `local_lifecycle_timing` example, run in release mode
for 25 iterations on the same machine, reported **34.202 ms** median for both
presign roles together (including **33.603 ms** for triples). Native CPU timing
is a useful floor; it does not represent deployed Worker/WASM CPU time.

One fresh hosted-testnet virtual-passkey run from Japan measured registration
ready at **9.437 seconds** with **zero** durable presignatures. Signing immediately
after registration completed **10.205 seconds** later. The signing trace reported
**5.301 seconds** waiting for a presignature, **2.284 seconds** in prepare, and
**0.983 seconds** in finalize (`commit_total`: **9.084 seconds**). The first
presignature completed roughly **6.6 seconds** after background generation began.
The ceremony made eight successful dependent HTTP requests whose browser spans
totaled **5.506 seconds**; one preceding request returned HTTP 401 and took
**0.331 seconds**. The eight successful responses reported **0.846 seconds** of
authentication and **2.222 seconds** of proxy timing in aggregate. Those server
spans overlap with downstream work and must not be added to the browser spans.
The cryptographic signature completed; this fresh test wallet's chain funding
was not established by this sample.

The local and hosted product environments differ, so these are diagnostic
samples rather than an equivalent-cohort latency claim. They do establish why
local development missed the immediate-sign delay: local foreground generation
and signing also finish in about **0.7 seconds** with an empty pool, whereas the
hosted first signature waited **5.3 seconds** for its first entry. Registration
prefill was already running before the hosted UI reported success; it had only
about **0.7 seconds** of overlap by then. The registration path schedules
prefill immediately after the exact ECDSA session and capability become
durable. Further movement before that boundary would require a different
authority design.

Next, benchmark the same empty-pool path locally and hosted, including per-round
browser spans, server CPU telemetry, and prepare/finalize timings. Compare a
persistent authenticated transport or fewer protocol exchanges against the
eight-request baseline. Keep every message bound to the live authorization and
the same one-use presign session. The 1–3-second immediate-sign target is not
met by the current hosted empty-pool path; record a before/after cohort before
claiming an optimization.

### Hosted presign transit and preflight follow-up

A second fresh 0.5.30 testnet registration reached five durable entries. Its
five generation ceremonies took **6.612, 5.402, 4.855, 4.967, and 5.213
seconds**. Read-only signing-worker tail telemetry counted eight session-object
calls per ceremony, with **154–214 ms** of Durable Object CPU per ceremony.
Browser spans totaled **4.355–5.433 seconds** per ceremony. Gateway
authentication totaled **0.794–1.057 seconds**, and its signing-worker proxy
totaled **1.855–2.283 seconds**. These nested spans and one browser profile
cannot establish a population percentile. The earlier `do_total` wall timer
read 0–1 ms because Cloudflare application clocks can pause during CPU work;
the runtime CPU telemetry is the relevant measurement.

The hosted API's CORS preflight response omitted `Access-Control-Max-Age`.
In a browser probe against the same testnet route with an invalid credential,
the first request to a fresh URL incurred an OPTIONS request and took **614
ms**; a repeated request to that URL, with preflight cached, took **149 ms**.
Another fresh URL took **619 ms**. After six seconds, the browser sent another
OPTIONS request for the same URL. These probes isolate preflight behavior;
their timings do not measure an authorized MPC ceremony.

The router now advertises a **600-second** preflight cache lifetime for an
allowed origin. It continues checking the current allowed-origin list on each
actual response, and each presign message still receives fresh authorization.
Measure the deployed change before attributing any reduction in full
generation time. The remaining larger costs are the dependent browser,
authorization, and worker/object exchanges, followed by signing prepare and
finalize when the pool is empty.


### Six-exchange owner presigning (implementation, deployment pending)

The owner pool-fill path now carries a client-generated, 256-bit random ceremony
identity and its first protocol message in initialization. The identity includes
its immutable expiry and participates in the existing cryptographic context.
Both participants advance directly from completed triples into presigning while
processing the same message batch. This removes two scheduling-only exchanges:
**eight → seven → six**, with one initialization followed by five HTTP steps.
The completion response carries the server's remaining protocol message so the
client can finish without another request.

Every exchange still performs live authorization. The server requires the exact
scope and authorized deadlines, atomically persists an initialization claim before
emitting messages, and rejects reinitialization after failure, completion, or
Durable Object eviction. An alarm clears the claim after the identity's encoded
expiry; expired identities remain invalid. Lost responses restart with a fresh
identity instead of reusing a partially completed ceremony. Role custody and
presignature single-use rules are unchanged.

Local evidence so far: 25 deterministic seed cases produce byte-identical message
transcripts and presignature outputs for the 8/7/6 schedules. The actual Rust
server adapter completes in six exchanges with matching client/server R points.
The adapter test caught a production regression in the initial implementation:
the old completion response discarded the final server message. The response
now delivers it, and the regression test passes. Pool coordination tests passed
12/12. The authorization fixture required the new initialization fields
(`valid_test_needs_update`); its five focused tests passed after the update.
Validation completed locally: full workspace type-check, WASM and SDK builds,
all **230 unit tests**, and both representative lifecycle contracts. The
registration/reload contract (39.7s for the entire test) asserts six HTTP
exchanges per completed ceremony, replay rejection, and persisted signing after
reload. Sustained Tempo/Arc signing (about 1.1 minutes for the entire test)
retains 20 distinct signatures, quota exhaustion, forced empty-pool step-up, and
key/expiry rejection. These whole-test durations are not signing latency samples.

The focused real-workerd test also passes:
`node crates/router-ab-cloudflare/scripts/test-private-d1.mjs --ecdsa-presign`.
It completes six exchanges, evicts the session Durable Object, rejects replayed
initialization after eviction, and rejects changing the identity's expiry.
The broader private-D1 suite failed twice before presigning in its Yao package
delivery fixture with `Network connection lost`
(`environment_or_infrastructure_failure`); that unrelated failure remains visible.

The implementation and version **0.5.32** are staged together for one review/CI
cycle. No deployment or hosted latency improvement is claimed yet; coordinated
client/server deployment and an equivalent empty-pool timing cohort remain.
Two fewer HTTP exchanges do not establish a 25% reduction in end-to-end latency;
measure equivalent empty-pool cohorts after coordinated deployment.

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

Status: steps 4.1 and 4.4 have local implementation; production comparison and
the remaining decision gates are open. Production generation still takes
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

#### 4.1 Instrument and consolidate repeated authorization reads

Implementation update: the local patch removes the duplicate material lookup
from step-up pool-fill admission. The remaining fresh lookup and atomic
material/operation admission still run on each request. Gateway `Server-Timing`
now separates queueing, authentication, material resolution, admission, proxy,
and total duration. Signing-worker metrics separate initial material loading,
the session-object call, terminal pool admission, and total duration. A shared
allowlist forwards only finite, nonnegative durations to client diagnostics.
Presign session IDs correlate these timings with the existing round trace.

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

#### 4.5 Resolve preprocessing permission after the reusable allowance expires

The present operation-step-up branch permits preparation for that operation
and omits post-sign refill. Keep that behavior while implementing 4.1–4.4.
Do not increase the signing allowance or infer future-operation authority
from a successful signature.

Write a bounded design for a separate preprocessing permission if sustained
step-up latency still requires advance generation. Specify who grants it,
its exact wallet/material binding, lifetime, generation/storage limits,
revocation and logout behavior, and which client material must remain unlocked.
Preprocessing permission must authorize no transaction signatures or exports;
every signature still requires its existing exact-operation or reusable-session
admission. Reuse the existing pool and one-use consumption model.

**Decision gate:** settle the authorization policy explicitly and update the
intended-behavior specification before implementing this permission. If adopted,
use distinct domain types and negative tests proving it cannot authorize
signing, export, another wallet, another activation, or generation after expiry
or revocation. If deferred, exhausted-pool step-up remains a required acceptance
cohort under the existing policy.

Proposed permission contract for that decision (design only):

| Property | Proposed bound |
| --- | --- |
| Issuer | The existing authorization service, only after a full registration or unlock authentication that includes this capability in the authorized policy. A transaction step-up cannot mint or renew it. |
| Scope | One tenant/environment, wallet, selected authority and auth method, exact material activation, signing worker, and presign pool identity. |
| Operation | A separate `ecdsa.presign` permission accepted only by preprocessing admission. It never satisfies signing, export, device linking, or recovery admission. |
| Lifetime | At most 10 minutes and never beyond the authorizing Wallet Session's expiry. Signing allowance exhaustion may leave this permission alive; expiry, replacement, revocation, or logout do not. |
| Initial limits | At most three available entries, one generation in flight, and twelve generated entries per grant. Enforce limits atomically server-side across tabs; measure throughput before revising them. |
| Client custody | Require an unlocked client and its existing local role-specific material. Stop background work on lock; do not move the client share to a service or retain an extra secret copy for refill. |
| Revocation | Bind the authority epoch and material activation. Revalidate on every admitted continuation and before publishing the result. Lock/logout cancel local work; revoke the grant and invalidate its unused entries server-side through the existing lifecycle path. |
| Consumption | Keep the existing exact-operation/reusable-session signing admission and atomic one-use reservation/consumption. Holding a presignature gives no signing authority. |
| Failure | Abort incomplete generation and use a fresh ceremony after uncertain continuation. Bound retries by the same grant generation limit; never recycle consumed or uncertain nonces. |

Implementation remains gated on accepting this contract, adding it to the
intended-behavior specification, and testing permission separation. The current
patch preserves the existing allowance policy. The proposed numbers bound a
first implementation; they are not measured throughput guarantees.

#### 4.6 Validate the complete production path and release incrementally

Deploy 4.1 first, evaluate 4.2 next, then compare 4.3. Improve authorized refill
using 4.4 with its own before/after measurement. Keep the 4.5 policy decision
separate from those optimizations. Wallet owns SDK/server/Rust changes;
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

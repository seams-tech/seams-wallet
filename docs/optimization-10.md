# Optimization 10: registration readiness and MPC signing latency

Status: implementation in progress; production latency target remains unverified.

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

Historical Cloudflare telemetry access returned HTTP 403 with the current login.
Read-only live tails worked but observed only scheduled prewarming during the
45-second sample. Deployment metadata identifies production-testnet gateway
version `f60c22ef-971a-424d-92fd-c7e053395c17` (2026-09-19 05:11 UTC), Router version
`fb7ceae9-445e-428f-8ed0-b7eb9db3c898`, and SigningWorker version
`bc31eb69-bf78-4151-b2ff-44839ebd15f8`. Correlate the wallet-origin SDK release and
an actual slow signing request with these versions before comparing deployments.
Production attribution and the 1–3-second acceptance measurements remain open.
No production deployment or release has been made by this implementation pass.

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

1. Release the SDK and wallet-server changes through the existing release
   pipeline and upgrade the hosted consumers to those exact versions.
2. Capture a slow production Tempo/Arc request with client timings and matching
   gateway/role traces. Compare cache hits against generation misses and record
   authorization branch, placement, deployed versions, failures, and sample counts.
3. Optimize the dominant measured production stage and rerun the full first-use,
   sustained, reload, expiry, and cold-runtime cohorts against the 3-second target.
4. Use the NEAR activation spans to optimize its slow production stages while
   retaining asynchronous registration success. Protocol changes in Phases 4–5
   depend on those measurements.

## Production ECDSA acceptance cases

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

Validate the already implemented
[durable presignature cache](./refactor-126-durable-presignature-cache.md):

- restoration after reload;
- refill timing relative to the first transaction;
- expiry;
- cross-tab contention; and
- cache-miss reasons and foreground waiting.

First confirm the production SDK and backend actually include this cache.
For each repeated signature, record authorization kind, available depth,
cache-hit/miss reason, foreground generation rounds, and refill scheduling and
completion outcomes. The current scheduler can skip refill or end a failed
background attempt without a user-visible error; make those outcomes visible
in the correlated diagnostic trace.

Compare reusable-session and operation-step-up flows. Check whether production
repeatedly uses step-up, where the signer omits post-sign refill, while local
testing uses a reusable session. Check whether material activation or signing
scope changes legitimately select a different pool on each transaction. These
are code-backed hypotheses, and require production evidence before changing
behavior. Preserve exact pool identity and authorization boundaries; any
earlier preprocessing must already be permitted by the active authorization.

Restore available entries as soon as authorized material is accessible and
start bounded refill at the earliest valid lifecycle point. Reuse the existing
refill scheduler and single-use reservation path. An immediate signing request
must be able to proceed when the first usable entry arrives, with subsequent
refill kept off its critical path.

Fix demonstrated misses before adding another caching mechanism. Keep the
existing client/server secret separation and one-use lifecycle.

Measure the empty-pool path as well. Identify the cost of each
generation round, browser/server exchange, and durable write; reduce serial
round trips and startup work where protocol dependencies permit. Background
refill reduces miss frequency, while first-use and exhausted-pool latency still
need to meet the target. If generation cannot fit the remaining budget,
benchmark the dominant role on a persistent native service and document the
remaining protocol cost before selecting the next change. Preserve role
separation and message-bound authorization throughout.

**Exit:** valid ECDSA cache hits perform zero presign-generation rounds, and
immediate first signing and sustained subsequent signing meet the Tempo/ArcEVM
target in both hit and miss cohorts. Measure refill throughput and contention
so the result remains valid after the initial pool has been consumed.
Reload, expiry, and concurrent-tab tests must preserve atomic consumption and
prevent presignature reuse.

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
   portion of Phase 4. Validate the 1–3-second experience for sustained
   subsequent signing, first-use signing, and cold conditions in production.
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

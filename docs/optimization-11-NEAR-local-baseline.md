# NEAR local registration and signing baseline

Measured 2026-09-29: **40 registrations and 80 verified NEAR transaction
signatures passed**, with zero retries. This establishes the local development
baseline for [Optimization 11](./optimization-11-NEAR.md). Network optimization
and hosted measurements remain later work.

Follow-up: the NEAR-only registration result below lacked the session seal needed
for signing after refresh. The [corrected baseline and breakdown](./optimization-11-NEAR-local-breakdown.md)
includes that persistence work. These historical timings remain unchanged and
must not be used as a complete durable-readiness comparison arm.

## Results

Durations are milliseconds. Each row has 20 observations. Median uses the middle
pair's average; p95 uses nearest rank. The small cohorts make p95 descriptive.

| Workload and timing boundary | Median | p95 | Maximum |
| --- | ---: | ---: | ---: |
| NEAR-only public SDK registration → return, NEAR ready | 751.0 | 867.2 | 925.2 |
| Mixed registration public hook → return, ECDSA ready | 761.4 | 787.5 | 796.3 |
| Mixed inner SDK registration → durable NEAR ready | 916.9 | 957.2 | 960.6 |
| NEAR-only first signing, public SDK call | 372.0 | 385.1 | 412.7 |
| NEAR-only warm signing, public SDK call | 363.4 | 384.8 | 386.1 |
| Mixed-wallet first NEAR signing, public SDK call | 371.8 | 376.4 | 377.1 |
| Mixed-wallet warm NEAR signing, public SDK call | 361.9 | 372.3 | 381.9 |

Public-call timings include iframe transport, automated confirmation, and SDK
work through return. Mixed registration uses the existing React registration
hook; NEAR-only registration uses `registration.registerWallet`. The mixed
durable-ready span begins inside the wallet SDK, so it excludes outer hook and
iframe setup. These boundaries are retained separately in the data and must stay
the same in future comparisons. Harness elapsed times include page preparation,
polling, and independent signature verification; they are diagnostic overhead.

All 80 public signing calls were below 2 seconds in this local cohort. This does
not establish a deployed maximum or remove real human time from the measurement.

### Signing breakdown

| Stage, median ms | NEAR-only first | NEAR-only warm | Mixed first | Mixed warm |
| --- | ---: | ---: | ---: | ---: |
| Prepare | 19.3 | 18.8 | 18.5 | 18.9 |
| Browser client share | 3.4 | 1.3 | 3.4 | 1.3 |
| Finalize | 18.2 | 18.9 | 18.1 | 18.3 |
| Complete prepare/share/finalize span | 42.2 | 39.9 | 41.1 | 39.2 |
| Wallet Session authorization span | 3.3 | 3.0 | 3.2 | 2.9 |
| Confirmation completed → signed | 51.4 | 44.9 | 49.9 | 43.9 |

Component medians do not add to the total. Prepare includes its server work and
local transport; it is not a pure cryptographic timing. The roughly 320 ms gap
between SDK elapsed and the core signing span includes automated confirmation
and surrounding orchestration. It is not all removable computation. The current
timers do not isolate the complete pre-confirmation system work from the
automation delay, so retain both public-call and post-confirmation metrics.

### Registration breakdown

The custody Router round measured 265.1 ms median for NEAR-only and 284.7 ms for
mixed wallets. In mixed registration, server finalization measured 63.3 ms and
the remaining hydration span measured 41.4 ms. These spans overlap other work;
they must not be summed to reconstruct readiness. NEAR-only registration currently
emits custody subspans and the new public-call timer, with less granular coverage
than the mixed continuation.

The next local investigation should attribute NEAR-only registration outside the
custody round and separate signing's pre-confirmation preparation from automation
delay. Current measurements provide little justification for a cryptographic
protocol change: the complete local signing exchange is approximately 40 ms.

## Method and provenance

- macOS 15.7.1, arm64; Node 24.18.0; Playwright 1.55.0; Chromium 140.0.7339.16.
- Local Workers with role-private D1 and optimized release WASM. Gateway and five
  role services ran locally. This is a D1 baseline, with no wallet-DO comparison.
- Base revision `c154770091fa37c3d61e695842cec0cb96bff828`, plus the benchmark/test-page
  timing changes and concurrent pending-registration recovery edits captured in
  the frozen source. The measured build is not represented as a clean commit.
- SDK build input hash:
  `bb7a1b07a8d8d3e4c506cafbd73e0c1130c40826b4bbdf5eceaa59e516d21ed8`.
- All five role build stamps identified release D1 builds. A frozen copy retained
  the source and assets; 8,822 file hashes were identical before and after the run.
  Dependency installations were shared with the development checkout.
- One Chromium worker, concurrency one, fresh browser/wallet per sample, one
  persistent local backend, and alternating NEAR-only/mixed ordering for 20 pairs.
  Each wallet made two signatures in its reusable session without another passkey
  prompt. The harness cryptographically verified all returned signatures and
  checked prepare/finalize routing with no Yao registration during signing.
- Virtual WebAuthn, automated confirmation, real Rust/WASM custody and signing,
  stubbed public-chain RPC, and no broadcast/finality. The first sample of each
  kind is retained; it does not constitute a measured runtime cold-start cohort.
- Normal background activity continued on the shared development machine,
  including a repository audit during the run. The snapshot isolates build/source
  changes, not CPU or I/O contention. Run on a quiet machine for small-effect
  comparisons and keep the same diagnostic settings in both arms.

The [sanitized timing data](./optimization-11-NEAR-local-baseline.json) contains all
40 samples, 80 operation breakdowns, aggregates, and build provenance. It excludes
credentials, recovery codes, wallet material, raw requests, and full console logs.

Private execution evidence is retained under
`.artifacts/optimization-11-near/20260929-local/`: `baseline.json`, `baseline.log`,
`summary.json`, `frozen-build-identity.json`, the frozen runtime/source, and the
earlier diagnostic attempts. Treat runtime state and full harness reports as
private. No hosted resources or production deployment were changed.
The interrupted shared-assets cohort is preserved separately in `cohort.json`;
none of its samples were appended to the final frozen cohort.

## Reproduce

Run from the wallet repository on a stable checkout. Build once before measuring;
keep source and artifacts unchanged during the cohort. Existing artifacts may be
reused only after verifying their input identity and release profile. The recorded
run used a frozen copy because another task rebuilt the shared SDK during setup.

```sh
ROUTER_AB_WORKER_BUILD_PROFILE=release pnpm build

near_bench_dir="$PWD/.artifacts/optimization-11-near/$(date +%Y%m%d-%H%M%S)-local"
mkdir -p "$near_bench_dir"

SEAMS_INTENDED_EXTERNAL_GATEWAY=0 \
SEAMS_INTENDED_WALLET_HOST=workers \
SEAMS_INTENDED_SIGNING_SESSION_DEBUG=1 \
SEAMS_INTENDED_SKIP_BUILD=1 \
ROUTER_AB_WORKER_BUILD_PROFILE=release \
SEAMS_LOCAL_PORT_OFFSET=4000 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:8100 \
SEAMS_INTENDED_APP_URL=http://localhost:8201 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:8202 \
SEAMS_INTENDED_ROUTER_AB_ROOT="$near_bench_dir/runtime" \
PLAYWRIGHT_JSON_OUTPUT_FILE="$near_bench_dir/playwright.json" \
pnpm -C tests exec playwright test \
  -c playwright.wallet-intended.benchmark.ci.config.ts \
  e2e/intended-behaviours/near-latency/passkey.registration.benchmark.test.ts \
  --reporter=json --output="$near_bench_dir/results" \
  > "$near_bench_dir/run.log" 2>&1

node tests/scripts/analyze-near-local-latency.mjs \
  "$near_bench_dir/playwright.json" "$near_bench_dir/summary.json"
```

Ports 8100, 8102–8106, 8201–8202 and the role inspector ports must be free.
Leave `ROUTER_AB_WALLET_DO_HARNESS` unset for this D1 baseline. Do not add
`--repeat-each`: the benchmark already defines 40 cases. Setup plus the measured
run took about three minutes using prebuilt artifacts on this machine.

The analyzer retains failed attempts, rejects duplicate samples and incomplete
cohorts, and calculates signing totals per operation. Do not append replacements
to a failed cohort or mix different source/artifact identities. Keep the old
report and start a new run after diagnosis.

## Coverage gaps and diagnostic findings

The initial instrumentation smoke attempts exposed fixture setup and diagnostic
coverage gaps, corrected before the baseline: Playwright fixture discovery through
a bound callback, the harness's file-name convention, missing NEAR-only summary
timing, and the opt-in signing trace setting. They were benchmark setup failures.

A broader smoke scenario also found a NEAR-only post-refresh failure after two
successful signatures: `Ed25519 transaction signing requires an exact selected
lane`. The same scenario passed for a mixed wallet. The specification requires
refresh to re-read exact lane inventory; the harness supplies the wallet/account
and signer slot on reload. This is a candidate production restoration regression
requiring separate diagnosis; this measurement task made no production repair.
Its full evidence remains in `smoke-5.json`. Reproduce the scenario through
`registerPasskeyEd25519YaoWallet`, two `signNearTransaction('post_registration')`
calls, `refreshPagePreservingWalletStorage`, then `signNearTransactionAfterRefresh`.

The final baseline covers registration plus first/warm signing only. It makes no
claim about refresh/unlock, Email OTP, exhausted sessions/step-up, burst load,
NEP-413, real RPC latency, mobile devices, or hosted regional performance.

Verification: 40/40 benchmark cases, 80 signatures independently verified,
intended-suite TypeScript check, formatting, analyzer syntax, unchanged frozen
source/artifact hashes, and the repository bloat check passed.

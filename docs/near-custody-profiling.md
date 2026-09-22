# NEAR custody profiling and earlier client-seal preparation

The local custody slowdown came primarily from an unoptimized signing-worker
artifact. The private-D1 test command built development WASM into the same role
paths used by the release runtime. A subsequent skip-build benchmark consumed
those files. Development builds now write to `build/dev/<role>`; release builds
retain `build/<role>`. The private-D1 runner selects the matching directory.

## Build-profile comparison

Three registrations per profile used the same frozen SDK and demo app. Only the
signing-worker artifact was replaced with a separately compiled release build;
other role artifacts were held fixed. These are small diagnostic samples,
executed consecutively rather than an alternating performance experiment.

| Median, milliseconds | Existing development artifact | Release signing worker |
| --- | ---: | ---: |
| Signing-worker delivery | 373 | 7 |
| Deriver A execution HTTP | 210 | 215 |
| Router Yao execution including delivery | 673 | 316 |
| Browser custody join | 708.8 | 364.6 |

The signing-worker WASM shrank from 27,016,833 bytes to 6,797,038 bytes (approximately 6.5 MiB).
The original role timings put the actual Yao computation near 140 ms. This
investigation changes neither the Yao protocol nor its cryptographic checks.
The delivery span includes request handling, package combination, and persistence;
it is not a pure network measurement.

The earlier five-run browser profile put 672.3 ms of the 697.3 ms custody join in
the router round. Admission, checkpointing, local completion, and journal writes
were individually below 10 ms at the median. New opt-in custody stage timings
make those costs visible in the existing registration benchmark.

[Timing-only diagnostic samples](./near-custody-build-profile-latency.json)

## Earlier preparation

After EVM activation, the continuation can read the exact NEAR session identity
from its retained registration journal. Client-seal preparation starts there,
while custody is still running, and overlaps finalization as well. A resumed
attempt whose journal is already joined starts preparation from joined material.
Readiness still requires successful finalization, hydration, signer installation,
and the current session authority. The existing exact-session ownership,
single-use consumption, expiry, lock cleanup, and zero-quota behavior remain.

The contract test holds NEAR admission or execution, requires preparation to
finish while the request is held, verifies EVM signing, then releases NEAR and
checks readiness and signing. Existing resume contracts cover interrupted work.

## Scope

These measurements use local Workers, a virtual passkey authenticator, and
stubbed public-chain RPCs. NEAR threshold signatures are verified before and
after page refresh. They do not estimate public NEAR confirmation or deployed
regional latency. No deployment, package release, or Console adoption was made.

## Verification

- SDK build and intended-behavior / wallet-state type checks passed.
- Seventeen focused browser contracts passed: held admission/execution, exact
  resume after interrupted requests, joined-material replay, same-tab and cross-tab
  locks, readiness rollback, leading-zero PRF restore, terminal failure, exhausted
  quota, overlapping hydration, and preparation during finalization.
- Five client-seal ownership tests passed, covering consumption, identity/secret
  mismatch, late cleanup, lock/failure cleanup, and expiry.
- Build-script syntax and both profile output paths were checked with a stub
  worker-build executable. The full private-D1 suite was not rerun; its change is
  limited to selecting the development artifact directory.
- An initial copied-runtime package-resolution failure was corrected before the
  successful profile runs. A broader UI run was interrupted because its newer
  custom-review flow did not match the frozen demo snapshot; the focused contracts
  above were run cleanly. No production behavior was changed to accommodate either.

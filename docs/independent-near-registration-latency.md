# Independent NEAR registration: local acceptance measurements

Measured on 2026-09-23. All 40 browser runs passed, including a verified NEAR
signature before and after refresh. Independent registration returned about
247 ms earlier (29%) and reached durable NEAR readiness about 52 ms earlier (5%)
at the median.

## Results

Each cohort contains 20 fresh-wallet registrations. Durations are milliseconds;
p95 uses the nearest-rank definition. Differences below compare cohort medians.

| Milestone | Serialized median | Independent median | Serialized p95 | Independent p95 |
| --- | ---: | ---: | ---: | ---: |
| SDK entry → registration return / EVM availability | 848.5 | 601.0 | 876.0 | 629.0 |
| SDK entry → durable NEAR readiness | 1059.3 | 1007.0 | 1090.1 | 1077.6 |
| Registration return → NEAR readiness | 214.8 | 405.4 | 224.8 | 434.2 |
| Authentication | 211.0 | 214.0 | 233.0 | 258.0 |
| Registration return, excluding authentication | 634.0 | 381.5 | 649.0 | 397.0 |
| NEAR readiness, excluding authentication | 848.3 | 792.2 | 866.7 | 819.6 |

The longer interval after registration return is expected: EVM becomes available
earlier while NEAR continues. Full NEAR readiness also improves. Authentication
is subtracted per sample before calculating its adjusted median; cohort medians
and overlapping spans must not be added together.

The first pair returned at 629 / 849 ms and reached NEAR readiness at
1111.9 / 1056.1 ms, independent / serialized respectively. The independent run
was first against the newly started backend, so these two observations are not
separate cold-start cohorts. Excluding this pair leaves 19 runs per cohort:

| Warmed milestone | Serialized median | Independent median | Serialized p95 | Independent p95 |
| --- | ---: | ---: | ---: | ---: |
| Registration return | 848.0 | 597.0 | 897.0 | 646.0 |
| Durable NEAR readiness | 1059.5 | 1002.3 | 1114.6 | 1077.6 |

With 19 observations, nearest-rank p95 is the maximum. Tail estimates from this
small cohort are descriptive, not a production latency guarantee.

## Where the remaining time goes

Independent-cohort median instrumented spans:

| Span | Duration (ms) |
| --- | ---: |
| Authentication | 214.0 |
| NEAR custody join (includes more than backend Yao execution) | 288.2 |
| Server finalization | 38.9 |
| Passkey session hydration | 142.9 |
| Local authority/material publication | 5.2 |
| Signer activation | 5.1 |
| Durable ready transaction | 1.5 |

Session hydration includes a median 10 ms cryptographic setup, 42 ms client seal,
46.5 ms server-seal route, and 40 ms client unseal. The measured custody-join span
includes admission, checkpoint handling, transport, and client completion; it is
not directly comparable to the earlier approximately 230 ms backend-only number.

The architecture removes NEAR from EVM's critical path. Further full-NEAR savings
should target measured work that still precedes readiness: session-seal computation
and round trips, plus custody-join client/transport overhead. Local publication
and the ready transaction are already small. Profile these spans on the deployed
network before choosing another optimization; preserve exact authorization,
refresh recovery, and atomic readiness when changing their ordering.

## Method and limits

- One Chromium worker, Node 24.18.0, local gateway/real Rust-WASM custody and Yao
  backend, isolated ports 7100/7201/7202. Fresh wallet and browser context per run.
- Twenty pairs alternate order: independent then serialized, followed by
  serialized then independent. Both use the same built SDK, backend, persistence,
  and test confirmation policy. No additional builds or tests were launched by
  this task during measurement.
- The serialized cohort uses a test-only activation gate waiting for custody join.
  It restores the former dependency on the current build. This isolates the
  dependency change; it is not a comparison against a historical release.
- Timing starts at SDK registration entry. Authentication uses a virtual WebAuthn
  authenticator and automated confirmation. Public chain RPC responses are stubbed
  by the intended-behaviour harness; signatures are cryptographically verified.
  These numbers do not measure real human interaction, deployed network latency,
  NEAR transaction inclusion, or a production end-to-end onboarding SLA.
- The earlier always-independent-first cohort was superseded because its
  authentication timing differed materially between cohorts. The balanced cohort
  above is the acceptance comparison.

The [benchmark](../tests/e2e/intended-behaviours/passkey.registration.benchmark.test.ts)
contains 40 tests; run it once with
`playwright.wallet-intended.benchmark.ci.config.ts`, without `--repeat-each`.
The [measurements](./independent-near-registration-latency.json) contain the full
safe timing samples, first pair, and aggregate statistics. Each sample records
its cohort, pair, result, and instrumented spans; no credentials are included.

## Acceptance and release

The gated admission/execution tests prove real EVM signing proceeds while NEAR
waits, for passkey and Email OTP. Restart/exact replay, lost responses, retained
joined records, lock races, rollback repair, terminal-attempt preservation, recovery,
export, and single-curve checks passed. Both factors can finish NEAR provisioning
with zero signing uses and then sign through normal step-up while retaining the
same session, quota, and expiry. The passkey exhausted-session test also refreshes
before signing. Existing passkey unlock/export and refresh step-up contracts pass.

The full build and intended/state type checks passed. Release, deployment, and
private Console package adoption remain on hold. Deployed latency and composed
acceptance are still required after that hold is lifted.

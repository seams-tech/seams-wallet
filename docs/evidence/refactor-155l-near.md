# NEAR registration and first-signature loading

October 21, 2026. Selected R155L changes are implemented and verified.
No package was published and no service was deployed.

## Implemented changes

Passkey registration with NEAR now starts the browser's NEAR signer worker during
selected registration preparation. The existing worker registry retains that worker.
The first signature uses its existing initialization promise and operation checks.
Warmup performs no signing operation and installs no wallet material.

This extends the existing Yao Client preparation. It preserves registration's
publication, session hydration, material activation, and readiness order.
Failed worker startup remains recoverable through the ordinary operation path.

The default WASM build now compiles session sealing in release mode. Other hot
crypto modules already use this policy. This improves development builds.
Published production session-sealing WASM was already optimized.

The hosted timing harness now records SDK asset request timing and actual asset
requests received by its HTTPS server. It applies cache policies from the generated
asset manifest. Browser request events alone do not prove a network transfer.

## Measured results

The [machine-readable record](refactor-155l-near.json) contains samples, hashes,
source identities, deployment observations, and proof-artifact references.

### First-signature preparation

| Observation | Control, 3 wallets | Prewarm, 3 wallets |
| --- | --- | --- |
| NEAR signer script/WASM requests started after finalization | 2 per wallet | 0 per wallet |
| NEAR signer worker script requests | 1 per wallet | 1 per wallet |
| Registration and first signature verified | 3 | 3 |

In the candidate, the signer script and its WASM requests started about
172–180 ms after the harness began registration. Finalization responses arrived
about 3.77–4.31 seconds after that boundary. The worker therefore starts before
the first signature needs it.

The change moves existing downloads earlier. It does not reduce their total count.
The existing first-use initializer still handles incomplete or failed warmup.

Two historical hosted samples recorded 134–227 ms for the signer script and
197–220 ms for its WASM after registration. These establish a real cold asset cost.
They are separate observations, not a matched estimate of this change's latency saving.

### Development session sealing

The comparison changed the generated session-sealing WASM, its JavaScript glue,
and its worker bundle. Other files in the two browser asset trees were identical.
Both arms used the same staging backend.

| Cohort | Wallets | Median hydration | Median client unseal |
| --- | ---: | ---: | ---: |
| Control before | 3 | 43.8 ms | 39 ms |
| Candidate | 3 | 5.5 ms | 2 ms |
| Candidate repeat | 3 | 5.6 ms | 2 ms |
| Control after | 3 | 52.0 ms | 48 ms |

The control module is 654,272 bytes. A fresh `--dev --no-opt` build from the
current source and lockfile reproduced its SHA-256 exactly. The release module
is 118,841 bytes. This verifies the build-profile explanation.

Client unseal is nested within hydration. Do not add the two durations.
The earlier client-seal diagnostic can describe work completed before finalization.

Server timing varied substantially between cohorts. These results establish the
client-stage improvement. They do not establish an overall registration or p99 improvement.

## Correctness and scope

The final local E2E selection passed three cases:

- NEAR message signatures verify against the registered key before and after reload.
- Registration survives an aborted signer-worker warmup, then signs twice.
  The worker loads twice: one failed attempt and one successful reusable instance.
- Mixed registration retains its Gateway and finalization behavior.

The signature artifacts include independent verification and rejection of altered
message, recipient, nonce, and callback URL fields.
The hosted investigation produced 25 successful registrations with verified first
signatures across comparison, profiling, and qualification cohorts.
Do not pool these different cohorts into one latency estimate.

The SDK build, intended-test type check, default Gateway WASM build, bundle report,
and bloat check passed. No unit test or source-text guard was added.

The candidate used local HTTPS assets under the hosted origins and the real
staging backend. It identified as 0.15.6 with unpublished source changes.
The hosted staging and production iframe manifests still reported 0.15.4.
Six recorded Worker deployment IDs stayed unchanged throughout the comparisons.
Other regional deployment identities and cold server state were not established.

## Decisions from the investigation

| Candidate | Result |
| --- | --- |
| Post-finalization concurrency | Deferred. Activation and export work were small after the existing preloading fix. |
| Remove the Router Worker | Deferred. Six observed Router signing events used 2–29 ms CPU, including required admission work. The removable contribution remains unmeasured. |
| Combine SQLite statements | Deferred as a low-priority micro-optimization. |
| Background operation completion | Excluded. Completion remains durable before its canonical response returns. |
| Consolidate worker asset URLs | Discarded. Equal URLs still produced two server transfers in the HTTPS harness. |

The URL experiment withdrew the assumption that matching version parameters
would eliminate a transfer. No URL-resolver change remains.
The retained worker prewarm removes those loads from first-signature startup
without depending on that cache assumption.

Registration's larger server waits remain unresolved. The traces do not justify
changing authority checks, durable completion, retry policy, or placement.

An initial local test command selected no tests because its expression was too
restrictive. The corrected selector passed without a product change.
An incorrect bundle-report cleanup removed a live label. Restoring the label fixed
the report, and no change to that reporting script remains.

## Reproduction

Run the client build commands from `seams-wallet`. Existing outputs for the other
WASM modules must be present.

```sh
WASM_SDK_BUILD_TARGET=gateway pnpm -C packages/wallet build:wasm
pnpm -C packages/wallet build:sdk
pnpm -C tests type-check:intended
pnpm report:bloat --check
```

The local lifecycle check reuses existing Worker and server builds:

```sh
SEAMS_INTENDED_SKIP_BUILD=1 \
SEAMS_INTENDED_APP_URL=http://localhost:29401 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:29402 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:29300 \
SEAMS_LOCAL_PORT_OFFSET=25200 \
SEAMS_INTENDED_ROUTER_AB_ROOT="$PWD/.artifacts/refactor-155l-near/local-prewarm-root" \
pnpm -C tests exec playwright test -c playwright.wallet-intended.ci.config.ts \
  e2e/intended-behaviours/passkey.ed25519-yao-local.contract.test.ts \
  e2e/intended-behaviours/passkey.near-registration-commit.contract.test.ts \
  e2e/intended-behaviours/passkey.registration.contract.test.ts \
  --grep 'public NEAR message signatures verify against the registered key across refresh|NEAR registration survives signer worker warmup failure and signs twice|mixed registration exposes gateway and finalization timings' \
  --output "$PWD/.artifacts/refactor-155l-near/local-prewarm-browser"
```

Use the private `tests/e2e/hosted-product/README.md` procedure to build and serve
each browser candidate. Select `near-signing-latency.test.ts` with
`--grep 'hosted NEAR implicit registration sample'`.
Set `SEAMS_INTENDED_SIGNING_SESSION_DEBUG=1` and retain each cohort in a separate
`SEAMS_TEST_ARTIFACT_DIR`.

Raw hosted records and frozen browser builds remain under
`seams-monorepo/.artifacts/refactor-155l-near/`.
Local builds, compiler logs, and lifecycle proofs remain under
`seams-wallet/.artifacts/refactor-155l-near/`.
The summary hashes identify the raw files used for the reported results.

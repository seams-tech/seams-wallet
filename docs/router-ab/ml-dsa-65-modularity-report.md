# ML-DSA build isolation

ML-DSA now has separate server build outputs and a separate browser verification/export module.
Ordinary Worker binaries and the dedicated ML-DSA Router contain none of the eleven ML-DSA circuit payloads.
The participant binaries retain the circuits they execute.
Wallet-seed recovery, FIPS export, two-at-once consumption, and the thirty-two-candidate capacity remain unchanged.
This original screen qualifies build boundaries and local behavior.
The [hosted follow-up](ml-dsa-65-modularity-hosted-report.md) now records separated-Worker timings and retained control failures. Consistent five-second performance remains unmet.

## Measured sizes

These are release Wasm sizes: raw / deterministic gzip. They exclude JavaScript glue and complete package archives.
The comparison uses local `dev` commit `4c13b3f3c854d34a62e291cbd77f02170db5aa72` and the previous ML-DSA build at `fe267afa`.
The dev source was exported into a temporary directory. No branch or checkout was changed.
Build settings match within each server/browser comparison.
The dev comparison includes other branch differences, so its entire delta cannot be attributed to one function.

| Server artifact | Raw / gzip | Complete ML-DSA circuits embedded |
| --- | ---: | ---: |
| Local dev Router | 7.130 MB / 2.306 MB | 0 |
| Previous combined Router | 42.375 MB / 21.224 MB | 11 |
| Ordinary Router | 7.132 MB / 2.307 MB | 0 |
| Dedicated ML-DSA Router | 8.044 MB / 2.588 MB | 0 |
| Ordinary A | 11.223 MB / 4.357 MB | 0 |
| Ordinary B | 11.259 MB / 4.367 MB | 0 |
| Dedicated ML-DSA A | 45.793 MB / 23.048 MB | 11 |
| Dedicated ML-DSA B | 45.831 MB / 23.056 MB | 11 |

The eleven circuit files total 32,895,832 bytes.
The check searches each complete binary payload inside each Wasm artifact.
All five ordinary roles exclude them, including the signing Worker and tenant-root control plane.
The ordinary Router is 1,334 bytes larger than local dev. Its additional ML-DSA responsibility is authenticated forwarding.
The dedicated ML-DSA Router binds admission to pinned circuit digests without loading the circuit payloads.
Participants still parse and validate every circuit. They bind execution to the same ordered digest and candidate-group width.
The protocol bytes and persistent key/material identifiers are unchanged.

| Browser artifact | Raw / gzip |
| --- | ---: |
| Local dev | 0.412 MB / 0.180 MB |
| Previous shared module | 0.635 MB / 0.243 MB |
| Ordinary NEAR module | 0.477 MB / 0.198 MB |
| Optional ML-DSA module | 0.635 MB / 0.243 MB |

Ordinary NEAR Wasm saves 158,300 raw bytes against the previous shared module.
It remains 65,134 bytes larger than local dev.
Shared NEAR wire encodings, access-key hashing, and lightweight custody/lifecycle support remain in common code.
The heavier ML-DSA verifier and FIPS seed-export method are absent from the ordinary module.
The optional module is another build of the existing crate. It introduces no new cryptographic implementation.
Dedicated participant/preparer builds still carry the full participant circuit set. They are not yet split by registration versus preparation phase.

Both browser modules ship in the SDK package. The server package also includes the optional Worker binaries.
Smaller ordinary downloads and deployments do not imply smaller complete npm packages.
The Gateway can package both verification modules and initializes the selected one separately.
Whole JavaScript entry sizes, npm archive deltas, total process memory, and production cold-start latency remain unqualified.
The follow-up package inventory below measures current complete archives.

## Runtime and custody boundaries

The ordinary Router authenticates ML-DSA requests, then forwards them through the `ML_DSA_ROUTER` service binding.
Without that binding, it returns an explicit unavailable response for those requests.
Ordinary Ed25519/ECDSA requests keep their existing routes.
This adds one service hop to the default ML-DSA Gateway path. Hosted cost of that hop is not measured here.

The dedicated Router exports its admission Durable Object.
Participant builds export pool, registration, and producer objects.
Standard builds contain no ML-DSA runtime or ML-DSA Durable Object exports.
Preparation still runs in separate services within the corresponding participant trust boundaries.

The browser's existing export worker opens the authenticated seed envelope in the optional module.
No seed or opaque custody handle moves between Wasm modules or into the application.
Ordinary ML-DSA signing still uses public transaction data and server-held shares.
The [worker ownership document](../browser-workers.md) records the updated loading boundaries.

## Validation

- Fresh release builds for five ordinary roles and three dedicated ML-DSA roles.
- Complete local Gateway → ordinary Router → ML-DSA Router → A/B registration, recovery, signing, and lost-material restoration.
- Durable preparation interruption, single-use consumption, exact retries, restart recovery, and independently verified signatures.
- Chrome executes a NEP-413 digest through the actual packaged NEAR Worker without fetching ML-DSA assets.
- The ordinary digest matches the previous shared module.
- A separate browser Worker reproduces the historical public MPC recovery vector's FIPS seed/key. Wrong-wallet and wrong-key exports fail.
- Seven browser cancellation and nonce-settlement scenarios pass.
- Wallet, server, and intended-lifecycle type checks pass. Server build and clean production SDK build pass, including static asset checks.
- The package manifest retains the ordinary five-role set. Dedicated ML-DSA records use its separate `mlDsaWorkers` field.

The browser export vector uses a public zero wallet seed and a synthetic envelope.
It validates the new module and export boundary. It does not replace a full hosted browser recovery/QR-link campaign.
No hosted deployment or testnet transaction was performed in this screen.
Local lifecycle durations are not performance comparisons; other build work overlapped some validation runs.

## Failures retained during validation

| Observation | Classification and resolution |
| --- | --- |
| Missing `/sdk/ml_dsa_signer_bg.wasm` after the split. | Production packaging regression. Add the optional asset to both existing output locations. Production build then passes. |
| Local standard Router imports escaped the fixture's module root. | Environment/configuration failure. Give the standard Router its own module root. |
| Linking expected a cooldown retry after a one-second benchmark interval. | Test configuration failure. Rerun the complete lifecycle with the production sixty-second cooldown. No admission behavior or assertion changed. |
| Browser port 4203 was occupied. | Environment failure. Select an unused port and preserve the existing process. |
| Cancellation fixture omitted the required relayer-origin policy. | Valid test needing an update. Use the production HTML builder with the fixture's approved origin. All seven scenarios then pass. |

The bloat check retains the inherited Rust-duplicate excess: 13,972 lines versus the 13,754-line baseline.
The baseline is unchanged. No unrelated formatter changes are retained.

## Build and deployment

From `crates/router-ab-cloudflare`, build ordinary roles with the existing command:

```sh
bash scripts/build-strict-worker.sh router
bash scripts/build-strict-worker.sh deriver-a
bash scripts/build-strict-worker.sh deriver-b
bash scripts/build-strict-worker.sh signing-worker
bash scripts/build-strict-worker.sh tenant-root-control-plane
```

Build the optional protocol outputs separately:

```sh
bash scripts/build-strict-worker.sh router ml-dsa
bash scripts/build-strict-worker.sh deriver-a ml-dsa
bash scripts/build-strict-worker.sh deriver-b ml-dsa
```

`package:cloudflare-runtime` stages both families and regenerates their artifact records.
`build:wasm` builds both browser profiles. `build:sdk` and `build:prod` emit both assets.
Native ML-DSA consumers explicitly enable the `ml-dsa` Cargo feature.

The five `wrangler.ml-dsa-*.toml` templates live beside the canonical Worker source.
Package generation copies them into `@seams/wallet-server`; do not edit generated copies.
They keep A/B and their preprocessors separate, with private endpoints and the existing default policy.
Set the ordinary Router's optional service binding only when the dedicated deployment exists:

```toml
[[services]]
binding = "ML_DSA_ROUTER"
service = "router-ab-ml-dsa-router"
```

The ordinary and dedicated Routers use the same Gateway-authentication secret for this forwarded path.
Internal service authentication remains separate from Gateway authentication.
Each participant needs its own `ML_DSA_ROLE_KEK`; only its corresponding preparer shares that role key.
No secret values are included in the templates or evidence.
Assign consistent environment-specific Worker names and peer bindings before deploying staging or production variants.
Custom Gateway hosts supply `mlDsaSignerWasmModuleOrPath` for the optional codec. The hosted Gateway factory supplies its compiled-module loader by default.

These templates describe a fresh separated deployment. They do not move existing Durable Object state.
A live cutover must preserve admission records, cooldowns, replay results, and single-use tombstones.
Restoring key material alone does not move those records. Existing namespaces need a separate reviewed migration before a service switch.
This change performs no deployment, namespace deletion, branch merge, or key migration.

## Remaining merge/release qualification

1. Qualify request cold starts and ordinary Ed25519/ECDSA latency. Hosted forwarding-Worker CPU is now measured in the follow-up report.
2. Reduce registration and initial-stock signing costs. Resolve storage-reset failures and complete longer refill qualification with unchanged capacity.
3. Run the full hosted SDK recovery and QR-link flow against that topology.
4. Set complete JavaScript/package-size budgets separately from the Wasm measurements in this report.

The [evidence summary](../evidence/ml-dsa-65-modularity-20261023.json) records build hashes, circuit exclusion, checks, and a reproducible public-data archive.


## Hosted qualification preflight and package inventory

The hosted comparison uses eleven fresh temporary Workers: five combined roles and six separated roles.
The separated path includes the ordinary Router before the ML-DSA Router.
Both use a sixty-second cooldown, four-candidate preparation, two-candidate consumption, and thirty-two-candidate capacity.
All names were absent before creation. Namespace bootstrap completed without production bindings or wallet state.
Explicit approval was received for these exact destinations and payloads.
The hosted comparison and cleanup are complete. All eleven temporary Workers were deleted.
The [follow-up report](ml-dsa-65-modularity-hosted-report.md) records the results, including both failed controls.

The prepared campaign checks two synthetic wallets per topology, including canonical-key recovery and independently verified signatures.
It then submits one demand per wallet per minute for five minutes.
Exact deployed versions, request failures, censored demands, stock observations, and per-role traces must remain in the evidence.
This small policy-paced screen cannot establish saturation throughput or p99 latency.
Use observed construction and cache traces to classify first-use and warm requests. A fresh deployment alone does not prove a cold isolate.
Do not subtract timestamps from different Worker clocks to estimate preparation duration.

Current package inventory uses `npm pack --ignore-scripts --dry-run --json` in each package directory.
The command reads existing built outputs. It publishes nothing and runs no lifecycle scripts.

| Package | Archive | Unpacked | Files |
| --- | ---: | ---: | ---: |
| `@seams/wallet` | 9,760,057 bytes | 35,267,958 bytes | 2,142 |
| `@seams/wallet-server` | 66,198,292 bytes | 160,035,308 bytes | 1,288 |

Named optional ML-DSA files account for 3,223,088 unpacked SDK bytes and 104,026,210 unpacked server bytes.
The SDK includes the optional Wasm in five supported output locations. A consumer does not fetch all five for one operation.
The server package includes the three optional Worker builds.
These totals exclude ML-DSA code inside shared files. They are not a measured delta against dev.
Separating optional server artifacts into another package could reduce installation size. That packaging change remains separate from runtime isolation.

## Local launcher integration

The local launcher now starts the five ordinary role Workers by default.
Use `--ml-dsa` with `start-local-wallet-system.mjs` or `start-local-role-workers.mjs` to add the five dedicated ML-DSA services.
The optional services use the canonical `wrangler.ml-dsa-*.toml` templates and separate persistence directories.
The ordinary Router receives its forwarding binding only in this mode.
A and B receive separate role keys. Each preparer receives only its corresponding participant key.

The intended-test runner selects this mode for the ML-DSA lifecycle contract.
For a direct Playwright invocation, set `SEAMS_INTENDED_ML_DSA=1`.
A normal build of that test also builds the three ML-DSA artifacts.
With `SEAMS_INTENDED_SKIP_BUILD=1`, all selected artifacts and approved-origin browser assets must already exist.

The previous launcher added ML-DSA Durable Object bindings to ordinary participant builds.
A real local browser run failed before registration because those builds no longer export the bound objects.
This was a production integration regression in the local launcher. The obsolete binding injection is removed.
The corrected launcher starts the separated services without those export errors.
The [local isolation evidence](../evidence/ml-dsa-65-local-isolation-20261023.json) records both passing paths.
The ordinary path starts five roles, returns Gateway readiness, and refuses ML-DSA with an explicit unavailable response.
The separate ML-DSA path passes full browser recovery, QR linking, canonical FIPS export/import, and participant restoration.
It also finalizes an independently verified threshold-signed transaction on NEAR testnet.
The browser test keeps the sixty-second cooldown, two-at-once consumption, and thirty-two-candidate capacity.
The run took about six minutes, including required cooldowns. This is test duration, not per-operation latency.
Type checks, script syntax checks, and packaged-source parity pass. The inherited bloat failure remains unchanged.
No hosted latency or live namespace transfer is qualified by these local checks.

## State-preserving cutover requirements

The current templates create fresh namespaces. Do not use their create migrations to replace existing ML-DSA state.
Wallet-seed recovery reproduces the key. It does not reproduce consumed-material records or operation history.

| Existing namespace | State that must remain authoritative |
| --- | --- |
| Admission | Key activation and epoch, wallet cooldown, exact-operation results, active claims, registration claims/results, refill queue and fairness order. |
| Each participant pool | Wallet ownership, active key and encrypted share, prepared ciphertext, reservations, consumed/burned records, refill intent. |
| Each registration object | Preparation ownership, encrypted inputs/tables, consumed/retired records, execution and delivery state. |
| Producer | Pending order, job state, publication/settlement state, and recovery alarm behavior. |

The admission name remains `ml-dsa-admission-v1`. Pool names derive from the full wallet scope.
Registration object names derive from the job ID. The producer name remains `ml-dsa-producer-v1`.
Changing a Worker binding to a fresh namespace would reset the meaning of those names.
Keep each participant's wrapping key and version unchanged during a topology-only move.
The fresh templates' `ml-dsa-v1` version must not replace a deployed key version without a separate key rotation.

Prefer an in-place code deployment when the Worker and namespace ownership can remain unchanged.
When ownership must move, rehearse a whole-class transfer with synthetic state before any live cutover.
Cloudflare's [transfer migration documentation](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/#transfer-migration) states that transfer preserves stored objects and creates the destination class.
It also prohibits creating that destination class first. Existing bindings forward after transfer, and migrations cannot use gradual deployment.
The existing migration mechanism remains supported. This review does not change the repository's configuration mechanism.

A rehearsal must retain a completed operation, a live cooldown, consumed and reserved candidates, and an interrupted producer.
After transfer, exact retries must return the same result. Changed retries and consumed-material publication must fail.
The same public key must sign successfully after recovery. Old-epoch operations must remain invalid.
Refill must resume without duplicating publication or changing queue order or capacity.
Gate new admissions during cutover and settle or fence in-flight work before changing ownership.
Do not restore an old database snapshot as rollback after material was consumed. That could make single-use material available again.

No namespace transfer, state-copy implementation, or live cutover was performed in this review.
The [preflight evidence](../evidence/ml-dsa-65-modularity-hosted-preflight-20261023.json) includes package inventories, exact binary hashes, deployment receipts, and campaign scripts.
It contains no credential values or wallet secrets.

# ML-DSA build isolation

ML-DSA now has separate server build outputs and a separate browser verification/export module.
Ordinary Worker binaries and the dedicated ML-DSA Router contain none of the eleven ML-DSA circuit payloads.
The participant binaries retain the circuits they execute.
Wallet-seed recovery, FIPS export, two-at-once consumption, and the thirty-two-candidate capacity remain unchanged.
This screen qualifies build boundaries and local behavior. It does not qualify hosted latency or production rollout.

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
Whole JavaScript entry sizes, full npm archive deltas, total process memory, and production cold-start latency remain unqualified.

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

1. Deploy the separated topology and measure the new forwarding hop, cold starts, and ordinary Ed25519/ECDSA latency.
2. Repeat ML-DSA registration, signing, and sustained refill with the existing capacity and consumption policy.
3. Run the full hosted SDK recovery and QR-link flow against that topology.
4. Set complete JavaScript/package-size budgets separately from the Wasm measurements in this report.

The [evidence summary](../evidence/ml-dsa-65-modularity-20261023.json) records build hashes, circuit exclusion, checks, and a reproducible public-data archive.

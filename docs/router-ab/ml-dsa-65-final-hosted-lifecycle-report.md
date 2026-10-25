# ML-DSA final hosted lifecycle and module loading

Date: 2026-10-25. Runtime source: `c0292b42`.

The full browser lifecycle passes against real Cloudflare Workers and NEAR testnet.
The separate owner-export campaign also passes.
Ordinary NEAR and ECDSA browser flows fetch no optional ML-DSA cryptographic modules.

Wallet-seed recovery, canonical FIPS export, four-candidate preparation, two-candidate consumption, and pool capacity remain unchanged.
Each wallet retains a 32-candidate target and a 16-candidate admission minimum.
The hosted policy retains one active signing operation and a 60-second wallet cooldown.

## Hosted coverage

| Campaign | Result | Scope |
| --- | --- | --- |
| Ordinary ECDSA | Passed | Registration, reload, unlock, Tempo/EVM signing, export, and optional-module exclusion |
| Full ML-DSA lifecycle | Passed | Interrupted publication, key enrollment, default-key selection, Passkey and Email OTP signing, reusable sessions, QR linking, recovery, export, revocation, participant restoration, and NEAR testnet finality |
| Device-owner export | Passed | Linked-owner export after reload, onward linking, original-owner Email OTP export, recovery, selective revocation, and preservation of another linked owner's export access |

The full lifecycle verifies eight ordinary ML-DSA signatures independently.
Authorized seed exports import into ordinary Node/OpenSSL ML-DSA and reproduce the public key.
Participant restoration advances the material epoch while preserving the public key and manifest.
The restored signer submits a transaction that reaches NEAR testnet finality.
The Email OTP probe rejects a proof for another operation and verifies exact replay of a completed result.

The Gateway, Router, participants, and preparers run on Cloudflare.
The browser uses production-built assets served from two local test origins and virtual authenticators.
Console admission uses a disposable test authority.
This does not qualify a deployed Console or CDN asset delivery.
The device-owner export campaign uses controlled NEAR RPC and makes no separate live-chain claim.

## Signing observations

| SDK call | Seconds |
| --- | ---: |
| Original owner | 3.522 |
| Reusable Passkey session | 5.339 |
| Fresh Email OTP, with proof probe | 8.145 |
| Email OTP session creation | 4.087 |
| Reusable Email OTP session | 3.125 |
| Recovered owner | 2.773 |
| Linked owner | 7.087 |
| Restored participant material | 4.641 |

SDK timers include automatic test approval, hosted services, and browser verification.
They exclude human response time, preparation, explicit cooldown sleeps, and transaction finality.
Email requests pass through the test probe. The fresh Email OTP call adds wrong-operation and replay requests.
Its 8.145-second result is not an ordinary production-path latency sample.
The other observed calls span 2.773–7.087 seconds. These samples establish no percentile or five-second guarantee.

Registration deliberately interrupts publication and reloads the browser.
This run therefore provides no clean registration-latency measurement.
The complete lifecycle test takes 12.6 minutes because it includes many operations and deliberate cooldown waits.

## Module boundaries

Both local ordinary-wallet campaigns pass with production-built assets.
They cover registration, unlock, signing, reload, and export for NEAR-only and ECDSA-only wallets.
A separate hosted ECDSA campaign also passes.
Recursive browser-worker observation records zero optional ML-DSA cryptographic requests in these flows.
The full lifecycle provides the positive control: the ML-DSA registration and signing phases load the optional module.
The observers report no setup failures.

Shared authority, validation, inventory, and session helpers remain in ordinary JavaScript paths.
Some test-app helpers also enter through its explicit advanced SDK imports.
The loading checks distinguish this shared code from the optional cryptographic runtime.
They do not claim that every ML-DSA-related byte disappears from ordinary bundles.

| Browser Wasm | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Ordinary NEAR | 488,271 | 201,701 |
| Optional ML-DSA | 725,607 | 278,352 |

The ordinary module excludes the ML-DSA verifier and FIPS seed-export method.
Both modules produce the same Ed25519 NEP-413 digest.
All five ordinary Worker builds exclude the eleven ML-DSA circuit payloads and ML-DSA object exports.
The dedicated ML-DSA Router excludes the circuit payloads and exports only its admission object.
Both dedicated participant builds contain the eleven circuits and their pool, registration, and producer objects.
These checks do not measure complete npm archive overhead or production cold-start latency.

## Retained failures and corrections

| Failure | Classification | Correction |
| --- | --- | --- |
| A broad filename assertion rejected shared metadata helpers. | Valid test needing an update | Check optional cryptography explicitly and retain the shared-module observations. |
| Test credentials included dotenv quote delimiters. | Environment failure | Parse dotenv values correctly, preserving the underlying credentials. |
| A private test JWK contained extra metadata fields. | Environment failure | Use the current four-field schema with identical key material. |
| The Email OTP probe bypassed benchmark authentication. | Environment failure | Preserve access headers on intercepted requests. The ingress recorded HTTP 403 with the header absent. |
| The disposable sponsor lacked the transfer fee allowance. | Environment failure | Replenish the testnet sponsor before repeating. |
| The Google test token expired during setup and testing. | Environment failure | Refresh the configured test identity immediately before each browser run. |

The test ingress also permits the current Wallet protocol header.
Its hosted preflight check passes.
These corrections change test fixtures and deployment setup. They change no production signer behavior.
The successful campaigns retain the original security and pool policy.

## Preparation remains the capacity question

This campaign qualifies lifecycle behavior. It does not measure sustained refill throughput or preparation cost.
The earlier [producer-reuse screen](ml-dsa-65-producer-reuse-report.md) measured 4.971 signatures per minute after both wallets consumed their starting stock.
That ten-minute screen used two wallets and a one-second saturation cooldown.
It cannot establish the final deployment's production capacity.

Next, measure sustained demand on this build with the production 60-second cooldown and unchanged per-wallet capacity.
Account for initial stock, consumed pairs, failed jobs, retired material, and complete reserve restoration.
Measure stock waits and fairness across increasing numbers of active wallets.
Set service admission below measured refill capacity, with headroom for rejection and runtime variation.
GPU preparation remains deferred.

## Evidence and repeatability

The [summary](../evidence/ml-dsa-65-final-hosted-lifecycle-20261025.json) records the policy, measurements, module hashes, and twelve active deployment versions.
It identifies the compressed public-data archive by SHA-256.
The archive retains lifecycle receipts, static-asset observations, and the failure classifications.
It excludes credentials, private exports, OTP codes, and raw Worker tails.

The hosted entry point is `tests/e2e/intended-behaviours/ml-dsa.hosted.test.ts`.
Configure a fresh disposable deployment through `ML_DSA_HOSTED_DEPLOYMENT` and the existing hosted fixture.
Run the normal lifecycle, owner-export, and ECDSA-only cases with `playwright.wallet-intended.config.ts`.
The production asset checks remain in `passkey.registration.assets.contract.test.ts`.
Each campaign writes verifiable JSON artifacts.

SDK, server, intended-test, and domain-state type checks pass.
The bloat check retains the inherited 218-line Rust duplication excess, with no baseline increase.
All twelve temporary Workers, four databases, and two backup buckets were removed after evidence collection.
Cloudflare returned an unspecified error on the first deletion attempt. The repeat completed; the cause remains unknown.

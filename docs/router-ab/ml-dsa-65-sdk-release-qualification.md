# ML-DSA SDK release qualification

This follow-up closes expired creation restart and NEAR protocol admission gaps.
It preserves wallet-seed recovery, ordinary FIPS seed export, and the passive server-blind model.
Preparation still groups four candidates. Signing consumes pairs.
The configured reserve remains 16 candidates, with a target of 32.

## Hosted SDK lifecycle

The [hosted browser campaign](../evidence/ml-dsa-65-sdk-hosted-lifecycle-20261021.json)
passes all 16 checks against real Cloudflare Gateway, Router, participant, and preparation Workers.
It uses the normal SDK, two browser origins, and distinct virtual Passkey authenticators.
The campaign covers recovery codes, full-owner QR linking, linked-owner revocation, and recovered-owner signing.
It imports the authorized canonical seed into ordinary OpenSSL ML-DSA.
It restores participant material at a higher epoch while preserving the public key and manifest.
The restored signer sends an ordinary ML-DSA transaction that reaches NEAR testnet finality.

| SDK operation | Observed latency |
| --- | ---: |
| Original owner signing | 3.710 s |
| Reusable-session signing | 5.725 s |
| Recovered owner signing | 3.948 s |
| Linked owner signing | 5.248 s |
| Restored participant signing | 3.639 s |

These timers surround the SDK call and include automatic test approval.
They exclude stock preparation, on-chain enrollment, transaction finality, and independent Node signature verification.
Browser automation also records a separate harness timer, which includes test-settlement waits.
Virtual authentication does not measure human approval time or hardware authenticator latency.

The browser assets remain local. Console admission and reservation authority use disposable test fixtures.
This campaign qualifies the normal SDK and hosted Wallet protocol boundaries.
It does not qualify a live Console deployment or hosted browser asset delivery.
The package acceptance checks below cover private Console composition separately.

## Service-capacity retry diagnosis

The first two-wallet campaign verifies eight signatures across four rounds.
Each round starts two requests together. The configured service admits one operation at a time.
Four SDK calls take 3.699–4.698 seconds. The other four take 33.035–34.940 seconds.
Registration takes 6.405 and 7.216 seconds after stock becomes ready.
Initial generic preparation takes 61.088 and 84.137 seconds.
Consistent five-second registration and signing remain unqualified.

The Router returns the active operation's lease deadline when service capacity is occupied.
The SDK sleeps until that retry hint. The lease lasts longer than ordinary signing execution.
The Gateway now bounds only service-capacity hints to 500 milliseconds from its response.
It preserves cooldown and empty-pool hints, operation identity, authorization, admission, and single-use material.
Earlier retries can observe released capacity. They cannot create another slot.

| Fact | Instrument and scope | Check |
| --- | --- | --- |
| One request per simultaneous round waits about 30 extra seconds | Eight independently verified SDK samples, first hosted campaign | Four immediate and four delayed results |
| Delayed Gateway requests start 30.2–30.4 seconds apart | Sanitized Cloudflare request timestamps | Repeated gaps agree with the active lease duration |
| Router signing execution takes 1.50–3.35 seconds | Correlated Router operation traces | Execution finishes well before the deferred retry |
| The capacity response uses the active lease deadline | Router admission source and Gateway boundary review | SDK retains the exact request while waiting |

| Candidate cause | Long SDK wait | Short Router execution | Repeated 30-second request gap | Assessment |
| --- | --- | --- | --- | --- |
| Candidate rejection alone | Fits | Contradicts the full wait | Does not explain it | Removed as the cause of the extra 30 seconds |
| Participant compute alone | Fits | Contradicts the full wait | Does not explain it | Removed as the cause of the extra 30 seconds |
| Browser harness settlement alone | Fits | Says nothing | Contradicts Gateway request timing | Removed |
| Our service-capacity retry hint | Fits | Fits | Fits source and timestamps | Predicted earlier retries after the hint-only change |

Raw Gateway retry response bodies were not retained.
Source review identifies the reason. Correlated traces test its timing prediction.
The Gateway tail reconnected twice without timestamped gaps, so its request count can be incomplete.
Participant completions and durable session budgets provide independent controls.
The [capacity comparison](../evidence/ml-dsa-65-sdk-hosted-capacity-20261021.json)
retains SDK samples, deployment hashes, sanitized timing projections, and session-budget inspection.
Its campaigns use fresh wallets and different random candidate outcomes.
Previously registered wallets remain in the deployment.
The baseline and first retry control use identical Rust builds.
Every campaign keeps the same configured capacity.
This comparison establishes no percentile or sustained multi-wallet throughput claim.

The first retry control confirms earlier polling, but it fails functional qualification.
Six signatures verify at 2.681–9.712 seconds. Two requests fail after an empty pool.
Their Router inventories contain six and five ready pairs. Admission requires eight pairs.
The coordinator reports an empty-pool retry, then stores terminal `Declined` state.
The next exact retry reaches a Gateway parser that cannot handle that state.
Session signing returns HTTP 503. The later Passkey path returns HTTP 502.
This combines measured inventory and request traces with source behavior.
The exact Router response bodies remain unavailable.

The correction introduces `AwaitingStock` before any participant reservation.
It retains the exact request and retry time while releasing the service slot.
A later retry checks key, cooldown, and capacity again, then obtains a fresh random claim.
Stale claims cannot admit or reserve material. Waiting does not charge wallet cooldown.
Cancellation after an uncertain reservation remains terminal.
The Gateway also handles the existing Preparing and Declined states explicitly.

The [durable admission campaign](../evidence/ml-dsa-65-stock-wait-admission-20261021.json)
checks restart during the stock wait, changed-input rejection, and stale-claim rejection.
Its encrypted-storage fixture uses four synthetic batches under an explicit test policy.
The previous fixture incorrectly combined four batches with the current eight-batch default minimum.
Hosted policy remains unchanged at eight admission-ready pairs and sixteen target pairs.
The private Worker E2E now retries its exact empty-pool operation after refill.
It requires an ordinary verified signature and an identical result on another exact retry.
Its earlier permanent-decline assertion conflicted with the public SDK retry contract.

Independent review found no blocking claim or material-reuse issue in the new transition.

The accumulated-workload repeat exposes two measurement limits.
Its 60-second harness timeout leaves the underlying SDK task running.
Later rounds overlap those timed-out requests. Three test samples verify, while four core operations complete.
The published samples take 9.071, 16.425, and 40.593 seconds. Five harness calls time out.
These numbers cannot establish a clean two-wallet capacity limit.

Producer traces show 31 published runs across nine keys in the same window.
Seven older keys receive 27 runs. Each current key receives two runs.
Current-key preparation takes 16.416–19.228 seconds.
This rules out complete refill starvation from foreground polling.
The Busy response does not identify its reason, so smaller foreground-interference costs remain unknown.

The final repeat extends the harness deadline beyond the SDK's five-minute operation deadline.
It stops after a failed pair. It recreates only disposable protocol Workers to remove old alarms and queues.
Gateway and participant D1 databases remain intact. Policy and pool capacity remain unchanged.
Dependent Worker service bindings must also be redeployed after force deletion.
The old tenant-root journal cannot serve the reset namespace, so this repeat creates fresh test tenant authority.
These setup failures occur before ML-DSA admission and provide no signing measurements.
The original evidence remains intact. This repeat qualifies a clean workload and cannot isolate one timing change.

The clean repeat also fails qualification. It stops after the first failed pair.
Exactly two current wallet keys receive the nine published preparation runs.
All nine runs prepare four candidates. Each run takes 20.541–25.106 seconds.
The three successful signatures consume 14, four, and ten candidates.

| Clean hosted measurement | Observed latency |
| --- | ---: |
| Registration with generic stock ready | 6.717 and 7.924 s |
| Initial generic stock preparation | 62.449 and 88.609 s |
| Three independently verified SDK signatures | 5.705, 8.323, and 12.304 s |
| Fourth SDK request | Wallet RPC timeout after 61.863 s |

The failed operation retains its identifier through 54 Router attempts.
Its stock increases from five paired batches to seven. Admission requires eight.
The Wallet RPC reaches its own deadline before stock becomes sufficient.
The extended harness deadline does not override that production RPC deadline.
The test stops immediately, so later rounds cannot overlap the timed-out SDK request.

Router traces record three distinct settled operations, matching the three verified signatures.
Captured participant A traces are incomplete. The report makes no complete participant-log coverage claim.
Final D1 inspection shows two approved operations and two remaining uses in each four-use grant.
Completed session results total two for one wallet and one for the other.
Repeated capacity and stock retries consume no additional session uses.

This is a negative capacity result. It establishes active refill and insufficient ready stock.
Both functional and five-second qualification flags remain false.
It establishes no percentile or sustainable user count.
Long stock waits also need explicit Wallet RPC deadline and cancellation qualification.
Increasing transport timeouts cannot satisfy the five-second latency requirement.

## Interrupted creation

A fresh custody-owner approval can replace an expired, unpublished creation.
The Gateway advances the material epoch and creates a new operation identifier.
The client creates fresh encrypted inputs. Workers consume fresh preparation.
The prior private computation does not resume.

The Router and both participant pools preserve any installed canonical public key.
The Gateway protects published signers and interrupted restoration records from creation requests.
Its versioned transaction prevents an older operation from replacing a newer record.
An old encrypted input cannot open under the new operation and epoch.

The [Worker campaign](../evidence/ml-dsa-65-interruption-lifecycle-20261021.json)
passes 84 checks. The added scenario loses the Router completion after installation.
It discards the client handle and restarts after expiry.
The replacement reproduces the canonical public key and manifest.
Delayed execution and published-key replacement fail.
This campaign uses local workerd and seeded existing-wallet authority.

An independent reviewer found no blocking continuity or replay issue in these changes.
The Router trusts the authenticated Gateway to establish that a creation is expired and unpublished.
The Router independently checks increasing epochs and canonical-key continuity.

The first version of the fault scenario used another key slot in an existing wallet.
That wallet already held 16 prepared pairs. Its participant pool permits 20 pairs across key slots.
Installation failed after four additional pairs, before the intended response-loss injection.
The fresh-wallet control passes without a capacity increase.
The evidence strongly supports a capacity collision. The original role error body was not retained.
Multiple ML-DSA key slots in one wallet still need a defined shared-capacity admission policy.

## NEAR enrollment

Enrollment reads finalized protocol configuration through the selected NEAR client before AddKey approval.
It requires protocol version 85 or later, as specified by
[NEP-645](https://github.com/near/NEPs/blob/master/neps/nep-0645.md).
The [protocol RPC](https://docs.near.org/api/rpc/protocol) supplies the active version.
An unsupported version returns `unsupported_protocol`. A failed read returns `rpc_unavailable`.
Read-only enrollment continuation cannot submit a transaction.

The [enrollment campaign](../evidence/ml-dsa-65-network-enrollment-20261021.json)
passes eight checks. It confirms zero approval calls for protocol refusal and failed reads.
It also confirms an actual AddKey transaction at testnet finality.

## Package integration

The [candidate record](../evidence/ml-dsa-65-release-candidate-20261021.json)
identifies unpublished Wallet and Wallet Server 0.16.0 tarballs by integrity and SHA-256.
Packed entry points and external SDK consumers pass their checks.
An isolated private monorepo snapshot installs those exact tarballs through package overrides.
Its server type check and both Wallet activation acceptance scenarios pass.
The scenarios cover restart, delayed shutdown, separate consoles, and invitation redemption.
The final server tarball includes the capacity retry change.
All five packaged Worker binaries match the final hosted deployment by SHA-256.

The live private checkout retains its published package pins.
Registry publication and a permanent dependency upgrade remain release actions.
GPU preparation and product UI changes remain deferred.

## Review limits

The restart, stock-wait, and protocol changes operate on public lifecycle metadata.
They add no secret arithmetic or new public sampler disclosures.
The independent review covers these implementation boundaries.
It does not replace a full cryptographic composition review or target-runtime side-channel qualification.
The existing [prepared-signing review](ml-dsa-65-prepared-signing-review.md) retains those limits.

The repository bloat check still reports the inherited Rust duplication excess.
Its baseline remains unchanged.

The [cleanup receipt](../evidence/ml-dsa-65-sdk-cleanup-20261021.json) records removal of
nine temporary Workers, four D1 databases, and both participant backup buckets.
The private trace collectors stopped after evidence projection.
The task changes no live product dependency pins and publishes no registry package.

## Repeat and release boundaries

Build Wallet assets, Wallet Server, and the strict Router/A/B Workers from the same checkout.
Use `tests/helpers/mlDsaHostedLifecycleWorker.ts` as the disposable Gateway entry.
Protect it with the existing authenticated hosted-test ingress.
Keep A/B wrapping keys, role delivery keys, D1 databases, and preparation services separate.
Use the existing local-hosted deployment renderer for the test authority and service bindings.

Run `tests/playwright.wallet-intended.config.ts` with `ML_DSA_HOSTED_DEPLOYMENT` naming a private deployment directory.
Its `metadata.json` supplies `gatewayUrl`. Its `gateway-secrets.json` supplies the disposable `BENCHMARK_ACCESS_TOKEN`.
Set the normal intended-app and Wallet test origins, project identity, and publishable key.
Set `SEAMS_INTENDED_TRACE_DIR` for the repeatable JSON artifacts.
An optional `SEAMS_INTENDED_TESTNET_SPONSOR_FILE` selects a funded disposable Ed25519 sponsor.
That private file contains `accountId` and `privateJwk`. Never include it in public evidence.

The lifecycle and capacity tests write their artifacts only after checking the result.
The capacity artifact also records partial failures and an explicit five-second verdict.
Limit the capacity repeat with `--grep 'simultaneous wallets'`.
Human authentication and live Console composition require separate production acceptance.

Release gates remain:

- Reduce registration and contention/rejection tails to the five-second target.
- Increase refill throughput and define SDK behavior when ready stock is insufficient, including RPC deadline propagation and cancellation.
- Qualify sustained demand and shared capacity across multiple ML-DSA key slots in one wallet.
- Complete the broader cryptographic composition and target-runtime side-channel review.
- Publish approved package versions, then update private product pins through the normal release process.

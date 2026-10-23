# ML-DSA hosted build-isolation results

The separated topology works, but it does not meet the consistent five-second target.
Creation and wallet-seed recovery passed for two synthetic wallets on real Cloudflare Workers.
Both combined-control attempts failed during preparation. This prevents a complete performance comparison.
All eleven temporary Workers were deleted after evidence capture and version checks.

## Scope and unchanged requirements

The control uses the frozen combined binaries at `fe267afa`.
The separated topology uses the frozen binaries at `7a6e7fe5`.
It includes the ordinary forwarding Router, dedicated ML-DSA Router, separate A/B participants, and separate A/B preparers.
Exact binary hashes, configuration hashes, and deployed versions are in the evidence archive.

Each wallet retains thirty-two prepared candidates. Preparation produces four candidates, and signing consumes two at a time.
Admission requires sixteen ready candidates and permits one active operation service-wide.
The wallet cooldown remains sixty seconds. Wallet-seed recovery and canonical FIPS seed/key export semantics are unchanged.
The test client checks returned keys against ordinary FIPS key generation from the synthetic wallet seed.
No production cryptographic code or policy changed during this campaign.

Hosted timings include client transport and private Worker execution. Registration also includes native client verification.
Browser login, approval, public Gateway admission, NEAR submission, and finality are outside these hosted timings.
The [local browser lifecycle](../evidence/ml-dsa-65-local-isolation-20261023.json) separately covers recovery, QR linking, FIPS export, restoration, and a finalized testnet transaction.

## Separated topology measurements

| Operation | Samples | Range | Median | Below five seconds |
| --- | ---: | ---: | ---: | ---: |
| Prepared creation/recovery | 4 | 5.545–8.372 s | 7.868 s | 0/4 |
| Successful signing HTTP request during load | 10 | 1.299–7.907 s | 3.317 s | 8/10 |
| Complete signing demand, including policy retries | 10 | 2.649–15.321 s | 7.537 s | 3/10 |

The registration set contains two creations and two recoveries. Both wallets preserve the same canonical public key across recovery.
The five-minute load phase submits one demand per wallet per minute with independent HTTP clients.
All ten load signatures verify. Two duplicate checks return the same signatures without another signing operation.
The run records twelve wallet-cooldown refusals and one service-capacity refusal.
These waits contribute to complete demand time. They are separate from an admitted signing request.

The load range excludes the preceding initial-stock signatures.
Those successful operations take 1.407, 6.735, and 13.938 seconds.
Another initial-stock operation exhausts eight pairs, or sixteen candidates, after 6.968 seconds.
Its recorded outcome is rejection-sampling exhaustion. It is separate from the control's storage failures.
The first wallet's lifecycle test therefore reports failure even though creation and recovery checks pass.

Initial registration preparation takes 72.602–92.093 seconds, with an 84.785-second median.
This request prepares key-generation material and initial signing stock. It is not one four-candidate refill.
The prepared-registration values exclude that wait. An empty generic pool still exposes preparation delay.

## Where the remaining time appears

Router-local milestone intervals place the registration execution phase at 2.724–5.309 seconds.
The installation phase takes 1.659–3.372 seconds.
These are coarse phase observations within one invocation. They do not partition CPU, storage, and transport precisely.
Do not subtract timestamps from different Workers to estimate any phase.

The ten successful load requests join exactly to both participant traces.
The two requests above five seconds consume four and seven pairs.
Seven load requests are the first signing call observed in both participant module instances.
That label does not prove a cold isolate, and the small cohorts do not isolate a causal cache benefit.
The 13.938-second initial-stock signature consumes three generic pairs. The 6.735-second signature also consumes three generic pairs.
This variation prevents a simple constant latency-per-pair model.

The trace sanitizer retains validated public request IDs so the forwarding Router can be matched to the dedicated Router.
Forty-nine exact joins are available. Their forwarding-Worker CPU has a one-millisecond median and a 112-millisecond maximum.
These provider CPU readings do not measure the extra hop's network latency.
Provider deployment checks report two-millisecond startup for each separated Router and twenty-three milliseconds for the combined Router.
Deployment startup checks are separate from user-visible cold-request latency.

Forty-two preparer-B requests have a 4.288-second median CPU time and a 9.310-second median wall time.
Wall time ranges from 4.424 to 25.336 seconds.
This measures the B-side request. It excludes complete producer dispatch, publication, and settlement, and cannot qualify whole-presignature latency.

## Capacity and failure limits

Both wallets have sixteen ready pairs and zero reservations at the recorded initial and final endpoints.
Observed capacity stays within the thirty-two-candidate cap.
The load consumes twenty-five distinct pairs, while the accounting excludes thirty-two starting pairs.
There is no common post-initial-stock interval. The material ledger is incomplete.
Full reserve endpoints alone do not establish sustained production capacity.
Two wallets, five minutes, and ten successful load signatures cannot establish p99 latency or production scalability.

The first combined control creates a key in 8.141 seconds and verifies a signature in 4.055 seconds.
Recovery preparation then returns HTTP 500 after 115.574 seconds.
B reports a storage timeout/reset within one invocation. Five repeated error entries do not represent five independent incidents.
A reports registration execution failure. The participant-to-client failure association remains a timing/path inference.
The Router trace does exactly match the failed request ID and upstream HTTP status.

An unchanged-control repeat uses fresh wallet IDs and separate evidence files.
It fails before key creation: preparation returns HTTP 500 after 132.025 seconds.
B and preparer A report internal Durable Object storage errors and resets.
This is recurrence at the storage boundary, rather than proof of the same exact error or a platform-only cause.
Application workload, overlapping refill, provider behavior, and observer overhead remain open explanations.
Neither control reaches a completed load phase. Both failures remain in the archive.

An independent review checked the counts, timing calculations, exact versions, and failure categories.
It also identified repeated handling of one producer job, including publication before a later settlement failure.
The diagnostic record preserves those qualifications. No timeout increase or speculative production fix follows this campaign.

## Next high-impact work

1. Reduce registration execution and initial-stock installation costs. Keep the same ready requirement and capacity when testing a change.
2. Profile the expensive initial-stock path and repeated pair execution separately. Retain two-at-once consumption and report exhausted operations.
3. Isolate the storage-reset failure with correlated storage/producer evidence. Complete the material ledger before a longer capacity run.
4. Repeat hosted browser recovery/linking and rehearse state-preserving deployment after those failures are resolved.

The five-second target, sustained capacity, hosted browser lifecycle after the split, and live namespace transfer remain unqualified.

## Evidence and reproduction

The [summary](../evidence/ml-dsa-65-modularity-hosted-20261023.json) links a compressed public-data archive.
It contains sanitized traces, client artifacts, exact versions, preserved failures, campaign scripts, and cleanup receipts.
It contains no benchmark credential values or wallet secrets.
The original [preflight record](../evidence/ml-dsa-65-modularity-hosted-preflight-20261023.json) remains an immutable record of the earlier pending-approval state.
Approval, upload, deployment, measurement, and cleanup are complete for this campaign.

To reproduce the analysis offline, extract the archive's `json` and `text` maps into a fresh directory, preserving relative paths.
Write JSON entries as JSON documents and text entries as UTF-8 files. Then run `python3 analyze.py` in that directory.
For a new hosted run, build the pinned artifacts, provision fresh synthetic wallets, and use the archived campaign sequence with a reviewed credential scope.
Do not reuse consumed preparation material or treat the archived credentials' hashes as credential values.

The trace-diagnostic change passes real-data collection, independent review, and whitespace checks.
The bloat check retains its unchanged Rust duplication excess: 13,972 lines versus a 13,754-line baseline.

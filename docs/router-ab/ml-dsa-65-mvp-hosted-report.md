# ML-DSA hosted MVP qualification — October 31, 2026

The public SDK lifecycle passes on Cloudflare. This campaign also fixes a cold-registration gap.
The measured latency and balanced scaling targets remain open.

## Public lifecycle and modular loading

The original hosted campaign passes registration, canonical seed export, recovery, full-owner QR linking, onward linking, revocation, and participant restoration.
A restored signer submits a finalized NEAR testnet transaction.
The final preparation correction also passes a separate complete hosted lifecycle repeat.
Together, these two receipts retain sixteen independently verifiable ML-DSA signatures.

Wallet presents mandatory session consent despite caller requests for hidden or automatic approval.
Original, linked, and recovered full-owner devices retain export rights.
Ordinary Ed25519 and ECDSA flows skip optional ML-DSA cryptography.
The final Wallet and VoiceID tarballs exactly match their earlier accepted tarballs.
Only Wallet Server changes. All forty-eight files across its eight packaged Worker builds match the retained builds.
These are unpublished local packages. No production release or branch merge occurred.

## Cold registration correction

The original public Create key flow could wait indefinitely when generic preparation stock was empty.
The authenticated registration route returned unavailable without starting preparation.
Earlier hosted lifecycle fixtures called a private preparation route first, which concealed this integration gap.
The new browser case reproduces the missing behavior through the actual Signing keys screen.

The correction records bounded, durable preparation demand in the existing admission object.
Demand is shared only within the same tenant, group, and schedule configuration.
The queue deduplicates requests, retains failed-scope backoff, and lets other scopes proceed.
It retains completed or claimed work after a lost reply.
Interrupted correlations are retired and replaced with fresh material.
The existing heavy-computation guard also covers generic preparation in both participants.
No new public route, scheduling service, compatibility mode, or pool setting is introduced.

The hosted cold case completes in **69.232 seconds** from Create key to publication.
Its exact job starts after the click, settles successfully, and appears in execution for the published operation.
The preparation span is **55.386 seconds**. The retained timestamps distinguish preparation from later execution and publication.
The signer persists after reload and unlock. The wallet's default signer remains unchanged.
This cold run uses the reviewed queue before the final configuration-block deduplication.
The separate final lifecycle repeat uses the final packaged code.

The native SQLite E2E checks restart, partial work, late completion, lost replies, claim races, queue fairness, backoff, and expiry.
The real local Workerd registration E2E also passes canonical recovery and signing.
These local results establish behavior. They do not establish hosted latency.

## Latency boundaries

The two-wallet SDK sample includes automatic transaction approval. It excludes stock preparation and NEAR enrollment.
It records eight successful signatures across four simultaneous rounds.
It provides a small sample rather than a percentile or latency guarantee.

| Measurement | Observed result |
| --- | --- |
| Prepared SDK registration | 8.32 and 9.92 seconds |
| Initial preparation for those registrations | 69.63 and 96.12 seconds |
| Successful SDK signing | 3.76–10.62 seconds |
| Cold settings creation after the correction | 69.23 seconds, including preparation |
| Four-candidate refill, four-wallet run | 8.57 seconds median, 7.48–14.12 seconds range |
| Four-candidate refill, eight-wallet run | 8.78 seconds median, 7.23–21.00 seconds range |

Initial registration preparation includes key-generation preparation and initial signing stock.
It is a different operation from one four-candidate refill.
Email-proof negative probes in the lifecycle test add deliberate work. Their timings are not ordinary signing benchmarks.

## Sustained useful output

Both capacity windows run for six minutes and restore every wallet to its starting sixteen-pair reserve.
The throughput denominator includes the closing restoration period.
Each wallet keeps thirty-two candidates. Preparation uses at most four candidates, and signing consumes two at a time.

The capacity profile enables two preparation slots and one signing slot per group, with a five-second synthetic-wallet cooldown.
Offered demand is one transaction every twenty-five seconds per wallet.
Production defaults remain one group, one preparation slot, one signing slot, and a sixty-second cooldown.
The measured capacity rates do not qualify the production default's single preparation slot.

Capacity drivers call a private forwarding Worker and the dedicated ML-DSA Router.
They exclude the public Gateway, SDK, browser, authentication, and NEAR finality.
These rates must remain separate from end-user latency.

| Closed-cycle measurement | Four wallets / one group | Eight wallets / two groups |
| --- | --- | --- |
| Verified signatures | 54 | 97 |
| Signatures/minute, including restored reserve | **7.50** | **10.71** |
| Actual group distribution | 4 | **5 / 3** |
| Successful private call, median / maximum | 0.81 / 2.26 seconds | 0.77 / 3.23 seconds |
| Complete successful demand, median / maximum | 2.02 / 34.44 seconds | 2.69 / 111.66 seconds |
| Candidates consumed per successful signature | 5.59 | 5.65 |
| Failed operations | 1 | 1 |
| Empty-pool responses | 112 | 515 |
| Service-capacity responses | 131 | 332 |

An unavailable response is a polling observation. It is not a distinct failed transaction.
Complete demand time includes admission and empty-pool waits.
A failed operation exhausts its admitted candidates. The capacity driver can retry a fresh operation within that demand.
The public SDK still surfaces candidate exhaustion as a generic signing error.
The failed setup signature for the third two-group wallet remains in its original artifact.
All eight setup wallets pass canonical key generation and recovery checks. That does not make every initial signing check pass.

The material equations balance exactly:

- Four wallets: 64 initial pairs + 151 new pairs = 151 consumed pairs + 64 final pairs.
- Eight wallets: 128 initial pairs + 274 new pairs = 274 consumed pairs + 128 final pairs.

There are no unaccounted lost pairs or observed cross-operation reuse in these windows.
The final trace captures converge. Published jobs have exact claims, producer execution, paired publication, and successful settlement.
Cancellations remain counted. The closed windows contain no unclassified exception category.
Starting material does not cover the full window for every wallet. Exact origins and the complete ledger account for this limitation.
Expiry plus disappearance does not establish the retirement cause.
The eight-wallet window also captures twenty-one inactive-wallet preparation jobs. Their CPU remains in the reported cost.

## Scaling qualification and idle return

The eight-wallet result demonstrates useful output from two groups with a larger active cohort.
It does not pass the planned balanced four/four qualification.
The first two allocation windows contain calls to the directory's previous Worker version, while their external Router uses the new version.
Later allocations use the new directory version. Persisted placement remains immutable.
Directory events lack parent request identifiers, so the retained timing correlation does not prove exact invocation parenting.
The strict balance qualifier still fails and is included in the offline replay.
A fresh balanced cohort requires verified effective rollout before allocation.

A separate short idle-return screen passes with five verified signatures and restored material accounting.
The two returning wallets retain their original group.
This short screen does not qualify one-hour idle expiry behavior, maximum population, or proportional scaling.
Recorded Wasm memory excludes the JavaScript heap.

## Evidence and cleanup

The [public receipt](../evidence/ml-dsa-65-mvp-hosted-20261031.json) retains source hashes, exact deployment versions, lifecycle receipts, measurements, package identities, and cleanup results.
The [compressed replay](../evidence/ml-dsa-65-mvp-hosted-20261031.tar.gz) retains normalized capacity traces, public requests, material ledgers, original setup failures, and analysis scripts.
It excludes unrelated earlier empty traces. Replaying the retained data reproduces every reported capacity calculation exactly.
Raw request headers, credential payloads, OTP codes, and exported private seeds remain outside public evidence.

Run:

```sh
node docs/evidence/ml-dsa-65-mvp-hosted-20261031.mjs
```

The verifier checks 172 signatures and rejects altered messages.
It reproduces three complete material ledgers and preserves the failed balanced-scaling result.
It checks retained receipt assertions. It does not rerun Cloudflare, browser authentication, NEAR finality, or cleanup API calls.

The approved fifteen Workers, their Durable Object namespaces, four databases, and two buckets are deleted.
Authenticated resource lists verify their absence.
The earlier quiet-producer fleet remains outside this approval and is untouched.
One redeployment encountered Cloudflare API error 10500. The same approved deployment succeeded on retry.
The failure is retained as an infrastructure event. No credential payload changed.

Configured intended-browser type checks and strict release builds pass.
The bloat gate retains its inherited failure: 13,992 duplicated Rust lines against a 13,754 baseline.
This correction adds no duplicated Rust lines to that inherited count. The baseline remains unchanged.

## Remaining high-impact work

1. Handle candidate exhaustion without losing the user's transaction context. Preserve exact operation binding, cooldown accounting, and single-use material.
2. Reduce cold generic preparation cost and expiry-maintenance work. Measure useful refill output rather than hiding those costs with additional stock.
3. Repeat a fresh balanced two-group cohort after verifying directory rollout. Measure the selected operational profile before enabling additional groups.

Prepared registration at five to seven seconds and consistent three-to-five-second SDK signing remain unqualified.
The [bounded privacy review](ml-dsa-65-mvp-gates-report.md#privacy-review-boundary) still defines the security evidence.
This campaign adds public-metadata scheduling and lifecycle validation. It does not establish a complete protocol composition proof or FIPS module validation.
Wallet-seed recovery, standard FIPS seed/key export, participant separation, two-at-once consumption, and pool capacity remain unchanged.

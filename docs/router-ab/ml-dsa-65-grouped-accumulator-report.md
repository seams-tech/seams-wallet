# ML-DSA grouped accumulator experiment

The grouped accumulator provides no useful hosted preparation gain. Both prototype variants are removed.
The quiet Node-Wasm encoder screen improves about 22%, but complete Worker measurements do not reproduce that improvement.
The candidate uses more paired producer invocation CPU than either control. Its publication time falls between the controls.
Production encoder code and all experimental dependency changes are restored to source base `cc18f24e505f3dd2d168859c419b392436d88a35`.
The corrected encoder comparison and public benchmark diagnostics remain.

Four-candidate job medians remain near ten seconds in this campaign. The six-second target remains open.
The next experiment should separate private AES setup, AES rounds, and buffer handling in the production correlation path.
Private AES is the largest category in the preceding calibrated local profile.
No new cipher, larger pool, or preprocessing service is introduced.

## Complete hosted comparison

Eight approved temporary Workers serve two synthetic wallets. Both wallets start with the existing full reserve.
Each window deliberately retires thirty-two candidate pairs, then restores both reserves with thirty-two fresh pairs through sixteen jobs.
Each job prepares four candidates. Signing consumes two candidates at a time.
Each wallet retains capacity for thirty-two candidates and the sixteen-candidate admission minimum. The cooldown remains sixty seconds.
Wallet-seed recovery, canonical FIPS export, separate participant custody, and the passive model remain unchanged.

Only the four producer artifacts change between the baseline, candidate, and return-baseline arms.
The Router, online A/B participants, and controllers remain fixed during the three windows.
Actual producer versions match arm receipts and the retained provider deployment history.
Each window sends eight jobs to each physical producer with the intended routing.

| Arm | Primary A / B CPU medians | Secondary A / B CPU medians | Paired producer invocation CPU | Last paired publication | Client detects restored reserves |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 4.380 / 4.544 s | 4.342 / 4.478 s | 147.130 s | 93.304 s | 94.522 s |
| Grouped candidate | 4.478 / 4.618 s | 4.382 / 4.578 s | 152.518 s | 91.480 s | 95.848 s |
| Return baseline | 4.235 / 4.412 s | 4.376 / 4.581 s | 144.925 s | 86.893 s | 89.804 s |

The CPU sum includes both participant invocations for all sixteen complete jobs.
It excludes producer dispatch, Router, and pool-actor CPU. The archive retains all invocation outcomes.
Complete captured CPU totals are 153.932, 158.574, and 150.961 seconds, including benchmark inventory traffic.
Candidate CPU is 3.7% above the first control and 5.2% above the return control.
These small cohorts support rejection of the prototype. They do not establish a stable causal regression percentage.

Inventory polling runs every five seconds. Detection lags are 1.218, 4.368, and 2.911 seconds in sequence order.
The candidate publishes earlier than the first control and later than the return control.
Its slightly longer client-observed interval cannot alone establish slower publication.
The complete comparison establishes no useful CPU or publication benefit.

| Arm | Primary A invocation wall median | Secondary A invocation wall median |
| --- | ---: | ---: |
| Baseline | 10.219 s | 10.564 s |
| Grouped candidate | 10.007 s | 9.979 s |
| Return baseline | 9.923 s | 9.731 s |

Every window publishes exactly thirty-two unique fresh pairs. Both participants' publication IDs match the final ready reserve.
Published IDs are disjoint from retired IDs. No retired material reappears.
All forty-eight timed jobs complete without an unsuccessful cryptographic invocation, exception, load shedding, or truncated trace.
Canceled alarms and control calls remain in the outcome counts. No outside-start invocation overlaps a qualified window in retained observations.
Each job retains the same traffic: A sends 3,967,488 bytes and receives 1,434,560 bytes. B has the reverse totals.
Observed stage memory remains 90.125 MiB on A and 90 MiB on B.
These observations exclude transient, JavaScript, and total isolate peaks.

These retirement/refill screens measure preparation cost and reserve restoration.
They do not qualify signatures per minute, signing tails, or public SDK latency.
The historical twofold producer difference also remains unexplained. These fresh controls do not reproduce it.

## Registration, recovery, and standard signatures

The hosted baseline control creates a canonical key and recovers the same key from the wallet seed.
Creation takes 9.237 seconds including client verification. Recovery takes 7.494 seconds.
Their initial signatures take 6.195 and 8.566 seconds.
Generic registration preparation separately takes 101.692 and 104.795 seconds.
These are individual private Router samples. They exclude public SDK work, human approval, and NEAR finality.
They do not establish the target latency distribution.

After candidate refill, the native-fixture signer and recovered signer produce standard signatures in 8.514 and 1.827 seconds.
Independent OpenSSL verification passes. Altered messages fail verification.
Both participants record matching take sequences. The signatures use four pairs and one pair respectively.
All five pairs come from the candidate window's fresh published reserve.
The archive includes a standalone verifier for both signatures.
Native tests also verify canonical key generation, wallet-seed restoration, and ordinary FIPS seed/key export.

## Local experiment and exact-output checks

The preceding calibrated profile attributes about 24% of local samples to silent-OT code encoding.
Its accumulator loop contributes 2,366 A self samples and 2,399 B self samples.
Expander refill contributes another 936 and 984 self samples.
These are local samples, rather than billed CPU or hosted stage attribution.
The public ExConv code serves silent-OT preparation. It is distinct from ML-DSA's lattice matrix.

The prototype groups four accumulator rows. It finalizes dependencies in source order, then combines repeated XOR updates to each future target.
Public matrix bits select among sixteen private XOR combinations.
The table uses 256 bytes and is erased on the normal path. The original scalar code handles remainders and wraparound.
The matrix seed, code parameters, encoded bytes, protocol messages, and single-use boundaries remain unchanged.

| Screen | Full-output checks | Baseline median | Prototype median | Qualification |
| --- | ---: | ---: | ---: | --- |
| Quiet grouped encoder | 463 | 46.144 ms | 35.987 ms | Local kernel only |
| Compile-time unroll | 463 | 45.771 ms | 35.476 ms | Local kernel only. Never deployed |
| Restored production control | 463 | 51.739 ms | 51.666 ms | Identical production algorithms |

The quiet screen alternates twenty paired measurements in one Wasm module and includes allocation and checksum work.
Correctness cases compare every Block and byte. They cover multiple widths, passes, seeds, refill boundaries, and production dimensions.
The unroll changes little beyond the grouped variant. No further Worker deployment was justified.
A separate bounds-removal variant improved local encoder time by about 4% and introduced unsafe indexed writes.
That variant was also removed. All rejected patches and measurements remain in the archive.

The complete candidate local Worker lifecycle passes standard signing, interruption, restart, and publication-failure scenarios.
Its first full reserve takes 31.094 seconds. This single result does not establish complete-flow acceleration.
The fresh baseline fault scenario fails as described below and cannot serve as a passing timing control.
An earlier encoder screen overlaps builds and remains excluded from controlled timing claims.

Independent source and compiled-Wasm review finds no ordering, refill, bounds, or privacy blocker in the deployed grouped variant.
Indices depend on public matrix bits. Secret coefficients remain XOR operands.
The compiled normal exit erases all sixteen table entries.
This bounded review excludes register erasure, JIT timing, and cleanup after an aborting panic.
The hot private AES function is byte-identical across baseline and candidate in both roles.
That identity does not explain the hosted performance difference.
The unbuilt unroll has no compiled Worker review or hosted performance claim.

## Measurement improvements retained

The encoder comparison previously copied child modules from the current working tree while taking its top file from Git.
It now reads the complete baseline module tree from the selected revision and records module hashes.
This prevents future child-module changes from contaminating the control.
The expanded comparison retains 463 full-output cases, including RNG refill and first-group boundaries.
No unit tests or production variant flags were added.

The benchmark front now retains existing public registration, transport, stage, and wait observations.
It also retains validated job IDs, operation IDs, and known registration command names.
It excludes request bodies, authentication headers, private payloads, and exception messages.
The enriched instrument records nonzero diagnostic events during the hosted registration control.

## Failures and limits

The full 5,041-record capture contains failures before the qualified windows.
Record 76 reports A registration `exceededWallTime` at `1793103135011`.
Records 3098 and 3299 report Router admission-control exceptions at `1793104248149` and `1793104366927`.
None overlaps a timed comparison window. The complete capture remains archived.

The first actual hosted registration returns HTTP 500 after 30.083 seconds, following successful generic preparation.
Its cause remains unknown. The successful fresh-wallet retry proves no repair.
The archive preserves the failed request, successful retry, and all public diagnostics.
A separate earlier fixture setup lacked its local public-key file and generated mismatched local holder keys.
Classification: `obsolete_test_or_fixture`. Restoring the approved local keys and deriving their public keys resolves that setup error.
No cloud credential changed for this repair.

The fresh local baseline loses an injected take reply. A sends thirty-two bytes, receives none, and waits 30,026 milliseconds.
Expiry closes the fifteen remaining reservations per role before full-scope paired fencing completes.
The specification permits conservative retirement when exact unopened evidence is unavailable.
The test then unconditionally requires retained material without establishing timely paired fencing.
Classification: `valid_test_needs_update` at the scenario boundary. The underlying timeout cause remains unknown.
No production deadline or test assertion changed. This failed run supports no complete-flow speedup claim.

The required bloat check retains its inherited Rust duplication failure: 13,992 lines against the 13,754-line baseline.
This change adds no Rust duplication. No baseline was weakened.

## Facts and causes

| Fact | Instrument | Boundary | Check |
| --- | --- | --- | --- |
| Local encoder output matches in 463 cases | Paired complete encoders | Node-Wasm | Every output element compared |
| Local grouped encoder improves about 22% | Alternating paired kernel timings | Quiet local run | Exact sources and module hashes retained |
| Hosted candidate uses more producer CPU | Platform invocation records | Sixteen complete jobs per arm | Both A/B invocations and actual versions checked |
| Candidate publication falls between controls | Both participants' publication checkpoints | Three complete reserve restorations | Exact fresh IDs match final ready stock |
| Timed preparation has no failed crypto | Complete sanitized invocation capture | Qualified windows plus overlap checks | All outcomes and setup failures retained |

| Candidate cause or opportunity | Relevant evidence | Status |
| --- | --- | --- |
| Repeated indexing is the main encoder cost | Bounds removal improves only about 4% locally | Insufficient gain for added unsafe code |
| Grouping repeated XOR writes helps locally | Quiet complete encoder improves about 22% | Supported only for the local encoder |
| Local encoder improvement accelerates Workers | Hosted CPU rises and publication gain is inconsistent | Contradicted for retaining this prototype |
| Five-second polling explains client differences | Detection lag differs by arm | Measured confound. Publication is reported separately |
| Different private AES code explains results | Hot function bodies match exactly | No support for a source-body explanation |
| Host execution or generated-code interactions explain the gap | No hosted inner-function attribution or remote JIT data | Unknown. A matched hosted profile or provider data is needed |

Measured: output equality, local kernel acceleration, complete hosted CPU, publication IDs, signatures, and reserve restoration.
Inferred: the grouped implementation is unsuitable as a production performance improvement on this evidence.
Unknown: why the local encoder gain fails to transfer, and the historical slow-producer cause.
The next useful measurement is finer AES attribution in complete preparation, followed by a separately controlled Worker experiment.
Earlier draft wording that hosted performance remained unmeasured is superseded by this completed comparison.

## Evidence and cleanup

All eight approved temporary Workers were deleted. Independent provider checks return absence code `10007` for each.
The campaign creates no D1 database or R2 bucket.
The public archive uses an explicit file whitelist and scans credential strings plus decoded and encoded key forms.
It intentionally retains deterministic disposable test seeds and ordinary test-key exports.
Generated credential files and encrypted role fixtures were removed after the final evidence scan.
All 125 archive member hashes pass. Offline replay reproduces 5,041 normalized records and all three comparison summaries exactly.

- [Machine-readable comparison and hashes](../evidence/ml-dsa-65-grouped-accumulator-20261027.json)
- [Replay archive, complete traces, rejected patches, and validation](../evidence/ml-dsa-65-grouped-accumulator-20261027.tar.gz)

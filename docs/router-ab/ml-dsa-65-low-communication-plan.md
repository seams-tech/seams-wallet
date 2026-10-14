# ML-DSA-65 preparation with lower communication

Original investigation: October 14, 2026. Updated October 15, 2026. Branch: `ml-dsa`.
Production integration remains paused.
The [implemented prototype and hosted profiles](ml-dsa-65-silent-prototype-report.md) supersede the forecasts below for product decisions.
The current full-block IKNP bootstrap transfers more than the libOTe native screen.
Its complete successful four- and eight-candidate reservations use 6.89 MB and 12.22 MB of protocol payload.
Exhaustion and repeated reservations add cost. First-signature readiness remains unqualified.

## Decision

Keep canonical FIPS ML-DSA-65 seed and key export. The user explicitly confirmed this requirement.
Wallet-seed recovery must reproduce the same ordinary key through the existing derivation binding.
Keep two passive, honest participants, uniform secret shares, and private commitments when either secret bound fails.

Reject the current 32-candidate preparation design because its recurring traffic is too large.
Its one completed hosted signature takes 0.469 seconds online after 429.266 seconds of preparation.
The next request fails during online signing. These results establish neither reliable service nor a production latency percentile.
The [hosted report](ml-dsa-65-resident-prepared-performance.md) retains the complete campaign.

The first prototype now uses silent-OT binary triples with four- and eight-candidate reservations.
The next prototype needs a ready pool and a measured key-activation stage.
A binary triple supplies private random bits whose shared product supports one Boolean AND operation.
Silent OT generates many such triples with a small exchange and local expansion.
It adds an LPN assumption, which concerns decoding noisy linear equations.
It changes the correlation generator without changing the canonical key or the current disclosure boundary.
The complete composition still requires review and measurement.

## Why another runtime optimization is insufficient

The [native complete signer](../evidence/ml-dsa-65-fixed-base-complete-native-20261014.json) measures these recurring preparation bytes for 32 candidates.
The totals sum bytes sent in both directions once. Initial key generation is outside this interval.

| Component | Bytes |
| --- | ---: |
| Fresh base OT | 21,217,280 |
| OT extension matrices | 671,211,520 |
| Masked Boolean OT messages | 84,008,960 |
| Nonce preparation in Yao and other setup | 587,284,610 |
| **Total** | **1,363,722,370** |

Amortizing base OT across three stages saves approximately 21.17 MB, or 1.55% of the total.
Replacing only the online circuits' correlations still leaves approximately 587 MB of preparation.
The next prototype must also move nonce conversion and private commitment decomposition from Yao into GMW.
GMW evaluates Boolean circuits on shared bits with private multiplication correlations.
Public matrix expansion, polynomial arithmetic, challenge products, and accepted-signature encoding remain local.

Canonical key generation remains the reviewed prepared half-gates flow.
Its nine hosted requests finish below five seconds after readiness, including a real sampler continuation.
The measured range is 1.129–2.003 seconds, with a 1.308-second median across eight measured requests.
Readiness takes 37.015–51.875 seconds. Cold key creation has no five-second claim.

## Native correlation screen

The [screen artifact](../evidence/ml-dsa-65-silent-triples-native-screen-20261014.json) pins libOTe and its dependencies.
It uses commit `c1796737a91e5142b22ad7564f22bed1d9f2d957`, explicit `ExConv7x24`, regular noise, and the library's 128-bit security parameter.
Each sample starts fresh real base OT. The build disables mock OT.
Every generated triple passes its algebraic relation and a separate shared-AND check after timing.

| Triples per chunk | Total traffic | Native median | Peak process RSS |
| --- | ---: | ---: | ---: |
| 65,536 | 74,473 B | 46.479 ms | 11.06 MB |
| 262,144 | 84,713 B | 126.371 ms | 37.63 MB |
| 1,048,576 | 94,953 B | 487.599 ms | 143.71 MB |

Each row contains three measured fresh-process samples. Warm-up and an unaligned count have separate records.
RSS measures the process memory peak for both logical roles together. It cannot be divided by two to establish Worker fit.
The transport is an in-process coroutine socket. Timing excludes socket creation, OS randomness initialization, and verification.
This screen measures neither complete signing nor network latency.
The implemented adapter retains the 262,144-triple chunk and uses a separately documented parameter profile. The million-triple case provides no Worker memory qualification.

The selected [Expand-Convolute construction](https://eprint.iacr.org/2023/882) uses an LPN-based correlation generator.
That work identifies attacks against Silver codes. This prototype excludes Silver.
The [pinned implementation](https://github.com/osu-crypto/libOTe/blob/c1796737a91e5142b22ad7564f22bed1d9f2d957/libOTe/Triple/SilentOtTriple/SilentOtTriple.cpp) provides binary triples directly.
This avoids assuming that a generic field-VOLE primitive has a free conversion to Boolean triples.

An independent review found that the wrapper initially configured its inner engines through a default code type.
At this revision, the default and selected code produce the same dimensions and noise parameters.
The reviewer withdrew the initial claim that this invalidated the measurements.
The retained rerun explicitly configures both inner engines before base setup and records their dimensions.
It produces the same byte totals. The retained 126.371 ms median supersedes the earlier 127 ms estimate.

## Expected recurring payload

The [reproducible model](../evidence/ml-dsa-65-low-communication-model-20261014.json) uses recorded circuit sizes and the measured 262,144-triple chunk.
Each candidate needs 412,928 nonce ANDs and 580,159 online ANDs, totaling 993,087 triples.
Chunk generation includes fresh base OT. The model discards the final chunk's unused padding within each reservation.

| Candidates per independent reservation | Counted payload per reservation | Expected counted payload per signature | Modeled p99 reservations consumed |
| --- | ---: | ---: | ---: |
| 1 | 1.935 MB | 9.948 MB | 22 |
| 2 | 2.800 MB | 7.972 MB | 11 |
| 4 | 4.013 MB | 6.929 MB | 6 |
| 8 | 6.670 MB | 8.106 MB | 3 |
| 16 | 13.256 MB | 13.685 MB | 2 |
| 32 | 26.512 MB | 26.538 MB | 1 |

These are payload projections. No complete-signer measurement covers these totals.
They include correlation generation, nonce circuit openings and outputs, and online circuit openings and outputs.
They exclude bindings, response reconstruction, extra messages for public hint rejections, Worker/WebSocket framing, storage, abandoned reservations, and initial key generation.
The measured correlation chunks include their native coproto control metadata and message headers.
The model reproduces existing measured online gate traffic for both four- and 32-candidate GMW runs.

For a group with `g` ANDs and `n` parallel lanes, both roles transmit `4*g*ceil(n/8)` opening bytes.
This includes byte padding. The ideal half-byte-per-AND estimate understates traffic for small groups.
The attempt model assumes independent attempts and an unlimited supply of ready reservations.
It assumes 5.14 attempts per fully valid signature candidate, including the public hint checks.
This includes hint failures in the retry probability. Their extra messages and work remain outside the counted payload.
It predicts `1/(1-(1-1/5.14)^b)` consumed reservations for batch size `b`.
The p99 column describes candidate exhaustion alone. It supplies no service latency or reliability bound.

Four candidates give the smallest expected payload among these modeled sizes.
Eight candidates reduce the modeled expected exchanges per successful signature.
They also reduce repeated request overhead in that model.
Each evaluated reservation still needs 227 dependent AND-layer exchanges, plus bindings and outputs.
Measure both sizes before selecting one.

## Specialized signing comparison

The [Mithril screen](../evidence/ml-dsa-65-mithril-native-screen-20261014.json) tests the authors' implementation at commit `66e269e75dd8f5d722675a3d276a1aedc58bc4ef`.
Across 100 measured signatures, its native median is 2.110 ms and mean total protocol traffic is 94,723 bytes.
The harness includes both roles, all rounds, combinations, and retries. OpenSSL verifies all 101 signatures, including warm-up.
This is a single-process resource comparison with a public fixture seed.

The default threshold seed path produces a different public key from ordinary FIPS key generation with the same seed.
The user's canonical export requirement excludes this path.
The [paper's existing-key discussion](https://eprint.iacr.org/2026/013) describes conditioned short sharing, which requires a separate parameter and privacy analysis.
The inspected implementation has no reviewed constructor for converting our uniform canonical shares into that format.
Repeated independent conditioned sharings can expose cumulative information about the same secret.
Recovery and refresh must account for that information before this route can become eligible.
Do not feed uniform modulo-q shares into the stock short-share signer or claim that its native timings cover canonical private import.

Keep [SoftSpokenOT](https://eprint.iacr.org/2022/192) as a secondary correlation candidate.
Its communication/computation tradeoff avoids adding LPN. Evaluate small-field choices 2 and 4 after measuring the complete silent-OT cost.
FOLEAGE and other field-correlation generators remain later alternatives. We did not measure their conversion or Wasm costs.

## Prototype checklist

- [x] Preserve canonical key generation, uniform shares, and the accepted disclosure boundary.
- [x] Implement bounded Rust/Wasm correlations with explicit dimensions and genuine full-block base OT.
- [x] Use RustCrypto AES and masked receiver scans for the new adapter.
- [x] Bind chunks and consume each correlation once across all five GMW stages.
- [x] Verify a complete signature before authorized canonical recovery.
- [x] Compare four- and eight-candidate hosted reservations, including all exhaustions.
- [ ] Separate generic preparation from key-specific activation and measure a first usable signer.
- [ ] Share public topology and compact private state for multiple ready reservations.
- [ ] Test durable consumption, interruptions, replay, concurrency, replenishment, and production Router transport.
- [ ] Complete target timing and independent production security review.

The current cryptoTools AES source has secret-indexed substitution tables, including ARM key expansion.
The [pinned AES source](https://github.com/ladnir/cryptoTools/blob/cc54d946a7643795b5f523fe235392de8271a5b3/cryptoTools/Crypto/AES.cpp) is the concrete porting issue.
The native screen is not constant-time qualification. Reuse a reviewed constant-time AES implementation where practical.
The port also needs bounded memory, secure random input, transport suspension, and secret erasure.
The worktree now contains a reviewed experimental Wasm adapter. Production timing qualification remains open.

Only untouched independent reservations may remain available for another message.
Burn every reservation that starts message-bound evaluation, including unused candidates after an earlier success.
After cancellation or an uncertain outcome, burn the affected reservation.
An empty pool must wait for fresh preparation or return an explicit unavailable result. It has no successful five-second claim.
Measure replenishment throughput and the new-key-to-first-signature interval separately from warm online latency.

For the hosted acceptance test, report every attempted request, its final state, all bytes, preparation time, and successful signing time.
Count exhaustion, infrastructure failure, and deadlines separately. Include real sampler continuations and canonical recovery checks.
Do not select a protocol from one successful warm request.

## Reproduction and cleanup

The [research harness instructions](../../tools/ml-dsa-investigation/research/README.md) reproduce the native screens and model.
Cleanup removed all temporary Workers and the R2 bucket from the preceding campaign.
The [cleanup record](../evidence/ml-dsa-65-prepared-final-cleanup-20261014.json) retains the deletion results.
The original October 14 screen had no hosted implementation. The October 15 report records the completed Worker campaigns and cleanup.

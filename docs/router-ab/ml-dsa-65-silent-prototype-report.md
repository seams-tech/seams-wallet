# ML-DSA-65 silent-correlation prototype

Date: October 15, 2026. Branch: `ml-dsa`. Production integration remains paused.

## Product verdict

The prototype produces standard signatures quickly after preparation and removes the earlier gigabyte-scale recurring transfer.
It does not yet meet the complete product requirement.
Small reservations can exhaust, and the current key-specific preparation delays the first signature.

Prepared canonical key creation passes the five-second target in all four hosted requests.
Successful hosted signatures also finish below five seconds in both signing profiles.
The [generated product summary](../evidence/ml-dsa-65-silent-product-screen-20261015.json) separates successful signatures, exhaustion, and infrastructure failures.

| Hosted operation | Successful online time, including warm-up | Result | Preparation/readiness |
| --- | ---: | --- | ---: |
| Prepared canonical key creation | 0.914–1.604 s | 4 keys from 4 requests | 37.8–43.7 s |
| Four-candidate signing reservation | 0.197–1.116 s | 3 signatures, 3 exhaustions | 40.9–68.3 s |
| Eight-candidate signing reservation | 0.202–0.569 s | 5 signatures, 1 exhaustion | 86.6–158.3 s |

The key-creation campaign includes a genuine SHAKE sampler continuation.
Every key matches the canonical wallet-seed recovery oracle.
All hosted requests complete cleanup and close normally. No infrastructure failure occurs in these campaigns.
An exhausted reservation returns no signature and does not count as a successful five-second request.
These small sequential samples establish no production percentile or throughput under load.

## Implemented flow

Canonical key generation still uses the reviewed prepared half-gates flow.
Wallet-seed derivation, standard FIPS seed/key export, public sampler decisions, and public `t0` remain unchanged.

The prepared signer now uses GMW for all five stages:

1. Convert jointly sampled nonce bits into private arithmetic shares.
2. Decompose the shared commitment without opening it.
3. Hash the message digest and private commitment.
4. Check the private response bounds.
5. Open only the combined decision for each candidate.

Public matrix expansion, polynomial arithmetic, challenge products, accepted-response reconstruction, hints, and encoding remain local.
Rejected commitments stay private when either secret bound fails.
Nonce preparation no longer generates Yao tables in this signing path.
Each consumed reservation discards every evaluated candidate and all remaining private handles.
The current adapter serves one reservation per request. It cannot automatically consume a second ready reservation after exhaustion.

The [native complete pipeline](../evidence/ml-dsa-65-silent-complete-native-20261015.json) verifies an eight-candidate signature before authorized canonical recovery.
Its four-candidate case exhausts. Its eight-candidate case takes 21.1 ms online after 7.17 seconds of native preparation.
The [mixed-circuit check](../evidence/ml-dsa-65-silent-gmw-native-20261015.json) also checks private output ownership and rejects mismatched layouts.
The [local eight-candidate Worker campaign](../evidence/ml-dsa-65-silent-eight-worker-local-20261015.json) produces three signatures in 49–59 ms after 32.4–32.7 seconds of readiness.

Direct uniform nonce sampling still replaces FIPS 204's prescribed message-bound hedged nonce procedure.
The keys, exported seeds, signature encoding, and standard signature verification remain compatible.
This prototype does not claim identical deterministic or hedged signature bytes to an ordinary FIPS implementation.

## Correlation backend and communication

The Rust adapter uses the pinned CryProt ExConv7x24 encoder and core primitives.
It reuses the existing transport and fresh IKNP base OT.
Base OT retains the existing Ristretto construction. This prototype adds no end-to-end post-quantum MPC security claim.
The selected silent construction adds the LPN assumption described in the [communication plan](ml-dsa-65-low-communication-plan.md).

Each fixed chunk produces 262,144 binary triples with these parameters:

- 256 noise partitions, each with a 4,096-element domain.
- Four parallel trees on every target.
- 3,072 base choices with complete 128-bit messages.
- No discarded sparse-vector coordinates before encoding.
- Hash both sender alternatives and the receiver-selected block before extracting correlation bits.

The fixed partition count rounds conservatively above the inspected reference's noise-weight formula at minimum-distance ratio 0.15.
It also avoids architecture-dependent partition rounding and interleaving.
Every chunk has a fresh binding and real base OT. Each stream entry is cleared when consumed.
Interrupted generation poisons the stream. Final padding and owned secret buffers are wiped on drop.

The [final primitive artifact](../evidence/ml-dsa-65-silent-correlations-native-20261015.json) retains four separate-process executions and a mismatched-binding rejection.
It checks every triple and the shared-AND identity after timing.
No plaintext dealer supplies the correlations.
Disposable output shares leave their processes only for the post-timer test recipient, then their temporary files are removed.

The adapter transfers **262,464 bytes per chunk**, including its binding.
The earlier libOTe measurement of 84,713 bytes uses a different bootstrap and parameter profile.
It cannot price this adapter. The earlier 7–8 MB forecast also does not describe the measured complete implementation.

| Per reservation, both directions | Four candidates | Eight candidates |
| --- | ---: | ---: |
| Preparation protocol payload | 5,124,225 B | 9,886,081 B |
| Successful online protocol payload | 1,763,464 B | 2,332,200 B |
| **Preparation plus one successful request** | **6,887,689 B** | **12,218,281 B** |

These counters exclude initial fixture key creation and transport envelopes.
The artifacts' raw transport counters retain those additional costs.
The benchmark recreates its disposable key for each request. A product with an existing key should not repeat that work for every signature.
Exhausted reservations still incur preparation and online costs.
Thus 6.89 MB is the cost of a successful four-candidate reservation, not an average cost per eventual signature across retries.

Both online profiles retain **227 dependent AND-layer exchanges**, plus bindings and outputs.
The [four-candidate campaign](../evidence/ml-dsa-65-silent-four-worker-hosted-20261015.json) and [eight-candidate campaign](../evidence/ml-dsa-65-silent-eight-worker-hosted-20261015.json) include every request.
They use same-account Cloudflare Service Bindings. Cross-account and production Router-path parity remain unestablished.

## CPU, memory, and operating cost

The [sanitized traces](../evidence/ml-dsa-65-silent-worker-traces-20261015.json) contain every signing invocation for both roles and deployed versions.
All recorded signing outcomes are `ok`, including completed requests whose reservations exhaust.
Cloudflare redacts request IDs in these traces. The summary uses aggregate counts filtered by operation and exact deployed version.
It does not invent a direct request-ID match.

The four-candidate campaign uses 309,217 CPU milliseconds across both roles and six requests.
The eight-candidate campaign uses 606,377 CPU milliseconds across both roles and six requests.
For the first eight-candidate request, A and B report 42,747 and 42,835 CPU milliseconds against approximately 86 seconds of wall time.
That observation supports CPU work as the main preparation cost in that request.
It does not identify one internal function as the bottleneck.

At the published Standard overage rate of $0.02 per million CPU milliseconds, these campaigns cost approximately:

| Campaign | CPU overage equivalent per verified signature |
| --- | ---: |
| Four candidates, including three exhaustions | $0.00206 |
| Eight candidates, including one exhaustion | $0.00243 |

That is approximately $2.1–$2.4 per thousand verified signatures in these small campaigns.
This estimate includes repeated fixture key creation, warm-up, and unsuccessful reservations.
It excludes minimum plan charges, included allowances, storage, and other product services.
It is not a production price forecast. The [Cloudflare pricing page](https://developers.cloudflare.com/workers/platform/pricing/) supplies the rate.

The maximum observed Wasm linear-memory sizes are 89,653,248 bytes for four candidates and 90,046,464 bytes for eight.
These values exclude JavaScript and other isolate allocations. They do not establish total memory headroom or concurrent-request capacity.
The tested signing path uses no R2 tables. Prepared key generation retains its grouped R2 tables.

## Privacy and timing review

Independent source review found no blocker to disposable hosted measurements under the accepted passive model.
It checked PPRF recovery, output masks, packed-choice hashing, cross-stage triple consumption, private commitments, and cancellation ownership.

The adapter replaces secret active-path indexing with public scans and arithmetic masks.
Its private AES work uses RustCrypto's portable implementation instead of the C++ reference's secret-indexed substitution tables.
The [packaged Wasm inventory](../evidence/ml-dsa-65-silent-eight-wasm-instructions-20261015.json.gz) retains functions and their inlined caller for the eight-candidate deployment.
Three division/remainder sites use public schedule widths or public encoder dimensions.
Representative receiver equality, masking, and packed-choice injection remain arithmetic in Wasm.
The inspected `sub_bytes` bodies have no branches, calls, or division.

This is a targeted data-flow review. Other caller branches, addresses, helpers, and V8 machine-code timing remain unqualified.
The instruction inventory alone supplies no complete constant-time proof.

Two build/diagnostic corrections followed measurement:

- The standalone crate now declares the AES-buffer zeroization feature explicitly. Deployed builds already obtained that feature through their dependency graph.
- Progress now reports `binding_phases_started`. The recorded `instances_started` field counts binding notifications, including silent-chunk bindings, and must not be read as a circuit count.

The vendor directory records the pinned source and local manifest changes.
Two upstream dead-code suppression annotations are removed for repository policy. Functional vendor source remains unchanged.
The [final local control](../evidence/ml-dsa-65-silent-four-worker-local-20261015.json) checks the current progress schema and complete signing path.
It produces one signature at 49.8 ms and two exhausted reservations after 17.6–18.2 seconds of readiness.

## Required next prototype

The next prototype should validate **usable signer registration**, including first-signature readiness, with a ready pool.
The current signing preparation is key-specific and starts after the key exists.
Moving that work out of the signing timer does not make new-wallet registration complete within five seconds.

1. Separate key-independent nonce/correlation preparation from key-specific activation.
2. After canonical key creation, bind an untouched reservation to the key and measure commitment construction and decomposition.
3. Maintain independent four- or eight-candidate reservations. Consume another ready reservation when the first exhausts.
4. Share immutable circuit topology and compact private correlations before holding multiple reservations in one Worker.
5. Measure empty-pool behavior, replenishment throughput, interruptions, replay, and concurrent requests.
6. Measure the complete production Router path before resuming production integration.

Only untouched reservations may survive for later messages.
Burn the affected reservation on uncertain consumption or cancellation.
An empty pool must report unavailable or wait explicitly. It has no successful five-second guarantee.
The sample sizes here cannot select a production winner between four and eight candidates.

## Reproduction and cleanup

The [research README](../../tools/ml-dsa-investigation/research/README.md) lists the native, Wasm-inspection, hosted-summary, and trace-sanitizing commands.
All temporary Workers and the R2 bucket from this campaign are removed.
The [cleanup artifact](../evidence/ml-dsa-65-silent-cleanup-20261015.json) records their deletion.
Production routes and admission remain unchanged.

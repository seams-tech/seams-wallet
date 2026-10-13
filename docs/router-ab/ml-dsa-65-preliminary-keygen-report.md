# Preliminary ML-DSA-65 key-generation report

Date: October 13, 2026. Branch: `ml-dsa`.

Complete 2-of-2 key generation works on two Cloudflare Workers.
Fresh joint keys took **12.44 seconds at the median**, with five measured runs between **11.79 and 12.53 seconds**.
This is the current Yao baseline. It exceeds the investigation's provisional five-second generation target.
The [follow-up optimization report](ml-dsa-65-optimization-report.md) records a later arithmetic rewrite. The measurements below retain this deployed baseline.

| Environment | Measured operation | Observed time |
| --- | --- | ---: |
| Hosted Cloudflare A/B | Five fresh joint keys, after one excluded warm-up | 12.44 s median, 11.79–12.53 s range |
| Hosted Cloudflare A/B | One fixed canonical fixture, after one excluded warm-up | 14.56 s |
| Local workerd A/B | One fixed canonical fixture, after one excluded warm-up | 3.49 s |
| Native release processes on macOS arm64 | Four fixed seeds and one fresh joint seed | 1.87 s median, 1.74–1.88 s range |

The hosted joint-key warm-up took 13.17 seconds. The statistics exclude that run.
Five samples do not establish a production p95 or a cold-start latency distribution.
The incoming hosted requests reported NRT. The measurements do not establish both Workers' physical location.
Differences between these environments do not isolate network, CPU, or scheduler costs.

## What the clock includes

Client timing starts before the HTTP request and ends after the complete response arrives.
It includes schedule validation, fresh oblivious transfer, eighteen private circuits, local lattice arithmetic, public-key encoding, and both role reports.
Oblivious transfer gives each role its private circuit input labels without disclosing its input to its peer.
Client verification runs after that clock stops and has its own recorded duration.
Worker clocks record elapsed observations. They do not establish CPU billing.

Each role generates one independent 32-byte seed contribution.
The shared core expands their hidden XOR as the canonical FIPS ML-DSA-65 seed.
It samples the private polynomials and computes public matrix operations on additive shares.
Secure rounding produces the ordinary public key and separate private low-coefficient shares.
Each role completes **17,472 bytes of private material**. Both return the same **1,952-byte public key**.
The probe discards its private material after measurement and returns no private share or reconstructed seed.

| Resource per keypair | Exact bytes |
| --- | ---: |
| Garbled AND tables | 118,728,192 |
| Cryptographic messages, A to B | 122,429,195 |
| Cryptographic messages, B to A | 736,875 |
| Cryptographic messages, both directions | 123,166,070 |
| Private material at each role | 17,472 |

WebSocket envelope, credit, and completion-report bytes are additional and recorded separately.
Observed Wasm linear memory was 35.6–35.8 MB across the joint-key campaign.
This measure excludes JavaScript buffers and total isolate memory.
The complete ten-circuit library embeds approximately 33.1 MB of public descriptions in each approximately 34 MB Worker bundle.
These descriptions are reusable. Their packaged size is separate from per-key garbled traffic.

## Validation and next work

The fixed hosted public key matches the independent canonical reference exactly.
All six joint operations, including the warm-up, returned distinct public keys and fresh circuit execution bindings.
Both roles' circuit counts, cryptographic byte counts, and actual transport counters agree.
The native shared-core harness verifies threshold signatures before authorized test recovery.
Its recipient reproduces the canonical seed, public key, and complete expanded private key against OpenSSL for all five cases.

The accepted privacy profile remains passive, honest execution with two non-colluding roles.
Independent composition review, target constant-time qualification, and post-quantum transcript privacy remain open.
The probe excludes Wallet SDK admission, durable storage, production peer authentication, and NEAR transaction submission.

The eleven sampling circuits account for 105,819,648 table bytes, or approximately 89 percent of key-generation tables.
The earlier 55 MB estimate covered hashing alone. This complete baseline also measures sampling selection, share conversion, and rounding.
Measure sampling selection and share conversion first when reducing key-generation cost.
Compare smaller garbling schemes and arithmetic/Boolean conversion against this complete baseline.
Any sampler change must preserve the canonical seed and coefficient order, including its failure behavior.
Keep complete signing latency separate because each rejected signing candidate adds work.

Complete hosted signing also passes with standard independent verification.
The fixed key-generation-and-signing case took 74.37 seconds and required five signing candidates.
A fresh joint-key case took 78.36 seconds and required four candidates.
Its separate warm-up used another fresh key, required thirteen candidates, and took 214.63 seconds.
These are complete operation observations. They do not establish a signing median or a production latency bound.
Both Workers and client OpenSSL accept the signatures. The client rejects altered messages, signatures, and public keys.
The fixed signature matches the independent deterministic reference exactly.

An initial signing request failed at the client with `EHOSTUNREACH` before the passing retry.
Its exact network cause remains unknown. No cryptographic code change preceded the retry.
The preserved retry logs show successful role completion without Worker exceptions.

Evidence:

- [Five hosted joint-key runs](../evidence/ml-dsa-65-worker-keygen-joint-hosted-20261013.json).
- [Hosted canonical fixture](../evidence/ml-dsa-65-worker-keygen-fixture-hosted-20261013.json).
- [Local Worker fixture](../evidence/ml-dsa-65-worker-keygen-local-20261013.json).
- [Shared-core host signing and recovery](../evidence/ml-dsa-65-threshold-host-shared-core-20261013.json).
- [Deployed versions and build hashes](../evidence/ml-dsa-65-worker-complete-deployment-20261013.json).
- [Hosted fixed-key signing](../evidence/ml-dsa-65-worker-threshold-fixture-hosted-20261013.json).
- [Hosted fresh joint-key signing](../evidence/ml-dsa-65-worker-threshold-joint-hosted-20261013.json).
- [Aggregate CPU observations and attribution limits](../evidence/ml-dsa-65-worker-complete-cpu-20261013.json).
- [Verified temporary Worker and token cleanup](../evidence/ml-dsa-65-worker-complete-cleanup-20261013.json).

The artifacts contain raw samples, source and build hashes, public results, and reproduction commands.
Cleanup removed both temporary Workers and their local probe-token file.

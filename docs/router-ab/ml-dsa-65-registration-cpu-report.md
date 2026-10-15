# Registration CPU and stored preparation

Local sampling identifies substantial registration work outside the garbled circuit.
The investigation compares the existing AES-GCM storage suite with ChaCha20-Poly1305, while preserving the signing protocol and canonical key derivation.
The five-second product target requires complete hosted request measurements.

## Measurement and calibration

The registration E2E connects to participant B's local workerd inspector after preparation and before registration.
It samples at a requested interval of 1,000 microseconds through client result verification.
The interval includes the complete registration route, signing-stock installation, and incidental cleanup.
The profile contains stack frames and samples. It does not capture heap values or private inputs.

The calibration uses a separate Worker with known arithmetic work and an idle control.
The idle control produced zero known-work samples. Increasing the loop from 50 million to 150 million iterations increased samples from 208 to 593.
V8 inlines the loop into its request handler. Both the loop and handler frames count toward this calibration.
This passes the nonzero and workload-scaling checks. It does not calibrate absolute CPU milliseconds.

The release build now preserves a local function-name map before removing debug sections from the deployed Wasm.
The map binds its function indexes to the SHA-256 of the exact stripped module.
The summarizer also requires the matching E2E build hash and successful profiler calibration.
The baseline module matches the previously hosted module, `21ef9980a41960cf943bdd6134ba788f5ecb0c4250f34f835fe7bf44b906e028`.
The symbol map stays outside the Worker import graph and deployment bundle.

[Baseline sample summary](../evidence/ml-dsa-65-registration-aes-profile-20261016.json):

| Sample category | Create | Recover |
| --- | ---: | ---: |
| HPKE AES-GCM suite path, inclusive | 32.74% | 29.63% |
| Storage AEAD primitive, inclusive | 28.76% | 25.93% |
| Garbled-circuit execution | 15.84% | 14.23% |
| Storage get/put/delete leaf frames | 21.68% | 29.48% |
| Total samples | 1,130 | 1,377 |

Categories overlap. Do not add their percentages.
The HPKE suite category includes setup work, including key derivation. It is not pure AES cost.
Independent review reproduced the counts and checked storage ancestors for the reported get/put/delete frames.
The local host is an Apple M4 Pro running Node 26.4.0 on arm64 macOS.
Code parity with the hosted module is established. Local CPU proportions do not establish hosted speed or timing parity.

Cloudflare documents [CPU profiling](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).
The helper uses the [DevTools Profiler protocol](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/).
The earlier Worker clock counters are removed. They returned zeros during real hosted table work and could not attribute CPU costs.
Frame and byte counts remain available as public diagnostics.

## Diagnosis record

| Fact | Instrument | Scope | Checked |
| --- | --- | --- | --- |
| Known work produces samples and scales with loop count | Separate inspector calibration | Local workerd | Idle, small, and large controls |
| Baseline profile uses the previously hosted Wasm | SHA-256 and function-map binding | Participant B build | Exact hash match |
| Garbled-circuit execution accounts for 14–16% of samples | Symbolized stack samples | Two complete local registrations | Independently reproduced |
| The storage AEAD primitive accounts for 26–29% of samples | Symbolized stack samples | Same registrations | Independently reproduced |
| Storage calls also account for substantial samples | Leaf frames and their ancestors | Same registrations | Independent ancestry review |

| Candidate cause | Sample evidence | Status |
| --- | --- | --- |
| Garbled circuits explain most registration CPU | Only 14–16% of samples | Contradicted in these local runs |
| Stored-data authentication and encryption contribute substantially | 26–29% in the primitive path | Supports a bounded cipher control |
| Durable storage calls contribute substantially | 22–29% in relevant leaf frames | Remains a separate optimization candidate |
| Hosted delay is purely network waiting | Prior B invocation CPU exceeds five seconds | Contradicted by hosted traces |
| Sampling alone predicts hosted latency | Different runtime hardware and complete route overhead | Not established |

## Storage-suite change

Prepared material now uses authenticated HPKE with X25519, HKDF-SHA256, and ChaCha20-Poly1305.
The implementation uses the existing pinned `hpke-ng` library. It adds no custom cipher implementation.
ChaCha20-Poly1305 is an AEAD suite in [RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html#section-7.3).
This changes the storage cipher assumption. It does not change the ML-DSA key, signatures, MPC disclosure boundary, or recovery derivation.

The change preserves:

- Fresh HPKE encapsulation for every sealed value.
- Authenticated HPKE mode and distinct participant wrapping keys.
- Exact wallet, key, epoch, reservation, circuit, ordinal, and length bindings where applicable.
- Authentication before plaintext use and durable consumption before use of prepared state.
- Existing ciphertext chunk limits and retirement behavior.

All four storage domains advance to version 2: signing preparation, private registration preparation, registration tables, and generic signing stock.
Earlier AES preparation is deliberately refused. Refill or regenerate disposable preparation before using the new build.
There is no cipher fallback. Long-lived signing-share material uses its existing separate storage path.

Signing-batch identity remains independent of storage format.
The first version-bump attempt changed this identity in the producer and caused installation refusal in the Worker E2E.
The fixed code shares one stable batch-ID function between the producer and admission check.
The failure was a production regression introduced during this experiment. It did not produce a completed registration or a hosted measurement.

Poly1305's optional zeroization feature is explicitly enabled.
The pinned portable backend wipes its derived MAC state when dropped.
The source review found authentication-before-decryption and constant-time tag comparison in the library path.
Portable Poly1305 still requires constant-time multiplication on the target runtime.
This bounded review is not a final Wasm/V8 constant-time certification.

## Validation and reproduction

The durable lifecycle E2E checks old AES ciphertext rejection under both old and current storage domains.
It retains cross-role authentication rejection, restart, replay, atomic consumption, cooldown, recovery, and settlement checks.
The six native prepared-keygen cases reproduce the canonical ML-DSA public key, including injected network delays.
These native cases establish functional behavior, not hosted performance.

```sh
ML_DSA_E2E_REPORT=/private/tmp/ml-dsa-lifecycle.json \
  cargo test --manifest-path crates/router-ab-cloudflare/Cargo.toml --test ml_dsa_durable_pool_e2e
pnpm -C crates/router-ab-cloudflare build:router
pnpm -C crates/router-ab-cloudflare build:deriver-a
pnpm -C crates/router-ab-cloudflare build:deriver-b
ML_DSA_REGISTRATION_CPU_PROFILE=/private/tmp/ml-dsa-profile \
  node tests/e2e/ml-dsa-registration-worker.e2e.mjs /private/tmp/ml-dsa-keys /private/tmp/ml-dsa-profile-e2e.json
python3 tools/ml-dsa-investigation/research/summarize_registration_profile.py \
  crates/router-ab-cloudflare/build/deriver-b/index_bg.wasm.names.json \
  crates/router-ab-cloudflare/build/deriver-b/index_bg.wasm \
  /private/tmp/ml-dsa-profile-summary.json \
  /private/tmp/ml-dsa-profile-epoch-1.cpuprofile /private/tmp/ml-dsa-profile-epoch-2.cpuprofile \
  --e2e /private/tmp/ml-dsa-profile-e2e.json
```

Run the same registration E2E without the profiling variable for unprofiled local measurements.
Hosted measurements use the authenticated temporary Router URL and matching disposable role keys.
GPU research remains deferred.


## Local cipher control

The [corrected control](../evidence/ml-dsa-65-registration-chacha-profile-e2e-20261016.json) passes registration, canonical recovery, authenticated results, replay checks, and one signature.
The post-recovery signing request preserves cooldown, so it produces no second signature sample.

| Complete local request | AES-GCM baseline | ChaCha20-Poly1305 control |
| --- | ---: | ---: |
| Create with client verification | 2.419 s | 1.712 s |
| Recovery with client verification | 2.804 s | 1.495 s |
| First signature | 0.304 s | 0.274 s |

These runs use the CPU profiler during registration. They are not unprofiled product qualification.
Each run uses fresh preparation. Background cleanup and runtime scheduling can differ.

The [new profile summary](../evidence/ml-dsa-65-registration-chacha-profile-20261016.json) contains 864 and 722 samples.
Storage AEAD accounts for 50 and 42 samples, about 5.8% in both cases.
Garbled-circuit execution has 167 and 183 samples, compared with 179 and 196 in the baseline.
This supports reduced storage-cipher work while circuit work remains similar.
The new cipher path includes HPKE setup, accounting for 98 and 93 samples in total.
Storage calls remain substantial and variable. Sampling alone cannot choose between batching reads and reducing transaction or serialization overhead.

The [feature evidence](../evidence/ml-dsa-65-chacha-zeroize-features-20261016.txt) confirms Poly1305 state wiping is enabled for the Worker target.
The [lifecycle evidence](../evidence/ml-dsa-65-chacha-storage-lifecycle-20261016.json) and [native key checks](../evidence/ml-dsa-65-chacha-keygen-checks-20261016.json) retain authentication and canonical-key validation.


## Hosted cipher control

The [hosted client evidence](../evidence/ml-dsa-65-chacha-hosted-registration-20261016.json)
and [sanitized invocation traces](../evidence/ml-dsa-65-chacha-hosted-registration-traces-20261016.json)
record fresh disposable Workers with the corrected release builds.
Both complete signatures verify. Registration and recovery authenticate both holder results and preserve the canonical key and manifest.

| Client measurement | Previous AES-GCM campaign | ChaCha20-Poly1305 campaign |
| --- | ---: | ---: |
| Create with client verification | 11.728 s | 8.480 s |
| Recovery with client verification | 10.923 s | 6.920 s |
| Successful signing after create | 5.098 s | 1.539 s |
| Successful signing after recovery | 4.036 s | 2.209 s |
| Complete preparation before create | 177.292 s | 117.541 s |
| Complete preparation before recovery | 180.816 s | 160.323 s |

Preparation includes key-generation tables and four initial signing batches.
These two-case campaigns do not establish percentile latency or sustainable throughput.
Random signing attempts, background refill, runtime placement, and warm state differ. Do not attribute every timing change to the cipher.
The local profiles independently support the reduction in storage-cipher work.

B's key-generation invocations consume 2.837 and 3.808 seconds CPU, compared with 5.318 and 6.076 previously.
Both load the same 643 frames and 41,701,400 table bytes.
The Router's key-generation calls take 4.740 and 5.013 seconds.
The full registration timer remains decisive: neither complete registration meets five seconds.

After the first key-generation call, the slower initial role-install call takes 1.628 seconds.
The slower material-and-stock installation call then takes 1.801 seconds.
For recovery, those calls take 0.104 and 1.295 seconds.
The traces identify these phases. They do not yet separate cold-object startup, storage I/O, serialization, copying, and network costs inside them.

Both B signing WebSocket traces still report exceptions despite successful client verification.
That terminal behavior remains an open qualification issue.

## Next steps

1. Measure the activation and initial-stock installation phases with a cold/warm control. Test whether admitted storage initialization can overlap key generation.
2. Compare bounded table-read batches and fewer storage transactions. Preserve atomic consumption before any prefetched frame leaves storage.
3. Investigate avoiding repeated copying and re-encryption when generic signing stock becomes bound to a key. Require exact one-time key assignment and interruption/replay evidence before changing this boundary.
4. Fix the B WebSocket terminal exception and rerun admission, cleanup, interruption, and concurrency campaigns.
5. Repeat complete registration and signing under an explicit load profile. Keep wallet-seed recovery, standard FIPS export, and GPU deferral unchanged.

The public Gateway/SDK integration and the five-second product gate remain open.

The three temporary Workers, current trace listeners, and saved disposable credentials were removed after the campaign.

# ML-DSA hosted browser qualification

The advanced browser SDK produced three threshold-signed NEAR transactions on real
Cloudflare Workers. NEAR testnet confirmed all three at finality. Registration and signing
still exceed the five-second target in this small sample.

The campaign ran on October 21, 2026, Japan time, with compatibility date `2026-10-20`.
Cloudflare rejected `2026-10-21` because its UTC date was still October 20.

## Measurements

| Measurement | Observed time | Boundary |
| --- | --- | --- |
| Generic registration preparation, two successful runs | 75.98 s, 62.20 s | Key-independent key-generation material and initial signing stock. Excluded from online registration. |
| Online registration, two successful runs | 8.07 s, 9.00 s | Authenticated add-signer start, native client work, Workers execution, and custody publication. |
| Signing after passkey approval, three calls | 5.36 s, 3.68 s, 2.57 s | Browser SDK execution, Gateway admission, A/B signing, and browser signature verification. |
| Review preparation before passkey approval | 1.06 s, 0.58 s, 0.53 s | Browser transaction inspection and Gateway approval preparation. |
| Review preparation plus signing, excluding approval | 6.42 s, 4.26 s, 3.10 s | Sum of the preceding two online stages. |
| Transaction submission | 4.53 s, 5.16 s, 4.50 s | Browser RPC submission, measured separately from signing and the later finality checks. |

The virtual authenticator returned approval in 26–31 ms. This does not measure human approval time.
Exact replay and independent finality checks also sit outside the signing timer.

The successful registration used 2.35 seconds for start, 6.28 seconds for execution, and
0.35 seconds for publication. Small native and client intervals account for the remaining time.

Each signature consumed one pair of candidates. No request needed a second pair or a
client retry. This favorable rejection sample cannot measure the long rejection tail.
The public participant traces record about 0.71–1.13 seconds between signing milestones.
Those intervals include protocol work and waits. Workers clocks advance at I/O, so these
values do not isolate CPU time or explain the complete browser latency.

Each sample followed a 60-second pause after the preceding submission. Refill could run between calls. These results establish
functional behavior in that schedule. They do not establish sustained throughput, cold-start
performance, a percentile, or capacity across many wallets.

## What the campaign verifies

1. A fixture seeds an existing wallet owner, passkey, sealed custody envelope, and recovery set.
2. The native custody client derives role inputs from the fixed public zero seed.
3. Hosted Gateway routes admit registration. Real A/B Workers derive and install their separate shares.
4. The native client authenticates both role replies and checks the public key against ordinary FIPS key generation.
5. The Gateway publishes the signer through the existing custody commit.
6. The NEAR testnet faucet enrolls that ordinary ML-DSA public key on a disposable account.
7. Chromium collects fresh WebAuthn approval with a virtual authenticator for each exact transaction.
8. The advanced SDK signs through hosted Gateway, Router, and A/B Workers. Exact duplicate requests return the same signature.
9. The browser verifies and submits each standard signed transaction. Node OpenSSL independently verifies each signature.
10. The runner checks `FINAL`, successful execution, transaction hash, full public key, sender, receiver, and the exact one-yocto transfer.
11. D1 retains exactly three successful signing operations. Existing custody and recovery records remain byte-identical.

The account is `ml-dsa-pub-cea994a9835a969e.testnet`. The evidence contains all three transaction hashes.
The complete [generated record](../evidence/ml-dsa-65-browser-hosted-20261021.json) includes
deployment version identifiers, protocol version 87, public transaction bytes, source hashes,
binary hashes, and the receipt checks.
The [public Worker traces](../evidence/ml-dsa-65-browser-hosted-traces-20261021.json) retain only
selected production diagnostics. Request headers, role keys, and benchmark tokens are excluded.
Internal Router operation digests differ from SDK operation identifiers.

The browser assets were served through Playwright routing at `https://wallet.example.test`.
Gateway and RPC requests used actual HTTPS endpoints. This does not qualify production asset hosting,
a hardware authenticator, public browser registration custody, or the standard Wallet UI.
The fixture seed is public and unsuitable for real funds.

## Preserved settings

- Wallet-seed derivation and ordinary FIPS seed/key export remain unchanged.
- Preparation stays on Workers. Each group prepares four candidates and signing consumes independent pairs.
- Each pool still targets 32 candidates and requires 16 ready candidates for admission.
- Wallet cooldown remains 60 seconds. Service admission allows one active signing operation.
- The campaign changes no production cryptographic, storage, or admission behavior.
- GPU preparation and UI changes remain deferred.

## Fault diagnosis and controls

The [failure record](../evidence/ml-dsa-65-hosted-qualification-failures-20261021.json)
preserves the unsuccessful deployment and the encoding control.
Its initial deployment version metadata predates secret uploads and cannot identify that failed run's active versions.
The successful record uses refreshed active versions.
The successful record also retains `browserFailure` from the earlier PRF-helper attempt.
Its three finalized samples and `result: passed` describe the subsequent corrected browser run.

| Fact | Instrument and scope | Limit |
| --- | --- | --- |
| The traced preparation failed after 4,119 ms with HTTP 500. A logged a generic Worker error. | Hosted request timer and Router/A/B tails. | The original failed attempt preceded tail attachment. |
| Temporary role secrets contained raw 64-character hex. The decoder requires a fixed encoding prefix. | Local payload shape check and production decoder. | Secret values were excluded from evidence. |
| Adding only that prefix preserved the key bytes and completed preparation and registration. | Same hosted topology, policy, and scope. B stored 2,711 table frames. | This supports the traced failure diagnosis. Original participant parity remains unestablished. |
| The Node fixture then failed while encoding a public key with `bs58`. | Runner exception and a known encoding control. | The fault occurred before faucet enrollment. |
| Selecting the module entry made `[1]` encode as `2` and let enrollment complete. | Same fixture bundle with `mainFields: ['module', 'main']`. | This corrects the Node test bundle. It changes no production encoder. |
| The first browser invocation required PRF results despite requesting neither output. | Browser failure and the existing helper implementation. | The fixture selected a helper that always extracts PRF. |
| Native `credential.toJSON()` plus the existing normalizer passed signing and finality checks. | Reloaded browser fixture, same published signer and account. | This covers a virtual authenticator. |

| Possible cause | Encoding control | Subsequent successful flow | Conclusion |
| --- | --- | --- | --- |
| Fault in temporary role-key encoding | Fits the decoder failure. | Prefix-only correction passes key loading and registration. | Supported for the traced failure. |
| Fault in the threshold protocol | Cannot explain rejection before key loading. | Canonical key generation and three signatures pass. | Contradicted as the cause of this failure. |
| Admission alone caused the traced failure | Both participants received requests. | Same admission policy succeeds. | Contradicted. |
| A pending reservation means preparation still runs | The persisted lease rejects immediate retry. | The record contains no live-execution check. | Contradicted. |
| Fault in test instrumentation | JSON parsing hid the initial HTTP body. Module selection and PRF extraction also stopped the fixture. | Corrected instruments pass known controls and the complete flow. | Supported for those separate fixture failures. |

An independent reviewer checked the diagnosis, measurement boundaries, and finality assertions.
The review rejected a storage-specific claim because the generic error also covers configuration
and transport calls. It also rejected throughput and tail-latency claims from three spaced requests.

## Repeat and remaining work

Use `tests/helpers/mlDsaQualificationWorker.ts` as a disposable Gateway entry point with a fresh D1
database and the current migrations. Deploy matching strict Router, A/B, and A/B preparation Workers.
Only the Gateway needs a public route. Use separate fixture authentication and participant role keys.
Role keys require the prefix `hpke-x25519-role-private-d1-private-v1:` followed by 64 lowercase hex characters.
Record active deployment versions after all secret uploads.

The private deployment directory supplies `metadata.json` with the topology, exact policy, active
versions, and Gateway URL. `gateway-secrets.json` supplies the disposable `PROBE_TOKEN`.

```sh
cargo build --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml
node tests/e2e/ml-dsa-browser-worker.e2e.mjs <private-deployment-directory> <evidence.json>
```

The runner prints its loopback URL after registration and faucet enrollment. Route only
`https://wallet.example.test/**` to that URL in a Chromium qualification session. Import the
loopback `/driver/passkey` credential with CDP `WebAuthn.addCredential` after creating a virtual
authenticator. Keep that response out of logs and traces. Click **Run qualification**.
Wait for the three operations and `PASS: public browser signing and testnet finality`.
The JSON artifact must contain three independently verified finalized samples and unchanged custody.
Remove the disposable Workers and D1 database after saving evidence.
All six temporary Workers and the D1 database from this campaign were deleted after verification.
Disposable secret payload files were removed.

Next integration work remains production access-key enrollment, standard Wallet review and iframe
routing, public recovery/export/device authorization, interruption reconciliation, and participant
relocation. Wallet-seed recovery and FIPS export remain required throughout that work.
Performance work must reduce registration and Gateway overhead, then test multiple rejected pairs
and sustained multi-wallet load at unchanged pool capacity.

The subsequent [lifecycle follow-up](ml-dsa-65-wallet-lifecycle-report.md) implements existing-account
key enrollment and retained-key discovery/signing for recovered and full-owner linked authorities.
Its separate testnet campaign confirms an actual owner-signed `AddKey` transaction.

Wallet lifecycle type checks and all 38 locked Cargo manifests pass. The repository bloat check
still reports its inherited Rust duplication excess: 13,984 lines against 13,754.
The baseline remains unchanged.

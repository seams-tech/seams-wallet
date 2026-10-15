# ML-DSA durable Worker execution — October 15, 2026

The private Router/Worker path now connects admission to threshold signing and automatic pool refill.
Public Gateway owner authorization, SDK calls, and the complete Worker custody ceremony remain separate integration tasks.
Wallet-seed recovery and ordinary FIPS seed export remain required. GPU work remains deferred.

## Implemented flow

1. The trusted Gateway sends the exact signing request, message, and context to `/router-ab/ml-dsa/sign`.
2. The Router validates the message hashes before admission. It reserves paired material and charges the configured wallet cooldown.
3. A connects to B with a private authenticated WebSocket. Each role checks the exact live permit.
4. Each role loads its own encrypted signing share. Each role consumes one prepared batch in a durable transaction before decryption.
5. A rejected batch causes another reserved batch to run under the same operation ID. The cooldown does not change.
6. The Router verifies the standard signature, stores the terminal result, fences both roles, and settles the reserved batches.
7. Exact duplicate requests return the stored state or result. They do not dispatch another signer.

The default cooldown remains 60 seconds. The existing policy also supports 300 seconds or a disabled wallet cooldown.
Disabling that cooldown preserves service capacity, operation binding, epoch checks, and single-use enforcement.

## Automatic preparation

A's pool Durable Object records a refill queue in the same transaction as consumption.
A durable alarm obtains a preprocessing lease from the Router-owned service object.
The initial service-wide preprocessing limit is one active job. Each job prepares four candidates.
The existing signing admission limit remains independent of this preprocessing lease.

Both participants record a permanent start marker before protocol work. A retry receives a fresh batch ID.
B publishes its sealed half first. A publishes its half after B acknowledges storage.
Admission still requires matching, untouched IDs at both roles.
Later alarms retire unmatched halves left by interrupted publication.
Full pools keep a timer to replace material that expires while a wallet is idle.

The preprocessing lease lasts 90 seconds. Prepared material lasts ten minutes.
These are initial lifecycle bounds, not measured preparation-time guarantees.
Each alarm prepares one batch. A target of ten batches does not imply ten parallel producers.

## Secret storage and protocol boundary

Each role derives a domain-separated wrapping seed from its existing role-private KEK.
The KEKs must remain independent across A and B.
A stored signing share binds the wallet scope, key identity, epoch, ceremony, role, public key, and wrapping-key version.
Installation requires the exact custody activation authorized by the Gateway.
The Gateway activation remains a trusted assertion. This change does not establish the missing public custody verification route.

The Worker includes pinned public circuit schedules. It does not load benchmark role roots, seeds, or signing shares.
The schedules still reside in the investigation asset directory. Package ownership needs cleanup before library release.
The two roles use the existing GMW/silent-OT signing implementation and its existing passive security assumptions.
This change adds transport, storage, and lifecycle integration. It does not establish a new cryptographic security proof.

Secret-handling review checked the new adapter paths. New branches use public request metadata, lifecycle state, and protocol outcomes.
Private material stays in wiping buffers. The existing protocol implements secret arithmetic and private bound checks.
This review does not replace a full compiled constant-time audit.

## Verification

The [native execution evidence](../evidence/ml-dsa-65-durable-execution-e2e-20261015.json) contains seven standard signatures.
Three operations consumed multiple batches. All ten prepared batches were consumed across the run.
B's measured execution intervals ranged from about 61 to 108 ms. These are native process measurements.
The same campaign verified six canonical key-generation cases and ordinary wallet-seed recovery.

The durable lifecycle E2E also checks the preprocessing capacity lease, replay rejection across restart, and fresh IDs after lease expiry.
Its existing checks cover 60-second and 300-second cooldowns, disabled cooldown with capacity enforcement, recovery, and one-sided consumption.

The Worker E2E uses the actual strict Router, A, and B bundles in local workerd.
It starts with empty pools, triggers automatic preparation, submits signing requests, restarts storage, and stalls a signing peer.
It injects a synthetic Gateway custody assertion and pre-generated canonical role shares.
It therefore cannot establish public SDK registration behavior or hosted latency.

The [local Worker evidence](../evidence/ml-dsa-65-durable-worker-e2e-20261015.json) passed with three verified signatures and zero failed operations.
Complete Router requests took 1,047.6, 889.0, and 632.2 ms.
OpenSSL independently verified all three saved signatures and rejected a changed message for each.
The initial four-batch refill took 45.5 seconds. That is about 11.4 seconds per batch, including storage and alarm scheduling.
Automatic refill continued after signing. Exact duplicates survived a Worker restart.
A peer that sent no protocol input closed after about 9.7 seconds under a one-second configured operation deadline.
The Router reported failure without a signature. A prior run closed in about 963 ms.
The timeout is cooperative. The observed delay must be investigated under concurrent refill before claiming a strict wall-clock cancellation bound.

The measured bundles use Rust release optimization and SIMD. The local build omitted the additional `wasm-opt` pass.
The evidence records the exact Wasm hashes. These measurements do not establish a percentile or a hosted five-second guarantee.

### Handshake diagnosis

| Fact | Instrument and scope |
| --- | --- |
| A recorded fresh preprocessing starts. B recorded none. Neither pool contained a batch. | Local workerd SQLite keys. Activation and encrypted material records confirmed that both stores were live. |
| A POST WebSocket request arrived at B as GET with zero body bytes. | A separate two-Worker control recorded B's observed method and body length. |
| The first corrected run still omitted the new header at A. | B returned `Missing ML-DSA socket input`. A used a stale bundle while B used the corrected bundle. |

| Candidate cause | Result |
| --- | --- |
| OT, nonce generation, or circuit evaluation failed. | Contradicted by the absence of B's start marker. Those steps run after that marker. |
| Durable storage failed to persist all writes. | Contradicted by activation, material, and A's fresh start markers. |
| The handshake discarded the POST input. | Confirmed by the control. Both paths now use GET with bounded base64url JSON in a header. |
| The test loaded mixed build versions. | Confirmed on the first retest. Rebuild both roles before running the test. |

Review also identified a timeout issue: relative timers restarted on each frame could outlive the intended deadline when Worker clocks stayed frozen.
One timer now covers the complete protocol operation, including peer connection and storage waits.
Timer delivery can be delayed by runtime scheduling. The observed 9.7-second closure remains a qualification gap.
The stalled-peer E2E qualifies that path separately from successful signatures.

## Reproduction

Run from the `ml-dsa` worktree. Use a temporary directory for disposable fixture keys.

```sh
ML_DSA_WORKER_FIXTURE_DIRECTORY=/private/tmp/ml-dsa-worker-fixtures \
  cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  prepared-keygen /private/tmp/ml-dsa-durable-execution.json

ML_DSA_E2E_REPORT=/private/tmp/ml-dsa-durable-admission-e2e.json \
  cargo test --locked --manifest-path crates/router-ab-cloudflare/Cargo.toml \
  --test ml_dsa_durable_pool_e2e -- --nocapture
```

Build the three current Worker bundles with `scripts/build-strict-worker.sh` from `crates/router-ab-cloudflare`.
Then run:

```sh
node tests/e2e/ml-dsa-durable-worker.e2e.mjs \
  /private/tmp/ml-dsa-worker-fixtures \
  /private/tmp/ml-dsa-durable-worker.json
```

The local Worker test uses a one-second wallet cooldown to keep the campaign short.
Separate lifecycle checks verify the default 60-second policy.
The test records failed operations separately because finite candidate pools can exhaust.

## Remaining integration work

1. Connect public Gateway owner/session authorization to the private signing request and verified custody activation.
2. Complete role key generation and installation through the admitted Worker custody ceremony. Add durable generic stock for registrations.
3. Run hosted storage, refill, signing, recovery, and concurrent-load tests. Report successful-request latency and exhaustion separately.
4. Investigate the delayed timeout during refill. Interrupt publication between B and A, and execution during durable consumption. Test concurrent epoch replacement.
5. Connect the SDK/NEAR caller, verify a threshold-signed transaction through that path, and package the selected library.

The five-second hosted registration and signing target remains a qualification gate.

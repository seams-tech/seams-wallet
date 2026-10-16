# Registration optimization opportunities — October 15, 2026

Update, October 16: items 1 and 2 are implemented in `18b09520`. Correctness
checks pass. The combined local medians are unchanged; hosted savings remain
unmeasured. See the [implementation and evidence](registration-router-orchestration-20261016.md).

The current objective is to shorten execution itself: fewer network exchanges,
fewer durable transitions, and less protocol computation. The prompt-overlap
proposal below remains a UX option; it does not reduce the computation.
No production change has been made from this investigation. Staging, R155J,
and its 503/409 investigation were untouched.

## Actual execution reductions to investigate

### 1. Run Router orchestration inside its wallet object

`router_coordinator.rs` currently calls the wallet object to claim a registration,
runs the roles outside that object, then calls the object again to record the
outcome. `durable_object/router_wallet.rs` serializes each request and reply.

Move that orchestration behind one object execute call. The claim and completion
remain separate local durable transactions around the external protocol work.
Do not hold a storage transaction or an object-wide concurrency lock across the
network work. Exact retries still use the stored claim generation and outcome.

With the Router front door retained, this removes **one net Worker-to-DO round
trip**: one execute call replaces the current claim and finish calls. It also
avoids returning the pinned request to the Worker and sending the completed
result back into the object. It does not remove the durable writes.

Historical claim and finish header spans are 30–31 ms and 16–17 ms at the median.
They include durable storage waits and cannot be claimed as removable overhead.
A local prototype should prove the reduced call count and preserve duplicate
execution, lost replies, supersession, cancellation, and relocation behavior.
It touches the claim path, so implementation must follow Claude's current fixes.

### 2. Coalesce B's input preparation and execution claim

`DeriverBYaoSessionD1V1::handle_prepare_pair` writes a `Prepared` pair record.
`deriver_b_start.rs` then writes `Running` after A's start arrives. Completion
writes the result afterward. The fresh path therefore has distinct preparation,
running, and completion record writes in B's wallet object.

Investigate joining the exact Router input and A start before one durable
`Running` commit. This could remove the intermediate pair-record write without
moving work before passkey verification. Tenant-root D1 admission and other
stores' writes remain separate; this is not a claim that all B writes combine.

The current prepared record survives restart and joins independently arriving
requests. A replacement must define restart and retry behavior explicitly. It
cannot acknowledge durable preparation and then keep the only copy in memory.
Both arrival orders, conflicting inputs, lost preparation replies, cancellation,
expiry, and a crash after the running commit need behavioral coverage. No
protocol material may leave before the execution claim is durable.

This is a candidate to remove one durable transition, not an established saving.
Automatic storage coalescing and overlap can reduce its benefit. Do not treat
the full 113–124 ms B preparation span as removable; A runs concurrently.

### 3. Reduce actual OT arithmetic

The isolated calculation below demonstrates a 10.64 → 6.09 ms local WASM reduction
by reusing a shared group product. It changes the amount of computation rather
than its scheduling. It has the clearest numerical evidence, but a modest
absolute budget. Adoption requires full protocol equivalence and constant-time
verification, not just the primitive equality checks.

### Excluded shortcuts

- A and B already send their encrypted target proofs concurrently. Combining
  those frames with the start acknowledgement is not automatically a removed
  round trip. Sending A's proof earlier could cross its durable-claim boundary.
- Production already uses 128 KiB table frames and overlaps garbling with
  evaluation. Do not propose the earlier frame-size/yield fix again.
- Unconfirmed writes, skipped ownership checks, and replying before a required
  completion commit are outside these candidates.

The recommended sequence is to prototype the orchestration and write changes,
verify their lifecycle behavior, then measure one combined candidate. The
current evidence does not establish a several-hundred-millisecond saving.

## Measured budget

Recomputed from the two October 14 candidate arms recorded in
[the remaining-optimizations comparison](refactor-155h-remaining-optimizations-staging.md).
Each arm contains 99 successful NEAR-only registrations. These are historical
matched runs, not a new benchmark of the current branch.

| SDK stage, median | Candidate 1 | Candidate 2 |
| --- | ---: | ---: |
| Setup | 524.2 ms | 497.4 ms |
| Passkey interaction | 522.7 ms | 541.4 ms |
| Combined proof and Yao response | 961.8 ms | 931.0 ms |
| Client custody completion | 10.7 ms | 10.7 ms |
| Local provisioning checkpoint | 2.5 ms | 2.8 ms |
| Finalization request | 418.6 ms | 353.2 ms |
| Local publication | 13.9 ms | 15.6 ms |
| Session hydration | 6.2 ms | 7.0 ms |
| Local material activation | 10.2 ms | 10.5 ms |
| Export capability installation | 5.7 ms | 5.6 ms |
| Remaining wallet-ready work | 1.4 ms | 1.3 ms |

The last five stage medians total about 37–40 ms. This sum is a work budget,
not the median of their combined duration. It makes further small SDK completion
changes a low priority for substantial latency reduction.

All 198 asset records contain the NEAR, custody, confirmation, session, and
sealing Workers. None records a separate ECDSA Worker or ECDSA WASM request.
The custody ceremony module itself links both key-family implementations, as
required by the present custody design. Its presence does not establish unused
ECDSA execution. A smaller curve-specific build would need a demonstrated cold
loading cost before its extra build variants are justified.

## Leading candidate: actual execution during the prompt

**Rejected by the owner on October 16, 2026:** the Yao execution stays after
the verified passkey proof, because running it first defeats the proof. Keep
the section as a record; do not implement it.

The current NEAR passkey path already starts the custody ceremony during the
prompt. Setup describes the session-bound admission. The custody Worker can
prepare the encrypted role inputs before the passkey result exists. The
`executeWithProof` callback in `registration.ts` then waits for
`passkeyAuthorityPending` before sending the combined respond/execute request.

The existing code therefore exposes a useful separation: preparing and executing
the new key set versus proving which credential may finalize its wallet.

Proposed registration-only flow:

1. Keep setup authorization, the fixed wallet home, fresh ceremony identity,
   expiry, and the existing setup cost limit.
2. Start the passkey prompt and one provisional Yao execution concurrently.
   Reuse the existing signed setup scope; do not introduce a new secret or
   configuration family.
3. The provisional execution creates no usable wallet and issues no Wallet
   Session. It accepts only this new registration's exact encrypted input pair.
4. After both the passkey result and Yao result exist, the client constructs its
   custody commit. Send the passkey proof and that commit to finalization.
5. Finalization verifies the proof and binds its exact credential before the
   existing durable wallet/session publication. Cancellation and expiry retire
   provisional work. Exact retries must keep one execution winner.

This would retain three normal requests: setup, provisional execution, and
proof-bearing finalization. It would replace the present serialized combined
respond/execute step for NEAR-only passkey registration. Mixed registration,
Email OTP, unlock, signing, recovery, and export are outside this proposal.

The 0.93–0.96 second response stage is the candidate budget, **not a projected
saving**. The overlap depends on prompt length and how much execution remains
after provisional admission. A short prompt hides less work. Proof validation
still costs time in finalization. The prototype must report total click-to-ready
time, post-passkey time, CPU, abandoned-work cost, and all requests separately.

This is a material policy change from R155H Phase 1, which leaves online protocol
work after verified credentials. Before implementation, decide whether the
existing authorized, limited setup may fund provisional computation. Then verify
that no registration publication or session issuance can occur without the proof.
Do not weaken ownership checks or apply this permission to an existing wallet.

## Other avenues and their limits

- **Hide full setup for direct API consumers.** The hosted menu already prepares
  setup before the click. Direct `registerWallet` callers still pay it; their
  startup helper warms OPTIONS only. An application that can prepare the exact
  registration earlier could hide roughly the observed half-second setup stage.
  This overlaps existing work; it does not reduce server computation. Reuse the
  existing preparation lifecycle rather than inventing a second setup mechanism.
- **Move Router orchestration into its wallet object.** Today the stateless Router
  calls the object to claim registration, executes the roles, then calls the object
  to finish it. The historical claim headers take 30–31 ms median and finish
  headers 16–17 ms. These spans include required durable work, so their sum is
  not removable latency. Moving orchestration could remove crossings while retaining
  the writes, but the current evidence does not justify a large saving. This also
  touches the claim path Claude is investigating. The implementation preserves
  those claim transitions; his R155J investigation remains separate.
- **Garbling before execution.** R155H already deferred this after garbling and
  evaluation began overlapping. Activation has 65,780 AND gates and 2,104,960
  bytes of table payload. Retaining that table adds memory and single-use state.
  Do not reintroduce the old proposal without measuring the remaining critical
  path after the existing overlap.

## Oblivious-transfer arithmetic probe

Inspection found a repeated calculation in `passive/ot.rs`:
`ReceiverStart::begin_os` creates 128 public offer points. After receiving the
peer message, `ReceiverAwaitBaseChoices::accept` reconstructs those same points.

A second candidate uses the group identity
`(P - aG) * a = (P * a) - (a² * G)` to replace one variable-base multiplication
per row with a fixed-base multiplication. This was tested only in an isolated
primitive probe. No production crypto source changed.

| 128-row receiver calculation, median | Native | Local V8/WASM |
| --- | ---: | ---: |
| Current arithmetic | 5.03 ms | 10.64 ms |
| Retain existing offer points | 4.27 ms | 9.25 ms |
| Reuse shared product with fixed-base correction | 2.89 ms | 6.09 ms |

The probe used curve25519-dalek 4.1.3 with the production features, optimized
builds, and SIMD for WASM. It alternated variant order, checked equality for 128
public deterministic inputs, and measured 20 native / 40 WASM samples after one
discarded warm-up. It measures one arithmetic loop, not the protocol or hosted
registration. The best local saving is only about 4.5 ms. A production adoption
would still need formal/protocol and constant-time checks; the algebra probe is
not that evidence. This is a secondary candidate, not the main latency project.

## Rejected build-mismatch hypothesis

The local SDK installation contains a 654,272-byte sealing WASM, SHA-256
`99bbb650019c6c07ea6cba1cc756c817cee954e347216177891256699461edd3`.
A fresh npm tarball of `@seams/wallet@0.10.2` instead contains the optimized
118,576-byte binary, SHA-256
`94a2c125a816d7547fcd7c53cc5fe8f9c13bf5621829aeba52effcc844b8f395`.
The large local file is not evidence of a bad published release. No package or
deployment change followed from this hypothesis.

## Reproducible artifacts

- Private `seams-monorepo/.artifacts/registration-avenues-20261015/` contains npm
  pack metadata, the downloaded package, historical stage summaries, a tail-span
  analysis script, and its results.
- Public `seams-wallet/.artifacts/ot-cost-probe-20261015/` contains the isolated
  Rust probe, lockfile, native CSV, WASM module, measurement script, and JSON results.
- No Cloudflare resources or serving versions changed. No R155J source or evidence
  was edited. The probes used only local CPU.

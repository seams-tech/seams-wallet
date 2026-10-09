# R155C — prepare and execute Deriver B on one authenticated connection

Status: planned. The code inventory is recorded. No transport implementation or
live deployment is part of this planning change.
Date: October 9, 2026.

## Objective and relationship to R155B

Remove the separate Router-to-B preparation exchange from Yao ceremonies.
Use one authenticated A-to-B connection for B preparation, signed acceptance,
protocol execution, and delivery of B's sealed result.

[R155B](refactor-155B.md) removes routine Console dependencies and records the
registration optimizations through Phase 6AO. Its final follow-up proposes this
connection change. R155C owns the implementation plan for that proposal.
Keep the measured history in R155B. Record this refactor's implementation and
results here.

The main performance objective remains NEAR-only registration followed by the
first independently verified signature. The user requires less than 3–4 seconds,
with 1–2 seconds preferred. This transport change has no measured latency saving
yet and does not promise that full-flow target by itself.

## Frozen starting evidence

Start from public `dev` implementation `155b36ea7123d15e0396b7ada15cebb981d7c500`,
documented by `f7a6c9f5b915d3c7c772bdf07ec0ebdb4276b4be`.
R155B Phase 6AO already reuses A's freshly admitted root result within one request.
Preserve that saving and the earlier combined A preparation/execution request.

The accepted Phase 6AO candidate measured three fresh, implicit, unfunded wallets:

| Metric | Median | Observed range |
| --- | --- | --- |
| SDK registration | 8.137s | 7.023–9.225s |
| Registration → independently verified signature | 10.650s | 10.597–12.411s |
| Yao execute HTTP | 3.478s | 3.472–4.109s |

The restored control's full-flow median was 10.720 seconds. This comparison proved
a D1 reduction without isolating a repeatable latency gain. Worker cold state was
not controlled. Nested spans include transport and scheduling.

Current measured counts per wallet:

- Eight Gateway HTTP requests, including two session-status requests.
- Nine Console HTTP requests during registration.
- Five bound-root D1 round trips and thirteen SQL statements.
- Within that D1 subset: A admission uses 2/5, B admission uses 2/5, and B's repeated
  admitted-root read uses 1/3 round trips/statements.

[Sanitized Phase 6AO evidence](evidence/near-registration-reused-admitted-target-20261009.json)
contains the samples, independent signature proofs, exact versions, and validation.
Total registration D1 work remains unmeasured by these subset counters.

## Current and proposed flow

Current:

1. Router sends B its encrypted input through B's Worker and wallet Durable Object.
2. B validates its root, stores preparation, and returns its signed readiness receipt.
3. Router verifies that receipt and sends A its execution request.
4. A prepares and reserves execution, then opens the authenticated connection to B.
5. B loads prepared state, claims execution, and returns signed acceptance.
6. A verifies acceptance, claims locally, and runs the protocol with B.
7. Router verifies both completed role results before finalization.

Proposed:

1. Router sends A both encrypted inputs with the existing authorized ceremony scope.
2. A validates the exact pair, prepares its own input, and durably reserves execution.
3. A opens the existing authenticated peer connection to the exact B wallet object.
4. A sends B's encrypted input and preparation context in a bounded startup frame.
5. B independently checks authority, scope, input, root, and local fences.
6. B records preparation and its execution claim, then returns signed readiness and acceptance.
7. A verifies both receipts and commits its local claim before sending protocol material.
8. The same connection carries the protocol and B's sealed completion.
9. Router verifies both completed results before finalization.

A startup frame is the first typed message on the connection. Prefer it to putting
an encrypted input in a URL or a large HTTP header. A successful WebSocket upgrade
does not authorize protocol execution. Signed acceptance follows B's durable claim.

This framing removes a separate HTTP/DO dispatch. It can add a message round trip
after the WebSocket upgrade. Count that exchange explicitly. Removing the HTTP
request does not by itself prove fewer total network round trips or lower latency.
Resolve the startup framing during Phase 1 and record the complete call graph.

Keep the existing narrow Worker entry points and service bindings. Removing the
separate preparation exchange does not require exposing B's whole DO namespace to A.
Preserve supported deployment transports and their authentication. Adding another
transport mode or a new configuration family is outside this refactor.

## Required code inventory

Paths below are relative to the public `seams-wallet` repository unless stated otherwise.

| Area | Files | Required change |
| --- | --- | --- |
| Router ceremony dispatch | `crates/router-ab-cloudflare/src/router_coordinator/ceremony_execution.rs` and `router_coordinator.rs` | Send both sealed inputs to A. Remove the separate B preparation call and its obsolete timing fields. |
| Internal request shapes | `crates/router-ab-cloudflare/src/ed25519_yao_pair_protocol.rs` | Replace caller-supplied B readiness with B's encrypted input for the combined flow. Define precise startup and accepted-response shapes. |
| A lifecycle transitions | `crates/router-ab-core/src/protocol/ed25519_yao_pair_lifecycle.rs` | Reserve before B readiness exists. Require verified B readiness and acceptance when entering Running. |
| A wallet execution | `crates/router-ab-cloudflare/src/durable_object/deriver_a_pair.rs` | Bind the reservation and replay checks to both input digests. Preserve one winning executor and all local fences. |
| Shared execution and root use | `crates/router-ab-cloudflare/src/ed25519_yao_lifecycle.rs` and `ed25519_yao_lifecycle/bound_root.rs` | Remove the assumption that B was prepared separately. Keep fresh A target reuse and resumed root checks. |
| Peer connection and framing | `crates/router-ab-cloudflare/src/ed25519_yao_websocket.rs` | Add one bounded, typed startup exchange before protocol frames. Preserve timeout and socket cleanup. |
| B preparation and acceptance | `crates/router-ab-cloudflare/src/ed25519_yao_lifecycle/deriver_b_start.rs` and `durable_object/deriver_b_pair.rs` | Prepare and claim in B's existing wallet object on the same connection. Return signed readiness and acceptance. |
| Routes and exports | `crates/router-ab-cloudflare/src/strict_worker/deriver.rs`, `strict_worker/mod.rs`, and lifecycle exports | Remove the obsolete public preparation route, handler, constants, imports, and consumers. Keep internal state transitions that the combined operation uses. |
| Native HTTP consumers | `crates/router-ab-dev/src/local_router_coordinator.rs`, `local_ed25519_yao_worker.rs`, and `local_ed25519_yao_stream.rs` | Update consumers of shared request and lifecycle types. Keep native and deployed authorization, retry, and terminal semantics aligned. |
| Behavioral evidence | `crates/router-ab-cloudflare/scripts/test-private-d1.mjs`, `yao-peer-disconnect-evidence.mjs`, and `wallet-home-placement-evidence.mjs` | Exercise real Workers, D1, DOs, protocol execution, and persisted recovery at the new boundaries. |
| Hosted acceptance | Private `seams-monorepo/tests/e2e/hosted-product/near-signing-latency.test.ts` | Repeat the same NEAR-only comparison and retain independent signature proofs. |
| Contracts and documentation | `docs/intended-behaviours.md`, the existing lifecycle E2E contracts, and this plan | Update any affected normative behavior with its behavioral contract. Record structural and timing results separately. |

The native HTTP implementation still uses separately prepared role inputs.
Inventory all consumers before changing shared types. Classify active registration,
recovery, export, and lane paths explicitly. Update affected live consumers and
delete retired consumers. Do not leave a second transport path for compatibility.

## Phase 1 — fix the authority and lifecycle contract

- [x] Record the current call path, shared type consumers, and measured starting point.
- [ ] Trace which existing claims authorize B preparation when A forwards the request.
  A may relay that authority. Its readiness signature cannot replace B's independent checks.
- [ ] Define a startup message bound to the exact wallet, home, ownership generation,
  tenant identity, root context, operation, session, execution ID, and both input digests.
- [ ] Account for upgrade, startup, acceptance, and protocol exchanges separately.
  Avoid adding an acknowledgement that merely repeats B's signed acceptance.
  Keep payloads within existing protocol limits and verify supported transport behavior.
- [ ] Change A's Starting reservation to use its validated local state and the exact pair.
  The pair already commits to B's input digest. B readiness becomes required at claim time.
- [ ] Make only the caller that wins A's durable reservation open the peer connection.
  A duplicate or competing request must not start another B execution.
- [ ] Retain signed B readiness, signed start acceptance, root-metadata matching,
  expiry, and bounded peer clock-skew checks before A enters Running.
- [ ] Keep completed replay exact. Changed B input, scope, or execution identity must fail.
  Exact terminal replay must survive root retirement and object restart.

Use precise states for reserved, connected, accepted, running, and terminal work.
An optional receipt must not allow an unverified connection to enter Running.
Reuse existing signed claims, keys, and lifecycle transitions wherever they express
the required authority. Do not introduce new signing secrets or environment variables.

## Phase 2 — implement the combined connection

- [ ] Replace the separate Router-to-B preparation request with the combined A request.
- [ ] Route the peer connection to B's authenticated fixed-home wallet object.
- [ ] Validate and normalize the bounded startup frame once at the connection boundary.
  Reject missing, oversized, duplicated, out-of-order, and scope-mismatched frames.
- [ ] Admit B's root and persist B's execution claim before sending acceptance.
  Recheck ownership and cancellation after each awaited operation that can race a fence.
- [ ] Reuse B's freshly validated target within that request, following A's established
  one-use pattern. Resumed persisted work must retain the required root read.
- [ ] Start target-proof and Yao messages only after A verifies B and commits its own claim.
- [ ] Retain bounded setup/protocol timeouts, burn-on-failure behavior, and socket closure
  for refusal, disconnect, invalid acceptance, and local claim failure.
- [ ] Keep deferred completion and admission settlement bound to the exact wallet home,
  ownership generation, session, and physical DO.

A must never decrypt B's input or receive B's secret root share. Keep the cryptographic
protocol and existing encryption unchanged. Move work across the transport boundary
without merging the two role identities.

## Phase 3 — remove obsolete paths and verify behavior

- [ ] Remove the old B preparation endpoint and the old caller-supplied readiness shape.
  Update every affected caller, fixture factory, export, and timing label in the same change.
- [ ] Remove fallback routing, duplicate handshakes, abandoned options, and dead helpers.
  Update supported persistence boundaries narrowly if required. No legacy-wallet support is required.
- [ ] Run existing real Worker/DO scenarios for all four wallet homes, concurrent calls,
  lost replies, object restart, root retirement, admission settlement, and exact replay.
- [ ] Extend the existing peer-failure E2E to cover failure before B preparation,
  after B claims, before A claims, during protocol execution, and after B completes.
- [ ] Reject forged readiness/acceptance, stale timestamps, wrong root, wrong home,
  changed generation, changed encrypted input, cancellation, and delayed completion.
- [ ] Verify no second protocol execution, no reopened terminal pair, no leaked socket,
  and no retained unaccounted admission after each failure settles.
- [ ] Verify affected recovery/export paths and native HTTP behavior. Preserve existing
  protocol vectors and encoding contracts. Do not change cryptographic vectors to fit a transport bug.
- [ ] Build the affected release Workers and run the exact-tree bloat check.

Use behavioral E2E evidence with repeatable commands, source/build hashes, final pair
states, and independently verified signatures. Do not add unit tests or source-text
tests that merely assert the new implementation's shape. Classify an existing test
failure before changing its fixture or production behavior.

## Phase 4 — measure on existing staging and record the decision

- [ ] Freeze matching SDK, Router, A, B, Signing Worker, Gateway, Runtime, and Console versions.
  Preserve concurrent work and the accepted Phase 6AO baseline.
- [ ] Settle existing ceremonies before changing matching role versions. Reject mixed
  startup protocols explicitly. Do not add a fallback to the old preparation endpoint.
- [ ] Reuse existing staging resources and remain within the user's $25 Cloudflare budget.
  This refactor requires no new Worker, DO namespace, database, Container, or paid plan.
- [ ] Run sequential baseline, candidate, and restored-control arms on the same client.
  Start with three fresh implicit, unfunded NEAR wallets per arm and identical SDK assets.
- [ ] Measure SDK registration, registration → first verified signature, Yao execute,
  B preparation/acceptance, A/B execution, finalization, and preparation waits.
- [ ] Record median, maximum, range, HTTP counts, peer frame counts, and D1 round trips/statements.
  Keep subsystem D1 counts separate from total registration D1 counts.
- [ ] Audit actual serving versions. Separate controlled cold runs from warm runs.
  Label uncontrolled cold state. Do not infer colocation from placement hints.
- [ ] Verify each signature independently. Preserve all sample artifacts and exact build hashes.
- [ ] Restore original assignments and placement, verify activation, and stop observation processes.
- [ ] Record the acceptance decision and commit completed work on `dev`.

Structural acceptance targets:

| Work | Starting point | Target |
| --- | --- | --- |
| Separate Router-to-B preparation HTTP exchange | One per ceremony | Zero |
| Separate B Worker-to-DO preparation request | One per ceremony | Zero; preparation occurs within the peer connection |
| A-to-B execution connection | One per ceremony | One, also carrying preparation |
| Bound-root D1 work for a fresh ceremony | 5 round trips / 13 statements | 4 / 10 if B reuses its freshly admitted target as planned |
| Cryptographic role separation | Independent A/B keys and root shares | Preserved |
| Duplicate execution after retry | Forbidden | Forbidden |

Gateway and Console call counts are comparison controls. This refactor targets the
custody exchange and does not claim to remove those calls.

Keep a correct, simple change that demonstrably removes work even if a small sample
does not isolate a latency gain. Report slower candidate results explicitly.
Do not attribute them automatically to Cloudflare. Reassess a repeatable material
regression and compare accumulated accepted optimizations against a frozen baseline.

## Completion criteria

The combined path is the only supported replacement for the affected flow. Both
roles enforce their own authority and fixed-home state. Real failure scenarios
prove one durable execution outcome. Hosted traces prove the exchange reduction.
The plan records measured latency, uncertainty, cleanup, and any unmet full-flow target.
No obsolete preparation route, compatibility flag, duplicated workflow, or new
infrastructure dependency remains.

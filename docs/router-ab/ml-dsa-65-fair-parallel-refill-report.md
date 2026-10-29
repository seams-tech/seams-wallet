# ML-DSA fair parallel refill

The native integration and complete local Worker campaigns pass.
A depleted wallet can borrow the second idle producer while another waiting wallet retains queue priority.
The [hosted comparison](ml-dsa-65-fair-refill-hosted-report.md) records 7.313 and 7.621 complete-cycle signatures/minute.
This local report describes the implementation checks; the hosted report retains attribution and latency limits.

## Implementation

The allocator derives each job's width from occupied pair identities and live pending jobs.
Visible pending output counts once. Separate jobs retain separate identities, leases, and single-use material.
Controllers preserve pending-job snapshots from before and after inventory reads.
This protects a valid partial publication that another producer claims while those reads wait.
A role publication transaction enforces the configured capacity against all unexpired Ready and Reserved pairs.
Signing eligibility remains a separate inventory decision.

An acknowledged overdue refill alarm is rescheduled promptly.
A later maintenance request preserves an earlier future wake.
The parallel and alarm changes require separate attribution when interpreting hosted results.

Preparation stays on Workers. Wallet-seed recovery and canonical FIPS seed/key export remain unchanged.
Preparation creates four candidates. Signing consumes two at a time.
Each wallet retains thirty-two candidates and a sixteen-candidate admission minimum.
The production defaults remain one preparation slot and a sixty-second wallet cooldown.
No cryptographic kernel, circuit identity, domain string, or stored job/sealing format changes.

## Validation

The native encrypted-SQLite campaign verifies independent jobs, restart, pending-ID deduplication, bounded top-ups,
waiting-wallet priority, failure isolation, and the atomic publication limit.

The focused real-Worker scenario starts with sixteen pairs, retires them, and holds peer inventory.
It then claims a job during that inventory read and holds its A publication after B publishes.
A second producer enters the real protocol while the first job remains live.
Both B pairs survive reconciliation. Eight four-candidate jobs restore exactly sixteen matching pairs.
Retired IDs remain retired. The resulting standard signature verifies, and replay returns the same signature.

The complete Worker campaign also checks interruption, unopened-material retention, lost publication replies,
producer handoff, restart, and the overdue-wake interleaving. Four retained signatures verify independently.
The wake scenario observes the next alarm within a 218 ms upper bound after releasing its controlled hold.
This local observation does not establish a Cloudflare alarm latency.

The required bloat check retains its inherited failure: 13,992 Rust duplicated lines against 13,754.
The baseline is unchanged. No new bloat category exceeds its baseline.

## Local test adapter diagnosis

| Fact | Evidence | Limit |
| --- | --- | --- |
| The initial test stops progressing during metadata/inventory calls | Saved progress markers and raw logs | A marker does not identify the blocked getter |
| Node's main thread waits inside Miniflare's synchronous bridge | Native stack samples show `Atomics.wait` | Samples contain no private heap data |
| Miniflare uses synchronous operations for uncached proxy properties and namespace calls | Installed Miniflare source | The exact original operation remains unknown |
| Prebinding the fixed IDs, stubs, and fetch methods removes the observed stalls | Focused and full unchanged-protocol controls pass | This does not prove that every platform stall has the same cause |

| Candidate cause | Result |
| --- | --- |
| Node timers are simply too short | Timers cannot fire while the main thread waits in the synchronous bridge |
| The local adapter blocks during proxy operations | Supported by the stack, installed source, and prebinding control |
| Every observed stall is a production protocol deadlock | The unchanged protocol completes after the test-client change; that broad diagnosis is unsupported |

Classify these stalled runs as `environment_or_infrastructure_failure`.
The adapter now binds all clients before gates and rebuilds them after each runtime restart.
Fault barriers, authentication headers, participant namespaces, and real protocol routes remain active.
Signing and duplicate-replay timings are recorded separately.
Independent review found no concrete remaining blocker in the reviewed scheduling and capacity changes.

## Reproduce

```sh
ML_DSA_E2E_REPORT=/tmp/ml-dsa-parallel-native.json \
  cargo test --manifest-path crates/router-ab-cloudflare/Cargo.toml \
  --features ml-dsa --test ml_dsa_durable_pool_e2e

node tests/e2e/ml-dsa-durable-worker.e2e.mjs \
  /path/to/disposable-role-fixtures /tmp/ml-dsa-parallel-worker.json
```

The focused Worker scenario accepts `--parallel-refill-only`.
Use the strict router, deriver-a, and deriver-b Worker builds from this source.

[Local evidence](../evidence/ml-dsa-65-parallel-refill-local-20261030.json) contains source and Wasm hashes,
exact assertions, raw logs, stack samples, and a hashed archive manifest.
The credential scan finds zero matches against the synthetic campaign credentials.
The hosted comparison deletes all eight temporary Workers and independently verifies their absence.

# ML-DSA optional wallet service groups

Optional service-group routing is implemented. One shared group remains the production default.
Native and real local Worker campaigns pass. Independent replay accepts nine standard signatures and rejects nine altered messages.
The [hosted screen](ml-dsa-65-service-groups-hosted-report.md) reaches 7.45, 12.01, and 25.48 complete-cycle signatures/minute with one, two, and four groups.
Broader population and production capacity remain unqualified. Production deployment and defaults remain unchanged.
All three strict release builds pass. The inherited bloat failure remains 13,992 Rust duplicated lines against 13,754; this change adds none.

## Configuration and ownership

Add `service_groups` to the existing `ML_DSA_ADMISSION_POLICY` JSON. Its default is one and its supported range is one through sixty-four.
The existing signing and refill limits apply per group. For example, the complete default policy is:

```json
{
  "service_groups": 1,
  "wallet_cooldown": { "mode": "enabled", "interval_ms": 60000 },
  "max_active_operations": 1,
  "max_active_preparations": 1,
  "operation_timeout_ms": 30000,
  "candidate_group_size": 2,
  "preparation_group_size": 4,
  "minimum_ready_batches": 8,
  "refill_target_batches": 16
}
```

Each group owns an admission object and bounded producer objects in the existing participant deployments.
Group zero retains the original object names. Other groups use a numeric suffix. No additional Worker deployment is required per group.
Each wallet keeps one durable assignment under the digest of its full organization, project, environment, and wallet scope.
All signing keys, devices, recovery epochs, operations, and refill leases follow that assignment.
Admission and producer objects check their namespace-derived destination before accepting work.

The original admission object also owns the placement directory. Its bounded public cache holds at most 128 wallet assignments per Wasm instance.
A cache miss or restart resolves the same stored assignment. Placement failure cannot select another group.
Increasing the count assigns new wallets round-robin. It never moves existing wallets. The persisted allocation count cannot decrease.
Moving existing wallets between groups remains unsupported.

Older activations, registration journals, signing journals, cooldowns, and active registration claims normalize to group zero before new allocation.
Registration jobs carry their owning group. Older persisted jobs decode as group zero at the boundary.
This private metadata change preserves canonical key derivation, cryptographic domains, circuit identities, signatures, and participant sealing.

## Resource bounds

For `G` enabled groups and `P` refill slots per group, at most `G × P` refill leases can run concurrently.
Generic registration preparation has a separate bound of one preparing job per group. Include it in deployment budgets.
Signing slots remain bounded per group. Wallet cooldown, thirty-two-candidate stock, sixteen-candidate admission minimum, and two-at-once consumption remain unchanged.

Distinct objects can share one Worker execution context, called an isolate.
Cloudflare documents a 128 MB isolate limit and shared memory across objects. [Cloudflare memory documentation](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/#memory-usage).
The unguarded local overlap reaches 161,873,920 Wasm bytes at A, so object-level admission alone is insufficient.

An isolate-local compute guard now permits one heavy refill per participant isolate.
Busy A alarms preserve Queued state and rearm the existing alarm before Running, role claims, or peer dispatch.
A checks current authority and occupancy after acquiring its guard.
B acquires its guard before claiming role material or returning HTTP 101, with a job-deadline bound and a fresh authority check afterward.
Both guards remain held through publication and cleanup. No storage transaction spans the B wait.
The A-before-B order prevents opposite resource ownership between co-located jobs.

The final local overlap reports a maximum of one active preparation and 117,506,048 Wasm bytes, about 112.1 MiB.
This excludes JavaScript heap and does not establish the complete hosted memory budget.
Observed busy-alarm intervals in the guarded control are 1,022–1,062 ms. The alarm helper can retain an earlier deadline, so this is not a strict backoff guarantee.
Co-located jobs serialize. Separate isolates can progress independently. The linked hosted comparison measures achieved throughput. Physical CPU placement and production capacity remain unqualified.

## Local evidence and limitations

The final frozen binaries pass:

- Canonical registration and wallet-seed recovery in different groups, with the same recovered public key.
- Signing and refill in one group while another holds admission or a producer lease.
- Two real refill jobs using distinct producer objects, with exact paired publication and full reserve restoration.
- Duplicate-result reuse, wrong-group rejection, restart, expansion through four group identities, and rejected allocation-count decrease.
- Migration of seventy failed-only journal fixtures across the sixty-four-row page boundary, plus cooldown-only and active wallets.
- The existing complete one-group interruption, publication-recovery, retained-material, replay, and two-producer campaign.

An earlier routing prototype fails the historical-journal test by assigning group one instead of zero. The final implementation preserves zero.
Two initial test failures are evidence-checker gaps: masked error text and reclaimed material used by earlier verified signatures.
The preserved committed receipts show eleven and two reclaimed pairs in those earlier interruption cases; stage-only observations omit initial-load takes.
The corrected evidence counts independently verified uses with matching A/B receipts.

A separate local stall samples 828 Node main-thread stacks in `Atomics.wait`. Storage still records twelve Published jobs and one Running job.
Prebinding clients restores progress without protocol changes. Classify that case as environment_or_infrastructure_failure.
The exact unsymbolized synchronous proxy call remains unknown. Empty buffered output did not establish idle protocol execution.

Directory initialization scans retained journals in one transaction. Pages are bounded; total migration cost is not bounded by page size.
The local B topology does not directly inject an asymmetric guard waiter or its cancellation.
Public SDK/browser overhead, hosted memory, and sustained scaling are outside these local measurements.

## Rollout and hosted qualification

Keep one group, one refill slot, one signing slot, and the sixty-second wallet cooldown in production.
Drain in-flight ceremonies before upgrading all roles. Retain one-group configuration during the initial metadata normalization.
Before admitting registrations in added groups, prepare generic stock for wallet scopes assigned to those groups. Check each returned job's group.
Enable two groups first, then qualify four. Preserve older wallet assignments and all single-use records.

The temporary campaign compares one, two, and four groups with four active synthetic wallets per profile.
It uses two refill slots per group and a five-second benchmark cooldown for demand headroom. Production settings remain unchanged.
Each profile consumes its initial stock and restores exact final reserves. Measure failures, queues, complete waits, CPU, and verified signatures/minute.
The fixed-wallet comparison measures concurrency. It does not establish proportional scaling for a growing user population.
Existing profile wallets remain assigned and idle; account for their maintenance work if it overlaps later windows.

[Replayable local evidence](../evidence/ml-dsa-65-service-groups-local-20261030.json) contains final build hashes, source snapshots, raw failures, independent verification, and credential-scan scope.

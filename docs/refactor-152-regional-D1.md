# Refactor 152: regional D1 ownership and placement

Date: September 30, 2026

Status: planned. A controlled same-wallet London comparison now shows that
moving the Gateway to Tokyo alone worsens complete signing latency, despite
shorter D1 calls. Aligning a regional primary with the existing Gateway/custody
path remains unmeasured. Provisioning and production rollout stay gated on the
ownership checks and regional experiment below.

## Objective and starting evidence

Reduce complete system-controlled signing latency by bringing the remaining
authoritative D1 calls closer to the Gateway and role-separated custody DOs.
Retain the architecture established by
[R150](refactor-150-regional-wallet-home-lanes.md). Custody material stays with
its owning role; this plan concerns Gateway authorization, policy, sessions,
quotas, and durable operation records.

[R151](refactor-151.md) reduced canonical reusable-session ECDSA prepare/finalize
from 18 to five Gateway D1 calls (six SQL statements and two write-bearing calls).
Both linked generations also use five calls after the custody and policy joins.
The [session-read follow-up](refactor-151-session-read.md) inventories the wider
SDK path and consolidates its status reads. Use its final source/build identities
and complete request budget as the next experiment baseline.
The earlier hosted
12-call cohort reported median summed D1 wall time
of approximately 865–901 ms versus 14–15 ms of SQL execution, with all calls
served by the APAC primary. Gateway and DO execution locations were unverified.
These numbers justify investigation; the difference includes scheduling,
binding, service, and transport overhead and cannot be attributed wholly to
distance or treated as recoverable latency.

The subsequent stable-rollout cohort verifies 35 signatures across Tokyo
(`nrt13`), London (`lhr15`), and the US (`ord12`). All 28 timed signatures retain
seven D1 calls served by the APAC primary. First/warm D1 wall medians are 614,
1,766, and 1,672 ms respectively, versus 16.56, 11.94, and 11.18 ms SQL execution.
Warm SDK medians are 1.97, 4.04, and 4.14 seconds, including automated confirmation.
Cloudflare adaptive analytics subsequently identify aggregate Gateway execution
in NRT, LHR, and ORD and role DO execution also in KIX and AMS. These aggregates
do not identify each signing RPC. This remains a regional-path observation with
one configuration and no isolated regional-D1 benefit. Execution evidence:
`.artifacts/r151/regional-workloads-20260930-r7/placement-complete.json`.

Seven of eight dispatched wallet attempts completed; one Tokyo unlock action
timed out without a process signal and remains unresolved. London and US each
completed all three attempts after preflight required completed image rollouts,
matching application versions, and two stable observations. Preserve earlier
failed cohorts separately. Five further fresh Tokyo attempts completed unlock
and 25 verified signatures; the original timeout did not reproduce. A local
network-failure E2E verifies a visible error and successful explicit user retry.
Linked timing passes on all three local backend profiles (27 signatures).
Subsequent hosted linked chains also passed in Tokyo, London, and the US
(27 signatures), retaining nine D1 calls per linked signature. First linked
signatures spent 6.15–13.44 seconds generating material in the foreground.
R151 implements background preparation after linked activation and verifies
consumption of that material. A subsequent joined linked-custody credential read
(`09608843`) reduces both linked generations to seven calls/eight statements,
matching canonical signing at that checkpoint. The subsequent policy snapshot
join reduces prepare/finalize to five calls; the seven- and nine-call cohorts
remain historical baselines.

The first two placement preflights dispatched no wallet operations because a
probe image rollout could not become healthy (Tokyo, then the US). Subsequent
independent regional cohorts completed successfully. Preserve those failed
preflights as infrastructure evidence. No regional database has been provisioned.

An independent London cohort completed the A/B Gateway-placement experiment:
three same-wallet pairs, all signatures verified. Median D1 wall time fell from
2,007 to 584 ms, while custody proxy stages rose from 160 to 2,239 ms and complete
SDK time rose from 4,650 to 6,627 ms. Every pair became slower. Execution analytics
confirm LHR for default Gateway versions and NRT for Tokyo versions; per-request
placement headers were unavailable. This supports testing a primary near the
existing Gateway/custody path rather than moving only the Gateway. It does not
establish a regional-D1 benefit. Fixed default-then-Tokyo ordering, three samples,
and aggregate DO attribution limit the conclusion. Evidence:
`.artifacts/r151/regional-placement-20260930-r11/`.

R150's D1-versus-DO custody comparison did not measure the benefit of aligning
the residual Gateway database. There is no measured regional-D1 gain yet.
The complete signing target remains 1–2 seconds, including SDK orchestration,
authorization, presign waiting, prepare/finalize, and verified signature return.
Human decision time and transaction broadcasting are reported separately.

## Platform constraints

- D1 primary location hints apply when creating a database and are best effort.
  A matching region label cannot establish same-datacenter placement. Jurisdiction
  constraints take precedence over hints. See
  [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/).
- Worker placement can optimize proximity to backends. Evaluate Smart Placement
  and supported explicit placement hints using the current deployment tooling;
  record observed execution evidence separately from the requested placement.
  See [Worker placement](https://developers.cloudflare.com/workers/configuration/placement/)
  and [explicit placement hints](https://developers.cloudflare.com/changelog/post/2026-01-22-explicit-placement-hints/).
- DO location hints are also best effort. Use fresh experiment objects when
  testing initial placement and record which role objects were exercised. See
  [DO data location](https://developers.cloudflare.com/durable-objects/reference/data-location/).
- D1 replicas are asynchronous and writes go to the primary. Session bookmarks
  provide ordering relative to the supplied bookmark; they do not prove that an
  independent session's latest revocation has been observed. Keep authoritative
  admission checks on an appropriate primary-consistent path. See
  [D1 read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/).

## Phase 1: establish the residual cost

- [x] Finish R151's supported-call-budget review and record the resulting canonical,
  linked, replay, and rejected-request budgets. Retain admission, atomic quota,
  material freshness, and durable completion invariants. Both canonical and linked
  signing use seven calls. The wider policy/material join remains deferred at
  trusted verification/admission boundaries. This is an adopted budget rather
  than a proven theoretical minimum.
- [ ] Freeze SDK, Gateway, role builds, schema, concurrency, and refill settings
  for each cohort. Record source revisions and distribution hashes.
- [ ] Reuse the existing isolated benchmark and per-call D1 instrumentation.
  Correlate browser spans, Gateway requests, and role operations without storing
  credentials, signing material, or request bodies in the public evidence.
- [ ] Record probe location, ingress colo, available Gateway execution-location
  evidence, role DO placement evidence, and every D1 call's served region and
  primary flag. Mark unknown locations explicitly. Ingress colo alone cannot
  establish where application code executed.
- [ ] Measure immediate first sign, ready-pool warm sign, and concurrent burst
  separately, including refill overlap, queueing, and foreground wait. Report
  calls, statements, write-bearing calls, row writes, D1 wall/SQL time, and full
  system-controlled latency. Verify every returned signature.

Experiment preparation can proceed alongside R151. A regional ownership decision
uses the residual cost after supported call reductions have been implemented.

## Phase 2: controlled placement comparison

Use the same workloads and build identities in these arms:

| Arm | Database and compute | Question |
| --- | --- | --- |
| A | Existing primary and current Gateway/DO configuration | What is the optimized baseline? |
| B | Same primary and DOs; Gateway placement optimized near that primary | Can Gateway placement alone remove the relevant cost? |
| C | Fresh isolated regional primary, aligned Gateway, and fresh role DOs | Does regional ownership improve complete signing beyond B? |

- [x] Run A/B first. Include the Gateway-to-DO leg: improving D1 proximity can
  increase custody RPC latency. Confirm the placement treatment took effect.
- [ ] If residual cost warrants C, provision isolated test databases using APAC,
  WEUR, and ENAM hints where verified probes are available. Keep fresh data,
  registration distribution, and object age comparable across arms. Add a
  matched fresh baseline when necessary to separate placement from data age.
- [ ] Alternate arm order across at least two runs. Target at least 30 completed
  signatures per arm, probe region, and workload; record errors and incomplete
  attempts in the denominator. Distinguish independent fresh-wallet first-sign
  samples from repeated signatures on an existing wallet.
- [ ] Report p50, p95, observed maximum, sample count, error rate, and paired
  differences where the workload permits pairing. Preserve raw redacted samples.
  A small cohort maximum does not establish a universal two-second bound.
- [ ] Use a proposed benefit gate of at least 20% and 100 ms improvement in
  full-path p95 over the best simpler arm across repeated runs. Record uncertainty
  and tail/error regressions in other regions. Revisit the gate explicitly before
  running if the measured baseline makes it inappropriate.
- [ ] Reconcile cumulative Cloudflare experiment cost before provisioning or
  reruns; keep the existing $25 cap and isolated-resource scope. Preserve R150's
  unresolved ENAM infrastructure failure separately. Stop at the budget limit
  and retain incomplete evidence rather than silently expanding the experiment.
- [ ] Record a decision: retain current ownership, change Gateway placement only,
  or proceed to regional ownership design. A no-go result completes this phase.
  Restore temporary deployments and clean up only resources owned by this run.

## Phase 3: prove the ownership boundary

Proceed only when Phase 2 demonstrates material residual benefit.

- [ ] Inventory every table, trigger, admission check, revocation, policy update,
  quota, replay key, and administration path touched by a signature. Identify
  which values must participate in the same transaction or freshness boundary.
- [ ] Choose the smallest ownership unit containing that state. Prefer an
  existing tenant/project boundary when quotas or policy are shared. Wallet
  ownership is valid only after proving that cross-wallet atomic state is absent
  or remains enforced without losing the measured benefit.
- [ ] Keep exactly one authoritative writable home for each ownership unit.
  Multiple regional databases hold disjoint owners. Independent writable copies
  of the same quota, revocation state, or operation are excluded.
- [ ] Identify globally shared configuration and its consistency requirements.
  If a global authority check still needs a remote round trip, include it in the
  experiment and decision. Do not add asynchronous authority copies to hide it.
- [ ] Reuse existing trusted tenant/environment routing where possible. Define
  required owner, home, and routing-generation identity at the server boundary.
  Reject inconsistent or stale routes before any mutation. Route lookup itself
  must be counted in the complete latency budget.
- [ ] Assign a stable initial home server-side. Browser hints are advisory input;
  browser assertions cannot select an alternative authority. Avoid a mandatory
  home picker, travel profiling, and automatic geographic migration.
- [ ] Verify every entry point reaches the same home: Gateway, role RPC,
  recovery, linking, revocation, quota administration, scheduled work, and replay.
  Fail closed when authoritative routing or the home is unavailable. Any redirect
  must be bounded and validated before credentials are sent onward.

## Phase 4: migration and failure rules

Start a rollout with newly created ownership units if that avoids migration.
Keep existing owners at their current home until a separately verified transfer
exists. Do not introduce migration machinery solely for the initial experiment.

Before transferring existing state:

- [ ] Model explicit transfer states and required branch-specific data. Fence
  source writes, drain or resolve admitted operations, copy a consistent state,
  verify it, activate the target generation, and retain a source routing tombstone.
  Source and target must never accept writes for the same active generation.
- [ ] Include quotas, revocations, expiries, material retirement, linked-device
  provenance, pending claims, completed replay responses, and one-use material
  references in the transfer proof. Account for in-flight work already accepted
  by role DOs and bind its completion to the authoritative operation.
- [ ] Prove fencing at every mutation boundary, including stale Gateways and
  direct/internal entry points. A routing-directory change alone is insufficient.
- [ ] Define recovery for failure at every transfer transition. Before target
  activation, resume the source only after proving target writes never started.
  After activation, rollback is another fenced transfer; a stale source or
  asynchronous replica cannot become an automatic fallback writer.
- [ ] Preserve role-specific custody ownership. Any DO relocation or custody
  transfer requires its own protocol proof and measured cost.

## Phase 5: verification and rollout decision

- [ ] Reuse behavioral E2Es for concurrent last-quota contention, duplicate
  admission, lost finalize responses, exact replay, revocation, material
  retirement, recovery, and second/third-generation device linking.
- [ ] Add regional routing scenarios with the same operation concurrently sent
  through two entry regions and a stale home. Verify one quota consumption,
  one custody effect, exact replay, and refusal of wrong tenant/environment data.
- [ ] For migration, inject failures before and after activation and while an
  operation is in flight. Verify uninterrupted key identity and signature
  validity, preserved denial state, and no dual writer after retry or rollback.
- [ ] Exercise shared behavior on Workers D1, wallet-DO composition, and the VM
  reference when shared contracts change. Keep placement in the deployment
  adapter. Use existing type fixtures for domain-state guarantees; add no unit
  tests or source-text guards.
- [ ] Produce repeatable evidence with deployment/build identities, routing
  generations, placement evidence, redacted traces, verified signatures, quota
  and replay outcomes, latency distributions, cost, and cleanup records.
- [ ] Review a concrete rollout: measured gain, operational cost, chosen owner,
  migration scope, failure behavior, staged cohort, and rollback procedure.
  Production activation is a separate decision after these gates pass.

## Completion

The investigation is complete when it records a reproducible placement result
and a justified ownership decision. Regional implementation is complete only
after its ownership, failure, correctness, latency, and rollout gates pass.
Keep unproven regions and deferred migration work visible; a region label or
lower SQL latency alone cannot close this plan.

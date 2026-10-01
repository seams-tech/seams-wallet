# Refactor 152: regional D1 ownership and placement

Date: September 30, 2026

Status: placement investigation and ownership design in progress. Repeated London
and Tokyo ready-material comparisons each favor their nearby primary. Each
ready-material comparison has 180 verified signatures: 30 owner and 60 linked
signatures per D1 arm.
Tokyo retains one additional collection failure with unknown Wallet outcome.
A separate real-Console Tokyo diagnostic verifies eighteen signatures. Missing
registration projection, cold unlock, repeated authenticated cohorts, broader
workloads and production routing remain gated on the checks below. The October 1
[ownership review and first experiment](refactor-152-ownership-review.md)
defines a whole-deployment-namespace diagnostic and records the remaining
production routing proof. The October 1 implementation request authorizes that
concrete two-database experiment. Both isolated databases are provisioned and
have the same 39 migrations; measured placement results are recorded in
[the regional experiment log](refactor-152-results.md).

## Objective and starting evidence

Use the [R151 empirical results](refactor-151-results.md) as the consolidated
baseline index; preserve each cohort's scope and build identity when comparing.

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
preflights as infrastructure evidence. The subsequent October 1 experiment
provisions fresh APAC and WEUR databases, separately from those earlier cohorts.

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
the residual Gateway database. R152's subsequent regional-D1 gain is recorded
separately in [the October 1 experiment results](refactor-152-results.md).
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
  prepare/finalize use five calls after the policy/material join. The full
  ready-material owner path uses seven calls, including two status reads;
  linked signing uses five. Replay/rejection correctness evidence remains
  separate from successful-signature latency. These are adopted measured
  budgets; a theoretical minimum remains unproven.
- [x] Freeze SDK, Gateway, role builds, schema, concurrency, and refill settings
  for each cohort. Record source revisions and distribution hashes.
- [x] Reuse the existing isolated benchmark and per-call D1 instrumentation.
  Correlate browser spans, Gateway requests, and role operations without storing
  credentials, signing material, or request bodies in the public evidence.
- [x] Record probe location, ingress colo, available Gateway execution-location
  evidence, role DO placement evidence, and every D1 call's served region and
  primary flag. Mark unknown locations explicitly. Ingress colo alone cannot
  establish where application code executed.
- [x] Measure London immediate first sign, ready-pool warm sign, and concurrent
  burst separately, retaining refill overlap and foreground-wait evidence. All
  30 diagnostic signatures verified. Report D1/write budgets and SDK distributions
  separately from browser harness time; concurrent durations overlap. The repeated
  sample target and other probe regions remain Phase 2 gates.

Experiment preparation can proceed alongside R151. A regional ownership decision
uses the residual cost after supported call reductions have been implemented.
R151 r16/r17 freeze builds and instrument the ready-material London workload.
The repeated R152 regional treatment completes the London ready-material
sample target with 180 verified signatures: owner p95 2,638.4→942.7 ms and linked
p95 2,457.7→927.0 ms. A separate six-wallet first-sign/burst diagnostic verifies
30 more signatures; its WEUR first-sign median is 1,151.9 ms and burst median
1,333.6 ms, with a 2,017.2 ms burst maximum. The broader repeated workload/region
matrix stays open; see [results and limitations](refactor-152-results.md).

## Phase 2: controlled placement comparison

Use the same workloads and build identities in these arms:

| Arm | Database and compute | Question |
| --- | --- | --- |
| A | Existing primary and current Gateway/DO configuration | What is the optimized baseline? |
| B | Same primary and DOs; Gateway placement optimized near that primary | Can Gateway placement alone remove the relevant cost? |
| C | Fresh APAC control versus fresh WEUR primary; fixed Gateway and role builds, fresh wallets in both arms | Does regional D1 improve complete signing with the existing compute path? |

- [x] Run A/B first. Include the Gateway-to-DO leg: improving D1 proximity can
  increase custody RPC latency. Confirm the placement treatment took effect.
- [x] Complete the London ready-material regional-D1 comparison across two
  probe boots and alternating arm order: 30 owner and 60 linked signatures per
  arm, all verified. Owner/linked p95 improves 64.3%/62.3%, meeting the proposed
  benefit criterion for this workload. Preserve its static-Console scope and
  keep the broader workload/region gates below open.
- [x] Complete the Tokyo ready-material sample target with 30 owner and 60 linked
  signatures per arm across ten completed wallets per arm. APAC versus WEUR D1
  lowers owner p95 3,173.6→2,065.6 ms and linked p95 2,970.6→1,637.1 ms
  (34.9%/44.9%). Count the additional WEUR collection failure in its 11 dispatched
  attempts, preserve rejected Osaka candidates, and retain the independent-boot,
  temporal-block and static-Console limitations. See the
  [sample extension](refactor-152-results.md#tokyo-sample-extension-october-1).
- [x] Provision the initial fresh APAC control and WEUR treatment with matching
  schemas, separate namespaces, fixed builds, and comparable fresh-wallet
  registration. Record database identities, actual primary-region metadata,
  deployed binding pairs, cost, and restoration evidence.
- [ ] Extend the matched comparison to other probe regions and, when warranted,
  an ENAM primary. Keep registration distribution and object age comparable;
  retain the original ENAM infrastructure failure separately. Three R152 Tokyo
  preflights and a subsequent direct-Linux-manifest diagnostic dispatched no
  wallets because the target probe image could not become healthy. Authenticated
  registry reads verified the target manifest/configuration. The direct manifest
  also produced a Container allocation error before process startup; the underlying
  provider cause remains unresolved. All failures and cleanup receipts are retained.
  Probe rollback required a byte-identical redeployment; the new restoration
  baseline is `c573e917-9faf-4448-a4a1-d6eb2d845fef`, recorded in the experiment log.
  A subsequent Docker-format manifest with identical configuration/layers also
  failed the original Tokyo application's readiness gate. Temporarily moving
  the existing idle WEUR application to APAC successfully started that frozen
  SDK in Hong Kong; the location gate rejected it before wallet dispatch.
  Those attempts supplied no Tokyo measurements. Preserve the separate failed preflight/rollout and
  Hong Kong startup receipts; use them for provider investigation of the
  original application and Tokyo provisioning path. APAC constraints cannot
  guarantee a Tokyo location. See the [repair attempts](refactor-152-results.md#tokyo-repair-attempts-image-format-and-alternate-application-october-1).
  A later WEUR→APAC placement reset recovered the original application's target
  rollout, first in London and then Hong Kong. A smaller 1-vCPU / 6-GiB probe
  also started in Hong Kong. Both failed the Tokyo location gate before wallet
  dispatch. The user approved a temporary Worker/namespace/Container bundle;
  Durable Object scheduling with provider-verified placement subsequently
  started the frozen SDK in `nrt08` and completed Tokyo signing. Keep rejected
  Osaka placements and the between-arm probe restart separate. Use bounded
  candidate discovery and a fresh, stable cohort per arm; broader sample-count,
  workload and authenticated Console gates remain open. The initial Tokyo cohort
  verifies 18 signatures (three owner and six linked per D1 arm); owner medians
  are 1,673.8 ms with APAC D1 and 3,010.5 ms with WEUR D1. All temporary resources
  were deleted after verification. The subsequent extension reaches 180 verified
  Tokyo signatures; the US and broader workload matrix remain open. See the
  [Tokyo results](refactor-152-results.md#tokyo-signing-results-and-cleanup).
- [ ] Alternate arm order across at least two runs. Target at least 30 completed
  signatures per arm, probe region, and workload; record errors and incomplete
  attempts in the denominator. Distinguish independent fresh-wallet first-sign
  samples from repeated signatures on an existing wallet. The ready-material
  London/Tokyo targets are complete; repeated immediate-first/burst and US
  workloads remain open.
- [x] Report p50, p95, observed maximum, sample count, and error rate for the
  completed London workloads. Preserve raw redacted samples. Arms use distinct
  wallets; distributions are unpaired. Continue this accounting for each region.
  A small cohort maximum does not establish a universal two-second bound.
- [ ] Use a proposed benefit gate of at least 20% and 100 ms improvement in
  full-path p95 over the best simpler arm across repeated runs. Record uncertainty
  and tail/error regressions in other regions. Revisit the gate explicitly before
  running if the measured baseline makes it inappropriate. London's WEUR
  treatment meets this latency criterion over the APAC baseline for ready-material
  signing. Tokyo supports retaining APAC and demonstrates the cost of a WEUR-only
  placement there. Its owner maximum is 2,069.4 ms, so a universal two-second
  bound is unproven.
- [x] Reconcile cumulative Cloudflare experiment cost before provisioning and
  each completed run; continue before every rerun. Keep the existing $25 cap and
  isolated-resource scope. Preserve R150's
  unresolved ENAM infrastructure failure separately. Stop at the budget limit
  and retain incomplete evidence rather than silently expanding the experiment.
- [ ] Record a decision: retain current ownership, change Gateway placement only,
  or proceed to regional ownership design. A no-go result completes this phase.
  Restore temporary deployments and clean up only resources owned by this run.

### Next authenticated Console cohort

- [x] Verify full Console Worker initialization and its real credential service
  client locally. Private commit `7eef6d4` passes credential issuance/authentication,
  origin/environment rejection, rotation, revocation, environment lookup, and
  unprovisioned-root rejection. The existing binding E2E also passes. See the
  [preflight and fixture audit](refactor-152-results.md#authenticated-console-local-preflight-october-1).
- [x] Prepare a fresh Console-supported development fixture. The static benchmark
  uses an unsupported key format and `bench` environment; its reduced root receipt
  also lacks Console-required ready fields. Use production provisioning services
  and retain the full root response. Two fresh development identities now have
  active roots and complete Console grant receipts; their Wallet namespaces and
  organizations are disjoint. Keep the existing static cohorts unchanged.
- [x] Prepare Console authority in one fixed database for the two
  Gateway D1 homes. Audit schema overlap and apply required Console migrations
  without resetting retained Wallet data. Configure the complete isolated Console
  handler and preserve the frozen custody-role deployments. The migration
  rehearsal and remote readback preserve all existing schema objects. Console
  authority stays in APAC; only that database receives the additional 22 Console
  migration files. See the [hosted fixture evidence](refactor-152-results.md#hosted-console-fixture-provisioning-october-1).
- [x] Run the first hosted signing diagnostic through the real Gateway → Console
  composition. Two fresh wallets in provider-verified Tokyo complete registration,
  two generations of linking and 18 verified signatures with the frozen SDK image
  and Wallet Server 0.7.3. Console stays in APAC while Gateway D1 changes from APAC
  to WEUR. Record Console calls and Gateway D1 metadata separately. The existing
  harness namespace check is preserved by correcting the private fixture names.
  See the [authenticated diagnostic](refactor-152-results.md#hosted-console-signing-diagnostic-october-1).
- [ ] Close the demonstrated registration-projection gap before extending this
  cohort: successful hosted registration creates no Console Wallet index entry.
  Wallet Server 0.7.3 wires a usage client but no registration projection adapter;
  activation skips its optional projection hook. Wire the verified registration
  result through the existing Console service boundary, then exercise actual
  registration and replay through the composed Gateway and assert one projection
  with no registration monthly-usage charge. Direct usage-client tests alone do
  not cover this missing producer path. Preserve the successful frozen cohort.
- [ ] Verify a separate cold unlock and its Console dependencies, then repeat
  the matched diagnostic with reversed arm order before extending sample counts.
  Retain failures, reconcile cost, revoke credentials, remove the active binding,
  close ingress and verify restoration after every cohort. Successful signing
  alone does not close the complete authenticated-composition gate or authorize
  production regional routing.

## Phase 3: prove the ownership boundary

Complete the experiment's isolation review before Phase 2C. The
[initial review](refactor-152-ownership-review.md) keeps all tables of each fresh
deployment namespace in one database and records the authorization scope
constraint. Proceed with production regional ownership/routing implementation
only when Phase 2 demonstrates material benefit. The complete production proofs
below remain open.

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
  Private Console now consumes Wallet 0.7.3 and exposes binding wall time on
  status requests, plus Console D1 wall/SQL/available placement metrics. An isolated
  service E2E verifies propagation and fresh binding reads locally. A hosted NRT
  cohort now verifies production Gateway → Console → D1 timing and revision
  freshness: 64 unauthenticated status probes, binding p50 64 ms with APAC versus
  246 ms with WEUR. Full authenticated signing composition remains open; this
  lookup-only cohort does not measure signing latency. See the experiment log.
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

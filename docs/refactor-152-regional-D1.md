# Refactor 152: regional D1 ownership and placement

Date: September 30, 2026

Status: placement investigation and ownership design in progress. Repeated London
and Tokyo ready-material comparisons each favor their nearby primary. Each
ready-material comparison has 180 verified signatures: 30 owner and 60 linked
signatures per D1 arm.
Tokyo retains one additional collection failure with unknown Wallet outcome.
The first real-Console Tokyo diagnostic verifies eighteen signatures. The
registration projection gap is now fixed in source and verified through hosted
replay/reply-loss checks. A separate server candidate verifies a reversed-order
18-signature comparison and cold unlock/burst in both D1 arms (28 candidate
signatures total). A separate local-browser follow-up verifies twelve more
signatures, measures individual cold-unlock calls and proves ECDSA activation-loss
recovery through hosted Console. The next candidate removes nine authority
initialization calls and verifies thirty signatures across cold unlock,
activation recovery and device linking. The subsequent commit-readback candidate
verifies thirty signatures and removes one further call: cold unlock is now 29
Gateway calls and activation-loss recovery is 25, each with two Console calls.
The latest hosted Tokyo repeat failed during Container allocation before any
browser dispatch; cleanup and restoration are verified. Repeated authenticated cohorts,
broader workloads and production routing remain gated on the checks below. The October 1
[ownership review and first experiment](refactor-152-ownership-review.md)
defines a whole-deployment-namespace diagnostic and records the remaining
production routing proof. The October 1 implementation request authorizes that
concrete two-database experiment. Both isolated databases are provisioned and
have the same 39 migrations; measured placement results are recorded in
[the regional experiment log](refactor-152-results.md).

The Console namespace-home reservation primitive is implemented and verified
locally in private commit `12784a3`. Concurrent callers share one immutable
account/database assignment, including after interrupted provisioning and restart.
Private commit `a09e454` integrates the reservation into authenticated
provisioning admission: missing or conflicting assignments fail before cutover,
custody or credential creation. Existing-resource inventory/pinning,
physical-resource verification and regional runtime routing remain
open. Private commit `afeea62` also requires the reserved resource at activation
and records it in the activation transaction. Historical activation rows remain
unattested; a new activation can record their pinned home without rewriting the
binding. These changes have not been deployed.

October 2 private commit `dd6f5bf` makes home identity required in the canonical
binding hash, adds explicit historical-binding adoption to a new revision, and
checks configured resource identity in bound runtime consumers. Private commit
`97e0426` adds explicit operator adoption, fresh production readiness and canary
retry handling, verified locally through the production Console Worker. Physical
resource verification, coordinated adoption/deployment with hosted canary evidence,
and remaining entry-point coverage are still rollout gates. See the
[contract/adoption evidence](refactor-152-results.md#canonical-home-contract-and-adoption-october-2).

Private commit `877890d` adds a read-only provider binding checkpoint for every
serving version of the lane's Gateway and Wallet Runtime, including gradual
rollouts and deployment-drift detection. The local CLI E2E covers ten scenarios.
The live production-testnet provider check passed October 2 using saved Wrangler
OAuth credentials. Private commit `022e1a9` implements a fresh database challenge
and comparison with Console's immutable reservation, verified locally through
the production Console, Gateway and Wallet Runtime Workers. Its signer migration
0040 requires a new exact Wallet Server release before deployment; the private
repository currently consumes 0.7.3. Live runtime verification and joining both
checkpoints to activation remain open. Neither checkpoint authorizes activation. See the
[provider checkpoint evidence](refactor-152-results.md#provider-binding-checkpoint-october-2).

Private commit `5dca209` joins provider and runtime evidence in one operator
checkpoint. It matches each answering Worker version to Cloudflare's serving
version and verifies stable deployments before and after the fresh challenge.
Four related local E2Es pass. The combined check requires one serving version per
writer; it rejects gradual rollouts before writing the challenge. Live execution
and activation enforcement remain open. See the
[version-bound checkpoint evidence](refactor-152-results.md#version-bound-home-checkpoint-october-2).

Private commit `a367716` consumes that evidence atomically with activation and
enforces the activated versions on split Gateway requests/scheduled work and
bound Wallet Runtime requests. The nine related local E2Es pass. The subsequent
local follow-up fixes production-testnet rollout ordering and verifies readiness
before/after activation and stale-version rejection. The migration release,
hosted rollout execution and remaining writer coverage are still open. See the
[activation evidence](refactor-152-results.md#activation-consumption-and-runtime-version-admission-october-2).

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
- [x] Close the demonstrated registration-projection gap. The managed Gateway
  now supplies the existing projection adapter through the Console service
  boundary. Hosted activation plus lost-reply/exact replay creates one Wallet
  row per registration; the local Console E2E verifies zero registration
  monthly-active-resource rows and rejects organization/scope mismatch. Preserve
  the original frozen cohort and keep the unreleased patched candidate separate.
- [x] Repeat the linked-device diagnostic with reversed arm order. Provider-verified
  Tokyo completes WEUR then APAC: eighteen verified signatures on one recorded
  boot, with the same candidate build and fixed APAC Console authority. Owner
  medians are 3.20s versus 1.93s; linked medians are 2.69s versus 1.57s.
- [x] Complete initial cold-unlock/first/warm/burst diagnostics in both arms.
  Ten verified signatures across two fresh wallets include explicit unlock
  verification after runtime reset and shared-budget exhaustion. The WEUR
  preflight boot change is retained; its replacement passes under a fresh Tokyo
  identity. These single samples use different boots and do not establish a
  controlled latency gain. Server replay/reply-loss checks yield four total new
  projections across the candidate cohorts, with no monthly billing rows.
- [x] Measure unlock's individual Console/D1 calls separately. A local Docker
  browser against the frozen hosted candidate verifies ten first/warm/burst
  signatures. Each unlock uses 39 Gateway D1 calls and two Console calls,
  including nine runtime schema/initialization calls. Summed Gateway D1 wall is
  2.520s with APAC and 9.718s with WEUR; unknown `exec` metadata stays unknown.
  This closes diagnostic call accounting, with provider-verified regional
  repeats still open. See the [measurement scope and artifacts](refactor-152-results.md#local-browser-cold-unlock-accounting).
- [x] Cover ECDSA browser recovery after losing the original activation response
  through hosted Console. Fresh local-browser WEUR/APAC runs each verify three
  exact replays, altered-digest rejection before unlock, one explicit unlock,
  unchanged registration-request count and a signature from the original key.
  Each creates one Console projection, with zero monthly billing rows. Recovery
  uses 35 Gateway D1 calls plus two Console calls. This is correctness evidence;
  provider-verified regional repetition remains open. Preserve the earlier
  diagnostic header-overflow failure separately. See the [recovery evidence](refactor-152-results.md#browser-activation-loss-recovery-through-hosted-console).
- [x] Remove the nine demonstrated request-time authority initialization calls
  in a separate candidate. Migration and remote schema/guard preflights pass;
  duplicate DDL, schema-on-use state/option and the unused setup helper are
  deleted. Thirty verified signatures cover cold unlock, activation recovery
  and second/third-generation linking across both D1 homes. Cold unlock falls
  39 → 30 Gateway D1 calls; recovery falls 35 → 26, retaining two Console calls.
  Remaining query multisets are unchanged. Two failed long linking attempts
  expose a local IPv6/IPv4 readiness mismatch; explicit IPv4 binding fixes the
  launcher and the repeat passes. See the [candidate evidence](refactor-152-results.md#removing-request-time-authority-initialization-october-1).
- [x] Review the remaining unlock reads and writes separately. The D1 commit
  adapter already verifies the persisted session and primary credential digest;
  remove the service's duplicate readback. Account for all 33 reported written
  rows, including index maintenance: 25 in session replacement and eight in
  challenge, authenticator and activity operations. Preserve the full replacement
  transaction and live authority/quota checks. Thirty new verified signatures
  cover both homes: cold unlock now uses 29 Gateway D1 calls and recovery 25,
  with two Console calls each. The four query comparisons remove exactly one
  read; writes remain unchanged and no latency gain is established. Further
  envelope/activity read reuse remains a bounded optimization candidate;
  generic query fingerprints alone do not prove duplicate bound records. See the
  [write inventory and readback reduction](refactor-152-results.md#removing-the-duplicate-session-commit-readback-october-1).
- [ ] Extend authenticated sample counts across fresh wallets and boots, then
  collect the broader workload and region coverage. These small diagnostics do
  not establish a latency distribution or production readiness. Record refill
  overlap and Console costs separately; fourteen Gateway rows written per
  signature and eleven/seven combined owner/linked D1 round trips remain targets
  for the deferred write/round-trip reduction work.
  Retain failures, reconcile cost, revoke credentials, remove the active binding,
  close ingress and verify restoration after every cohort. Successful signing
  alone does not close the complete authenticated-composition gate or authorize
  production regional routing.

Further call/write optimization is tracked in the
[deferred lifecycle budget audit](#deferred-follow-up-lifecycle-d1-call-budgets).
Keep each regional comparison on its frozen candidate while that audit is pending.

## Phase 3: prove the ownership boundary

Complete the experiment's isolation review before Phase 2C. The
[initial review](refactor-152-ownership-review.md) keeps all tables of each fresh
deployment namespace in one database and records the authorization scope
constraint. Proceed with production regional ownership/routing implementation
only when Phase 2 demonstrates material benefit. The complete production proofs
below remain open.

- [x] Classify public, internal, scheduled and custody-alarm entry points against
  their actual storage and side effects. The
  [entry-point review](refactor-152-ownership-review.md#entry-point-review-and-initial-home-implementation-order)
  distinguishes Wallet D1 admission, pre-activation inspection/control, Console
  scheduled custody resumption and role-local expiry. It also identifies the
  missing namespace-wide assignment constraint across deployment lanes.
- [x] Extend the lifecycle transaction inventory to both export curves, linked
  installation/activation/cleanup, method revocation, lane retirement and OTP
  accounting. Record where custody effects precede a D1 commit and distinguish
  Wallet Session quotas from Console quotas. See the
  [lifecycle follow-up](refactor-152-ownership-review.md#lifecycle-ownership-follow-up).
- [ ] Inventory every table, trigger, admission check, revocation, policy update,
  quota, replay key, and administration path touched by a signature. Identify
  which values must participate in the same transaction or freshness boundary.
- [x] Choose the conservative initial ownership unit: the entire deployment
  namespace, including all its organizations/projects. Schema uniqueness,
  signing admission and the lifecycle transaction inventory support keeping
  these records together. Existing namespaces remain pinned. A smaller
  tenant/project/wallet partition requires a separate proof of its cross-owner
  state; this decision does not establish the smallest possible partition.
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
- [x] Implement the namespace-wide reservation primitive in the existing Console
  authority. Private migration `0047_namespace_d1_homes.sql` and the deployment
  store serialize initial assignment across callers, preserve exact retries and
  reject changed account/database identities. Local persistent-D1 E2E verifies
  twelve competing requests, response loss, restart and SQL overwrite guards;
  see [results](refactor-152-results.md#console-namespace-home-reservation-october-1).
- [x] Require the reserved home during authenticated provisioning before lane
  side effects. The production Console Worker E2E verifies signed automation,
  missing-home rejection, concurrent matching/conflicting lanes, refusal of a
  request-supplied home and reservation preservation after custody failure/retry.
  Hosted admission reads the existing reservation once; it cannot create one.
- [ ] Inventory and explicitly pin existing namespaces to their current resource
  before deploying the mandatory admission boundary. Initialize fresh hosted
  namespaces through deployment control. Local bootstrap alone reserves its
  configured development resource as part of provisioning.
- [x] Enforce the reserved home in new activation transactions. Required parsed
  home inputs and a D1 trigger reject missing/conflicting resources. Local E2E
  verifies competing activations, completed retry after readiness expiry, stale
  retry rejection, direct SQL home checks and historical adoption through a new
  activation. This records assignment identity, with physical verification open.
- [x] Require home identity in the canonical binding hash. Ordinary decoding
  rejects bindings without it. Explicit persistence-boundary adoption verifies
  the old hash, checks the namespace reservation and creates a deterministic new
  revision while retaining the original row. Local E2E verifies adoption and
  activation retries, preserved history and tampered-home rejection.
- [x] Compare configured home identity in bound Gateway, Wallet Runtime and
  combined runtime request paths, including Gateway scheduled work. Provisioning
  candidate creation and active reuse also check the configured home. Generated
  configurations carry the same signer-D1 identity. This is configuration
  consistency; actual resource verification remains open.
- [x] Implement explicit operator adoption with fresh production readiness and
  historical source-scope handling. The OIDC-protected route and CLI resume saved
  cutovers, rerun the canary after activation/response failure, preserve the old
  binding and reject stale requests. Local production-Console E2E uses controlled
  external Wallet/canary responses; see the
  [operator evidence](refactor-152-results.md#operator-home-adoption-october-2).
- [ ] Complete coordinated operator adoption/deployment with physical binding
  verification and real hosted canary evidence. Ordinary readers reject old
  bindings and the current deployment job smokes readiness before cutover;
  rollout sequencing must handle that transition. Cover remaining internal
  control/inspection, discovery and administrative paths before claiming every
  entry point enforces home identity. Preserve pre-activation custody bootstrap.
- [x] Implement the provider configuration checkpoint: inspect all versions in
  current Gateway/Wallet Runtime deployments, compare actual `SIGNER_DB` UUIDs
  with the lane manifest and reject deployment/weight changes during inspection.
  Local CLI E2E verifies minority-version mismatches, malformed/missing bindings,
  provider denial, secret exclusion and preserved output identity.
- [x] Run the live production-testnet provider checkpoint. At October 2 09:39 JST,
  both serving Gateway/Wallet Runtime versions bound `SIGNER_DB` to the intended
  UUID and their deployments remained stable across inspection. Saved Wrangler
  OAuth credentials provided access; no provider mutation was performed.
- [x] Implement the fresh runtime challenge and immutable Console-reservation
  comparison. The operator writes a random five-minute proof through the intended
  database UUID, verifies both actual runtime bindings and deletes the proof even
  after a lost INSERT response. Nine related local E2Es pass, including two real
  D1 databases and all forty signer migrations. See the
  [runtime challenge evidence](refactor-152-results.md#runtime-home-challenge-and-live-provider-check-october-2).
- [x] Join runtime proof to provider-verified Worker versions. Generated writer
  configurations expose Cloudflare version metadata; both runtime observations
  must match the serving versions, and provider deployments must stay unchanged
  across the challenge. Missing metadata, wrong versions and deployment drift
  fail. Combined verification requires one version per writer at 100% traffic.
- [x] Bind the combined evidence to a specific cutover operation through the
  protected operator authority. Persist the namespace/home, verified deployments
  and versions, operation identity and expiry. Consume fresh matching evidence
  in the activation transaction and reject replay into a different operation.
  Enforce the activated version identity in runtime admission, covering retries,
  expiry and deployment changes after verification. Console migration 0050 stores
  immutable evidence in the activation row and makes challenge IDs unique. Both
  operator cutover commands now submit fresh verification. Bound Gateway/Runtime
  requests and Gateway cron enforce recorded versions in the existing binding
  lookup. The standalone checkpoint retains `activationAuthorized: false`.
- [x] Coordinate production-testnet deployment so verification, activation and
  canary precede Wallet/Console smoke. Require the packaged challenge migration
  before any deployment job. Both deployment CLI commands use the protected
  coordinator with an explicit environment ID; the backend child is reusable
  only. Wallet smoke rejects unavailable bindings. Local E2E evidence covers
  readiness before/after activation and a changed writer version. This is local
  rollout preparation; hosted execution and other-lane activation remain open.
- [ ] Publish and consume an exact Wallet Server release containing signer
  migration 0040, then coordinate Console migration 0050, service bindings, Worker deployment
  and historical adoption. Run the fresh challenge live and join both checkpoints
  to the immutable Console reservation.
  Validate the fence on hosted Workers and cover other reachable older/internal
  writer paths before claiming complete regional enforcement.
  Local package acceptance now runs the composed three-Worker home-verification
  E2E against extracted candidate JavaScript and all forty packaged migrations.
  The original 39 migration files are unchanged. The private local Worker now
  uses the SDK configuration parser, eliminating its retired `nodeRole` field.
  Full release validation and hosted execution remain distinct gates; see the
  [package-readiness evidence](refactor-152-package-readiness.md).
- [ ] Reuse existing trusted tenant/environment routing where possible. Define
  required owner, home, and routing-generation identity at the server boundary.
  Reject inconsistent or stale routes before any mutation. Route lookup itself
  must be counted in the complete latency budget.
  Use the namespace-wide reservation in the existing Console authority.
  Prove the relationship between the assigned home and the
  actual D1 resource; a lane-level activation CAS or copied identity row is
  insufficient. Preserve authenticated provisioning before first activation.
  The [home identity design](refactor-152-ownership-review.md#home-identity-verification-design)
  specifies provider binding/version inspection plus a fresh database challenge
  through the runtime service. Resource verification and end-to-end provisioning
  race/failure checks remain open; its runtime identity lookup must be included
  in latency accounting.
- [ ] Assign a stable initial home server-side. Browser hints are advisory input;
  browser assertions cannot select an alternative authority. Avoid a mandatory
  home picker, travel profiling, and automatic geographic migration.
- [ ] Implement regional Gateways paired with the assigned D1 homes, initially
  APAC and WEUR. Reuse existing Gateway deployments where possible, bind each to
  its authoritative database, and configure execution placement near that home.
  Route requests through trusted namespace/deployment bindings so a Tokyo client
  using a WEUR namespace reaches its WEUR Gateway. Reuse existing hostname/service
  routing; introduce an additional global routing Worker only if that routing
  cannot select the assigned Gateway. Verify actual execution placement, preserve
  custody-role identities, and measure Gateway-to-DO and Console dependencies.
  D1 home assignment alone does not place the Gateway or custody DOs. Keep this
  work subject to the isolated-experiment and production-rollout gates.
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
- [ ] Measure travel latency using the same WEUR wallet from Europe and Tokyo,
  holding Gateway, D1 and custody placement and build identities fixed. Repeat
  for an APAC home with local and remote clients. Separate browser-to-home round
  trips from internal D1, custody RPC and Console costs; cover ready-material
  signing and cold unlock/first sign. Alternate client order, retain failures,
  verify signatures and report distributions. Confirm remote client location
  never changes the writable home or causes fallback to another database.
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

## Deferred follow-up: lifecycle D1 call budgets

Requested October 1, 2026. Perform this audit later, before the next lifecycle
query-reduction implementation. Numeric targets remain unset until their
required state transitions and freshness boundaries have been analysed.

- [ ] Inventory unlock, signing, wallet recovery, key export, registration,
  device linking, auth-method addition/revocation, session status/refresh,
  recovery-code rotation and background material refill. Split passkey/Email OTP,
  ECDSA/Ed25519, owner/linked devices, cold/warm state and explicit lane selection
  where their work differs. Distinguish lost-activation-response recovery from
  recovery-code-based wallet recovery.
- [ ] Establish a reproducible baseline for each supported flow using existing
  behavioral E2Es and request-level traces. Count foreground Gateway D1 calls,
  Console D1 calls, other-service D1 calls, sequential dependency depth, SQL
  statements, write-bearing calls and reported row writes separately. Attribute
  background/refill overlap separately; keep unknown or unmeasured values explicit.
- [ ] Map each call to its invariant and decision point. Derive a justified
  lower-bound estimate, a practical next target and any stretch target from
  join/batch opportunities and removable duplicate work. Preserve fresh authority,
  revocation/expiry, exact scope, one-use proofs/material, quota contention,
  durable replay and key-identity guarantees. A necessary check need not imply
  a separate network call; a lower call count does not imply fewer durable writes.
- [ ] Publish one tracking table in the results docs: flow/variant, build and
  evidence, measured baseline, proposed target/range, assumptions/confidence,
  required writes, blockers, next optimization and latest verified result.
  Give success, exact replay, rejection and interrupted/retried flows separate
  budgets. Label design estimates explicitly; do not present them as measured
  results or proven theoretical minima.
- [ ] Prioritize by avoidable sequential wall time, frequency and implementation
  risk. Implement later in bounded changes and update the table with repeatable
  before/after E2E artifacts. Recheck the relevant race/replay/revocation scenarios
  and preserve frozen regional cohorts when a candidate changes.

## Completion

The investigation is complete when it records a reproducible placement result
and a justified ownership decision. Regional implementation is complete only
after its ownership, failure, correctness, latency, and rollout gates pass.
Keep unproven regions and deferred migration work visible; a region label or
lower SQL latency alone cannot close this plan.

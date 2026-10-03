# Regional D1 empirical results

Date: October 1, 2026. Status: repeated London ready-material comparison and
first-sign/burst diagnostic complete; temporary DO-scheduled probe unblocks verified Tokyo startup
and signing. Tokyo now also reaches the ready-material sample target: 180 verified
signatures, with 30 owner and 60 linked signatures per D1 arm. Broader regional
and production gates remain open. The first real-Console Tokyo diagnostic
verifies eighteen signatures. Its registration projection gap is now fixed and
verified with hosted reply-loss/replay. A separate server candidate adds an
eighteen-signature reversed-order comparison and cold-unlock/burst diagnostics;
repeated authenticated sample and production ownership gates remain open.

This log implements the bounded experiment in
[the ownership review](refactor-152-ownership-review.md) and preserves evidence
for [R152](refactor-152-regional-D1.md). The production ownership and rollout
gates remain open.

## Consolidated performance summary (October 2)

These observations compare remote and nearer D1 placement in the recorded
experimental topologies. They remain valid evidence for regional placement;
acceptance of the replacement per-wallet home architecture requires new E2Es and
hosted measurements. The [current implementation plan](refactor-152-regional-D1.md#authoritative-replacement-phase-per-wallet-regional-homes)
owns that remaining work. All reductions below are calculated from the unrounded
recorded medians; displayed seconds are rounded.

| Probe / signing operation | Remote D1 median | Nearer D1 median | Median reduction |
| --- | ---: | ---: | ---: |
| London owner, ready material | APAC 2.4451 s | WEUR 0.8501 s | 65.2% |
| London linked devices, ready material | APAC 2.2404 s | WEUR 0.7986 s | 64.4% |
| London immediate first signature | APAC 4.8396 s | WEUR 1.1519 s | 76.2% |
| London concurrent burst | APAC 7.8671 s | WEUR 1.3336 s | 83.0% |
| Tokyo owner, ready material | WEUR 2.96895 s | APAC 1.68995 s | 43.1% |
| Tokyo linked devices, ready material | WEUR 2.61425 s | APAC 1.44755 s | 44.6% |

London's repeated ready-material cohorts verified **180 signatures across 20
fresh wallets**, with 30 owner and 60 linked signatures per arm and zero
failed/incomplete attempts. Owner p95 fell **2.6384 → 0.9427 s** (64.3%);
linked p95 fell **2.4577 → 0.9270 s** (62.3%).
[Full London evidence and reproduction](#repeated-london-ready-material-result).

The London first-sign/burst diagnostic verified **30 additional signatures across
six fresh wallets**, with zero failed/incomplete attempts. There were only three
timed first signs and six timed burst signatures per arm. The median gains were
4.2× and 5.9× respectively; the maximum WEUR burst was **2.0172 s**. Faster
background refill contributed to this end-to-end benefit: APAC needed seven or
eight foreground refill steps per burst, while WEUR needed none. This small
cohort establishes neither a universal two-second bound nor the repeated
first-sign/burst acceptance gate. [Diagnostic evidence](#london-first-sign-and-concurrent-burst-diagnostic).

Tokyo's repeated ready-material cohorts verified **180 signatures across 20
completed fresh wallets**, also with 30 owner and 60 linked signatures per arm.
Owner p95 fell **3.1736 → 2.0656 s** (34.9%); linked p95 fell
**2.9706 → 1.6371 s** (44.9%). One additional WEUR attempt lost its result during
a collection failure; its Wallet outcome remains unknown and is excluded from
the latency distribution. Repeated signatures within each wallet are correlated.
[Full Tokyo evidence, failure ledger and analysis](#tokyo-sample-extension-october-1).

### Where the time went

| Probe / path | Remote summed D1 wall median | Nearer summed D1 wall median | Remote → nearer SQL median |
| --- | ---: | ---: | ---: |
| London owner | 1,762.5 ms | 114 ms | 14.66 → 10.34 ms |
| London linked | 1,559.5 ms | 88 ms | 13.88 → 9.83 ms |
| Tokyo owner | 1,929 ms | 564 ms | 15.38 → 16.45 ms |
| Tokyo linked | 1,713 ms | 500 ms | 14.78 → 15.59 ms |

The placement benefit is dominated by reduced D1 waiting rather than SQL
execution changes. These timings do not attribute every millisecond to network
transport or establish that every custody DO shared a datacenter with D1.
The repeated signing comparisons used static Console composition and retained
the same seven owner / five linked D1-call budgets within their measured windows.
Reducing calls and writes remains a separate optimization target.

### Hosted Console measurements are separate cohorts

Real hosted Console diagnostics also observed a Tokyo benefit with APAC Wallet
D1, while Console authority stayed in APAC:

| Diagnostic / SDK median | Remote WEUR Wallet D1 | Nearer APAC Wallet D1 |
| --- | ---: | ---: |
| Published-server owner signing | 3.2576 s | 2.1652 s |
| Published-server linked signing | 2.6553 s | 1.64945 s |
| Unreleased-candidate owner signing, reversed arm order | 3.1972 s | 1.9346 s |
| Unreleased-candidate linked signing, reversed arm order | 2.6872 s | 1.5748 s |

Each diagnostic verified 18 signatures from one fresh wallet per arm (three owner
and six linked signatures per arm). Timings include confirmation. Preserve these
as separate small cohorts because their server builds differ; neither closes the
repeated authenticated hosted acceptance gate.
[Published-server diagnostic](#hosted-console-signing-diagnostic-october-1) ·
[Candidate reversed-order comparison](#reversed-order-signing-comparison).

A separate Console-placement experiment issued **64 unauthenticated status
requests**, returning the expected HTTP 401 after successful binding lookup.
Among 30 warm observations per arm, complete Gateway binding-lookup median fell
**246 → 64 ms** (74.0%) with APAC Console D1; p95 fell **260 → 149 ms**.
Client request median fell **267.7 → 88.9 ms**. This measures lookup overhead;
no signatures were measured in that cohort. Raw distributions and reproduction
artifacts remain in the hosted Console placement section below.

## Provisioning and schema

| Arm | Database | ID | Deployment namespace |
| --- | --- | --- | --- |
| APAC control | `r150-bench-20261001-r152-apac` | `dfe49f40-25b9-45f2-8cdf-e7d28b7685cd` | `r152-apac-control` |
| WEUR treatment | `r150-bench-20261001-r152-weur` | `a8e95e8c-a298-450f-9f37-27cb16e7fe8e` | `r152-weur-treatment` |

Cloudflare reported the requested region at creation. All 39 frozen Gateway
migrations were imported independently into each empty database; every import
has a matching source hash and verified migration-ledger row. The effective
schemas match: 54 application tables, two platform/migration tables, 63 indexes,
and 30 triggers. Both returned `quick_check: ok` and no foreign-key violations.
Schema reads reported APAC/HKG and WEUR/LHR primary service respectively. The
signing trace format records region and primary status, without per-call colo.

The initial remote `PRAGMA integrity_check` requests returned `SQLITE_AUTH`.
No wallet attempt had started. Verification used the documented
[D1 `PRAGMA quick_check`](https://developers.cloudflare.com/d1/sql-api/sql-statements/#pragma-quick_check)
instead; both initial errors remain in the evidence.

## Controlled workload

SDK source `a2c936ed8808a8b2441b4d035f8da7bd67d45d6e` uses image
`sha256:a30724afbb3d47a4a41d918553e6a4e735dac9ca1d0b402c0eafbff0e5b9d302`.
Gateway source is `dad8f5e99f03d9dca2d99256fb92d00771cbb28c`; its generated
WASM hashes are retained. Existing role deployments and static Console binding
remain fixed. The two Gateway configs differ only in database name/ID and
storage namespace. Gateway placement stays off/default.

The first diagnostic alternates fresh three-device chains in APAC, WEUR, WEUR,
APAC, APAC, WEUR order from the London probe. Each chain verifies nine signatures:
three owner, three second-device, and three third-device signatures. Each arm
therefore targets nine owner and 18 linked samples. Wallets stay in their original
namespace/database. Repeated signatures within a wallet are correlated samples.

`tests/r150-hosted/analyze-regional-d1.mjs` checks complete ready-material
dependency windows: owner seven D1 calls/eight statements/four HTTP requests;
linked five/six/two; both two write-bearing calls and 14 rows written. It requires
successful primary-served calls in the assigned region and no foreground refill.
It reports separate owner/linked p50, nearest-rank p95, maximum, and all dispatched
attempt outcomes. The small diagnostic cannot satisfy the performance gate or
establish a universal two-second bound.

## First London result

All six fresh-wallet chains passed: 54 verified signatures, with three successful
attempts and zero failed/incomplete attempts per arm. The London probe retained
boot `0e729b64-1e48-4fb1-a44b-a5e888073b9a` and the same SDK build throughout.
All signature calls were served by the assigned regional primary and retained
the call, statement, and write budgets above. No foreground refill appeared in
the measured dependency windows.

Cloudflare version records verify all four deployed namespace/database pairs.
Adaptive analytics place all four measured Gateway versions in LHR. All five
custody-role deployment versions are unchanged before/after; aggregate custody
activity includes LHR and AMS. Individual custody RPC placement remains unknown.

| Device path | Samples per arm | APAC SDK p50 / p95 / max (ms) | WEUR SDK p50 / p95 / max (ms) | p95 reduction |
| --- | ---: | ---: | ---: | ---: |
| Owner | 9 | 2,427.6 / 2,638.4 / 2,638.4 | 856.9 / 899.1 / 899.1 | 1,739.3 ms (65.9%) |
| Linked generations combined | 18 | 2,282.2 / 2,473.0 / 2,473.0 | 801.0 / 952.2 / 952.2 | 1,520.8 ms (61.5%) |

Median summed D1 wall time fell from 1,754 to 114 ms for owners, and from
1,595.5 to 93 ms for linked devices. SQL medians were 13.51 versus 10.31 ms and
14.01 versus 9.90 ms respectively. The full-path gain survives returning from
WEUR to APAC in the alternating sequence. This isolates a material placement
benefit in the measured topology; it does not attribute every millisecond of
D1 overhead to network distance.

The result warrants the planned extension to at least 30 owner and 30 linked
signatures per arm across separate runs. Immediate first-sign, concurrent burst,
other regions, production Console dependencies, ownership routing, and rollout
remain open. These ready-material samples alone cannot close those gates.

## Repeated London ready-material result

The second run, `.artifacts/r152/regional-d1-20261001-r2/`, used the same builds,
databases, and namespaces after independently verified restoration. It started
with WEUR and alternated seven fresh chains per arm in reversed-order blocks.
Every newly deployed Gateway version's binding pair was checked before
dispatching a wallet. Its probe boot was
`0106c89d-7a74-4486-a506-f63ddd1e6785`, distinct from the first run.

Both runs together completed all 20 fresh-wallet chains: 180 verified signatures,
with 30 owner and 60 linked samples per arm, zero failed/incomplete attempts,
and the same seven/five-call and two-write/14-row budgets. All measured D1
statements came from the assigned primary. The second run's eight Gateway
versions were observed executing in LHR, and all five custody-role deployment
versions were unchanged before/after.

| Device path | Samples per arm | APAC SDK p50 / p95 / max (ms) | WEUR SDK p50 / p95 / max (ms) | p95 reduction |
| --- | ---: | ---: | ---: | ---: |
| Owner | 30 | 2,445.1 / 2,638.4 / 2,643.9 | 850.1 / 942.7 / 984.3 | 1,695.7 ms (64.3%) |
| Linked generations combined | 60 | 2,240.4 / 2,457.7 / 2,517.8 | 798.6 / 927.0 / 1,018.9 | 1,530.7 ms (62.3%) |

Median summed D1 wall time is 1,762.5→114 ms for owners and 1,559.5→88 ms for
linked devices. Corresponding SQL medians are 14.66→10.34 ms and 13.88→9.83 ms.
Each run independently exceeds the proposed 20%/100 ms full-path p95 benefit
threshold: owner reductions are 65.9% and 63.9%; linked reductions are 61.5% and
62.4%. This satisfies that performance criterion for the London ready-material
workload. It leaves immediate-first/burst, other regions, production Console,
home routing, and migration gates open. Each wallet contributes three repeated
signatures per device; 30 signatures are not 30 independent owner wallets.

The combined evidence is `.artifacts/r152/combined-london-ready.json`. Reproduce:

```sh
node tests/r150-hosted/analyze-regional-d1.mjs \
  .artifacts/r152/combined-london-ready.json weur \
  .artifacts/r152/regional-d1-20261001-r1 \
  .artifacts/r152/regional-d1-20261001-r2
```

## London first-sign and concurrent-burst diagnostic

Run three used the existing immediate-first/warm/concurrent-burst E2E on six
fresh mixed wallets, in APAC, WEUR, WEUR, APAC, APAC, WEUR order. All six attempts
passed, verifying 30 signatures. Each attempt includes one immediate first sign,
one ready-material warm sign, one untimed setup signature in a fresh three-use
session, and a concurrent pair consuming that session's remaining shared quota.
The two concurrent durations overlap and must not be added together.

| Workload | Timed samples per arm | APAC SDK p50 / p95 / max (ms) | WEUR SDK p50 / p95 / max (ms) |
| --- | ---: | ---: | ---: |
| Immediate first sign | 3 | 4,839.6 / 5,116.1 / 5,116.1 | 1,151.9 / 1,398.1 / 1,398.1 |
| Ready-material warm sign | 3 | 2,753.8 / 2,810.6 / 2,810.6 | 804.2 / 853.1 / 853.1 |
| Concurrent burst | 6 | 7,867.1 / 11,098.7 / 11,098.7 | 1,333.6 / 2,017.2 / 2,017.2 |

There were zero failed/incomplete attempts and zero recorded background-refill
failures. Every timed signature retained five prepare/finalize D1 calls, six
statements, two write-bearing calls, and 14 rows written. These counts exclude
status and refill requests. Status added two calls to first signs; warm signs
added four APAC or two WEUR calls. Each burst window added eight status calls
across its two signatures. All traced queries were served by the assigned
regional primary.

APAC bursts started with zero precompleted selected materials and needed seven
or eight foreground refill steps per burst. WEUR bursts started with zero to
two precompleted selected materials and had no foreground refill steps; their
background work completed sufficiently quickly. This measures the complete
system under its existing refill policy. It does not isolate a fixed ready-pool
latency effect. The 2,017.2 ms observed WEUR maximum also leaves the universal
two-second target unproven. Three fresh wallets per arm cannot close the repeated
30-sample first-sign/burst acceptance gate.

The London probe retained boot `ef1d6611-2330-4bde-bbdc-4d146e552fc4` and the
same frozen SDK. All four Gateway versions were observed in LHR during
03:24:05.506–03:31:31.256 UTC. The five custody-role versions were unchanged;
aggregate custody activity includes LHR/AMS and shared Router activity in KIX.
Per-operation role placement remains unknown.

Evidence: `.artifacts/r152/regional-d1-20261001-r3/`. Reproduce the aggregate
and validate the recorded signature, D1, quota, build, and primary-region facts:

```sh
node tests/r150-hosted/analyze-regional-burst.mjs \
  .artifacts/r152/regional-d1-20261001-r3/summary.json weur \
  .artifacts/r152/regional-d1-20261001-r3
```

The analyzer reuses `analyze-d1.mjs` for request/statement accounting. Raw
artifacts retain browser, SDK, status, refill, and shared-quota evidence;
`summary.json` reports every dispatched attempt, including failures or incomplete
attempts. Run three restored original images and Worker versions, inactive probes,
default Gateway placement, and HTTP 403/503 access closure. The evidence scan
found zero benchmark-token matches in 46 files. Cumulative estimated cost reached
$1.2289, including both databases and subject to analytics lag.

## Other-region diagnostic

Run four attempted the same ready-material comparison from the existing APAC
probe, with three planned fresh chains per arm and the same fixed builds,
databases/namespaces, default Gateway placement, and custody-role versions.
No wallet attempt was dispatched: the target-image rollout did not complete
within the ten-minute readiness gate.

A startup identity read initially reached the old image in NRT13. Subsequent
identity reads returned HTTP 500 with HTML responses. Captured Worker exceptions
state: “There is no container instance that can be provided to this Durable
Object, try again later.” This is an `environment_or_infrastructure_failure`.
The first additional diagnostic failed while parsing HTML before retaining the
HTTP status; its evidence explicitly records that missing observation. Subsequent
receipts retain HTTP 500 and content type. No failed startup is counted as a
successful signature or pooled into London's performance denominator.

Evidence: `.artifacts/r152/regional-d1-20261001-r4/`, including
`measurement-rollouts-apac.json`, the startup receipts, and
`probe-startup-errors.json`. The original-image restoration rollout completed
at application version 29. Postflight verifies the original Worker versions and
images, all three probes inactive, default Gateway placement, and closed access
(HTTP 403/503). All five custody-role versions are unchanged. The evidence scan
found zero benchmark-token matches in 28 files. Cumulative estimated cost is
$1.2413 against the $25 cap, including both regional databases and subject to
analytics lag.

A new Tokyo run requires a fresh evidence directory and another successful
readiness gate. Existing wallets stay at their assigned database; this diagnostic
provides no same-wallet travel or production routing proof. The infrastructure
failure remains in the experiment log even if a future startup succeeds.

Run five retried Tokyo with a fresh evidence directory and the same frozen
builds, six planned chains, and alternating database arms. It again dispatched
zero wallet attempts: target-image rollout `177104e2-59c6-4fa0-aaa6-f37e267b57dc`
remained without a healthy target instance and failed the ten-minute gate. The
additional startup read retained HTTP 500 and an HTML content type; the Worker
exception again reported that no container instance could be provided. This
second `environment_or_infrastructure_failure` supplies no Tokyo latency sample.
Further Tokyo measurements require successful container readiness first.

Evidence: `.artifacts/r152/regional-d1-20261001-r5/`, including
`preflight-outcome.json`, `rollout-health.json`, `measurement-startup-check.json`,
and `probe-startup-errors.json`. Restoration rollout
`06d4d054-b15a-47ff-9d31-5bf4b0e0c548` completed at application version 31 with
two stable observations. Postflight verifies original Worker versions/images,
all probes inactive, default Gateway placement, HTTP 403/503 access closure,
and unchanged custody-role versions. The scan found zero benchmark-token matches
in 27 files. Estimated cumulative spend is $1.2510 of $25, including both regional
databases and subject to analytics lag.

The user-requested run-six Tokyo retry also failed the ten-minute readiness gate,
with zero wallet attempts. Rollout `54ba6c9b-4930-4dd9-afc6-e124b65153a1` targeted
application version 32 and reported one starting instance, zero healthy instances,
and no detailed health errors. An authenticated identity read returned the old
image in `nrt13`; stopping that instance and requesting a fresh start changed its
boot ID but still returned the old image. CPU, memory, and disk configuration were
identical between the current and target images. This points to target-image
rollout readiness in the APAC application, without establishing an underlying
allocation, image-pull, or startup cause. It is insufficient evidence to call the
failures random. The target digest worked in London. The APAC registry repository
and tag were listed; direct manifest verification returned unauthorized and remains
unavailable. No registry credentials were created. The bounded Worker error tail
captured zero events; it cannot rule out platform errors.

Evidence: `.artifacts/r152/regional-d1-20261001-r6/`, including rollout health,
old-image identity/restart receipts, instance health, diagnostic limitations, and
`preflight-outcome.json`. Restoration rollout
`3d8ace9b-f97e-468a-b6f9-be5683eb5129` completed at version 33. Final verification
confirms original Worker versions/images, inactive probes, default Gateway
placement, HTTP 403/503 closure, and unchanged custody roles. The scan found zero
benchmark-token matches in 29 files. Cumulative estimated cost is $1.2621 of $25,
subject to analytics lag. Diagnose the target rollout/image with these receipts
before another identical retry; no Tokyo regional-D1 latency result is available.

## Console composition preparation

Private Console commit `286bc83` adds existing binding/total Gateway timing to
`/wallet/session/status`, closing a timing gap on the owner signing path. Commit
`49a45f3` adopts the verified exact Wallet and Wallet Server 0.7.3 packages across
the private workspace; `919406d` removes an invalid ambient Playwright type entry
and its redundant Console override. Full production builds, application/server
type-checks, type fixtures, Console E2E type-checking, and Console import-boundary
checks pass. At that checkpoint these changes were committed locally, undeployed, and
excluded from the frozen regional cohorts. The hosted lookup cohort below
subsequently deployed them only on isolated benchmark Workers.

The composed intended-test harness still references Wallet source modules that
moved out of the private repository, and has missing script/Vite declarations.
Its type-check fails; classify the removed-source references as stale test
integration. Existing local services also occupy the harness's fixed ports.
They were preserved, and no composed E2E or wallet reset was dispatched.
Verification commands, log hashes, and blockers are retained in the private
`.artifacts/r152/console-readiness-20261001/verification.json`. Repair the private
composition harness against public package boundaries and use isolated services
before measuring actual Console D1/binding costs. The static Console fixture's
London results cannot close this production-composition gate.

Private commit `78e3132` adds request-scoped Console binding D1 wall/SQL timing
and available served-region/primary metadata. The single joined binding query now
uses D1 `all()` to retain metadata; its row selection and validation are unchanged.
The internal Console response supplies an allowlisted set of Server-Timing metrics,
and the Gateway forwards them on ECDSA and session-status responses. No row values,
SQL parameters, or credentials enter these metrics. Missing placement metadata
remains absent. Metadata fields follow the
[D1 return-object contract](https://developers.cloudflare.com/d1/worker-api/return-object/).

A new isolated service E2E passes through a consumer Worker, the production Console
Worker, and fresh local D1. Eight observations cover an empty binding, concurrent
correct/wrong-lane lookups at two successive revisions, and removal of the active
binding. Timing survives the service hop; the wrong lane is rejected and subsequent
reads observe the new revision or unavailability. It shares the existing deployment
fixture builder. The consumer uses the production resolver; the signing Gateway's
response forwarding and complete signing lifecycle remain outside this scenario.
Local D1 provides no region/primary metadata and its timings are not regional
performance evidence. One loopback `EADDRNOTAVAIL` failure is retained; an unchanged
rerun passed in 2.5 seconds. Server/Console type-checks, type fixtures, focused lint,
and Wallet Console build passed. Evidence and log hashes:
private `.artifacts/r152/console-binding-20261001/`.

Reproduce independently of occupied browser-stack ports:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-deployment-binding.e2e.test.ts --reporter=line
```

The private intended harness migration remains open. This independent service
scenario advances measurement readiness without restoring private Wallet imports.
At that checkpoint the instrumentation was committed locally and undeployed;
the subsequent hosted cohort below closes the lookup-only measurement gap.


## Authenticated Console local preflight (October 1)

Private commit `7eef6d423a519b564091f986fcd6119a2701dae0` adds an isolated
authentication preflight using Wallet Server 0.7.3's real Console client, a
consumer Worker, the production Console Worker, and local D1. All 23 current
Console SQL migration files through `0046` apply to the empty database. The
complete Console handler initializes with local ephemeral keys, capture-only
email and unusable Stripe placeholders. A request guard confirms zero outbound
network or Wallet-runtime calls.

Nine service responses supply eight observations: a Console-issued publishable
key is accepted; malformed-key, wrong-origin and wrong-environment requests are
rejected; active environment lookup succeeds; an unprovisioned root returns no
lineage; rotation rejects the old key and accepts its replacement; revocation
immediately rejects the replacement. The setup uses the production Console D1
services for organization/project creation and credential lifecycle operations.
It does not fabricate persisted active-root records. The test writes redacted
observations, HTTP statuses, package/bundle hashes and migration hashes.

Both the new authentication E2E and existing binding E2E pass together (two tests,
3.5 seconds). Console test type-checking and focused lint pass. An initial
Node/Miniflare request-type mismatch was a `valid_test_needs_update` harness
failure; explicit request/response conversion fixes it without domain casts.
No production code changed. Private evidence:
`seams-monorepo/.artifacts/r152/console-auth-preflight-20261001/` contains
`console-service-auth-evidence.json`, `console-binding-evidence.json`,
`fixture-compatibility.json`, and `validation.json`.

Reproduce the composed service checks from the private repository:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/console-service-auth.e2e.test.ts \
  relayer/tenant-deployment-binding.e2e.test.ts --reporter=line
pnpm -C tests run type-check:console
```

The fixture audit found three concrete gaps before hosted signing:

| Existing static benchmark fixture | Real Console requirement |
| --- | --- |
| Its publishable key fails the production credential parser. | Issue a temporary credential through the Console service and revoke it during cleanup. |
| Its environment key is `bench`, and its environment ID lacks a supported suffix. | Use a fresh development environment. Console accepts `dev`, `staging`, or `prod`; credential issuance requires the corresponding ID suffix. |
| Its reduced bootstrap receipt omits journal and capability digests. | Persist the full validated creation-grant/ready response through the Console grant service. The reduced receipt alone cannot supply that record. |

The audit invokes the production key parser and credential issuer against private
fixture data; it records only outcomes and source hashes. Preserve the historical
static fixture and its latency cohorts. The authenticated cohort needs a separate
Console-supported identity and full provisioning evidence. The correct internal
tenant-root environment identity is the full environment ID; the `dev` key is
separate metadata.

This preflight verifies service composition and credential freshness. It produces
zero signatures and no regional latency samples; it does not cover successful
root provisioning, usage-event ingestion, or the full Gateway signing path. No
Cloudflare resources were created or changed. Those hosted checks remain open.

## Hosted Console fixture provisioning (October 1)

The next preparation run provisions two fresh development identities through the
production Console D1 organization/project, credential, root-grant and deployment
candidate services. Console authority stays in the approved APAC database
`dfe49f40-25b9-45f2-8cdf-e7d28b7685cd`, namespace
`r152-console-authority-20261001`. The APAC and WEUR Wallet cohorts have distinct
organizations, projects, `:dev` environments and Wallet namespaces
`r152-console-auth-apac` / `r152-console-auth-weur`. They do not create two writable
copies of one owner's authority.

Both tenant-root creation operations reach `ACTIVE`. The Console grant service
validates the returned identity/lineage against the issued grant and persists
the complete ready receipt: revision, root commitment, journal digest and
capability digest. The experiment reuses the existing isolated grant authority;
all five custody-role deployment versions remain frozen. Subsequent preparation
runs reuse those active operations and issue new expiring credentials, with
revocation during cleanup. The initial preparation run restores both Workers
and closes ingress after revoking its two credentials. The isolated root and
Console fixture records remain available for the next cohort.

A local migration rehearsal first applies the frozen 39 Wallet migrations and
the already-installed Console `0046` migration. Adding the remaining 22 Console
migration files preserves all 161 existing local schema objects. Remote readback
then verifies every pre-existing schema object unchanged: APAC has 163→367
objects, while WEUR remains at 163. Only APAC receives the additional Console
schema. The remote databases report APAC/WEUR primaries respectively. The schema
comparison accounts for Wrangler's removal of SQL comments and provider-owned
migration bookkeeping; it preserves the original application definitions.

Private monorepo commit `afb77c6` also extends the local production Console E2E
through usage ingestion. Delivering the same wallet-created event twice produces
one Wallet projection and zero entries in `billing_monthly_active_resources`,
matching the current exclusion of registration from monthly active-resource
billing. All eleven service responses and nine observations pass; type-checking,
focused lint and diff checks pass. The initial test query named the retired
`billing_monthly_active_wallets` table. Classification: `valid_test_needs_update`;
the assertion now uses the current table and preserves the billing invariant.

Evidence in the private repository:
`.artifacts/r152/console-hosted-auth-20261001/` contains schema inventories,
migration hashes, root provisioning receipts, restoration receipts, and
`local-usage-preflight/console-service-auth-evidence.json`. These preparation
results alone establish no signing latency.

### Authenticated cohort startup failures

Three bounded signing-cohort attempts followed the provisioning preflight. The
first rejected an Osaka (`kix06`) placement, then encountered a provider HTTP 500
reporting a temporarily unavailable Container connection. The second received
`Worker not found` during the identity check. Neither dispatched a wallet
workload. Both removed their temporary Worker, DO namespace and Container
application and restored the original Gateway and Console deployments.

The third attempt used a fresh temporary Worker name and a short readiness
settling period. It rejected Osaka, verified `nrt08` through the provider instance
API, and verified the same Tokyo instance after a restart with a new boot ID.
The APAC workload was dispatched once, then exited before application startup:
the frozen benchmark harness requires a project/environment name beginning with
`r150-bench-20260925-do`, while the new fixture used `r152-console-…`. It produced
zero signatures and no signing artifact. Classification: `valid_test_needs_update`
for the private fixture input; the isolation invariant remains supported. The
correction provisions fresh Console identities under the existing allowed
benchmark prefix and preserves the harness, frozen SDK image and production
validation unchanged. This is separate from the provider readiness failures.

The three attempt directories are
`.artifacts/r152/console-sign-r{1,2,3}-20261001/` in Wallet, paired with
`.artifacts/r152/console-hosted-auth-r{2,3,4}-20261001/` in the private repository.
The third postflight confirms all eight issued credentials revoked, zero active
experiment bindings and zero Wallet projections. All seven Gateway/Console and
custody-role versions match their original deployments. The original regional
Container applications are inactive with their original images and configuration;
original probe access returns 403 and ingress returns 503. Each temporary
Worker/application/namespace has a deletion readback. No latency claim derives
from these failed attempts.

## Hosted Console signing diagnostic (October 1)

Correcting the private fixture project names to
`r150-bench-20260925-do-console-{apac,weur}-20261001` allows the unchanged frozen
benchmark harness to run. Each is a distinct Console development organization
and project with a complete active tenant-root receipt. Wallet namespaces remain
`r152-console-auth-apac` and `r152-console-auth-weur`; Console authority remains
`r152-console-authority-20261001` in APAC. No existing owner moves between homes.

The temporary probe is provider-verified in `nrt08`, then restarts on the same
instance with a fresh boot ID before dispatch. APAC runs first and WEUR second
on that same restarted Container. Each fresh wallet completes registration,
owner→device 2→device 3 linking and nine signatures verified against its original
wallet keys. Both attempts succeed: **18 verified signatures**, comprising three
owner and six linked signatures per database arm. Gateway uses production private
Console sources at `afb77c6` with published Wallet Server 0.7.3 and a private
measurement wrapper. The SDK image, build-input hash and five custody-role
versions remain frozen. These results are separate from the static Console
cohorts.

| Tokyo public SDK signing latency | APAC Wallet D1 | WEUR Wallet D1 |
| --- | ---: | ---: |
| Owner median, 3 signatures per arm | 2,165.2 ms | 3,257.6 ms |
| Owner maximum | 2,474.5 ms | 3,491.4 ms |
| Linked median, 6 signatures per arm | 1,649.45 ms | 2,655.3 ms |
| Linked maximum | 1,735.3 ms | 3,024.5 ms |

SDK timing includes confirmation. This one-wallet-per-arm diagnostic has fixed
arm order and a small sample; it establishes successful hosted signing and
supports retaining APAC for Tokyo. It does not replace the repeated cohort gate,
prove cold-unlock behavior, or establish production rollout readiness.

Every owner signature records four foreground Gateway requests, seven Gateway
D1 calls/eight SQL statements and four real Console active-binding calls. Every
linked signature records two foreground requests, five Gateway D1 calls/six SQL
statements and two real Console active-binding calls. Both paths write fourteen
Gateway D1 rows. The Console calls each perform the existing joined binding read,
so the measured foreground database-call totals are **11 for owner and 7 for
linked**, including Console. Foreground counts exclude overlapping background
refills; they are not total system work.

Console binding D1 wall-time medians remain 62.5 ms/63.0 ms for the APAC/WEUR
Wallet arms respectively; corresponding SQL medians are 0.358 ms/0.451 ms. All
48 foreground Console responses succeed and report APAC primary reads. Gateway
D1 reports the selected APAC or WEUR primary. Median summed Gateway D1 wall time
per signature is 563→1,907 ms for owner and 499.5→1,665.5 ms for linked. Median
summed Console call wall time stays 288→279 ms for owner and 145→143 ms for
linked. These are dependency totals; overlapping client stages must not be added
to them. Region labels identify broad served regions, not exact D1/DO colocation.

### Registration projection gap identified in the frozen cohort

Hosted registration succeeds, but readback finds no rows in the Console
`wallet_index`. The local direct usage-service E2E passing does not establish
that the Gateway registration route emits that event. Source inspection at the
exact 0.7.3 release candidate (`7b5c95f8`) explains the missing producer path:
`createCloudflareWalletGatewayRouterV1` supplies `apiKeyUsageMeter`, while the
registration activation handler calls the separate optional `walletProjection`
adapter. The hosted composition supplies no such adapter; activation's
`projectActivatedWallet` returns without projecting when it is absent. The
configured usage client's `recordEvent` has no caller in the Wallet router.

Classification: `production_regression` in hosted Console composition. The
missing projection remains unfixed in this frozen measurement cohort. The next
implementation must connect verified registration to the existing Console
service boundary and test actual activation plus replay, preserving one Wallet
projection and zero registration monthly-active-resource charges. The
[subsequent fix and candidate cohort](#registration-projection-fix-and-reversed-order-console-diagnostic-october-1)
now provide that evidence. Do not close
the authenticated-composition gate from the eighteen signatures alone. A
separate cold-unlock check and reversed-order repeat also remain open.

Evidence: Wallet `.artifacts/r152/console-sign-r4-20261001/` contains both signed
artifacts, `summary.json`, source hashes, attempt ledger, provider identities,
deployed namespace/database bindings and temporary-resource deletion receipts.
Private `.artifacts/r152/console-hosted-auth-r5-20261001/` contains provisioning
receipts, emitted build hashes, frozen role versions, projection queries and
restoration readback. Reproduce the summary with
`python3 .runtime/r152-console-sign-r4/summarize.py`; repeat provisioning through
`.runtime/r152-console-hosted-auth-r5/run-provision.mjs` only after regenerating
its private expiring deployment secrets with `prepare.mjs` and using fresh
attempt/artifact identities. Private credential-bearing inputs and lifecycle
traces remain outside the evidence directories.

Final readback confirms all ten experiment credentials revoked, zero active
experiment bindings, the original seven Gateway/Console/custody-role deployments
restored, and all original regional Container applications inactive with their
original images and configuration. The fourth temporary Worker, DO namespace and
Container application are absent after deletion at 09:14:08 UTC. Original probe
access returns 403 and ingress returns 503; transient deployment-secret files
are removed. The two D1 databases and isolated fixture records remain retained.

The September 25–October 1 09:14:37 UTC usage report estimates $1.3215 of the $25
cap before shared allowances. Container analytics still omit the recent temporary
applications. A conservative compute-only bound for these four apps' full
preflight-to-deletion lifetimes is $0.1444, assuming all three candidate instances
ran continuously at maximum resources; this is supplemental headroom accounting,
not a measured charge, and excludes network egress. Preserve the earlier
$0.5714 bound for the nine Tokyo startup/extension apps separately.

## Registration projection fix and reversed-order Console diagnostic (October 1)

The demonstrated composition regression is fixed in source. The managed Gateway
now supplies its existing registration projection hook through the private
`/internal/wallet-console/v1/wallet-projections` operation. Console validates the
projection at that boundary and uses its existing project/environment and Wallet
services to persist it. The existing static/self-host binding acknowledges this
operation. Registration still has no monthly-active-wallet billing effect.
A failed Console projection reply fails activation visibly; exact activation
replay reaches the same idempotent projection path.

The local production Console E2E now checks two deliveries, one Wallet row,
zero monthly-active-resource rows, and rejection of a mismatched organization.
It passes with fourteen service responses and ten observations. Wallet Server
build/type-check, intended-contract type-check, Console package/test type-checks,
focused private lint and the Wallet bloat check pass. Existing service fixtures
receive the required adapter; no new unit tests are introduced.

### Candidate identity and retained failures

An initial hosted candidate used current Wallet Server dev with the frozen 0.7.3
browser. Its real registration produced one Console projection, but the browser
rejected the response with `value contains unexpected fields`; zero signatures
were verified. Inspection of the retained receipt and the actual frozen decoder
reproduced the error: later dev removed `publicTranscriptDigest32B64u` from the
ECDSA bootstrap, while the frozen decoder requires it. This is a mixed-fixture
`environment_or_infrastructure_failure`. The dev cleanup remains intact.
Evidence is retained in `console-sign-r5-20261001/diagnosis.json` and the private
`console-hosted-auth-r6-20261001/` composition records.

The corrected candidate archives Wallet Server/shared TS source at release
candidate `7b5c95f8557f5398ae0103dd0aeb8e84afe0cf8d`, applies only the four-file
projection patch, then builds the server. Both arms use those same compiled
bytes. Gateway WASM comes from the locally generated inputs and differs from
npm 0.7.3; its hashes are recorded separately. The browser image and all five
custody-role deployments stay frozen. This is an **unreleased server candidate**;
its measurements must remain separate from the published-server cohort and the
static-Console measurements. The private Console continues consuming exact
published Wallet Server 0.7.3, with the new private handler compiled from source.

The observer retains the initial successful activation response, loses the
Console reply on the first exact replay after its successful write, and then
replays twice more. Every completed registration records statuses
`200 → 500 → 200 → 200` and four successful upstream projection deliveries.
The browser receives the original issued activation response. This exercises
server replay/reply-loss behavior; browser activation-loss recovery remains a
separate contract because an exact replay returns `already_committed` and
requires explicit unlock.

### Reversed-order signing comparison

Provider-confirmed Tokyo `nrt08` completes WEUR then APAC on one recorded boot.
Each fresh wallet performs three owner signatures and six signatures across two
linked-device generations: **18 verified signatures**. Console authority stays
in APAC. Public SDK call medians include automatic confirmation:

| Foreground measurement | APAC Gateway D1 | WEUR Gateway D1 |
| --- | ---: | ---: |
| Owner signing median (3 signatures/arm) | 1,934.6 ms | 3,197.2 ms |
| Linked signing median (6 signatures/arm) | 1,574.8 ms | 2,687.2 ms |
| Owner summed Gateway D1 wall median | 571 ms | 1,938 ms |
| Linked summed Gateway D1 wall median | 503.5 ms | 1,692 ms |
| Owner summed Console binding wall median | 251 ms | 253 ms |
| Linked summed Console binding wall median | 121 ms | 124.5 ms |

APAC owner and linked medians are 39.5% and 41.4% lower in this small diagnostic.
Owner signing still uses seven Gateway D1 calls/eight SQL statements plus four
Console binding reads; linked signing uses five/six plus two. Both paths still
write fourteen Gateway rows. Regional placement reduces their network cost;
write and round-trip reduction remain separate work. Counts exclude overlapping
background refill traffic.

The same boot also completes the APAC first/warm/burst contract: five verified
signatures, one explicit `/wallet/unlock/verify` after runtime reset, and exact
shared-budget exhaustion. Before the WEUR counterpart was dispatched, the probe
boot ID changed. The preflight identity guard stopped collection, preserving the
23 successful signatures; the reason for the Container restart is unproven.
A follow-up harness initially reused an infrastructure-log directory and stopped
on its create-once `run.json` guard before dispatch. Its logs are separated, and
`artifact-path-correction.json` records the affected metadata. Completed signing
artifacts, private responses and replay logs remain intact. The original
application inventory is recovered from its earlier cleanup observation.

The final fresh Tokyo follow-up (`console-sign-r10`, Console composition `r11`)
completes the missing WEUR first/warm/burst sample with five verified signatures.
Both arms perform one explicit unlock verification after runtime reset and
exhaust the shared burst budget. This brings the corrected candidate total to
**28 signatures across four fresh wallets** and four new Console Wallet rows.
Readback finds **zero monthly-active-resource rows**. The original failed
mixed-version registration contributes one additional retained projection,
for five total Console rows; it contributes no verified signatures.

| One first/warm/burst diagnostic per arm | APAC | WEUR |
| --- | ---: | ---: |
| First sign after registration | 4.195 s | 6.584 s |
| Warm sign | 2.499 s | 4.076 s |
| Two-signature concurrent burst after cold unlock | 7.744 s | 13.524 s |
| Burst server materials complete before start | 0 | 0 |

These are single browser-harness observations including automatic confirmation
and verification. The warm sign has ready server material in both arms; the burst
requires refill work. APAC and WEUR use different recorded boots for this pair,
so no controlled gain estimate or tail guarantee follows from these two samples.
The reversed-order linked-chain comparison above stays on one boot. Unlock
success is verified; separate per-call unlock latency attribution remains open.

Two intervening preparation attempts create no Wallet operations: one receives
an empty HTTP 503 while opening the benchmark window, and another stops at an
inappropriate readiness check that itself requires a provisioned active binding.
The final private harness uses an authenticated pre-provision readiness endpoint
and waits for its HTTP 204 before mutation. Each attempt's outcome and cleanup
remain in Console `r9`/`r10`/`r11`; no wallet operation is blindly resubmitted.

Final postflight verifies **18 revoked credentials**, zero active experiment
bindings, original Gateway/Console/custody-role deployments, inactive original
probes with their original images and sizing, default Gateway placement and
closed probe/ingress access (403/503). All eight temporary Console-diagnostic
application/DO-namespace/Worker bundles across these runs are removed. Both
regional databases and the audit/projection evidence remain retained. The final
scan of 189 evidence files finds zero matches for thirteen known benchmark access
tokens and issued publishable keys. No
staging or production infrastructure is deployed.

Measured cumulative benchmark cost at 10:06:52 UTC is **$1.3255 / $25**. Container
analytics still omit the temporary applications. A separate conservative
CPU/memory/disk allowance is **$0.2868** for all eight Console-diagnostic apps,
assuming the maximum three candidates each ran throughout every application
lifetime; it excludes network egress and is not an additional measured charge.
The earlier nine Tokyo recovery apps retain their separate $0.5714 allowance.

Evidence roots are Wallet `.artifacts/r152/console-sign-r6-20261001/` and private
Console `.artifacts/r152/console-hosted-auth-r7-20261001/`. `summary.json` gives the
per-signature accounting; `verification.json` records cold unlock and projection
replay. Recompute them with the private `summarize.py` and `verify-evidence.py`
under `.runtime/r152-console-sign-r6/`. The latter uses the preceding postflight
for the original one-row baseline, since the follow-up overwrote the initial
baseline query file. Candidate source, patch and compiled library/WASM hashes
are in the Console `sources.json`; `final-harness-sources.json` captures the
actual follow-up scripts. Final cold-unlock/replay/cleanup/cost evidence is in
Wallet `console-sign-r10-20261001/` and Console `console-hosted-auth-r11-20261001/`.
Wrangler's output directories contained only
a README, so no emitted Worker bundle hash is claimed for this candidate.

The corrected source is committed on `dev`: Wallet `b4884902` and private
Console `1420581`. Publishing a new Wallet Server version and deploying its matching
Console handler remain release work; npm 0.7.3 is unchanged. Deploy the handler
before activating a Gateway version that requires the new operation.

## Unlock accounting and activation recovery (October 1)

Wallet commit `7402c264` extends the existing first/warm/burst E2E with a separate
cold-unlock request window using `GatewayRequestEvidence`. It retains individual
Gateway D1 calls, statements, served-region metadata and Console binding calls,
with overlapping refill requests listed separately. The existing activation-loss
contract is also exposed as a hosted probe workload and emits its recovery window
and one verified signature. No SDK or server behavior changes in this work.

The recovery contract discards the first committed activation response, delivers
the exact server replay, reloads, rejects an altered activation digest before
unlock, resumes with the exact passkey, and verifies a signature against the
original registered key. Direct Playwright replay bypasses the browser's
benchmark-access interceptor; commit `14a62b68` supplies that header explicitly.
This is a `valid_test_needs_update` classification for hosted execution. The
original local behavior remains supported. Type-checking, test discovery in the
built images and the bloat check pass.

Both diagnostic images layer only tests, the probe workload selector and source
metadata onto the frozen SDK image
`747fdf75e8b820377d802ef4aa934af6e6605323679ba83ce611bb36ee88d877`.
The corrected image's Linux manifest is
`b2e553bf2f0fff7165f95bb6591a07ec9bd3b27a3a30c65072090012fd8e8f92`;
the SDK build-input hash remains
`04c22bce8247167bb0cd7beebb2ad7e29f1ed92b65762f180570a0a520c0ad29`.
The separately fingerprinted Gateway server candidate from the preceding section
is unchanged. These images are retained for reproduction.

### Retained preflight failures

- Probe `console-sign-r11` waits for Cloudflare snapshot preparation, then receives
  HTTP 500 on its first Worker readiness read. It stops before any wallet attempt
  and removes its application, namespace and Worker. The next private runner
  retains response bodies and permits bounded retries of read-only readiness.
- Console composition `console-hosted-auth-r13` receives D1 API HTTP 403 and
  restoration-readback HTTP 401 from a cached token after deployment. Fresh
  authentication succeeds, confirms credential revocation and restoration, and
  records the failure. Subsequent private runners retrieve authentication for
  each API request. No wallet operation is dispatched.
- Probe `console-sign-r13` passes Worker readiness but its identity GET times out;
  provider readback lists no allocated instance. Collection is stopped before
  the wallet-attempt ledger exists. Manual cleanup removes the exact recorded
  application, retires its DO namespace and deletes its Worker. Postflight
  verifies original deployments, inactive original probes, default placement and
  closed access. All 22 credentials existing at that point are revoked, with
  no active experiment binding. This is an infrastructure allocation/startup
  limitation; no Wallet failure or signature sample is attributed to it.

The follow-up uses a local Docker browser with the same frozen SDK against the
real hosted Gateway, Console and two regional D1 homes. Its browser location is
unverified and amd64 execution is emulated on the local host. Keep its correctness
and call-accounting evidence separate from provider-verified Tokyo latency
cohorts. The provider-verified diagnostic repeat remains open.

### Local-browser cold unlock accounting

The first local cohort completes APAC then WEUR first/warm/burst contracts:
**ten verified signatures**, with shared-budget exhaustion asserted in each arm.
Each fresh wallet resets runtime state and completes one explicit unlock. Console
authority stays in APAC and Gateway D1 uses the selected regional primary.

| Unlock request | Gateway D1 calls | Statement descriptors | APAC D1 wall | WEUR D1 wall | Console calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Challenge | 3 | 3 | 205 ms | 739 ms | 1 |
| Verify | 36 | 43 | 2,315 ms | 8,979 ms | 1 |
| Total | **39** | **46** | **2,520 ms** | **9,718 ms** | **2** |

The browser unlock windows are 7,511.6 ms and 15,736.7 ms respectively. Each
Console call reports 63 ms. These are two diagnostic samples from an emulated
local browser, with fixed arm order; they establish call accounting rather than
a Tokyo latency distribution or a causal population-level speedup. Request
windows retain overlapping refill traffic separately. Summed call wall time is
not interchangeable with complete browser elapsed time.

Verify includes **nine runtime schema/initialization `exec` calls**: eight CREATE
descriptors and one `INSERT OR IGNORE` for `wallet_authority_cas_guard`. The
remaining 34 verify statement descriptors report the selected APAC or WEUR
region; all three challenge descriptors do likewise. D1 `exec` provides no
SQL-duration, row-count or served-region metadata in this trace. The analyzer
preserves these nine unknowns, with 30 known verify rows written and three known
challenge rows written; it does not count missing values as zero. An initial
analyzer failure on missing metadata was corrected without modifying raw traces.

Follow-up: audit authority-store construction and deployment migrations, then
remove request-time schema initialization where provisioning already guarantees
the schema. Preserve guarded inserts and authority invariants; repeat this E2E
on a separately fingerprinted candidate before claiming any call reduction.
Review the remaining unlock reads/writes after that concrete target. This work
is independent of regional-home routing and does not change this frozen cohort.

The third workload (WEUR activation recovery) fails before the intended browser
recovery assertion: Playwright `route.fetch` reports `Parse Error: Header overflow` while receiving the initial activation response. Node's default header
limit rejects the benchmark's large D1 diagnostic header. The browser consequently
receives `Failed to fetch`; this attempt supplies no successful recovery proof.
The server did commit one additional Wallet projection. Retain it alongside the
two successful cold-unlock registrations, and use fresh wallets for the repeat.
Classification: `environment_or_infrastructure_failure` in the diagnostic
runner. The follow-up sets `--max-http-header-size=131072` for the benchmark's
Node children and retains all response diagnostics and behavior assertions.

Evidence: Wallet `.artifacts/r152/console-sign-local-r1-20261001/`, especially
`local/attempts.jsonl`, both successful workload artifacts and
`unlock-recovery-summary.json`; private Console
`.artifacts/r152/console-hosted-auth-r15-20261001/`. Postflight verifies all original
Gateway/Console/role versions restored, all 24 experiment credentials revoked,
no active experiment binding and no transient deployment secret files. The
Wallet projection count increases from five to eight, including the failed
activation attempt's committed row.

### Browser activation-loss recovery through hosted Console

The fresh local-browser repeat runs WEUR then APAC with the same frozen image
and server candidate, adding only the Node header-limit setting. Both ECDSA-only
recovery contracts pass: **two more verified signatures**. Each contract discards
the original issued activation response, delivers an exact `already_committed`
replay, reloads, rejects an altered activation digest before unlock, then resumes
with the exact passkey. Assertions verify three exact replays, one explicit
unlock, no additional registration requests, and a signature recovering the
original registered address. No Wallet production behavior changes were needed.

Each recovery unlock uses three challenge D1 calls and 32 verify D1 calls:
**35 Gateway D1 calls plus two Console calls**. The nine initialization `exec`
calls remain. Summed challenge/verify D1 wall is 2,230 ms for APAC and 8,869 ms
for WEUR; the successful browser recovery windows are 3,927.1 ms and 9,987.5 ms.
These windows include the final replay and browser work; they are distinct from
ordinary cold unlock and from timed signatures. Keep their different 35-call
and 39-call budgets separate. They remain single local-browser diagnostics,
without provider-verified browser placement or a regional latency distribution.

Console projection readback increases from eight to ten rows, exactly one for
each successful recovery registration. Monthly active-resource rows remain
zero. Final postflight verifies **26 revoked experiment credentials**, zero
active bindings, all original Gateway/Console/custody-role versions restored,
inactive original regional probes, original images/sizing, default Gateway
placement and closed probe/ingress access (403/503). Both local Docker containers
and their environment files are removed. All ten temporary Console-diagnostic
Cloudflare application/namespace/Worker bundles from this and previous cohorts
have deletion receipts. Retained databases and audit rows remain available.

Cumulative analytics at 10:46:57 UTC report **$1.3281 / $25**, using the same
September 25 start as prior reports. Container analytics still omit temporary
applications. The separate conservative CPU/memory/disk allowance for all ten
Console-diagnostic apps is $0.3707, assuming up to three candidates ran for each
full application lifetime; it excludes egress and is not added as measured
billing. The earlier nine Tokyo apps retain their separate $0.5714 allowance.
The final evidence scan checks 113 files against thirteen known credential
values and finds zero matches. No staging or production deployment is made.

Reproduction and evidence:

- Wallet `.runtime/r152-console-sign-local-r2/run.mjs` and `analyze.py`;
  `.artifacts/r152/console-sign-local-r2-20261001/` contains both recovery
  artifacts, the attempt ledger, `unlock-recovery-summary.json`,
  `runner-sources.json`, cost/compute reports, `restoration-final.json` and
  `evidence-hygiene.json`.
- Private Console `.runtime/r152-console-hosted-auth-r16/` contains the
  provisioning and cleanup runner; corresponding
  `.artifacts/r152/console-hosted-auth-r16-20261001/` retains `sources.json`,
  operations, restoration, `projection-verification.json` and postflight.
- Keep the failed local-r1 activation attempt and all provider startup failures
  separate. This follow-up completes unlock call accounting and ECDSA browser
  activation recovery against hosted services. Provider-verified repetitions,
  wider authenticated workloads, unlock-call reduction and production regional
  ownership/routing proofs remain open.

## Removing request-time authority initialization (October 1)

Wallet commit `3cb44563` removes `D1WalletAuthorityStore`'s schema-on-use state,
constructor option, initialization calls and duplicate authority DDL. It also deletes the
now-unused `ensureWalletAuthMethodStoreD1SchemaV2` helper and re-export. The
canonical D1 migrations already create these tables/indexes and insert the
singleton `wallet_authority_cas_guard` row. Transactional guard statements and
all authority read, activation, promotion and revocation logic are unchanged.
The V2 auth-method schema still serves the separate auth-method store's existing
provisioning path; this change only removes the authority store's redundant
runtime initialization and its unused helper.

`0015_r103e_authority_baseline.sql` owns the authority schema and guard seed.
Read-only preflight against both retained regional databases verifies all eight
required table/index objects, the singleton guard value `1`, and the applied
migration list. No migration or stored-record transformation is needed. Consumers
must apply the supported signer migrations before serving requests. The removed
V2 initialization helper was exposed by the `cloud-host` export; callers should
use the migration workflow. This is an unreleased candidate; npm 0.7.3 remains
unchanged.

The candidate is rebuilt from the prior archived server source, whose built
files match the preceding projection candidate byte for byte before the change.
Only the three audited TypeScript files receive this patch. SDK image, generated
WASM and custody-role deployments remain frozen. Server type-check, candidate
build, syntax/diff review and the repository bloat check pass. Evidence records
source patches and complete candidate build hashes rather than calling it the
released npm binary.

### Measured unlock call reduction

Both regional homes pass cold unlock and activation-loss recovery with the
candidate. Gateway D1 calls fall **39 → 30** for ordinary cold unlock (23.1%) and
**35 → 26** for recovery unlock (25.7%). Challenge remains three calls;
verification falls 36 → 27 and 32 → 23 respectively. Each workload retains two
Console calls. All nine initialization calls disappear. Query-fingerprint
comparison in both regions proves the remaining non-initialization query
multisets are unchanged, including batch grouping.

| Workload | D1 home | Gateway D1 calls before → after | Summed D1 wall before → after |
| --- | --- | ---: | ---: |
| Cold unlock | APAC | 39 → 30 | 2,520 → 2,125 ms |
| Cold unlock | WEUR | 39 → 30 | 9,718 → 7,799 ms |
| Recovery unlock | APAC | 35 → 26 | 2,230 → 1,702 ms |
| Recovery unlock | WEUR | 35 → 26 | 8,869 → 6,429 ms |

The original cold-unlock initialization calls alone took 526 ms (APAC) and
2,178 ms (WEUR). These before/after wall times come from independent fresh-wallet
runs, with local amd64 browser emulation and no provider-verified browser region.
They demonstrate the removed calls and observed diagnostic timing; sample counts
and order do not establish a latency distribution or a causal population-level
speedup. The successful WEUR repeat also enables private failure tracing.

Every post-change unlock reports 33 rows written: three in challenge and 30 in
verify. Before the change, nine `exec` calls lacked row-count metadata; their
removal does not prove a durable-write reduction. All remaining statement
metadata reports the selected APAC or WEUR primary. Cold unlock has 37 statement
descriptors and recovery has 31, including challenge. Background refill traffic
remains separately identified. The remaining reads/writes stay a follow-up
optimization target; authoritative quota, freshness and revocation checks must
remain intact.

### Retained browser failure and baseline restoration

The first candidate cohort completes all three APAC workloads (15 verified
signatures), then the WEUR chained-device workload reaches registration and both
links but times out on its first signature. The browser action waits 120 seconds;
confirmation automation tries 149 times without clicking the control. All three
lifecycle traces contain zero signing prepare/finalize requests and zero recorded
lifecycle violations. Background refill reaches available depth five. This
attempt is classified `environment_or_infrastructure_failure` for verification:
the subsequent diagnostic below identifies the launcher readiness fault, and
no successful signing sample is counted. The unchanged candidate is repeated with fresh WEUR wallets;
private Playwright tracing is enabled for any subsequent failure.

Credential revocation and ingress closure succeed, but Gateway rollback twice
returns Cloudflare code 10210, “Version not found.” The original baseline is
version 6 and the latest upload is 108, placing it outside the
[last-100-version rollback window](https://developers.cloudflare.com/changelog/post/2025-09-11-increased-version-rollback-limit/).
The original modules remain readable. Re-upload retrieves those original bytes
and restores the original binding values using preserved benchmark secrets.
Readback verifies identical module hashes, binding metadata and runtime settings
before activation. An initial hash comparison was order-sensitive; semantic map
comparison verifies every module hash without depending on multipart order.

The fresh WEUR repeat verifies cold unlock and activation recovery (six
signatures), then reproduces the long linking test's confirmation timeout. Its
private Playwright trace and lifecycle evidence are retained. A focused service
readiness diagnostic identifies the cause: Vite binds `localhost` to IPv6, while
Node's HTTP probe resolves it to IPv4. The IPv6 endpoint returns 200, but the
Node localhost probe receives `ECONNREFUSED`. The launcher consequently kills the
app servers after its 120-second readiness deadline, even though Chromium has
already started the scenario. Shorter successful workloads finish before that
deadline.

Commit `271f78c6` updates `start-wallet-intended-services.mjs` to bind localhost
app servers explicitly to `127.0.0.1`, keeping advertised origins unchanged. The repeated Node localhost
probe returns 200. The diagnostic image adds exactly one layer copying this
launcher onto the existing frozen SDK image; no SDK assets or timeout values
change. A final long WEUR linking run uses this repaired launcher. The two earlier
attempts remain failures with zero verified signing samples.

The new baseline is **`23058bf2-2bc1-4c15-838e-1567d8561711`**. All future
benchmark restorations must use this verified version, with the original
`e1fa8688-6f5a-45bf-862b-442241789e16` retained as historical identity. Check the
rollback window before further cohorts; refresh from preserved original bytes
when needed.
Final readback for this partial cohort verifies 28 revoked credentials, no active
binding, inactive original regional probes, default placement and closed access.
Four Wallet projections are added, including the failed linking attempt's
registration; monthly-active-resource rows remain zero. Evidence is under Wallet
`.artifacts/r152/console-sign-local-r3-20261001/` and private Console
`.artifacts/r152/console-hosted-auth-r17-20261001/`. Preserve
`failed-linking-attempt.json`, the rollback errors and version readbacks, plus
`gateway-baseline-restored.json` and `restoration-final.json`.

### Candidate completion and retained evidence

The repaired WEUR chained-device contract runs for 182.7 seconds and verifies
nine signatures, completing **30 verified signatures across six successful
workloads**: first/warm/burst, activation-loss recovery and second/third-generation
linking in each regional D1 home. Preserve the two failed WEUR linking attempts
separately. Prepare/finalize retains five Gateway D1 calls and two Console calls
for every one of the eighteen chained-workload signatures; overlapping refill
requests are excluded from that total. Cold-burst quota exhaustion and recovery
replay/digest/key-identity assertions all pass.

Final postflight verifies **32 revoked experiment credentials**, no active
binding, original Console/custody-role versions, the verified re-uploaded Gateway
baseline, inactive original probes, default placement and closed access
(403/503). Local containers and environment files are removed. Across these
three cohorts, Console projections increase from ten to eighteen: six successful
workload registrations and two failed-attempt registrations. Monthly-active-
resource rows remain zero. No additional Cloudflare Container applications are
created for these local-browser runs.

Cumulative measured cost at 11:24:03 UTC is **$1.3347 / $25**, from the same
September 25 start. Analytics lag still applies; the previously recorded
$0.3707 Console-app and $0.5714 Tokyo-app conservative compute allowances remain
separate from measured charges and exclude egress. Evidence hygiene scans
76 files against eleven known credential values, finds zero matches, and verifies
no local benchmark containers or environment files remain. Private browser traces
stay under `.runtime`; they are not copied into the redacted evidence.

- Wallet evidence: `.artifacts/r152/console-sign-local-r3-20261001/`, `local-r4`
  and `local-r5` with the same date suffix. Each contains attempt ledgers,
  successful contract artifacts and `unlock-recovery-summary.json`. `local-r4`
  adds `initialization-comparison.json`; `local-r5` adds
  `candidate-verification.json`, before/after readiness probes,
  `launcher-overlay.json`, cost and final restoration receipts.
- Private Console evidence: `.artifacts/r152/console-hosted-auth-r17-20261001/`,
  `r18` and `r19` with the same date suffix, including source/build hashes,
  provisioning, projection and restoration receipts. `r17` retains migration/
  schema preflight and Gateway baseline restoration evidence.
- Recompute using matching `.runtime/r152-console-sign-local-r*/analyze.py`,
  `local-r4/compare.py` and `local-r5/verify-cohort.py`. The server source and
  compiled candidate are preserved under `.runtime/r152-unlock-initialization/`;
  the launcher-only Docker overlay is `.runtime/r152-console-readiness-image/`.

This completes the measured initialization-call reduction. Repeated authenticated
regional cohorts, further write/call review, broader workload coverage and the
production authority/home-routing proofs remain open. These local-browser
results do not close Tokyo placement or latency-distribution gates.

## Removing the duplicate session commit readback (October 1)

Implementation commit: `5ac59f45` on `dev`; unreleased.

The remaining-unlock review identifies one direct duplicate in
`AuthorizationService.issueDirectWalletSessionAuthorizationV2WithReplayMode`.
Its D1 commit port already reads the winning mint, validates persisted columns
and capability subjects, and checks the exact session identity and primary
credential digest before returning `inserted`. The service then performed the
same mint read and digest comparison again. Remove that second read and document
the existing commit-port guarantee. The service's pre-commit replay lookup and
the store's post-commit validation remain.

This removes ten lines of implementation without adding a cache, changing a
session type, or moving an authorization decision. The removed mint lookup is a
commit-identity read which deliberately remains readable after retirement;
it does not perform live quota, expiry, authority or revocation admission.
The six-statement session replacement batch and subsequent live admission checks
remain unchanged. Same-mint losers still return the credential-free committed
answer. D1 is the sole production implementation of this commit port.

The frozen server candidate adds only the `authorization/service.ts` patch to
the previous initialization-removal candidate. Only `authorization/service.js`
and its source map change in the compiled bundle. The SDK, custody roles and
IPv4 test-launcher image are unchanged. Source, patch and build fingerprints are
retained separately from all earlier cohorts.

### Hosted verification

Six fresh workloads, run WEUR then APAC, verify **30 signatures**: five
first/warm/burst signatures, one activation-loss recovery signature and nine
signatures across three linked devices per D1 home. All six pass on the first
attempt. Cold-burst quota exhaustion, three exact activation replays,
altered-digest rejection, unchanged registration-request count and recovered
key identity remain verified. All eighteen chained-workload signatures retain
five Gateway D1 calls and two Console calls for prepare/finalize.

| Unlock workload | D1 home | Gateway D1 calls before → after | Summed D1 wall before → after | Browser window before → after |
| --- | --- | ---: | ---: | ---: |
| Cold | WEUR | 30 → 29 | 7,799 → 7,821 ms | 13,343.5 → 13,627.8 ms |
| Activation-loss recovery | WEUR | 26 → 25 | 6,429 → 6,284 ms | 7,965.7 → 7,963.1 ms |
| Cold | APAC | 30 → 29 | 2,125 → 2,208 ms | 6,108.9 → 7,206.6 ms |
| Activation-loss recovery | APAC | 26 → 25 | 1,702 → 1,696 ms | 2,929.7 → 2,949.8 ms |

Each unlock retains two Console calls and 33 reported written rows. The challenge
uses three Gateway calls; verify now uses 26 for cold unlock and 22 for recovery.
Four baseline/candidate comparisons each remove exactly one `first` query with
fingerprint `86061681a975fdd3f4a39a60`. The remaining call multisets, batch
boundaries and write metadata match. Every reported unlock statement is served
by the selected regional primary; traces have no pending or dropped calls.

These single-sample timings **do not establish a latency gain**. The browser
runs locally under amd64 Docker emulation with unverified location; the result
establishes call reduction and correctness. Keep it separate from verified Tokyo
cohorts and from future regional latency distributions. The before samples come
from `console-sign-local-r3` (APAC) and `local-r4` (WEUR), not simultaneous paired
runs. Background traffic remains outside the unlock-route totals.

### Remaining write and read boundaries

The post-initialization unlock traces report the following writes. The figures
are D1 `rows_written`, which includes index maintenance; they do not count only
application records. See Cloudflare's [query metadata definition](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/).

| Mutation | D1 rows written per measured unlock | Decision |
| --- | ---: | --- |
| Create challenge | 3 | Keep the durable challenge binding. |
| Consume challenge | 1 | Keep one-use authentication semantics. |
| Advance authenticator counter | 1 | Keep the conditional counter update. |
| Record credential use | 3 | Preserve activity history and its version check; any reduction needs an explicit activity-semantics decision or reuse of already verified envelope data. |
| Exhaust predecessor quota | 2 | Keep in the session replacement batch. |
| Delete predecessor exchanges / retire hosted credentials | 0 in these samples | Keep both statements: a zero-change sample does not establish absence in other lifecycle states. |
| Retire predecessor session | 6 | Keep retirement coordinated with quota replacement. |
| Insert quota | 4 | Keep the authority/method guard and exact quota identity. |
| Insert session | 13 | Keep exact session/credential identity and the matching-quota guard. |
| **Total** | **33** | **No write reduction claimed.** |

The six replacement statements account for 25 of the 33 reported writes.
Inspect index usage before considering index removal; the measurements alone do
not prove an index obsolete. Batching writes further would not remove their
logical effects or their index costs.

Other repeated reads require their own evidence. Credential activity currently
re-finds its envelope after the custody lookup; passing an already verified
projection is a candidate for a later bounded change. Generic versioned-record
query fingerprints omit bound keys, so repeated hashes do not prove duplicate
records. Authority and signer reads surrounding session provisioning must retain
their current freshness boundaries. Keep these candidates separate from the
production home-routing proof and prioritize the pending authenticated regional
repeats before expanding this optimization work.

### Cleanup and reproduction

Type-check, frozen server build, diff checks and `pnpm report:bloat --check` pass.
Final postflight verifies 34 revoked experiment credentials, zero active bindings,
six new Console wallet projections (18 → 24), and zero monthly-active-resource
rows. Original Console/custody-role versions and Gateway baseline
`23058bf2-2bc1-4c15-838e-1567d8561711` are restored. Original probes remain
inactive with their original images, sizing and regional constraints; Gateway
placement is default and probe/ingress return 403/503. Local benchmark containers,
environment files and transient deployment-secret files are removed. No new
Cloudflare Container application is created.

Cumulative reported cost at 12:12:02 UTC is **$1.3392 / $25**, measured from
September 25. Analytics lag and the prior separate compute allowances still
apply. The evidence hygiene check finds zero matches across 25 files against
seven known credential values. Private traces remain under `.runtime`.

- Wallet artifacts: `.artifacts/r152/console-sign-local-r6-20261001/`, including
  the six-attempt ledger, behavioral contracts, `unlock-recovery-summary.json`,
  `commit-readback-comparison.json`, `candidate-verification.json`, script hashes,
  cost report and final restoration receipt.
- Private Console artifacts: `.artifacts/r152/console-hosted-auth-r20-20261001/`,
  including source/build/patch hashes, retained-version preflight, provisioning,
  projection verification and restoration receipts.
- Frozen source/build: `.runtime/r152-session-commit-readback/`. The candidate
  adds only its recorded service patch to `.runtime/r152-unlock-initialization/`.

Recompute the request-level evidence with:

```sh
python3 .runtime/r152-console-sign-local-r6/analyze.py
python3 .runtime/r152-console-sign-local-r6/compare.py
python3 .runtime/r152-console-sign-local-r6/verify-cohort.py
```

Future hosted repetitions need fresh attempt IDs and run directories. Preserve
these cohorts, retain the full query/Console accounting, and verify the recorded
Gateway baseline remains inside the rollback window before another deployment.
Authenticated regional repetition and production routing remain open.

## Authenticated regional repeat preparation (October 1)

The next cohort pins the verified server candidate `5ac59f45` and prepares two
Tokyo browser boots with reversed APAC/WEUR database order. Each boot covers
cold-unlock/first/warm/burst and activation-loss recovery in both homes. The
browser image preserves the frozen SDK layers, adds the already-verified IPv4
launcher, and sets the diagnostic Node header limit to 128 KiB. Its pinned Linux
manifest is `d732c569c7bbaaf2763f5dd55594094676cc94cf313dfd86f289980f99450005`;
image/layer evidence is retained separately from earlier candidates.

The first start (`console-sign-r14`, private `console-hosted-auth-r21`) was
interrupted before browser dispatch. It contributes **zero signatures and no
latency samples**. The local runner had stopped before automatic cleanup, so
explicit recovery restored Gateway/Console baseline versions, revoked all 36
experiment credentials, removed the active binding, closed ingress (503) and
verified original probes inactive with access closed (403). No temporary probe
Worker, DO namespace or Container application remains. Console projections stay
at 24 and monthly-active-resource rows at zero. Cumulative reported cost at
12:24:03 UTC is $1.3396 / $25, subject to analytics lag.

Evidence: `.artifacts/r152/console-sign-r14-20261001/` (`interruption.json`,
image fingerprints, resource absence, restoration and cost), and private
`.artifacts/r152/console-hosted-auth-r21-20261001/` (interruption state,
revocation, projection and baseline restoration receipts). A retry uses fresh
cohort and attempt IDs; this interrupted start remains outside successful-run
statistics.

### Fresh regional retry: Container allocation failure

The fresh `console-sign-r15` / private `console-hosted-auth-r22` retry deploys
its isolated Worker, DO namespace and Container application successfully. The
probe access endpoint reaches 204. Two read-only identity requests time out;
the final bounded request returns HTTP 503 with Cloudflare's message:
“There is no container instance that can be provided to this Durable Object,
try again later.” The provider instance-list observation is empty. Classify this
as `environment_or_infrastructure_failure` before browser dispatch. Runtime image
identity and Tokyo placement remain unverified; there are **zero browser attempts,
zero signatures and zero new latency samples**. No Wallet code changes result
from this failed preflight.

Cleanup deletes the temporary application, retires its DO class/namespace and
deletes the Worker. Postflight verifies all 38 experiment credentials revoked,
zero active bindings, unchanged 24 Console projections, zero monthly-active-
resource rows, restored Gateway/Console/custody-role versions, default placement,
original probes inactive, and probe/ingress access closed (403/503). Transient
secret files and both cohorts' log-stream processes are removed. Evidence hygiene
finds zero credential matches in 55 files checked against nine known values.

Cumulative reported cost at 12:39:32 UTC is **$1.3398 / $25**, subject to analytics
lag. The conservative CPU/memory/disk allowance across eleven temporary Console
probe applications is $0.4864, excluding egress; it remains separate from measured
billing and from the earlier Tokyo probe allowance. This conservative bound
assumes all three candidate instances ran throughout each application's lifetime,
even though this retry observes no allocated instance.

Evidence: `.artifacts/r152/console-sign-r15-20261001/`, including
`failure-classification.json`, `network-retries.jsonl`,
`startup-observation.json`, pinned browser-image and runner hashes, resource
creation/deletion receipts, final restoration, cost and `evidence-hygiene.json`.
Private Console evidence is `.artifacts/r152/console-hosted-auth-r22-20261001/`.
The two-boot/reversed-order runner and analyzers remain prepared under the matching
`.runtime` paths; any further execution requires fresh cohort/attempt IDs.
Authenticated regional repetition remains open. Lifecycle call-budget analysis
is separately queued in the [deferred audit](refactor-152-regional-D1.md#deferred-follow-up-lifecycle-d1-call-budgets).

## Target-image diagnosis and hosted Console lookup (October 1)

Authenticated pull-only registry inspection verified that the target tag
`r151-session-read-r16` and index digest `a30724af…` identify the same artifact.
Its Linux/amd64 child is
`sha256:0bf940dab37444f7915b6d4c7388f72d6fede2798b306d1642ca37907b6d5c7f`.
The index also contains an attestation manifest. Both target and old images use
Linux/amd64 and `node tests/r150-hosted/probe/server.mjs` in `/workspace`.
Compressed layer totals are 1,158,492,849 bytes for the target and 1,158,677,572
for the old image. The target's manifest and configuration are accessible; this
inspection does not verify every layer's availability from Cloudflare's Tokyo
image-pull infrastructure. Five-minute pull-only registry credentials were held
in memory, with no persistent service credential or credential-bearing evidence.
This supersedes run six's unauthenticated registry-inspection limitation.

A controlled diagnostic pinned the Linux child directly, preserving its contents,
application, region, CPU, memory, and disk. Rollout
`f61741e6-8caf-4af2-9ea4-6c0842c50b88` targeted version 34 and failed the ten-minute
readiness gate. An initial identity read returned the old image in `nrt13`;
later reads returned HTTP 500 and the Worker tail recorded:

> There is no container instance that can be provided to this Durable Object, try again later

The application reported one starting target, zero healthy targets, and no health
error details. The instance API exposed only the old inactive instance; the
Dashboard instances API returned no running instance. The deployment-list API
returned HTTP 404 with an authentication error and supplies no additional proof.
No wallet attempt was dispatched. This narrows the failure to provisioning the
target container before the benchmark process starts and makes OCI-index handling
an unlikely sole cause. It does **not** identify whether allocation, regional image
pull, or VM startup is responsible. The same target contents already succeeded in
London; repeated identical Tokyo retries are not useful evidence of randomness.

Evidence: `.artifacts/r152/tokyo-diagnosis-20261001/`, including verified manifests,
`target-linux-verification.json`, target application/instance health,
`target-errors.json`, and `linux-manifest-rollout.json`. The runtime harness is
`.runtime/r152-diagnosis/run.mjs`; it restores the image and Worker in `finally`.
Cloudflare investigation can use the account/application IDs, rollout ID, target
manifest, UTC timestamps, and error receipts in this directory. No support message
was sent.


Restoration rollout `325fb9dd-807f-4c54-9923-1682fb048f52` completed at application
version 35, and the old image answered in `nrt13` again. Cloudflare rejected rollback
to Probe Worker `80d39252…` twice with code 10210 ("Version not found"), although
its metadata and content remained readable. Cleanup therefore downloaded that
version's exact `worker.js` and redeployed it without bundling as
`c573e917-9faf-4448-a4a1-d6eb2d845fef`. Readback confirms identical module bytes
(SHA-256 `afccfb2a97dd27c69f08fa15281a06dd38100b6530d9f0317667811efb95c23b`),
identical bindings, and identical runtime settings. **Use this new Probe Worker
version as the restoration baseline for later experiments.** The original digest
and all other Worker baselines remain unchanged. `restored-probe-baseline.json`
and `restoration-final.json` record this recovery and its verification.

Both Gateway Workers returned to their prior versions; the three probe containers
are inactive, access is closed (Probe 403 / ingress 503), default Gateway placement
is restored, and all five custody-role versions are unchanged. The additional
Console fixture tables/immutable rows are the intentional retained database delta;
no active experiment pointers remain. Estimated cumulative spend is $1.2692 of $25
at 04:57:52 UTC, subject to analytics lag. Evidence scans found no benchmark-token
matches. The initial exact-version restoration check failed as expected and is
retained separately from the successful final restoration.

### Hosted production binding path

Private source `78e3132`, with exact Wallet Server 0.7.3, was temporarily deployed
on the **existing isolated benchmark Workers**. The path was authenticated
benchmark ingress → production Gateway entrypoint → production Console entrypoint
through `WALLET_CONSOLE` → remote D1. The old idle D1-arm Gateway hosted Console;
the DO-arm Gateway hosted the production Gateway. Production and staging services
were not deployed. Gateway, ingress, and Console placement remained default.

The experiment changed only Console's D1 binding between the already authorized
APAC and WEUR databases. Gateway `SIGNER_DB` stayed on APAC. Both databases received
the same private Console migration `0046_tenant_deployment_bindings.sql`, two
canonical synthetic deployment records, and a dedicated experiment lane. No valid
browser/service credential was issued. Immutable fixture records and the added
Console tables are retained in both benchmark databases; active pointers were
removed during cleanup. Existing wallet data was preserved.

Four blocks ran APAC → WEUR → WEUR → APAC. Each block verified the public deployment
projection, then made 16 unauthenticated session-status requests. All 64 requests
successfully resolved the Console binding and returned the expected HTTP 401.
Every timing reported the intended D1 region and primary. The latter two blocks
observed a new canonical binding revision after an active-pointer update. This
verifies hosted freshness and Gateway timing propagation without requiring a
signing credential. **No signatures were measured in this cohort.**

Each arm has 32 requests; the first request of each block is retained separately,
leaving 30 warm observations per arm. These first requests follow a successful
projection request and must not be called cold starts. Nearest-rank quantiles:

| Warm metric | APAC p50 / p95 / max | WEUR p50 / p95 / max |
| --- | --- | --- |
| Console D1 wall | 58 / 64 / 106 ms | 241 / 253 / 256 ms |
| Console SQL | 0.403 / 0.670 / 2.093 ms | 0.307 / 0.424 / 0.504 ms |
| Complete Gateway binding lookup | 64 / 149 / 166 ms | 246 / 260 / 339 ms |
| Client request wall | 88.9 / 205.5 / 399.5 ms | 267.7 / 302.4 / 590.3 ms |

All request rays identify NRT ingress. Adaptive invocation analytics also identify
NRT execution for the Gateway and the first APAC/WEUR Console versions. They
account for 51 of the 68 requests including projection checks; the final APAC
redeployment was absent at read time. These are aggregate observations rather
than per-request placement proof. D1 supplies APAC/WEUR region names, not the precise primary city. The median
binding difference is 182 ms per request; median SQL execution remains below
one millisecond in both arms. Subtracting D1 wall from binding wall per observation
gives a median five milliseconds in both arms, with a 107 ms maximum in APAC.
That remainder includes service/validation/runtime work and is not a pure transport
measurement. Multiplying this lookup cost by signing HTTP-call counts is a budget
estimate, not an observed signing result.

Private evidence: `.artifacts/r152/hosted-console-20261001/` contains all responses,
projection receipts, timing distributions, source/migration hashes, deployed
versions/bindings, aggregate placement, and restoration receipts. Runtime and
analysis scripts are `.runtime/r152-hosted-console/run.mjs` and `analyze.mjs`.
Recompute without contacting Cloudflare:

```sh
# In seams-monorepo
node .runtime/r152-hosted-console/analyze.mjs
```

The hosted binding lookup measurement gate is complete for this NRT cohort.
Full authenticated Console/signing composition, other origins, real tenant data
scale, and authority/home correctness remain open. These results are a separate
cohort from the frozen SDK/London signing measurements and must not be pooled.

## Tokyo repair attempts: image format and alternate application (October 1)

Tokyo remains blocked before wallet startup. A Docker-format manifest with the
same image contents also failed on the original APAC application. The alternate
existing application successfully started those contents in **Hong Kong**. This
establishes an APAC startup result, with zero Tokyo signing samples; it does not
isolate whether the original application's state or Tokyo's provisioning path
causes the failure.

Authenticated registry HEAD requests returned HTTP 200 and the expected sizes
for the target configuration and all eight compressed layers. This establishes
registry availability from the diagnostic client, leaving availability inside
Tokyo's image-pull infrastructure unproven. A Docker v2 manifest was published as
`r152-docker-manifest-20261001`, digest
`sha256:747fdf75e8b820377d802ef4aa934af6e6605323679ba83ce611bb36ee88d877`.
Only manifest media types changed; the configuration digest and ordered layer
digests/sizes match the original Linux/amd64 child exactly. The SDK and Gateway
sources remained frozen.

The image-preparation API returned `ready` for this Docker manifest, with runtime
artifact `sha256:9143f3f567524312a789564de255c6ec8958c86a7f2bd80b609fdabe2a51d569`.
The original OCI index briefly reported `runtime image build failed`, then
returned to pending. These snapshot-preparation observations concern the newer
`durable_object` scheduling path; our applications use `default`. They cannot
establish a cause or repair for the current application rollout. See Cloudflare's
[image management documentation](https://developers.cloudflare.com/containers/guides/image-management/).

| Diagnostic | Evidence | Outcome |
| --- | --- | --- |
| Docker manifest on original APAC application | Rollout `7962dee6-b25d-490e-9da1-363a276650ee`, target version 36 | Ten-minute gate failed; one starting target, zero healthy; zero wallets dispatched. |
| Alternate existing WEUR application temporarily constrained to APAC | Rollout `190c0c61-e1f4-4e32-8f55-b3e38c39d97b`, target version 43 | Completed at 05:28:07 UTC, followed by a stable observation. Fresh identity reported `hkg13`, country `HK`, and the expected frozen SDK revision/build hash. |
| Tokyo location gate on that fresh boot | Boot `d3230dff-9e13-4359-9b57-7ef77ed2d16f` | Correctly rejected Hong Kong before dispatching any wallet. No second fresh-boot verification or signing comparison ran. |

The alternate probe reused an idle application; no new Worker, Container
application, database, or persistent service credential was created. Its initial
preflight failed because Cloudflare rejects direct secret updates when a rolled
back Worker version is active and a newer uploaded version exists. The corrected
harness redeploys the saved identical Worker with `--containers-rollout none`
before opening its expiry window. That preflight is retained separately and is
an orchestration failure with zero wallet attempts.

Postflight readback verifies the original images and Worker baselines, WEUR
constraints restored on the alternate application, all three probes inactive,
default Gateway placement, closed access (Probe 403 / ingress 503), and unchanged
versions of all five custody roles. The first read still reported the restored
WEUR instance running; two subsequent reads confirmed it inactive. Retain that
initial observation alongside `restoration-recheck.json` and
`restoration-final.json`. The evidence scan found zero benchmark-token matches
in 56 files. Estimated cumulative spend at 05:30:55 UTC is $1.2789 of the $25 cap,
including both regional databases and subject to analytics lag. The additional
Docker manifest/tag is retained as diagnostic evidence.

Evidence directories are `.artifacts/r152/tokyo-fix-20261001/` (manifest
equivalence, blob availability, preparation observations and failed Tokyo
rollout), `.artifacts/r152/tokyo-fix-alt-20261001/` (failed preflight), and
`.artifacts/r152/tokyo-fix-alt2-20261001/` (successful alternate rollout,
`cold-starts.json`, original/restored constraints and cleanup). Private runners
have corresponding `.runtime/r152-tokyo-fix*/` directories. Preserve these
directories and use new attempt IDs for any future run.

Cloudflare's documented [placement constraints](https://developers.cloudflare.com/containers/concepts/placement/)
offer regions and jurisdictions; APAC placement does not guarantee Tokyo.
Request provider investigation of the original APAC application
`a0364754-239e-4823-967a-0888b9d89c08`, its failed rollouts above and in the prior
diagnostic, and compare against the successful alternate application
`a0362b6f-e9f6-4271-ad23-966e484b63d1` in Hong Kong. Supply the immutable image
digest, UTC observations and health/allocation receipts. No support message was
sent. Changing scheduling policy requires a new application and lies outside
the current experiment's resource authorization. Keep the Tokyo gate open until
the frozen image starts there and controlled signing measurements complete.

## Placement reset on the original application (October 1)

A further recovery attempt reused the original APAC application and its existing
probe Durable Object. It kept the Docker manifest `747fdf75…`, frozen SDK and
2-vCPU / 8-GiB / 16-GB configuration unchanged, temporarily constrained placement
to WEUR, then restored APAC. The target image started on this same application
in **London and Hong Kong**. Thus the original application can run the target;
the remaining unmet requirement is a verified Tokyo placement.

WEUR rollout `ea76e10b-1841-47ae-943c-1e70a379330b` completed at version 38,
with stable observations at 05:39:39 and 05:39:46 UTC. A fresh boot reported
`lhr01`, country `GB`, expected source revision `a2c936ed…` and build hash
`04c22bce…`. The return to APAC, rollout
`f4a9bd3c-b9b1-4361-b58f-a89531ec1c6e`, completed at version 39 with stable
observations at 05:45:52 and 05:45:59 UTC. Its fresh boot was `hkg13`, country
`HK`, boot `eb5d3516-ded6-41df-8a40-fab0236648ad`. The Tokyo gate stopped the run
before any wallet attempt. This recovered rollout availability without meeting
the Tokyo measurement gate; no latency samples were collected.

Evidence and private runner are
`.artifacts/r152/tokyo-relocation-20261001/` and
`.runtime/r152-tokyo-relocation/run.mjs`. `relocation-weur-identity.json`,
`cold-starts.json`, both rollout histories, constraint receipts and
`restoration.json` preserve the transition. Original-image restoration rollout
`89dd13fb-439b-4686-ac73-b1a32c3fbcd8` completed at version 40. Postflight verified
both original Worker versions, original images, APAC/WEUR constraints, the
original probe size, inactive instances, default Gateway placement and closed
benchmark access.

A separate size experiment then used the same image and original application
with 1 vCPU, 6 GiB memory and 12 GB disk. Rollout
`73f4a05b-2e4e-435f-8a41-47dc983f8aaa` completed at version 41, with a stable
observation at 05:52:27 UTC. Its fresh boot also reported `hkg13`, country `HK`,
boot `6a84f4fe-e87c-49f8-a1b3-8d73c423d9a9`, and the expected frozen SDK source.
The Tokyo gate again stopped before dispatch. This does not prove Tokyo capacity
is sufficient or insufficient; it shows that reducing the requested size did
not produce Tokyo placement. Evidence is in
`.artifacts/r152/tokyo-size-20261001/`, with private runner
`.runtime/r152-tokyo-size/run.mjs`. Both recovery experiments dispatched zero
wallet attempts and contribute no signing latency samples.

The size experiment restored the original image and size through rollout
`e10da545-2134-4947-ac0c-27a1791d70fc`, version 42. Final readback verifies
2 vCPU / 8 GiB / 16 GB, original APAC/WEUR constraints, original images and Worker
baselines, inactive probes, default Gateway placement, closed access (403/503),
and unchanged deployments of all five custody roles. The two experiments' scan
found zero benchmark-token matches in 47 evidence files. Estimated cumulative
spend at 05:55:52 UTC is $1.2896 of $25, subject to analytics lag.

### Prepared scheduling-policy alternative

A temporary probe using Cloudflare's beta `durable_object` scheduling policy is
prepared in `.runtime/r152-tokyo-do-policy/`, with `worker.js`, `wrangler.json`
and a successful Wrangler 4.145.0 deployment dry run in `dry-run.log`. It starts
the same digest-pinned image through `ctx.container.start()` at `standard-3`,
uses one fixed probe DO with an APAC location hint, and retains the existing
expiry/authentication checks. It bypasses the application-wide image rollout.
Cloudflare documents that this [policy is immutable](https://developers.cloudflare.com/containers/configuration/scheduling-policy/),
so testing it requires a new application. An APAC hint still cannot guarantee
Tokyo; two fresh boots with `JP` / `nrt*` identities remain a prerequisite for
signing measurements.

The proposed resource bundle is Worker `r150-bench-20261001-tokyo-recovery`, its
`ProbeTokyo` DO namespace and associated Container application. Reuse the
existing benchmark credential, keep the cumulative $25 cap, leave production
untouched, preserve redacted evidence and delete only this new resource bundle
after verification. The user subsequently approved this temporary resource
bundle. The deployment and Tokyo startup evidence are recorded below.

## Temporary DO-scheduled probe: verified Tokyo startup (October 1)

The approved alternative started the frozen SDK in **Tokyo, `nrt08`**, on two
fresh boots under the `durable_object` scheduling policy. The successful probe
omits the broad APAC location hint and lets the initial request select nearby
DO placement. This is a verified workaround for this cohort; it does not prove
the internal cause of the old rollout failures or guarantee Tokyo for future
DOs. Cloudflare documents [best-effort initial placement](https://developers.cloudflare.com/durable-objects/reference/data-location/).

The temporary Worker is `r150-bench-20261001-tokyo-recovery`; its successful
application/namespace is `1d39c826777b4a14bceafbe911a7c563`, and its fixed probe DO
is `0bb3ede4bfa2c3c34d76e10f38591bc3761d65c907e126accb00fc3dab4cfe2a`.
The two boot IDs are `fb560e18-a0b5-4f7a-a4e3-c536b8ddd15f` and
`40940b37-16be-4b70-a382-1e003bf0c834`. Both report `nrt08`, APAC, SDK revision
`a2c936ed…` and build hash `04c22bce…`. Independent Cloudflare instance reads
confirm the same instance/location, application ID, Docker manifest `747fdf75…`,
and 2-vCPU / 8-GiB / 16-GB size. Instance lifecycle status briefly lagged the
successful process response; process identity and the control-plane location
were both recorded.

This policy leaves the frozen probe server's `applicationId` and `countryA2`
environment-derived fields null. Those fields remain null in the raw evidence.
The runner instead verifies membership through Cloudflare's application-scoped
instance API and requires the provider-reported `nrt*` location and APAC region.
No region or country value was injected into the container to make the gate pass.

Bootstrap attempts are retained independently:

- Initial deployment rejected missing required secrets before creating resources.
  The corrected bootstrap supplies the existing credential and expiry atomically
  via a private temporary secrets file, removed immediately after deployment.
- The second attempt deployed resources but encountered HTTP 404 on its first
  probe request. Its ambiguous 404 readiness check was replaced with an
  authenticated `/readyz` endpoint returning 204.
- The third attempt reached that explicit readiness endpoint through NRT, then
  returned a Worker exception on a stop request before first startup. The next
  attempt starts a fresh container before exercising stop/restart.
- The fourth attempt, with an APAC hint, started successfully in `kix06` (Osaka)
  and exposed the missing environment-derived identity fields. It supplied no
  Tokyo sample. The fifth attempt omits that hint, verifies the control-plane
  instance identity, and passes both Tokyo boots.

Evidence is under `.artifacts/r152/tokyo-do-policy-20261001/` and the separate
`tokyo-do-policy-r2-20261001/` through `tokyo-do-policy-r5-20261001/` directories.
Each preserves resource inventories and cleanup receipts; runner/config hashes
are in `runner-fingerprints.json`. The successful private runner is
`.runtime/r152-tokyo-do-policy-r5/run.mjs`. Use fresh evidence IDs for another run,
verify the observed city again, and retain the expiry and resource-deletion path.

The fifth attempt completed one APAC-D1 linked-chain wallet with nine verified
signatures. While changing Gateway bindings for the next arm, a subsequent
identity read found a different boot ID. The guard stopped before dispatching a
WEUR wallet. This is a separate infrastructure failure of the planned two-arm
run; the completed APAC artifact remains valid. The restart's internal cause is
unresolved. Do not label that planned two-arm run successful or append samples
under its old boot identity.

The follow-up sets the Gateway arm before starting its probe and records each
arm as a separate cohort. A sixth attempt placed the fresh probe in Osaka and
dispatched no wallet. The seventh permits at most three sequential fresh probe
objects inside the approved namespace, stops rejected candidates, and selects
only a provider-verified Tokyo instance. Candidate 0 reported `kix06`; candidate
1 reported `nrt08` and passed a stop/restart identity check. Only that candidate
proceeds to the WEUR D1 workload. This bounded discovery is a measurement
workaround for best-effort placement. Future runs must verify the actual city.

### Tokyo signing results and cleanup

Both dispatched wallet attempts succeeded: **18 verified signatures**, with
three owner and six linked-device signatures per D1 arm. Each fresh wallet
completed owner→second-device→third-device linking and signing. The seventh
attempt's selected Tokyo object stayed on boot
`393ed457-a45e-4b8a-9a7b-cd9414a30223` through its WEUR workload. The existing
regional analyzer validated build/database identities, signature counts and
dependency accounting: owner signatures use four HTTP requests, seven D1 calls
and eight SQL statements; linked signatures use two HTTP requests, five D1 calls
and six SQL statements. Both retain two write-bearing calls and 14 rows written.
Statement region checks match each assigned database arm.

| Tokyo ready-material workload | D1 arm | Signatures | SDK median | SDK p95 / maximum | D1 wall-time median | SQL-time median |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Owner | APAC | 3 | 1,673.8 ms | 1,824.8 ms | 556 ms | 16.57 ms |
| Owner | WEUR | 3 | 3,010.5 ms | 3,164.1 ms | 1,941 ms | 14.65 ms |
| Linked devices | APAC | 6 | 1,429.8 ms | 1,666.7 ms | 524 ms | 16.55 ms |
| Linked devices | WEUR | 6 | 2,702.1 ms | 2,873.1 ms | 1,746 ms | 13.56 ms |

These are separate, unpaired cohorts on different verified Tokyo boots, with
APAC measured before WEUR. The sample is small and includes repeated signatures
within each wallet; it does not satisfy the broader 30-per-arm/workload sample
target or establish a latency bound. It uses the same frozen SDK/Gateway and
static-Console scope as the London experiment, so full authenticated hosted
Console composition remains open. The observed preference for APAC in Tokyo and
WEUR in London supports continuing regional-home design, while keeping its
authority and rollout proofs separate.

Reproduce the validated summary, preserving both cohort identities:

```sh
node tests/r150-hosted/analyze-regional-d1.mjs \
  .artifacts/r152/tokyo-do-policy-r7-20261001/summary.json apac \
  .artifacts/r152/tokyo-do-policy-r5-20261001 \
  .artifacts/r152/tokyo-do-policy-r7-20261001
```

For another Tokyo run, use the seventh runner's sequence: set the D1 arm first,
deploy the temporary DO-scheduled probe with its existing credential and expiry,
wait for authenticated readiness HTTP 204, and start up to three sequential
candidate objects without a location hint. Stop every rejected candidate. Match
process identity to the application-scoped provider instance record, select only
`nrt*` / APAC, then verify a fresh restart and keep that boot fixed through one
wallet cohort. Retain failed placement candidates and any boot change. The
private reference is `.runtime/r152-tokyo-do-policy-r7/run.mjs`; create fresh run
directories and IDs before reusing it.

Cleanup stopped the selected probe, restored ingress expiry and the original
Gateway, deleted the temporary Container application, retired its DO namespace
with a deletion migration, and deleted the temporary Worker. Readback confirms
all six application/namespace/Worker bundles created across the bootstrap and
measurement attempts are gone. The original three probe applications retain
their original images, size and regional constraints; all are inactive. Original
Worker versions, default Gateway placement, closed benchmark access (403/503),
and all five custody-role deployments were verified. Temporary deployment-secret
files were removed. No staging or production deployment occurred.

The scan found zero benchmark-token matches in 121 evidence files. Reported
cumulative spend at 06:32:08 UTC is $1.2920 of $25. All six temporary application
IDs are included in the query, but their Container usage has not yet appeared
in the analytics response. The conservative configured CPU/memory/disk ceiling
over their full lifetimes is an additional $0.0568 before network transfer,
recorded in `temporary-compute-bound.json`; this is a capacity-based allowance
for delayed accounting, not an additional measured charge. Preserve the cost
receipt's analytics-lag limitation.

## Tokyo sample extension (October 1)

The follow-up retains the frozen SDK/Gateway sources, original custody roles,
database assignments, Docker-format image, probe size, sequential workload and
static Console composition. Each fresh wallet again exercises three owner,
three second-device and three third-device signatures. Provider instance records
verify `nrt08`; independent arms use distinct probe boots and wallets.

The WEUR-first `tokyo-do-policy-r8-20261001` run completed one nine-signature
cohort. Polling its second dispatched attempt failed with `TypeError: fetch
failed` at 06:50:21 UTC. The automatic cleanup then could not obtain Wrangler
authentication. After connectivity/authentication recovered, the attempt endpoint
returned `404 unknown attempt`; no result for that attempt could be recovered.
Its ledger retains the collection failure and contributes no verified samples.
This is an infrastructure/collection failure; the final Wallet operation outcome
is unknown. Recovery closed ingress, restored the Gateway and deleted the
temporary application, namespace and Worker, with successful readback.

The next runners allow at most three attempts for a transient network failure
while reading probe status. Wallet-attempt POSTs remain single-dispatch, HTTP
errors remain failures, and identity checks still stop a changed boot. The failed
attempt is retained independently of subsequent successful cohorts.

The APAC `tokyo-do-policy-r9-20261001` run completed nine further wallets and
81 verified signatures on boot `4026fdc5-5430-445f-99e8-838b4b1549ba`, with no
failed or incomplete attempts. Together with the original APAC cohort, it reaches
30 owner and 60 linked signatures across ten fresh wallets. Owner SDK p50/p95/max
is 1,689.95/2,065.6/2,069.4 ms; linked p50/p95/max is
1,447.55/1,637.1/1,680.1 ms. All traced calls retain the expected seven/five D1
budgets and assigned primary region. Its cleanup/readback passed; all five
custody-role versions remain unchanged.

The matching WEUR extension uses fresh run directory
`.artifacts/r152/tokyo-do-policy-r10-20261001/`. Its first two candidates started
in `kix06` and were stopped without wallet dispatch; its third candidate started
in `nrt08` and passed a fresh restart. All eight wallets and 72 signatures passed
on boot `64baa1dd-8248-49c2-8f87-2a421bbd9b3d`. The extension adds 162 verified
signatures to the original 18. Pooling runs r5, r7, r8, r9 and r10 produces the
following ready-material comparison:

| Device path | Samples per arm | APAC SDK p50 / p95 / max (ms) | WEUR SDK p50 / p95 / max (ms) | APAC p95 reduction relative to WEUR |
| --- | ---: | ---: | ---: | ---: |
| Owner | 30 | 1,689.95 / 2,065.6 / 2,069.4 | 2,968.95 / 3,173.6 / 3,206.4 | 1,108.0 ms (34.9%) |
| Linked generations combined | 60 | 1,447.55 / 1,637.1 / 1,680.1 | 2,614.25 / 2,970.6 / 3,172.8 | 1,333.5 ms (44.9%) |

APAC completed 10/10 dispatched wallets. WEUR completed 10/11; the remaining
attempt is the r8 collection failure described above (9.1% of its dispatched
attempts). Its Wallet outcome is unknown. Rejected placement candidates and
pre-dispatch boot changes remain separate infrastructure evidence. The 180
verified signatures come from 20 completed fresh wallets, with three owner and
six linked signatures per wallet; each linked generation contributes 30 samples
per arm. There are no incomplete ledger entries.

Owner summed D1 wall p50 is 564 ms for APAC versus 1,929 ms for WEUR, while SQL
p50 is 16.45 versus 15.38 ms. Linked D1 wall p50 is 500 versus 1,713 ms, with SQL
p50 15.59 versus 14.78 ms. The analyzer validates all 480 dependency-window HTTP
requests, 1,020 D1 calls and 1,200 SQL statements. Both arms retain two
write-bearing calls and 14 written rows per signature. Every observed statement
uses the assigned primary region; no foreground refill appears in these windows.

`gateway-build-comparison.json` verifies byte-identical Gateway JavaScript and
all three WASM files across all five pooled runs. The frozen SDK identity also
matches across runs. Cloudflare's adaptive analytics place the r9 and r10 Gateway
versions in NRT; observed custody DO activity includes NRT and KIX. These aggregate
records do not identify every signing RPC. They establish no same-datacenter
claim between D1, Gateway and all custody roles.

The earlier APAC→WEUR diagnostic is followed by WEUR r8, APAC r9, and WEUR r10
blocks. Arms remain unpaired, with unequal block sizes and independent boots.
The descriptive wallet-cluster bootstrap in `wallet-bootstrap.json` uses 20,000
resamples and seed `15200001`, resampling ten completed wallets independently
within each arm while retaining all nine signatures from each selected wallet.
Its 95% percentile intervals for the APAC p95 reduction are 1,050.6–1,298.3 ms
(33.7–40.9%) for owners and 1,093.0–1,525.9 ms (39.6–49.4%) for linked signing.
These intervals condition on completed wallets and observed boots; they exclude
the collection failure and do not capture temporal, boot-level, placement-selection
or future-tail uncertainty. The APAC/WEUR differences exceed 20% and 100 ms for
this workload. Tokyo's implication is to retain APAC as its initial home;
London's measured benefit over the APAC baseline motivates adding a WEUR home.
APAC's 2,069.4-ms owner maximum exceeds two seconds. First-sign/burst, other-region
and authenticated Console gates stay open.

All nine temporary application/namespace/Worker bundles created across the Tokyo
recovery and repeat runs are deleted. Final readback verifies the original Worker
versions, inactive original probe applications with their original images/size/
constraints, default Gateway placement, closed access (403/503), and unchanged
custody-role versions. No temporary deployment-secret files remain. The scan of
146 new evidence files found zero benchmark-token matches.

Reported cumulative spend at 08:01:25 UTC is $1.3141 of $25. The analytics query
includes all nine temporary application IDs, whose Container usage remains absent
from the response. `temporary-compute-bound.json` records a conservative $0.5714
CPU/memory/disk allowance over all application lifetimes, assuming every observed
candidate ran for its application's entire lifetime. Network transfer is excluded;
this allowance is separate from measured billing and addresses accounting lag.

Reproduce the pooled analysis with:

```sh
node tests/r150-hosted/analyze-regional-d1.mjs \
  .artifacts/r152/tokyo-do-policy-r10-20261001/summary.json apac \
  .artifacts/r152/tokyo-do-policy-r5-20261001 \
  .artifacts/r152/tokyo-do-policy-r7-20261001 \
  .artifacts/r152/tokyo-do-policy-r8-20261001 \
  .artifacts/r152/tokyo-do-policy-r9-20261001 \
  .artifacts/r152/tokyo-do-policy-r10-20261001
python3 .runtime/r152-tokyo-do-policy-r10/bootstrap.py \
  .artifacts/r152/tokyo-do-policy-r10-20261001/summary.json \
  .artifacts/r152/tokyo-do-policy-r10-20261001/wallet-bootstrap.json
```

The private r9/r10 runners and their recorded fingerprints retain the GET retry
bound, single-dispatch POST behavior, placement checks, frozen inputs and cleanup.
Use fresh run directories and attempt IDs for any further hosted execution.

## Decision and remaining work

London and Tokyo provide sufficient measured benefit to continue regional ownership
**design**: each favors its nearby primary in the ready-material workload.
Regional production activation remains gated on repeated first-sign/
burst samples, other-region evidence, repeated authenticated Console/signing
cohorts and the complete home/authority proof. The initial hosted composition,
projection replay and cold-unlock diagnostics now pass. Hosted NRT binding timing is now measured separately. The routing work should extend the existing
canonical deployment binding with an immutable initial home for a complete
deployment namespace, keeping its organization’s projects together and including
authenticated internal and scheduled paths.
Keep existing owners pinned; defer transfer machinery until a transfer is needed.
See [the ownership review](refactor-152-ownership-review.md) for the current
cross-project constraints and outstanding correctness scenarios.

## Evidence and reproduction

Evidence root: `.artifacts/r152/regional-d1-20261001-r1/`.

- `database-inventory.json`, `migration-imports.json`, and both
  `schema-*-quick-check.json`: database identity, schema, and migration receipts.
- `configuration-delta.json`, `gateway-source.json`, `role-versions-before.json`,
  `run.json`, and `arm-deployments.jsonl`: treatment and build identities.
- `deployed-bindings.json`: Cloudflare version records confirming each deployed
  Gateway's exact database and namespace pair.
- `weur/attempts.jsonl`: durable start/completion ledger; failed attempts remain.
- `weur/gateway-ecdsa-linked-chain-*.json`: behavioral proof and redacted timings.
- `summary.json`: validated per-signature samples, per-chain distributions, and
  aggregate comparisons with failed and incomplete attempt counts.

Recompute distributions and validate call accounting with:

```sh
node tests/r150-hosted/analyze-regional-d1.mjs \
  .artifacts/r152/regional-d1-20261001-r1/summary.json weur \
  .artifacts/r152/regional-d1-20261001-r1
```

Pass additional cohort directories to pool repeat runs into a separate output
file. The analyzer rejects duplicate attempt IDs, different SDK/Gateway build
identities, or different database assignments before combining samples.

Private configuration and orchestration live under `.runtime/r152-regional-r1/`.
They reuse the existing migration importer and hosted probe; credentials are
excluded from public evidence. Reproduction requires the isolated benchmark's
existing credentials and a new run directory/IDs to retain every attempt.

The first run's postflight verifies original Worker versions/images restored,
all three probes inactive, Gateway placement reset, probe access HTTP 403, and
ingress HTTP 503. The evidence scan found zero benchmark-token matches in 47
files. Cumulative cost increased from $1.0538 to $1.1051 against the $25 cap,
subject to analytics lag; postflight accounting includes both new database IDs.
The new databases remain retained for evidence and the authorized repeat.

The second run also restored original Worker versions/images, inactive probes,
default placement, and HTTP 403/503 access closure before the next diagnostic.
Its scan found zero benchmark-token matches in 57 evidence files. Cumulative
estimated cost through the second run is $1.2095, including both regional
databases and subject to accounting lag.

## Lifecycle ownership verification (October 1)

Source checkpoint: Wallet `5533e526`. The ownership follow-up reviews both export
curves, linked installation/activation/cleanup, method revocation, lane retirement,
OTP accounting and policy/quota administration. It selects the entire namespace
as the initial rollout owner and specifies the provisioning checks needed to bind
that assignment to an actual database resource. This is design and local
correctness work; regional routing remains unimplemented.

The existing intended-behavior E2E **“an Ed25519 export interrupted after its
authorization committed is admitted by the exact retry”** passed with a fresh
SDK, five custody Worker builds, Wallet Server and local initializer. The runner
reported **1 passed (13.5m)**, including build/setup time. Its harness asserts the
injected committed-authorization interruption was observed and the exact retry
completed export. This verifies the current local Workers behavior that regional
routing must preserve. It supplies no hosted placement or latency measurement.

Evidence directory: `.artifacts/r152/lifecycle-ownership-20261001/`.
`export-e2e.log` retains the first run, `source-inventory.json` hashes the thirteen
reviewed implementation files, and `table-source-index.json` maps the existing
schema to source references. The recorded 39 migration hashes are unchanged.
`bloat.log` records the passing required check. Local service ports were released
after the run; no hosted resources or frozen candidates were changed.

A second fresh-state run reused those builds with lifecycle trace persistence
enabled and passed in **36.1 seconds**. `export-e2e-evidence.log`, `traces/` and
`verification.json` retain the result, test/harness hashes and trace digest. The
retained trace confirms exact interrupted-export retry and zero lifecycle
violations. These are two correctness runs, not a performance sample series.

Reproduce from Wallet root with trace persistence enabled:

```sh
SEAMS_INTENDED_PERSIST_TRACE=1 \
node tests/scripts/run-wallet-intended-isolated.mjs -- \
  e2e/intended-behaviours/passkey.ed25519-yao-local.contract.test.ts \
  --grep 'an Ed25519 export interrupted after its authorization committed'
```

## Console namespace-home reservation (October 1)

Private source checkpoint: `seams-monorepo` commit `12784a3`. The existing Console
deployment service now supports immutable namespace-to-D1 resource reservation.
The new Console migration `0047_namespace_d1_homes.sql` stores a required account
ID, database UUID and original assignment timestamp. An atomic conditional insert
and primary readback use two D1 calls per reservation attempt. Existing Wallet
request paths do not call it; their call counts and measured latency are unchanged.

The local Worker/D1 E2E verifies:

- Twelve concurrent requests through two Worker instances proposing two homes:
  **one reserved, five reused, six conflicts**, with every response reporting the
  same authoritative assignment.
- A fresh reservation whose response is deliberately lost survives disposal and
  restart of the runtime. Exact retry returns the original home and timestamp.
- A pending reservation rejects changed database or account IDs. Another namespace
  can share the same database. A region label in place of a UUID is rejected before
  persistence.
- Direct SQL update, delete and `INSERT OR REPLACE` are rejected. The final stored
  assignment is unchanged.

The final run passed this scenario and the existing production Console binding
read/timing E2E: **2 passed (2.6 seconds)**. Package type-check, Console test
type-check, type fixtures and targeted ESLint passed. The type fixtures reject
unparsed literals, direct construction, broad-spread identity changes, mixed
success/failure outcomes and missing assignments. Initial harness setup failures
(WASM loader and output directory outside the workerd module root) were corrected
before the passing runs; they did not reach reservation behavior.

Retained evidence in the private checkout:
`.artifacts/r152/namespace-home-20261001/` contains `e2e.log`,
`namespace-home-evidence.json`, `console-binding-evidence.json` and
`source-sha256.json`. The JSON evidence includes the race responses, SQL guards,
migration and Worker bundle hashes. Reproduce from `seams-monorepo`:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/namespace-d1-home.e2e.test.ts \
  relayer/tenant-deployment-binding.e2e.test.ts \
  --reporter=line --output=test-results/r152-namespace-home
```

Scope: the new scenario uses test-only Worker transports around the production
Console store. Authenticated provisioning does not yet call the reservation;
canonical bindings and activation do not yet enforce it. Physical database
identity, regional routing, hosted placement, travel latency and deployment
cost were not measured here. No remote migration or infrastructure deployment
was performed. Next, pin existing namespace resources and integrate reservation
before provisioning side effects, then verify actual Worker bindings before
activation and regional Gateway routing.

## Authenticated home admission (October 1)

Private source checkpoint: `seams-monorepo` commit `a09e454`. Console provisioning
now requires its configured namespace/account/database resource to match a
pre-existing immutable home reservation. Missing homes return
`namespace_home_unassigned`; mismatches return `namespace_home_conflict`. The
check happens after environment resolution and before active-binding reuse,
cutover creation, tenant-root creation and API-key creation. Hosted admission
uses one Console D1 read and cannot assign or repin a namespace.

The new E2E uses two production Console Workers, the actual automation route,
cryptographically signed test OIDC tokens and all Console migrations on one local
D1 authority. Only the external identity-provider key response and Wallet custody
service are controlled by the harness; custody deliberately returns HTTP 503.

Observed results:

- An unauthenticated request returns HTTP 401. A signed request without an
  assignment returns HTTP 409 with the specific unassigned-home code, creating
  zero cutovers and sending zero custody requests.
- A signed request containing its own home is rejected by the request parser;
  no assignment is created.
- After an explicit reservation, concurrent requests to matching and conflicting
  lanes admit only the matching lane to custody work. The conflicting lane
  returns the specific conflict code and creates zero cutovers.
- The matching lane reaches the injected custody-service failure. Retry passes
  home admission again and preserves the original resource/timestamp. Two matching
  lane cutovers remain awaiting the tenant root; zero credentials and zero active
  bindings are created. This proves admission and failure preservation, not a
  completed provisioning retry or successful activation.

The composed validation passed **4 E2Es in 5.4 seconds**: production Console
credential service, immutable-home race/restart, provisioning admission, and
binding freshness/timing. After adding the request-supplied-home assertion, the
provisioning scenario passed again in **3.4 seconds**. Package type-check,
Console test type-check, type fixtures and targeted ESLint passed. A test helper's
overbroad DOM `RequestInit` annotation was narrowed after Miniflare type-check
rejected it; runtime tests had passed. Console configuration rendering also
passed with a synthetic account ID. No provider API was called.

Evidence in the private checkout:
`.artifacts/r152/home-provisioning-20261001/` contains `e2e.log`,
`provisioning-final.log`, `namespace-home-provisioning-evidence.json`, the other
E2E evidence, `source-sha256.json` and the local rendered Console configuration.
The provisioning JSON records migration/bundle hashes, responses, custody request
paths and the precise unverified gates. Reproduce:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/namespace-home-provisioning.e2e.test.ts \
  relayer/console-service-auth.e2e.test.ts \
  relayer/namespace-d1-home.e2e.test.ts \
  relayer/tenant-deployment-binding.e2e.test.ts \
  --reporter=line --output=test-results/r152-home-provisioning
```

The local Worker bootstrap reserves its development home only when provisioning
runs; that adapter was type-checked, while this E2E exercises the hosted Console
composition. Existing hosted namespace resources must be inventoried and pinned
before deployment; a configured UUID alone is insufficient evidence for that pin.
Canonical binding identity, direct activation enforcement, physical D1 binding
verification, completed provisioning/canary behavior and regional routing remain
open. No infrastructure was deployed and no new hosted latency or cost claim is
made by this run.

## Activation home enforcement (October 1)

Private source checkpoint: `seams-monorepo` commit `afeea62`. New deployment
activation requires a parsed namespace/account/database identity. The store
checks it against the binding namespace and immutable Console reservation;
the activation INSERT records account/database IDs and a database trigger checks
that relationship atomically before applying the active pointer. Migration
`0048_tenant_deployment_activation_homes.sql` also rejects activation replacement.

The new local D1 scenario verifies:

- A historical activation survives migration with its original binding JSON and
  revision unchanged, and NULL home columns. It cannot become a home-recorded
  completed retry merely because a namespace reservation is later supplied.
- After explicit pinning, a fresh activation adopts the same binding with the
  required home, increments the sequence and supports exact completed retry.
  The historical row remains unchanged.
- Direct activation INSERTs with conflicting or missing home IDs fail. Competing
  matching/wrong-home service calls activate only the matching request.
- A completed new activation can be retried after its readiness receipt expires.
  Two competing valid replacements produce one winner and one activation conflict.
  The old completed request is rejected after replacement. `INSERT OR REPLACE`
  cannot replace an activation.

The composed run passed **5 E2Es in 7.8 seconds**, covering credential service,
namespace reservation, activation, provisioning and binding reads. The final
activation scenario, extended with successful historical adoption, passed in
**3.3 seconds**. All **8 existing binding tests** passed after their still-valid
activation fixtures were updated for the required home and migrations. No new
unit tests were added. Package type-check, Console test type-check, type fixtures
and targeted lint passed; the type fixture rejects activation without a home.

Evidence in the private checkout:
`.artifacts/r152/home-activation-20261001/` retains
`namespace-home-activation-evidence.json`, `activation-final.log`,
`verification.json`, `source-sha256.json` and the composed E2E evidence. The
activation JSON records migration hashes, persisted activation resource IDs,
race outcomes and the explicit unverified gates. Reproduce from `seams-monorepo`:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/namespace-home-activation.e2e.test.ts \
  relayer/namespace-home-provisioning.e2e.test.ts \
  relayer/namespace-d1-home.e2e.test.ts \
  relayer/tenant-deployment-binding.e2e.test.ts \
  relayer/console-service-auth.e2e.test.ts \
  --reporter=line --output=test-results/r152-home-activation
```

Scope and cost: this scenario calls the production activation store against real
local Worker D1, using fixture readiness receipts. It does not run hosted custody
or verify physical database bindings. Fresh activation adds one reservation read;
the completed-retry path adds three reads (binding, reservation and recorded
activation home). These are deployment-control calls; hosted unlock/signing paths
are unchanged. The trigger performs its SQL check inside the activation call.

The canonical binding payload still excludes home identity. Existing immutable
revisions hash their exact payload, so that format change needs explicit new
revisions and an adoption procedure. Existing runtime readers and direct
administrative active-pointer writes are outside this activation-insert check.
Before rollout, inventory/pin actual resources, complete canonical/runtime home
enforcement, verify physical Worker bindings, and exercise full provisioning and
canary success. No remote migration, deployment or latency measurement occurred.

## Canonical home contract and adoption (October 2)

Private source checkpoint: `seams-monorepo` commit `dd6f5bf`. A binding now requires
`home.accountId` and `home.databaseId`; both participate in its canonical content
hash. Ordinary decoding rejects old home-less bindings and modified homes under
an existing revision. Resource parsing is shared with namespace reservations.
The binding kind/schema remain V1; the required shape changes and exact content
revision distinguishes the replacement. Consumer deployment must be coordinated.

Explicit persistence adoption verifies the historical canonical hash and row
metadata, requires a matching immutable reservation, and inserts a new binding
revision. Repeating adoption returns the same replacement. It does not update the
active pointer or rewrite the original row. Activation separately compares the
requested home with the binding and reservation; migration
`0049_tenant_deployment_binding_homes.sql` enforces canonical-home agreement in
the activation INSERT transaction.

Bound Gateway, Wallet Runtime and combined runtime environments reject a
configured resource different from the binding. Gateway scheduled work uses the
same binder. Provisioning candidates include the configured home; active reuse
and candidate persistence reject mismatches. Gateway and Wallet Runtime config
rendering was checked with a synthetic account ID, including exact agreement
between the declared home UUID and generated `SIGNER_DB` binding UUID. This
configuration check does not inspect deployed Cloudflare resources.

The local adoption E2E verifies old-format rejection, corrupt historical-hash
rejection, missing/conflicting reservations, deterministic replacement and
activation retries, unchanged original binding JSON and an unchanged active
pointer until activation. Changing the home changes the content revision; a
runtime with another configured database is rejected. The service-binding E2E
also exercises a wrong-home Worker consumer. The activation E2E now applies the
latest migration and proves that SQL cannot activate a canonical home different
from the otherwise-valid namespace reservation.

Final validation: **6 E2Es passed in 8.1 seconds**, **8 existing binding tests
passed in 1.4 seconds**, shared/server type checks, Console test type-check,
type fixtures and targeted lint passed. No new unit tests were added. One test
run failed before executing scenarios because concurrent Playwright runs cleaned
a shared output directory; sequential execution resolved this harness issue.

Private evidence: `.artifacts/r152/binding-home-20261002/` contains `e2e.log`,
`existing-binding-tests.log`, `binding-home-adoption-evidence.json`, the other
E2E artifacts, `source-sha256.json`, `verification.json` and generated Gateway/
Wallet Runtime configurations. Reproduce from `seams-monorepo`:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-binding-home-adoption.e2e.test.ts \
  relayer/tenant-deployment-binding.e2e.test.ts \
  relayer/namespace-home-activation.e2e.test.ts \
  relayer/namespace-home-provisioning.e2e.test.ts \
  relayer/namespace-d1-home.e2e.test.ts \
  relayer/console-service-auth.e2e.test.ts \
  --reporter=line --output=test-results/r152-binding-home
```

Limits: adoption uses a fixture readiness receipt in this test. Operator-driven
adoption still needs fresh production readiness, historical source-scope handling,
and successful canary verification. Old bindings fail ordinary decoding, so these
changes must not be deployed ahead of that coordinated adoption workflow.
Runtime comparison adds no D1 round trip, but trusts configured identity until
physical Worker binding/resource verification is implemented. Internal control
and inspection requests that run before binding resolution remain unmodified to
preserve custody bootstrap; discovery/admin paths and historical activation
attestation also need the full entry-point review. No deployment, hosted latency
measurement or provider API operation occurred.

## Operator home adoption (October 2)

Private source checkpoint: `seams-monorepo` commit `97e0426`. The explicit
`/internal/tenant-deployment/v1/adopt-home` route uses the existing protected
GitHub OIDC scope. The operator supplies the lane, stable operation ID and exact
previous revision/activation sequence. Console supplies the configured resource
and requires its immutable reservation. No client home override is accepted.

The replacement retains the original binding's custody, credential, policy and
surfaces. Production readiness checks them against current Console authority
and Wallet responses. Historical ownership scope is read from the persistence
boundary without decoding the old record as a runtime binding. Adoption still
verifies the historical canonical hash and columns before writing a replacement.
Pending retries refresh readiness; activation uses the existing transactional
compare-and-swap. Once active, every retry runs the canary again and verifies the
active pointer before and after it. Successful verification appends an audit
event. A canary failure returns an error while retaining the durable activation;
the same operation ID resumes verification without another activation.

The local E2E uses the actual Console Worker, all Console D1 migrations, durable
environment/credential/policy/root records, the production readiness adapter,
and the production HTTP canary client. A signed fixture JWT and controlled JWKS
exercise the OIDC gate. External root-status, runtime-inventory and canary
responses are controlled test boundaries; no cryptographic custody ceremony or
real hosted registration was performed.

Observed results:

- An unauthenticated adoption was rejected; adding a client home field was
  rejected before custody or runtime work.
- One reported in-flight ceremony blocked readiness and left the historical
  pointer at sequence 1. Clearing that condition allowed fresh readiness and
  exactly one activation to the deterministic replacement at sequence 2.
- An injected HTTP 503 canary failed visibly after activation. Retrying the same
  operation succeeded; repeating after a simulated lost success response ran the
  canary again. All three canary calls retained sequence 2 and one activation row.
- A new operation using the stale previous pointer was rejected before a canary.
  Original binding JSON stayed unchanged, one credential remained, and the
  Wallet dependency accepted only status/readiness operations.

Validation: **7 E2Es passed in 10.5 seconds**, all **8 existing binding tests**
passed, and both existing snapshot tests passed on a focused rerun (**1.5 seconds**).
The first existing-test run found a valid snapshot fixture missing the required
home introduced by the previous contract change; it now uses the shared home
builder. Server, Console-test and type-fixture checks, targeted lint and four CLI
boundary checks passed. No new unit tests were added.

Private evidence: `.artifacts/r152/operator-home-adoption-20261002/` contains
`e2e.log`, `existing-tests.log`, `snapshot-tests-rerun.log`,
`operator-home-adoption-evidence.json`, the other E2E evidence, CLI validation,
source hashes and verification metadata. Reproduce the new scenario:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-home-adoption-operator.e2e.test.ts \
  --reporter=line --output=test-results/r152-operator-adoption
```

The private operator runbook in `docs/refactor-127.md` documents:

```text
pnpm tenant:cutover adopt-home --lane production-testnet \
  --revision tdb_RECORDED_PREVIOUS_REVISION --activation-sequence 1 \
  --operation-id tco_STABLE_OPERATOR_OPERATION
```

This command requires the protected deployment workflow's OIDC token. The
automatic deployment job has not been changed to invoke it. Its current smoke
check runs before cutover and cannot decode a historical active binding with the
new contract, so coordinated rollout sequencing remains mandatory. Physical
Worker/database verification, hosted canary evidence and remaining entry-point
coverage are still open. The scope query replaces the prior readiness query and
adds no unlock/signing calls. No deployment, provider mutation or new hosted
latency measurement occurred.

## Provider binding checkpoint (October 2)

Private source checkpoint: `seams-monorepo` commit `877890d`. The new read-only
command uses the existing deployment target configuration:

```text
pnpm tenant:verify-d1-bindings --lane production-testnet \
  --output .artifacts/d1-binding-checkpoint-UNIQUE_RUN.json
```

With `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` set, it reads the current
Gateway and Wallet Runtime deployments, inspects `SIGNER_DB` on every serving
version, and compares the actual UUID to the lane's configured signer database.
It then rereads both deployments and rejects changes to deployment IDs, version
sets or traffic weights. The API token needs Worker deployment/version read
permissions. Calls use GET only, a fixed Cloudflare API origin, rejected redirects
and bounded request timeouts. The command does not query or mutate D1 data.

The success artifact records `provider_bindings_match`, the namespace/account/
database, serving deployment/version IDs and percentages. It always records
`runtimeChallengeVerified: false` and `activationAuthorized: false`. Unrelated
bindings and provider response bodies are excluded from success/failure evidence.
The output must be a new file; failed checks record failure and interrupted runs
retain a checking state. A repeated output path fails before making API calls.

The actual Node CLI E2E passed **ten provider scenarios in one 1.0-second run**:
matching two-version deployments on both writers; a wrong database only on the
minority Wallet Runtime version; missing and duplicate `SIGNER_DB` bindings;
a mismatched returned version ID; deployment ID drift; traffic-weight drift;
weights failing to total 100; invalid JSON; and provider HTTP 403. The matching 75%/25% case
made eight GETs: two initial deployments, four versions, two final deployments.
Only matching stable bindings produced a success checkpoint. Secret markers in
unrelated bindings and error bodies did not appear in artifacts. A retry with
the same output path made no additional requests or modifications.

Targeted lint, Console test type-check, and a direct Wallet Runtime renderer smoke
passed. The renderer still produces the expected Worker name and an identical
declared-home/database-binding UUID after its naming helper became importable.
An intermediate E2E rerun failed at test discovery because of Playwright's
required destructured fixture argument; correcting that test declaration restored
the passing run. No unit tests were added.

Private evidence: `.artifacts/r152/provider-bindings-20261002/` contains `e2e.log`,
`provider-binding-checkpoint-evidence.json`, the individual scenario artifacts,
the synthetic-account runtime configuration, source hashes and verification
metadata. Reproduce:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-d1-provider-bindings.e2e.test.ts \
  --reporter=line --output=test-results/r152-provider-bindings
```

The provider HTTP service was a controlled loopback fixture. No live Cloudflare
verification occurred: neither account ID nor API token was configured in the
execution shell. Live inventory, comparison with Console's immutable assignment,
a fresh challenge through each actual runtime binding, activation ordering and
other reachable older/internal writer paths remain open. This check observes
configuration during its window; it cannot prevent later privileged changes or
authorize regional rollout. No deployment or hosted latency measurement occurred.

Provider contracts checked October 2:
[deployment ordering and traffic versions](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/),
[version resource bindings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/),
and [D1 binding UUIDs](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/#bindings).

## Runtime home challenge and live provider check (October 2)

Private implementation: `seams-monorepo` commit `022e1a9`. Public signer migration:
`0040_namespace_home_challenges.sql`, SHA-256
`9b63d4b2841086bf96ec7bc23008b52036a0921344ea5575192122ae8340b580`.

The new operator command is `pnpm tenant:cutover verify-home --lane production-testnet`.
It writes a random five-minute challenge through the configured D1 provider UUID.
The OIDC-protected Console route compares its home to the immutable namespace
reservation, then verifies reads through the Gateway and Wallet Runtime bindings.
The private writer requests contain the challenge ID and namespace, excluding the
expected proof. The receipt excludes proof material and records
`activationAuthorized: false`. Cleanup deletes the exact challenge after success
or failure, including when an INSERT committed before its response was lost.
Process termination can leave an expired row, which is rejected by verification.
This operator-only path adds no unlock or signing database calls.

**Nine related E2Es passed in 19.9 seconds.** The new scenario bundles the actual
Console, Gateway and Wallet Runtime Workers and applies all forty signer
migrations to two real local D1 databases. Eleven rejection cases cover missing
authentication/reservation, public access, proof echo payloads, wrong database,
wrong configured home, wrong proof, expired/future validity windows, a stale
database copy and a deleted challenge. The actual operator CLI also completed a
successful verification and rejected a lost INSERT response; both records were
cleaned up, with two INSERTs and two DELETEs. No activation rows were created.
Provider HTTP transport in this E2E is a controlled loopback bridge to local D1.

Server, Console-test and type-fixture checks, targeted lint, renderer service-binding
checks and the Wallet bloat check passed. No unit tests were added. The E2E reads
the sibling Wallet checkout's migration sources and records their hashes; this
does not establish that the installed 0.7.3 package contains migration 0040.
Reproduce the new scenario from the private repository:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-home-challenge.e2e.test.ts \
  --reporter=line --output=test-results/r152-runtime-challenge
```

A separate **live read-only provider check passed at 2026-10-02 00:39:14.065 UTC
(09:39 JST)** for namespace `seams-production-testnet`. Saved Wrangler OAuth
credentials were available. The preceding report about absent shell variables
did not establish that credentials were unavailable. Credentials were captured
in memory for the child verifier; no token was printed or written to evidence.

Both Workers' actual `SIGNER_DB` bindings point to database
`dea0a6fe-4a0e-4893-8308-e8a06e12ee88` in account
`ba924da36f2ffc3839e8d323000b66b4`:

| Worker | Deployment ID | Serving version (100%) |
| --- | --- | --- |
| `seams-sdk-d1-gateway-testnet` | `2a1a2c0c-a84a-4f4e-90d9-d4d01826a3ee` | `7cd24b4c-f207-4525-842d-dfac9728e90b` |
| `seams-sdk-d1-wallet-runtime-testnet` | `51055c84-711d-43aa-bced-8a0957dbc0bf` | `5fe2f562-7652-4638-bb04-bd17c6bb1341` |

Deployment IDs, versions and traffic weights remained stable across the check.
The artifact keeps `runtimeChallengeVerified: false` and
`activationAuthorized: false`. This live check used provider GETs only. The new
challenge was exercised locally; no live D1 write, migration or deployment occurred.

Private evidence: `.artifacts/r152/runtime-home-challenge-20261002/` contains
`live-provider-testnet.json`, `runtime-home-challenge-evidence.json`, related E2E
receipts, `e2e.log`, generated Console configuration, `bloat.log`, source hashes
and verification metadata. There is no new hosted latency result.

Remaining rollout dependencies: publish and consume a new exact Wallet Server
release containing migration 0040; coordinate migration/service-binding/Worker
deployment and historical adoption; run the challenge live; join fresh runtime
proof and stable provider versions to activation; cover remaining writer paths.
Neither separate checkpoint establishes an activation fence, and a copied fresh
challenge alone does not establish physical database identity.

## Version-bound home checkpoint (October 2)

Private source checkpoint: `seams-monorepo` commit `5dca209`. The existing
`pnpm tenant:cutover verify-home --lane production-testnet` command now combines
the provider and runtime checks. It verifies actual provider D1 bindings, writes
a fresh challenge, checks the immutable Console reservation and both runtime
reads, then verifies provider bindings and deployment identity again. Each writer
reports its own `CF_VERSION_METADATA.id`; both must match the serving versions.
The final provider check must finish before the challenge expires. The generated
Gateway and Wallet Runtime configurations include the metadata binding described
in [Cloudflare's version metadata contract](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/).

The combined check requires one version at 100% per writer and rejects gradual
rollouts before a D1 write. The separate provider-only command retains support
for inspecting every gradual-rollout version. A successful combined run uses
twelve provider GETs, one challenge INSERT and one DELETE. Its redacted
`tenant_d1_home_checkpoint_v1` receipt records the provider check times, deployment
IDs, serving versions, answering versions and `runtimeChallengeVerified: true`;
`activationAuthorized` remains false. No unlock or signing call is added.

**Four related E2Es passed in 18.4 seconds**, covering the provider checker,
combined challenge, operator adoption and deployment binding. The combined
scenario uses production Worker sources, two local D1 databases with all forty
signer migrations, synthetic version metadata and controlled provider HTTP
transport. It rejects missing runtime metadata, a wrong answering version, a
deployment-ID change after the challenge, a serving-version change after the
challenge, and a gradual rollout. Existing proof/home/expiry/authorization checks
remain covered. The successful CLI case and four failure cases that write a
challenge leave zero challenge rows: five INSERTs and five DELETEs, including
the lost-INSERT-response case. Gradual rollout fails before inserting a row.

Server, Console-test and type-fixture checks, targeted lint, formatting, generated
version-binding checks and the Wallet bloat check passed. The first type-fixture
run correctly rejected a missing runtime version but reported its error on a
different line from the new `@ts-expect-error` comment; moving that comment fixed
the fixture. No production behavior was changed to accommodate it.

Private evidence: `.artifacts/r152/version-bound-home-20261002/` contains the
combined success receipt, repeatable runtime/provider/adoption/binding evidence,
`e2e.log`, generated writer configurations, bloat output, source hashes and
verification metadata. Reproduce the combined scenario with:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-home-challenge.e2e.test.ts \
  --reporter=line --output=test-results/r152-version-bound-home
```

No new live provider check, hosted challenge, deployment or latency measurement
was performed in this milestone. The October 2 09:39 JST live provider result
above remains the latest recorded live evidence. The next implementation binds
trusted evidence to a cutover operation, consumes it transactionally with
freshness/home/version checks, and enforces activated version identity at runtime.
Before/after provider reads alone cannot prevent a later privileged change.
The SDK migration release, coordinated deployment and hosted validation remain
open; this checkpoint does not yet gate the existing activation path.

## Activation consumption and runtime version admission (October 2)

Private implementation: `seams-monorepo` commit `a367716`. Both operator provisioning
and `adopt-home` now run combined home verification and submit the checkpoint to
the existing protected GitHub OIDC route. Console validates it at that boundary,
then carries a validated domain object into activation. The protected workflow's
cutover step receives the existing Cloudflare account/token secrets. No workflow
was dispatched and no credentials were printed or changed.

Console migration `0050_tenant_deployment_home_verification.sql` adds immutable
verification evidence to activation rows and a unique challenge-ID index. The
activation INSERT, existing active-pointer/cutover transition and proof consumption
share the transaction. The evidence names its reserved namespace/home, lane,
challenge, validity window and writer deployment/version IDs. Reusing the same
challenge for another operation fails. Expiry is checked in application code and
against SQLite's clock during insertion, conservatively requiring validity beyond
the current second. Exact completed activation retries still succeed after expiry
when their original evidence and active pointer match. Already active deployments
do not expire when the verification window ends.

Split Gateway requests and cron work, plus bound Wallet Runtime requests, report
their version metadata during Console admission. The existing binding query now
joins activation evidence and rejects unmatched or unattested versions. An index
supports that join. **No extra signing/unlock D1 roundtrip is introduced**; hosted
latency of the expanded query has not yet been measured. A new protected deployment
with unchanged wallet configuration refreshes activation while preserving its
canonical binding, custody and credential. Historical conversion remains confined
to the explicit adoption boundary.

Hosted onboarding can reuse an active deployment; it cannot create a new hosted
activation without the protected operator's verification. The local combined
development Worker retains its bootstrap authority through a distinct validated
local proof. SQL rejects that authority for production bindings; the hosted
operator boundary rejects local proofs and split runtime admission requires
Cloudflare evidence. The operator's JSON checkpoint is trusted through GitHub OIDC;
it is not a signed attestation issued by Cloudflare.

**Nine related E2Es passed in 21.9 seconds.** The extended challenge scenario runs
production Console/Gateway/Runtime sources with two real local D1 databases, all
forty signer migrations, synthetic version metadata and controlled provider HTTP.
It consumes the actual combined CLI receipt through activation, proves a second
operation cannot reuse it, verifies a completed retry after expiry, admits both
recorded writer roles, and rejects a Gateway running a different version. It also
rejects local verification for a production binding. Challenge cleanup still
records five INSERTs and five DELETEs across the successful and failed CLI cases.

The protected adoption E2E verifies failed-canary and lost-response retries without
reactivation, then performs a fresh same-binding operator redeploy. The latter
creates one additional activation, retains one credential and preserves the
original historical binding. The eight existing binding tests passed in 1.7 seconds.
Server, Console-test and type-fixture checks, targeted lint, formatting and the
Wallet bloat check passed. No new unit tests were added.

Two failures were resolved during development: a valid direct-SQL fixture needed
the newly required verification to reach its canonical-home assertion; the new
redeploy path initially routed canonical bindings through the historical decoder.
The latter was a production regression in the new code. The persistence boundary
now validates and reuses a canonical binding, and the redeploy E2E passes.

Private evidence: `.artifacts/r152/activation-verification-20261002/` contains
`e2e.log`, `existing-binding-tests.log`, challenge/adoption/binding receipts,
`activated-home-verification.json`, `combined-home-checkpoint.json`, bloat output,
source hashes and verification metadata. Reproduce the central flow:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-home-challenge.e2e.test.ts \
  relayer/tenant-home-adoption-operator.e2e.test.ts \
  --reporter=line --output=test-results/r152-activation-verification
```

This milestone is local verification only. No provider check, hosted challenge,
deployment or new latency measurement was performed. Remaining rollout work:
publish/consume the exact Wallet Server release with signer migration 0040; apply
Console migration 0050 through a coordinated deployment; revise the current
pre-cutover smoke ordering; run hosted verification/canaries; and review remaining
internal/control/admin writer paths. Older activations have no version evidence
and cannot admit updated split writers until a verified activation replaces them.
Runtime admission constrains these entrypoints; it cannot constrain privileged
replacement code that ignores the check.

## Coordinated deployment readiness (October 2)

Private commit `111e69e` updates the production-testnet deployment sequence. It
now requires the packaged signer
challenge migration before deployment authorization, deploys Console and Wallet,
obtains fresh combined verification, activates and runs the canary, then smokes
Wallet and Console. The backend child workflow is reusable only; standalone
Console dispatch offers the other lanes. Both production-testnet CLI authorities
select `deploy-live-demo.yml` and require `--environment-id`. Other lanes retain
their dispatch routes and still need their own operator activation integration.

Wallet readiness now requires a 2xx response. The former exception accepting
`503 tenant_deployment_unavailable` is removed. Existing propagation retries
remain. This sequence deliberately fails closed between writer deployment and
activation; it does not demonstrate zero-downtime rollout.

**Two E2Es passed in 22.8 seconds**, covering the three production Worker sources
and protected operator adoption. The extended challenge E2E invokes the production
readiness runner in a Node subprocess over a local HTTP bridge to the Gateway.
Before activation its public projection returns 503 and smoke fails. After fresh
verified activation the projection returns 200 and smoke passes. A changed Gateway
version refuses admission; the bridge represents the Worker exception as 500 and
smoke fails. This is local admission evidence with synthetic version metadata and
controlled provider HTTP, not a hosted Cloudflare status-code measurement.

The six remaining existing readiness tests passed in 559 ms. The retired
pre-binding-success test was removed because its invariant conflicts with the
new post-activation sequence. Four CLI dispatch scenarios passed using a captured
GitHub CLI transport, and both production-testnet authorities reject a missing
environment ID before dispatch. No GitHub workflow was dispatched. Actionlint,
targeted lint and Console-test type-checking passed. The E2E's initial direct
JavaScript import lacked a TypeScript declaration; invoking the production script
through Node resolved this test-harness issue without changing production types.

Static review of the canonical split entrypoints and pinned Wallet Server 0.7.3
finds that pre-admission challenge/readiness paths only read `SIGNER_DB`. Private
custody-control requests forward to authenticated custody service bindings without
accessing `SIGNER_DB`. Those bootstrap operations remain reachable before a first
activation. This review does not close privileged administrative writer coverage
or inventory historical deployed Workers.

Private evidence is retained in `.artifacts/r152/coordinated-rollout-20261002/`:
`e2e.log`, `existing-smoke-tests.log`, `activation-smoke-evidence.json`, combined
home and adoption receipts, `dispatch-evidence.json`, the repeatable CLI transport
check, and source hashes. Reproduce the composed acceptance flow:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-home-challenge.e2e.test.ts \
  relayer/tenant-home-adoption-operator.e2e.test.ts \
  --reporter=line --output=test-results/r152-coordinated-rollout
```

The installed 0.7.3 package lacks migration 0040 and cannot pass the new deployment
preflight. Publish/consume a new exact Wallet Server release before hosted rollout.
Console migration 0050, hosted verification/adoption/canaries, regional routing,
broader authenticated cohorts and migration/failure proofs remain outstanding.
No deployment, hosted challenge or new latency measurement occurred in this milestone.


The subsequent [packed Wallet Server acceptance](refactor-152-package-readiness.md)
records candidate packaging, migration integrity and consumer-upgrade verification.


## Ordinary writer admission coverage — October 2

The existing composed Console/Gateway/Wallet Runtime E2E now includes a changed
Wallet Runtime version alongside the changed Gateway version. After verified
activation, both stale versions receive POST requests for registration setup and
add-auth-method intent. All four calls reject with the specific runtime-version
admission error before parsing the deliberately malformed JSON body. A digest of
all signer application-table contents is identical before and after the probes;
SQLite and Cloudflare internal metadata tables are excluded. The same scenario
retains positive current-version admission and successful activated discovery.

The E2E passed in **14.0 seconds** against the extracted Wallet Server 0.8.0
candidate built from `94b4c98845c188f26403488fea757abf1421d845`. Console test type
checking, ESLint and formatting checks pass. No production source changed.
`stale-writer-admission.json` records the four paths and before/after digests,
retained with logs in private
`.artifacts/r152/release-0.8.0-protocol-20261002/`.

Two initial test-helper expectations were corrected: the schema scan attempted
to read protected Cloudflare metadata, and the rejection assertion expected an
HTTP wrapper rather than the exception propagated by the service binding. Both
are `valid_test_needs_update`; neither required a production change.

Reproduce from `seams-monorepo`:

```sh
SEAMS_WALLET_SERVER_CANDIDATE="$PWD/.artifacts/r152/release-0.8.0-protocol-20261002/package" \
  pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-home-challenge.e2e.test.ts --reporter=line \
  --output=test-results/r152-writer-admission
```

This is local request-admission evidence with synthetic version metadata. It does
not establish hosted HTTP error rendering, cron execution, in-flight mutation
fencing, custody/bootstrap ownership, privileged operator scripts or historical
Worker reachability. Those gates remain open. Exact candidate CI is still running;
Wallet has reached its production build, and Router entrypoint and Cloudflare
adapter jobs have passed. No publication, deployment or latency measurement was
performed during this follow-up.


## Scheduled writer admission — October 2

Private commit `2f204a9` extends the existing three-Worker acceptance scenario
with the real Gateway scheduled handler. Prewarm is enabled and its downstream
Router service is a controlled recorder. The activated Gateway completes its
cron event and sends exactly one authenticated POST to `/internal/prewarm`.
A Gateway with changed version metadata returns scheduled outcome `exception`
and sends no additional prewarm request. The signer application-table digest
remains unchanged across the ordinary stale-request and scheduled probes.

The composed E2E passes in **15.6 seconds** against the frozen `94b4c988`
Wallet Server candidate. Console type checking, ESLint and formatting pass.
The repeatable receipt `scheduled-writer-admission.json` records both scheduled
outcomes and the captured request, retained in private
`.artifacts/r152/release-0.8.0-protocol-20261002/`. Run the same candidate command
from the preceding section with `--output=test-results/r152-scheduled-admission`.

This closes local scheduled Gateway admission coverage. The controlled downstream
response does not exercise custody prewarm itself. Hosted cron, in-flight work,
privileged operator scripts, custody/bootstrap ownership and historical Worker
reachability remain distinct checks. Both candidate CI workflows are now green;
see the [publication handoff](refactor-152-release-review.md#green-candidate-ci-and-publication-handoff--october-2).
No hosted infrastructure or published packages changed.


## Automatic verified home assignment — October 2

Authenticated deployment verification now assigns a previously unassigned
namespace after both configured writers return the correct fresh D1 proof.
An existing conflicting assignment rejects before writer verification; an atomic
reservation resolves competing first assignments without moving an existing
home. A proof failure cannot reserve a resource. Ordinary wallet provisioning
continues to require that verified reservation before custody or credentials.

The composed E2E passes in **14.0 seconds** against the frozen 0.8.0 package.
Three concurrent first-time verification requests succeed against one immutable
home; unauthenticated, wrong-database, wrong-configuration, missing-version and
tampered-proof attempts leave the namespace unassigned. Existing activation,
replay and stale request/cron checks also pass. Receipt and logs are in private
`tests/test-results/r152-auto-home/` and
`.artifacts/r152/release-0.8.0-protocol-20261002/auto-home.log`.
This assigns the trusted configured resource; APAC/WEUR selection and complete
regional routing remain separate implementation work.

The unused combined hosted Wallet entrypoints were removed. Their active-binding
read did not enforce writer versions; deployment generation and readiness checks
already select the split Gateway/Runtime paths. A stale source assertion about
the deleted combined entrypoint was removed, and the existing readiness fixture
now names the supported Gateway. Server/Console type checks, ESLint and all eleven
existing readiness checks pass. An initial unit-config invocation selected no
tests because that config excludes script tests; the explicit base-config retry
ran the intended file successfully. No production failure was hidden by that
harness correction.

## October 3: setup reservation replay correctness

The per-wallet registration candidate now consumes the Console reservation and
persists an immutable setup snapshot in regional D1. The Console/D1 E2E verifies
three independently assigned wallet homes within one tenant, competing Workers,
lost replies, travel replay, wrong-resource rejection and changed-Origin conflict.
The public lifecycle E2E races initial setup calls, discards a response, completes
registration and signing, then checks replay after commit without resetting state.

This is local correctness evidence. No new geographic latency measurement or
hosted deployment occurred. The full evidence, repeat commands, limitations and
receipt hash are in [the October 3 release review](./refactor-152-release-review.md#october-3-authoritative-setup-admission-and-immutable-replay).
Regional dispatch, continuation admission and terminal reservation lifecycle
remain release gates.

## October 3: regional forwarding and terminal-state correctness

Local transport verification now spans three regional Workers and three distinct
signer D1 databases. Each independently assigned wallet's setup and continuation
reach its selected database despite another ingress region or later travel.
Concurrent replay, target outage, redirect rejection, a misdirected binding that
cannot forward again, and idempotent terminal-state reconciliation are verified.
The public lifecycle test also proves completed setup replay cannot recreate a
cleaned ceremony.

Final local E2E runtimes were 4.0s for the Console/transport scenario and 28.6s for
registration/signing. **No geographic latency measurement was taken.** The regional
fixture controls authentication and simulates custody effects. Hashes, commands,
evidence limits and the remaining deployment/shared-identity work are recorded in
[the transport checkpoint](./refactor-152-release-review.md#october-3-regional-transport-and-terminal-registration-checkpoint).

## October 3: deployment resource challenge checkpoint

Private implementation commit: `4acf5d2` on `dev`.

The private provider challenge now uses `resourceChallenge.ts`,
`tenant-resource-challenge.mjs`, `/internal/tenant-deployment/v1/resource-challenge`,
and the authenticated `verify-resource` endpoint/CLI operation. Operator cutover
accepts `resourceCheckpoint`; checkpoints identify a `resource`. The old challenge
paths and shapes have no compatibility handlers. Public signer migration 0042
renames the effective table to `deployment_resource_challenges` and replaces the
old index. The deployment workflow requires that migration in the consumed package.

The real Console/Gateway/Runtime Worker E2E proves two independently configured D1
resources for one namespace, rejects cross-resource proofs, and verifies no old
challenge table/index survives. Existing wrong-resource, stale-version, expiry,
one-use activation and lost-response cleanup checks pass. The E2E took 15.7s;
this is local test duration, with no geographic latency measurement. The test
uses simulated provider responses and source migrations from the candidate SDK.
It does not establish live Cloudflare allocation or regional-set activation.

The binding and directory/forwarding E2Es also passed. Candidate-backed server,
challenge E2E and resource type-fixture compilation passed; public bloat check
passed. The initial challenge harness build failure was classified
`valid_test_needs_update`: esbuild needed to preserve the Cloudflare runtime
module introduced by the named Gateway entrypoint.

Reproduce in `seams-monorepo`:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
  pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-home-challenge.e2e.test.ts --reporter=line
```

Private receipt: `.artifacts/r152/resource-challenges-20261003/`
`runtime-resource-challenge-evidence.json`; SHA-256 `a11656d781ea0b8f58eb52bfb69b0460f7f3f19cf59667d1395e6e955a2ed307`.

The singular deployment `home`, activation proof and renderer still need the
regional-set replacement. Shared locators, internal/deferred enforcement, expiry
reconciliation and composed hosted verification also remain. Nothing was deployed
or published; private package pins remain 0.7.3 and release 0.8.0 remains held.

## October 3: verified resource-set activation checkpoint

Private implementation: `af96653` on `dev`. The binding and its revision now identify
canonical `resources`, and activation persists one resource-verification set. Every
resource requires fresh Gateway/Runtime evidence; duplicate writer versions/names,
incomplete sets and reused challenges reject the whole activation. Runtime admission
matches the exact role/version/account/database tuple. Console requires its regional
catalog to match the active resource set before permitting wallet-home operations.
There is no singular binding/proof compatibility decoder.

Console migration 0054 retires old active pointers and pending cutovers for fresh
activation, preserves historical activation records and consumed challenge IDs, and
removes singular activation columns. A challenge-consumption failure rolls back the
whole activation, including pointer changes. The local migration rehearsal starts
with an existing activation and unfinished cutover and verifies those outcomes.
The migration has not been applied to hosted infrastructure.

The final three focused E2Es passed in **18.9s total**:

- Binding admission: three physical resources, six Gateway/Runtime versions, partial
  and duplicate proof rejection through both service and SQL paths, wrong-resource
  claims, partially reused challenge rollback, and completed-activation replay.
- Resource challenges: independent physical D1 proofs, stale writers, expiry and
  cleanup after a lost response. An altered regional catalog cannot reserve a wallet.
  The CLI challenges one resource; the other two activation proofs in this fixture
  use controlled provider evidence. This is not a deployed three-region proof run.
- Wallet directory and forwarding: regional concurrency, replay/travel, immutable
  reservations and terminal reconciliation continue passing.

Candidate-backed affected server compilation, all private type fixtures and both
activation/challenge E2E source checks passed, as did focused lint and the public
bloat check. A broader experimental test compilation exposed existing directory-test
DOM/Worker type conflicts, raw allocation fixtures and a retired `sqliteD1` import.
It did not pass; its diagnostics are retained separately. No new unit tests were
added. Changed retained fixtures reflect the new required resource/proof fields.

Reproduce in `seams-monorepo`:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
  pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-deployment-binding.e2e.test.ts \
  relayer/tenant-home-challenge.e2e.test.ts \
  relayer/wallet-home-directory.e2e.test.ts --reporter=line
```

Private receipts and compiler/lint logs:
`.artifacts/r152/resource-set-activation-20261003/`. Receipt SHA-256 values:

| Receipt | SHA-256 |
| --- | --- |
| `console-binding-evidence.json` | `39daf889f0c7ea448cb88ab333dae6d22d9e846e35c28bc533c3bf75bde5b5a6` |
| `runtime-resource-challenge-evidence.json` | `33a48e77c89858aeccbbce58ab9ba72039bda7b884d76f87396a2a8a097a3c5d` |
| `wallet-home-evidence.json` | `a597f9d13740b2b777adefb798d1184354e3ef0a094a9d9c383eb2dca14af439` |

These are local correctness results, with no new geographic latency measurements.
Remaining deployment work: regional target configuration/rendering, proof collection
for all backends, readiness inspection across regions, and admission renewal when
serving versions change. Shared credential/recovery/token locators, internal/Runtime/
deferred enforcement, expiry/fresh attempts and composed hosted/travel acceptance
also remain. No infrastructure was deployed or reset, and no package was published.
Private pins remain 0.7.3; release 0.8.0 remains held.

### October 3: deployment admission renewal

Private implementation commit: `20eb4aa` on `seams-monorepo/dev`.

The Console provisioner now renews exact writer-version admission on explicit
protected activation even when the tenant and URLs are unchanged. It keeps the
managed browser key, validates every resource proof, rechecks readiness, and runs
the registration canary after successful activation. Reuse-only onboarding leaves
the activation unchanged.

The new composed E2E uses production Console provisioning, key authentication,
root-state parsing, readiness, activation and audit services against migrated
local Miniflare D1 databases. It demonstrates:

- Six new Gateway/Runtime versions admitted; all six previous versions rejected.
- One browser credential retained across activation renewal; no silent key rotation.
- An incomplete resource-proof set rejected before activation.
- A Router status 503 leaves the existing activation usable; retry succeeds.
- Two attempts with a revoked credential fail and release the lane, without minting
  replacement credentials or moving the active pointer.
- A committed initial activation whose reply is lost retains its newly created key;
  subsequent reuse and renewal succeed.

The activation, challenge and renewal E2Es passed together in **23.9s**. After adding
the lost-activation-reply fault, the final renewal scenario passed in **8.7s**.
These durations describe local test execution. Candidate-backed server/type-fixture
compilation including the new E2E/helper and focused lint passed. Earlier documented
broad-suite limitations remain; this does not claim a full private-repository check.

Reproduce from `seams-monorepo`:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
  pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-deployment-renewal.e2e.test.ts --reporter=line
```

Retained receipt: `.artifacts/r152/deployment-renewal-20261003/deployment-renewal-evidence.json`.
SHA-256: `d8b232d65474ddeed1431fd2340453b0ca60494ad99f64b09dd4f98d42f1139b`.
Compiler/lint logs and the receipt index are in the same private artifact directory.

Provider proofs and Router status are controlled fixtures. The HTTP canary fixture
authenticates the real persisted browser key; it does not perform a wallet ceremony.
Regional Runtime readiness aggregation is still outstanding. No geographical latency
was measured and no infrastructure was deployed or reset. Regional rendering and
complete-set proof collection remain next; release 0.8.0 remains held.

### October 3: regional Runtime readiness

Private implementation commit: `0c4b923` on `seams-monorepo/dev`.

Readiness now requires the inspector's canonical resource set to match the candidate
binding exactly. Hosted Console composes `WALLET_RUNTIME_US`, `WALLET_RUNTIME_WEUR`
and `WALLET_RUNTIME_APAC`; each private Runtime inspection reports its physical
resource, which its client verifies. Namespace mismatches, invalid counts, stale
binding acknowledgments and resource mismatches fail. Runtime calls have a 15-second
timeout. Aggregation sums source wallets, target wallets and live ceremonies over
all resources; an unavailable region prevents readiness.

The existing renewal E2E now runs three production Runtime Workers against three
separate, fully migrated local signer D1 databases. Persisted occupancy fixtures
produce **3 source wallets, 6 target wallets and 1 live APAC ceremony**; the expired
WEUR ceremony is excluded. The APAC ceremony blocks renewal, as does an APAC transport
503 after the ceremony is cleared. Clearing both allows renewal with the same
browser credential. A cross-wired Runtime resource and incomplete inspector/candidate
coverage are rejected. Previous six-writer replacement, partial-proof, root outage,
revoked-key and lost-activation-reply assertions continue passing.

The binding, renewal/readiness and challenge E2Es passed: **3 tests in 45.5s**.
Candidate-backed server/type-fixture compilation including the changed E2Es/helpers
and focused lint passed. Existing unit fixtures were adapted to required resource
arguments; no unit tests were added or run. Earlier broad-suite limitations remain.

Reproduce from `seams-monorepo`:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
  pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-deployment-binding.e2e.test.ts \
  relayer/tenant-deployment-renewal.e2e.test.ts \
  relayer/tenant-home-challenge.e2e.test.ts --reporter=line
```

Private evidence: `.artifacts/r152/regional-readiness-20261003/deployment-renewal-evidence.json`.
SHA-256: `260c7e54fcc321810376e150bd85fe2b977631ba6d85950e8e979ca3c956c3bc`.
The same directory retains compiler/lint/test logs, compiler configuration and receipt
index. These are local correctness measurements. Occupancy rows, provider evidence,
Router responses and the authenticated HTTP canary are fixtures; no wallet custody
ceremony or geographic latency is measured.

Remaining deployment work is canonical regional configuration and binding generation,
plus complete-set operator proof collection. The current renderer does not emit the
required regional Runtime bindings; this checkpoint is not deployable by itself.
Shared locators, internal/deferred enforcement, expiry/fresh attempts and composed
hosted/travel acceptance remain. No deployment, reset or package publication occurred.

### October 3: regional resource-challenge routing

Private implementation commit: `51ddb3b` on `seams-monorepo/dev`.

The protected Console challenge request now requires `resource` alongside lane,
challenge ID and expected proof. After OIDC verification and boundary parsing,
Console matches the resource's namespace/account/database against its configured
catalog and selects the corresponding fixed Gateway/Runtime service pair. Both
writers must answer the same fresh challenge at the requested resource. Unlisted
resources, foreign namespaces, stale/missing versions and cross-resource proofs
fail. Console's singular Gateway challenge binding and D1-home environment fields
were removed; operator requests now send their resource explicitly. Provider-only
receipts also call this identity `resource`.

The challenge E2E now uses **one Console, three physical local signer D1s and six
Gateway/Runtime writer versions**. All three resources obtain independent runtime
checkpoints from the same Console. Swapping a challenge's resource, selecting an
unlisted resource or changing its namespace is rejected. Existing authentication,
expiry, provider-rollout, lost-insert-reply cleanup, activation and stale-writer
checks continue passing. The activation-store, provider-verification and expanded
challenge E2Es passed: **3 tests in 21.6s**. Targeted candidate-backed compilation,
type fixtures, lint and formatting passed.

Reproduce in `seams-monorepo`:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
  pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-deployment-binding.e2e.test.ts \
  relayer/tenant-d1-provider-bindings.e2e.test.ts \
  relayer/tenant-home-challenge.e2e.test.ts --reporter=line
```

Receipt: `.artifacts/r152/regional-resource-challenges-20261003/runtime-resource-challenge-evidence.json`.
SHA-256: `1bb4eb9351821bdcbf28a54ff64bea656498706ce73ad3a632434e444c0d7ab9`.
The directory also retains logs, compiler configuration and a receipt index.
This is local correctness evidence with controlled provider/OIDC fixtures. The CLI
still collects the lane's single configured resource; its activation fixture uses
controlled provider proofs for the other resources. This does not establish a
complete-set hosted operator run or geographic latency. Canonical regional target
configuration, generated regional bindings and complete-set operator collection
remain next. No deployment, hosted reset or package publication occurred.

### October 3: regional configuration and complete-set operator collection

The canonical Gateway deployment schema is now version 5: explicit US/WEUR/APAC
resources, an ingress region, and an allocated/pending signer-D1 branch. The
existing APAC resource IDs and public ingress names remain configured. US/WEUR
allocations remain pending in each lane; no new live UUIDs or allocations were
invented. These are configured placement hints, not a new provider locality
measurement. Schema 4 and singular signer-resource configuration are rejected.

The renderer requires `--region US|WEUR|APAC` for Gateway and Wallet Runtime and
renders one shared Console. All seven configurations receive the catalog; Console
receives six regional bindings, Gateways receive three named `WalletHomeGateway`
bindings, and each regional writer pair binds its own signer D1 with matching
placement. Only the ingress Gateway receives the public custom domain. Existing
shared/control Runtime calls retain the ingress Runtime pending their routing
refactor. Pending allocations block rendering, deployment preflight and proof
collection. Migration/deployment commands iterate all three signer resources and
writer pairs while retaining packaged migration fingerprint checks.

The operator now returns three fresh resource checkpoints. It checks serving
versions and physical bindings for all six writers before challenges, rechecks the
complete set after challenges, rejects any drift/expiry, and passes the full proof
array to protected activation. Every challenge is cleaned up, including an INSERT
that commits before its response is lost. A third-region lost-response scenario
verifies zero challenge rows remain in all three databases. The composed D1
activation test uses all three actual CLI-collected proofs; synthetic extra-region
activation proofs were removed.

Four focused E2Es passed in **22.6s**, covering seven rendered configurations,
pending-allocation refusal, provider binding failures/rollout drift, local
Worker/D1 challenges and complete-set activation. Targeted candidate-backed
TypeScript, lint and formatting checks passed. Ten existing deployment-target
behavior checks passed; an unrelated source-text guard expecting SES workflow
secrets still fails against the current Resend workflow and was left unchanged.
The old single-region placement test was replaced by the regional rendering E2E.

Repeat from the private repository:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/regional-deployment-config.e2e.test.ts \
  relayer/tenant-d1-provider-bindings.e2e.test.ts \
  relayer/tenant-deployment-binding.e2e.test.ts \
  relayer/tenant-home-challenge.e2e.test.ts --reporter=line
```

Evidence is retained in the private repository under
`.artifacts/r152/regional-deployment-set-20261003/`, including command logs,
`tsconfig.json`, deployment plan, receipts and `receipt-index.json`:

| Receipt | SHA-256 |
| --- | --- |
| `regional-deployment-config-evidence.json` | `062787fae71a892ba7fe84849aa090c86ecc470ff164fde6f601ede3e6c1f9f6` |
| `runtime-resource-challenge-evidence.json` | `88288f58f26b2e1ac5dcfa2e5a6888eff273315d32d26332a910e80811605bab` |
| `combined-home-checkpoint.json` | `a6914728dd3e29eabd5ef647c35732f240b8342d124e7beb7f335218c5a840f9` |

Provider HTTP and resource allocations are controlled test fixtures. These results
prove local composition and operator behavior; no hosted timing was measured.
Before hosted rollout, allocate/verify US and WEUR resources, bootstrap the new
service-binding targets, and inspect the frozen deployment plan. The ordinary
update order assumes targets already exist and does not bootstrap mutual service
bindings. Shared identity/session/recovery routing, internal/deferred enforcement,
expiry reconciliation and hosted travel/concurrency tests remain open. No remote
deployment, schema reset or package publication occurred; 0.8.0 remains held.

### October 3: opaque session and exchange routing evidence

The local three-region scenario passes using production authorization services,
Console directory handlers, regional dispatch, Worker transports and four separate
D1 databases. It verifies 12 digest-only locator rows, cross-region primary and
hosted credential routing, exactly one concurrent exchange winner, wrong-home
publication rejection, wallet/token mismatch rejection, publication failure before
local exchange commit, method retirement invalidating primary/child credentials,
and another device's session retaining access at the same wallet home. Unknown
credentials return 401 and a directory outage returns 503.

The fixture controls tenant writer admission and seeds canonical authority/auth
method records. Linked-device credential preparation and its local persistence
statements are exercised; complete browser registration, device installation,
signing execution and hosted geographic latency are outside this scenario.
Three existing directory/challenge/activation E2Es also pass in **25.3s**. SDK build,
public and candidate-backed private type checks, focused lint and bloat checks pass.

Repeat from the private repository:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
node tests/e2e/regional-session-routing.e2e.mjs

SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/wallet-home-directory.e2e.test.ts \
  relayer/tenant-home-challenge.e2e.test.ts \
  relayer/tenant-deployment-binding.e2e.test.ts --reporter=line
```

Evidence: `.artifacts/r152/session-routing-20261003/`, including logs, candidate
TypeScript configuration, bundled production source and
`regional-session-routing-evidence.json`. Receipt SHA-256:
`4046e52174715aff31d8ac19545db4adc4f7d4bbff32c518326c96fe2d36398f`.
The receipt includes the production bundle hash and contains no plaintext tokens.

Static statement counts for this added index: a successful lookup uses one joined
SELECT; new primary/exchange publication uses one conditional INSERT; hosted-child
publication uses one source lookup and one INSERT. These exclude writer admission,
existing local authorization statements and retry/conflict checks. Remote ingress
and the receiving Gateway each perform their own lookup. These are code-derived
counts, not measurements of total unlock/signing calls or network latency. The
planned operation-by-operation D1 budget analysis remains open.

Primary/exchange publication precedes local persistence; an unsuccessful local
commit can leave an inert locator. Child publication follows successful local
exchange consumption, before returning its token. If publication fails, no child
token is returned and a fresh exchange is required; the parent session survives.
There is no cross-D1 transaction. Expired locator metadata remains routable; only
home-local authorization can permit use. See the inventory checkpoint for the
remaining identity/lifecycle and hosted acceptance work. Release 0.8.0 stays held.

### October 3: direct Yao registration continuation routing

The private Gateway now resolves `/router-ab/ed25519/yao/registration/admit` from
`scope.lifecycle_id` and `/router-ab/ed25519/yao/registration/execute` from
`binding.lifecycle.lifecycle_id`. Both use the existing Console ceremony index
before regional service construction, including requests with the initial
registration credential. A supplied Wallet Session must name the same wallet as
the ceremony. The receiving Gateway repeats home resolution and rejects an
incorrect binding instead of forwarding again. Full request/proof validation
continues in the existing public registration handlers; the routing locator alone
confers no authority. No wire format or authorization policy changed.

The three-home directory E2E passed in 9.4s. Its controlled application/continuation
fixture records 12 effects (admit and execute, before and after establishment,
for each home) exclusively in the assigned D1. Malformed, unknown and cancelled
ceremonies, unavailable targets, misdirected bindings and a directory outage are
rejected before fixture effects. The production session-authorization composition
also passed, including six session/ceremony wallet disagreement rejections.
Candidate-backed TypeScript and focused lint pass. This verifies routing and local
composition; it does not execute Yao cryptography or measure hosted latency.

Direct Yao recovery/export routing, shared identity/recovery/delivery indexes,
Runtime/deferred enforcement, terminal expiry/fresh attempts, remaining cleanup
and hosted acceptance remain open. Release 0.8.0 remains held; no remote changes.

Repeat from the private repository:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/wallet-home-directory.e2e.test.ts --reporter=line

SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
SEAMS_TEST_ARTIFACT_DIR=.artifacts/r152/direct-registration-routing-20261003/session \
node tests/e2e/regional-session-routing.e2e.mjs
```

Use the established Playwright output directory for Worker startup, then retain
`wallet-home-evidence.json` with the logs in the checkpoint directory. A custom
output directory outside the test workspace was rejected by workerd before any
assertion; the normal output location passed without production changes.

Retained evidence: `.artifacts/r152/direct-registration-routing-20261003/`.

| Receipt | SHA-256 |
| --- | --- |
| `wallet-home-evidence.json` | `c823428edd8cf8c707cad44e4501d6869d4e8b64d9fe2fac8b3b30a7ea29f10f` |
| `session/regional-session-routing-evidence.json` | `0b99a92b16f6a3566df789af84867c6e3d34da0cd5217a6c98fe638a7388d634` |

Receipts include bundled production-source hashes. The earlier session-routing
receipt is preserved in its original directory. No new geographic timing is claimed.

### October 3: recovery routing and custody publication

The production session-routing composition now includes recovery with three home
D1s and one Console D1. Each home registers a canonical ten-code custody fixture
through `CloudflareD1WalletCustodyCommitStore.commitRegistration`, then rotates it
through the actual CAS store. Synthetic ciphertext is deliberately never decrypted;
this test owns persistence/routing and does not claim custody-ceremony verification.

Verified outcomes:

- Three code-only preparations routed from foreign ingress to the correct home.
- Fifteen operation continuations and nine administration requests used that home.
- Directory outages prevented registration/rotation commits; old local state stayed
  readable. Identical registration publication retries remained idempotent.
- Competing wallets claiming the same digest had exactly one winner. A mixed set
  with a conflicting code inserted none of its fresh claims. Wrong-home writers
  and wallet/session disagreement were rejected.
- Rotated code digests still selected their original home, whose actual locator
  store rejected the old code. Unknown and retired code responses matched.
- Recovery codes were absent from Console route rows. Existing session/exchange,
  linked-device, retirement and direct-registration scope scenarios still passed.

The operation fixture invokes the production operation publisher; its remaining
attempt/proof checks are controlled. It does not execute browser recovery, Yao,
provider identity verification or geographic travel. SDK build, public/private
candidate type checks (including invalid-state fixtures), lint and bloat checks
passed. Directory and resource-challenge E2Es passed in the broader composition
run; deployment-binding initially resolved the old installed package, then passed
in **5.2s** after its Worker bundler adopted the existing candidate-alias pattern.
The initial recovery fixture's byte length was corrected to the production constant.

Static added directory cost: one joined SELECT per lookup; a complete ten-code
publication is one service request and two D1 statements (conditional set INSERT,
then ownership verification). Operation publication uses the same two statements.
These exclude existing writer admission and all home-local work. A remote request
is looked up at ingress and again at the receiving Gateway. No hosted timing or
whole-operation D1 budget is inferred from these counts.

Repeat from the private repository:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
SEAMS_TEST_ARTIFACT_DIR=.artifacts/r152/recovery-routing-20261003/session \
node tests/e2e/regional-session-routing.e2e.mjs

SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  --tsconfig=/Users/pta/Dev/rust/seams-monorepo/.artifacts/r152/recovery-routing-20261003/tsconfig.playwright.json \
  relayer/wallet-home-directory.e2e.test.ts \
  relayer/tenant-home-challenge.e2e.test.ts \
  relayer/tenant-deployment-binding.e2e.test.ts --reporter=line
```

Retained evidence: `.artifacts/r152/recovery-routing-20261003/`, including logs,
`tsconfig.json`, `tsconfig.playwright.json`, the production bundle and receipts.
The Playwright configuration copies `tests/tsconfig.playwright.json`, sets its
baseUrl to the absolute tests directory and adds a cloud-host path to the exact
candidate's `dist/esm/cloud-host.js`; this aligns Node imports with Worker bundles
while private dependencies still pin 0.7.3. It changes no installed package.

Session/recovery receipt: `session/regional-session-routing-evidence.json`;
SHA-256 `e0049be9472103d6b256fb1e62b8c1cd3ca2bae470ec5a5402346172c716c104`.
Its production bundle hash identifies the tested code. Earlier receipts remain
in their original directories. No deployment, schema reset or publication occurred.

Code-route publication precedes the local custody batch; local failure can leave
inert metadata. Operation publication follows the existing code reservation and
precedes prepared-operation exposure. On publication failure the new explicit
routing error maps to HTTP 503, while the ordinary reservation timeout remains in
force. There is no distributed commit. See the inventory checkpoint for ownership,
reset coverage and remaining direct Yao/internal/shared-identity work.

### October 3: direct Yao wallet-identity entry routing

Local production Gateway dispatch and Console directory composition passed for
four entry routes across all three homes (12 route/home combinations). Every
request entered through a foreign region. Requests without a Wallet Session and
with the matching session reached the assigned home. Conflicting sessions returned
403; malformed wallet identities 400; unknown wallets 404; directory outages 503.
The existing recovery, session exchange, collision, retirement and publication
failure scenarios also passed. Candidate-backed private TypeScript and focused lint
passed. No public runtime code changed in this checkpoint.

The terminal Yao handler is a controlled 422 response identifying its region.
This receipt proves routing, not valid Yao proofs, execution, provider behavior or
hosted latency. Recovery execute/activate and export execute remain unimplemented
for opaque-lifecycle routing without a routable Wallet Session.

Repeat from `seams-monorepo`:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
SEAMS_TEST_ARTIFACT_DIR=.artifacts/r152/yao-entry-routing-20261003 \
node tests/e2e/regional-session-routing.e2e.mjs
```

Receipt: `.artifacts/r152/yao-entry-routing-20261003/regional-session-routing-evidence.json`.
SHA-256: `1d2058207f4a74d5d6a7cceaca30072cb3809556f778483a43a2524900dbb0aa`.
The receipt includes the production bundle hash and per-route regional observations.
Earlier evidence is preserved. No deployment, reset or release occurred.

### October 3: lifecycle locator continuation composition

The local three-region Worker/D1 scenario passed all nine continuation/home
combinations: recovery execute and activate, plus export execute for US, WEUR and
APAC wallets. The production publication helper, Console service/index and Gateway
dispatch were exercised. Identical retries succeeded, competing wallets had exactly
one claim winner, wrong physical writers and conflicting sessions were rejected,
and directory outages prevented publication and routing. Operation kinds retain
separate ID spaces. Direct SQL mutation was rejected; the retired table is absent.
The existing entry, session/exchange and recovery rotation/collision scenarios pass.

SDK build, public/private TypeScript (including locator construction fixtures),
focused private lint and public bloat checks pass. The persistent wallet-directory
E2E passed in 4.5s. Admission authorization and the terminal Yao handler in the
regional scenario are controlled; no full cryptographic execution, hosted latency,
provider verification or production rollout is claimed.

Repeat in `seams-monorepo`:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
SEAMS_TEST_ARTIFACT_DIR=.artifacts/r152/lifecycle-routing-20261003 \
node tests/e2e/regional-session-routing.e2e.mjs
```

Receipt: `.artifacts/r152/lifecycle-routing-20261003/regional-session-routing-evidence.json`.
SHA-256: `aa90355b518486b051499522389f1fc62cd89cb208ec15ca6ee05b4beb6fec77`.
The receipt records the tested bundle hash and regional observations. Publication
uses the existing conditional INSERT plus ownership-verification SELECT; lookup is
one joined SELECT, excluding writer admission. Foreign ingress and receiving home
each resolve the locator. These are static operation counts, not measured hosted
latency or complete D1-call budgets.

No infrastructure deployment, reset or package publication occurred. Remaining
shared-identity, linking, internal/deferred and terminal cleanup work still blocks
per-wallet completion and release 0.8.0.

# Regional D1 empirical results

Date: October 1, 2026. Status: repeated London ready-material and first-sign/burst
comparisons complete; Tokyo diagnostic blocked during infrastructure startup.

This log implements the bounded experiment in
[the ownership review](refactor-152-ownership-review.md) and preserves evidence
for [R152](refactor-152-regional-D1.md). The production ownership and rollout
gates remain open.

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

## Decision and remaining work

London provides sufficient measured benefit to continue regional ownership
**design**. Regional production activation remains gated on repeated first-sign/
burst samples, other-region evidence, authenticated Console/signing composition, and the
complete home/authority proof. Hosted NRT binding timing is now measured separately. The routing work should extend the existing
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

# Regional D1 empirical results

Date: October 1, 2026. Status: repeated London ready-material comparison complete;
immediate-first and burst diagnostic running.

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
  .artifacts/r152/combined-london-ready.json \
  .artifacts/r152/regional-d1-20261001-r1 \
  .artifacts/r152/regional-d1-20261001-r2
```

The next diagnostic uses the existing immediate-first/warm/concurrent-burst E2E
on fresh mixed wallets. It verifies five signatures per attempt, including one
untimed session setup signature and a two-signature burst consuming the last two
uses of a shared quota. Its evidence stays separate from the ready-material
linked-chain comparison.

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
  .artifacts/r152/regional-d1-20261001-r1/summary.json \
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

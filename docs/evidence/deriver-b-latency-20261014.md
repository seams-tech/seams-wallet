# Deriver B binding delay — October 14, 2026

The earlier comparison captured a substantial delay around B's D1 binding batch.
The same production path later completed in 12–21 ms without a code, binding, or
database change. The delay was transient or dependent on runtime conditions.
Its precise cause is unresolved. A database migration is not justified yet.

## Facts

| Fact | Instrument and scope | Result |
| --- | --- | --- |
| B was slower in all three comparison arms | Raw `bound_root_d1_timing`, `bind_registration` events | See table below |
| Each captured bind uses four statements | Production source and recorded statement count | One conditional update and three reads |
| Binding SQL is small | Hourly Cloudflare Query Insights for 05:00–05:59 UTC | Mean update time A 0.250 ms, B 0.278 ms; one row read and written |
| Objects were in Singapore | `wallet_do_host` records | All recorded locations SIN |
| Both current database primaries are in Singapore | D1 query metadata | SIN, primary, read replication disabled |
| Isolated writes are fast | Temporary Worker, alternating A/B operations, same one-row test schema | A 10 ms, B 12 ms median |
| Unchanged production can complete B's binding quickly | Three fresh registrations after the probe | B 21, 12, 20 ms; A 17, 11, 11 ms |
| The three live wallets work | Independent NEP-413 verification | Three valid signatures; altered signed fields rejected |

### Historical binding-batch spans

| Arm | A median | B median | Median paired B minus A | Paired samples |
| --- | ---: | ---: | ---: | ---: |
| Initial control | 8 ms | 108 ms | 99 ms | 11 |
| Combined candidate | 11 ms | 120 ms | 105 ms | 15 |
| Repeat control | 9 ms | 96.5 ms | 87.5 ms | 10 |

B's admission-read medians were 17, 17.5, and 19.5 ms. A has 42 bind records;
B has 36. Missing B records are 1, 3, and 2 by arm. There are no duplicate bind
keys. Each captured span is inside its arm's time window.

This other delay was present in every arm and varied between them. The small
comparison does not establish that the accepted optimizations were ineffective.
A constant shared cost alone would not erase a difference; the variation and
limited sample size prevent a precise attribution of small end-to-end changes.

## Probe and live control

The temporary Worker ran in Singapore and performed 120 D1 operations: 15 of
each operation against each database. It alternated database order. Each database
held one isolated diagnostic row. No wallet or custody record was read or changed.

| Probe operation, median | A | B |
| --- | ---: | ---: |
| Read | 10 ms | 11 ms |
| Update matching no row | 8 ms | 13 ms |
| Value-changing update | 10 ms | 12 ms |
| Update followed by three reads in one batch | 9 ms | 15 ms |

All operations succeeded. Metadata reported primary SIN and one attempt for every
statement. B had isolated 132 ms read and 347 ms batch outliers, so fast medians
do not establish an absence of tails.

The probe is not equivalent to the product. It uses direct `database.batch` in a
JavaScript Worker. The product uses a first-primary D1 session inside a Rust Durable
Object, with a different table and concurrent work. The probe alone cannot locate
the historical cause.

The subsequent three-registration control closes the production-path gap: it uses
the original Deriver versions, database IDs, and four-statement bind path. The
historical 100 ms floor was absent. The sample is too small to establish lasting
recovery. One B admission read still took 118 ms.

## Instrument limits and causes

The role span uses `worker::Date` around `session.batch().await`. It includes
conversion, waiting, and execution resumption. It does not separate transport,
database service time, durable confirmation, and scheduling. A's background
preparation reports zero for 39 of 42 batches despite real database work. Those
zeros are not evidence that preparation is free.

Cloudflare states that [Worker clocks advance on I/O](https://developers.cloudflare.com/workers/runtime-apis/performance/).
Its [D1 SQL duration](https://developers.cloudflare.com/api/resources/d1/) excludes
network communication. The hourly SQL data has counts of 32 A updates and 19 B
updates; it is not an exact join to the captured batches.

| Proposed cause | Evidence | Status |
| --- | --- | --- |
| Persistent slow SQL or missing index | Single-row binding update averages below 0.3 ms; unchanged live path later runs quickly | Unsupported as the persistent cause |
| Permanent wrong region | Recorded objects and current database primaries are SIN | Unsupported |
| Permanent 100 ms floor on B's database | Isolated writes and the unchanged live bind path run in 12–21 ms | Contradicted |
| Temporary database write/transport delay | Compatible with historical write/read asymmetry and later recovery | Possible, not established |
| DO scheduling, storage gates, or competing work | Standalone probe differs; production timer includes await/resumption | Possible, not established |
| Clock attribution | Some real work measures zero; recorded spans do not isolate database time | Unresolved contributor |

No provider-internal confirmation or queueing cause is claimed. No support ticket
was opened. An independent reviewer reproduced the counts and challenged the
initial database-specific interpretation.

## Fix decision

Keep the current database while the production path is fast. Keep the accepted
call consolidation. Do not disable required durable claims or change cryptography
in response to this observation.

If the slow interval recurs, capture the real batch's SQL metadata, Worker wall/CPU
time, and a same-window probe using the production first-primary session. Separate
promise settlement from Rust continuation and preceding CPU. This distinguishes a
database-specific delay from the surrounding runtime before choosing a fix.

- A persistent B-only slowdown in the matched database probe would justify testing
  a fresh Singapore D1 and preparing a data-preserving migration.
- Normal database timing with delayed DO execution would justify removing the
  demonstrated competing work or unnecessary storage boundary.
- A remaining service-internal delay needs Cloudflare's telemetry. The user can
  send the sanitized evidence if it recurs.

## Cleanup and records

Both diagnostic tables and the temporary Worker were deleted. Deriver versions and
bindings are unchanged. No database was created or migrated. The only product
traffic was three fresh staging registrations and signatures.

Private raw records and scripts:
`seams-monorepo/.artifacts/deriver-b-latency-20261014/`.
Key files are `historical-summary.json`, `historical-events.json`, the two query
insight files, `probe-summary.json`, `probe-run-*.json`, `cleanup.json`, and
`live-registration/`. `fold.py` reproduces the historical comparison. The copied
NEP-413 verifier reproduces the three signature checks.

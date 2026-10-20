# Refactor 150 cost analysis

Date: September 24, 2026

This analysis estimates the Cloudflare hosting cost of moving wallet-local state
from D1 into the role-separated, SQLite-backed Durable Objects described in
[Refactor 150](./refactor-150-regional-wallet-home-lanes.md). It uses a workload of
20 completed transactions per active wallet per week and Cloudflare's published
Workers Paid pricing on the date above.

The expected result is cost comparable to the current D1 architecture. SQLite row
operations largely replace existing D1 row operations, Durable Object storage is
less expensive per GB above the included allocation, and the new request and
duration charges are fractions of a cent per active wallet under the modeled
traffic. This remains a projection until the representative DO path measures its
actual request fan-out, active duration, retries, background work, and stored data.

## Architecture being costed

This estimate assumes that wallet-local state moves into its owning role store:

| Role | Wallet-local authority |
| --- | --- |
| Router coordination | Operation lifecycle, command admission, idempotency, and coordination records |
| Deriver A | A-private custody and protocol state, replay protection, and reservations |
| Deriver B | B-private custody and protocol state, replay protection, and reservations |
| SigningWorker | Protocol material, presignature lifecycle, and consumption records |

D1 remains available for shared configuration, identity indexes, tenant quotas,
reporting, and cross-wallet invariants. Each wallet-local record has one authority.
The estimate excludes a DO-to-D1 write-through arrangement and excludes permanent
dual writes because both would increase cost and preserve the remote storage
latency that R150 is intended to remove.

Existing D1-backed wallets remain on their current authority until the separately
reviewed conversion process moves them. During a cohort rollout, the account will
temporarily pay for both backend populations, while each individual wallet still
has only one writable authority.

## Current Cloudflare rates

The following Workers Paid rates are taken from Cloudflare's published
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
They must be refreshed before a production cost decision.

### Durable Object compute

| Meter | Monthly allocation | Overage |
| --- | ---: | ---: |
| Requests and RPC sessions | 1 million | $0.15 per million |
| Duration | 400,000 GB-s | $12.50 per million GB-s |

Every RPC method call on a Durable Object stub is a billable RPC session. Duration
uses wall-clock time while an object is active and is charged at the allocated
128 MB, or 0.125 GB, per object. Idle objects eligible for hibernation do not incur
duration charges. Cloudflare rounds usage above an allocation up to the next
million-unit billing increment.

The existing Workers Paid subscription has a $5 monthly account minimum and
already includes Durable Objects. R150 does not introduce a second base
subscription on an account that already uses Workers Paid.

### SQLite and D1 storage

| Meter | DO SQLite allocation and overage | D1 allocation and overage |
| --- | ---: | ---: |
| Rows read | 25 billion, then $0.001/million | 25 billion, then $0.001/million |
| Rows written | 50 million, then $1.00/million | 50 million, then $1.00/million |
| Stored data | 5 GB, then $0.20/GB-month | 5 GB, then $0.75/GB-month |

Moving an equivalent indexed query or mutation from D1 to DO SQLite therefore
has comparable row-operation pricing. Query plans, indexes, metadata, retries, and
schema shape can change the actual row counts and must be measured. Storage moved
from D1 to DO SQLite has a lower published overage rate, although per-object SQLite
database overhead adds some storage.

Calling Worker request and CPU charges continue to apply. Most Gateway and service
Worker traffic already exists in the current path, so the rollout must measure the
net change rather than assign the entire Worker bill to R150.

## Workload and model

Twenty transactions per week is approximately 86.7 transactions per active wallet
per month:

```text
20 transactions/week * 52 weeks/year / 12 months/year = 86.7 transactions/month
```

The cost model uses two implementation-dependent quantities:

- **DO calls per transaction:** all billed requests or RPC sessions across Router,
  Deriver A, Deriver B, and SigningWorker.
- **Aggregate object-seconds per transaction:** the sum of active wall-clock time
  across every role object. Two objects active for one second each consume two
  object-seconds even when they run concurrently.

For one active wallet, before account-level allocations and billing rounding:

```text
monthly requests = 86.7 * DO calls per transaction
monthly duration GB-s = 86.7 * aggregate object-seconds * 0.125 GB

request cost = monthly requests * $0.15 / 1,000,000
duration cost = monthly duration GB-s * $12.50 / 1,000,000
```

Three scenarios bracket a plausible implementation. They are modeling inputs,
not measured R150 results.

| Scenario | DO calls per transaction | Aggregate object-seconds per transaction | Monthly DO requests per active wallet | Monthly duration per active wallet |
| --- | ---: | ---: | ---: | ---: |
| Efficient | 4 | 2 s | 347 | 21.7 GB-s |
| Expected | 8 | 5 s | 693 | 54.2 GB-s |
| Conservative | 12 | 20 s | 1,040 | 216.7 GB-s |

At published marginal rates, before allocations and rounding, the resulting DO
request and duration cost is:

| Scenario | Monthly cost per active wallet | Cost per completed transaction |
| --- | ---: | ---: |
| Efficient | $0.00032 | $0.0000037 |
| Expected | $0.00078 | $0.0000090 |
| Conservative | $0.00286 | $0.0000330 |

Even the conservative case is about 0.29 cents per active wallet per month. These
figures exclude row operations and stored data because those depend on the schema
and largely replace existing D1 usage.

## Account-level examples

The following estimates apply the monthly Durable Object request and duration
allocations and Cloudflare's million-unit overage rounding. They show incremental
DO compute cost and exclude the existing $5 Workers Paid minimum, storage, calling
Workers, logs, and any current D1 cost displaced by the move.

| Monthly active wallets | Efficient | Expected | Conservative |
| ---: | ---: | ---: | ---: |
| 1,000 | $0.00 | $0.00 | about $0.15 |
| 10,000 | about $0.45 | about $13.40 | about $26.50 |
| 100,000 | about $30.10 | about $85.35 | about $290.45 |
| 1,000,000 | about $326.90 | about $778.95 | about $2,868.35 |

Billing increments create visible steps at smaller scale. For example, crossing the
included duration allocation by a small amount creates the first $12.50 duration
charge. At larger scale the average converges toward the per-wallet marginal cost.

## Dormant-wallet storage

An inactive Durable Object receiving no requests has no duration charge when it is
eligible for hibernation. Its persistent data continues to incur storage usage.

Cloudflare documents an empty SQLite database at approximately 12 KB. Four empty
role databases therefore establish a rough 48 KB minimum per wallet:

| Provisioned wallets | Approximate empty-database storage | DO storage overage after 5 GB |
| ---: | ---: | ---: |
| 100,000 | 4.8 GB | approximately $0/month |
| 1,000,000 | 48 GB | approximately $8.60/month |

Real wallets will use more space for protocol material, operation outcomes, replay
state, and indexes. As an illustrative upper workload input, 250 KB across all role
stores would consume about 25 GB for 100,000 wallets and 250 GB for one million
wallets. At the published DO storage rate, those totals would cost approximately
$4 and $49 per month after the 5 GB allocation. Actual bytes must come from the
representative implementation.

## Why the total should remain comparable

R150 adds Durable Object request and duration meters. Several factors offset or
limit that increase:

1. Wallet-local DO reads and writes replace D1 operations with the same published
   row-operation allocations and overage rates.
2. DO SQLite storage has a lower published overage price than D1 storage.
3. Objects scale to zero between sparse wallet operations when they can hibernate.
4. Twenty transactions per week creates hundreds, rather than millions, of DO
   calls per active wallet each month.
5. Moving mutations beside their authoritative storage should remove remote D1
   waits and some calling Worker execution.

The result is expected to be close to the current hosting cost at this workload.
It is not an assertion that the current and future invoices will be identical.
Current D1 metrics, calling Worker usage, retry rates, and real DO active duration
are required for an invoice-level comparison.

## Cost risks and controls

| Risk | Required control |
| --- | --- |
| DO handlers wait through long peer, client, or chain operations | Persist a durable claim, end the local mutation promptly, and resume through an explicit continuation where the protocol permits it |
| Outbound connections or WebSockets prevent hibernation | Avoid persistent outbound connections; use the WebSocket Hibernation API where a socket is required |
| Excessive role-to-role RPC fan-out | Measure calls per completed signature and combine calls within one role where doing so preserves custody and lifecycle boundaries |
| Retry storms multiply requests and duration | Preserve idempotent operation identities, committed outcomes, and bounded retry policy |
| Presignature refill or alarms dominate quiet-wallet cost | Measure alarms and background work separately; refill only against demonstrated inventory policy |
| DO and D1 both remain writable for wallet-local state | Enforce one authoritative store and remove temporary conversion paths after their final dependent wallet moves |
| Poor queries scan or rewrite many rows | Add indexes from measured access patterns and track rows read and written per operation |
| Four role stores duplicate large shared records | Keep tenant-wide and cross-wallet data with its shared authority; store only role-owned state locally |

These controls also support the latency objective. In particular, keeping a DO
request active throughout a multi-second network exchange increases duration cost
and weakens the benefit of local transactional storage.

## Measurement and release gate

The representative Phase 1 implementation must report, per completed registration
and signature:

- DO requests and RPC sessions by role.
- Active wall-clock duration and CPU time by role, with network waits identified.
- SQLite rows read and written by operation and index.
- Stored bytes per role and per wallet after registration and steady-state use.
- Retry, response-loss, alarm, and presignature-refill activity.
- Calling Worker requests and CPU time.
- The equivalent current D1 and Worker metrics for the matched baseline.

Project monthly cost at explicit active- and dormant-wallet counts using the same
account-level allocations and billing rounding as the real Cloudflare account.
Run the comparison for cold and warm objects and for representative North America,
Europe, and Asia Pacific traffic.

Proceed from the representative path to the managed new-wallet cohort only when:

- wallet-local state is authoritative in DO SQLite with no hidden D1 dual writer;
- measured cost per successful signature remains within the product's approved
  cost ceiling;
- retries and background work do not dominate normal signing cost;
- latency, correctness, custody isolation, and restart safety pass the R150 gates;
  and
- the projected total includes dormant-wallet storage and existing-wallet backend
  retention during rollout.

The new-wallet cohort then validates the projection against actual Cloudflare
billing metrics before broader conversion. Existing-wallet conversion remains a
separate decision and must include the temporary retention cost of the old D1
authority and its backups.

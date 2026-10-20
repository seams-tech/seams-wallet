# Wallet storage portability

The role store now separates transaction requirements from D1 execution.
PostgreSQL support remains unimplemented and untested.
This preparation changes no database schema, stored record, or deployment.

The target is standard PostgreSQL, with AWS RDS or a serverless PostgreSQL provider as deployment choices.
Keep provider credentials, connection setup, TLS, and pooling at the host boundary.
Keep SQL, migrations, and transaction behavior independent of the hosting provider.
The current change removes one D1 dependency. It does not establish a working PostgreSQL backend.

[`RoleSqlSessionV1`](../crates/router-ab-cloudflare/src/tenant_root_role_sql.rs)
defines the transaction contract.
`statement.expect_changes(1)` requires exactly one affected row before commit.
A mismatch must roll back every write in the transaction.
CAS means compare-and-swap: a mutation succeeds only while its stored revision or state matches the expected value.

The [D1 driver](../crates/router-ab-cloudflare/src/tenant_root_role_sql/d1.rs)
adds the existing constraint guard immediately after each guarded mutation.
SQLite's `changes()` reports the preceding mutation's affected rows.
The guard violates an existing primary key when the count differs.
[SQLite documents this count](https://www.sqlite.org/lang_corefunc.html#changes).
[D1 documents rollback of the whole batch on statement failure](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
The driver removes guard results before it returns one outcome per requested statement.

Lifecycle code no longer constructs guard SQL or accounts for guard result positions.
This uses the existing session interface and its existing D1 implementation.
It adds no backend selector, compatibility path, query translator, or PostgreSQL dependency.

The SQL and schema still need these changes:

| Current dependency | PostgreSQL work |
| --- | --- |
| SQLite `?1` placeholders and text/null parameters | Use PostgreSQL `$1` parameters and explicit parameter types. Audit repeated parameters and numeric comparisons. |
| SQLite `INTEGER`, text-to-number conversion, and `CAST(... AS INTEGER)` | Use `BIGINT` for millisecond timestamps and other existing `i64` fields. Preserve range checks and row decoding. |
| `INSERT OR IGNORE` and untargeted conflict handling | Choose explicit uniqueness conflicts. Preserve replay behavior and distinguish other constraint failures. |
| SQLite trigger bodies, `RAISE(ABORT)`, role checks, and partial indexes | Port the constraints and triggers. Retain retirement barriers and role isolation. |
| `changes()` and the guard table | Check each command's affected-row count inside the transaction. Roll back on mismatch before `COMMIT`. |
| D1 result metadata and JSON row decoding | Map rows, nulls, integers, affected-row counts, and database errors at the driver boundary. |

PostgreSQL documents [parameter positions](https://www.postgresql.org/docs/18/sql-prepare.html),
[integer ranges](https://www.postgresql.org/docs/18/datatype-numeric.html), and
[affected-row counts](https://www.postgresql.org/docs/18/sql-update.html#SQL-UPDATE-OUTPUTS).
An update that affects zero rows is a successful SQL command.
The driver must convert a failed row-count requirement into a transaction failure.

Atomic commit alone cannot preserve the store's read behavior.
`bound_share.rs` reads the admission, requested epoch, and active roots in one transaction.
Those reads must share one snapshot and see earlier writes in that transaction.
PostgreSQL's default Read Committed level gives successive queries separate snapshots.
Repeatable Read preserves a snapshot but permits serialization anomalies.
Serializable transactions prevent those anomalies and can require retries.
These distinctions follow the [PostgreSQL isolation contract](https://www.postgresql.org/docs/18/transaction-iso.html).

A future implementation should start with Serializable transactions and bounded retries for retryable database failures.
Retry the complete transaction with the same operation identity.
Reconcile domain conflicts and uncertain commit outcomes through the existing durable replay records.
Do not repeat external signing, backup, or peer effects inside a database retry.
Any weaker isolation design needs equivalent locks and concurrency evidence.

Preserve these boundaries during the port:

- Keep Deriver A and B in separate credential and storage boundaries.
  One session must never access both roles' shares or wrapping keys.
- Preserve primary reads for admission and lifecycle decisions.
  The current D1 constructor uses `FirstPrimary`.
- Keep cancellation, settlement, retirement, and replay writes subject to their current state predicates.
  Port the retirement triggers that reject late inserts and updates.
- Preserve encrypted record bytes, authenticated metadata, and protocol domain strings.
  A database move does not authorize changes to those formats.
- Check commit durability, lost-response reconciliation, restart recovery, and backup restoration on the actual PostgreSQL implementation.
  Local Workers tests cannot establish RDS durability or failover behavior.

This interface covers only the Rust tenant-root role store.
Gateway stores under `packages/wallet-server/src/router/cloudflare/d1` remain a separate port.
Their migrations live under `packages/wallet-server/migrations/d1-signer`.
They also use SQLite JSON functions, scalar `MAX`, time functions, conflict rules, and row-count guards.
Audit registration, authorization, custody commits, OTP consumption, and relocation transactions together with their schemas.
SigningWorker persistence, Durable Objects, R2 backups, and private Console stores require separate implementation work.

Use these implementation gates to establish a viable migration path:

| Gate | Deliverable and acceptance condition |
| --- | --- |
| PostgreSQL role store | Implement its schema, typed parameters, row decoding, and transaction execution together. Replace SQLite SQL explicitly. Avoid a general SQL translator. |
| Real database evidence | Run admission races, checkpoint rollback, restore, cancellation, and retirement against an actual PostgreSQL instance. Add restart and uncertain-commit cases. |
| Provider access | Run the same checks through the selected provider's actual connection or transaction API. Require atomic multi-statement transactions and the chosen isolation guarantees. |
| Remaining persistence | Port Gateway and Console transactions with their constraints. Inventory SigningWorker storage separately. Track each store until its lifecycle scenarios pass. |
| Cutover readiness | Rehearse schema creation, data import, integrity checks, write fencing, and recovery in an isolated environment. Decide production cutover only after that evidence exists. |

A serverless access method must keep all statements inside the same database transaction.
Separate query requests do not satisfy this requirement by themselves.
Test connection pooling, transaction retries, and uncertain commits through the exact access method that deployment will use.
Keep a second provider possible through that same PostgreSQL implementation.
Provider-specific services must not become requirements inside lifecycle code.

Storage portability and runtime portability are separate work.
Replacing D1 does not replace Workers service bindings, Durable Object coordination, or R2 storage.
Those dependencies need their own replacement plan if the runtime must also leave Cloudflare.

Repeat the local evidence from the repository root:

```sh
ROUTER_AB_WORKER_BUILD_PROFILE=dev pnpm build:workers
ROUTER_AB_WORKER_BUILD_PROFILE=dev node crates/router-ab-cloudflare/scripts/test-private-d1.mjs --admission-races
ROUTER_AB_WORKER_BUILD_PROFILE=dev node crates/router-ab-cloudflare/scripts/test-private-d1.mjs --refresh-after-managed-restore
ROUTER_AB_WORKER_BUILD_PROFILE=dev node crates/router-ab-cloudflare/scripts/test-private-d1.mjs --do-admission-settlement
ROUTER_AB_WORKER_BUILD_PROFILE=dev node crates/router-ab-cloudflare/scripts/test-private-d1.mjs --retirement-trigger
pnpm report:bloat --check
```

The admission scenario includes a zero-row checkpoint after an earlier pending-share insert.
It checks rollback, retry, and replay of the same operation through the Rust Workers.
Results and source hashes are in [the saved evidence](evidence/storage-portability-20261021.json).
Run equivalent scenarios against PostgreSQL before claiming support.

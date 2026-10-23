# Wallet storage portability

The native PostgreSQL role-store backend passes E2E tests against real local PostgreSQL 18.6
and against Amazon RDS for PostgreSQL 18.6.
The adapter also compiles for Workers and passes a local transaction E2E through workerd and Workers sockets.
The same tenant-root lifecycle code also runs on D1.
Gateway, Console, SigningWorker, Durable Object coordination, and backup services retain their existing storage implementations.

[`PostgresRoleSqlSessionV1`](../crates/router-ab-cloudflare/src/tenant_root_role_sql/postgres.rs)
implements the existing `RoleSqlSessionV1` contract.
Enable the Rust `postgres` feature on native hosts.
Enable both `postgres` and `workers-rs` for `wasm32-unknown-unknown`.
The host supplies a connected `tokio_postgres::Client` and the expected Deriver role.
Connection setup, credentials, TLS, pooling, and the connection task belong to the host.
This boundary uses standard PostgreSQL connections and has no RDS or serverless-provider API dependency.

```rust
let session = PostgresRoleSqlSessionV1::new(
    client,
    CloudflareTenantRootDeriverRoleV1::DeriverA,
).await?;
let store = TenantRootRoleShareStoreV1::new(session, key_config, &encoded_private_key)?;
```

Keep the client's connection task running for the session's lifetime.
Use verified TLS for remote connections.
A serverless provider must expose PostgreSQL connections with full multi-statement transaction support.
The schema requires PostgreSQL 16 or later for its standard SQL JSON checks.
An HTTP-only query endpoint needs a separate transaction-capable adapter and equivalent E2E evidence.

The PostgreSQL driver enforces these transaction rules:

- Send each batch in one PostgreSQL Query message, including standalone reads.
  PostgreSQL executes the message as one implicit Serializable transaction.
- Execute every supplied statement in order.
- Require each `expect_changes(count)` mutation to affect exactly that many rows before commit.
  Roll back every earlier write if the count differs or a statement fails.
- Return one outcome per supplied statement after commit.
- Use one coherent read snapshot, including the transaction's own earlier writes.
- Retry the complete transaction for PostgreSQL serialization failures and deadlocks, with at most three retries.
  Reuse its original statements and bound values.
  Release the session lock before each retry delay.
- Return transport and uncertain commit errors to the caller.
  Reconcile those outcomes through durable command replay instead of repeating external effects.
- Set the transaction's schema path and `synchronous_commit` explicitly.

PostgreSQL documents [Serializable isolation and required transaction retries](https://www.postgresql.org/docs/18/transaction-iso.html).
PostgreSQL documents [atomic execution of multiple statements in one Query message](https://www.postgresql.org/docs/18/protocol-flow.html#PROTOCOL-FLOW-MULTI-STATEMENT).
The driver checks [affected-row counts](https://www.postgresql.org/docs/18/sql-update.html#SQL-UPDATE-OUTPUTS) before commit.
A successful SQL command that affects zero rows can still fail a domain requirement.

Shared lifecycle statements now use PostgreSQL `$1` parameter positions and `BIGINT` casts.
The D1 driver converts numbered parameter markers to SQLite `?1` markers at its execution boundary.
This conversion preserves quoted literals and repeated positions.
The PostgreSQL driver uses the upstream `postgres-protocol` literal encoder for text parameters because the Simple Query protocol has no separate bindings.
It preserves nulls, repeated positions, unused positions, and quoted SQL literals.
The E2E tests include quotes, backslashes, SQL control text, and Unicode with `standard_conforming_strings` disabled.
The source-retirement insert uses an explicit uniqueness conflict target.

The PostgreSQL driver wraps reads in JSON results to preserve field types.
For mutations, a common table expression (CTE) returns affected rows to a server-side count check.
The check raises an error before the implicit commit if the count differs.
The batch needs no separate requests to prepare SQL, set options, start a transaction, or commit.
It uses no persistent prepared statements or provider-specific pooling behavior.

Epoch swaps retire the current row before activating its successor.
Both mutations and the command checkpoint commit in one transaction.
This ordering preserves the unique active-root index without relying on physical row update order.
The managed-restore forward refresh uses the same transaction helper.

The [PostgreSQL schema](../crates/router-ab-cloudflare/migrations/postgres/0001_role_store.sql)
contains the current tenant-root role tables and their constraints.
It uses `BIGINT` for existing 64-bit fields, checks JSON text, and preserves retired-lineage write barriers.
Encrypted records retain their original bytes, authenticated metadata, and protocol domain strings.
The PostgreSQL schema has no D1 count-guard table.
Its `require_tenant_root_row_count` function enforces row counts within the database.
D1 retains its existing constraint guards inside its driver.

Call `apply_postgres_role_store_schema_v1` once with migration credentials against an empty role-private database.
The function installs the schema and fixes that database's role identity.
Session construction rejects a different expected role.
Use a separate database and runtime login for each Deriver.
Grant each runtime login only its own database connection and table permissions.
Keep migration credentials outside the runtime process.
The E2E runner demonstrates these grants and checks that A's credentials cannot open B's database.

Run the storage E2E from the repository root:

```sh
pnpm -C crates/router-ab-cloudflare test:postgres-role-store
pnpm check:cargo-locks --offline
pnpm report:bloat --check
```

The runner starts a disposable local Docker container with a pinned PostgreSQL image.
It creates separate databases and credentials, applies the real schema, and uses the real Rust store and driver.
It then builds and runs a WASM fixture in workerd through local Hyperdrive bindings.
It removes the container when the run ends.
The native lifecycle test covers:

- encrypted creation, signed receipt replay, and connection restart.
- missed checkpoints that roll back an earlier share insertion and both epoch-swap mutations.
- cancellation, claimed admission settlement, and atomic epoch swaps.
- backup restore that stays pending until its mandatory forward refresh.
- retired-epoch cleanup and rejection of writes after source retirement.
- encrypted restore-import and retention-key round trips, including 64-bit timestamps and key versions.
- a concurrent commit between reads, with both reads retaining one snapshot.
- a forced serialization failure that retries the complete transaction.
- a queued reader that proceeds during the transaction's retry delay.
- a real committed transaction whose acknowledgement a TCP proxy discards, followed by exact receipt reconciliation.

The Worker fixture verifies role identity, text bindings, rollback, concurrent conditional claims, coherent snapshots, serialization retries, and reconnection.
Its snapshot check commits a concurrent write while the reader waits between two reads.
Its ordering barrier uses a separate local test connection and advisory locks.
The production adapter uses no advisory locks.
This local fixture does not exercise hosted Hyperdrive pooling or origin TLS.
The full lifecycle, cancellation, and uncertain-commit scenarios above still need Worker coverage.

The proxy counts PostgreSQL's documented [ReadyForQuery messages](https://www.postgresql.org/docs/18/protocol-message-formats.html).
One response marks the completion of one Query message.
The test measures one exchange for first and repeated reads, a three-statement snapshot, and the three-mutation epoch swap.
Root admission retains its existing two exchanges: the initial share read and the admission batch.
The proxy can discard the idle ReadyForQuery response after the implicit commit occurs.
This tests uncertain-commit handling through the actual driver and database.

The E2E sources live under `crates/router-ab-cloudflare/tests/postgres_role_store/`.
Their module uses the existing shared fixture factories.
Changes to these files do not invalidate the Workers harness's production source freshness check.

Each run saves its result, command, server version, image identity, source hashes, and log under `.artifacts/postgres-role-store/`.
The current native and Worker run is in [the Worker evidence](evidence/postgres-role-worker-20261024.md).
The earlier native run remains in [the PostgreSQL evidence](evidence/postgres-role-store-20261021.json).
The native lifecycle E2E also passes against a private Amazon RDS for PostgreSQL 18.6 instance in `ap-southeast-1`.
Its results and protocol exchange counts equal the local run. See [the RDS evidence](evidence/postgres-role-store-rds-20261021.json).
That run reaches RDS through a plain TCP forwarder on a runner in the same VPC, with `rds.force_ssl` off on that private path.
A separate `verify-full` connection to the same instance negotiates TLS 1.3.
Neither run establishes Multi-AZ failover, a provider pooler such as RDS Proxy, or an HTTP access method.
Run the same lifecycle scenarios through the intended deployment connection before claiming that deployment ready.

The complete Wallet backend still needs additional ports.
Gateway stores live under `packages/wallet-server/src/router/cloudflare/d1`, with schemas under `packages/wallet-server/migrations/d1-signer`.
Private Console stores live in `seams-monorepo`.
They contain their own SQLite JSON functions, time functions, conflict rules, triggers, and transaction boundaries.
Port and test each store with its lifecycle behavior.
Runtime hosting, Durable Object coordination, R2 replacement, data import, and production cutover remain separate work.

## Cloudflare Workers with Hyperdrive

PostgreSQL can replace D1 while the Workers and Durable Objects stay on Cloudflare.
[Hyperdrive](https://developers.cloudflare.com/hyperdrive/) gives a Worker a pooled connection to a PostgreSQL origin such as RDS.
The adapter and local Worker connection pass their checks. Status on 2026-10-24:

| Item | Status |
| --- | --- |
| Role-store adapter on native hosts | Passes against local PostgreSQL 18.6 and Amazon RDS 18.6. |
| Role-store adapter inside a Worker | Builds with `postgres,workers-rs`. The local workerd transaction E2E passes. |
| Worker connection support | The fixture uses the Hyperdrive binding, `Socket`, `Config::connect_raw`, and `postgres_tls::PassthroughTls`. Workers retries use `worker::Delay`. |
| Deployed Deriver stores | Still use D1. Runtime connection setup and PostgreSQL store construction remain to implement. |
| Hosted Hyperdrive | Full lifecycle, pooling, origin TLS, cache settings, and latency remain unverified. |
| Gateway, SigningWorker and Console stores | Still D1 only. Each needs its own PostgreSQL port. |
| D1 data import | No tool exists. |

The [Worker fixture](../crates/router-ab-cloudflare/tests/postgres_role_store/worker.rs)
shows connection setup with `worker` 0.8.4.
The `postgres` feature enables that crate's `tokio-postgres` support when `workers-rs` is enabled.
The host schedules the connection task before it awaits queries.
The same session constructor validates the expected Deriver role on both targets.

Remaining work for the hosted path:

1. In each Deriver Worker, open a `worker::Socket` to the Hyperdrive host and connect with `Config::connect_raw(socket, PassthroughTls)`.
   Pass the connected client to `PostgresRoleSqlSessionV1::new`, as on a native host.
2. Create one Hyperdrive configuration for each Deriver database, with separate credentials. Never share one configuration between A and B.
3. Create each configuration with `--caching-disabled`. Hyperdrive caches read queries by default and does not invalidate them after writes.
   A cached read breaks the store's coherent-read and serializable rules.
4. Keep TLS verified between Hyperdrive and the origin.
5. Run the role-store lifecycle E2E through the hosted Hyperdrive connection. Claim the path ready only after it passes.

The adapter's transaction design keeps its settings within each transaction.
Each batch is one Simple Query message, so PostgreSQL runs it as one implicit transaction on one server connection.
Its `SET TRANSACTION` and `SET LOCAL` statements apply only inside that message.
The adapter uses no SQL-level `PREPARE`, advisory locks, `LISTEN`, or session state, which Hyperdrive does not support.
Hosted transaction pooling still needs verification with the complete lifecycle.
Include serialization-failure retries and reconciliation after a lost commit acknowledgement.

Durable Objects keep their own storage and coordination. This path changes only the SQL stores that use D1 today.
A PostgreSQL origin has one primary region. Place it near the Workers that write to it, and measure the added round trips before production use.

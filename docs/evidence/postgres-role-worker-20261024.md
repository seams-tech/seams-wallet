# PostgreSQL role adapter in Workers — October 24, 2026

The existing PostgreSQL role adapter now runs in a local Worker.
The native lifecycle E2E and the Worker transaction E2E passed against disposable PostgreSQL 18.6.
The [generated evidence](postgres-role-worker-20261024.json) records results, source hashes, and the database image.
This work establishes adapter behavior. It provides no hosted latency comparison.

## Implementation

The `postgres,workers-rs` features expose `PostgresRoleSqlSessionV1` on `wasm32-unknown-unknown`.
They enable the existing `worker` crate's PostgreSQL connection support.
WASM serialization retries use `worker::Delay`.
Native retries retain Tokio and the same retry count and delays.
The SQL batches, transaction isolation, row-count checks, and role validation retain their existing behavior.

The [Worker fixture](../../crates/router-ab-cloudflare/tests/postgres_role_store/worker.rs)
opens Workers sockets through local Hyperdrive bindings.
It uses `Config::connect_raw` with `PassthroughTls` and schedules the connection future before queries.
The caller continues to own credentials, connection setup, TLS, and connection lifetime.

Deployed Derivers still construct D1 stores.
This change adds no runtime backend selection, deployment, or hosted database resource.

## Measured behavior

The existing runner starts PostgreSQL 18.6 from a pinned Docker image.
It creates separate A/B databases and restricted runtime credentials.
The native test applies the real role-store schema and exercises the complete existing lifecycle.
The runner then compiles the Worker fixture and executes it with Miniflare's workerd runtime.

| Check | Observed result |
| --- | --- |
| Native tenant-root lifecycle | Passed encrypted creation, replay, cancellation, admission settlement, epoch swaps, restore, and retirement checks. |
| Native uncertain commit | Passed exact receipt reconciliation after the TCP proxy discarded the commit acknowledgement. |
| Worker role identity | B accepted its own identity and rejected A with the expected identity error. |
| Worker text bindings | Preserved quotes, a backslash, and Unicode. |
| Worker conditional rollback | The expected row-count error rolled back an earlier write in the same batch. |
| Worker concurrent claims | Exactly one claim succeeded. The other returned the expected row-count error. |
| Worker coherent snapshot | Both reads returned 7 while a separate connection committed 8 between them. |
| Worker serialization retry | A forced `40001` error caused two attempts. The complete batch rolled back, retried, and committed value 9 once. |
| Worker reconnection | A new session read the committed value 9. |

The snapshot fixture uses a database lock as an ordering barrier.
It observes the blocked reader, commits the concurrent write, then releases the reader.
The separate local test connection owns that barrier.
The production adapter uses no advisory locks or persistent session state.

An independent review found that the initial sleep-based check could pass without the required write ordering.
The final fixture replaces that check with the barrier and rejects unrelated errors in negative cases.
The final E2E regenerated all source hashes, including `src/lib.rs`.

## Limits and remaining work

- The Worker fixture verifies the transaction driver. Full tenant-root lifecycle coverage through Workers remains open.
- Worker cancellation, lost commit replies, and exact replay still need their own connection-path evidence.
- Local Hyperdrive bindings connect to disposable PostgreSQL. Hosted pooling, origin TLS, and cache behavior remain unverified.
- Registration and signing still use their existing deployed stores. This library change leaves their deployed request path unchanged.
- Parity with hosted Hyperdrive is not established. No database migration or performance gain follows from this result.

Next, construct the PostgreSQL role store at the Deriver runtime boundary and extend the existing lifecycle E2E through Workers.
Then validate separate A/B Hyperdrive configurations, disabled caching, origin TLS, and lifecycle behavior in an authorized hosted environment.
Compare D1 and PostgreSQL only after those checks pass, with matched workload, placement, and durability settings.

## Reproduction

Run from `seams-wallet` with Docker, the WASM target, and the matching `wasm-bindgen` CLI installed:

```sh
FORCE_COLOR=0 pnpm -C crates/router-ab-cloudflare test:postgres-role-store
cargo check --locked --manifest-path crates/router-ab-cloudflare/Cargo.toml \
  --lib --target wasm32-unknown-unknown --features strict-worker-deriver-a-entrypoint
pnpm check:cargo-locks --offline
pnpm report:bloat --check
```

The runner saves current evidence under `.artifacts/postgres-role-store/` and removes its container.
`result.json` includes native and Worker outcomes. `worker/` contains the generated WASM, build log, and Worker result.
The dated build/check logs are under `.artifacts/optimization-11-near/20261024-p1/`.
The default D1 Worker build also passes.
The broad formatter check reports existing drift in unrelated files. The new Worker fixture passes its targeted formatter check.

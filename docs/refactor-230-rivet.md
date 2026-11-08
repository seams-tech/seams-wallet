# Refactor 230: Rivet deployment backend evaluation and plan

Status: **deferred**, 2026-11-08. Nothing is built. Retain this assessment and
phased plan for when backend portability work resumes alongside
[Wallet storage portability](storage-portability.md).

## Objective

Evaluate and, when prioritized, support [Rivet](https://github.com/rivet-dev/rivet)
(`rivetdev/engine` 3.0 with WarpDrive and the `rivetkit` Rust/TypeScript SDKs) paired
with regional PostgreSQL as a deterministic, low-latency alternative to Cloudflare
Workers, Durable Objects, and D1.

## Facts this plan builds on

### Measured Cloudflare bottlenecks in `seams-wallet`

1. **Periodic host write stalls ([`cloudflare-stalls.md`](cloudflare-stalls.md)):**
   Across 570+ Cloudflare hosts in 14 colos, SQLite-backed Durable Objects and D1
   exhibit a periodic 5,000 ms host pause lasting **70–400 ms median (up to 3.2 s)**,
   plus a 30 s secondary pause. Because a Durable Object's output gate holds all
   responses and outgoing requests until writes confirm, a single stalled commit
   delays the entire ceremony path (~13 serial durable commits in registration).
2. **Durable Object first-contact and stub overhead ([`refactor-155-reusuable-DO`](archive/refactor-150-155.md), [`refactor-152-regional-D1`](archive/refactor-150-155.md)):**
   A no-op to a newly created Durable Object measured **643 ms median (731 ms max)**.
   Constructing a fresh stub to an already-warm Durable Object reintroduced
   **43–44 ms median** (versus **3 ms** on the same stub). Fresh per-wallet Router
   Durable Objects calling Deriver A, Deriver B, and SigningWorker also triggered
   peer isolate cold starts on **89–97%** of calls ([`refactor-R155J-p99`](archive/refactor-150-155.md)).
3. **Advisory region hints and cross-metro splits ([`refactor-155G-apac-anchor-and-hidden-exchanges`](archive/refactor-150-155.md), [`router-ab/deployment.md`](router-ab/deployment.md)):**
   Cloudflare location hints (`apac`, `apac-se`, `enam`, `weur`, `oc` in
   [`wallet_home.rs`](../crates/router-ab-cloudflare/src/wallet_home.rs)) are advisory
   and do not guarantee that Workers, Durable Objects, and D1 primaries share a
   datacenter. Production lanes experienced Workers in Hong Kong (`HKG`) calling D1
   primaries in Singapore (`SIN`) across 13–14 serial database calls, and evening
   Tokyo ingress traffic was shed to Portland/Seattle in 20 of 72 samples
   ([`refactor-R155J-p99`](archive/refactor-150-155.md)).
4. **WASM cryptographic CPU overhead ([`refactor-155G-apac-anchor-and-hidden-exchanges`](archive/refactor-150-155.md)):**
   Ed25519 Yao garbling, evaluation, oblivious transfer, HPKE sealing, and 2 MB table
   serialization consume **272–413 ms CPU on Deriver A** and **248–452 ms CPU on
   Deriver B** under `wasm32-unknown-unknown`, compared to **209 ms total** (134 ms
   garble + 80 ms evaluate) outside Cloudflare Workers.
5. **Existing PostgreSQL role-store portability ([`storage-portability.md`](storage-portability.md)):**
   [`PostgresRoleSqlSessionV1`](../crates/router-ab-cloudflare/src/tenant_root_role_sql.rs)
   already implements `RoleSqlSessionV1` and passes the full lifecycle E2E against
   PostgreSQL 18.6 locally and on Amazon RDS in `ap-southeast-1`.

### Rivet 3.0 (WarpDrive) architecture and benchmark comparison

Rivet 3.0 (GA November 1, 2026) and its Rust SDK (`rivetkit`, GA November 6, 2026)
provide an Apache-2.0 actor runtime with per-actor SQLite backed by **WarpDrive**:

- **In-process actors:** Actors run inside long-lived native Rust or Node.js processes
  (~72.4 KB RSS per active actor) connected outbound to the Rivet control plane,
  avoiding per-actor container boot and per-call isolate cold starts.
- **WarpDrive SQLite VFS:** Each actor has an isolated SQLite database whose Virtual
  Filesystem (VFS) stages dirty pages in memory and flushes commits (`xSync`) to local
  NVMe disks across 3 Availability Zones (AZs) in the same region. Writes confirm as
  soon as 2 of 3 AZs acknowledge. Cold chunks offload asynchronously to S3-compatible
  object storage (S3, GCS, Azure Blob, R2, or MinIO), keeping object storage off the
  critical write path.

Numbers from Rivet's reproducible benchmark
([`rivet-dev/bench-rivet-actors-vs-durable-objects`](https://github.com/rivet-dev/bench-rivet-actors-vs-durable-objects),
run November 5, 2026 on Rivet 3.0.3 across 3 AZs in `eastus2` vs. Cloudflare Durable
Objects):

| Operation | Rivet 3.0 (p50 / p90 / p99) | Cloudflare DO (p50 / p90 / p99) | `seams-wallet` Cloudflare Evidence |
| --- | ---: | ---: | --- |
| Actor create + first request (no storage) | **4.30 / 4.52 / 4.99 ms** | **222 / 394 / 1,028 ms** (unique ID: **169 / 258 / 875 ms**) | **643 ms median (731 ms max)** first no-op to new DO |
| Create + first request is a durable SQLite write | **5.98 / 6.84 / 7.52 ms** | **218 / 326 / 1,278 ms** | Setup + pair preparation waits in R155H / R155J |
| Actor wake from sleep + first request | **6.26 / 6.54 / 8.15 ms** | **49.0 / 399 / 1,306 ms** | Cold first batch after idle: 4.9–13.1 s registration |
| Warm request round trip (no storage) | **0.45 / 0.57 / 0.79 ms** | **11.0 / 13.0 / 20.0 ms** | **3 ms** same stub; **43–44 ms** fresh stub to warm DO |
| SQLite point read, warm (round trip) | **0.68 / 0.92 / 1.81 ms** (in-actor: **0.09 / 0.26 / 0.54 ms**) | **11.0 / 12.0 / 14.0 ms** | D1/DO read round trips depend on Worker-to-primary metro distance |
| SQLite durable write, 1 row (round trip) | **1.24 / 1.38 / 1.72 ms** (in-actor: **0.69 / 0.75 / 1.07 ms**) | **30.0 / 32.0 / 92.0 ms** | Periodic 5 s host commit stalls of **70–400 ms median (up to 3.2 s)** |
| Sequential durable writes on one actor | **790 / s** | **25.8 / s** | Output gate serializes responses behind each replication wait |

## APAC region options and Rivet 3.0 multi-region status

1. **Rivet Cloud (Managed Control Plane + Managed or BYO Actor Nodes):**
   - Runs on Google Cloud and supports two APAC regions out of the box:
     - **`asia-southeast1` (Singapore)**
     - **`asia-east1` (Taiwan)**
     (Alongside `us-east4` N. Virginia, `us-central1` Iowa, `europe-west1` Belgium, and
     `europe-west3` Frankfurt.)
2. **Self-Hosted (`rivetdev/engine:3.0.3`) or BYOC in AWS / GCP APAC:**
   - Because Rivet 3.0 is a single stateless binary whose only external dependencies
     are 3-AZ local NVMe instances and an S3-compatible bucket, a cluster can be
     deployed directly in **AWS Tokyo (`ap-northeast-1`), Hong Kong (`ap-east-1`),
     Singapore (`ap-southeast-1`), or Osaka (`ap-northeast-3`)** inside the same VPC
     and availability zones as Amazon RDS for PostgreSQL.
   - Placement is 100% deterministic: Actor nodes, the Rivet control plane hot tier,
     and the regional PostgreSQL primary remain in the exact same cloud region.
3. **Single-region vs. multi-region control plane caveat:**
   - In Rivet 3.0, a control plane cluster currently runs in **one region across three
     availability zones**. Built-in multi-region routing within a single cluster is a
     Rivet 2.x feature and is scheduled for a later Rivet 3.x release.
   - Because `seams-wallet` already pins each wallet to a fixed regional home (`US`,
     `WEUR`, `APAC`, `OC`) and anchors each APAC lane in a single metro
     ([`refactor-155G-apac-anchor-and-hidden-exchanges`](archive/refactor-150-155.md)),
     one Rivet 3.0 cluster per regional home matches the current architecture.

## Component mapping and architectural boundaries

| Current Cloudflare Component | Rivet + PostgreSQL Target | Architectural & Security Requirements |
| --- | --- | --- |
| **Durable Objects (6 classes in [`crates/router-ab-cloudflare/src/durable_object/`](../crates/router-ab-cloudflare/src/durable_object/mod.rs))**<ul><li>`RouterAbRouterWalletDurableObject`</li><li>`RouterAbTenantRootCreationDurableObject`</li><li>`RouterAbDeriverAWalletDurableObject`</li><li>`RouterAbDeriverBWalletDurableObject`</li><li>`RouterAbSigningWorkerWalletDurableObject`</li><li>`RouterAbSigningWorkerPresignSessionDurableObject`</li></ul> | **Rivet Actors (`rivetkit` Rust SDK)**<br>Keyed by canonical wallet/host identity (`getOrCreate([key])`) using per-Actor WarpDrive SQLite (`ctx.sql()`) | Preserve single-writer serialization per actor key, ownership-generation fences, durable claims before emitting protocol output, and session-scoped expiry/cleanup ([`refactor-155-reusuable-DO`](archive/refactor-150-155.md)). |
| **Role Workers (5 entrypoints in [`crates/router-ab-cloudflare`](../crates/router-ab-cloudflare/Cargo.toml))**<ul><li>`router-ab-mpc-router`</li><li>`router-ab-tenant-root-control-plane`</li><li>`router-ab-deriver-a`</li><li>`router-ab-deriver-b`</li><li>`router-ab-signing-worker`</li></ul> | **Separate Native Rust Actor Node Pools (`RIVET_POOL`) or Namespaces** | **Mandatory secret isolation ([`Spec 5`](spec-5-router-ab-threshold-protocol.md), [`router-ab/deployment.md`](router-ab/deployment.md)):** Rivet Actors share their host node's OS process. `deriver-a`, `deriver-b`, `signing-worker`, `router`, and `tenant-root-control-plane` **must run in separate Node Pools / OS processes** with separate credentials, KEKs, and HPKE keys. Never co-locate Deriver A and Deriver B actors in the same process or pool. |
| **Role-Private D1 Databases**<ul><li>`DERIVER_A_PRIVATE_DB`</li><li>`DERIVER_B_PRIVATE_DB`</li><li>`SIGNING_WORKER_PRIVATE_DB`</li></ul> | **Regional PostgreSQL 18 (`PostgresRoleSqlSessionV1`)** in the same VPC | Reuse [`PostgresRoleSqlSessionV1`](../crates/router-ab-cloudflare/src/tenant_root_role_sql.rs) with native `tokio-postgres` over verified TLS and separate databases/credentials per role ([`storage-portability.md`](storage-portability.md)). Port SigningWorker D1 stores to the same PostgreSQL boundary or per-wallet Actor SQLite. |
| **Gateway & Console D1 Databases**<br>([`packages/wallet-server/src/router/cloudflare/d1`](../packages/wallet-server/src/router/cloudflare/d1), 56 signer tables + 84 Console tables in [`refactor-152-state-ownership`](archive/refactor-150-155.md)) | **Regional PostgreSQL** (shared/cross-wallet tables) + optional **Per-Wallet Actor SQLite** (wallet-scoped tables) | Rivet per-Actor SQLite is isolated per actor and does not replace cross-wallet relational queries (`wallet_passkey_claims`, `wallet_routes`, OIDC/sync challenges, tenant policy). Shared tables require the Gateway/Console PostgreSQL port noted in [`storage-portability.md`](storage-portability.md#L140-L145). |
| **Managed Backup R2 Buckets**<br>([`tenant_root_managed_backup_r2.rs`](../crates/router-ab-cloudflare/src/tenant_root_managed_backup_r2.rs)) | **Regional S3 / GCS / R2** | Preserve separate buckets and credentials for Deriver A and Deriver B backups. |

## Non-negotiable invariants

1. **No duplicate protocol state machines (`AGENTS.md`):**
   Do not copy-paste the Durable Object state machines in
   [`crates/router-ab-cloudflare/src/durable_object/`](../crates/router-ab-cloudflare/src/durable_object/mod.rs)
   into a parallel Rivet crate. Extract a narrow host trait for actor SQL storage,
   alarm/schedule timers, and authenticated peer RPC so one state machine compiles for
   both `workers-rs` and native `rivetkit`.
2. **Role separation at the process and credential boundary:**
   A node binary for `deriver-a` must register only Deriver A actors, connect only to
   the `deriver-a` pool, and fail startup if Deriver B secrets or bindings are present
   ([`router-ab/deployment.md`](router-ab/deployment.md#secret-separation)).
3. **Durable commit semantics ([`Spec 4`](spec-4-persistence-and-durable-authority.md)):**
   Every admission claim, nonce/presignature reservation, and custody checkpoint must
   wait for a confirmed 2-of-3 AZ WarpDrive SQLite commit or Serializable PostgreSQL
   commit before emitting a response or outbound peer message.
4. **Native cryptographic builds:**
   When targeting Rivet Actor nodes (`x86_64-unknown-linux-gnu` or
   `aarch64-unknown-linux-gnu`), compile [`crates/ed25519-yao`](../crates/ed25519-yao),
   [`crates/router-ab-ecdsa-presign`](../crates/router-ab-ecdsa-presign), and
   [`crates/signer-core`](../crates/signer-core) natively without `wasm-bindgen` glue.

## Phases (when resumed)

### Phase 1 — Extract host-agnostic actor storage and transport seams

1. Define a host-neutral actor context trait in Rust covering:
   - transactional SQLite execution (`sql.exec` / parameterized queries and row decoding),
   - durable timer/alarm scheduling,
   - authenticated peer-actor RPC (`Stub::fetch_with_request` vs. `rivetkit` actor call / HTTP action).
2. Implement the `workers-rs` adapter over `worker::State`, `worker::SqlStorage`, and
   `worker::Stub` ([`worker_storage.rs`](../crates/router-ab-cloudflare/src/durable_object/worker_storage.rs)),
   keeping all existing Cloudflare tests green with zero behavior change.
3. Implement the native `rivetkit` adapter for the six Durable Object classes:
   - `RouterAbRouterWalletDurableObject`
   - `RouterAbTenantRootCreationDurableObject`
   - `RouterAbDeriverAWalletDurableObject`
   - `RouterAbDeriverBWalletDurableObject`
   - `RouterAbSigningWorkerWalletDurableObject`
   - `RouterAbSigningWorkerPresignSessionDurableObject`
4. Build separate native role binaries (or feature-gated entrypoints) that enforce
   pool and secret separation per role (`router`, `tenant-root-control-plane`,
   `deriver-a`, `deriver-b`, `signing-worker`).

### Phase 2 — APAC `router-ab` prototype and latency benchmark

1. Provision an isolated APAC test environment (e.g., AWS `ap-southeast-1` or
   `ap-northeast-1`, or GCP `asia-southeast1`) containing:
   - a 3-AZ Rivet 3.0 control plane (`rivetdev/engine`) with local NVMe and S3/GCS backing,
   - separate Actor node pools for each `router-ab` role,
   - a PostgreSQL 18.6 instance with separate Deriver A, Deriver B, and SigningWorker
     databases using [`PostgresRoleSqlSessionV1`](../crates/router-ab-cloudflare/src/tenant_root_role_sql.rs).
2. Run the full role-store and ceremony fault/lifecycle suites (including lost commit
   acknowledgements, concurrent admission claims, and pair cancellation).
3. Benchmark end-to-end registration (Ed25519 Yao + ECDSA derivation), presignature
   pool refill, and consecutive signing (`p50`, `p95`, `p99`, and max) from a Tokyo
   and Singapore client against the [`R155G`](archive/refactor-150-155.md)
   and [`R155J`](archive/refactor-150-155.md) baselines:
   - Verify whether native Rust Yao execution drops Deriver A/B CPU from ~270–450 ms
     to ~150–210 ms.
   - Verify whether WarpDrive 3-AZ NVMe commits eliminate the 5,000 ms periodic write
     stalls documented in [`cloudflare-stalls.md`](cloudflare-stalls.md).
   - Verify whether warm and cold Actor creation eliminates the 643 ms first-contact
     DO penalty and 43 ms fresh-stub overhead.

### Phase 3 — Gateway, Console, and wallet relocation portability

1. Port the Gateway signer stores ([`packages/wallet-server/src/router/cloudflare/d1`](../packages/wallet-server/src/router/cloudflare/d1))
   and SigningWorker D1 stores to PostgreSQL (with optional per-wallet Gateway Actor
   SQLite for strictly wallet-scoped tables per [`refactor-152-state-ownership`](archive/refactor-150-155.md)).
2. Update wallet object address resolution (`0077_wallet_object_addresses.sql` and
   [`wallet_object_address.rs`](../crates/router-ab-cloudflare/src/wallet_object_address.rs))
   and wallet relocation ([`R153`](archive/refactor-150-155.md)) to support
   Rivet Actor keys/IDs across regional clusters without breaking ownership-generation
   fences.
3. Validate managed backup and restore ([`Spec 6`](spec-6-tenant-roots-recovery-and-portability.md))
   against S3/GCS/R2 on the native role nodes.

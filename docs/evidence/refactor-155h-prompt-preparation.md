# Registration pair preparation during the passkey prompt

Date: October 13, 2026. Status: implemented locally; no staging deployment or
hosted latency measurement. This change adds no Cloudflare resources.

Implementation commits on `dev`: `699f71f1` (custody preparation and peer
connection) and `40afd5e7` (Gateway setup dispatch and rate limit).

## Behavior

Passkey setup keeps its session identity for both NEAR-only and mixed
registration. After setup and stored-address initialization complete, the Gateway
schedules input-free pair preparation. Failed preparation leaves the committed
setup usable through online admission.

The Router admits A and B concurrently. A opens an authenticated connection to
B's exact stored wallet-object address. One preparation occupies each wallet
object for at most 30 seconds. Retries retain the first epoch and deadline.
Setup grants no execution authority and sends no encrypted client input or Yao
protocol material across this connection.

Execution binds the admitted root use to the exact encrypted-input pair. B
claims its execution, performs its fresh root read, and acknowledges the exact
session, pair, and execution ID. A commits its claim before protocol material.
Missing or expired preparation uses online admission. Alarms release unused
admissions. Cancelled admissions remain cancelled. Relocation counts pending
preparation and refuses to move its source while it remains pending.

The Gateway enforces the user-selected **30 setups per minute per publishable
key and source IP** in its existing regional database. Other regions have
independent counters. Exhaustion returns 429; counter failure returns 503.
Neither starts reservation or custody work. No new configuration variable is
required.

## Local evidence

Run from `seams-wallet`:

```sh
node tests/e2e/registration-setup-startup.e2e.mjs
ROUTER_AB_WORKER_BUILD_PROFILE=dev node crates/router-ab-cloudflare/scripts/registration-prompt-evidence.mjs
pnpm --filter @seams/wallet-server type-check
pnpm -C tests type-check:wallet-state
pnpm report:bloat --check
```

The Worker script requires current development builds of Router, both Derivers,
SigningWorker, and the tenant-root control plane. It rejects stale builds.

| Scenario | Result |
| --- | --- |
| Prepare before input, execute on the same socket, replay exact completion | Pass |
| Prepared session expires; execute succeeds through the online socket | Pass |
| Abandoned setup releases both D1 admissions | Pass |
| Cancelled admissions cannot be revived by execute | Pass |
| D1 rejects early admission; ordinary execution still succeeds | Pass |
| Missing Gateway service credential cannot prepare | Pass |
| 42 concurrent setup attempts admit exactly 30 | Pass |
| Distinct keys and IPs use separate counters | Pass |
| Expired counter window admits again | Pass |
| Counter storage failure refuses setup work | Pass |
| Early-preparation callback failure preserves committed setup | Pass |
| Setup retries, lost replies, cancellation, and stored-address races | Pass |
| Wallet-server types and lifecycle type fixtures | Pass |
| Repository bloat check | Pass |

Raw output is in `.artifacts/r155h-prompt-preparation/`. The Worker script writes
`worker-evidence.json`, including observed peer paths. The prepared case records
one early connection and no online duplex connection. The expired case records
the fallback duplex connection. The setup script writes its own repeatable
result artifact under `.artifacts/registration-setup-startup/`.

An initial broad private-D1 run reached an unrelated ECDSA activation and failed
with HTTP 403. Its request used the wrong service-auth credential for the
current activation route. This is a test-fixture mismatch; production auth was
not weakened. The focused Worker scenarios above pass.

The initial browser run stopped before a test could run because `worker-build`
lost its cached `wasm-bindgen` executable. Later Worker builds used a stable local
copy of version 0.2.123. The focused Chromium run then passed both cases:

- NEAR-only registration replays admitted work, commits once, and signs after reload.
- Mixed registration starts one NEAR admission while ECDSA activation is in flight.

The run used current development Workers and the rebuilt wallet-server package.
Its command was:

```sh
SEAMS_INTENDED_SKIP_BUILD=1 ROUTER_AB_WORKER_BUILD_PROFILE=dev node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.registration.contract.test.ts e2e/intended-behaviours/passkey.near-registration-commit.contract.test.ts --grep 'mixed registration starts one NEAR admission|NEAR-only registration replays admitted work'
```

`intended-focused.log` contains both passing results. These browser contracts
verify product behavior. `worker-evidence.json` verifies the early socket itself.

## Deployment and measurement remaining

Apply Gateway migration `0080_registration_setup_rate_limits.sql` and migration
`0020_registration_preparation.sql` to each Deriver database before activating
matching Gateway, Router, and Deriver versions. Existing live resources were not
changed in this task.

Measure the full registration path and abandoned-setup cost on staging. Do not
infer a hosted saving from these development builds. A now binds and reads its
root in one batch. B binds during input preparation and retains its separate
fresh read before execution. Removing that last B read remains outside this
connection implementation; no role secret is cached between requests.

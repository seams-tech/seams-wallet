# Optimizations 10 and 11: registration, ECDSA presign and NEAR signing latency

Status: closed. Optimization 10 ran from Wallet 0.5.24 to 0.6.2 (September 19–24,
2026). Optimization 11 ran from September 29 to October 24, 2026. The
mechanisms below are in the code. The open items at the end are not done.

All hosted numbers come from production-hosted **testnet**, with a client in
Japan, Chromium, and a virtual passkey. They are small diagnostic cohorts, not
population percentiles. Times are seconds unless a table says ms.

## What landed

### Registration and NEAR readiness

- Mixed registration returns when ECDSA is ready. ECDSA activation and a planned
  NEAR continuation commit durably first. NEAR admission, Yao, finalization and
  installation then continue in the background (states: planned, prepared,
  joined, finalized, installed). A longer spinner is not an accepted fix.
- NEAR-only registration awaits session hydration and persistence before it
  reports ready. Before September 29 it skipped the sealed session, so a reload
  could not restore the signer (`production_regression`). The old 751 ms
  NEAR-only figure omitted this work and is not a valid baseline.
- The passkey client seal is prepared during NEAR custody. Its ciphertext is
  reused through finalization, hydration and signer installation. NEAR-only
  reuses the early seal and the prepared server seal.
- NEAR-only passkey "respond" verifies the proof and runs Yao in one request:
  setup → respond/execute → finalize.
- `registrationEd25519Yao.ts` preloads the activation modules and the NEAR signer
  during passkey registration.
- Other landed custody changes: batched root-store reads (20 → 8 D1 trips),
  reused finalization snapshots, garbling/evaluation overlap with table-frame
  yields, release WASM SIMD, Router orchestration in the wallet object, combined
  B prepare/execute claims, no Router wait for B's prepare reply after A returns,
  and Console publication persisted as pending with durable retry.
- Dev builds go to `build/dev/<role>` and release builds to `build/<role>`. The
  release workflow rebuilds production WASM (`ROUTER_AB_WORKER_BUILD_PROFILE`).
  The SigningWorker WASM fell from 27.0 MB to 6.8 MB.

### ECDSA presign pool and refill

- Pool target: 5 entries (`ECDSA_CLIENT_PRESIGNATURE_CAPACITY`,
  `packages/wallet/src/core/config/presignatures.ts`). Retention: 90 days in the
  client, the TS server and the Rust worker
  (`MAX_DURABLE_CLIENT_PRESIGNATURE_LIFETIME_MS`,
  `MAX_DURABLE_PRESIGNATURE_LIFETIME_MS`, `MAX_ECDSA_PRESIGN_MATERIAL_LIFETIME_MS`).
- A live Wallet Session can refill at zero signing uses. Preprocessing does not
  use signing quota. This replaced the "presignature-only permission" proposal.
- Refill starts at the durable ECDSA commit in registration, fire-and-forget.
  Registration and unlock share one scheduling helper. The pool refills after
  each consumption.
- A foreground miss uses `foreground_presign_pool_refill`. Background refill
  yields to active signing.
- The owner presign takes 6 exchanges (1 init + 5 steps), down from 8. The init
  carries a client-generated 256-bit ceremony ID with an immutable expiry. An
  alarm clears the persisted init claim. The server rejects a repeat init.
- Each exchange has a 5 s budget (`PRESIGN_EXCHANGE_TIMEOUT_MS`,
  `poolFillRoutes.ts`), capped by ceremony expiry. Each pool entry gets its own
  `refillAttemptTimeoutMs`, capped by session expiry. A failed ceremony restarts
  with a fresh ID. A superseded refill cannot cancel newer maintenance.
- Terminal-batch reservation: the native client emits `final_batch_ready`, the
  prepare request carries the final batch, and the SigningWorker persists it with
  `PutReserved` (`crates/router-ab-cloudflare/src/ecdsa_pool_lifecycle.rs`).
- Authorization reads: one material read, concurrent authority and auth-method
  reads, one D1 join for exact-operation context, one LEFT JOIN for the Console
  binding lookup, insert-first admission (`INSERT OR IGNORE`), and completion by
  `UPDATE ... RETURNING`. The Gateway streams the signing-prepare body.
- CORS sends `Access-Control-Max-Age: 600`
  (`crates/router-ab-cloudflare/src/strict_worker/cors.rs`).
- Bugs fixed on the way: the first derivation-to-presign connection invalidated
  the pool generation (double generation); step-up expiry exceeded the session
  (HTTP 403); admission compared a capability-instance ID with an MPC capability
  ID (0.5.28); the durable-store channel connected only during generation
  (0.5.28); one 30 s window covered a whole refill batch (0.5.30).
- Placement: the testnet SigningWorker is near Osaka (`aws:ap-northeast-3`); the
  Gateway targets Singapore. Both are in `seams-monorepo` configuration.
- Timing spans: `ecdsa_presign_total`, `ecdsa_presign_proxy`,
  `ecdsa_presign_sw_session`, `ecdsa_presign_sw_do_total`,
  `ecdsa_presign_sw_body`, `ecdsa_sign_proxy`, `ecdsa_sign_complete`,
  `wallet_gateway_binding`, `wallet_gateway_total`
  (`packages/shared-ts/src/utils/ecdsaServerTiming.ts`).

### NEAR signing, relayer and storage

- NEAR prepare starts while the NEP-413 confirmation dialog is open. Message
  signing sends only prepare and finalize. It used to send 8 status POSTs per
  signature.
- `signTransactions.ts` and `operationState/trace.ts` time `signature_total`,
  `confirmed_to_signed` and the granular stages (`durable_lease_recovery_wait`,
  material resolution, transaction context, session authorization,
  `nonce_lease_commit`, assembly).
- `fetchRelayerTxContext`
  (`packages/wallet-server/src/core/nearRelayerAccountProvisioning.ts`) fetches
  the access key and the final block concurrently.
- A PostgreSQL role adapter builds for Workers WASM and reuses `RoleSqlSessionV1`.
  It passed a local transaction E2E. Deployed Derivers still use D1; the user
  deferred integration on October 24.

### Rejected or removed

| Approach                                                                       | Why                                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Persistent WebSocket or RPC transport                                          | HTTP vs RPC differed by 2–3 ms locally; the browser WS prototype saved nothing |
| Hold NEAR publication until the first ECDSA sign                               | One sample still took 12.339 s                                                 |
| Owner-storage startup; early peer ack                                          | No gain; reverted in `a0b4c9df`, `e1d52bf8`                                    |
| Equal worker asset URLs                                                        | Still two transfers                                                            |
| Partial signing-intent schema                                                  | Replaced by the candidate-ID design                                            |
| Keepalive pools; speculative authority caches; reply before durable completion | Excluded by design                                                             |
| Yao before passkey proof verification                                          | Rejected by the owner                                                          |
| Temporary October 24 trace and profiling code                                  | Removed after evidence capture                                                 |

## Tests and results

### ECDSA signing by release (Tempo, `commit_total`)

| Date, release                   | Cohort                            |         n | Result                                |
| ------------------------------- | --------------------------------- | --------: | ------------------------------------- |
| 09-19, 0.5.24 default placement | cached / empty pool               |     5 / 2 | median 3.610 / 9.76, 10.55            |
| 09-19, 0.5.24 Osaka placement   | cached / empty pool               |     3 / 3 | median 2.580 / 7.88–13.35             |
| 09-19, 0.5.25                   | paced cached / step-up empty      |     4 / 7 | median 2.26 / 8.65                    |
| 09-20, Console LEFT JOIN        | cached / step-up empty            |     3 / 7 | median 2.11 / 7.50                    |
| 09-20, 0.5.26                   | paced cached / step-up empty      |     4 / 6 | median 2.242 / 7.413                  |
| 0.5.27, fresh wallet            | step-up cached                    |        24 | median 1.639 (1.245–1.995)            |
| 0.5.28                          | first sign after reload           |         1 | 1.365, no foreground generation       |
| 0.5.30                          | immediate sign after registration |         1 | 9.084 (5.301 presign wait)            |
| 0.5.32                          | cached / after reload / empty     | 6 / 2 / 3 | 1.394–2.217 / 1.83, 1.90 / 7.88–10.01 |
| 09-22, 0.5.33                   | two 8-sign batches                |        16 | 2.410–13.945                          |

The Osaka placement cut the SigningWorker prepare median from 799 to 137 ms and
finalize from 1,188 to 201 ms.

### Presign ceremony by release (one registration each)

| Metric                        |       0.5.30 |      0.5.31 |      0.5.32 |
| ----------------------------- | -----------: | ----------: | ----------: |
| POSTs per ceremony            |            8 |           8 |           6 |
| OPTIONS requests (total time) | 13 (3.518 s) | 2 (0.399 s) | 2 (0.332 s) |
| Median ceremony               |        8.761 |       7.908 |       4.069 |
| Registration ready            |       13.476 |       9.934 |       8.456 |
| First pool entry after ready  |       10.720 |       8.892 |       3.812 |

- Durable Object CPU is about 150–215 ms per ceremony. The native Rust floor is
  34.2 ms for both roles (25 iterations).
- A 0.5.33 stall took 6.076 s to headers, with 0.022 s in the DO call. The
  delay was before the DO call, during body read or scheduling.

### Local ECDSA

- Sustained contract: 20 signatures with 20 unique presignatures; Tempo
  62–356 ms, Arc 63–287 ms.
- 0.5.30: registration 2.75 s, first sign 0.68 s. An injected +100 ms per step
  gave 1.454 s; +250 ms gave 3.017 s.
- Terminal batch: 1,933.8 vs 1,971.3 ms median (−1.9%, 5 alternating samples).
- Transport model: HTTP vs RPC 14.47 vs 11.71 ms at 4 KiB.

### Registration

| Measurement                   |                 Before |                  After |
| ----------------------------- | ---------------------: | ---------------------: |
| Hosted ECDSA-ready return     | 5.347 avg (n=4, 0.6.0) | 3.091 avg (n=5, 0.6.2) |
| Hosted durable NEAR ready     |      8.978 avg (0.6.0) |      4.682 avg (0.6.2) |
| Local mixed return (20 pairs) |               848.5 ms |               601.0 ms |
| Local NEAR ready (20 pairs)   |             1,059.3 ms |             1,007.0 ms |
| SigningWorker delivery        |                 373 ms |                   7 ms |
| Router Yao                    |                 673 ms |                 316 ms |
| Browser custody join          |               708.8 ms |               364.6 ms |

### NEAR signing and registration

Local, September 29 (macOS arm64, Chromium 140, release D1, 20 samples per row;
median / p95 / max, ms):

| Public SDK boundary                   | Corrected baseline      |
| ------------------------------------- | ----------------------- |
| NEAR-only registration → ready        | 906.9 / 924.0 / 1,112.8 |
| Mixed registration → ECDSA ready      | 763.8 / 787.6 / 788.9   |
| Mixed inner registration → NEAR ready | 914.4 / 952.6 / 964.0   |
| NEAR-only sign, first / warm (median) | 372.1 / 363.1           |

The core FROST signing is about 40 ms (prepare 19, share 1–3, finalize 18).
Confirmation takes about 200 ms. The final benchmark passed 40 registrations and
80 verified signatures with zero retries.

Hosted 0.6.2: `signature_total` 1.234–2.683 s; `confirmed_to_signed`
5.237–8.710 s.

Staging, October 21 (20 per arm; median / p95, ms):

| Measurement                     | Baseline          | Candidate         |
| ------------------------------- | ----------------- | ----------------- |
| Full registration               | 2,418.5 / 3,426.7 | 2,283.4 / 3,257.9 |
| First NEP-413 sign              | 604.2 / 831.3     | 513.0 / 814.6     |
| Preparation before confirmation | 86.8 / 168.0      | 7.2 / 9.1         |
| Registration + first sign       | 3,101.2 / 4,035.2 | 2,868.6 / 3,742.5 |

Baseline, October 24 (dev `cb7fd391`, SDK/server 0.21.0; ms):

| Boundary                     |   n |  Median |     p95 |     Max |
| ---------------------------- | --: | ------: | ------: | ------: |
| Local NEAR-only registration |  20 |   553.6 |   606.9 |   742.5 |
| Hosted full registration     |  20 | 3,322.4 | 4,573.9 | 4,670.8 |
| Hosted after passkey         |  20 | 1,815.5 | 2,591.4 | 2,781.4 |
| Hosted first NEP-413         |  20 |   745.3 | 1,469.4 | 1,626.6 |

Trace capture, October 24: 21 transaction signatures and 1 message signature;
44 of 44 requests joined. Wallet-object invocations took 7–31 ms.

| Transaction (ms)         |   n |  Median |     Max |
| ------------------------ | --: | ------: | ------: |
| First, with funding      |   3 | 6,609.4 | 6,850.5 |
| Warm                     |   6 | 1,404.4 | 2,923.0 |
| First after unlock       |   3 |   843.8 | 1,426.9 |
| Consecutive after unlock |   9 | 1,058.9 | 2,191.4 |

Relayer RPC (20 interleaved pairs): a controlled delay showed an 83 ms saving on
both funding paths. Live testnet showed 1.6 ms (18 pairs, four HTTP 429s), so
the live gain is not proven.

## Open items

- No population p50/p95 exists. No ECDSA cohort has a p95 ≤ 3 s. The empty-pool
  first sign (5–10 s hosted) misses the 1–3 s target.
- Hosted Arc acceptance was never run: test gas was blocked by a faucet CAPTCHA.
- Warm NEAR signing in one retained-authenticator session is not captured. The
  about 4.3 s first-transaction context stage is not optimized.
- Expired-session recovery, refill after the last signing use, and the 0.5.27
  `wallet_session_reauthorization_required` failure are not verified.
- Router and SigningWorker CPU spikes (100–170 ms) have no function attribution.
- One hosted registration on October 24 failed at 47.54 s. Its cause is unknown.
  D1 waits of 754–888 ms with under 0.5 ms of SQL are not explained.
- Deferred: the Ed25519 nonce-commitment pool, more Yao/OT work, PostgreSQL or
  Hyperdrive integration, prewarm after Email OTP or unlock, and multi-wallet
  fairness tests.

## Rerun

The local NEAR benchmark (`tests/e2e/intended-behaviours/near-latency/`) was
removed on November 5, 2026. Restore it from `755873b3d`. The analyzer
`tests/scripts/analyze-near-local-latency.mjs` remains.

## Full record

[Original plans, per-release diaries, appendix and raw local JSON](https://github.com/seams-tech/seams-wallet/tree/7a3217307509da10a16b91d8472f4649be2b21f7/docs)
(`optimization-10*.md`, `optimization-11-NEAR*.md`, `optimization-11-NEAR-local-*.json`).
The JSON holds per-sample data and hydration subspans that this summary omits.

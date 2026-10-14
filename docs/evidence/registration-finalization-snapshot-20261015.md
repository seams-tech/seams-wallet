# Finalization database snapshot and CPU profile — October 15, 2026

The candidate removes one D1 round trip from fresh NEAR finalization. The local
comparison does **not** establish a latency gain. Staging remains unchanged while
Claude runs R155J acceptance. This is a follow-up to the closed
[R155H](../refactor-155H.md), not a reopening of that plan.

## Changes

Finalization already reads its ceremony, execution home, operation, lifecycle
decision, recorded passkey claim, and Yao admission in one database batch. That
batch now also selects the founding authority and authentication-method records.
The ceremony supplies their immutable IDs. Correlated lookups use each table's
full tenant-scoped primary key. No migration or new index is needed.

The reservation reuses that snapshot. This removes its later batch of two reads.
That batch previously overlapped Router consumption, so removing it need not
shorten the critical path in every request. ECDSA activation and resumed work
without a ceremony still read their founding records when needed.

An absent founding authentication method now uses an insert-only statement.
A competing insert aborts the transaction instead of overwriting the winner.
Existing authority extension guards and session-issuance checks stay in place.
Snapshot parsing remains lazy so completed replay works after ceremony cleanup.

The request fingerprint calculation now runs beside the initial D1 batch.
Its input, encoding, and digest remain identical. No authorization, ownership,
durability, or cancellation check was removed. Wallet/session commit, Console
acknowledgement, and terminal operation receipt retain their required order.

## Correctness

- Real D1 reservation/commit scenario passes: refused and lost directory claims,
  transaction rollback, concurrent lost-reply retries, exact replay, and an absent
  snapshot that becomes stale before commit. Reservation with a snapshot makes
  no additional database call. The stale snapshot cannot overwrite committed rows.
- Authorization storage-transfer E2E passes, including its relocation fences.
- Server type check and build, wallet-state type fixtures, and bloat check pass.
- Independent code review found no blocking issue. The mixed extension retains
  its current active-identity read and atomic state/digest/epoch checks. Revocation
  after an existing active snapshot was checked by inspection, not a new fault case.
- Eighteen fresh NEAR registrations, eighteen exact finalization replays, and
  eighteen first signatures pass locally. Node's Ed25519 verifier independently
  verifies each signature over a separately encoded NEP-413 payload. Altering the
  signed message fails verification. All eighteen public keys differ.
- A separate mixed ECDSA/NEAR registration passes setup, respond, activation,
  and deferred NEAR finalization. Reload, NEAR unlock, and signing pass; its
  signature verifies independently. This exercises the founding-authority
  extension as well as the fresh NEAR path.

## Combined local comparison

The order was control, combined candidate, then control again. Each group used
six fresh wallets and the same published 0.10.2 SDK and server WASM. Each wallet
used a fresh Chromium context and virtual passkey. The local Gateway uses the
previously verified local-composition fix. The measurements exclude profiler
control and include first-use samples. Finalization replay follows the measured
request and precedes the first signature.

| Local finalization request | Control | Candidate | Return to control |
| --- | ---: | ---: | ---: |
| Requests / verified signatures | 6 / 6 | 6 / 6 | 6 / 6 |
| Median elapsed time | 27 ms | 26 ms | 22.5 ms |
| Range | 23–37 ms | 23–43 ms | 22–46 ms |
| Median `near_finalize_total` | 17.5 ms | 16 ms | 14 ms |
| Request or signature failures | 0 | 0 | 0 |

Elapsed time was measured around Playwright's `route.fetch` to the local HTTP
Gateway. The SDK otherwise uses the normal HTTPS wallet/Gateway flow. These are
local timings, not browser-to-Singapore timings. Worker clock spans exclude some
CPU work; they are not CPU measurements. Six samples per group cannot establish
p99 or distinguish a small gain from runtime variation.

## CPU findings and instrument limits

The first local profile used a development-built session-sealing WASM file from
the temporary local candidate. Its SHA-256 differed from published 0.10.2:

- Development: `99bbb650019c6c07ea6cba1cc756c817cee954e347216177891256699461edd3`
- Published: `94a2c125a816d7547fcd7c53cc5fe8f9c13bf5621829aeba52effcc844b8f395`

That profile is excluded from production conclusions. After replacing all server
WASM assets with published 0.10.2 assets, three finalization-only profiles captured
162, 71, and 62 samples at a requested 100 microsecond interval. The first request
followed a local Worker reload. The latter two reused the Worker.

`addSigningSessionSealLock` accounts for 24, 14, and 15 inclusive samples.
Server lock-key derivation accounts for 19, 4, and 3. Other JavaScript work is
distributed across parsing, composition, authority construction, and persistence.
The small warm profiles do not support a broad CPU rewrite or a claim that the
hosted 42–48 ms CPU cost has been explained. Key derivation appears on each local
request, but caching secret-derived handles changes lifetime and cleanup behavior;
no such cache was added. Cryptographic implementations remain unchanged.

| Observation | Build overhead | Repeated JavaScript work | Hosted cold initialization |
| --- | --- | --- | --- |
| Initial profile used different WASM | Supports a local build mismatch | Does not isolate it | Does not measure it |
| Published WASM substantially reduces local samples | Supports build effect | Remaining samples are distributed | Does not measure it |
| First release-binary sample exceeds later samples | Consistent | Does not isolate it | Local evidence only |

The profile identifies code paths, not exact CPU milliseconds. Debugger sampling
adds overhead. The local host also composes Console services, unlike the deployed
Gateway. A matched hosted CPU profile is still needed for production attribution.

## Artifacts and next deployment

Private artifacts: `output/playwright/finalization-20261015/` in `seams-monorepo`.
They include scripts, raw per-wallet results, signature verification, comparison,
CPU profiles, source hashes, a candidate patch, built candidate hashes, and check
logs. `baseline-5`, `baseline-6`, and `baseline-7` are the published-WASM profiles.
Earlier profiles belong to the rejected development-binary probe.

Reproduce focused checks from `seams-wallet`:

```sh
node tests/e2e/registration-credential-reservation.e2e.mjs
node tests/e2e/authorization-storage-transfer.e2e.mjs
pnpm -C packages/wallet-server type-check
pnpm -C tests type-check:wallet-state
pnpm report:bloat --check
```

Do not activate a staging candidate during Claude's acceptance window. After that
window, capture current serving versions and bindings, build the coordinated
Gateway candidate, then measure control/candidate under matching conditions.
No npm release, staging activation, or Cloudflare resource creation occurred here.
The local comparison incurs no Cloudflare usage. The temporary profile page and
profiler service were removed/stopped, test browsers were closed, and the previous
local package candidate was restored.

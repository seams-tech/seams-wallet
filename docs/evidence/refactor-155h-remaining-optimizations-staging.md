# R155H — Remaining finalization changes, measured together on staging

Date: October 14, 2026, 17:07 to 17:54 JST. Plan:
[refactor-155H.md](../refactor-155H.md). Numbers:
[refactor-155h-remaining-optimizations-staging.json](refactor-155h-remaining-optimizations-staging.json).

## Result

Together, the changes below take 60 ms from the median finalization and
140 ms from its 90th percentile. The Gateway's finalization span falls by
50 ms at the median, and the first signature by 40 ms. No registration
failed in either arm, and all 396 signatures verify.

| Median, unless named | Control 1 | Candidate 1 | Control 2 | Candidate 2 |
| --- | ---: | ---: | ---: | ---: |
| After the passkey step | 1,645 ms | 1,449 ms | 1,435 ms | 1,359 ms |
| After the passkey step, 90th percentile | 1,912 ms | 1,866 ms | 1,851 ms | 1,785 ms |
| Finalize | 451 ms | 419 ms | 442 ms | 353 ms |
| Finalize, 90th percentile | 705 ms | 571 ms | 634 ms | 489 ms |
| Proof and execution (respond) | 1,093 ms | 962 ms | 924 ms | 931 ms |
| First signature | 376 ms | 351 ms | 360 ms | 304 ms |
| Gateway finalization span | 232 ms | 193 ms | 224 ms | 164 ms |
| Router consumption span | 52 ms | 36 ms | 52 ms | 34 ms |
| Wallet commit span | 56 ms | 38 ms | 54 ms | 35 ms |
| Session issue span | 47 ms | 35 ms | 31 ms | 31 ms |
| Gateway finalization CPU | 52 ms | 47 ms | 55 ms | 41 ms |

The after-passkey medians fall by 136 ms between the means of the two
arms, but 62 ms of that is respond, which none of these changes touches:
the first control arm had 38 late pair preparations against 16 to 21 in
the others. Count only the finalization part as an effect.

## What each change contributes

| Change | Commit | Evidence in this run |
| --- | --- | --- |
| Yao admission read in the finalization batch | `8b4dcf5f` | Router consumption span 52 → 35 ms |
| Founding records read beside the Router consumption | `f6422f37` | Wallet commit span 55 → 36.5 ms |
| Seal warm-up once per isolate | `1527b97f` | Finalization CPU 53.5 → 44 ms at the median; the signing requests also use 2 to 7 ms less CPU. Consistent with a warm seal, not isolated from the other changes |
| Respond retry after a transient D1 fault | `ec08890c` | No registration failed in 408. The retry writes no log line, so the run cannot show whether a retry happened |
| SDK session observation without the startup diagnostic | `7caae2fa` | Completion after `wallet_ready`: 14 ms at the median in both arms; largest 24 ms in control, 19 ms in the candidate |

## Method

- **Order.** Control 1, candidate 1, control 2, candidate 2, 99 wallets
  each, after one discarded warm-up group of three wallets per arm.
- **What changes.** Only the APAC Gateway and the test site change between
  arms. The control Gateway is the serving version `007f559b`; the
  candidate is version `6578fdc4`, built from `ec08890c` with the private
  host of `863978bc`. Both sites use the identical published 0.10.1 WASM
  binaries; the control site is built from `9f57952c`.
- **Switches.** Each switch waits until no registration is unfinished, then
  runs a protected activation (runs `38534084275`, `38535523534`,
  `38536920234`, `38538315048`).
- **Client.** A laptop in Tokyo, Chromium with a virtual authenticator.
  Every request entered Cloudflare in Tokyo.
- **Platform waits checked.** Deriver A wrote in 9.5 to 12 ms and Deriver B
  in 14 to 15 ms at the median in every arm. A Console write call took 23
  to 24 ms. So the slow-write state of the morning did not affect this run.
- **Restoration.** All 14 Workers serve their versions from before the run.

## Verification

- All 396 signatures verify with an independent Ed25519 check over an
  independent NEP-413 encoding, with 396 distinct keys.
- The full contract suite passes on `ec08890c`: 132 of 134 cases on release
  Workers, and the two debug-only cases on the debug Router.

## Open

- The seal warm-up's own share is not isolated. A comparison with and
  without only that commit would isolate it.
- The respond retry needs its own fault evidence: a scenario that injects a
  transient D1 fault into respond.
- None of these commits is published.

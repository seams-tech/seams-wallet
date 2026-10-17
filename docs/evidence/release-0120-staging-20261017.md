# Release 0.12.0 on staging — October 17, 2026

Release 0.12.0 serves on the staging Singapore lane. It carries `d8824ade`, which
makes the stateless Router call the Derivers and the Signing Worker again. All three
predictions of the [0.11.0 record](release-0110-staging-20261016.md#limits-and-predictions)
hold, so cold callee isolates were the cost of the 0.11.0 Router dispatch. 66 measured
registrations passed, with no failure. The R155J tail target is still not met.

## Deployment

| Step | Result |
| --- | --- |
| Pull request 44 | Merged at the checked head `d400602f` after six passing checks; `main` is `01c277d3` |
| npm | `@seams/wallet-server` 0.12.0 at 17:46 UTC, `@seams/wallet` 0.12.0 at 17:50 UTC (run `38936465758`) |
| Private pins | `seams-monorepo` `5c5ab046` on `dev`; `pnpm check`, `pnpm build` and the seams-site build pass |
| Backend | Run `38942967730`: every component deployed; the smoke step answered 403 before activation, as expected |
| Activation | Run `38944237874`, 03:03 JST; `readyz`, `healthz` and the ceremony JWKS answer 200 |
| Frontends | Run `38944511373`, 03:09 JST, wallet revision `01c277d3`. The first attempt hit a Cloudflare Pages "Unknown internal error" while it published the platform Console function; the rerun passed. The hosted wallet reports package 0.12.0 |
| Console | Not deployed; `a600e533` from another session serves |

A smoke group of three registrations passed. Its Router tail had no
`execute-registration` event and three `/router-wallet/v1/command` events per
wallet, as on 0.10.2.

## Population

One warm-up group, then two runs of 33 registrations, from 03:39 to 03:47 JST.
Each registration is followed by its first Ed25519 signature. The browser entered
Cloudflare in Tokyo (NRT) for every run. All 14 serving Worker versions were
recorded before the runs.

The run is at night. The 0.11.0 population ran at 15:36 JST; the closest 0.10.2
population in time of day is the acceptance run of October 15, 00:00 to 01:30 JST.

## Predictions

Medians unless marked. Events are linked per registration by the
`x-seams-trace-id` header; script `predictions.py` in the private
`seams-monorepo/.artifacts/r155j-release-0120/`.

| Population | Cold calls A / B / Signing Worker | Router start to first Deriver, p50 / p90 (ms) | Router event, p50 / p90 (ms) |
| --- | --- | --- | --- |
| Acceptance 0.10.2 | 13% / 14% / 7% | 88 / 177 | 766 / 1,367 |
| Control 0.10.2, 00:30 | 30% / 30% / 21% | 120 / 448 | 1,357 / 5,757 |
| Control 0.10.2, 00:46 | 24% / 24% / 21% | 119 / 251 | 851 / 1,528 |
| Control 0.10.2, 10:14 | 39% / 36% / 24% | 89 / 227 | 717 / 1,181 |
| 0.11.0 | 97% / 89% / 95% | 270 / 416 | 1,184 / 1,482 |
| **0.12.0** | **21% / 24% / 8%** | **64 / 147** | **699 / 1,136** |

1. The cold-start share is back in the 0.10.2 range (predicted 13 to 39%).
2. The Router starts the first Deriver 64 ms after its own start (predicted about
   90 to 120 ms). It is faster than 0.10.2 because the claim call stays short.
3. The Router event is 699 ms at the median, near and slightly below the 0.10.2
   runs without the slow Deriver A condition (717 to 851 ms).

## Browser stages

| Median / p90 (ms) | Acceptance 0.10.2 | 0.11.0 | 0.12.0 |
| --- | --- | --- | --- |
| Setup | 544 / 1,022 | 631 / 1,213 | 529 / 1,082 |
| Respond | 1,076 / 1,834 | 1,498 / 1,810 | 991 / 1,611 |
| Finalize | 395 / 707 | 408 / 607 | 432 / 853 |
| First signature | 370 / 764 | 374 / 562 | 312 / 773 |

| Measure | Acceptance 0.10.2 | 0.11.0 | 0.12.0 |
| --- | ---: | ---: | ---: |
| Wallets / failed | 203 / 1 | 66 / 0 | 66 / 0 |
| After passkey, p50 | 1,619 | 2,021 | 1,561 |
| After passkey, p95 | 3,025 | 2,497 | 2,830 |
| Without passkey, p99 | 5,966 | 4,166 | 4,564 |
| Without passkey, above 4 s | 11 (5.4%) | 2 (3.0%) | 3 (4.5%) |
| Deriver A preparations over 3 s | 0 | 0 | 0 |

Against the 0.10.2 acceptance run, the closest in time of day, 0.12.0 is faster at
the median and in the tail. Against the afternoon 0.11.0 run its p95 is higher; the
populations ran 12 hours apart, so that difference does not isolate a release effect.
66 attempts are too few for a p99 claim.

## The slowest registrations

The six slowest after the passkey step (2,672 to 4,553 ms) lose their time in:

- **Respond, Router role execution:** one registration with a 3,061 ms role
  execution and a 680 ms Yao admission bind (4,553 ms in total); one with a
  1,775 ms role execution.
- **Respond, Yao admission bind:** one registration with a 1,083 ms bind.
- **Finalize:** three registrations with 1,480, 1,749 and 1,892 ms.

None of them waits in the Router dispatch. The finalize and admission-bind waits
are the next R155J candidates.

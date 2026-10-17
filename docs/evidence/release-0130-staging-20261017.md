# Release 0.13.0 on staging — October 17, 2026

Release 0.13.0 serves on the staging Singapore lane. It carries `b42b35be`: the
registration response no longer waits for the Console completion. The completion
record activates the home and records a pending publication in Gateway D1; the
Gateway sends the completion after the response, and its cron resends a failed one.
Finalize lost its slow tail: p95 858 ms against 1,381 ms on 0.12.0. 66 measured
registrations passed, with no failure. The R155J tail target is still not met.

## Deployment

| Step | Result |
| --- | --- |
| Pull request 45 | Merged at the checked head `7c763cad` after "Validate wallet" passed; `main` is `41b32aca` |
| npm | `@seams/wallet` and `@seams/wallet-server` 0.13.0 at 16:15 JST (run `39009809609`) |
| Private pins | `seams-monorepo` `eda7c5d1` on `dev`, with the Gateway cron resumption and the cutover count; `pnpm check`, `pnpm build` and the seams-site build pass |
| Backend | Run `39013067278`: every component deployed; migration `0081` applied to the four regional Gateway databases; the smoke step answered 403 before activation, as expected |
| Activation | Run `39013712625`, 16:29 JST; `readyz`, `healthz` and the ceremony JWKS answer 200 |
| Frontends | Run `39013804940`, 16:31 JST, wallet revision `41b32aca`; both wallet origins report package 0.13.0 |
| Console | Not deployed; `2c3d8504` serves |

## Population

One warm-up group, then two runs of 33 registrations, from 17:00 to 17:08 JST, 31
minutes after the activation. Each registration is followed by its first Ed25519
signature. The browser entered Cloudflare in Tokyo (NRT) for every run. All 14
serving Worker versions were recorded before the runs. The 0.12.0 population ran at
03:39 JST; the time of day can move a median by about 270 ms.

## Predictions

The predictions were written before the runs.

1. **The response no longer waits for Console.** The Gateway span
   `near_finalize_session_issue` held the Console completion. It is 0 / 0 ms at
   p50 / p90, against 32 / 198 ms on 0.12.0.
2. **Every completion reaches Console.** All 66 finalizations have their Console
   `/complete` call. After the runs, no row is pending in any of the four regional
   Gateway databases, and all 69 wallets of the period (3 warm-up, 66 measured) are
   `established` in the Console and listed in its wallet list.
3. **Finalize loses its slow tail.** Browser finalize p95 is 858 ms (predicted about
   1,210 ms from the 0.12.0 data); the median does not change beyond the noise.

A check that compared the Console call with the Gateway's seal log could not
separate the two releases, because that log comes from the seal preparation and not
from the last step before the response. It is not used.

| Finalize (ms) | p50 | p90 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| 0.12.0, browser | 432 | 853 | 1,381 | 1,892 |
| **0.13.0, browser** | **444** | **721** | **858** | **965** |
| 0.12.0, Gateway `session_issue` | 32 | 198 | | |
| **0.13.0, Gateway `session_issue`** | **0** | **0** | | |

The custody reservation (`publish-routes`) is now the slowest finalize stage: 76 / 216
ms at p50 / p90, against 32 / 282 ms at night on 0.12.0.

## Browser stages

| Median / p90 (ms) | 0.12.0 | 0.13.0 |
| --- | --- | --- |
| Setup | 529 / 1,082 | 702 / 1,076 |
| Respond | 991 / 1,611 | 1,038 / 1,481 |
| Finalize | 432 / 853 | 444 / 721 |
| First signature | 312 / 773 | 379 / 752 |

| Measure | 0.12.0 | 0.13.0 |
| --- | ---: | ---: |
| Wallets / failed | 66 / 0 | 66 / 0 |
| After passkey, p50 | 1,561 | 1,618 |
| After passkey, p95 | 2,830 | 2,631 |
| Without passkey, p99 | 4,564 | 5,068 |
| Without passkey, above 4 s | 3 (4.5%) | 2 (3.0%) |

66 attempts are too few for a p99 claim. The populations ran 13 hours apart, so the
medians do not isolate a release effect; the finalize spans do.

## The slowest registrations

The three slowest after the passkey step (3,107 to 3,353 ms) are the first group of
run A. They lose their time in respond (2.3 to 2.7 s: the Router Yao execution 1.4 to
2.1 s, the Deriver pair preparation up to 971 ms, the Yao admission bind up to 618 ms)
and two of them in setup (1.4 and 2.1 s: wallet object startup and the Console
context). Their finalize took 538 to 965 ms. The slowest registrations of run B take
2.0 to 2.2 s. No finalize is among the causes of the slowest registrations.

## Singapore client

The same lane, measured the same evening from a temporary virtual machine in Singapore
(Google Cloud `asia-southeast1`), against a Tokyo client in alternating runs of 33
registrations, 18:28–18:57 JST. Only the browser ran in Singapore; the test harness drove it
through an SSH tunnel. Each harness command therefore crossed the tunnel, so the totals of the
Singapore client are not valid. The stage times are: the client's own work inside a stage
stayed at 27 ms or less at the median (Tokyo: 6 ms). The table uses the sum of the three
registration stages, without the passkey step.

| Setup + respond + finalize (ms) | p50 | p95 | p99 | max | Above 4 s |
| --- | ---: | ---: | ---: | ---: | ---: |
| Singapore, 66 | 2,018 | 3,099 | 3,343 | 3,422 | 0 |
| Tokyo, 66 | 2,211 | 3,309 | 5,061 | 6,811 | 2 |

From Singapore, a third of the registrations entered Cloudflare in Hong Kong (HKG), not in
Singapore. A Gateway health check from the machine took 130 to 600 ms to its first byte, and
the static wallet origin 370 to 510 ms, so routing and the edge add a variable cost that is
not in our code. 66 registrations from one network and one evening are not an acceptance
population.

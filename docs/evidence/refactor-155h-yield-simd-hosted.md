# Hosted table-frame yield and SIMD comparison — October 12, 2026

On staging, the table-frame yield lowers the Router's Yao execute request from
**1,605 ms to 1,340 ms** at the median, and the SIMD build lowers it to
**1,300 ms**. The real protocol time falls from 821 ms to 686 ms to 634 ms.
Registration after setup measured 2,931, 2,763 and 2,600 ms. Every execution
of the run was the first protocol run of its isolate, in both Derivers. All
36 signatures passed independent verification. Staging was restored and
independently checked.

## Fixed inputs

- Three sides, one after the other, each with a discarded warm-up group and
  three measured groups of three wallets.

| Side | Deriver A | Deriver B |
| --- | --- | --- |
| control | isolate counter only, `97451f20` | isolate counter |
| yield | counter and table-frame yield, `6ec1c61d` | the control's version |
| simd | the yield sources, built with `+simd128`, `c4080499` | counter, built with `+simd128` |

- The Gateway, Console, Router and Signing Worker serve the verified
  October 12 staging deployment on every side. No tenant activation ran.
- One frozen production-built SDK site in every group, the site of the
  [final R155G comparison](refactor-155g-final-staging.md).
- Chromium runs in Tokyo against the Hong Kong layout with real preflights.
  Wallets use APAC homes and implicit NEAR accounts.
- The five Deriver versions were uploaded without serving and inherit every
  binding of the serving versions. A deployment switch selects them.

## Measured results

SDK timings over nine wallets per side: median, then the 90th percentile.

| Workload | Control | Yield | Yield and SIMD |
| --- | ---: | ---: | ---: |
| Registration, excluding WebAuthn | 3,579 / 3,938 ms | 3,533 / 3,863 ms | **3,123 / 3,755 ms** |
| Registration after setup | 2,931 / 3,287 ms | 2,763 / 3,094 ms | **2,600 / 2,733 ms** |
| Registration plus first signature | 4,093 / 4,594 ms | 4,108 / 4,363 ms | **3,538 / 4,248 ms** |
| Yao execute POST, browser | 1,574 / 1,869 ms | 1,456 / 1,723 ms | **1,395 / 1,586 ms** |
| Setup stage | 531 / 1,006 ms | 595 / 820 ms | 486 / 1,022 ms |
| Respond stage | 237 / 258 ms | 223 / 313 ms | 199 / 211 ms |
| Finalization stage | 842 / 1,096 ms | 831 / 1,061 ms | 764 / 885 ms |

The execute request is the stage the changes touch. Setup, respond and
finalization run identical versions on every side and still differ by 30 to
110 ms at the median, so the registration totals carry that drift. The
attributable gain is the execute request: about 120 ms from the yield and
about 180 ms with SIMD at the median, and about 280 ms at the 90th percentile.

The Router's execute span by part, from the Worker records of 8, 9 and 7
executions: median, then the 90th percentile where it matters.

| Part | Control | Yield | Yield and SIMD |
| --- | ---: | ---: | ---: |
| Router execute request | 1,605 / 1,752 ms | 1,340 / 1,602 ms | **1,300 / 1,464 ms** |
| Protocol, real time | 821 / 1,082 ms | 686 / 769 ms | **634 / 647 ms** |
| Protocol, Deriver A's clock span | 435 ms | 240 ms | 199 ms |
| Deriver A CPU | 339 / 607 ms | 344 / 529 ms | 314 / 448 ms |
| Deriver B CPU | 291 / 443 ms | 286 / 448 ms | 239 / 362 ms |
| Deriver A admission | 138 ms | 112 ms | 106 ms |
| Pair connection | 156 ms | 165 ms | 152 ms |
| First protocol run of its isolate, A and B | 8 of 8 | 9 of 9 | 7 of 7 |

- **The yield works on the production path.** Deriver A's clock span, which
  is its wait for Deriver B, falls from 435 ms to 240 ms while its CPU stays
  at 340 ms: Deriver B now evaluates while Deriver A garbles.
- **SIMD lowers the CPU of a first run less than of a warm run.** On the
  benchmark pair's warm isolates Deriver A's CPU fell by a quarter. Here it
  falls from 344 ms to 314 ms, and Deriver B's from 286 ms to 239 ms.
- **Every execution is a first run.** The isolate counter read zero in all 24
  measured executions and all nine warm-up executions, in both roles. A new
  wallet's objects run the protocol in an isolate that has never run it. On
  the benchmark pair a warm Deriver A needs 164–230 ms of CPU for the same
  ceremony. The compute prewarm of R155H Phase 4 addresses this difference.
- **The tail narrows.** The real protocol time's 90th percentile falls from
  1,082 ms to 769 ms to 647 ms.

## Verification and restoration

- All 36 registrations and signatures passed the browser workload, warm-ups
  included.
- Node.js independently verified all 36 NEP-413 signatures with its own
  payload encoder. Changed message, recipient, nonce and callback URL were
  rejected.
- All 38 comparison checks passed: three verified samples per group,
  identical versions within each side, only the two Derivers differing
  between sides, every invocation of the nine measured groups on its expected
  version, the counter in every execution, and the restoration.
- In the discarded warm-up group of the SIMD side, one stateless request of
  each Deriver ran the previous version three seconds after the switch. The
  warm-up exists for this.
- The driver restored the original Deriver versions. An independent read
  confirmed all 14 staging Workers on their original versions, and the Gateway
  answered its readiness check. The five uploaded versions remain listed and
  do not serve.

## Limits

- Nine wallets per side cannot resolve less than about 0.3 s between sides
  for the whole registration. The execute request and the chain carry the
  result.
- The sides ran one after the other, not interleaved.
- The tail delivered no Deriver B object record for three executions, so the
  chain holds 24 of 27.

The [sanitized JSON record](refactor-155h-yield-simd-hosted.json) holds every
sample, the chain per side, the builds and the checks.

## Reproduction

The private directory is `.artifacts/r155h-yield-hosted/` in `seams-monorepo`;
its README gives the order. After the driver finishes:

```sh
python3 analyze.py
python3 chain-sides.py
python3 ../r155f-yao-chain/yao-chain.py .
node verify-proofs.mjs
python3 export-evidence.py
```

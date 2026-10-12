# Hosted benchmark pair and the table-frame yield — October 12, 2026

The bare activation ceremony takes **520–640 ms of real time** on Cloudflare
today, not the 202 ms that the July campaign reported. The July figure is the
Worker clock, and the Worker clock excludes the invocation's own CPU time. One
turn of the event loop after each table frame cuts the real time to
**290–350 ms** in Tokyo and to 455–485 ms in Hong Kong, with identical
protocol bytes. A build with WebAssembly SIMD enabled cuts it again, to
about 277 ms, with no source change. The pair was deployed for these runs
only and is deleted.

## Fixed inputs

- `crates/ed25519-yao-cloudflare-bench` at `67ac0f5d`: Deriver A and Deriver B
  as two stateless Workers on one `DERIVER_B` Service Binding WebSocket, the
  activation circuit with fixed fixtures, 128 KiB frames, 17 table frames,
  2.1 MB from A to B. No admission, product checks, sealing or durable record.
- Release Worker builds with `worker-build` 0.8.5, deployed with Wrangler
  4.111.0. The yield variant adds the measurement-only Cargo feature
  `yield-after-table-frame`: a zero-length `worker::Delay` after each table
  frame is queued.
- A Node.js client in Tokyo sends sequential POSTs. The first ceremony of each
  run is discarded. `wrangler tail` records CPU and wall time per invocation.
- Tokyo runs have no placement. Hong Kong runs set `placement.region` to
  `aws:ap-east-1`, the region of staging's custody path.

## Measured results

Medians per run, in milliseconds. Client wall and the tail's wall time are
real durations. The Worker clock is Deriver A's own protocol duration, the
July metric.

| Run | Ceremonies | Client wall p50 / p90 | Worker clock p50 | A wall | A CPU | B CPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Local workerd, M4 Pro | 6 | 139 / 143 | 135 | | | |
| Tokyo, control 1 | 21 | 590 / 616 | 251 | 582 | 353 | 181 |
| Tokyo, yield 1 | 21 | 353 / 387 | 106 | 333 | 231 | 189 |
| Tokyo, control 2 | 21 | 535 / 563 | 346 | 520 | 216 | 295 |
| Tokyo, yield 2 | 21 | 319 / 339 | 94 | 292 | 195 | 184 |
| Tokyo, control 3 | 21 | 643 / 677 | 359 | 608 | 307 | 259 |
| Tokyo, yield 3 | 21 | 318 / 352 | 95 | 306 | 220 | 191 |
| Hong Kong, control 0 | 31 | 658 / 1,301 | 372 | 583 | 275 | 285 |
| Hong Kong, control 1 | 31 | 732 / 1,447 | 401 | 648 | 311 | 292 |
| Hong Kong, yield 1 | 31 | 573 / 1,258 | 184 | 485 | 323 | 295 |
| Hong Kong, control 2 | 31 | 708 / 1,574 | 299 | 624 | 330 | 241 |
| Hong Kong, yield 2 | 31 | 528 / 1,292 | 103 | 455 | 321 | 186 |

The runs alternate control and yield on the same Worker names, so a drift of
the serving machines does not explain the difference.

## What the runs establish

- **The Worker clock excludes own CPU.** In every control run Deriver A's
  clock reads 250–400 ms while its invocation lasts 520–650 ms; the difference
  is close to A's reported CPU time. A clock span therefore measures waits
  only. The July 202 ms, the production `deriver_a.yao_protocol` span and the
  "CPU work that the clock does not show" of R155F are the same effect. No
  separate delay follows Deriver A's last frame.
- **The platform costs about four times the laptop for this code.** The same
  WebAssembly runs a ceremony in 139 ms on local workerd and in 520–640 ms
  deployed. CPU per ceremony is 200–350 ms for A and 180–300 ms for B, and it
  varies by serving machine, not by repetition: twenty warm ceremonies on one
  run show no downward trend.
- **A new isolate costs 400–1,000 ms of CPU once.** The first ceremony of an
  isolate used 600–1,370 ms of CPU in Deriver A against 200–350 ms warm. With
  a placement region, 6 to 8 of 31 ceremonies met a new isolate, which sets
  the p90 near 1.3–1.6 s in both variants.
- **Garbling and evaluation ran one after the other.** The transport's `send`
  queues a WebSocket message and returns. Deriver A garbles and queues all 17
  frames before it first waits, so no frame leaves until garbling ends, and
  Deriver B starts evaluating only then. Real time is the sum of both roles'
  CPU.
- **One event-loop turn per table frame restores the overlap.** Each frame
  leaves before the next is garbled. Real time fell by 230–290 ms in Tokyo,
  41–50%, and by 140–190 ms in Hong Kong, 22–29%, in three and two alternating
  pairs of runs. The protocol messages, their order and their bytes are
  unchanged.

## A build with WebAssembly SIMD

A third series compares two builds of the yield variant: the default build,
and the same sources with `RUSTFLAGS="-C target-feature=+simd128"` for both
roles. No source line differs. Tokyo, no placement, 21 ceremonies per run,
alternating.

| Run | Client wall p50 / p90 | A wall | A CPU | B CPU |
| --- | ---: | ---: | ---: | ---: |
| Local workerd, default build | 137 and 141 | | | |
| Local workerd, SIMD build | 126 and 126 | | | |
| Tokyo, default 4 | 329 / 380 | 309 | 225 | 190 |
| Tokyo, SIMD 1 | 277 / 292 | 260 | 170 | 166 |
| Tokyo, default 5 | 315 / 328 | 294 | 203 | 179 |
| Tokyo, SIMD 2 | 277 / 293 | 263 | 176 | 159 |
| Tokyo, default 6 | 481 / 509 | 455 | 258 | 289 |
| Tokyo, SIMD 3 | 364 / 392 | 332 | 164 | 241 |

The compiler's vector code alone lowers the ceremony by 12–24% on the
platform and by 9% locally. Deriver A's CPU falls from 203–258 ms to
164–176 ms, and Deriver B's by 11–17%. The last pair of runs landed on a
slower machine; the difference holds there.

## Limits

- A benchmark pair is not production. Production runs the roles in two wallet
  objects and adds admission, target proofs, sealing and a durable record.
  The production transport has the same `send`, and its hosted saving is
  measured separately.
- Tail sampling delivered 11 to 16 of 21 invocations in the Tokyo runs.
- The Hong Kong runs enter at the Tokyo edge; their client wall includes the
  hop to the placement region.

The [JSON record](refactor-155h-probe-hosted.json) holds every sample.
Reproduce with the crate's README: build both roles, deploy B then A, drive
`scripts/run_same_account_benchmark.mjs`, tail both Workers, delete both.

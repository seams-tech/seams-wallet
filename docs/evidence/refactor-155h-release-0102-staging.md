# R155H — Release 0.10.2 on staging

Date: October 14, 2026, 21:26 to 21:50 JST. Plan:
[refactor-155H.md](../refactor-155H.md). Numbers:
[refactor-155h-release-0102-staging.json](refactor-155h-release-0102-staging.json).

## Result

The released 0.10.2 lane shows the server-side gains of the
[A/B/A/B comparison](refactor-155h-remaining-optimizations-staging.md). The
Gateway's finalization span is 200 and 182 ms at the median, against 232 and
224 ms on the 0.10.1 controls. No registration failed, and all 198
signatures verify.

The browser totals of these runs are not comparable with the afternoon
runs. About 80% of the requests after the passkey step entered Cloudflare in
Seattle or Portland, not in Tokyo. Each such request then travels to the
Singapore Gateway and back. The cause is outside the Workers and is not
established; the same routing was seen on October 13 from about 21:30 to
23:30 JST.

## Server side

These figures do not depend on the entry location.

| Median, unless named | Control 1 | Control 2 | Candidate 1 | Candidate 2 | 0.10.2 run A | 0.10.2 run B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Gateway finalization span | 232 ms | 224 ms | 193 ms | 164 ms | 200 ms | 182 ms |
| Router consumption span | 52 ms | 52 ms | 36 ms | 34 ms | 39 ms | 34 ms |
| Wallet commit span | 56 ms | 54 ms | 38 ms | 35 ms | 40 ms | 37 ms |
| Gateway finalization CPU | 52 ms | 55 ms | 47 ms | 41 ms | 48 ms | 42 ms |
| Gateway finalization CPU, 90th percentile | 89 ms | 86 ms | 79 ms | 71 ms | 79 ms | 62 ms |

The controls and candidates are the arms of the A/B/A/B comparison, 17:07
to 17:54 JST, with every request entering in Tokyo.

## Browser

| Median | 0.10.2 run A | 0.10.2 run B |
| --- | ---: | ---: |
| After the passkey step, all 99 wallets | 2,009 ms | 1,900 ms |
| After the passkey step, wallets entering in Japan only | 1,780 ms (15) | 1,480 ms (20) |
| Finalize, Japan only | 436 ms | 363 ms |
| First signature, all wallets | 810 ms | 766 ms |
| First signature, Japan only | 456 ms | 323 ms |

The Japan-only wallets of run B match the candidate arms of the afternoon:
1,359 to 1,449 ms after the passkey step, finalize 353 to 419 ms, first
signature 304 to 351 ms. Run A has 15 such wallets, too few for a claim.

## Method and checks

- **Release.** Pull request 42, `main` `70f5674f`, publish run
  `38551794394`. npm showed both packages when the run ended.
- **Deployment.** Private pins `80dfe173`. Console run `38558168414`,
  backend run `38558593639`, activation run `38559792947` (20:54 JST),
  frontend run `38560001842`. All 14 Workers serve their latest uploads.
- **Runs.** One discarded warm-up group, then two runs of 99 wallets from
  30 minutes after the activation. The test site is built from the
  published `@seams/wallet@0.10.2` package.
- **Platform waits.** Deriver A wrote in 10 to 11 ms and Deriver B in 16 to
  17 ms at the median; a Console route write took 25 to 26 ms. Late pair
  preparations: 16 and 17 of 99, a normal count.
- **Faults.** No Gateway request answered other than 200, no invocation
  raised an exception, and no seal warm-up failed.
- **Signatures.** All 198 verify with an independent Ed25519 check over an
  independent NEP-413 encoding, with 198 distinct keys.

## Open

- A measurement of the browser totals needs requests that enter in Tokyo:
  repeat it in the afternoon, or after the routing returns.

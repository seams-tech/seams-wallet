# R155H — Release 0.9.4 on the Singapore staging lane

Date: October 13, 2026, 16:06 to 16:53 JST. Plan:
[refactor-155H.md](../refactor-155H.md). Numbers:
[refactor-155h-release-094-staging.json](refactor-155h-release-094-staging.json).

## Result

Release 0.9.4 makes the Yao execution about 60 ms shorter. Registration
after the passkey step measures 1,876 ms at the median against 1,915 ms on
0.9.3 in the same hour. The 90th percentile did not change: 2,468 ms against
2,455 ms.

| After the passkey step | 0.9.3 | 0.9.4 |
| --- | ---: | ---: |
| Wallets | 99 | 198 |
| Minimum | 1,450 ms | 1,420 ms |
| 10th percentile | 1,581 ms | 1,550 ms |
| Median | 1,915 ms | 1,876 ms |
| 90th percentile | 2,455 ms | 2,468 ms |
| 95th percentile | 2,947 ms | 2,657 ms |
| Maximum | 4,090 ms | 11,039 ms |
| Less than 2.0 s | 59% | 63% |
| Less than 2.5 s | 92% | 90% |
| 3.0 s or more | 5% | 3% |

The change of the whole interval, 39 ms at the median, is not larger than
the difference between two runs of one release. The change of the Yao
execution is: both 0.9.4 runs show it in the browser stage, in the Router's
request and in the Deriver CPU.

## Method

- **Lane, client and sample.** As in the
  [0.9.3 record](refactor-155h-release-093-staging.md): the Singapore staging
  lane, Chromium with a virtual authenticator on a laptop in Tokyo, one fresh
  NEAR implicit registration and one first NEP-413 signature per wallet,
  three wallets per browser group.
- **Before.** Published 0.9.3 on every Worker, one run of 99 wallets, taken
  17 minutes before the deployment.
- **After.** Published 0.9.4 on every Worker, two runs of 99 wallets. The
  first uses the test site of the 0.9.3 run. The second uses a site built
  from the published 0.9.4 package.
- **Server evidence.** `wrangler tail` on the Router, both Derivers, the
  Signing Worker, the APAC Gateway and the Console.
- **No interleaving.** One lane serves one release, so the sides ran one
  after the other.

| Run | Release | Client | Start, JST | Wallets | Median | 90th percentile |
| --- | --- | --- | --- | ---: | ---: | ---: |
| 1 | 0.9.3 | published 0.9.3 | 16:06 | 99 | 1,915 ms | 2,455 ms |
| 2 | 0.9.4 | published 0.9.3 | 16:33 | 99 | 1,890 ms | 2,524 ms |
| 3 | 0.9.4 | published 0.9.4 | 16:44 | 99 | 1,870 ms | 2,401 ms |

The two 0.9.4 runs differ by 20 ms at the median and by 123 ms at the 90th
percentile.

**The time of day matters.** The 0.9.3 runs of 03:28 to 03:46 JST measured
1,734 ms at the median with the formula of that record. This formula gives
1,642 ms for them. The same release measured 1,915 ms at 16:06 JST.
Compare runs of the same hour only.

## Stages in the browser

| Stage, ms | p50 0.9.3 | p50 0.9.4 | Change | p90 0.9.3 | p90 0.9.4 | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Setup | 520 | 534 | +14 | 963 | 817 | −146 |
| Passkey step, virtual authenticator | 515 | 504 | −11 | 647 | 634 | −13 |
| Respond | 234 | 232 | −2 | 385 | 361 | −24 |
| Yao execute | 1,007 | 946 | −61 | 1,398 | 1,320 | −78 |
| Finalize | 567 | 576 | +9 | 888 | 908 | +20 |
| Client work after finalize | 53 | 55 | +2 | 60 | 59 | −1 |
| **After the passkey step** | **1,915** | **1,876** | **−39** | **2,455** | **2,468** | **+13** |
| Registration without the passkey step | 2,544 | 2,517 | −27 | 3,307 | 3,283 | −24 |
| First signature | 448 | 443 | −5 | 791 | 692 | −99 |
| Registration and signature, no interaction | 3,097 | 3,043 | −54 | 3,917 | 3,845 | −72 |

The Yao stage alone, per run: 1,007 ms on 0.9.3, then 952 ms and 938 ms on
0.9.4.

## What the server evidence attributes

**Yao execution, about 60 ms.** The engine change of the release wipes a
wire label with one write and hashes the garbler's four blocks in one cipher
pass. The protocol bytes are the same.

| Invocation | Wall p50 0.9.3 | Wall p50 0.9.4 | CPU p50 0.9.3 | CPU p50 0.9.4 |
| --- | ---: | ---: | ---: | ---: |
| Gateway, Yao execute | 855 ms | 799 ms | 9 ms | 9 ms |
| Router, execute | 783 ms | 720 ms | 26 ms | 25 ms |
| Deriver A, pair object, execute work | 580 ms | 524 ms | 250 ms | 196 ms |
| Deriver B, pair object, duplex | 370 ms | 307 ms | 207 ms | 182 ms |
| Deriver B, pair preparation | 134 ms | 139 ms | 5 ms | 6 ms |
| Signing Worker, activation delivery | 635 ms | 575 ms | 30 ms | 31 ms |

The Deriver CPU fell by 54 ms (22%) for the garbler and by 25 ms (12%) for
the evaluator. The engine benchmark measured half and two thirds for the
garbling and the evaluation alone. The rest of the execution CPU is
oblivious transfer, hashing and framing, which the release does not change.

| Execution | Deriver A CPU p50 | Deriver B CPU p50 | Count A, B |
| --- | ---: | ---: | ---: |
| 0.9.3, first run after a completed ceremony | 251 ms | 210 ms | 93, 90 |
| 0.9.3, later run in the same isolate | 177 ms | 164 ms | 4, 2 |
| 0.9.4, first run after a completed ceremony | 196 ms | 184 ms | 186, 181 |
| 0.9.4, later run in the same isolate | 125 ms | 150 ms | 7, 9 |

**The start-up ceremony costs less.** It runs the same engine. The CPU of
the wallet-start invocation fell from 345 ms to 283 ms on Deriver A and from
339 ms to 271 ms on Deriver B. The ceremony completed before the real
execution in 186 of 190 Deriver A starts and in 186 of 188 Deriver B starts.

**Finalization did not change.** The release changes nothing there. The
Gateway's finalization total measures 308 ms at the median against 309 ms,
and 627 ms against 592 ms at the 90th percentile.

## Outliers

No sample failed: 99 of 99 on 0.9.3 and 198 of 198 on 0.9.4.

- **One 0.9.4 wallet waited 8.8 s before its finalization began.** The
  Gateway's finalization request lasted 9,165 ms with 82 ms of CPU. The
  finalization itself measured 278 ms. Its first call to another Worker left
  the Gateway 8.84 s after the request arrived, and none of the six Workers
  with a tail ran in between. The wait is therefore before the registration
  service starts: in the upload of the request body, or in the Gateway's
  selection of the wallet home, which reads the body. The release changes no
  code there, and one event in 198 wallets does not show a cause. No wallet
  of the earlier runs on this lane, 461 wallets on 0.9.0 and 0.9.3, took
  longer than 5.9 s after the passkey step.
- **One first signature took 10.2 s on 0.9.4**, nine minutes after the
  Gateway's deployment. Three Workers of its sign-prepare chain used
  start-up amounts of CPU in the same request: the Gateway 975 ms and the
  Router 751 ms, against 36 ms and 4 ms at the median, and the Signing
  Worker 788 ms. The registration of the same wallet was normal, 1,925 ms.
  This is the pattern of a host that runs the new versions for the first
  time. The second run has no such request.
- **The other slow wallets** waited in one finalization span or in the Yao
  execution, on both releases. The slowest 0.9.3 wallet, 4,090 ms, waited
  1.2 s in the custody reserve and 1.1 s in the session issue. On 0.9.4 one
  wallet waited 2.2 s in the Router consume, and two had a Yao execute stage
  of 2.7 s and 2.8 s.

[R155J](../refactor-R155J-p99.md) owns these waits.

## Verification

- All 198 signatures of the 0.9.4 runs verify with an independent Ed25519
  check over an independent NEP-413 encoding. Changed messages, recipients,
  nonces and callback URLs are rejected. The 198 keys are distinct.
- All 14 staging Workers serve one version each, the latest upload of each.
  The runs uploaded nothing.
- One group of three wallets passed with the published 0.9.4 client before
  the runs.

## Deployment record

Public `main` `79423316`, publish run `38356125919`. Private `dev`
`3f4fdb45` pins 0.9.4. Console run `38361801956` and backend run
`38362259221` deployed every component. The backend run ends with a failed
smoke step by design: a new Gateway version answers 403 until the protected
activation verifies it. Activation run `38363192264` passed. The lane
refused requests for about five minutes, from 16:27 to 16:32 JST.

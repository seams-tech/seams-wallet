# R155H — Release 0.9.3 on the Singapore staging lane

Date: October 13, 2026, 01:15 to 03:46 JST. Plan:
[refactor-155H.md](../refactor-155H.md). Numbers:
[refactor-155h-release-093-staging.json](refactor-155h-release-093-staging.json).

## Result

Registration after the passkey step fell from 2,332 ms to 1,734 ms at the
median and from 3,044 ms to 2,221 ms at the 90th percentile. On 0.9.3, 80% of
the wallets finish in less than 2.0 s after the passkey step. On 0.9.0, 12%
did.

| After the passkey step | 0.9.0 | 0.9.3 |
| --- | ---: | ---: |
| Wallets | 198 | 164 |
| Minimum | 1,676 ms | 1,229 ms |
| 10th percentile | 1,982 ms | 1,470 ms |
| Median | 2,332 ms | 1,734 ms |
| 90th percentile | 3,044 ms | 2,221 ms |
| 95th percentile | 3,395 ms | 2,593 ms |
| Maximum | 5,839 ms | 5,013 ms |
| Less than 2.0 s | 12% | 80% |
| Less than 2.5 s | 67% | 94% |
| 3.0 s or more | 11% | 3% |

## Method

- **Lane.** `staging-testnet` after the clean switch: every APAC component and
  database in Singapore, the tenant activated on October 13.
- **Client.** Chromium with a virtual authenticator on a laptop in Tokyo. The
  test site is served locally under the staging origins. Requests to the
  Gateway use the real network.
- **Sample.** One fresh NEAR implicit registration and one first NEP-413
  signature per wallet, three wallets per browser group. The test verifies
  each signature against the registered key.
- **Before.** Published 0.9.0 on every Worker. Six runs of 33 wallets between
  01:15 and 03:09 JST.
- **After.** Published 0.9.3 on every Worker. Three runs between 03:28 and
  03:46 JST: 98, 33 and 33 wallets.
- **Client build.** All runs but the last use one frozen site, a local build
  of the SDK source of October 12 that already holds the client changes of
  0.9.3. The last run of 33 wallets uses a site built from the published
  0.9.3 package. Its median is the same.
- **Server evidence.** `wrangler tail` on the Router, both Derivers, the
  Signing Worker, the APAC Gateway and, from the third run on, the Console.
  The Gateway's `Server-Timing` header gives the finalization spans.
- **No interleaving.** One lane serves one release, so the sides ran one after
  the other. The run medians give the noise.

| Run | Release | Start, JST | Wallets | Median | 90th percentile |
| --- | --- | --- | ---: | ---: | ---: |
| 1 | 0.9.0 | 01:15 | 33 | 2,389 ms | 3,301 ms |
| 2 | 0.9.0 | 01:28 | 33 | 2,438 ms | 3,151 ms |
| 3 | 0.9.0 | 01:33 | 33 | 2,277 ms | 2,757 ms |
| 4 | 0.9.0 | 01:39 | 33 | 2,354 ms | 2,887 ms |
| 5 | 0.9.0 | 01:43 | 33 | 2,326 ms | 2,963 ms |
| 6 | 0.9.0 | 03:05 | 33 | 2,225 ms | 3,069 ms |
| 7 | 0.9.3 | 03:28 | 98 | 1,730 ms | 2,210 ms |
| 8 | 0.9.3 | 03:39 | 33 | 1,739 ms | 2,282 ms |
| 9 | 0.9.3, published client | 03:43 | 33 | 1,730 ms | 2,133 ms |

Two runs of the same release differ by up to 213 ms at the median and 544 ms
at the 90th percentile with 33 wallets. The change between the releases is
about 600 ms at the median. The last 0.9.0 run, at 03:05, measured about
130 ms less than the mean of the five runs before 02:00, so up to that much
of the change can be drift.

## Stages in the browser

**Measurement correction, October 13:** the original `Client work after finalize`
and `After the passkey step` rows below reconstruct the end from the setup stage
and the whole SDK duration. That mixes two start points and includes earlier
initialization. They remain below as historical reported figures. Console-event
intervals give **54.32 ms** median after finalize and **1,642.35 ms** after the
passkey step for 0.9.3. These intervals include observer delivery uncertainty.
Registration without interaction and first-signature durations are unaffected.
See the [correction and implementation record](refactor-155h-setup-sdk-completion.md).

| Stage, ms | p50 0.9.0 | p50 0.9.3 | Change | p90 0.9.0 | p90 0.9.3 | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Setup | 548 | 424 | −124 | 1,062 | 823 | −239 |
| Passkey step, virtual authenticator | 500 | 593 | +93 | 671 | 694 | +23 |
| Respond | 235 | 192 | −43 | 435 | 258 | −177 |
| Yao execute | 1,286 | 862 | −424 | 1,836 | 1,293 | −543 |
| Finalize | 602 | 477 | −125 | 947 | 678 | −269 |
| Client work after finalize | 134 | 144 | +10 | 155 | 152 | −3 |
| **After the passkey step** | **2,332** | **1,734** | **−598** | **3,044** | **2,221** | **−823** |
| Registration without the passkey step | 2,966 | 2,215 | −751 | 3,845 | 3,010 | −835 |
| First signature | 454 | 326 | −128 | 857 | 560 | −297 |
| Registration and signature, no interaction | 3,527 | 2,609 | −918 | 4,523 | 3,583 | −940 |

## What the server evidence attributes

**Yao execution, about 430 ms.** The Router's execute request fell from
1,100 ms to 669 ms at the median.

| Invocation | Wall p50 0.9.0 | Wall p50 0.9.3 | CPU p50 0.9.0 | CPU p50 0.9.3 |
| --- | ---: | ---: | ---: | ---: |
| Gateway, Yao execute | 1,153 ms | 720 ms | 10 ms | 8 ms |
| Router, execute | 1,100 ms | 669 ms | 36 ms | 22 ms |
| Deriver A, pair object, execute work | 832 ms | 525 ms | 332 ms | 216 ms |
| Deriver B, pair object, duplex | 589 ms | 314 ms | 286 ms | 178 ms |
| Deriver B, pair preparation | 182 ms | 122 ms | 12 ms | 5 ms |
| Signing Worker, activation delivery | 890 ms | 539 ms | 34 ms | 28 ms |

Three changes act here, and this run does not separate them: the event-loop
turn after each table frame, the SIMD build, and the start-up ceremony. The
hosted comparison of October 12 measured the first two alone at 305 ms of the
Router's request.

**The start-up ceremony.** It finished before the real execution in 144 of
147 Deriver A starts and in 148 of 151 Deriver B starts. It was stopped by
arriving work 2 and 3 times. One Deriver A object never started; see the
outliers.

| Execution | Deriver A CPU p50 | Deriver B CPU p50 | Count A, B |
| --- | ---: | ---: | ---: |
| 0.9.0, every execution; the release logs no run index | 332 ms | 286 ms | 198, 195 |
| 0.9.3, first run after a completed ceremony | 217 ms | 182 ms | 144, 137 |
| 0.9.3, first run after a stopped ceremony | 246 ms | 208 ms | 2, 3 |
| 0.9.3, later run in the same isolate | 160 ms | 151 ms | 15, 7 |

The ceremony costs CPU at every wallet start, used or not: Deriver A's
wallet-start invocation rose from 28 ms to 303 ms of CPU and Deriver B's from
14 ms to 295 ms. A setup that nobody finishes therefore costs about 0.6 s of
Deriver CPU. Setup has no rate limit of its own; the plan records that gap.

**Finalization, about 80 ms.** The Gateway's finalization total fell from
306 ms to 228 ms at the median and from 595 ms to 434 ms at the 90th
percentile. The new span `near_finalize_authority_reserve` measured 0 ms in
all 164 finalizations: every one found the claim that respond had started.
In the run of 98 wallets the Console received 98 passkey claims, each after
respond started and before the execute request started, 968 ms before
finalization at the median. No claim record stayed behind: the table held
zero rows after the runs. The Gateway logged no failed early claim.

| Finalization span, ms | p50 0.9.0 | p50 0.9.3 | p90 0.9.0 | p90 0.9.3 |
| --- | ---: | ---: | ---: | ---: |
| Initial read | 12 | 10 | 24 | 14 |
| Passkey claim, `authority_reserve` | inside the side effect | 0 | | 0 |
| Custody reserve | 38 | 41 | 198 | 84 |
| Router consume | 50 | 38 | 195 | 60 |
| Wallet commit | 106 | 100 | 243 | 206 |
| Custody commit | 18 | 16 | 33 | 55 |
| Session issue | 24 | 26 | 53 | 87 |
| Total | 306 | 228 | 595 | 434 |

**Not attributed, about 100 ms after the passkey step.** Respond fell by
43 ms and the part of finalize outside the Gateway's total by about 45 ms.
Setup fell by 124 ms and the first signature by 128 ms. Release 0.9.3 changes
nothing in those paths on purpose. Every role Worker call measured shorter,
for example the Router's sign request at 55 ms against 74 ms. The release
builds are smaller and use SIMD, and the nightly drift is in the same range.
This record does not decide between them.

## Outliers and the failed sample

- **One failed sample of 165 on 0.9.3.** Setup answered HTTP 400 with
  `D1_ERROR: Network connection lost.` after 124 ms. Classified
  `environment_or_infrastructure_failure`: a transient fault of the Gateway's
  database connection. Setup does not retry it, and it returns the driver's
  message with a client-error status. The 0.9.0 runs had no such fault.
- **Slowest wallet on 0.9.3, 5,013 ms.** Deriver A's wallet object was not
  reachable for about 3 s twice: its start request was cancelled at the
  Gateway's 3 s limit during setup, and the execution waited 2.85 s before
  the object ran. It ran without the start-up ceremony. The 0.9.0 runs hold
  the same kind of outlier, with Deriver A requests of up to 3.9 s.
- The 3 s outliers are not caused by the release and the release does not
  remove them.

## Verification

- All 164 signatures of the 0.9.3 runs verify with an independent Ed25519
  check over an independent NEP-413 encoding. Changed messages, recipients,
  nonces and callback URLs are rejected. The 164 keys are distinct.
- All 14 staging Workers served one version each during the runs, the latest
  upload of each. The runs uploaded nothing.
- Migration `0078` is present on the four Gateway databases.

## Deployment record

Public `main` `e4f883f7`, publish run `38283099821`. Private `dev` `5115cd3`
pins 0.9.3. Console run `38289350037` and backend run `38289630699` deployed
every component. The backend run ends with a failed smoke step by design: a
new Gateway version answers `tenant_deployment_unavailable` until the
protected activation verifies it. Activation run `38290821236` passed.

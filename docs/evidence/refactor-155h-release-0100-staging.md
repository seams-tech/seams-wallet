# R155H — Release 0.10.0 on the Singapore staging lane

Date: October 13 and 14, 2026, 23:42 to 00:51 JST. Plan:
[refactor-155H.md](../refactor-155H.md). Numbers:
[refactor-155h-release-0100-staging.json](refactor-155h-release-0100-staging.json).

## Result

Registration after the passkey step measures 1,747 ms at the median on
0.10.0, against 2,096 ms on 0.9.4 in the hour before: 349 ms less. The 90th
percentile fell from 2,764 ms to 2,494 ms. 73% of the wallets finish in less
than 2.0 s after the passkey step; on 0.9.4 in that hour, 40% did.

| After the passkey step | 0.9.4 | 0.10.0 |
| --- | ---: | ---: |
| Wallets | 99 | 197 |
| Minimum | 1,543 ms | 1,198 ms |
| 10th percentile | 1,750 ms | 1,403 ms |
| Median | 2,096 ms | 1,747 ms |
| 90th percentile | 2,764 ms | 2,494 ms |
| 95th percentile | 3,206 ms | 2,824 ms |
| Maximum | 7,513 ms | 5,762 ms |
| Less than 2.0 s | 40% | 73% |
| Less than 2.5 s | 83% | 90% |
| 3.0 s or more | 6% | 3% |

The absolute numbers of this night are higher than the afternoon numbers of
the [0.9.4 record](refactor-155h-release-094-staging.md), where 0.9.4
measured 1,876 ms. Compare the two columns of this table with each other
only.

**Later finding, October 14.** Both columns include a cost of the private
Console that grew with the number of wallets in the staging environment:
151 ms at the median in the 0.9.4 runs and 167 to 185 ms in the 0.10.0
runs, inside finalization. The difference between the columns stands. The
[0.10.1 record](refactor-155h-release-0101-staging.md) holds the finding
and the figures after the correction.

## Method

- **Lane, client and sample.** As in the earlier records: the Singapore
  staging lane, Chromium with a virtual authenticator on a laptop in Tokyo,
  one fresh NEAR implicit registration and one first NEP-413 signature per
  wallet, three wallets per browser group.
- **Before.** Published 0.9.4 on every Worker, one run of 99 wallets from
  23:42 to 23:53 JST with the published 0.9.4 client.
- **After.** Published 0.10.0 on every Worker, two runs of 99 wallets from
  00:25 to 00:45 JST. The client is a build of the SDK at the release commit:
  npm released the SDK package 56 minutes after its publication, after the
  runs had started. One group of the first run failed, so it holds 98
  wallets.
- **Entry location.** Every request of the three runs entered Cloudflare in
  Tokyo. Earlier that evening, between about 21:30 and 23:30 JST, Cloudflare
  received up to 63% of this client's requests in Portland, Sydney, Osaka
  and Boston, which adds 150 to 300 ms to each request. Those runs are not
  used.
- **Console.** The private Console changed twice that evening for unrelated
  work, and one version made two of its calls on this path 300 ms slower.
  The baseline was taken after the correction, and the 0.10.0 runs use the
  same Console code.
- **Server evidence.** `wrangler tail` on the Router, both Derivers, the
  Signing Worker, the APAC Gateway and the Console. In the baseline run the
  tails delivered about one third of the events, so its server rows hold 33
  to 35 samples. The browser rows are complete.

| Run | Release | Start, JST | Wallets | Median | 90th percentile |
| --- | --- | --- | ---: | ---: | ---: |
| 1 | 0.9.4 | 23:42 | 99 | 2,096 ms | 2,764 ms |
| 2 | 0.10.0 | 00:25 | 98 | 1,722 ms | 2,682 ms |
| 3 | 0.10.0 | 00:35 | 99 | 1,758 ms | 2,255 ms |

## Stages in the browser

On 0.10.0 the respond request carries the Yao execution, so the two stage
names changed their content. The row "proof and execution" adds both stages
for each wallet.

| Stage, ms | p50 0.9.4 | p50 0.10.0 | Change | p90 0.9.4 | p90 0.10.0 | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Setup | 578 | 583 | +5 | 1,198 | 1,103 | −95 |
| Passkey step, virtual authenticator | 485 | 466 | −19 | 627 | 620 | −7 |
| Proof and execution | 1,331 | 1,065 | −266 | 1,640 | 1,601 | −39 |
| Finalize | 680 | 502 | −178 | 1,157 | 905 | −252 |
| Client work after finalize | 55 | 96 | +41 | 59 | 99 | +40 |
| **After the passkey step** | **2,096** | **1,747** | **−349** | **2,764** | **2,494** | **−270** |
| Registration without the passkey step | 2,855 | 2,479 | −376 | 3,712 | 3,484 | −228 |
| First signature | 532 | 362 | −170 | 1,027 | 677 | −350 |
| Registration and signature, no interaction | 3,504 | 2,920 | −584 | 5,017 | 4,056 | −961 |

## What the server evidence attributes

**One request for the proof and the execution, about 270 ms.** The browser
sends one request where it sent two, and it prepares its inputs during the
prompt.

| Invocation | Wall p50 0.9.4 | Wall p50 0.10.0 | CPU p50 0.9.4 | CPU p50 0.10.0 |
| --- | ---: | ---: | ---: | ---: |
| Gateway, respond | 173 ms | 936 ms | 16 ms | 26 ms |
| Gateway, Yao execute | 900 ms | not sent | 12 ms | |
| Gateway, both | 1,073 ms | 936 ms | 28 ms | 26 ms |
| Router, execute | 787 ms | 721 ms | 29 ms | 26 ms |
| Deriver A, pair object, execute work | 602 ms | 441 ms | 210 ms | 186 ms |
| Signing Worker, activation delivery | 631 ms | 524 ms | 32 ms | 30 ms |

The Gateway's time for both steps fell by 137 ms. The rest of the 266 ms is
the round trip that no longer exists and the client's input preparation,
which now runs during the prompt.

**Pair preparation during the prompt.** After setup the Gateway asks the
Router to admit both Derivers and to connect them. The Router's preparation
request takes 699 ms at the median, in the background of the passkey prompt.
The browser's setup stage did not change. The Router's execute request fell
by 66 ms and Deriver A's execute work by 161 ms. The plan estimated 0.3 s
for the execute request; the Router's request still holds a pair
preparation span of 142 ms at the median, and Deriver B still reads its root
at execution.

The start-up ceremony of the Derivers now runs in the preparation request,
not at wallet start: its CPU moved from the wallet-start invocation (310 ms
to 0 ms on Deriver A) to the preparation invocation (317 ms). Arriving work
stopped it in 20 of 188 cases on Deriver A and in 21 of 177 on Deriver B.
On 0.9.4 that was about 2% of the cases.

**Finalization, about 180 ms.** Registration no longer reads and rewrites
the shared capability record.

| Finalization, ms | p50 0.9.4 | p50 0.10.0 | p90 0.9.4 | p90 0.10.0 |
| --- | ---: | ---: | ---: | ---: |
| Gateway request, wall | 616 | 427 | 1,270 | 856 |
| Gateway request, CPU | 146 | 48 | 277 | 83 |
| Finalization total | 372 | 261 | 781 | 627 |
| Wallet commit | 175 | 56 | 330 | 105 |

**First signature, 170 ms.** A signing admission takes its material from
the signer row and does not read the shared record. The Gateway's CPU fell
from 47 ms to 17 ms in sign-prepare and from 33 ms to 18 ms in sign; their
wall times fell from 357 ms to 194 ms and from 283 ms to 193 ms.

**Client work after finalize, +41 ms.** Not attributed.

## Faults found by this deployment

- **Setup answered 500 for a provided wallet id.** The private Console's
  activation canary sends a setup with a provided wallet id that is not in
  the server-allocated format. On 0.10.0 setup builds the Yao admission
  description, and the step that computes the signing key id was outside
  the guard that withholds a failed description. Setup answered 500 where
  0.9.4 answered 200, and three activation runs failed. Real clients, which
  ask for a server-allocated wallet, were not affected: the lane served
  0.10.0 registrations in that time. The canary now sends the request of a
  real client, and the fourth activation passed. `1ae2df5b` puts both steps
  inside one guard; it is on `dev` and not released.
- **One sample of 198 failed at respond.** Respond answered HTTP 400 with
  `D1_ERROR: Network connection lost.` Classified
  `environment_or_infrastructure_failure`. Respond does not retry a
  transient database fault and returns the driver's text with a
  client-error status, as setup did before 0.9.4. With the execution inside
  respond, more of the registration depends on that request.
- **The SDK package appeared late.** `@seams/wallet-server@0.10.0` was on
  the registry within 15 minutes. `@seams/wallet@0.10.0` appeared 56 minutes
  after its publish step reported success.

## Verification

- All 197 signatures of the 0.10.0 runs verify with an independent Ed25519
  check over an independent NEP-413 encoding. The 197 keys are distinct.
- All 14 staging Workers serve one version each, the latest upload of each.
- After the activation, a wallet registered and signed with the 0.10.0
  client.
- **Cutover proof.** The test site built from the published 0.9.4 package
  gets HTTP 409 and shows "Your wallet application needs an update. Reload
  this page and try again."

## Deployment record

Public `main` `96cf6d85` (pull request 39), publish run `38406958758`.
Private `dev` pins the server package since `c245e0a7` and the SDK package
since `c7ec1df3`; `ade5e075` changes the canary. Console runs `38417792320`
and `38425041847`, backend run `38418189153`, which applied Gateway
migrations `0079` and `0080` and Deriver migration `0020`. Activation runs
`38419908767`, `38420261237` and `38420676853` failed at the canary;
`38425377639` passed at 00:50 JST. The staging frontends were not deployed:
their last deployment is of September 16.

# Release 0.11.0 on staging — October 16, 2026

Release 0.11.0 serves on the staging Singapore lane. 66 measured registrations
passed, with no failure. The R155J tail target is still not met, and 66 attempts
are too few for a p99 claim. Respond is about 400 ms slower at the median than in
every 0.10.2 population. The added time is in the Router wallet object, before
and after the Deriver calls; `18b09520` moved the registration orchestration
into that object.

## Deployment

| Step | Result |
| --- | --- |
| npm | `@seams/wallet-server` 0.11.0 at 05:45 UTC, `@seams/wallet` 0.11.0 at 05:47 UTC (run `38853336503` on `main` `aedbe786`) |
| Private pins | `seams-monorepo` `a5dbf249` on `dev`: ten pins, two release-age exclusions, and three changes for the removed Express entry |
| Backend | Run `38857937018`: every component deployed; the smoke step answered 403 before activation, as expected |
| Activation | Run `38858871724`, 15:02 JST |
| Frontends | Run `38859011577`, 15:05 JST, wallet revision `aedbe786`; the hosted wallet reports package 0.11.0 |
| Console | Not deployed by this release. Another session deployed Console `a600e533` at 15:31 JST, four minutes before the runs |

All 14 serving Worker versions were recorded before the runs. The Router,
Derivers, Signing Worker and tenant-root control plane serve the uploads of
05:54 to 05:55 UTC; the Gateways and wallet runtimes serve those of 05:56 to
05:57 UTC.

## Population

One warm-up group, then two runs of 33 registrations, from 15:36 to 15:44 JST.
Each registration is followed by its first Ed25519 signature. The browser entered
Cloudflare in Tokyo (NRT) for every run. The harness was the 0.11.0 source tree
and a test app built against the published 0.11.0 package.

The 0.10.2 populations are the [acceptance run](refactor-155j-acceptance-0102.md)
of October 15, 00:00 to 01:30 JST, and three controls of October 16
([record](refactor-155j-followups-20261015.md)). The controls ran at 00:30, 00:46
and 10:14 JST; the slow Deriver A condition of that night affected the first one. No 0.10.2 population ran at the same time as 0.11.0. A tail gain against
the controls therefore does not show an effect of 0.11.0.

| Population | Wallets / failed | After passkey p50 / p90 / p95 / max (ms) | Without passkey p50 / p95 / p99 (ms) | Above 4 s |
| --- | ---: | --- | --- | ---: |
| Acceptance 0.10.2 | 203 / 1 | 1,619 / 2,563 / 3,025 / 5,770 | 2,307 / 4,032 / 5,966 | 11 (5.4%) |
| Control 0.10.2, 00:30 | 33 / 0 | 2,744 / 7,734 / 8,099 / 10,142 | 3,835 / 9,523 / 12,241 | 15 |
| Control 0.10.2, 00:46 | 33 / 0 | 2,070 / 2,832 / 4,638 / 7,309 | 3,085 / 6,275 / 8,278 | 9 |
| Control 0.10.2, 10:14 | 33 / 0 | 2,308 / 3,767 / 4,130 / 8,856 | 4,142 / 11,867 / 19,166 | 20 |
| **0.11.0** | **66 / 0** | **2,021 / 2,353 / 2,497 / 2,932** | **2,779 / 3,798 / 4,166** | **2 (3.0%)** |

Interpolated p99. "Without passkey" is the R155J measure. Its target is a p99 of
4 s and at most 1% above 4 s. The 0.11.0 p99 rests on less than one observation.

| Stage, median / p90 (ms) | Acceptance 0.10.2 | 0.11.0 |
| --- | --- | --- |
| Setup | 544 / — | 631 / — |
| Respond | 1,076 / 1,834 | 1,498 / 1,810 |
| Finalize | 395 / 707 | 408 / 607 |
| First signature | 370 / — | 374 / — |

No Deriver A preparation took more than 3 s in 0.11.0 (9 of 33 in the 00:30
control).

## The respond regression

The Router's own `Server-Timing` steps for respond, median / p90 (ms):

| Population | `yao_router_execution` | `yao_router_prepare_pair` | `yao_router_role_execution` | Browser respond |
| --- | --- | --- | --- | --- |
| Acceptance 0.10.2 | 805 / 1,464 | 149 / 465 | 575 / 1,057 | 1,076 / 1,834 |
| Control 0.10.2, 00:46 | 882 / 1,636 | 170 / 540 | 644 / 1,327 | 1,352 / 2,117 |
| Control 0.10.2, 10:14 | 758 / 1,211 | 141 / 542 | 537 / 1,041 | 1,456 / 2,076 |
| 0.11.0 | 1,232 / 1,540 | 469 / 624 | 909 / 1,208 | 1,498 / 1,810 |

The Worker tails place the time. The reference is the stateless Router
`execute` event in both versions; its clock is real time. The Deriver events are
the stateless Deriver B `prepare-pair` and Deriver A `execute-pair` events inside
it.

| Median / p90 (ms) | Acceptance 0.10.2 | Control, 10:14 | Control, 00:46 | 0.11.0 |
| --- | --- | --- | --- | --- |
| Router start to first Deriver start | 88 / 177 | 89 / 227 | 119 / 251 | 270 / 416 |
| Deriver A execution | 534 | 471 | 596 | 568 |
| Deriver A answer to Router end | 93 / 262 | 98 / 297 | 99 / 337 | 298 / 403 |
| Router execute event | 773 / 1,389 | 717 / 1,181 | 851 / 1,528 | 1,184 / 1,482 |

The Deriver work did not change. The Router adds about 180 ms before the Deriver
calls and about 200 ms after Deriver A answers. The wallet object's
`execute-registration` event starts 10 ms after the stateless event and ends
10 ms before it, so both waits are inside the object.

The start wait has two modes. Measured from the object's event, 9 of 66 runs
started the Derivers within 13 to 23 ms, and the other 57 after 189 to 476 ms.
Seven of the nine fast runs used 57 to 108 ms of object CPU, as the slow runs did
(52 to 122 ms), so object CPU does not explain the wait. In the two events read
in full, the object's clock read 13 and 15 ms when it sent the Deriver requests;
that clock does not move during CPU work or during writes.

What the object does in each wait:

- Before the Deriver calls, `execute_in_wallet` commits the claim in a storage
  transaction and then sends both requests. Its comment says the output gate
  holds those requests until the claim write is confirmed.
- After Deriver A answers, the object delivers the package to the Signing Worker
  (`yao_router_signing_worker_delivery` 45 ms at the median, 110 ms at p90), commits the finish in a second transaction, and
  answers. The answer waits for that confirmation.

In 0.10.2, the same two transactions ran in two short `/router-wallet/v1/command`
calls from the stateless Router; `router_wallet.rs` and the transaction code are
unchanged. There, the whole interval before the Deriver calls, including the
claim call and its confirmation, was 88 to 119 ms at the median.

Inference, not proven: a write confirmation that holds outbound requests or the
reply of a long object request takes about 200 ms longer on the hosted platform
than one that holds the reply of a short command. A local run cannot show this:
`workerd` confirms writes at once. The [orchestration record](registration-router-orchestration-20261016.md)
measured only local runs and left the hosted savings unmeasured.

The B half of `18b09520` is not on this path. Deriver B's `prepare-pair` event
took 200 ms (121 to 157 ms in 0.10.2) and 68 to 72 ms of CPU (7 to 24 ms), and it
still ends before Deriver A answers.

## Gateway steps

0.11.0 is the first release with Gateway step timing (`b948567b`). Medians / p90
(ms), 66 registrations:

| Route | Largest steps |
| --- | --- |
| Setup (browser 622) | `setup_context` 109 / 287, `setup_wallet_objects` 80 / 376, `setup_ceremony` 21 / 27, `setup_rate_limit` 15 / 26 |
| Respond (browser 1,496) | `yao_router_execution` 1,232 / 1,540, `yao_admission_bind` 36 / 168, `respond_authority_verify` 12 / 21 |
| Sign prepare (browser 307) | `ed25519_sign_proxy` 86 / 183, `ed25519_sign_admit` 38 / 55 |
| Sign (browser 307) | `ed25519_sign_proxy` 93 / 245, `ed25519_sign_admit` 15 / 28 |

`setup_context` is mostly the Console `registration-setup` call: Console wall
84 and 102 ms at the median in the two runs, up to 1,330 ms. The slowest registrations without the
passkey step were one `setup_wallet_objects` of 1,193 ms, one Router execution of
2,167 ms, and one `setup_context` of 969 ms.

## Files

The raw runs, tails, serving snapshots and scripts are in the private
`seams-monorepo/.artifacts/r155j-release-0110/` (`compare.py`,
`execute_timeline.py`, `setup_context.py`) and use the kit in
`.artifacts/r155h-singapore-anchor/` (`steps.py`).

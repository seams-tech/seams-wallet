# Registration through the relocated role databases — 11 October 2026

Nine new wallets registered and signed through the Hong Kong role databases.
This is the registration proof that the role-database move still owed.
The run does **not establish a latency change**, for the move or for the candidate.
Every group was slower than on 10 October, including stages that the move did
not touch. The 3–4 s registration-to-first-signature target remains unmet.

The run also exposed a measurement limit. The harness serves browser assets
through Playwright request interception, and an intercepting browser answers
every CORS preflight locally. **No group includes the preflight exchanges that
a real browser sends**: four for registration and two for the first signature.

## Comparison

The run used three new wallets per group on existing staging testnet resources.
The client ran Chromium in Tokyo and used the APAC Gateway. Each wallet enabled
only NEAR signing, used an implicit account, and produced a NEP-413 signature.
Funding and blockchain confirmation were outside the flow.

The baseline used the candidate hosts of 10 October: public `941e01b3` and
private `535af1b`. The candidate used public `f23050fc` and private `87db272`.
The control repeated the exact baseline Worker versions after the candidate.
All three groups used the same browser payload and the same four custody Worker
versions. Those custody versions are exact copies of the set of 10 October with
the Hong Kong database bindings: Router `aa1cf297`, Deriver A `fd1c1f00`,
Deriver B `4c70417b`, and Signing Worker `c39367f9`.

The candidate adds capability installation without ceremony writes and commits
the capability with the wallet records.

## Results

These are paired SDK measurements. Registration excludes its measured WebAuthn
interaction. First signing excludes its measured confirmation interaction.
Signature proofs were verified independently after collection.

| Workload | Baseline median (range) | Candidate median (range) | Repeated baseline median (range) |
| --- | ---: | ---: | ---: |
| Registration, excluding WebAuthn | 5.193 s (4.905–6.652) | 5.265 s (5.064–6.107) | 4.924 s (4.259–6.288) |
| Registration, including WebAuthn | 5.359 s (5.051–7.391) | 5.425 s (5.322–6.601) | 5.256 s (4.571–6.992) |
| First signature, excluding confirmation | 1.022 s (0.973–1.694) | 1.115 s (0.850–1.299) | 0.981 s (0.972–1.406) |
| Registration plus first signature, excluding interaction | 6.599 s (6.166–7.674) | 6.179 s (6.115–7.406) | 5.905 s (5.665–7.259) |

Each cell contains three observations. The two baseline groups ran the same
Worker versions and differ by 269 ms. That difference exceeds the difference
between the candidate and either baseline.

| Stage median | Baseline | Candidate | Repeated baseline |
| --- | ---: | ---: | ---: |
| SDK setup | 850 ms | 851 ms | 685 ms |
| SDK respond | 342 ms | 548 ms | 390 ms |
| SDK custody execution | 2,060 ms | 1,956 ms | 2,295 ms |
| SDK finalization | 1,753 ms | 1,908 ms | 1,409 ms |
| Gateway finalization service | 1,189 ms | 1,438 ms | 1,003 ms |

## Comparison with 10 October

The baseline hosts of this run are the candidate hosts of 10 October. That
earlier group measured 4.354 s for registration. The same hosts measured 5.193 s
and 4.924 s here.

| Finalization median, same hosts | 10 October | This run, first group | This run, repeated group |
| --- | ---: | ---: | ---: |
| Gateway finalization service | 796 ms | 1,189 ms | 1,003 ms |
| Home admission read, Gateway database | 9 ms | 18 ms | 13 ms |
| Wallet commit, Gateway database | 64 ms | 95 ms | 86 ms |
| Custody commit, Gateway database | 66 ms | 92 ms | 75 ms |
| Route claim, Console | 219 ms | 338 ms | 264 ms |
| Router consume | 81 ms | 145 ms | 95 ms |
| Capability installation | 179 ms | 287 ms | 180 ms |

The spans that use only the Gateway database or only Console were slower in
both groups of this run. The move did not touch those databases. The spans that
use the role Workers slowed by the same ratio or by less. The run therefore
cannot attribute the slower figures to the move, and it cannot show a saving
from it.

One custody span improved in every group. Deriver A's preparation inside the
execution had group medians of 193–199 ms on 10 October (range 184–202 ms) and
120–130 ms here (range 112–181 ms). That stage reads and writes the Deriver A
database, which moved from Osaka to Hong Kong. The preparation overlaps other
custody work, so its saving is not a saving of the whole execution.

## Requests and D1 work

Counts were identical across all three wallets within each group.

| Completed calls per flow | Baseline | Candidate | Repeated baseline |
| --- | ---: | ---: | ---: |
| Gateway setup D1 | 5 | 5 | 5 |
| Gateway respond D1 | 6 | 6 | 6 |
| Gateway execute D1 | 2 | 2 | 2 |
| Gateway finalize D1 | 15 | 14 | 15 |
| Gateway sign prepare D1 | 3 | 3 | 3 |
| Gateway sign D1 | 4 | 4 | 4 |
| **Gateway D1 total** | **35** | **34** | **35** |
| **Console D1 total** | **14** | **14** | **14** |
| Console requests | 5 | 5 | 5 |
| Browser requests | 6 | 6 | 6 |

## Finalization dependency

The candidate's finalization has three parts that wait for another service.
The figures are the observed ranges of three samples.

| Part of the candidate's finalization | Observed |
| --- | ---: |
| Router consume, credential claim and route claim, concurrent | 295–522 ms |
| Console completion inside session issuance | 131–413 ms |
| Gateway CPU time for the whole request | 265 ms median |

The route claim set the length of the first part in two of three samples.
It cannot fail a registration, so the wallet commit does not need its result.
Console executed the claim, the credential claim and the completion in 59–200 ms
each. The Gateway waited longer than that for each one.

## Preflight exchanges

A probe in Chromium without request interception measured the exchanges that
this harness omits. It ran from Tokyo against the staging Gateway.

| Request from a page of the wallet origin | Observed |
| --- | ---: |
| First POST to a route, with its preflight | 283–301 ms |
| Preflight alone | 125–191 ms |
| Later POST to the same route | 106–118 ms |
| POST to a route after an early `OPTIONS` fetch to it | 107 ms |

The browser caches a preflight for each URL. A registration and its first
signature call six different URLs, so a new user pays six preflights.

## Restoration

The driver restored all 13 original Worker versions and the original Deriver
admission schema. A separate read of the live versions and schemas confirmed it.
The role databases held 822 Deriver A admissions after the baseline group.
They held 819 before it.

The machine-readable record is
[`refactor-155f-relocated-hosted.json`](./refactor-155f-relocated-hosted.json).

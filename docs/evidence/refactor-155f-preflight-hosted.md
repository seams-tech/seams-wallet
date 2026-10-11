# Registration with real preflights — 11 October 2026

Two staging runs measured registration without request interception, so the
browser sent its real CORS preflights. They are the first hosted runs that
count them.

An SDK payload that sends its preflights early registered in **3.530 s** at the
median. The unchanged payload took 5.129 s on the same Worker versions.
Registration plus the first signature took **4.204 s** against 6.102 s.
At the time of the runs the early-preflight payload was an uncommitted patch.
Commit `99a34b73` contains it now. Its saving is larger than the preflight
exchanges alone explain, and that part is not yet understood.

## Setup

Both runs used three new wallets per group on existing staging testnet
resources. The client ran Chromium in Tokyo. The APAC Gateway is pinned to
Hong Kong. Each wallet enabled only NEAR signing, used an implicit account,
and produced a NEP-413 signature. Funding and blockchain confirmation were
outside the flow. All 18 signature proofs were verified independently.

The harness served the browser assets from a local HTTPS server and mapped the
staging hosts to it in Chromium. The Gateway tail shows one `OPTIONS` request
per route and wallet. Earlier runs show none.

## Run A: finalization without the custody waits

The baseline hosts are public `f23050fc` and private `87db272`. The candidate
hosts are public `490c3d50` and private `605c9a0`. The candidate contains commit
`edc7d5f9`, which stops the wallet commit and the session issuance from waiting
on custody, and the Console passkey claim in one D1 batch.

| Workload | Baseline median (range) | Candidate median (range) |
| --- | ---: | ---: |
| Registration, excluding WebAuthn | 5.142 s (4.354–6.164) | 4.802 s (4.386–5.293) |
| First signature, excluding confirmation | 1.200 s (0.875–1.551) | 1.125 s (0.797–1.265) |
| Registration plus first signature, excluding interaction | 6.693 s (5.555–7.040) | 6.067 s (5.183–6.419) |
| Gateway finalization service | 908 ms (814–1,170) | 780 ms (741–843) |
| Console D1 calls per registration | 14 | 13 |
| Gateway finalization D1 calls | 14 | 14 |

In the candidate the wallet commit started when the Router consume and the
credential claim had settled. In one sample the route claim took 270 ms and the
credential claim 86 ms, and the wallet commit did not wait for the route claim.
The run has no repeated baseline, so it does not bound its own drift.

The third group of this run used the early-preflight payload and failed in the
test, not in the product. The test read a JSON body from every response on a
registration route, and the early `OPTIONS` responses have none. The three
registrations completed on the server. The driver restored staging. The test
now reads only POST responses.

## Run B: early preflights on identical hosts

Every group used the same 13 Worker versions, the candidate set of run A. Only
the browser payload changed. The groups alternated: unchanged, early
preflights, unchanged, early preflights.

| Workload, six wallets each | Unchanged payload | Early preflights |
| --- | ---: | ---: |
| Registration, excluding WebAuthn | 5.129 s (4.080–5.658) | **3.530 s (3.306–4.147)** |
| First signature, excluding confirmation | 1.076 s (0.924–1.417) | **0.649 s (0.562–0.778)** |
| Registration plus first signature, excluding interaction | 6.102 s (5.174–6.903) | **4.204 s (3.948–4.794)** |

| Group, in run order | Registration median | Registration plus first signature |
| --- | ---: | ---: |
| Unchanged | 4.222 s | 5.280 s |
| Early preflights | 3.636 s | 4.325 s |
| Unchanged, repeated | 5.487 s | 6.766 s |
| Early preflights, repeated | 3.385 s | 4.084 s |

Five of six early-preflight registrations finished below 3.7 s. One of six
unchanged registrations finished below 4.2 s.

The early-preflight payload sends an `OPTIONS` fetch to each later registration
route and to both signing routes when registration starts. The browser then
holds a cached preflight for those five routes. Setup keeps its own preflight.

| Browser time minus Gateway time, median per request | Unchanged | Unchanged, repeated | Early | Early, repeated |
| --- | ---: | ---: | ---: | ---: |
| Respond | 229 ms | 329 ms | 146 ms | 110 ms |
| Yao execute | 296 ms | 593 ms | 165 ms | 76 ms |
| Finalization | 128 ms | 589 ms | 98 ms | 24 ms |
| Sign prepare | 267 ms | 337 ms | 128 ms | 103 ms |
| Sign | 163 ms | 306 ms | 70 ms | 84 ms |

At the Gateway each preflight arrived 85–180 ms before its request. The
difference per request in the browser is larger than that in several rows. The
Gateway's own time per registration was also about 200 ms lower in the early
groups. Neither effect is explained yet. A staging Worker that sees few
requests may profit from the burst of early requests, and a production Worker
with steady traffic may not.

## Restoration

Both drivers restored all 13 original Worker versions and the original Deriver
admission schema. A separate read of the live versions and schemas confirmed it
after each run.

The machine-readable record is
[`refactor-155f-preflight-hosted.json`](./refactor-155f-preflight-hosted.json).

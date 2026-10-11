# Hosted Console setup batch comparison — October 11, 2026

The hosted candidate uses **37 completed Gateway/Console D1 calls** for
registration, down from 38. Console setup uses four calls instead of five.
All nine NEAR registrations and independently verified signatures passed.
All original Worker versions and Deriver schemas were restored and checked.

Registration measured **3.950 s median**, with a **3.902–4.949 s range**.
The repeated control measured **4.171 s median**. The four-second maximum target
remains unmet. The measurements below do not establish a repeatable latency saving
from this one-call reduction.

## Comparison inputs

Only the Console Worker version changes between the three groups:

| Component | Control | Candidate |
| --- | --- | --- |
| Console private source | `755e7be` | `3db9b5d` |
| Console public dependency | `a3dd064f` | `7fd7f565` |
| Gateway and Runtime | Public `a3dd064f`, private `755e7be` | Same serving versions |
| SDK and browser payload | Existing `a3dd064f` build | Same payload |
| Four custody Workers | Existing comparison versions | Same serving versions |

The public dependency change exports the existing registration-context builder.
The candidate batches the deployment and exact environment reads in Console setup.
It retains credential validation, the awaited usage update, and reservation checks.
The [local record](refactor-155f-setup-batch.md) describes the implementation and
failure scenarios. The earlier environment/authentication overlap was replaced
by this batch. Its expected benefit is not a separate saving.

The order is control, candidate, repeated control. Each group uses three fresh
NEAR-only wallets with implicit accounts. Chromium runs in Tokyo. Wallets use
APAC homes. Database bindings, placement settings, Gateway versions, custody
versions, SDK assets, and early preflights remain fixed.

The first wallet after a version change can include startup costs. These samples
do not establish controlled cold-start or steady-production timings. The benchmark
sends real browser requests and preflights through the existing HTTPS harness.
It creates no infrastructure and performs no funding transaction.

## Results

Each cell shows the median followed by the observed minimum and maximum.
Primary SDK timings exclude WebAuthn interaction and signing confirmation.
The JSON retains inclusive timings and test-harness overhead separately.

| Workload | Control before | Candidate | Control after |
| --- | ---: | ---: | ---: |
| NEAR registration | 4.489 s (4.014–5.600) | **3.950 s (3.902–4.949)** | 4.171 s (3.797–4.421) |
| First signature | 0.841 s (0.783–1.245) | **0.814 s (0.809–0.902)** | 0.692 s (0.655–0.785) |
| Registration plus first signature | 5.330 s (4.796–6.844) | **4.804 s (4.764–5.758)** | 4.862 s (4.452–5.206) |
| Finalization POST, browser timing | 1.183 s (1.035–1.752) | **1.151 s (1.141–1.172)** | 1.193 s (1.138–1.373) |
| Setup POST, browser timing | 0.872 s (0.605–1.052) | **0.839 s (0.522–1.135)** | 0.632 s (0.537–0.735) |
| Console setup, summed D1 call time | 93 ms (80–104) | **76 ms (74–102)** | 77 ms (70–84) |

The candidate's registration median is lower than both controls. Its combined
median is close to the repeated control. The changed setup request is slower
than the repeated control in browser timing, while its D1 time is almost equal.
Unchanged stages also vary between groups. These observations prevent assigning
the whole registration difference to the batch.

Keep the change for its verified removal of one database call. Do not promise
a 220 ms saving from the difference between the last two registration medians.
Stage medians and overlapping spans cannot reconstruct elapsed time by addition.

## Request counts

Every sample in a group has the following counts:

| Operation | Control D1 calls | Candidate D1 calls |
| --- | ---: | ---: |
| Gateway setup | 5 | 5 |
| Gateway respond | 6 | 6 |
| Gateway Yao execution entry | 2 | 2 |
| Gateway finalization | 13 | 13 |
| Console setup | 5 | **4** |
| Console lineage lookup | 1 | 1 |
| Console passkey claim | 2 | 2 |
| Console route publication | 2 | 2 |
| Console completion | 2 | 2 |
| **Registration total** | **38** | **37** |
| First signature, additional Gateway calls | 7 | 7 |
| **Registration through first signature** | **45** | **44** |

These totals exclude custody-role D1 calls and background calls unfinished when
the response was recorded. Console setup still executes five SQL statements.
A D1 batch can contain several statements. HTTP counts remain six application
POSTs, six browser preflights, and five explicit early `OPTIONS` requests per wallet.
Console receives five registration requests and no routine-signing request.
Session-status requests remain zero.

## Verification and restoration

- All nine browser workloads passed.
- Node.js independently verified all nine NEP-413 signatures with its own payload
  encoding. Changes to signed message fields were rejected.
- All 18 comparison checks passed. Only Console changed between groups.
- Every traced invocation matched its expected serving version.
- The repeated control used the exact first-control versions.
- Each wallet started its custody objects once before respond arrived.
- All 13 original Worker versions and both original Deriver schemas were restored.
- Independent read-back checked those versions, schemas, and four Gateway address tables.
- Tenant activation passed after restoration. The comparison process exited.

## Remaining serial work

Finalization still commits the wallet and capability before issuing the initial
session. Console completion follows the session commit. The final local transaction
then activates the home and records the replay receipt.

| Gateway D1 batch | Control before median | Candidate median | Control after median |
| --- | ---: | ---: | ---: |
| Wallet and capability commit | 195 ms | **119 ms** | 100 ms |
| Initial session commit | 125 ms | **131 ms** | 90 ms |
| Home activation and replay receipt | 63 ms | **62 ms** | 51 ms |

These batches are unchanged by the Console candidate. Their variation reinforces
the need for repeated controls. Their medians must not be added to overlapping
custody writes or session-sealing spans.

The next implementation target is a combined wallet, capability, and initial-session
transaction. It could remove one required Gateway D1 call. Check the existing
transaction builders before changing interfaces. Preserve credential ownership,
capability version checks, session uniqueness, and exact replay after a lost reply.
Console completion must still acknowledge publication before local activation.

Passkey claiming and route publication already overlap. Combining those requests
would reduce request count without removing a whole serial exchange. Initial home,
journal, and ceremony batching remains another candidate. The separate Yao
connection costs remain recorded in [Phase 3](../refactor-155F-registration-round-trips.md#phase-3--reduce-measured-custody-preparation-and-connection-delays).

## Evidence and reproduction

The [sanitized JSON](refactor-155f-console-setup-hosted.json) contains individual
samples, signature proofs, D1 traces, HTTP counts, version audits, and cleanup results.
It is an unchanged copy of the generated export.

The private directory is `.artifacts/r155f-console-setup-hosted/` in
`seams-monorepo`. It retains the frozen Console build, reused payload references,
Worker tails, raw browser evidence, and the restoration record. After the driver
exits, reproduce the analysis there:

```sh
python3 .artifacts/r155f-console-setup-hosted/analyze-comparison.py
python3 .artifacts/r155f-console-setup-hosted/console-analysis.py
python3 .artifacts/r155f-console-setup-hosted/custody-analysis.py
node .artifacts/r155f-console-setup-hosted/verify-proofs.mjs
python3 .artifacts/r155f-console-setup-hosted/verify-cleanup.py
python3 .artifacts/r155f-console-setup-hosted/export-comparison.py
```

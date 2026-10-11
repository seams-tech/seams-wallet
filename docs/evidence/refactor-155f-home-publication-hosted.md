# Hosted committed-home and initial-read comparison — October 11, 2026

The candidate removes one Gateway D1 call and overlaps the initial home and
journal reads. This run establishes **no clear overall latency improvement**.
Registration measured **4.102 s** in the candidate and **4.094 s** in the repeated
control. All nine signatures passed independent verification. Staging was restored
and independently checked.

## Changes and fixed inputs

- Public control: `25425eff`, including the earlier finalization read and sealing overlaps.
- Public candidate: `a3dd064f`. Commit `88ef6517` removes publication's second
  home read. Commit `a3dd064f` overlaps initial home admission and journal reading.
- Private composition: `755e7be` in all groups. Its production code includes the
  Console lineage batch from `3272020`.
- One SDK built from `a3dd064f` is fixed in all groups. SDK source is unchanged
  between the two public commits. Early preflights and sealed session persistence
  remain enabled.
- The four custody Worker versions, placement settings, and database bindings
  remain fixed. The original versions were captured after the role-database cutover.
- Chromium runs in Tokyo. Wallets use APAC homes and implicit NEAR accounts.
  Only the NEAR signer loads. Browser requests and preflights reach staging through
  the existing HTTPS harness without request interception.

The order is control, candidate, repeated control, with three fresh wallets in
each group. A fresh wallet does not establish a cold Worker. The first wallet
after activation can include startup costs. There is no controlled cold-start claim.

Funding, blockchain confirmation, and user interaction are excluded from the
primary SDK metrics. Interaction-inclusive registration is retained separately.
Stage medians and overlapping spans must not be added to reconstruct elapsed time.

## Measured results

Values are medians, followed by the observed minimum and maximum. There are
three samples per group. Each maximum is an observed maximum, not a guarantee.

| Workload | Control before | Candidate | Control after |
| --- | ---: | ---: | ---: |
| Registration, excluding WebAuthn | 5.064 s (4.053–5.157) | **4.102 s (3.597–5.593)** | 4.094 s (3.857–4.697) |
| First signature, excluding confirmation | 0.998 s (0.642–1.018) | **0.978 s (0.699–1.013)** | 0.667 s (0.666–0.816) |
| Registration plus signature, excluding interaction | 6.062 s (4.695–6.175) | **5.115 s (4.296–6.571)** | 4.761 s (4.523–5.512) |
| Finalization POST, browser timing | 1.420 s (1.231–1.448) | **1.138 s (0.993–1.280)** | 0.961 s (0.947–1.573) |

The candidate sits between the controls for finalization. Its registration median
matches the repeated control. Its first-signature median exceeds the repeated
control, and its maximum registration exceeds both control maxima. The changes
do not affect signing handlers. This run does not establish the cause of the
differences or prove an overall speedup.

The slowest candidate also spent **1.318 s in setup** and **0.891 s in respond**.
Those handlers are unchanged by the candidate. Finalization alone does not explain
the registration spread. The **four-second maximum target remains unmet**.

## Calls and ordering

| Work | Control D1 calls | Candidate D1 calls |
| --- | ---: | ---: |
| Gateway setup | 5 | 5 |
| Gateway respond | 6 | 6 |
| Gateway Yao execution entry | 2 | 2 |
| Gateway finalization | 14 | **13** |
| Console across registration | 12 | 12 |
| **Registration total** | **39** | **38** |
| First signature, additional Gateway calls | 7 | 7 |
| **Registration through first signature** | **46** | **45** |

These counts exclude custody-role databases and calls unfinished when the response
was recorded. SQL statements and D1 API calls are separate counts. A batch can
contain several statements.

HTTP counts stayed fixed in all nine samples: six application POSTs, six browser
preflights, and five explicit early `OPTIONS` requests. Console receives five
registration requests and no routine-signing request in this workload.

The Console lineage lookup used one D1 batch in every observed request. Its
previous implementation used two calls. Both comparison groups include this batch,
so the run cannot isolate its latency saving.

All three candidate finalizations started their home and journal reads together:
at **8 ms**, **11 ms**, and **13 ms** after their respective requests began.
Each then loaded the ceremony after both reads settled. The removed home read
after session issuance also stayed absent in all three traces.

## Local behavior verification

- The composed browser test holds the home reply until the journal read starts.
  It verifies that registration writes wait for admission, then verifies a NEAR signature.
- The real-D1 scenario completes a competing request after the initial journal
  read. The losing claim reads the new state and returns the winner's result.
  Home publication occurs once.
- Three composed scenarios pass: normal completion, lost completion reply,
  and mixed-registration retry through another region during Console outage.
- The existing publication test verifies that Console completion is dispatched
  before session sealing starts. It holds Console's reply until sealing finishes.
- Server build, server type check, wallet-state fixtures, authorization-transfer
  D1 scenario, and bloat check pass.

Private commit `755e7be` contains the composed ordering test. Public `a3dd064f`
contains the journal race scenario and required initial-record type fixtures.

## Hosted verification

- All nine registrations and signatures passed the browser workload.
- Node.js independently verified all nine NEP-413 signatures using its own
  payload encoder. Changes to signed message fields were rejected.
- All 18 comparison checks passed. Every observed invocation used the expected
  Gateway, Console, Router, Deriver A, Deriver B, or signing Worker version.
- The repeated control used the exact first control versions. Custody versions
  stayed fixed throughout all three groups.
- Each wallet started its objects once, before the respond request arrived.
- Session-status requests remain zero.
- All 13 original Worker versions and both original Deriver schemas were restored.
  Independent read-back also verified all four Gateway address tables. Tenant
  activation on the restored deployment passed. No new infrastructure was created.

The [sanitized JSON evidence](refactor-155f-home-publication-hosted.json) includes
individual timings, public signature proofs, D1 calls and statements, served
regions, pending background work, version checks, and restoration results.

## Reproduction

The private directory is `.artifacts/r155f-home-publication-hosted/` in
`seams-monorepo`. It retains frozen source exports, deployment checksums, raw
browser evidence, Worker tails, and restoration records. No new resource is required.

After the comparison driver finishes:

```sh
python3 .artifacts/r155f-home-publication-hosted/analyze-comparison.py
node .artifacts/r155f-home-publication-hosted/verify-proofs.mjs
python3 .artifacts/r155f-home-publication-hosted/verify-cleanup.py
python3 .artifacts/r155f-home-publication-hosted/console-analysis.py
python3 .artifacts/r155f-home-publication-hosted/custody-analysis.py
python3 .artifacts/r155f-home-publication-hosted/export-comparison.py
```

## Next work

Keep the two changes. They remove a redundant read and a serial dependency while
preserving the tested retry and publication behavior. Assign no measured overall
latency saving to them from this run.

Console setup still serializes credential reading, its usage-timestamp update,
and environment loading. Evaluate one batch or overlap while preserving the
existing authentication checks and usage update. The control's Console setup
used about 90 ms of D1 time, so this offers a modest saving.

Then evaluate combining Console's required deployment check with the first data
query in each operation. Preserve deployment retirement and wallet ownership.
Measure accumulated changes together, with exact retry and failure checks first.

Full initial-read batching across home, journal, and ceremony remains a separate
store change. Preserve completed replay after ceremony cleanup. The current
overlap removes one serial wait without that larger change.

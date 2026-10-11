# Hosted finalization overlap comparison — October 11, 2026

The comparison verifies the read overlaps, but shows **no clear improvement in
total registration time**. Candidate registration took **4.267 s** at the median.
The baseline before it took **4.346 s**. The same baseline afterwards took **4.227 s**.

Finalization took **1.030 s** in the candidate, against **1.234 s** and **1.069 s**
in the two baseline groups. These ranges overlap. The first comparison alone
would overstate the evidence for a gain.

## Fixed inputs

- Public baseline: `79a43a73`, before the two overlap changes.
- Public candidate: `25425eff`, including read overlap in `cc52b39f` and sealing
  overlap in `25425eff`.
- Private composition: `3e47ba2` in every group. Its production sources match
  `605c9a0`, which includes the existing Console passkey-claim batch.
- One rebuilt SDK from `25425eff` in every group. Early preflights and sealed
  session persistence are enabled throughout.
- Existing staging testnet resources, with the same regional database bindings
  and placement settings. The four custody Worker versions stay fixed.
- Chromium in Tokyo, APAC wallets, the Gateway configured for Hong Kong, and
  the custody databases from the completed Hong Kong cutover.

The order was baseline, candidate, repeated baseline, with three new wallets
per group. Each wallet used an implicit NEAR account and loaded only the NEAR
signer. Browser assets came from the existing local HTTPS harness. The harness
did not intercept HTTP requests, so CORS preflights reached staging.

Funding and blockchain confirmation are outside the measured flow. The first
wallet after activation can include a cold Worker. A new wallet alone does
not establish that its Worker isolate was cold.

## Measured results

Values are medians, followed by the observed minimum and maximum. There are
three samples in each column. Interaction-excluded values remove WebAuthn and
the signing confirmation from the corresponding SDK measurement.

| Workload | Baseline before | Candidate | Baseline after |
| --- | ---: | ---: | ---: |
| Registration, excluding WebAuthn | 4.346 s (4.245–5.081) | **4.267 s (3.663–4.378)** | 4.227 s (3.836–4.292) |
| First signature, excluding confirmation | 0.724 s (0.634–1.266) | **0.957 s (0.678–1.045)** | 0.617 s (0.585–0.916) |
| Registration plus first signature, excluding interaction | 5.070 s (4.879–6.346) | **4.945 s (4.620–5.423)** | 4.908 s (4.422–5.143) |
| Finalization POST, measured by the browser | 1.234 s (0.983–1.397) | **1.030 s (0.939–1.361)** | 1.069 s (0.793–1.112) |
| Registration, including WebAuthn | 4.798 s (4.608–5.629) | 4.526 s (3.960–5.210) | 5.044 s (4.363–5.110) |

The candidate's first-signature median was higher than both baseline medians.
The candidate changes registration finalization; it does not change the signing
handlers. These samples do not establish the cause of that difference. Retain
the observation instead of treating it as a signing improvement.

The **3–4 second maximum target was not met**. Two candidate registrations took
more than four seconds, and all three combined flows took more than four seconds.
The earlier **3.530 s registration / 4.204 s combined** result remains a separate
[early-preflight measurement](refactor-155f-preflight-hosted.md). It is not the
baseline for attributing savings to these server changes.

## Calls and observed ordering

Counts were identical in all nine samples:

| Work | Completed D1 API calls |
| --- | ---: |
| Gateway setup | 5 |
| Gateway respond | 6 |
| Gateway Yao execute entry | 2 |
| Gateway finalization | 14 |
| Console across registration | 13 |
| **Registration total** | **40** |
| Gateway first-signature prepare and sign | **7** |
| **Registration through first signature** | **47** |

Console receives five registration requests: setup, active lineage, passkey claim,
route publication, and completion. They make **5, 2, 2, 2, and 2** D1 calls.
Routine signing makes no Console request in this workload.

Each wallet sends six application POSTs and zero session-status requests. The
Gateway also observes six browser preflights and five explicit early `OPTIONS`
requests. Those are **17 Gateway HTTP requests** through the first signature.
The explicit early requests trigger browser preflights before the later POSTs.
They must be counted separately from the six application operations.

A D1 API call can contain several SQL statements. The JSON evidence retains
both counts, served-region metadata, query table names, unfinished calls, service
calls, and their timestamps. The totals above exclude custody-role databases
and work unfinished when the response was recorded.

The traces confirm both removed read dependencies. For the second wallet:

- Baseline lifecycle-decision reading started at **331 ms**, after Router
  consumption. Candidate reading started at **77 ms**, beside the Yao record read.
- Baseline authority and capability reads started at **339 ms** and **346 ms**.
  Candidate reads both started at **279 ms**.

These timestamps describe ordering within their own requests. Their differences
are not an estimate of the optimization's elapsed-time saving.

Sealing now starts while home publication is outstanding. Its remaining route
wait was zero in both versions. Cloudflare clocks and synchronous WASM prevent
that zero from establishing zero CPU cost. The candidate also moves sealing
into the session-issuance stage. Use the browser's complete finalization POST
for comparison instead of treating the old and new internal spans as equivalent.

## Verification and restoration

- All nine registrations and signatures passed the browser workload.
- Node.js independently verified all nine NEP-413 signatures using a separate
  payload encoder. Changed message, recipient, nonce, and callback URL were rejected.
- All **18 comparison checks** passed. Every observed Gateway, Console, Router,
  Deriver A, Deriver B, and signing-worker invocation used its expected version.
- Each wallet started its objects once, before the respond request arrived.
- The repeated baseline used the exact first baseline Worker versions.
- All 13 original Worker versions and both original Deriver schemas were restored.
  Independent read-back checked those versions, both schemas, and all four Gateway
  address tables. Tenant activation on the restored versions also passed.

No new Cloudflare resource was created. The experiment preserves the originals
captured after the role-database cutover. Older snapshots that bind deleted
databases are excluded.

The private run directory is
`.artifacts/r155f-finalization-overlap-hosted/` in `seams-monorepo`. It contains
the frozen source exports, deployment payload checksums, serving versions, raw
browser evidence, Worker tails, and restoration records.

Reproduce the analysis after the driver finishes:

```sh
python3 .artifacts/r155f-finalization-overlap-hosted/analyze-comparison.py
node .artifacts/r155f-finalization-overlap-hosted/verify-proofs.mjs
python3 .artifacts/r155f-finalization-overlap-hosted/verify-cleanup.py
python3 .artifacts/r155f-finalization-overlap-hosted/console-analysis.py
python3 .artifacts/r155f-finalization-overlap-hosted/custody-analysis.py
python3 .artifacts/r155f-finalization-overlap-hosted/export-comparison.py
```

The sanitized [JSON evidence](refactor-155f-finalization-overlap-hosted.json)
retains individual samples and public signature proofs.

## Decision and next work

Keep the two changes. They remove measured serial dependencies and preserve
the locally verified retry, publication, and failure behavior. This run does
not justify a claim that they reduced total registration latency.

Next, batch Console's independent lineage reads and consolidate finalization's
initial home, journal, and ceremony reads. Preserve exact retry and ownership
checks. Publication also reads its local decision before it sends the Console
request; inspect that boundary when evaluating how much sealing can overlap.

# Hosted wallet and initial-session transaction — October 11, 2026

The combined transaction removes one hosted D1 call from fresh NEAR-only
registration. Finalization uses **12 calls**, down from 13. Registration uses
**36 completed Gateway/Console calls**, down from 37. The first signature adds
seven calls, giving **43** through the first signature.

All nine registrations and independently verified signatures passed. The
candidate's finalization median was **73 ms lower** than the repeated control.
Unchanged stages also varied, so the full registration difference cannot be
attributed to this transaction. Independent staging restoration checks pass.

## Measured results

Each cell gives the median and observed range. The range's upper bound is the
observed maximum. Each group contains three wallets.

| Workload | Control before | Candidate | Control after |
| --- | ---: | ---: | ---: |
| Registration, excluding WebAuthn | 5.345 s (5.294–5.360) | **3.839 s (3.754–4.627)** | 4.685 s (3.648–5.035) |
| First signature, excluding confirmation | 0.877 s (0.730–1.394) | **0.988 s (0.805–1.014)** | 0.970 s (0.662–1.120) |
| Registration plus first signature | 6.237 s (6.075–6.688) | **4.854 s (4.559–5.615)** | 5.697 s (4.618–5.805) |
| Finalization POST, browser timing | 1.707 s (1.041–1.847) | **1.167 s (0.928–1.181)** | 1.240 s (0.983–1.305) |
| Finalization, Gateway timing | 1.368 s (0.774–1.480) | **0.793 s (0.646–0.899)** | 0.840 s (0.584–0.906) |

The candidate's registration median is 18% below the repeated control. Its
finalization POST median is 6% below that control. These are observed differences
from a small sequential comparison. They do not establish equivalent repeatable
savings. Router Yao execution, which uses fixed code, measured 1.535 / 1.239 /
1.345 s across the three groups. Timing variation therefore contributes to the
full registration difference. The first signature shows no improvement.

The **four-second maximum target remains unmet**. Candidate registration reached
4.627 s; registration through the first signature reached 5.615 s. Keep this
change for its verified transaction consolidation, removed call, and preserved
behavior. The earlier 3.950 s registration result used a different control run;
it is historical evidence, not this change's comparison baseline.

The [sanitized JSON](refactor-155f-wallet-session-hosted.json) contains individual
samples, SQL traces, timings, component versions, and verification outcomes.

## Comparison scope

The control uses public `19723f38`; the candidate uses `2b0e427d`. Both Gateway
and Runtime builds use private composition `3db9b5d`. The only production change
between the public sources combines the wallet, capability, initial session,
and registration completion decision in one D1 batch.

Console stays on private `3db9b5d` with public `7fd7f565`. The browser uses the
same `a3dd064f` SDK payload in every group, including its early preflights.
The four custody versions, placement, database bindings, and Tokyo client stay
fixed. Each group registers three fresh implicit NEAR wallets. The sequence is
control, candidate, then the original control again.

The main registration metric excludes WebAuthn interaction. The first-signature
metric excludes confirmation interaction. The JSON also retains inclusive
registration timing. Funding, blockchain confirmation, and browser automation
overhead are excluded from the SDK metrics. Each returned NEP-413 signature is
verified independently.

The first wallet after activation can include Worker startup. These are fresh
wallets; they are not controlled cold-start samples. Stage medians and overlapping
spans must not be added to reconstruct total latency.

## Completed D1 calls

| Stage | Control | Candidate |
| --- | ---: | ---: |
| Gateway setup | 5 | 5 |
| Gateway respond | 6 | 6 |
| Gateway Yao execution entry | 2 | 2 |
| Gateway finalization | 13 | **12** |
| Console across registration | 11 | 11 |
| **Registration** | **37** | **36** |
| First signature, additional Gateway calls | 7 | 7 |
| **Registration through first signature** | **44** | **43** |

One batch can contain several SQL statements. These counts exclude custody-role
databases and calls pending when a response was captured. The raw evidence records
SQL statements, pending calls, served regions, and service calls separately.

All three candidate traces place the wallet and session writes in the same batch.
All six control traces place them in separate batches. Finalization SQL statements
fall from **68 to 67**, because the separate batch's deployment guard is also
removed. Each finalization response has one pending background D1 call in all
three groups. No pending work is counted as a completed-call saving.

Console still receives five registration requests: setup, root lineage, passkey
claim, route publication, and completion. Their D1 counts remain 4, 1, 2, 2, and 2.
The combined local transaction does not remove a Console exchange.

Each wallet sends six application POSTs, six browser preflights, and five explicit
early `OPTIONS` requests. Session-status requests remain zero. Console receives
no routine signing request. Gateway D1 observations report APAC in every sample.

## Verification

All 18 comparison checks pass. Every traced Gateway, Console, and custody
invocation ran the version assigned to its group. The repeated control uses
the same 13 Worker versions as the initial control. Only the four Gateways and
four Runtimes change for the candidate.

Node.js independently verifies all nine Ed25519 signatures against a separately
encoded NEP-413 payload. Altered message, recipient, nonce, and callback values
fail verification. Local rollback, competing writes, lost replies, and mixed-wallet
contracts are recorded in the [implementation evidence](refactor-155f-wallet-session-transaction.md).
The bloat check passes; no ratcheted measure grows.

All 13 original Worker versions are restored. Independent readback also confirms
their database, service, secret, variable, and placement bindings match the
original settings. Both original Deriver schemas are restored; all four existing
Gateway address tables remain. Original tenant activation passed in GitHub run
`38123504191`. The comparison process has exited. No new infrastructure was
provisioned, and production was unchanged.

The independent records are `live-cleanup-verification.json` and
`live-settings-verification.json` in the private artifact directory. The public
JSON includes the version and schema verification. The generated public JSON's
SHA-256 is `5d6366b8f204d1c0f785bd6ed95d228bd1a765f726e7eec59f3af85f8001591c`.

## Remaining dependencies

The candidate still loads the home, retry record, and ceremony separately.
The home and retry-record reads overlap. The ceremony read follows the retry
record because completed retries can survive ceremony cleanup. A combined initial
read must retain that behavior and reject a retired home before any write.

Console completion still follows the durable initial session. Local home activation
and the completed replay receipt follow Console's acknowledgement. This ordering
keeps ordinary signing closed until publication succeeds.

Moving the passkey claim earlier needs a separate cancellation review. Console's
`D1WalletHomeDirectory.complete` currently refuses cancellation when the wallet
has a passkey claim. Claiming during respond would extend that restriction to
registrations whose Yao execution later fails. Do not move the claim earlier
without preserving a usable retry or cancellation outcome.

## Reproduction

The existing comparison harness is frozen under
`seams-monorepo/.artifacts/r155f-wallet-session-hosted/`. Its source archive hashes,
deployment payload hashes, original versions, and per-group versions identify
the measured inputs. It creates no resources and uses the existing staging
testnet deployment.

After the driver completes, run from `seams-monorepo`:

```sh
python3 .artifacts/r155f-wallet-session-hosted/analyze-comparison.py
python3 .artifacts/r155f-wallet-session-hosted/console-analysis.py
python3 .artifacts/r155f-wallet-session-hosted/custody-analysis.py
node .artifacts/r155f-wallet-session-hosted/verify-proofs.mjs
python3 .artifacts/r155f-wallet-session-hosted/verify-cleanup.py
python3 .artifacts/r155f-wallet-session-hosted/export-comparison.py
```

The public JSON is an unchanged copy of the generated, sanitized `evidence.json`.
It contains no deployment credentials or raw request bodies.

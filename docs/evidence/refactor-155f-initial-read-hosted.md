# Hosted initial registration reads — October 11, 2026

Batching the initial reads removes two hosted D1 calls from NEAR registration.
Finalization uses **10 calls**, down from 12. Registration uses **34 completed
Gateway/Console calls**, down from 36. The first signature adds seven calls,
giving **41** through the first signature.

All nine registrations and independent signature checks pass. All 18 comparison
checks pass. The measurements establish fewer calls, but do not establish a
repeatable end-to-end latency saving. Staging is restored, and independent
restoration checks pass.

## Measured results

Each cell gives the median and observed range. The upper bound is the maximum.
Each group contains three fresh wallets.

| Workload | Control before | Candidate | Control after |
| --- | ---: | ---: | ---: |
| Registration, excluding WebAuthn | 4.809 s (3.753–4.973) | **4.221 s (4.209–4.679)** | 3.810 s (3.612–4.019) |
| First signature, excluding confirmation | 0.909 s (0.884–0.963) | **1.038 s (0.814–1.124)** | 0.691 s (0.655–0.758) |
| Registration plus first signature | 5.772 s (4.662–5.858) | **5.247 s (5.035–5.804)** | 4.568 s (4.268–4.710) |
| Finalization POST, browser timing | 1.048 s (0.882–1.534) | **1.198 s (1.034–1.231)** | 0.986 s (0.969–1.046) |
| Finalization, Gateway timing | 0.767 s (0.626–1.166) | **0.727 s (0.674–0.973)** | 0.691 s (0.668–0.779) |

The initial home/journal/ceremony stage measures **20 / 13 / 19 ms** across the
three groups. The control's home and journal reads overlap, then the ceremony
read follows. These values measure the elapsed stage rather than adding
overlapping calls. The candidate's single batch measures 8–15 ms.

Whole-flow results vary more. Fixed-code Router Yao execution measures
**1.447 / 1.772 / 1.346 s** across the groups. The candidate's finalization POST
is slower than both controls. Its Gateway duration falls between the controls.
These small, sequential samples do not establish either a repeatable overall
saving or an overall regression caused by the initial-read batch.

The four-second maximum remains unmet. Candidate registration reaches 4.679 s;
registration through the first signature reaches 5.804 s. Keep the change for
its removed exchanges, combined snapshot, and preserved retry behavior. The
earlier [transaction result](refactor-155f-wallet-session-hosted.md) remains
historical evidence and is not substituted for either control in this run.

## Scope and counts

The control uses public `2b0e427d`; the candidate uses `1ef8306c`. Both Gateway
and Runtime builds use private `3db9b5d`. Only those eight Worker versions change.
Console, the four custody Workers, generated WASM, placement, and D1 bindings stay
fixed. The browser uses the same `a3dd064f` SDK payload with early preflights.
The client runs in Tokyo; the wallets use APAC homes and implicit NEAR accounts.

| Stage | Control | Candidate |
| --- | ---: | ---: |
| Gateway setup | 5 | 5 |
| Gateway respond | 6 | 6 |
| Gateway Yao execution entry | 2 | 2 |
| Gateway finalization | 12 | **10** |
| Console across registration | 11 | 11 |
| **Registration** | **36** | **34** |
| First signature, additional Gateway calls | 7 | 7 |
| **Registration through first signature** | **43** | **41** |

All nine Gateway traces are complete. All three candidate finalizations contain
the home, journal, and ceremony SELECTs in one batch. SQL statements fall from
67 to 65 because two separate deployment guards disappear. One background D1
call remains pending at every finalization response. The totals exclude pending
work and custody-role databases. They count API calls separately from SQL statements.

Console receives five registration requests: setup, lineage, passkey claim,
route publication, and completion. Their observed D1 counts remain 4, 1, 2, 2,
and 2. Console tail output omitted the three finalization requests for one
wallet in the first control group. Its Gateway trace still records those service
calls. Console counts are complete for the other eight wallets, including every
candidate and repeated-control wallet. The missing observations are not counted
as savings. The [JSON evidence](refactor-155f-initial-read-hosted.json) retains
this coverage through the per-request arrays.

Funding and blockchain confirmation are excluded. Registration excludes WebAuthn
interaction; first signing excludes confirmation interaction. Inclusive timings
remain in the JSON. No controlled cold-start claim is made. Do not add stage
medians or overlapping spans to reconstruct total latency.

## Verification and restoration

Every traced invocation ran its assigned version. The repeated control uses the
same 13 versions as the initial control. Node.js verifies all nine signatures
against an independently encoded NEP-413 payload. Altered message, recipient,
nonce, and callback values fail verification.

The [local retry record](refactor-155f-initial-read-batch.md#completed-retry-call-count)
also passes. After ceremony deletion, completed replay needs one foreground D1
batch and returns the same session identity without a new operation credential.
The scenario verifies foreign-region signing during a Console outage and rejection
after a relocation block or permanent home retirement. Private `67fe153` retains
that retry trace. The bloat check passes.

Independent readback confirms all 13 original Worker versions, bindings, and
placement settings. Both original Deriver schemas are restored. The four existing
Gateway address tables remain. Original tenant activation completed successfully
in GitHub run `38128610501`. The runner exited after restoration.
No new infrastructure was created. Production was unchanged.

The [JSON evidence](refactor-155f-initial-read-hosted.json) is an unchanged copy of
the private runner's generated `evidence.json`.
SHA-256: `a85bc1b85de1d94105b6ed88185b2123d1d36a99fd637fabc954b3ca0ed60d68`.
It includes the signature checks and live version/schema verification. The private
`live-settings-verification.json` separately records successful binding and
placement readback.

The frozen private directory is `.artifacts/r155f-initial-read-hosted` in
`seams-monorepo`. Its manifest records 332 input files and has SHA-256
`b7d0b1c7284d8d16e0b58715ac996eeca1bff72df79708dbea0d082e40057dad`.
The runner waits for unfinished registration records before each deployment
change. Tenant activation creates a temporary registration canary, whose two
ceremony rows remain until expiry. Those waits are deployment bookkeeping and
are excluded from the reported SDK timings.

Reproduce the analysis and checks from `seams-monorepo` with:

```sh
zsh .artifacts/r155f-initial-read-hosted/finish.sh
```

## Next optimization

Prioritize the remote finalization dependencies. Candidate Console completion
measures **161 ms median (124–445 ms)** from the Gateway. Passkey claiming and
recovery-route publication already overlap; combining them removes a request
without removing a whole serial exchange.

Moving passkey claiming into respond could overlap it with Yao execution. It must
preserve cancellation after a later Yao failure. Console currently refuses to
cancel a home once it has a passkey claim. Resolve that behavior before moving
the claim. Keep the current durable-session-before-completion ordering.

# Hosted Deriver B prewarm comparison — October 11, 2026

Deriver A now loads Deriver B's Worker before the pair connection (public
`fedad1f3`). On staging, with every other version fixed, the connection hold
in Deriver B's Worker fell from **186 ms to 0 ms** and Deriver A's connection
from **336 ms to 161 ms**, six executions per side. The whole execution and
the registration moved in the same direction, but their spreads overlap.
All 24 signatures passed independent verification. Staging was restored and
independently checked.

## Fixed inputs

- Public source `2b0e427d` for every host; Deriver A control `fd1c1f00`
  (the comparison custody version), candidate `e1996ba4` built from the same
  source plus `fedad1f3`.
- Private composition `605c9a0` for the Gateway, Runtime and Console builds.
  The Console candidate binds the Hong Kong database and runs in `aws:ap-east-1`,
  after the [Console move](../refactor-155G-apac-anchor-and-hidden-exchanges.md#phase-1-record).
- One SDK with early preflights, the `a3dd064f`-era payload, in every group.
- The four custody versions except Deriver A, the placement settings and the
  database bindings stay fixed. Chromium runs in Tokyo. Wallets use APAC homes
  and implicit NEAR accounts. Browser requests reach staging without interception.

The order is a discarded warm-up group, then a measured group, four times:
control, candidate, control again, candidate again, with three fresh wallets
in each group. A version that was just deployed or switched in starts its
Workers in new isolates, and the warm-up absorbs that.

## Measured results

Values are medians, then the observed minimum and maximum, over the six
wallets of each side. The spans come from the Worker records of the executions.

| Six wallets each | Control | With the change |
| --- | ---: | ---: |
| Deriver B's Worker holds the connection | 186 ms (140–232), in 6 of 6 | 0 ms, in 6 of 6 |
| Deriver A connects to Deriver B | 336 ms (275–393) | 161 ms (152–407) |
| Deriver A's admission | 116 ms (93–438) | 104 ms (100–126) |
| Router's execute request | 1,704 ms (1,342–1,790) | 1,543 ms (1,363–1,776) |
| Yao execute POST, browser timing | 1,818 ms (1,544–1,929) | 1,669 ms (1,482–1,879) |
| Registration, excluding WebAuthn | 3,873 ms (3,628–4,057) | 3,599 ms (3,431–3,872) |
| First signature, excluding confirmation | 691 ms (607–743) | 670 ms (633–774) |
| Registration plus first signature | 4,556 ms (4,287–4,738) | 4,270 ms (4,098–4,646) |

The prewarm request arrived 109–132 ms before each connection. Each wallet
sends two: one at wallet start, about one second before the execution, which
loads the Worker in 10–14 ms of CPU, and one beside the admission, answered in
1 ms. Deriver B records both as completed. The admission no longer waits for
the load, as it did in the first run with the execution-time request only.

The connection and the hold are the established gain, about **175 ms** of
the serial chain. The execute request and the registration show a difference
of about 160 and 270 ms at the median, inside overlapping ranges. The first
signature does not change, as expected: it makes no pair connection.

## Verification and restoration

- All 24 registrations and signatures passed the browser workload.
- Node.js independently verified all 24 NEP-413 signatures with its own
  payload encoder. Changed message, recipient, nonce and callback URL were rejected.
- All 28 comparison checks passed: identical versions within each side, only
  Deriver A differing between the sides, every warm-up on its measured group's
  versions, three verified samples per group, every invocation on its expected
  version, and no session-status request.
- All 13 original Worker versions and both Deriver schemas were restored.
  Independent read-back verified the versions, the schemas and the four Gateway
  address tables. Tenant activation on the restored versions passed.

A first attempt of this run stopped after its control group on a stale frozen
file, the driver's own version record copied from the earlier run folder; it
restored staging, and the restoration was verified. The
[sanitized JSON evidence](refactor-155g-yao-prewarm-hosted.json) holds every
sample of the measured and warm-up groups, the chain spans per group, the
checks, the proofs and the restoration record. The analysis script's
wallet-startup checks pair Router start events to wallets across adjacent
groups and are not part of this comparison.

## Reproduction

The private directory is `.artifacts/r155f-yao-prewarm2-hosted/` in
`seams-monorepo`. After the driver finishes:

```sh
python3 .artifacts/r155f-yao-prewarm2-hosted/analyze.py
python3 .artifacts/r155f-yao-chain/prewarm-arms.py .artifacts/r155f-yao-prewarm2-hosted
node .artifacts/r155f-yao-prewarm2-hosted/verify-proofs.mjs
python3 .artifacts/r155f-yao-prewarm2-hosted/verify-cleanup.py
python3 .artifacts/r155f-yao-prewarm2-hosted/export-evidence.py
```

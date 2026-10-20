# R170 / R171 completion receipt

Status: approved essential scope completed October 5, 2026, at source `8ecbea72`.
The recorded iframe protocol was 14.0.0; this is historical release evidence.

## What completed

Client/host separation and grouped public APIs removed duplicate application adapters.
Custom email unlock used host-owned challenge handles. Five production email scenarios,
passkey lifecycle, signed-out loading, durable-pool retention, and protocol-handshake checks passed.
Types, production builds, packed declarations, runtime boundaries, and bloat checks passed for the recorded artifacts.

## Recorded measurements

| Application closure, gzip bytes | Baseline | Final |
| --- | ---: | ---: |
| Root, static | 739,640 | 61,223 |
| Root, including lazy router | 793,388 | 87,975 |
| React provider, static | 747,087 | 67,605 |
| React provider, including lazy router | 803,630 | 96,987 |

Observed response bodies fell from 11,031,734 to 7,867,916 bytes in the authenticated
scenario and from 3,398,239 to 987,550 bytes in the cold signed-out scenario.
Warm signed-out responses transferred zero body bytes. WASM used identity encoding locally.

These scenario totals include test-app code. They are not universal download budgets
or a paired latency result. Recorded first/repeat signing times were 706/693 ms
for NEAR and 785/735 ms for EVM.

## Deferred work and evidence boundary

The extra month-later clock simulation remained deferred. Publication, deployment, and
private adoption were separate tasks at closure. Concurrent edits after verification
were excluded from the evidence.

[Machine-readable receipt](evidence/refactor-170-completion-20261005.json) and
[final flow evidence](evidence/refactor-170-final-flows-20261005.json) retain artifact identities and reproduction commands.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-170-completion.md).

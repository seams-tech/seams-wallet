# Registration capability persistence

Recorded October 10, 2026. This is a local storage change after the
[hosted allocation comparison](refactor-155d-allocation-hosted.md).
Hosted latency savings have not been measured for this change.

## Change

Finalization installs the wallet's active Ed25519 capability after the canonical
wallet commit. The installation previously loaded the shared capability record
and the registration ceremony. Its commit rewrote the ceremony even though the
operation only changes capabilities.

The request-scoped runtime now reads and commits the shared capability record
alone. It uses the existing D1 version check and wallet ownership checks.
Recovery-session and export-replay maps retain their loaded values. A concurrent
shared-state change still forces one reread and retry. A second conflict fails.

Capability lookup also reads that shared record directly. The synthetic
`shared-capability-read` lifecycle lookup has been removed. Recovery and export
operations retain their full lifecycle transactions.

| Fresh capability installation | Previous path | Current path |
| --- | ---: | ---: |
| Lifecycle record reads | 2 | 1 |
| Lifecycle record writes | 2 | 1 |
| D1 round trips | 2 | 2 |

Previous counts follow the replaced read and commit path. Current counts are
checked against real local D1 calls. Counts exclude ownership-check statements.
An exact retry still checks the shared record's version when it commits.
This change does not merge capability installation with session issuance.

The preceding hosted candidate measured 179 ms for capability installation and
15 Gateway D1 calls in finalization. These numbers remain the baseline. Removing
record work does not establish a reduction in round trips or hosted duration.

## Verification

Implementation commit: `3ed898cc` on `dev`.

| Check | Result |
| --- | --- |
| Production server build | Pass |
| Real D1 storage and concurrency scenarios | Pass |
| Wallet state type fixtures | Pass |
| NEAR registration replay and signing across reload | Pass |
| Lost finalization credential recovery | Pass |
| Passkey recovery after lost reply and runtime reset | Pass |
| Bloat check | Pass |

The storage scenario uses the production runtime and D1 stores under Miniflare.
It checks installation, a retry after an ignored reply, and capability lookup.
It also forces concurrent writes between the read and commit. Another wallet's
capability and a recovery suspension must survive reconciliation. A relocation
freeze must reject a later capability change. The ceremony and shared replay
owners must remain unchanged throughout installation and retries.

Reproduce:

```sh
node tests/e2e/authorization-storage-transfer.e2e.mjs
pnpm -C tests type-check:wallet-state
node tests/scripts/run-wallet-intended-isolated.mjs -- \
  e2e/intended-behaviours/passkey.near-registration-commit.contract.test.ts \
  e2e/intended-behaviours/passkey.recovery.contract.test.ts \
  --grep 'NEAR-only registration|a committed Passkey recovery survives'
```

The first browser launch found occupied custody ports 4103–4106. After the full
runtime build passed, the three cases passed with `SEAMS_LOCAL_PORT_OFFSET=1600`
and `SEAMS_INTENDED_SKIP_BUILD=1`. This reused the completed build and left the
other local stack running. No hosted resources changed.

The storage artifact is
`.artifacts/r153/authorization-storage-transfer/evidence.json`, under
`observations.admissionCompanion.capabilityPersistence`. It includes D1 statement
counts and checks. Type fixtures reject lifecycle maps in capability mutations
and commits without their observed version. The browser cases exercise NEAR
registration replay, lost finalization replies, and recovery across a runtime reset.

## Next steps

1. Assess a single commit for capability installation and session issuance.
   Preserve canonical wallet commit ordering, ownership checks, and lost-reply recovery.
2. Freeze a new staging baseline after the separate role-database cutover.
   Run a controlled registration comparison with these storage changes.
3. Use the new traces to choose between remaining finalization work and peer
   admission delays. Keep setup, Yao execution, and finalization timings separate.

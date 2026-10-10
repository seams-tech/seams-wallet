# Registration capability persistence

Recorded October 10, 2026. This is a local storage change after the
[hosted allocation comparison](refactor-155d-allocation-hosted.md).
Hosted latency savings have not been measured for this change.

## First change: narrow capability persistence

The first change installed the wallet's active Ed25519 capability after the canonical
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

## Second change: commit the wallet and capability together

The canonical wallet commit already has the validated registration capability.
It now includes the capability-cache update in the same D1 transaction. That
transaction also includes signer, credential, founding-authority, and lifecycle
decision statements when present. A failure rolls back every statement.

This uses the existing wallet transaction and shared-record version check.
It avoids adding capability-specific state to session issuance. The independent
post-commit installer and its runtime interface are removed. Existing-wallet
capability rehydration uses the same bounded reconciliation code.

| Wallet write plus capability installation | Previous path | Combined path |
| --- | ---: | ---: |
| D1 reads | 1 | 1 |
| D1 write batches | 2 | 1 |
| D1 round trips | 3 | 2 |

The real D1 scenario verifies the combined path. Counts exclude founding-record
reads, directory claims, custody persistence, and session issuance. The previous
path count follows its separate wallet batch, capability read, and capability batch.
An exact finalization replay still uses its immutable lifecycle decision. It does
not reinstall registration material over a later recovery.

Session issuance remains separate. Custody persistence follows the combined
wallet transaction. The previous capability write overlapped custody persistence,
so one fewer round trip does not establish a fixed latency saving. The hosted
baseline remains **4.354 s** for registration and **5.253 s** through the first
signature. The previous **15 finalization D1 calls** need a new hosted measurement.

The production D1 scenario now includes an Ed25519 signer and its capability.
It verifies rollback after a failed decision statement and replay after a lost
reply. It also forces another wallet to commit between the read and write.
The first batch fails its version check, the second succeeds, and both wallets
retain their records and capabilities. The existing storage suite also verifies
suspension, relocation fences, and preservation of recovery and export state.

Reproduce the transaction check with:

```sh
node tests/e2e/registration-credential-reservation.e2e.mjs
```

The artifact is `.artifacts/registration-credential-reservation/proof.json`.
It records the two fresh D1 calls, their table identities, and both concurrent
write attempts. No hosted resources changed.

Build, wallet-state type fixtures, the registration fixture's type check, both
real D1 scenarios, and the bloat check pass. The browser checks for registration
replay, lost finalization credentials, and committed recovery after a lost reply
and runtime reset also pass. The final recovery trace is retained under
`.artifacts/registration-capability-candidate-recovery-traces/`.

The extended recovery scenario found a separate failure after its injected lost
Router reply. The second recovery admission returns `409 admission_failed` with
`Yao recovery claim conflicted on shared`. The same scenario reproduces this on
parent `06696b276b5e8774bcf1fdf7421ce610e9523d14`, with its Gateway rebuilt from frozen
sources and the same SDK and custody binaries. This is an existing production
recovery failure under fault injection. It remains unresolved by this storage change.
Evidence is in `.artifacts/registration-capability-recovery-traces/` and
`.artifacts/registration-capability-parent-recovery-traces/`.

The first extended run used mismatched local ports and failed the harness's origin
check. The corrected runs used Gateway port 5700 and role ports 5702–5706. Their
failure occurred after actual recovery execution. No production checks were
changed to accommodate the test.

## Next steps

1. Freeze a new staging baseline after the separate role-database cutover.
   Run a controlled registration comparison with these storage changes.
2. Use the new traces to choose between remaining finalization work and peer
   admission delays. Keep setup, Yao execution, and finalization timings separate.
3. Resolve the existing shared-state conflict on interrupted recovery before
   release. Preserve the admitted recovery code and the replaced-activation fence.

# R155H close-out correctness checks

Recorded October 14, 2026, for [R155H](../refactor-155H.md).

The new `respond` fault scenario found and fixed a lost-write-reply bug.
The fix preserves the original admission, bounded retries, and cancellation.
It adds no request, database query, or wait to a successful registration.

## Lost admission reply

The scenario uses a real Chromium passkey, the assembled registration service,
and local D1 with the production migrations. Its database wrapper injects a
connection failure before an admission batch or after that batch commits.
The existing setup fixture supplies the local token verifier and tenant-root
metadata. The scenario does not run the Yao protocol or simulate a public HTTP
reply loss.

| Fact | Observation | Evidence |
| --- | --- | --- |
| Failed write request | The bounded retry reaches the same admission | `respondRecovery` in the scenario artifact |
| Lost reply after commit, before the fix | Respond returned `internal`: `Registration ceremony record changed during versioned update` | `respond-recovery-before-fix.log` |
| Lost reply after commit, after the fix | Respond returns the admission originally described by setup | Exact receipt and replay assertions |
| Three failed write attempts | Respond returns `storage_unavailable` with a fixed message | Exhaustion case |
| Cancellation after recovery | The same respond request fails and writes no further admission | Cancellation assertions |

The versioned D1 store reports a version conflict when a failed batch is followed
by changed versions. A lost reply after commit also changes those versions.
The admission code reused the stored admission while the caller still held the
old ceremony version. Its second ceremony update failed.

NEAR respond now reconciles that failed update against a fresh ceremony read.
It accepts only exact canonical equality with the ceremony it intended to write.
A missing or different ceremony preserves the failure. The shared storage layer
and recovery's existing reconciliation remain unchanged. No retry count or delay
changed, and successful commits need no additional read.

| Candidate cause | Failed request recovers | Lost committed reply fails before fix | Same scenario passes after fix |
| --- | --- | --- | --- |
| Invalid passkey or ceremony | Contradicts | Contradicts | Contradicts |
| Respond failed to reconcile the committed ceremony after a version conflict | Fits | Fits | Fits |
| A live Cloudflare delay | Not involved: local D1 | Not involved | Not involved |

## Verification and reproduction

Run from the public repository:

```sh
node tests/e2e/registration-setup-startup.e2e.mjs
node tests/e2e/registration-credential-reservation.e2e.mjs
node tests/e2e/authorization-storage-transfer.e2e.mjs
pnpm -C packages/wallet-server type-check
pnpm -C tests type-check:wallet-state
pnpm report:bloat --check
```

The first three scenarios pass. They cover setup and respond
recovery, credential reservation, founding reads, transactional guards, ownership
fences, authorization transfer, and admission companion writes. Both type checks
pass. The bloat check passes. The repeatable outputs are:

- `.artifacts/registration-setup-startup/result.json`
- `.artifacts/registration-credential-reservation/proof.json`
- `.artifacts/r153/authorization-storage-transfer/evidence.json`

This check's logs and copied proofs are under
`.artifacts/r155h-closeout-checks-20261014/`.

## Existing combined-candidate evidence

The preceding candidate, `ec08890c`, already includes founding-read overlap,
seal warm-up, and the respond retry. Its saved contract results contain 132
passing release-build cases. Two terminal-failure cases require the debug Router
and pass on that build. Their release-build refusals are environment failures.
The four changed server source files in the tested tree match that commit.

The source checks and counts are recorded in
`existing-contract-evidence.json`. The underlying records are
`.artifacts/r155d/p2rest-{1,2,3,dev}.json`.
Those suite results precede this lost-reply fix. The local D1 scenarios above
verify the additional fix; this record does not claim a new full-suite run.

Independent review rejected an initial change to the shared storage layer:
recovery relies on its current version-conflict readback. That change was removed.
The final fix belongs solely to NEAR respond. Review of that replacement found no
actionable issue. The fault scenario passes with the narrower fix.

Claude owns the concurrent staging comparison, plan close-out, and 0.10.2 release.
Its driver recorded four successful arms of 33 registrations and restoration of
all 14 original Worker versions. This additional fix must join the release
candidate. The comparison did not contain it and establishes no failure-rate or
latency saving for it. [R155J](../refactor-R155J-p99.md) retains p99 acceptance and
unresolved hosted outliers.

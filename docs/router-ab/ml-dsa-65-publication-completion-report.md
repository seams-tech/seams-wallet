# ML-DSA durable publication completion

The producer now reconciles durable publication before recording a preparation failure.
A lost final reply can leave both participants with valid material. Such a job now records Published when both records confirm publication.

The internal PublicationRecorded command checks the active key, every exact batch ID, and the material expiry.
Records survive consumption and retirement. This evidence grants no signing rights and does not restore retired material.
Both ordinary completion reconciliation and interrupted-producer recovery use this check.
Inspection failures preserve Running and its recovery alarm. Lease expiry retains the existing Interrupted behavior.

## Validation

The composed real-Worker lifecycle passes in local workerd.
It drops the final A publication reply after the durable write, then verifies Published, paired readiness, and lease release.
It verifies historical publication after an actual B take and cancellation, and rejects a changed expiry.
The existing prepublication failure, retry delay, restart, settlement failure, single-use, and deadline cases also pass.
All three signatures verify.

The [hosted rerun](ml-dsa-65-publication-completion-hosted-report.md) confirms one publication through error reconciliation, with one observed producer execution.
All 132 retained signatures verify. Both capacity cycles remain unqualified because of ledger gaps and one timed-out request.
All eight temporary Workers are deleted. The local evidence below remains separate from hosted results.

Preparation remains on Workers. Wallet-seed recovery, FIPS export, two-at-once consumption, and per-wallet pool capacity remain unchanged.
The inherited bloat check still reports 13,972 duplicated Rust lines against a 13,754-line baseline. The baseline is unchanged.

## Reproduce

Build deriver-a and deriver-b with the existing strict ML-DSA Worker build script.
Run tests/e2e/ml-dsa-durable-worker.e2e.mjs with the existing generated public Worker fixtures and an artifact path.
Set ML_DSA_TEST_BUILD_ROOT to the directory containing the three Worker bundles.
The local fixture uses its established one-second cooldown to exercise lifecycle transitions. Hosted policy retains sixty seconds.

[Evidence index](../evidence/ml-dsa-65-publication-completion-local-20261026.json) and [full compressed artifact](../evidence/ml-dsa-65-publication-completion-local-20261026.json.gz).

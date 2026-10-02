# R152 / Wallet 0.8.0 release preparation

Date: October 2, 2026. Status: local preparation; unpublished.

The user selected 0.8.0 for both `@seams/wallet` and `@seams/wallet-server`.
The review baseline is published 0.7.3's Git revision
`2bc58391ddeef44eb1432ccd15be8a0d31332d55`; the source review ends at
`bb0bc8ce1ee4bbf54df39dd64b8ad9a2787a0a4a`, before the version-only package edits.
This range changes 458 files, with 6,898 insertions and 43,638 deletions. Scope
counts describe the release delta; they do not imply every line was audited.

## Release behavior and upgrade requirements

- R152 adds signer migration 0040 for short-lived namespace-home challenges.
  The first 39 packaged signer migrations are byte-identical to 0.7.3.
  Console must apply its corresponding migration 0050 before home activation.
- Wallet authority initialization now relies on migrations. Apply the complete
  signer migration set before admitting requests; runtime requests no longer
  create authority tables and indexes.
- The managed Gateway publishes wallet projections through Console's
  `/internal/wallet-console/v1/wallet-projections` endpoint. Deploy the matching
  Console implementation and service bindings with the new runtime.
- Direct replayable session issuance removes a duplicate read. The D1 commit
  implementation still checks batch outcomes and reads the committed session,
  verifying its identity and credential digest before returning it.
- Retired embedded cosigner/session-store paths and public configuration/types
  were removed, including `THRESHOLD_NODE_ROLE`, `nodeRole`,
  `ThresholdEd25519SigningSessionRecord` and `ThresholdEd25519Commitments`.
  Recompile consumers against 0.8.0. Private Console's local Worker now uses the
  SDK's presign configuration parser instead of constructing `nodeRole`.
- The release also contains confirmation/session UI changes, removal of unused
  Worker requests and dependencies, and Rust benchmark/test-helper cleanup.

## Client/server cutover is a release gate

Commit `13057703` removes `publicTranscriptDigest32B64u` from the ECDSA bootstrap
response. Both the published client and the current client use an exact-key
parser in `packages/wallet/src/core/rpcClients/relayer/thresholdEcdsa.ts`.
Published 0.7.3 requires the field; 0.8.0 rejects it as unexpected. Therefore:

| Client | Server | Bootstrap shape |
| --- | --- | --- |
| 0.7.3 | 0.8.0 | Rejected: required field is absent |
| 0.8.0 | 0.7.3 | Rejected: extra field is present |
| 0.8.0 | 0.8.0 | Current lifecycle contract |

This is established by source inspection of the actual boundary parsers, rather
than a mixed-version hosted experiment. Persisted ceremony records remain
readable at the persistence boundary. The proof transcript digest remains in
activation facts under its precise name, `proofTranscriptDigestB64u`.

Publishing both packages does not update deployed clients. Before hosted
adoption, inventory the served wallet iframe/assets and integrator SDK versions,
and choose a concrete cutover that prevents old client code from reaching the
new bootstrap endpoint. Refreshing HTML alone does not replace code already
running in an open tab. A maintenance window or version-isolated deployment must
account for those clients. The production-testnet backend coordinator verifies
home activation and readiness; frontend deployment is a separate workflow and
does not by itself enforce this client/server boundary. Record the selected
cutover and verify it before releasing traffic. No compatibility path is added.

## Validation scope

The bounded release review examined migration and authority initialization,
session commit/readback, projection integration, public API/Worker removals and
the changed cryptographic source paths. The inspected crypto hunks remove
unused helpers and benchmark exports; this work is not a repository security
audit or an assembly-level constant-time proof.

Evidence is retained locally under
`.artifacts/r152/release-review-20261002/`. It includes the source diff,
`tested-builds.json` (4,120 compiled-file hashes), build-freshness result,
Cargo-lock checks and release-gate logs. The existing
[packed acceptance evidence](refactor-152-package-readiness.md) identifies
earlier tarballs separately and corrects the concurrent-build provenance.

At the reviewed source boundary, all twelve representative lifecycle scenarios
passed, each with fresh local Wallet state. They cover lost Router replies,
mixed registration, immediate owner-session use, deferred NEAR authority,
stalled refill recovery and sustained Tempo/Arc signing beyond pool capacity.
The 4,120 compiled-file hashes remained unchanged throughout these checks.

Additional local release gates passed:

- Twenty representative browser cases across Chromium, Firefox and WebKit.
- Fifty-seven existing focused contract checks; no unit tests were added.
- All 36 Cargo lockfiles validated with `--locked` in offline mode.
- Documentation, both examples, intended-app and self-host dry-run builds.
- Self-host local `/healthz` and `/readyz` checks.

The initial browser failures were classified as
`environment_or_infrastructure_failure`: Firefox and WebKit were absent.
Installation then stalled during extraction under Node 26. Repeating the install
under CI's Node 24 completed, and both browser projects passed. No application
change was needed. These results precede the package version edit; the versioned
build and packed acceptance are recorded separately below when complete.

## Remaining release and R152 gates

1. Complete local release checks, rebuild 0.8.0 with stable inputs and run packed
   Console/Gateway/Runtime acceptance against its packaged migrations.
2. Run cross-platform release CI against the exact approved revision. Obtain
   release authorization before publication; preparing 0.8.0 does not publish it.
3. Publish both packages and update private consumers to their exact versions.
4. Review the client/server cutover above, then perform the separately authorized
   hosted migration, deployment, provider/runtime challenge, activation and canary.
5. Finish remaining writer-path coverage, existing namespace inventory/adoption,
   regional routing and the final operational/latency rollout decision recorded
   in the [R152 plan](refactor-152-regional-D1.md).

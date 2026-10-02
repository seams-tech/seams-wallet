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

1. Preserve the reviewed candidate revision below. Review later `dev` changes
   before including them in a release; current working-tree contents are not the
   frozen candidate.
2. Run cross-platform release CI against the exact approved revision. Obtain
   release authorization before publication; preparing 0.8.0 does not publish it.
3. Publish both packages and update private consumers to their exact versions.
4. Review the client/server cutover above, then perform the separately authorized
   hosted migration, deployment, provider/runtime challenge, activation and canary.
5. Finish remaining writer-path coverage, existing namespace inventory/adoption,
   regional routing and the final operational/latency rollout decision recorded
   in the [R152 plan](refactor-152-regional-D1.md).

## Versioned candidate and source isolation

The version manifests and release preparation were committed as `04a7c17c`.
The candidate source is **`335f2878d73ec86a35d041f99de256160c5ca0f6`**.
Two subsequent import-cleanup commits, `4fbf962a` and `335f2878`, were reviewed:
52 TypeScript files change imports/re-exports, with no implementation-statement
changes. Imports now reach the same existing base64, NEAR and session-fact
implementations directly, reducing unnecessary dependencies and an import cycle.

The full production build passed for browser WASM, all five custody Workers,
host-local tools and both SDK packages. The import cleanups landed during that
build. All native source inputs remained unchanged; the TypeScript packages were
rebuilt after review. A later, uncommitted migration 0041 then appeared during
packing. The forty-migration acceptance check rejected that live-tree tarball.
A live-tree signing rerun also stopped at an unused-import type error in another
task's unfinished route edit. Neither result is attributed to the frozen candidate.

The accepted packages were therefore built from a `git archive` snapshot of
`335f2878` inside the artifact directory. No branch or worktree was created.
Fresh native outputs from the production build were copied into that snapshot;
the SDK packages were rebuilt there and passed the packed-package boundary check.
All **2,893 archived non-document source files** match their Git blobs, excluding
the regenerated artifact manifest. This keeps later uncommitted work outside the
candidate. Cross-platform CI must still rebuild the exact chosen revision.

| Package | Local tarball SHA-256 |
| --- | --- |
| `@seams/wallet@0.8.0` | `14b92c67822897852cb0359f9a3fdf57a140172376f48e301877a2753c6de824` |
| `@seams/wallet-server@0.8.0` | `889e719010d10cf3f5dc9eddea3e3b1eddf544dac8569e89435065f44cf5b927` |

The packed Server composed E2E passed in **21.8 seconds** against private revision
`aa1d2ae6c5cf9fa1703872761793e86a4d9b8e51`. It verifies fresh proof through both
actual local D1 bindings, immutable reservation, activation, replay, expiry,
deployment drift, stale-version rejection and readiness. All **103 manifest file
records** verify. The original **39 signer migrations** remain byte-identical to
npm 0.7.3; **0040 is the only added migration** in this candidate. The fingerprint
remains `ee4dce77798594d88e526ad2e9130666af26aadd1d3c41aa30c7afeed95af48d`.
Private Console server and frontend type-check against the packed 0.8.0
declarations. The archived public source also passes the full type-check and
documentation build. Its sustained Tempo/Arc signing scenario passes in **1.2
minutes**, exercising fresh presignatures beyond pool capacity. All **20 browser
cases** pass against the archived candidate across Chromium, Firefox and WebKit
in **22.3 seconds**. These are local test durations, not hosted latency benchmarks.

Evidence lives in `.artifacts/r152/release-0.8.0-20261002/` in both repositories.
The public `snapshot-packs/` tarballs, `snapshot-source-verification.json`, import
review, build/check logs and private package-verification and E2E receipts identify
the tested bytes. Earlier live-tree tarballs are retained separately as rejected
evidence. Private dependency pins remain at the published 0.7.3 release. No
publication or hosted deployment was performed.

## CI dispatch and macOS Intel validation

The reviewed candidate `335f2878` was pushed to remote `dev` on October 2.
Both validation runs were dispatched and their `headSha` checked against the
full candidate revision:

- [Wallet validation](https://github.com/seams-tech/seams-wallet/actions/runs/36960863406)
- [Router A/B validation](https://github.com/seams-tech/seams-wallet/actions/runs/36960865648)

Both were still running at this checkpoint. Dispatch is not a passing CI result.
The release publishing workflow was not dispatched, and no PR was created.
Later local commits and unfinished changes were excluded from the push.

The existing local-tools build script successfully cross-compiled
`x86_64-apple-darwin` from the archived candidate in **1 minute 6 seconds**.
The resulting Mach-O x86_64 initializer ran successfully on this Apple Silicon
host, generating six files, four directories and URLs for all five roles. This
checks translated execution; it is not a test on physical Intel hardware.
Its SHA-256 is
`4ba47932fd058e40519cd1ead06e8e04e225f3eb98a409ce883ea4507312ac95`.
The previously tested tarballs remain unchanged; this additional binary and its
receipt are separate local build evidence. Linux validation is still pending CI.

Logs, initializer output and a source/run receipt are retained in
`.artifacts/r152/release-ci-20261002/`. Reproduce the Intel build with
`node scripts/build-local-tools.mjs x86_64-apple-darwin` at the selected revision
after installing that Rust target.

## Concrete hosted cutover constraints

Read-only inspection of private revision `aa1d2ae` identified two constraints to
resolve before a production-testnet pilot:

1. `node scripts/deploy-surface.mjs plan --site production --component wallet-host`
   selects both `test.sign.seams.sh` and `sign.seams.sh`. The implementation builds
   one hosted-wallet artifact and deploys it to every lane in the production site.
   The frontend workflow's `wallet_revision` input selects public documentation
   sources; installed exact package pins select the SDK assets. A backend-only
   testnet upgrade followed by the current production wallet-host workflow could
   therefore put 0.8.0 client code in front of a 0.7.3 mainnet backend.
2. Published 0.7.3 and the archived 0.8.0 asset manifests both advertise iframe
   protocol `2.0.0`. The typed iframe protocol mismatch check does not distinguish
   this SDK/backend bootstrap change. Generated HTML and JSON use `no-store`,
   while JavaScript/CSS/WASM use a 300-second revalidation policy; these generated
   headers do not prove hosted cache behavior and cannot unload existing tabs.

For the testnet-first plan, add lane-specific selection to the existing frontend
deployment path and verify that build, deploy and smoke target the same selected
lane. Preserve mainnet's existing deployment. Before admitting traffic, prove the
chosen treatment of an already-open 0.7.3 client: it must receive an actionable
reload/upgrade outcome, and a reloaded 0.8.0 client must complete registration and
signing through the activated backend. Record the affected integrator SDK versions
and a rollback sequence for both client and backend. A coordinated all-lane
cutover remains a separate scope decision; this checkpoint does not select it.

Repeat the composed acceptance with the retained extracted package:

```sh
SEAMS_WALLET_SERVER_CANDIDATE="$PWD/.artifacts/r152/release-0.8.0-20261002/package" \
  pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-home-challenge.e2e.test.ts --reporter=line \
  --output=test-results/r152-release-080
```

Run that command from `seams-monorepo`. In `seams-wallet`, repeat the archived
signing case with:

```sh
SEAMS_INTENDED_SKIP_BUILD=1 \
  pnpm -C .artifacts/r152/release-0.8.0-20261002/snapshot/tests \
  test:intended:representative --grep 'sustained Tempo and Arc'
```

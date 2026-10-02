# R152 / Wallet 0.8.0 release preparation

> Superseded ownership decision (October 2): production placement is per wallet,
> selected from trusted registration ingress location across US, WEUR and APAC.
> Namespace-wide ownership is historical experiment evidence only. The active
> [R152 replacement inventory and checklist](refactor-152-regional-D1.md#authoritative-replacement-phase-per-wallet-regional-homes)
> governs implementation and removal of the old paths. Release 0.8.0 is held.


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

The first constraint is resolved locally by private commit `709daa3`, as detailed
below. Before admitting traffic, prove the
chosen treatment of an already-open 0.7.3 client: it must receive an actionable
reload/upgrade outcome, and a reloaded 0.8.0 client must complete registration and
signing through the activated backend. Record the affected integrator SDK versions
and a rollback sequence for both client and backend. A coordinated all-lane
cutover remains a separate scope decision; this checkpoint does not select it.

### Lane-specific frontend deployment evidence — 2026-10-02

Private commit `709daa3` adds `--lane production-testnet` to the existing
`scripts/deploy-surface.mjs` command for `--site production --component wallet-host`.
Use the same selection for `build`, `deploy` and `smoke`. Its artifact directory is
`.release-artifacts/wallet-host/production-testnet`; mainnet and whole-site builds
have separate directories. Omitting `--lane` deliberately selects every lane in
the site. A lane outside the selected site, repeated lane arguments, or a lane
combined with another component fails before deployment.

Both existing frontend workflows expose `wallet_lane`, defaulting to `all`.
Select `surface=wallet-host` and `wallet_lane=production-testnet` for a production
testnet-only deployment. Site-wide frontend concurrency prevents overlapping
whole-site and selected-lane workflow runs. Installed exact package pins still
select the SDK version; this change leaves the private pins at 0.7.3.

The E2E executes the real deployment CLI and Vite build, intercepts only the Pages
upload into a local provider emulator, and performs HTTP smoke checks against
the resulting assets. Outbound smoke requests outside the expected wallet hosts
are rejected. The final run passed in 2.2 seconds and established:

- Exactly one Pages deployment, to the testnet fixture project, using the
  testnet-specific build directory.
- All five readiness requests targeted testnet.
- The existing mainnet page remained accessible with unchanged content and
  SHA-256 digest.
- Invalid lane selections failed, and a subsequent mainnet deploy could not
  consume the existing testnet build. No additional Pages uploads occurred.

Seven existing frontend checks, ESLint, the E2E TypeScript check, and both workflow
YAML/shell syntax checks also passed. This verifies deployment scope using the
installed 0.7.3 package; it does not establish hosted 0.8.0 cutover or Cloudflare
cache behavior. No infrastructure deployment was performed.

Reproduce from `seams-monorepo`:

```sh
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/frontend-lane-deployment.e2e.test.ts --reporter=line \
  --output=test-results/r152-frontend-lane
```

The output directory retains `frontend-lane-evidence.json`, build/deploy/smoke
logs, the isolated build checkout and local Pages contents. A copy of the receipt
and logs is retained in `.artifacts/r152/frontend-lane-20261002/` in the private
repository. Candidate CI remains tied to public revision `335f2878`; this private
change and documentation update do not alter that release candidate.
At this checkpoint, the [Router A/B CI run](https://github.com/seams-tech/seams-wallet/actions/runs/36960865648)
completed successfully, including the entrypoint, Cloudflare adapter, core/dev
and startup dry-run jobs. The [Wallet CI run](https://github.com/seams-tech/seams-wallet/actions/runs/36960863406)
subsequently completed successfully at the same exact revision. Both candidate
CI runs are now green. Publication and hosted deployment remain pending.

### Published-client upgrade rejection probe — 2026-10-02

A Chromium experiment bundled the installed npm 0.7.3 registration client and
the frozen 0.8.0 registration client separately. Each called its real
`setupWalletRegistration` transport over HTTP against a local fixture returning
409 with `{ ok: false, code: 'wallet_protocol_mismatch', message }`. Both clients
threw the exact server-provided message after one request, with no retry:

> Your wallet application needs an update. Reload this page and try again. If the
> problem continues, ask the application developer to upgrade the Wallet SDK.

The fixture was corrected to use positive NEAR signer slot 1 before the passing
run. No production changes were needed for this experiment. This establishes
error propagation through the published registration transport. It does not
prove application UI rendering, a production protocol fence, or successful
registration/signing after reload.

The repeatable script and receipt, including both source SHA-256 digests and
observed requests, are retained in private
`.artifacts/r152/client-cutover-20261002/{probe.mjs,results.json}`. Reproduce from
`seams-monorepo` with
`node .artifacts/r152/client-cutover-20261002/probe.mjs`.

### Selected protocol boundary and rollout order

The subsequent instruction to proceed selects the recommended explicit protocol
check. Wallet-management requests now require `X-Seams-Wallet-Protocol: 1`.
The SDK adds it in the shared registration/management transport. The server
checks it after matching a wallet-management route and before reading the body
or calling its route services. Missing, unsupported or combined header values
return HTTP 409 with `wallet_protocol_mismatch` and the upgrade message above.
The header is a wire declaration and grants no authority.

This covers registration, signer setup/inventory, auth-method management and
implicit NEAR funding. Signing, recovery and export endpoints retain their own
contracts. Express delegates to the same Fetch router, and the CORS allow list
includes the header. The private deployment registration canary sends it in
commit `888c919`; direct HTTP integrators must also send it.

Use this order for the selected lane after fresh candidate validation:

1. Deploy the enforcing server and verify missing/unsupported protocol requests
   receive an actionable rejection. Retain the unchanged mainnet lane.
2. Deploy the matching SDK assets to that lane and verify registration and
   signatures through the real hosted Console path. Inspect generated and hosted
   cache behavior, and verify an already-open tab's error and subsequent reload.
3. Confirm each integrator has upgraded its package pin. Reloading a page cannot
   upgrade an integrator's installed SDK. During the interval between the first
   two steps, older wallet-management calls are deliberately rejected.

The new client cannot enforce this contract on a 0.7.3 server, which predates the
check. Do not deploy the new client first or blindly roll the backend back while
new tabs remain active. A rollback across that boundary requires pausing affected
traffic and restoring a verified matching client/server pair, including the
already-open-client treatment. The existing registration-setup pause alone does
not establish that condition for all wallet-management routes. Hosted rollback
verification remains a release gate.

Rebuild and freeze the resulting candidate, re-run package acceptance and CI,
and keep the existing `335f2878` artifacts as the previous validated checkpoint.
Its green CI does not cover the protocol check. Review subsequent dev commits
before including them; the protocol change does not authorize inclusion of all
concurrent source changes.

### Local protocol acceptance — 2026-10-02

The composed browser/Gateway test passed in **30.3 seconds**, including the
actual installed npm 0.7.3 registration module and the rebuilt current SDK:

- Removing the protocol header from a live registration request produced one
  rejected request and an actionable message in the intended app's error output.
- The published 0.7.3 module independently received the upgrade message from the
  real local Gateway. It did not receive an incompatible bootstrap response.
- An unsupported protocol with malformed JSON returned 409 before JSON parsing.
- CORS preflight allowed the header. Reloading the matching client completed
  registration, followed by cryptographically verified Tempo and Arc signatures.

SDK and Server builds, both package type checks, intended-test type checking,
packed-package boundary checks and the bloat check passed. Private deployment
canary adoption/retry acceptance passed in **3.9 seconds**. These are local
working-tree checks; a new frozen release and hosted Console acceptance remain
required. Later concurrent step-up changes were committed as `6d486fdd` after
these package builds and must be reviewed before a new release selection.

The wider registration suite completed eleven cases, then stalled in a NEAR-hold
scenario and was stopped. The first direct retry used the harness's default app
URL on port 4001 and loaded the public site; that retry is classified as
`environment_or_infrastructure_failure`. With explicit local app/Gateway/wallet
URLs, both remaining NEAR-hold cases passed in **35.4 seconds**, without a
production or test-logic change. All thirteen registration cases have passing
coverage across those runs. The initial stall's cause was not established; this
is not a claim that the original uninterrupted suite completed successfully.

An additional passkey-to-Email-OTP auth-method scenario was attempted but is not
counted as passing. The configured Google test token was expired or near expiry
under the isolated test's lifetime requirement. This is an
`environment_or_infrastructure_failure`; a fresh usable Google test token is
required to complete that extra check. No production behavior was changed for it.

Reproduce the published-client check from `seams-wallet`, setting the package
root to an installed or extracted npm 0.7.3 package (the test verifies its name
and version):

```sh
SEAMS_PUBLISHED_WALLET_ROOT=/absolute/path/to/old-wallet-package \
SEAMS_INTENDED_SKIP_BUILD=1 \
  pnpm -C tests test:intended:representative --grep 'wallet protocol rejection'
```

Rebuild Wallet Server and the Wallet SDK first when source changes. Omitting the
published-package variable still exercises the missing-header request shape,
visible error, unsupported protocol, preflight, reload and verified signatures.
The receipt explicitly reports whether the published client was included.
Logs, `wallet-protocol-cutover.json`, the standalone published-client probe,
source/compiled-file hashes and the generated package manifest are retained in
`.artifacts/r152/protocol-20261002/`. This does not prove how every deployed
integrator renders an SDK error or how its assets update on reload.

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


## Protocol candidate acceptance — October 2

The next frozen 0.8.0 candidate is
`94b4c98845c188f26403488fea757abf1421d845`. Both repositories remain on `dev`.
Validation uses an artifact-directory source snapshot, with no branch or worktree.
The prior `335f2878` checkpoint and its successful CI remain separate evidence.

The intervening review includes the internal-field cleanup, cast removals,
comment/test-hook cleanup, step-up expiry fix and wallet-management protocol
gate. An independent esbuild comparison of all 122 cast-cleanup files found
identical normalized JavaScript. The field cleanup preserves the reviewed
validation calls and authority/recovery rejection branches. The new expiry
behavior checks the time after factor verification and at database admission;
its dedicated acceptance test passes on SQLite and Workers D1 emulation.
These checks support candidate inclusion; hosted rollout gates remain open.

All **2,898 archived non-document source files** match their Git blobs, excluding
the regenerated package manifest. Local native outputs are reused from the
previous validated build: subsequent native-source changes are Rust doc comments
and formal-model/documentation changes. Both TypeScript packages were rebuilt
inside the snapshot. Exact-revision CI must rebuild the native artifacts.
The dependency lockfile is unchanged and local checks use existing dependencies;
a redundant install attempt stopped at pnpm's noninteractive directory prompt.

| Package | Local tarball SHA-256 |
| --- | --- |
| `@seams/wallet@0.8.0` | `e3fa63b6dc1f5a0a324144e910bf6ea5492de460a44602973dd6121d63cddc49` |
| `@seams/wallet-server@0.8.0` | `dd78ce6ce7823a4faaa7fad46f54c26bdd0a3a81dd7e83bded294ce8a50fa122` |

All **104 package manifest records** verify. The first **40 migrations** are
byte-identical to the previous candidate, including the first 39 from npm 0.7.3.
Migration **0041** is the sole addition. Its signer migration fingerprint is
`60f934398a2c4f68a6f9b5f580d512ead31e76487f64d66829b18bd9f2d090e7`.

Local acceptance against the frozen source and tarballs:

- Package builds, packed-boundary checks and full public TypeScript checks pass.
- Private Console server and frontend type-check against the extracted packages.
- Published 0.7.3 rejection, visible upgrade message, matching reload/registration
  and verified Tempo/Arc signatures pass in **35.0 seconds**.
- The configured Google service-account credential refresh succeeds. The
  passkey-to-Email-OTP lifecycle case passes in **48.4 seconds**, covering lost
  finalize-reply retry, duplicate-factor rejection, reload/unlock, signing,
  budget step-up, key export, revocation and rejection of the revoked method.
  This resolves the earlier token-expiry blocker for this local case.
- Sustained Tempo/Arc signing beyond pool capacity passes in **1.2 minutes**.
- Packed Server home-challenge acceptance passes in **15.2 seconds** against
  private revision `888c9199220fe5cfd0347f81060f06c8d2e67757`.
  Its initial invocation failed before assertions because the supplied output
  path escaped Workerd's starting directory through `..`. Classification:
  `environment_or_infrastructure_failure`. The normal test-results path passes
  without any production or test-source change.
- All **20 representative browser cases** pass across Chromium, Firefox and
  WebKit in **15.3 seconds**. A final protocol repeat passes in **33.3 seconds**
  and retains `wallet-protocol-cutover.json` beside the candidate logs.
- Bloat checks pass. An accidentally unfiltered 698-case browser run was stopped;
  it is excluded from passing evidence.

The exact candidate was pushed to `dev`, and both validation workflows were
confirmed running on that SHA:

- [Wallet validation](https://github.com/seams-tech/seams-wallet/actions/runs/36972255800)
- [Router A/B validation](https://github.com/seams-tech/seams-wallet/actions/runs/36972258585)

These runs were in progress when dispatched; the previous candidate's green CI
does not establish their result. Evidence is retained under
`.artifacts/r152/release-0.8.0-protocol-20261002/` in both repositories: source
verification, review and cast comparison, tarballs, build/type-check and browser
logs, step-up expiry receipt, package manifest verification and Console home
receipts. Local test durations are acceptance timings, not hosted latency data.

Next: check both exact-revision CI results; finish the concrete release and
hosted-cutover gates before publication; consume exact 0.8.0 packages privately;
perform the coordinated testnet migration/backend/frontend rollout and verify
an already-open old client, reload and rollback. Then continue the remaining
writer-path coverage, namespace adoption, regional routing and travel-latency
measurements. Private package pins remain 0.7.3. No package publication or hosted
infrastructure deployment occurred in this step.


## Green candidate CI and publication handoff — October 2

Both exact-revision workflows completed successfully at
`94b4c98845c188f26403488fea757abf1421d845`:

- [Wallet validation](https://github.com/seams-tech/seams-wallet/actions/runs/36972255800)
  completed at 16:04 JST, including the production build, type checks,
  representative browser/lifecycle checks, packaging, docs/examples and self-host smoke.
- [Router A/B validation](https://github.com/seams-tech/seams-wallet/actions/runs/36972258585)
  completed at 15:22 JST, including core/dev, Cloudflare adapter, entrypoint and
  startup dry-run jobs.

Registry checks still report 0.7.3 as latest for both packages. Remote `dev`
points to the validated candidate; remote `main` remains the 0.7.3 release merge
`2bc58391ddeef44eb1432ccd15be8a0d31332d55`. The latter is not an ancestor of dev,
because dev does not contain the release merge commits. A read-only
`git merge-tree --write-tree` check succeeds without conflicts and produces
`b1ab8a457309161d3811b567d3dc5a87f64a063c`, exactly the validated candidate's tree.
No branch was changed by that check.

The concrete publication step is to promote a merge containing both histories,
verify that its tree equals the validated candidate tree, and dispatch
`release-wallet-packages.yml` on `main` with version `0.8.0`. Recheck remote heads
before promotion; do not force-push or include later source changes implicitly.
Retain the release run and verify both npm package versions and integrity after
publication. The workflow rebuilds all three host-tool targets and publishes
both packages through the npm-release environment. Promotion and npm publication
have not occurred; the prior explicit release authorization covered 0.7.3, while
the 0.8.0 response selected the preparation version.

After publication, consume exact 0.8.0 packages in the private repository and
complete the coordinated production-testnet backend/frontend cutover, including
migration 0041 as well as 0040, hosted old-client/reload treatment and rollback.
Publishing the SDK does not authorize admitting hosted traffic before those
checks. Keep production mainnet outside the testnet rollout scope.


## Release held for complete regional implementation — October 2

The user requires all remaining R152 code before publishing 0.8.0: APAC/WEUR
Gateway routing and automatic home assignment, complete internal/lifecycle
entry-point enforcement, and regional concurrency/travel-latency verification.
All existing wallets are disposable test wallets, so existing-wallet migration
is excluded. Do not publish the green intermediate candidate under the earlier
conditional approval. No publication or deployment was performed.

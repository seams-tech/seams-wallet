# R152 / Wallet 0.8.0 release preparation

> Superseded ownership decision (October 2): production placement is per wallet,
> selected from trusted registration ingress location across US, WEUR and APAC.
> Namespace-wide ownership is historical experiment evidence only. The active
> [R152 replacement inventory and checklist](refactor-152-regional-D1.md#authoritative-replacement-phase-per-wallet-regional-homes)
> governs implementation and removal of the old paths. Release 0.8.0 is held.


Performance evidence: the [consolidated R152 timing summary](refactor-152-results.md#consolidated-performance-summary-october-2)
records London and Tokyo signing medians/p95s, first-sign/burst results, D1 versus
SQL time, and separate hosted Console diagnostics. Those measured placement gains
remain valid for the recorded experiments. Per-wallet routing and repeated
hosted acceptance remain open; these timings do not establish release readiness.

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


## Wallet identity scope acceptance — October 2

The paired public/private correction replaces wallet-ID-only joins in the
Runtime balance reader and Console projections (private commit `0aa5ef9`).
The Runtime contract now requires
`{projectId, envId, walletId}` for every requested and returned identity. Signer
queries bind the configured namespace, requested organization, and exact tuples.
Identity reads no longer initialize unrelated signing services. Console resolves
its environment database IDs to runtime environment keys in one batched lookup
for stale wallets, verifies reply scope, and skips Runtime entirely for a fully
cached or empty selection.

Console migration 0053 preserves projection metadata under the full scoped key,
resets derived balances, and discards snapshots produced by the old lookup.
Address uniqueness, cache foreign keys, single-wallet lookup/refresh requests,
pagination cursors and dashboard merge/expansion keys now preserve project and
environment. ID-only request and cursor compatibility paths were removed.

Local acceptance against an extracted `@seams/wallet-server@0.8.0` candidate:

- The real Console route → service binding → Runtime → D1 scenario passes
  (`tests/relayer/wallet-identity-scope.e2e.test.ts`, 7.7 seconds on this run).
  Three same-ID wallets per namespace retain their distinct project/environment
  identities. Namespace A balances are `[1, 2, 3]`; namespace B balances are
  `[11, 12, 13]`. An organization-scoped Runtime request returns its own three
  identities; Console requests for absent organization wallets expose none.
- All three sort fields in both directions paginate without losing same-ID
  wallets. Missing scope is rejected. Cached refresh performs no RPC calls;
  wrong-scope replies fail before RPC/write effects. RPC failure preserves the
  three separate last-good balances. A nonexistent NEAR account yields zero.
- Applying the full Console migration chain to a populated old projection/cache
  preserves its metadata, resets its derived balance, and removes the old cache.
  Six new scoped snapshots survive readback; `PRAGMA foreign_key_check` is empty.
- Server and frontend candidate type checks pass. The new type fixture rejects
  ID-only lookups, partial-key spreads, incomplete refresh keys and unscoped
  Runtime requests/replies. The public server build and bloat check pass.
- The existing persistent-D1 wallet-directory E2E also passes (7.4 seconds),
  including the full Console migration chain with 0053.

Evidence is retained in the private repository under
`.artifacts/r152/wallet-identity-20261002/`: extracted candidate, type-check
configs/logs, build/bloat logs and `wallet-identity-evidence.json`. The receipt
SHA-256 is `02c79c0afa76021dd1e90360523d26569c215b62b7391bbe157634b4571a0a70`;
the candidate tarball SHA-256 is
`7b58e044f2b19e84a370f571f037eab315b03683a4983198089158bf55bb004b`.
Repeat from the private repository with the candidate extracted locally:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/absolute/path/to/extracted/package \
  pnpm exec playwright test --config tests/playwright.relayer.config.ts \
  tests/relayer/wallet-identity-scope.e2e.test.ts --reporter=line
```

The two superseded hand-built balance/identity tests were retired after moving
their supported cache, absent-account and failed-refresh behavior into this
composed scenario. This is local correctness evidence. Hosted per-wallet
registration reservation, shared identity authority, regional fan-out and
lifecycle enforcement remain open. Private package pins remain 0.7.3 pending the
coordinated release. No hosted migration, reset, deployment or publication ran.

## October 2: durable setup delivery prerequisite (protocol 2)

The browser now commits a setup operation ID to IndexedDB before its first
request. Matching requests share the ID across tabs and reloads; scope and
normalized-request digests prevent accidental reuse across environments or
different requests. Accepted replies pin both wallet and ceremony. The journal
stores digests and IDs, with no raw authentication proof or publishable key.

Review found that cleanup in the normal success handler would miss resumed
registration. Cleanup now runs after the shared local commit-publication method,
using its own database manager and exact wallet/ceremony identity. Cleanup
failure cannot undo the committed wallet. The response parser also preserves
the validated `WalletId` type instead of widening it back to a string.

The candidate wallet-management protocol is now **2**. Setup requires
`registrationOperationId`; missing/old protocol requests keep the actionable
upgrade error. Console's direct provisioning canary sends the matching header
and operation field. This supersedes protocol 1 in the earlier candidate notes.

Local verification:

- Chromium, Firefox and WebKit passed the browser delivery scenario: concurrent
  tabs, lost replies, reload, changed-wallet/ceremony rejection, environment
  isolation, exact cleanup, a subsequent fresh operation, and corrupt storage
  rejected before network effects. Each run emits a JSON receipt.
- The full local protocol-cutover contract passed: missing/unsupported/protocol-1
  requests rejected before parsing; missing setup operation rejected; upgrade
  message visible; reload followed by successful registration, verified Tempo
  and Arc signatures, NEAR readiness, and no accepted setup entries remaining.
  The 12.9-minute command duration includes rebuilding the Rust/WASM services;
  it is not a wallet latency measurement. The optional published-0.7.3 package
  probe was not requested in this run.
- Wallet and server type checks, lifecycle type fixtures, intended-contract
  type checks, SDK/server builds, and the public bloat check passed.
- Console's candidate-backed server type check and persistent-D1 writer-binding
  E2E passed (15.5 seconds). Protocol-2 requests still fail at writer admission
  when their deployed version is unauthorized. Private evidence is under
  `.artifacts/r152/setup-delivery-20261002/`; this run used the freshly built
  local server package via `SEAMS_WALLET_SERVER_CANDIDATE`.

Public repository evidence is retained under
`.artifacts/r152/setup-delivery-20261002/`, including three browser receipts and
their hashes in `browser-receipts.json`, build/check logs and
`wallet-protocol-cutover.json`. The latter's SHA-256 is
`3748746d646254c39aaa7b6d88834031fe3be42f24adaf1243b320efd213d91d`.
Repeat from the public repository:

```sh
pnpm --dir tests exec playwright test -c playwright.wallet-browser.config.ts \
  wallet-ui/registration-setup.browser.test.ts
pnpm --dir tests exec node scripts/run-wallet-intended-isolated.mjs \
  e2e/intended-behaviours/passkey.registration.contract.test.ts \
  --grep 'wallet protocol rejection'
```

**Server reservation replay remains open.** The service still independently
allocates setup identities. Next, use the operation ID plus verified tenant,
Origin and normalized request to reserve through Console before Router effects;
resume the winning regional preparation/ceremony; then wire terminal
expiry/cancellation and an explicit fresh attempt. Do not release this
prerequisite as completed server idempotency or per-wallet regional routing.
Regional continuation routing, shared identity authority, lifecycle enforcement
and namespace-placement removal remain held together under R152. No deployment
or publication occurred; private package pins remain 0.7.3.

## October 3: authoritative setup admission and immutable replay

This supersedes the October 2 server-reservation prerequisite above. Authenticated
Gateway setup now calls Console's wallet-home authority using the operation ID and
a digest of the exact tenant, Origin and normalized request. It consumes the
winning wallet, ceremony, preparation, authority, device and auth-method IDs.
A Gateway whose physical account/database differs from the reservation fails
closed. The standalone local host has an explicit persistent local authority.

Regional D1 now keeps an immutable setup snapshot alongside the mutable ceremony.
Insert-or-read selects the initial preparation; retries reconcile a missing
ceremony without resetting an existing ceremony's progress. The original expiry
is retained. The old independent setup allocator and `putCeremony` API were
removed. Review added exact ceremony/organization/expiry checks to the stored
snapshot checks and kept asynchronous signing failures within the setup error
boundary.

Correction: ECDSA setup builds preparation facts locally from Router topology;
it does not invoke Router. Its random session ID and replay nonce still require
durable replay. Later registration stages perform Router work.

Verification covers two distinct boundaries:

- Public local lifecycle: simultaneous initial setup requests, a discarded reply,
  replay of identical preparation facts, registration after reload, verified Tempo
  and Arc signatures, NEAR readiness, and setup replay after commit. A changed
  request conflicts. The standalone authority is a local development composition.
- Private persistent-D1 composition: the production Console admission adapter and
  service reserve three independent US/WEUR/APAC wallets in one tenant. Lost
  replies and competing Workers preserve each allocation. A travelled retry
  retains its home; another physical D1 is rejected; changed Origin conflicts.
  Existing directory restart, ownership and writer-admission checks also pass.
  Receipt SHA-256: `f83bdb08f9d31597c47f1dd2b451016ca281b32fe930c926ac80971e69d83d29`.

Evidence and check logs live in each repository under
`.artifacts/r152/registration-admission-20261003/`. Public server build,
server/intended type checks and bloat checks pass. Private server and admission
fixture type checks use the built candidate's declarations. The private E2E took
3.3 seconds; the final public lifecycle test passed in 28.7 seconds with the
fresh server build and cached Rust/SDK builds. These are test runtimes. Public
receipt SHA-256: `3886b893c64670c45b61527dd236609dbce099ac9ea555ee8849ba59166989df`.

Repeat the private test with the candidate built:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
  pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/wallet-home-directory.e2e.test.ts --reporter=line
```

Repeat the public protocol/registration lifecycle command from the October 2
section. Its receipt now also records setup replay and changed-request rejection.

**R152 remains incomplete and 0.8.0 remains held.** Next: render the three-region
Gateway catalog and dispatch setup to the reserved home; route and bind all
continuations/lifecycle operations to that home; connect terminal completion,
cancellation and deliberate fresh attempts; complete shared-identity authority
and remove remaining namespace placement. These local tests do not establish
hosted routing or geographic latency. No deployment or publication occurred.

## October 3: regional transport and terminal registration checkpoint

Candidate setup now reserves after publishable-key, exact-Origin and policy
admission, then selects a fixed US/WEUR/APAC service binding. A receiving
`WalletHomeGateway` entrypoint re-runs authentication and cannot forward again.
The hop state comes from the entrypoint, independent of client headers. This uses
Cloudflare's [named service entrypoints](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/#named-entrypoints).
The request-scoped reservation result is reused for local setup execution.

Directory dispatch also covers registration respond, activate, near-admission,
near-provisioning and the explicit `/wallets/:walletId/` custody, signer,
auth-method, recovery-status and NEAR-funding paths. Destination route proof
verification remains in place. OPTIONS bypasses directory lookup, and early
forwarding responses receive configured CORS headers. An unavailable target
returns `regional_gateway_unavailable` (503); redirects are rejected. A binding
that points at the wrong home receives `wallet_home_mismatch` (409), without a
second hop or fallback write.

Registration's four continuation services now check their ceremony/wallet against
the assigned physical resource before effects. Console establishment follows the
durable registration receipt and precedes cleanup. A lost completion response
can replay idempotently; an already-terminal matching state avoids an additional
completion write. Definitive registration failure records cancellation before
local deletion. Conflicting terminal outcomes return typed failures. Expiry does
not automatically cancel potentially in-flight work; reconciliation and explicit
fresh attempts remain open.

Review fixed a lifecycle defect: setup replay previously could reinstall the
initial mutable ceremony after successful cleanup. Reservation admission now
carries required `reserved`/`established` state. Established replay returns the
immutable snapshot without recreating a ceremony. Type fixtures reject missing
lifecycle, cancelled admission and failure objects carrying executable state.

Verification:

- The public Chromium lifecycle passed in **28.6s**: initial setup race, discarded
  reply, registration/signing, NEAR readiness, setup replay after commit and a
  subsequent respond request rejected because the cleaned ceremony stays deleted.
  Receipt SHA-256:
  `8fe0bc5f2e4015086dc66b9dc4f205e824689b06a3b6679ebf5c0ee7affe74e9`.
- The private persistent-D1 E2E passed in **4.0s**. It exercises the Console
  authority with two ingress Workers, three regional Workers and three separate
  signer databases. US/WEUR/APAC setup enters through a different region,
  concurrent travelled retries retain the winning allocation, continuation
  completes at that home, and each signer D1 has exactly its own wallet effect.
  Misdirected bindings, redirects, unavailable targets, lost terminal replies,
  late cancelled continuation and terminal outcome conflicts are covered.
  Receipt SHA-256:
  `1f8f8ec06d8c63d8dcc0c885c806c9ec524c521f1456a681d23ffa2174c31bbb`.
- Server build, public intended/lifecycle type checks, private candidate-backed
  server and fixture type checks, and bloat checks pass. Both repositories retain
  receipts/logs under `.artifacts/r152/regional-forwarding-20261003/`.

Use the repeat commands in the preceding October 3 section. The public run used
fresh server artifacts and cached SDK/Rust builds. These durations measure test
execution, not regional latency. The private regional transport fixture uses
controlled application authentication and simulated custody effects; it does not
prove the complete hosted Gateway/custody deployment. The local public lifecycle
uses the real local registration/signing composition.

**The requested cutover is not complete.** Remaining work is concrete:

1. Replace the single-resource deployment binding and writer activation with the
   admitted regional backend set, preserving fresh provider-bound challenges and
   stale-writer rejection. Render the catalog, regional service bindings and named
   entrypoints for Gateway and Wallet Runtime.
2. Move shared credential/provider/recovery/exchange identity admission to its
   authority, then route opaque-token and wallet-less paths without regional scans
   or multiplied tenant quotas.
3. Enforce home across direct Yao, Wallet Runtime, custody RPC and deferred work;
   complete expiry/retry/fresh-attempt handling and failure-window reconciliation.
4. Delete remaining single-D1 deployment assumptions, regenerate fixtures/configs,
   reset disposable test data, and run composed hosted/travel measurements.

No infrastructure was deployed and no package was published. Private package pins
remain 0.7.3; the 0.8.0 release remains held.

## October 3: deployment resource challenge checkpoint

Private implementation commit: `4acf5d2` on `dev`.

The private provider challenge now uses `resourceChallenge.ts`,
`tenant-resource-challenge.mjs`, `/internal/tenant-deployment/v1/resource-challenge`,
and the authenticated `verify-resource` endpoint/CLI operation. Operator cutover
accepts `resourceCheckpoint`; checkpoints identify a `resource`. The old challenge
paths and shapes have no compatibility handlers. Public signer migration 0042
renames the effective table to `deployment_resource_challenges` and replaces the
old index. The deployment workflow requires that migration in the consumed package.

The real Console/Gateway/Runtime Worker E2E proves two independently configured D1
resources for one namespace, rejects cross-resource proofs, and verifies no old
challenge table/index survives. Existing wrong-resource, stale-version, expiry,
one-use activation and lost-response cleanup checks pass. The E2E took 15.7s;
this is local test duration, with no geographic latency measurement. The test
uses simulated provider responses and source migrations from the candidate SDK.
It does not establish live Cloudflare allocation or regional-set activation.

The binding and directory/forwarding E2Es also passed. Candidate-backed server,
challenge E2E and resource type-fixture compilation passed; public bloat check
passed. The initial challenge harness build failure was classified
`valid_test_needs_update`: esbuild needed to preserve the Cloudflare runtime
module introduced by the named Gateway entrypoint.

Reproduce in `seams-monorepo`:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
  pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-home-challenge.e2e.test.ts --reporter=line
```

Private receipt: `.artifacts/r152/resource-challenges-20261003/`
`runtime-resource-challenge-evidence.json`; SHA-256 `a11656d781ea0b8f58eb52bfb69b0460f7f3f19cf59667d1395e6e955a2ed307`.

The singular deployment `home`, activation proof and renderer still need the
regional-set replacement. Shared locators, internal/deferred enforcement, expiry
reconciliation and composed hosted verification also remain. Nothing was deployed
or published; private package pins remain 0.7.3 and release 0.8.0 remains held.

## October 3: verified resource-set activation checkpoint

Private implementation: `af96653` on `dev`. The binding and its revision now identify
canonical `resources`, and activation persists one resource-verification set. Every
resource requires fresh Gateway/Runtime evidence; duplicate writer versions/names,
incomplete sets and reused challenges reject the whole activation. Runtime admission
matches the exact role/version/account/database tuple. Console requires its regional
catalog to match the active resource set before permitting wallet-home operations.
There is no singular binding/proof compatibility decoder.

Console migration 0054 retires old active pointers and pending cutovers for fresh
activation, preserves historical activation records and consumed challenge IDs, and
removes singular activation columns. A challenge-consumption failure rolls back the
whole activation, including pointer changes. The local migration rehearsal starts
with an existing activation and unfinished cutover and verifies those outcomes.
The migration has not been applied to hosted infrastructure.

The final three focused E2Es passed in **18.9s total**:

- Binding admission: three physical resources, six Gateway/Runtime versions, partial
  and duplicate proof rejection through both service and SQL paths, wrong-resource
  claims, partially reused challenge rollback, and completed-activation replay.
- Resource challenges: independent physical D1 proofs, stale writers, expiry and
  cleanup after a lost response. An altered regional catalog cannot reserve a wallet.
  The CLI challenges one resource; the other two activation proofs in this fixture
  use controlled provider evidence. This is not a deployed three-region proof run.
- Wallet directory and forwarding: regional concurrency, replay/travel, immutable
  reservations and terminal reconciliation continue passing.

Candidate-backed affected server compilation, all private type fixtures and both
activation/challenge E2E source checks passed, as did focused lint and the public
bloat check. A broader experimental test compilation exposed existing directory-test
DOM/Worker type conflicts, raw allocation fixtures and a retired `sqliteD1` import.
It did not pass; its diagnostics are retained separately. No new unit tests were
added. Changed retained fixtures reflect the new required resource/proof fields.

Reproduce in `seams-monorepo`:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
  pnpm --dir tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-deployment-binding.e2e.test.ts \
  relayer/tenant-home-challenge.e2e.test.ts \
  relayer/wallet-home-directory.e2e.test.ts --reporter=line
```

Private receipts and compiler/lint logs:
`.artifacts/r152/resource-set-activation-20261003/`. Receipt SHA-256 values:

| Receipt | SHA-256 |
| --- | --- |
| `console-binding-evidence.json` | `39daf889f0c7ea448cb88ab333dae6d22d9e846e35c28bc533c3bf75bde5b5a6` |
| `runtime-resource-challenge-evidence.json` | `33a48e77c89858aeccbbce58ab9ba72039bda7b884d76f87396a2a8a097a3c5d` |
| `wallet-home-evidence.json` | `a597f9d13740b2b777adefb798d1184354e3ef0a094a9d9c383eb2dca14af439` |

These are local correctness results, with no new geographic latency measurements.
Remaining deployment work: regional target configuration/rendering, proof collection
for all backends, readiness inspection across regions, and admission renewal when
serving versions change. Shared credential/recovery/token locators, internal/Runtime/
deferred enforcement, expiry/fresh attempts and composed hosted/travel acceptance
also remain. No infrastructure was deployed or reset, and no package was published.
Private pins remain 0.7.3; release 0.8.0 remains held.

### October 3: deployment admission renewal

The provisioner now honors explicit activation for unchanged tenant/surface bindings,
validates all resource proofs, and preserves the existing managed browser key.
Root/credential failures terminate unfinished cutovers. Cleanup checks durable
activation state before revocation, so a lost committed reply preserves the key.

The composed renewal E2E admits six new writer versions and rejects six old ones,
rejects incomplete proofs, retries after a root-service outage, rejects a revoked
key twice without leaving the lane stuck, and preserves a committed activation
when its reply is lost. The final fault-inclusive scenario passed in 8.7s; the
preceding three-test activation/challenge/renewal run passed in 23.9s. Focused lint
and candidate-backed server/type-fixture/E2E compilation passed. Full evidence,
reproduction and fixture limits are in `refactor-152-results.md`, October 3 renewal.

Receipt SHA-256: `d8b232d65474ddeed1431fd2340453b0ca60494ad99f64b09dd4f98d42f1139b`;
private location: `.artifacts/r152/deployment-renewal-20261003/`.
This closes provisioner renewal only. Regional configuration/rendering, all-backend
operator proof collection, regional readiness, shared locators, internal/deferred
home enforcement, expiry/fresh attempts and composed hosted/travel acceptance remain.
No deployment, hosted reset or package publication occurred; 0.8.0 remains held.

### October 3: regional Runtime readiness

Completed resource-bound inspection across US/WEUR/APAC and exact candidate-resource
coverage. Three production Runtime Workers on separate local D1s aggregate 3 source
wallets, 6 target wallets and one live APAC ceremony. That ceremony and an APAC outage
each block renewal; recovery allows retry. Wrong-resource responses and incomplete
coverage fail. The three focused E2Es passed in 45.5s; targeted compilation and lint
passed. See the matching results checkpoint for reproduction and fixture limitations.

Receipt: `.artifacts/r152/regional-readiness-20261003/deployment-renewal-evidence.json`;
SHA-256 `260c7e54fcc321810376e150bd85fe2b977631ba6d85950e8e979ca3c956c3bc`.
The current renderer still lacks the regional Runtime bindings required by this
composition. Regional configuration and complete-set operator proofs remain next,
followed by shared locators, internal/deferred enforcement, expiry and composed
hosted/travel acceptance. No deployment or publication occurred; 0.8.0 remains held.

### October 3: regional resource-challenge routing

Console now selects the catalog's exact Gateway/Runtime pair from a required
validated challenge resource. The singular Console D1-home fields and Gateway
challenge binding are removed. One Console verifies three separate local D1s and
six writer versions; foreign, unlisted and cross-resource requests fail. Three
focused E2Es passed in 21.6s; targeted compilation, lint and formatting passed.

Evidence and reproduction are in the matching results checkpoint. Receipt SHA-256:
`1bb4eb9351821bdcbf28a54ff64bea656498706ce73ad3a632434e444c0d7ab9` under
`.artifacts/r152/regional-resource-challenges-20261003/`. Provider/OIDC evidence is
controlled. Regional target generation and complete-set operator proof collection
remain incomplete; the CLI still selects one configured resource. No deployment,
reset or publication occurred. Release 0.8.0 remains held.

### October 3 regional deployment checkpoint

Schema 5 now models US/WEUR/APAC resources directly. Canonical APAC IDs remain;
US/WEUR allocations are explicitly pending. Rendering supplies seven Worker
configurations, the catalog and regional bindings; migration/deployment commands
iterate the regional set. The operator collects all three proofs and rechecks all
six serving writers before activation. Four focused E2Es passed in 22.6s, including
third-region lost-response cleanup; targeted TypeScript/lint passed. Full details,
repeat command and receipt hashes are in `refactor-152-results.md` under
“regional configuration and complete-set operator collection”.

Remaining: verified regional allocations and service-target bootstrap, shared
credential/recovery/session locators, direct Yao and Runtime routing, internal and
deferred enforcement, expiry reconciliation, and hosted concurrency/travel tests.
The existing update command requires pre-existing service-binding targets. No
hosted deployment or new geographic latency result; the 0.8.0 release remains held.

### October 3: opaque session and exchange routing

Console migration 0055 adds a tenant-scoped digest-to-wallet index. Gateway hashes
opaque primary/hosted credentials and exchange codes, resolves their wallet home,
and forwards through the existing fixed regional binding. Explicit wallet paths
must agree with the session wallet. Unknown credentials return 401; directory
outages return 503. The home-local authorization store still owns validity,
expiry, exchange consumption and revocation.

Only an admitted writer at the wallet's physical home can publish a locator.
Primary credentials (including linked-device activation) now share one preparation
path. Direct credential and exchange locators publish before local persistence;
a failed local commit can leave an inert locator. Hosted child credentials publish
after successful home-local exchange consumption and before returning the token.
If that publication fails, the caller receives no token and needs a fresh exchange;
the parent session remains usable. This is fail-closed ordering across two D1s,
with no distributed atomicity claim. Expired locators remain routable so the home
can apply current lifecycle rules; expiry metadata alone grants no authority.

The three-region Worker/D1 scenario passes with 12 digest-only locators. It checks
remote ingress, one winning concurrent exchange redemption, wrong-home publication,
wallet/token disagreement, publication outage, retirement of primary and child
credentials, and continued access by a second device of the same wallet. It uses
the production authorization preparation and local commit statements used by linked
devices; the complete device-linking ceremony is outside this test. Three existing
directory/challenge/activation E2Es also pass (25.3s). SDK build, public and
candidate-backed private type checks, focused lint and public bloat checks pass.

Remaining: passkey/external-identity/recovery/delivery lookup and shared uniqueness;
direct Yao, Runtime and deferred home enforcement; expiry/fresh-attempt handling;
verified regional allocations and service-target bootstrap; hosted concurrency and
travel acceptance. The replacement remains incomplete and 0.8.0 remains held.
No hosted deployment, reset, publication or geographic measurement occurred.

### October 3: direct Yao registration continuation routing

The private Gateway now resolves `/router-ab/ed25519/yao/registration/admit` from
`scope.lifecycle_id` and `/router-ab/ed25519/yao/registration/execute` from
`binding.lifecycle.lifecycle_id`. Both use the existing Console ceremony index
before regional service construction, including requests with the initial
registration credential. A supplied Wallet Session must name the same wallet as
the ceremony. The receiving Gateway repeats home resolution and rejects an
incorrect binding instead of forwarding again. Full request/proof validation
continues in the existing public registration handlers; the routing locator alone
confers no authority. No wire format or authorization policy changed.

The three-home directory E2E passed in 9.4s. Its controlled application/continuation
fixture records 12 effects (admit and execute, before and after establishment,
for each home) exclusively in the assigned D1. Malformed, unknown and cancelled
ceremonies, unavailable targets, misdirected bindings and a directory outage are
rejected before fixture effects. The production session-authorization composition
also passed, including six session/ceremony wallet disagreement rejections.
Candidate-backed TypeScript and focused lint pass. This verifies routing and local
composition; it does not execute Yao cryptography or measure hosted latency.

Direct Yao recovery/export routing, shared identity/recovery/delivery indexes,
Runtime/deferred enforcement, terminal expiry/fresh attempts, remaining cleanup
and hosted acceptance remain open. Release 0.8.0 remains held; no remote changes.

### October 3: recovery routing checkpoint

Recovery code and operation metadata now route nine public recovery endpoints to
the wallet home. Actual custody registration/rotation stores publish code claims
before their local commits. Three-region local composition verifies cross-region
routing, collision races, replay, rotations and publication outages. Full custody
cryptography and recovery ceremonies remain outside this controlled fixture.
SDK build, public/private candidate type checks, focused lint and bloat checks pass.
Directory and resource-challenge E2Es pass; the deployment-binding E2E passes after
updating its candidate alias (5.2s). Receipts and repeat commands are in the matching
results checkpoint. No hosted rollout or latency result; 0.8.0 remains held.

The review also changed recovery operation-publication errors from a generic
preparation conflict to an explicit HTTP 503. An interrupted preparation retains
its normal local reservation timeout. Shared routing metadata can outlive a failed
local commit or retired code; it never grants authorization or restores material.
Remaining: passkey/provider/delivery lookup, direct Yao recovery/export,
internal/deferred home enforcement, terminal/fresh-attempt handling, cleanup and
hosted acceptance.

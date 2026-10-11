# R155 / Wallet 0.9.0 release preparation

Status: **published October 11, 2026, 17:37 UTC.** No environment runs it yet.
Every deployment remains a separate, authorized step.

## Publication record

- CI on [pull request 34](https://github.com/seams-tech/seams-wallet/pull/34)
  passed on `f659b9f6`: the candidate plus one commit that raises the limit of
  the wallet validation and publish jobs from 60 to 90 minutes. The first run
  reached the old limit at contract case 13 of 14 with no failure.
- `main` is at the merge commit `f56d2222`. Its tree equals `f659b9f6`.
- `release-wallet-packages.yml` run `38156978185` published
  `@seams/wallet-server@0.9.0` (1,228 files) and `@seams/wallet@0.9.0`
  (1,994 files) with provenance. Both carry the `latest` tag.
- The private repository pins 0.9.0 since `0ad9143`. Its server packages
  type-check against the published release. Two apps, one type fixture and one
  relayer test still need the adoption work that the private commit lists.

## Why this release is required

The private repository installs `@seams/wallet` and `@seams/wallet-server` at
exactly `0.8.0` from npm, in six manifests. The publish workflow
`release-wallet-packages.yml` runs only on `main`. The candidate is 678 commits
ahead of the 0.8.0 commit `44b1dd07`. The private deployment workflows build from
the installed packages, so no deployment through them contains that work until
both packages are published and the private pins move. Private `dev` already
uses exports that 0.8.0 lacks, so its own type check fails until then.

The release contains the closure of R152, the owner-controlled region move
(R153), the wallet objects, their unique addresses and the registration latency
work (R155 to R155G), R170, and the public API consolidation of R171. The
region-change notifications of R154 are not implemented.

## Candidate

The candidate source is **`2937ee3e`**, the commit that sets both manifests to
`0.9.0` and adds this document. The local validation below ran on that exact
tree. The only later change is the commit that records this revision here.
Review later `dev` changes before including them: the working tree is not the
frozen candidate. The private counterpart of the protocol change is `391043d`.

## Release behavior and upgrade requirements

### Wallets registered on 0.8.0 cannot sign on 0.9.0

This is the gate for every production deployment. It does not block publication.

- A 0.9.0 Gateway requires an execution generation and stored wallet-object
  addresses for every wallet. Both are created only at registration or at a
  relocation import. No backfill exists. A wallet without addresses fails with
  "Wallet object addresses are not initialized".
- Deriver migration `0019_wallet_object_addresses.sql` states: "Existing
  named-address wallets must be discarded before activating this release."
- [R155D](refactor-155D-registration-critical-path.md) limits the discard to
  staging and leaves production outside it "until a separate reset-or-migrate
  decision". The code implements only the discard.

Decide reset or migration for production testnet and mainnet before either
lane deploys 0.9.0. Staging test wallets are disposable.

### One activation set

- Gateway, Runtime, Router, both Derivers and the Signing Worker must run
  matching builds. Router and both Derivers activate together.
- The matching Console build is required: the Gateway calls the Console
  operation `registration-context`, and `wallet-projections` is removed. The
  Console lives in the private repository.
- `ROUTER_AB_PUBLIC_KEYSET_JSON` must drop `signer_peer_verifying_keys` in the
  same activation. The 0.9.0 parser accepts exact keys only, and a 0.8.0 Gateway
  rejects a keyset without the field.
- The Deriver peer-signing variables and Secrets are no longer read
  (`DERIVER_{A,B}_PEER_SIGNING_KEY*`, `DERIVER_{A,B}_PEER_VERIFYING_KEY_HEX`).
  A rollback needs them back.
- Two Durable Object classes are new and need their migration tags applied:
  `RouterAbDeriverBWalletDurableObject` (`r150-deriver-b-wallet-sqlite-v1`) and
  `RouterAbSigningWorkerWalletDurableObject`
  (`r150-signing-worker-wallet-sqlite-v1`).

### Wallet-management protocol 3

The registration responses changed after 0.8.0: setup returns `home`, a
NEAR-only respond returns an admission receipt, and the operation credential
carries `ownershipGeneration` and `home`. The client parsers accept exact keys
only, so a 0.8.0 client and a 0.9.0 server reject each other's messages.

`X-Seams-Wallet-Protocol` exists to turn that mismatch into an instruction, and
it was still `2` on `dev`. An open 0.8.0 client received a parser error. This
preparation sets the version to `3`:

- A 0.8.0 client now receives HTTP 409 `wallet_protocol_mismatch` with the
  reload message, before body parsing.
- The contract's published-client check now names 0.8.0. Before the change the
  published 0.8.0 client reported "Wallet registration setup contains unexpected
  home". After it, the client reports the reload message and the case passes.
- The private Console sends the header in its tenant registration canary. Its
  literal moves to `3` in the same step, in the private repository.
- A hosted comparison that spans this change needs a matching SDK, Gateway and
  Console on each side.

### Migrations

31 migration files are new; no existing file changed.

| Migration | Kind | Note |
| --- | --- | --- |
| Deriver A and B `0019_wallet_object_addresses` | Incompatible | Renames `pair_object_name` to `pair_object_id`; a 0.8.0 Deriver cannot run against it |
| Signer `0062` | Incompatible | Rebuilds `verified_wallet_operation_evidence_sets`; aborts if an evidence row resolves to no single signer scope |
| Signer `0065` | Incompatible | Rejects operation claims without an active execution generation; a 0.8.0 Gateway does not write that column |
| Signer `0051`, `0053`, `0056` | Rebuild | Email OTP challenges, hosted-credential and exchange-code triggers |
| Signer `0064`, `0077` | Additive | `wallet_execution_generations`, `wallet_object_addresses`; neither is backfilled |
| Signer `0049`, `0050`, `0052`, `0054`, `0055`, `0057`–`0061`, `0063`, `0066`–`0076` | Additive | Relocation tables, views and triggers |

Several migrations from `0056` on refuse to run when relocation snapshots or
imports already exist. An upgrade from 0.8.0 has none. Apply the complete signer set before the 0.9.0
Gateway admits requests, and the Deriver migration with the 0.9.0 Derivers.
Staging drivers apply the Deriver rename for each comparison and reverse it
for the 0.8.0 originals; a staging deployment of 0.9.0 keeps it.

### Clients and integrators

- The wallet iframe protocol is `15.0.0`; 0.8.0 shipped `2.0.0`. The client
  and the wallet-host assets must match. 0.8.0 assets fail the handshake.
- Operation credentials without an `ownershipGeneration` require a fresh
  authentication.
- The public API is consolidated. Apply the
  [R171 migration map](refactor-171.md#complete-operation-migration-map):
  `registerPasskey` and `registerWithEmailOtp` fold into `registerWallet`,
  `initWalletIframe` becomes `connection.connect`, `signNEP413Message` becomes
  `signMessage`, the `execute*` calls become `signAndSendTransaction`, and
  `logout` is removed. `@seams/wallet/react` removes the provider's `eager` prop.
- `@seams/wallet-server/cloud-host` removes
  `buildRouterAb{Ecdsa,Ed25519}AcceptedAuthorizedOperationV1` and the Email OTP
  rate-limit counter exports, and adds the placement routes.
  `@seams/wallet-server/local-runtime/local-key-material.mjs` is deleted.
- New public routes: `/wallet/placement/v1` and its relocation routes.

### Client/server cutover is a release gate

Publishing does not update deployed clients. A 0.8.0 client cannot complete
the 15.0.0 handshake with 0.9.0 wallet-host assets, and code already running in
an open tab is not replaced by new HTML. Choose and verify a cutover for each
lane before it releases traffic, as for 0.8.0. No compatibility path is added.

## Validation

Local results on the candidate tree, October 11. CI on the exact pushed
revision remains the gate: `validate-wallet.yml` and
`validate-cloudflare-mpc-router-ab.yml`. The 664 local commits ahead of
`origin/dev` have never run in CI.

| Step | Result |
| --- | --- |
| Bloat check, 36 Cargo lockfiles with `--locked` | Pass |
| `pnpm build`: WASM, five Workers, local tools, both packages | Pass |
| `pnpm type-check`, seven projects | Pass |
| Representative browser, unit and contract sets | Pass; 14 of 14 contract cases |
| Packed-package boundaries, docs build, test app build | Pass |
| Example build | Pass after the repair below |
| `router-ab-core` tests | Pass |
| `router-ab-dev` tests | 106 pass after the test updates below |
| `router-ab-cloudflare` tests, `workers-rs` | 518 pass after the test updates below |
| Five strict Worker entrypoint checks | Pass |
| Published 0.8.0 client against the candidate server | Pass: HTTP 409 with the reload message |
| Private Console server type check against the candidate | Pass, at private `63a0088` plus the header change |
| Full contract suite, 133 cases, release Worker builds | 130 pass; the other three are explained below |

The first local run of these steps found five stale items. Each is classified
`valid_test_needs_update`; no production code changed for them.

- `cloudflare_parity.rs` required that Deriver B declares no SQLite class.
  Deriver B has owned its wallet object class since `2ca912c8`.
- `support/mod.rs` required the text `wallet_scope.ok_or_else`. Commit
  `4261ce02` renamed the parameter to `wallet_route`; the check is unchanged.
- `local_worker_env.rs` listed the Router paths without the two relocation
  paths of R153.
- `normal_signing_worker_boundaries.rs` looked for the lane-material load in the
  ECDSA finalize handler. Commit `f5d35c42` moved the load and the one-use claim
  into `prepare_ecdsa_finalize`, in the same order. The test now reads that
  function.
- The example's transaction and confirmation previews imported three SDK build
  files that the consolidated build no longer emits. Two imports now read the
  SDK source, and one maps to the built `sdk/tx-confirm-ui.js`. All three
  preview pages render without errors.

The three suite cases that did not pass on the first run:

- "terminal burned execution fails without retry" and "a terminal NEAR
  execution remains failed under fresh unlock authority while EVM signs" need
  the debug Router build for an injected failure. Both pass on that build.
- "a linked device revoked with an email code across a refused commit is
  answered from what committed" is intermittent and predates this preparation.
  The wallet has a passkey and an email method, and the menu automation
  sometimes completes the passkey unlock; the test then rejects the result. It
  passed in two of three reruns alone. It is not in the CI representative set.
  Classification: `valid_test_needs_update`, not changed here.

Two private tests that send the protocol header could not run locally: the
private workspace installs 0.8.0 and they import later exports. This is an
`environment_or_infrastructure_failure` until the pins move.

Hosted evidence of October 11, on staging with restoration verified after each
run: the [complete R155F hosts](evidence/refactor-155f-combined-registration-hosted.md)
and the [combined comparison](evidence/refactor-155g-combined-hosted.md), which
registered and independently verified 24 signatures on the 0.9.0 Gateway,
Runtime, Console, Deriver A and SDK sources. Those builds predate protocol `3`.

## Documentation

The manifests, the root README, the SDK README and the example README carry
0.9.0. `THIRD_PARTY_NOTICES.md` is regenerated: it lacked two Cargo records that
the Router lockfile has held since October 5. The 22 public pages under `apps/docs/src` that named 0.8.0 now describe
0.9.0. Three kinds of statement changed beyond the version number:

- The owner-selected region move ships in 0.9.0 (`seams.placement` and the
  wallet region setting). Six pages called it planned or called the home fixed.
- Two pages said the hosted stack runs Rust compute in Containers. The roles
  run Rust compiled to WebAssembly in Workers and Durable Objects. Containers
  ran only the measurement probes of R150 and R152.
- The upgrade section of `deploy-and-operate/hosted-integration.md` now covers
  0.9.0.

The SDK reference has no entry for `seams.placement` yet. The generated file
`packages/wallet-server/artifact-manifest.json` still names 0.8.0 in the
repository. The release build rewrites it from the built Workers, as it did for
0.8.0, so the preparation does not commit locally built hashes.

## Remaining gates

Each step is outward-facing and needs its own authorization.

1. Freeze the candidate and push it. Record the revision in the Candidate
   section.

   ```sh
   git push origin dev
   ```

2. Open the release pull request, as for 0.7.3. It runs `validate-wallet.yml`
   and `validate-cloudflare-mpc-router-ab.yml` on the exact revision. `main` is
   an ancestor of `dev`, so the merge adds no other change.

   ```sh
   gh pr create --base main --head dev --title "Release Wallet packages 0.9.0"
   ```

3. Authorize the publication, merge the pull request, and publish.

   ```sh
   gh workflow run release-wallet-packages.yml --ref main -f version=0.9.0
   ```

4. Verify both packages on npm. In the private repository set the six pins to
   `0.9.0`, refresh the lockfile, and run `pnpm check`, the build,
   `pnpm test:relayer` and the composed suites. The two private tests named
   under Validation run there for the first time against protocol `3`.
5. Staging: apply the migrations, update the keyset variable, deploy the
   activation set and the Console, activate the tenant, and run a canary.
   Staging test wallets are discarded by this step.
6. Production: decide reset or migration for existing wallets, choose the
   client cutover and the window, then deploy per lane. The Hong Kong placement
   of [R155G](refactor-155G-apac-anchor-and-hidden-exchanges.md) is part of
   that window.

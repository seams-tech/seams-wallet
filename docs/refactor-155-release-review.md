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

## 0.11.0

Status: **published October 16, 2026, 05:47 UTC, and deployed to staging.**
Minor release. It
runs the Wallet backend on Cloudflare Workers only and carries the work on
public `dev` since 0.10.2. The wallet-management protocol stays `4`.

- **Workers only.** `codex/refactor-190-workers-backend`, rebased onto `dev`
  as `a0a749fe`, removes the Node Wallet Gateway and VM launcher
  (`b87eb1c4`), the native Router A/B VM hosts (`01c55db4`) and the public
  Express entry `@seams/wallet-server/router/express` (`73386c0b`). The
  removed entry is the reason for a minor version.
- **Registration execution.** `18b09520` runs the Router's registration
  orchestration inside its wallet object and combines Deriver B's input
  preparation with its running claim.
- **Execution before its preparation.** `bc2328c3`: an execution that reaches
  a Deriver wallet object before the setup preparation binds to that
  preparation instead of failing with `ConflictingPair`. `e311a6f6`: the SDK
  waits out a Router claim that respond kept. A temporary hook reproduced the
  race inside both Derivers; without `bc2328c3` the registration fails
  ([record](evidence/refactor-155j-followups-20261015.md)).
- **Delay notice.** When respond or finalize has not answered after 5 s, the
  SDK sends one `onEvent` event for that step (`ae6f9871`, `cc2bb31f`), and
  the hosted menu shows it without the passkey prompt line (`ce5729fb`).
- **Gateway step timing.** `b948567b` reports the steps of setup, of respond
  before the Yao execution, and of Ed25519 signing in `Server-Timing`.
- **Account menu.** Account-menu modals get a host header and a seams footer
  (`339d5934`); the origin row stays fixed (`3c770236`); authentication
  methods and recovery codes become settings cards (`480723ed`, `a877f481`,
  `683cf950`); linked devices open as embedded screens (`38a01fec`); the
  recovery-code dialog is a build module again (`611ae616`).
- **Code-size ratchet.** The rebased branch lowered the duplication
  baseline. `7b1c61f7` removes the three blocks that `dev`'s later work
  repeated: a shared request head for the two Router execute routes, the
  signing stage timer, and the shared authentication method row.
- **Compatibility.** A 0.10 application works with a 0.11.0 backend: the
  registration contract and the protocol did not change. Deploy the Gateway,
  wallet runtime, Router, both Derivers and the Signing Worker together. No
  D1 migration is added. The CLI source is unchanged, so the CLI stays at
  0.10.1.
- **Local validation.** On `7b1c61f7`: the contract suite passes, 134 of 136
  cases on release Workers in three shards and the two debug-only cases on
  the debug Router. Eight cases first failed while three parallel stacks
  started under a load average of 15 to 18: the local tenant-root bootstrap
  reached the Router before it was registered ("Worker
  `router-ab-mpc-router` not found"). All eight pass alone. The CI wallet
  steps pass (bloat and lock checks, build, type checks, 20 representative
  browser and 55 unit cases, packed wallet, docs, example, test app), and so
  do the CI Rust steps (550 core, 18 dev and 519 Cloudflare tests, five
  entrypoint checks). The private check and build pass against the candidate
  after three private changes for the removed Express entry, and all 13
  private deep imports of the SDK resolve.
- **Staging.** Activated at 15:02 JST and the frontends deployed at 15:05 JST;
  private pins in `seams-monorepo` `a5dbf249`. 66 registrations passed: 2,021 ms
  after the passkey step at the median and 2,497 ms at p95. Respond is about
  422 ms slower at the median than in the 0.10.2 acceptance run. Since
  `18b09520` the fresh Router wallet object calls the Derivers and the Signing
  Worker; these calls start new isolates, and the Router waits 270 ms before its
  first Deriver call (88 to 120 ms on 0.10.2)
  ([record](evidence/release-0110-staging-20261016.md)).

## 0.10.2

Status: **published October 14, 2026, 11:37 UTC, and deployed to staging.**
Patch release with no wire, schema or protocol change. It carries the R155H
finalization work on public `dev` since 0.10.1. Codex's R155H close-out handoff, which the user forwarded on
October 14, names this release.

- **Finalization reads.** `8b4dcf5f` reads the Yao admission in the
  finalization read batch. `f6422f37` reads the founding authority and auth
  method records beside the Router consumption, and the commit uses them
  without a second read; `f36b32a1` makes both reservation arguments
  explicit.
- **Session seal warm-up.** `1527b97f` runs one seal operation once per
  Gateway isolate, after its first reply. The first finalization of an
  isolate then finds the seal module ready.
- **Respond after a transient D1 fault.** On 0.10.1, respond returned a
  transient D1 fault as `internal` with the driver's text and HTTP 400; one
  staging registration in 198 failed that way. `ec08890c` runs respond
  again, as it replays exactly. A fault that outlasts two retries answers
  HTTP 503 with `storage_unavailable` and a fixed message. `ddaefdce`
  reconciles a lost write reply after the admission committed: respond
  accepts the stored ceremony only if it equals the intended one exactly
  ([record](evidence/refactor-155h-closeout-checks.md)).
- **SDK.** `7caae2fa`: session observation no longer waits for the
  informational startup parity check. Operations that need that parity
  still check it. `fcbff95f`: the auth menu focus rings follow the corners
  of grouped rows.
- **Compatibility.** A 0.10.0 or 0.10.1 application works with a 0.10.2
  backend. No Rust or WASM file of a Worker changed, so each role Worker
  works with its 0.10.1 peers. The CLI source equals that of the
  published launcher 0.10.1 (`264e70b1`), so the CLI stays at 0.10.1.
- **Local validation.** On `ddaefdce`: the contract suite (132 of 134
  cases on release Workers, the two debug-only cases on the debug Router),
  the seven type checks of `pnpm type-check`, the lock check and the bloat
  check. The private Console server type-checks against the candidate's
  server types, and every private deep import of the SDK resolves in the
  candidate build. Codex's respond recovery, setup, credential reservation
  and authorization transfer scenarios pass on the same commit.
- **Staging comparison before the release.** An A/B/A/B run on `ec08890c`
  took 60 ms from the median finalization and 140 ms from its 90th
  percentile; all 396 signatures verify
  ([record](evidence/refactor-155h-remaining-optimizations-staging.md)).
  `ddaefdce` adds no request, query or wait to a successful registration.
- **Publication.** CI on [pull request 42](https://github.com/seams-tech/seams-wallet/pull/42)
  passed on `3914b864`. `main` is at the merge commit `70f5674f` with the
  same tree. Publish run `38551794394`; npm showed both packages when the
  run ended.
- **Staging.** Activated at 20:54 JST on October 14. The server-side spans
  match the A/B/A/B candidate; all 198 signatures of two runs verify. Most
  requests of those runs entered Cloudflare in Seattle, so their browser
  totals are not comparable; the
  [record](evidence/refactor-155h-release-0102-staging.md) separates them.

## 0.10.1

Status: **published October 14, 2026, 02:13 UTC, and deployed to staging.**
Patch release with no wire, schema or protocol change. It carries one
correction on public `dev` since 0.10.0. The user ordered the release on
October 14.

- **Setup with a provided wallet id.** On 0.10.0, setup answered 500 for a
  provided wallet id that is not in the server-allocated format, where 0.9.4
  answered 200 and left the refusal to respond. Setup builds the Yao
  admission description, and the step that computes the signing key id was
  outside the guard that withholds a failed description. `1ae2df5b` puts
  every step inside one guard. The private Console's activation canary sent
  such an id; it found the defect on staging.
- **Compatibility.** A 0.10.0 application works with a 0.10.1 backend, and
  each role Worker works with its 0.10.0 peers. No Rust file changed.
- **Local validation.** On the candidate: the setup scenario; a setup with a
  provided wallet id answers 500 before the fix and 200 with
  `ed25519.status = after_proof` after it; the server, contract and
  wallet-state type checks.
- **Publication.** Pull request 40, `main` `c2589335`, publish run
  `38496003374`. npm showed both packages 8 minutes after the run ended.
- **Staging.** Activated at 11:54 JST on October 14. The same setup request
  answers 200 with `after_proof` on the hosted lane. All 495 signatures of
  five runs verify. The release has no latency effect of its own; the
  [record](evidence/refactor-155h-release-0101-staging.md) holds the runs
  and a private Console cost that was in every staging figure of October 13
  and 14.
- **Recovery CLI.** Pull request 41 moves the launcher package and the
  `seams-cli` crate from 0.6.0 to 0.10.1, so one number names a release of
  the SDK, the server and the CLI. Launcher 0.10.1 is published on npm and
  is the `latest` version. The user approved a new release-signing root,
  `seams-release-root-production-2026-10`, after the previous private key
  could not be located. Native build run `38512902381` passed for source
  `264e70b1eabdcdf2ec48341c5cc78556ea36e49d` on macOS Apple Silicon,
  macOS Intel, and Linux x86_64. The signed binaries and manifest are in
  [the CLI release](https://github.com/seams-tech/seams-wallet/releases/tag/seams-cli-v0.10.1).
  All five manifest entries verified, and altered binaries and signatures
  were rejected. Three local manifest tests passed. The npm registry tarball
  matched the verified local package byte for byte, including its public
  signing root. `npm exec --yes --package=@seams/wallet-cli@0.10.1 -- seams-wallet version`
  returned `seams-wallet 0.10.1`. Publication used the user's interactive npm
  passkey approval. Wallet custody and recovery-authority keys were unchanged.

## 0.10.0

Status: **published October 13, 2026, 14:26 UTC, and deployed to staging.**
Minor release with a registration wire change and three schema additions. It
carries the work on public `dev` between 0.9.4 and `c84636a5`. The user
decided the version number and the release on October 13. Production does
not run it.

- **Publication.** CI on [pull request 39](https://github.com/seams-tech/seams-wallet/pull/39)
  passed on `c84636a5`. `main` is at the merge commit `96cf6d85` with the
  same tree. `release-wallet-packages.yml` run `38406958758` published both
  packages. The first CI run failed in `router-ab-dev`: its two migration
  lists lacked Deriver migration `0020`; `c84636a5` adds it. The server
  package was on the registry within 15 minutes and the SDK package after
  56 minutes.
- **Local validation before the pull request.** On `7f2afa86`: the contract
  suite (132 of 134 cases on release Workers, the two debug-build cases on
  the debug Router), the bloat check, the lock check, four type checks, the
  setup scenario, 1,151 Rust tests of `router-ab-cloudflare`,
  `router-ab-core` and `ed25519-yao`, 106 tests of `router-ab-dev` with the
  fix, the private server type check and the private console build against
  the candidate.
- **Private adoption.** The private repository pins the server package
  since `c245e0a7` and the SDK package since `c7ec1df3`. Its check and its
  build pass.
- **Staging.** Activated on October 14, 00:50 JST. Registration after the
  passkey step measures 1,747 ms at the median against 2,096 ms on 0.9.4 in
  the hour before, and the first signature 362 ms against 532 ms. The
  [record](evidence/refactor-155h-release-0100-staging.md) holds the
  measurement, the cutover proof and the faults.
- **Open after the release.** Release 0.10.1 corrects a setup failure for a
  provided wallet id that is not in the server-allocated format (500 on
  0.10.0, 200 on 0.9.4). Respond does not retry a transient database fault.
  The staging frontends were deployed on October 14, after this release.

- **Protocol.** The wallet-management protocol is 4. The setup reply of a
  registration has a new field, and the client parsers accept exact keys, so
  a 0.10.0 backend refuses every earlier SDK with HTTP 409, and a 0.10.0 SDK
  needs a 0.10.0 backend. The iframe protocol stays 15.0.0. The last
  protocol change also got a minor version, 0.8.0 to 0.9.0.
- **One request after the passkey step.** Setup mints the Yao identity of a
  NEAR branch and describes the admission of a NEAR-only passkey plan. The
  SDK prepares the custody run during the prompt and sends the proof and the
  execute request together. Respond admits and runs the execution with the
  checks of the execute route. Email OTP, mixed registration and add-signer
  keep both routes. The
  [record](evidence/refactor-155h-one-request-registration.md) holds the
  rules that did not change.
- **Pair preparation during the prompt.** After setup, the Gateway asks the
  Router to admit both Derivers and to connect Deriver A to Deriver B, for a
  passkey plan with a NEAR branch (`699f71f1`, `40afd5e7`). The preparation
  holds no client input and grants no execution authority. Execution binds
  the admission to the encrypted inputs and claims both roles before
  protocol material flows. A missing or expired preparation uses the online
  admission. The
  [record](evidence/refactor-155h-prompt-preparation.md) holds the
  scenarios.
- **Setup rate limit.** 30 setups per minute for one publishable key and
  source address, counted in each regional Gateway database. Exhaustion
  answers 429 and a counter failure 503, both before any reservation or
  custody work.
- **Finalization.** Registration reads and writes no shared capability
  record. The record holds recovery state only. A signing admission takes
  its material from the signer row. The
  [record](evidence/refactor-155h-capability-from-signer-row.md) holds the
  guards and the database calls.
- **Schema.** Gateway migration `0079_tenant_lookup_indexes.sql` adds three
  indexes (`958b67d5`), and `0080_registration_setup_rate_limits.sql` adds
  the counter table. Migration `0020_registration_preparation.sql` adds one
  nullable column to `tenant_root_root_use_admissions` in each Deriver
  database. All three must be applied before the matching versions serve.
  The standard deployment applies them.
- **In-flight registrations.** A ceremony record of a NEAR plan now holds
  the minted identity, and a record without it does not parse. A
  registration that started on 0.9.4 does not continue on 0.10.0.
- **Stored wallets.** No stored wallet record changes. The signer row held
  the active capability before this release too.
- **Also on `dev`.** The local environment plans of `router-ab-dev` use typed
  role origins (`188933a2`). The ML-DSA investigation adds benchmark code
  and three unused input families to the Yao engine crate (`cbe1d732`); no
  production path uses them.
- **Private Console.** Its registration canary sends the protocol number as
  a literal (`packages/wallet-console-server-ts/src/tenantDeployment/provisioning.ts`),
  and `tests/relayer/tenant-home-challenge.e2e.test.ts` sends it too. The
  pin commit changed both to 4. The canary also sent a provided wallet id
  that 0.10.0 refuses at setup; private `ade5e075` changed it to the request
  of a real client.
- **Cutover proof.** The contract suite has no published-client check any
  more (`f736824e`). On staging, the test site built from the published
  0.9.4 package gets HTTP 409 and shows the upgrade message.

## 0.9.4

Status: **published October 13, 2026, 07:07 UTC, and deployed to staging.**
Patch release with no wire, schema or protocol change. It carries the work
on public `dev` between 0.9.3 and `7f03117d`. Production does not run it.

- **Publication.** CI on [pull request 38](https://github.com/seams-tech/seams-wallet/pull/38)
  passed on `7f03117d`. `main` is at the merge commit `79423316` with the
  same tree. `release-wallet-packages.yml` run `38356125919` published both
  packages. One CI job failed once on a test harness fault: a local Router
  got a port number above 65535. No release commit touches that crate, and
  the rerun passed; `188933a2` on `dev` corrects the harness.
- **Private adoption.** The private repository pins 0.9.4 since `3f4fdb45`.
  Its check and its build pass.
- **Staging.** Deployed on October 13, 16:32 JST, with the protected
  activation. The Yao execution is about 60 ms shorter: the Router's execute
  request measures 720 ms at the median against 783 ms, and the garbler's
  CPU 196 ms against 250 ms. Registration after the passkey step measures
  1,876 ms at the median against 1,915 ms on 0.9.3 in the same hour, which
  is inside the difference between two runs. The
  [record](evidence/refactor-155h-release-094-staging.md) holds the
  measurement and the outliers.

- **Custody Workers.** A wire label is wiped with one volatile write, and the
  garbler hashes its four blocks in one cipher pass (`ab91d575`): garbling
  takes half the time and evaluation two thirds, with the same protocol
  bytes. A failed package delivery reaches the Router promptly (`4f360155`).
  Each wallet object logs its host once (`df5b5566`).
- **Gateway.** Registration setup retries a transient database fault and
  answers a server error without the driver's text (`b8de6715`).
- **SDK.** The setup preflight starts when a registration-configured runtime
  starts (`8a7d8f75`, `4ae974a8`). The React entry gains a voice assistant
  card (`21503882`).
- **Compatibility.** No request or response of registration changes. A 0.9.3
  application works with a 0.9.4 backend, and each role Worker works with
  its 0.9.3 peers.
- **Local validation before the pull request.** On the candidate tree: the
  bloat check, the lock check, the type check, the Rust tests of
  `router-ab-core`, `router-ab-cloudflare` and `ed25519-yao`, and the five
  strict Worker entrypoints. The tests of `router-ab-dev` ran in CI only. The
  Yao and registration contracts pass on release Workers with the engine
  change. The private console builds against the candidate module build.

## 0.9.3

Status: **published October 12, 2026, 18:04 UTC, and deployed to staging.**
Patch release with no wire or protocol change and one schema addition. It
carries the latency work of R155G and R155H. Production does not run it.

- **Publication.** CI on [pull request 37](https://github.com/seams-tech/seams-wallet/pull/37)
  passed on `0f031858`. `main` is at the merge commit `e4f883f7` with the
  same tree. `release-wallet-packages.yml` run `38283099821` published
  `@seams/wallet-server@0.9.3` (1,229 files) and `@seams/wallet@0.9.3`
  (1,999 files) with provenance.
- **Private adoption.** The private repository pins 0.9.3 since `5115cd3`.
  Its check and its build pass, and its repository validation passes for the
  first time since the 0.9.0 pins: the console and the site both build.
- **Staging.** Deployed on October 13 with the migrate job first, then the
  protected activation. Registration after the passkey step measures
  1,734 ms at the median against 2,332 ms on 0.9.0. The
  [record](evidence/refactor-155h-release-093-staging.md) holds the
  measurement.

- **Schema.** Gateway migration `0078_registration_passkey_claims.sql` adds one
  table and one trigger. Finalization reads the table in its first batch, so
  the migration must be applied before a 0.9.3 Gateway serves. No existing
  table changes.
- **Gateway.** A NEAR-only respond claims the passkey at the Console in the
  background and records the claim. Finalization skips its own claim when the
  record matches the wallet, the relying party and the credential
  (`e48d200e`). A missing or different record gives the earlier behaviour.
- **Custody Workers.** Deriver A turns the event loop after each table frame,
  so Deriver B evaluates while Deriver A garbles (`6ec1c61d`). Release Workers
  are built with WebAssembly SIMD (`c4080499`) and without debug metadata
  (`3f3800a4`). A Deriver wallet object runs one in-memory ceremony when it
  starts, so its first real ceremony does not pay the first-run cost
  (`f33e071f`). Each ceremony logs its run index in the isolate (`97451f20`).
- **SDK.** The NEAR delegate is prepared during confirmation (`e9c945e2`). The
  session seal module is built for speed (`a4bba328`).
- **Compatibility.** The Yao wire between the Derivers is unchanged, and so
  are the registration requests and responses. A 0.9.2 application works with
  a 0.9.3 backend. A rollback of the Gateway to 0.9.2 leaves the new table
  unused.
- **Local validation before the pull request.** `pnpm report:bloat --check`
  and `pnpm check:cargo-locks` pass. The five strict Worker entrypoints
  compile. The registration reservation scenario, the 14 contract cases and
  the nine composed cases passed with the early claim. The plan
  [refactor-155H.md](./refactor-155H.md) holds the measurements.

## 0.9.2

Status: **published October 12, 2026, 07:25 UTC.** Patch release with no wire,
schema or protocol change. It differs from 0.9.1 by one build entry.

- **Publication.** CI on [pull request 36](https://github.com/seams-tech/seams-wallet/pull/36)
  passed on `0f13410b`. `main` is at the merge commit `34822aa3`.
  `release-wallet-packages.yml` run `38214432394` published both packages.

- **Why it is needed.** The private wallet console also imports
  `attachConfirmSurfaceResizeChoreographer` from the build module of
  `confirm-surface-resize` by path. Only the lazy confirmation bundle uses the
  function inside the SDK, so the module build dropped the export. The private
  application build fails on 0.9.1 with one missing-export error. Release 0.9.0
  hid that error behind the two absent modules. The module is an explicit
  build entry now and keeps every export.
- **Validation.** The private console builds to completion against the
  corrected module build, and fails on the published 0.9.1 with that one error.
  All 13 value imports the console makes by path resolve to an existing export.
  The second private application builds on 0.9.1. The example build and the
  packed-package check pass.
- **Check before a release.** Build the private applications against the
  candidate module build. The public repository has no consumer of these
  imports, so its own checks cannot find a dropped export.

## 0.9.1

Status: **published October 12, 2026, 05:02 UTC.** Patch release with no wire,
schema or protocol change. A 0.9.0 deployment and a 0.9.1 deployment work
together. It does not repair the private application build: see 0.9.2.

- **Publication.** CI on [pull request 35](https://github.com/seams-tech/seams-wallet/pull/35)
  passed on `2a939d7e`. `main` is at the merge commit `31f41eb9` with the same
  tree. `release-wallet-packages.yml` run `38203145428` published
  `@seams/wallet-server@0.9.1` (1,228 files) and `@seams/wallet@0.9.1`
  (1,999 files) with provenance. The private repository stays on 0.9.0.

- **Why it is needed.** The private wallet console renders the SDK's own
  confirmation surfaces and imports their build modules by path. Release 0.9.0
  no longer emitted two of them, `transaction-display/tree` and
  `transaction-display/abi/enrichDisplayModelWithAbi`, because only type imports
  and the lazy confirmation bundle reached them. The private application build
  fails on 0.9.0. Both modules are explicit build entries again, and the
  repository example imports them from the build, so `pnpm build:example`
  guards them.
- **What else it contains.** A warm-session NEAR transaction sends its sign
  prepare while the confirmation dialog is open. The joined tenant-root
  commitment costs two point additions, which lowers the Deriver CPU of one Yao
  execution by 14% in a local profile. The SDK reference documents the wallet
  region calls.
- **Validation.** Full contract suite on the transaction change, 133 of 133
  with the two debug-only cases on the debug Router build; `threshold-prf`,
  `router-ab-core` and `router-ab-cloudflare` Rust tests; type checks, the
  representative sets, the packed-package check and the example build.

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

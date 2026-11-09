# Refactor 231: NEAR custody material across sites and devices

Status: 2026-11-10. Steps 1–3 are done (`037b0cec0`, `042593578`, `9478b970c`) and ship in
0.62, together with wallet-server and the seams-monorepo pins. Steps 4–6 (`Reissue`) are done
for passkey, account sync and VoiceID and ship in 0.63 (D3); see "State after Steps 4–6".
0.61.0 ships the interim commit `096e03ddc`; `156c2f60b` fixes its login outcome and ships in
0.62.

Decisions of the user (2026-11-10):

- **D1. Option B.** No client key material goes to the server. The Router re-issues client
  material for the current epoch when a browser has none.
- **D2. VoiceID alone can request a reissue.** It needs no recent passkey or Email OTP
  unlock.
- **D3. Split the release.** 0.62 ships Steps 1–3. `Reissue` (Steps 4–6) is a protocol
  change across the Router, Derivers, SigningWorker, Gateway and formal model, so it gets its
  own change and review.

### State after Steps 1–3

| Path | Old epoch in cache | No cache |
| --- | --- | --- |
| Passkey login | Re-bind, no Router round | Rejoin (a Router recovery; other sites then re-bind) |
| Account sync | Re-bind | Rejoin |
| VoiceID unlock | Re-bind | Fails: "This site has no wallet keys on this device yet. Unlock with a passkey once to set them up." |
| Email OTP unlock | Re-bind (the Ed25519 unlock persists the row; other paths re-bind in memory) | Fails: "recover with a recovery code" |
| Email OTP export | Re-bind in memory | Fails |

Steps 4–6 remove the two failures in the "No cache" column and the rejoin's epoch change.

### State after Steps 4–6 (2026-11-10, for 0.63)

Commits: protocol and Signing Worker `a9490edd7`, `06a68a442`, Router `5fda7df97`, client crate
`7d3b42d42`, Gateway `1cf0c3977`, Wallet `87d570521`.

| Path | Old epoch in cache | No cache |
| --- | --- | --- |
| Passkey login | Re-bind | Reissue (no epoch change, no new activation) |
| Account sync | Re-bind | Reissue |
| VoiceID unlock | Re-bind | Reissue with the VoiceID Wallet Session (D2) |
| Email OTP unlock | Re-bind | Still fails: "recover with a recovery code" |
| Email OTP export | Re-bind in memory | Still fails |

Decisions made while implementing:

- **The Gateway stores nothing between admit and execute.** Both calls need an unexhausted
  Ed25519 Wallet Session of the wallet and resolve its active material. The admission must
  name that material exactly, with the active capability's lifecycle id. The execute binding
  must equal the binding the active material gives, with any non-zero session id. Security
  rests on the Signing Worker check (Section 3.2, step 3), not on a stored admission: a
  caller with substituted inputs gets no Client package.
- **A reissued row opens with the cache-hit activation facts.** The reissue keeps the material
  activation, so the row carries the server's epoch and verifying share, and the active
  client keeps the capability's activation transcript and capability binding.
- **The Wallet-Session-authorised Recovery admission stays.** Wallets older than 0.63 still
  use it for their cold rejoin.

Open:

- Email OTP. The factor secret stays in the Email OTP worker, and the custody ceremony runs in
  another worker. A reissue there needs a worker-boundary design (`docs/browser-workers.md`).
- Formal model and corpus: a `reissue` constructor in `ActivationOrigin`
  (`ActivationRecipientPartyViews.lean`) and the generator enums, the `reissue_v1` pair-digest
  vector, `proof-obligations.md` and `compliance-baseline.md`.
- A per-wallet rate limit for reissue (none exists for recovery either).
- A linked device's reissue: the Signing Worker check reads the wallet's active state, so a
  linked device with its own material activation gets a refusal.
- The two-context end-to-end test of Step 7.
- seams-monorepo: add `'reissue'` to the staging project policy's `allowed_work_kinds`
  (`deployment/wallet-system/scripts/generate-github-env-values.mjs`).

Note for Step 4: the SigningWorker's read-only check can reuse the existing candidate code. It
opens the run's SigningWorker packages, combines them, checks the verifying share and the key
against the active state, and persists nothing. That is stronger than a check of the
commitments alone.

## 1. Problem

On 2026-11-09, VoiceID unlock of `redwood-monolith-skk7jk` on `staging.wallet.seams.sh`
failed with "Something went wrong." The raw error was "Cached NEAR custody belongs to another
material activation."

| Field | Browser cache | Server (`/wallet/voiceid/verify`) |
| --- | --- | --- |
| `walletId`, `nearEd25519SigningKeyId`, `signingWorkerId` | same | same |
| `stateEpoch` | `1` | `2` |

The server's material activation was `wallet-recovery-ed25519-material-activation-…` with
lifecycle `wallet-session-ed25519-recovery-…`: a cold rejoin from a passkey login.

How a cache gets an old epoch:

1. The Wallet frame's IndexedDB is partitioned per top-level site. Each integrator app has
   its own cache. A second device or cleared site data has the same effect.
2. A passkey login or an account sync that finds no cache runs a cold rejoin
   (`custodyActivation.ts`, `syncAccount.ts`). The rejoin is a Router `Recovery`. It moves
   the SigningWorker to the next state epoch.
3. Every other site's cache keeps the old epoch.

Effect in 0.61.0 (with `096e03ddc`):

| Path | Old epoch in cache | No cache |
| --- | --- | --- |
| Passkey login | Rejoin; one Router recovery; all other caches get an old epoch | Rejoin (same) |
| Account sync | Opens the cache with no epoch check | Rejoin |
| VoiceID unlock | Fails: "Unlock with a passkey once" | Fails: "Unlock with a passkey or Email OTP once" |
| Email OTP unlock | Opens with no epoch check; signing works; export probably fails (inferred) | Fails: "recover with a recovery code" |

## 2. Facts that shape the design

Both reviews (2026-11-10) confirmed these facts in the production code.

- **No admitted operation changes the NEAR shares.**
  - Registration and recovery use the `Base` contributions
    (`crates/router-ab-ed25519-yao/src/lib.rs:216-229`).
  - The server contributions come from the threshold PRF of the tenant-root share over the
    stable key context (`ed25519_yao_lifecycle.rs:1774-1800`). A tenant-root refresh keeps
    the joint root, so the output does not change (`threshold-prf/src/refresh.rs:463-481`).
  - The client contributions come from the seed and the stable context
    (`crates/signer-core/src/ed25519_yao_derivation.rs:466-482`).
  - The production circuit (`phase4_families.rs:486-528`) gives the client
    `x_c = s + tau` and the SigningWorker `x_s = s + 2·tau`. The output coins only split each
    share between Deriver A and Deriver B.
  - Refresh deltas cancel between A and B (`ed25519_yao_derivation.rs:384-425`), and the
    Router refuses `Refresh` (`router_coordinator.rs:1593, 1931`). Lane operations write
    separate lane material that the wallet does not use.
- **So a cache with an old epoch holds the current client share.** Only its labels are old:
  the epoch in the sealed plaintext, in the AEAD binding and in the row.
- **The state epoch is not a signing input** (`crates/router-ab-ed25519-yao-client/src/signing.rs`).
  The activation facts come from the server on each unlock (`openCustodyCache.ts:20-48`).
  Export sends the epoch, and the server compares it (`routerAbEd25519YaoExport.ts:612`).
- **The relation check proves the share.** With the registered key `P` and the SigningWorker
  verifying share `X_s`, only one `X_c` is possible. `verify_public_relation`
  (`local_material.rs:269`) checks it.
- **The cache key does not depend on the epoch.** It comes from the custody seed and the
  application binding digest (`wallet_seed_derivation.rs:154-167`). The AEAD binding holds the
  digest, the registered key, the participant ids and the epoch, but not the verifying share
  (`local_material.rs:353-391`).
- **The server keeps the verifying share.** The persisted capability record holds the
  activation result with its public receipt (`packages/wallet-server/src/core/WalletStore.ts:55-72`).
  `walletRecoveryKeyManifest.ts:671-695` already reads it. The capability descriptor that the
  routes return has no verifying share (`routerAbEd25519YaoRecovery.ts:615-645`).
- **The SigningWorker is the only server-side continuity check today.** If its delivery
  fails, the Router returns no client packages (`router_coordinator.rs:1439-1473`).
- **The server cannot see which factor opened the envelope.** Recovery admission has no
  factor-kind check (`routerAbEd25519YaoRecoveryWalletSessionAuthorization.ts:466-489`).
- **No client material reaches the server** (Decision 2026-08-09,
  `packages/shared-ts/src/passkey-custody/ceremonyCommitPayload.ts:204`). This plan keeps it.

## 3. Design

### 3.1 Re-bind a cache with an old epoch (no Router round)

If the cache epoch is lower than the server epoch:

1. Open the envelope with the factor, derive the cache key, and open the share with its own
   (old) binding.
2. Check the relation with the server's **current** verifying share and registered key.
   Require the same registered key, participant ids and application binding digest.
3. Seal the share again under the new epoch with a fresh nonce. Write the row with the new
   epoch and the server's verifying share.

The re-bind moves forward only. If the cache epoch is higher than the server epoch, or the
relation check fails, the resolver treats the cache as absent (Section 3.3). A false epoch or
verifying share from the server can stop signing, but it cannot reveal a secret.

### 3.2 Reissue client material for the current epoch (Router, option B)

A new operation, `Reissue`, gives a browser with no usable cache the client share of the
**current** epoch. ("Redelivery" already names a different thing in the formal model,
`ActivationDelivery.lean:89-93`.)

1. Admission needs an Ed25519 Wallet Session for the wallet (any factor, D2).
2. The Derivers run the production activation circuit with the `Base` contributions, the
   client's seed-derived inputs and fresh coins. They emit the two client packages and the
   public commitments. They emit no SigningWorker packages.
3. The Router sends the run's commitments to the SigningWorker for a **read-only check**:
   the state is Active; the joined SigningWorker commitment of this run equals the stored
   verifying share; `P = 2·ΣX_c − ΣX_s`; the registered key and stable identity are the same.
   The SigningWorker persists nothing and returns a public receipt for the current epoch `E`.
4. Only after the check does the Router release the client packages and the receipt.
5. The client completes with `Preserve(registered key)`, checks the relation, and seals at
   epoch `E`.

`Reissue` has its own operation tag, transcript domain and expensive-work budget. A reissue
result cannot pass as a recovery, registration or export.

Why the check in step 3 matters: without it, a caller with a Wallet Session and substituted
client inputs would get client packages that no server party checked. With it, a reissue
gives exactly what a `Recovery` gives today, without the epoch change.

### 3.3 One resolver for all unlock paths

`resolveWalletCustodyEd25519Material` returns `current`, `rebound`, `reissued` or
`unavailable` (with a reason that the menu can show). Each path that loads the cache uses
it:

| Path | Where it runs |
| --- | --- |
| Passkey login (`custodyActivation.ts`) | Iframe main thread |
| Account sync (`syncAccount.ts`, now `openOrRejoinWalletCustodyEd25519V1`) | Iframe main thread |
| VoiceID unlock (`prepareNearSession.ts`) | Iframe main thread |
| Email OTP restore (`custodyRestore.ts:657-677`) and export (`ed25519YaoExport.ts:310`) | `emailOtp` worker |

The worker returns a rewritten row through the existing `walletCustodyEd25519Material` field
(`unlock.ts:942`, `recovery.ts:315`). The main thread already persists that field
(`BrowserSigningSurface.ts:5083-5085, 6797-6799`).

`Recovery` stays for wallet recovery with recovery codes.

## 4. Options not chosen

- **A: the server keeps the sealed client share.** The user rejected it (D1). It reverses
  Decision 2026-08-09.
- **Each site as a linked device.** Device linking already sends client material to a new
  recipient while it keeps the source (`activation.rs:222-262`). But a site partition with
  the same passkey is the same authority, not a new device. Each site would add a device, a
  SigningWorker state and a revocation item.
- **Derivers keep their client package halves.** Each Deriver would keep a long-lived half of
  the client share. Today each half exists only during one run.
- **Let Email OTP and VoiceID run the existing `Recovery`.** No protocol change, but each new
  site still moves the epoch for all other sites.

## 5. Steps

Put new code in new files. `BrowserSigningSurface.ts`, `routerAbEd25519YaoRecovery.ts` and
`router_coordinator.rs` are already over 2,000 lines.

### Step 1. The capability carries the SigningWorker verifying share

- Add `signingWorkerVerifyingShare` to the descriptor. The server reads it from
  `activationResult.public_receipt` of the persisted record. It needs no SigningWorker call.
- The descriptor is built in one place (`routerAbEd25519YaoRecovery.ts:1938`), so every route
  that returns it changes: passkey unlock, warm bootstrap (`sessions.ts:1425`), sync bootstrap
  (`syncAccountBootstrap.ts:239`), Email OTP unlock, VoiceID verify and export.
- Linked devices: `resolveWarmBootstrapCapabilityForAuthority`
  (`routerAbEd25519YaoRecovery.ts:1024-1091`) must take the linked material's own verifying
  share, not the source device's share.
- Client types: `ParsedYaoRecoveryCapabilityV1`, `workerTypes.ts:133`; the parsers
  `parseEd25519YaoRecoveryCapabilityV1` and the Email OTP parser
  (`materialParsing.ts:700-716`, exact keys); the builders `registration.ts:576` and
  `ed25519ExportContext.ts:283, 457, 645`; the fixtures in `tests/unit/helpers/`.
- Compatibility: an older Wallet's Email OTP parser refuses the new field. A newer Wallet
  needs the field. The Wallet, wallet-server and the monorepo pins (site, wallet-console,
  intended-app) must ship together in 0.62. Say so in the release notes.

### Step 2. Re-bind in the client crate and wasm

- `rebind_wallet_custody_ed25519_material_v1` in a new module beside
  `crates/router-ab-ed25519-yao-client/src/local_material.rs`: open the envelope, derive the
  cache key, import with the old binding, check the relation with the server's verifying
  share, refuse `new_epoch <= old_epoch`, seal with a fresh nonce under the new binding.
- Export it through the Yao client wasm and `RouterAbEd25519YaoClientV1` (`yaoClient.ts`).
  The `emailOtp` worker loads the same wasm.
- Update the comment in `ed25519SeedMaterial.ts:35-40` (only the ceremony seals) and
  `docs/browser-workers.md:44-49, 99` (a new seal on the main thread and in the worker).
- Rust tests: forward only; relation mismatch; other verifying share; other registered key;
  the re-bound share equals the old share.

### Step 3. The resolver in every path

- Add the resolver in a new file beside `openCustodyCache.ts`, for the main thread and the
  worker. Replace `openOrRejoinWalletCustodyEd25519V1`. Until Step 6, the outcome
  `absent` still leads passkey login and account sync to the cold rejoin.
- Passkey login: replace the epoch condition of `096e03ddc`.
- VoiceID: replace the stale-epoch error in `prepareNearSession.ts`; keep the wallet, key and
  signing-worker checks. Add `persistWalletCustodyEd25519Material` to the `Pick` in
  `installSession.ts:16-28`.
- Email OTP: run the resolver in the worker restore and export paths.
- `NEAR_CUSTODY_STALE_MESSAGE`: change the sentence for `unavailable`; update
  `domain.ts`, `tests/wallet-ui/auth-menu.failure-status.test.ts` and
  `tests/unit/authMethodNearSession.staleCache.unit.test.ts` (the first test expects a
  re-bind).
- Staging check: VoiceID unlock of `redwood-monolith-skk7jk` re-binds epoch 1 to epoch 2 with
  no Router call.

### Step 4. `Reissue` in the protocol, Derivers, Router and SigningWorker

- Operation: `Ed25519YaoOperationV1::Reissue` with `circuit_family` and `work_kind` in
  `crates/router-ab-core/src/protocol/ed25519_yao.rs:47`, an `ExpensiveWorkKindV1`
  (`gate.rs:17`), the tag in `crates/router-ab-ed25519-yao-protocol/src/lib.rs:60`, and a
  `matches_operation` arm for `Base` (`crates/router-ab-ed25519-yao/src/lib.rs:216-229`).
- Derivers: build only client packages and commitments for `Reissue`.
- SigningWorker: a read-only reissue check in a new file under
  `durable_object/signing_worker_wallet/` (Section 3.2, step 3).
- Router coordinator: a new module for the `Reissue` branch; release client packages only
  after the check.
- Client: `prepare_client_reissue_with_root_v1` and its completion
  (`crates/router-ab-ed25519-yao-client/src/lib.rs`).
- Regenerate `packages/shared-ts/src/utils/generated/routerAbEd25519YaoCore.ts` with
  `export_typescript_bindings`. Update the wire vectors
  (`crates/router-ab-core/fixtures/protocol/r102/ed25519-wire-vectors-v1.json`) and
  `pnpm -C crates/router-ab-cloudflare test:wasm-vectors`.
- Formal model: the closed enums `RequestKind` (`PartyViews.lean:14`) and `ActivationOrigin`
  (`ActivationRecipientPartyViews.lean:11`), the "five request families" corpus,
  `proof-obligations.md` and `compliance-baseline.md`.
- `docs/router-ab/ed25519-yao.md`: the operation list, "Fixed Circuit Families" and "Root
  and Key-Continuity Policy".

#### Implementation map for Steps 4–6 (2026-11-10)

A read-only survey of the Recovery path. Line numbers are from `0c613bf30`.

- **Shape.** Recovery has three calls: admit, execute, activate. In execute, the SigningWorker
  stages a candidate before the Router releases the client packages
  (`finalize_router_result_v1`, `router_coordinator.rs:1407-1641`). Reissue needs only admit
  and execute. The Gateway export domain (`ed25519Yao/export/`) is the nearest template.
- **Client.** `rejoinWalletCustodyNearEd25519KeySet` (`BrowserSigningSurface.ts:2863`) and
  `walletRecoveryEd25519.ts:62-287` build, admit, execute and activate. A reissue keeps the
  active material activation, needs no replacement capability binding, and checks the execute
  result against the descriptor's `signingWorkerVerifyingShare` and `stateEpoch`. The custody
  ceremony picks recovery or registration by `continuity.is_some()`
  (`wasm/wallet_custody_ceremony/src/ceremony.rs:672-690`); it must pick by operation.
- **Gateway.** `routerAbEd25519YaoRecoveryRequestScopedCloudflare.ts` runs admit/execute/
  activate. `prepareAdmitRecovery` (`routerAbEd25519YaoRecovery.ts:2132-2288`) suspends the
  capability; a reissue must not. The execute continuation authorizes without a bearer as
  `wallet_recovery` (`routerAbEd25519YaoRecoveryWalletSessionAuthorization.ts:591-598`); a
  reissue must require the bearer. There is no per-wallet rate limit for recovery today. The
  Router policy (`lib.rs:1455-1560`, `allowed_work_kinds`) must list `reissue`.
- **Derivers.** Base contributions come from the stable context only. Add `Reissue` to
  `matches_operation` (`router-ab-ed25519-yao/src/lib.rs:219-230`) and
  `operation_matches_kind` (`crypto.rs:575-588`). Recipients are decided only in
  `execution.rs` (23-41, 67-95, 267-316).
- **SigningWorker.** `deliver_recovery` (`signing_worker_wallet.rs:1066-1107`) combines the
  packages (`activation.rs:275-359`, `build_candidate`) and stores `RecoveryStaged`. The only
  read-only command today is `LookupRegistration` (1275-1296). A reissue check is a new DO
  command beside it. It opens the SigningWorker packages, checks the verifying share and key
  against the `Active` state in constant time, keeps the epoch, and persists nothing.
- **Exhaustive matches** the compiler finds: `router-ab-core` (`ed25519_yao.rs`, `gate.rs`,
  `ed25519_yao_router.rs`, `vectors.rs`), the protocol tag (`lib.rs:59-67`) and
  `router_coordinator.rs` (1423, 1482-1498, 1621-1640, 1922-1939, 2093-2102). Silent guards
  (`matches!`, `_`) are listed in the survey: `activation.rs`, `execution.rs`, `crypto.rs`,
  `ed25519_yao_signing_worker.rs`, `signing_worker_wallet.rs:725`, the client crate and
  `circuit_tests.rs`. `router-ab-cloudflare` compiles with a new variant because its catch-all
  arms refuse it.
- **Map `Reissue` to `RequestKind::Recovery`.** `RequestKind` is only a lifecycle label and does
  not enter the Ed25519 contribution derivation, so the formal model's `RequestKind` needs no
  new kind. `ActivationOrigin` (`ActivationRecipientPartyViews.lean:11-15`) and the generator
  enums still do.
- **Vectors and bindings.** Add a `reissue_v1` pair-digest case (`vectors.rs:246-272`,
  `fixtures/protocol/ed25519-yao/pair-digest-vectors-v1.json`). Regenerate the TS with
  `UPDATE_ROUTER_AB_ED25519_YAO_TYPES=1 cargo test --manifest-path crates/router-ab-core/Cargo.toml --features typescript-bindings --test export_typescript_bindings`.
  ECDSA shares `ExpensiveWorkKindV1` and its generated union.
- **Open questions.** Refuse a reissue while a recovery has the capability suspended or when it
  is retired? Which row does a linked device's reissue check (`linked_ed25519.rs`)? Keep the
  SigningWorker recipient in the client's sealed inputs, or add a reissue recipient type? The
  binding must carry the active `root_share_epoch` after a tenant-root refresh.

### Step 5. Gateway route and authorization

- Admission and execute routes with a Wallet Session bearer, beside the recovery routes.
- Admit any Ed25519 Wallet Session of the wallet (D2). Refuse exhausted sessions. Rate-limit
  per wallet.

### Step 6. Use reissue when there is no cache

- The resolver calls reissue when the cache is absent, newer than the server, or fails the
  relation check.
- Passkey login and account sync stop the cold rejoin. Delete
  `rejoinWalletCustodyNearEd25519KeySet` (callers: `custodyActivation.ts:204`,
  `syncAccount.ts:776`), `buildWalletSessionEd25519RecoveryAdmissionRequestV1`
  (`BrowserSigningSurface.ts:2878`) and the `recovered` branch of the login. Keep
  `readActivePasskeyAuthorityForRecovery` (`passkeyExchange.ts:466`).
- Decide the server's Wallet-Session-authorised Recovery admission
  (`routerAbEd25519YaoRecoveryWalletSessionAuthorization.ts`): after this step only older
  Wallets use it. The lockstep release lets us delete it.
- Email OTP: a new site no longer needs a recovery code.

### Step 7. Tests and docs

- Rewrite `tests/e2e/intended-behaviours/passkey-custody-cache.ts:122-131` ("cold custody
  recovery preserves authority"): it expects `/recovery/activate` and a new activation id.
- A new intended-behaviour test with two browser contexts (two storage partitions):
  1. Register and unlock with a passkey in context A.
  2. Unlock in context B: a reissue; the server epoch does not change.
  3. Run a recovery from context B: the epoch moves.
  4. Unlock with VoiceID and with Email OTP in context A: re-bind; then sign a NEAR
     transaction and run an export.
- Rust: `crates/router-ab-ed25519-yao-client/tests/registration.rs`, coordinator tests for
  the check-before-release rule, SigningWorker tests for the read-only check.
- Docs: `docs/intended-behaviours.md:495` ("Missing custody requires another owner unlock"),
  the 0.62 release notes in `apps/docs/src/releases.md` and `apps/docs/src/ja/releases.md`
  (replace the 0.61 sentence, state the lockstep release).
- seams-monorepo: move the pins to 0.62 and deploy with wallet-server.

## 6. Security review items

- **Re-bind:** no new secret, no new party. It changes only the epoch label and the row's
  verifying share, and it checks the relation against the server's values before it seals.
- **Reissue:** each run makes new random Deriver halves of the same share. Nothing new is
  stored. The SigningWorker check (Section 3.2, step 3) keeps the guarantee that today's
  `Recovery` gives against substituted client inputs. The review must confirm that a client
  package is never released before that check.
- **Authorization:** the server cannot know which factor opened the envelope, so the rule is
  "any Ed25519 Wallet Session of the wallet", as for `Recovery` today. Rate limits apply.
- **Domain separation:** `Reissue` packages and receipts cannot pass as `Recovery`,
  `Registration` or `Export`.
- **A+B collusion** stays outside the threat model (`docs/router-ab/ed25519-yao.md:313`).

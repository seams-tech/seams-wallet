# Cleanup 1: dead, duplicated and boilerplate code

**Status:** Phases 0 to 2 are complete, apart from moving finished plans, which
waits for a decision; the threshold routes moved to Phase 4. The Phase 3 pilot
has landed, and rolling it out further waits for a decision. Phase 4 waits for
R150 to land on `dev`. CI runs `pnpm report:bloat --check`, which fails when a
ratcheted measure grows past `scripts/bloat-baseline.json`, now recorded at
`efe17f1`. Since the first baseline (`7c8a163`), TypeScript code is down 25,252
lines and Rust code 4,831. The findings below are the first baseline's; run
`pnpm report:bloat` for current numbers.

This plan reduces the code that has to be read, reviewed and kept consistent,
without changing behavior. The repository holds about 540k lines of TypeScript
code and 433k lines of Rust. It was imported on 2026-09-12 with 1.02M source
lines and has grown by a net 95k lines since, about 10k lines a day in the week
to 2026-09-28. Dead code is a small part of the excess. Most of it is the same
thing written more than once: wire fields declared three times, helpers copied
between files, contracts defined on both sides of a package boundary, and large
files that repeat themselves.

## Current completion checklist

### Done

- [x] Measure bloat and record a baseline: `scripts/bloat-report.mjs`,
  `pnpm report:bloat` and `scripts/bloat-baseline.json` (164406d).
- [x] Name the shared auth-method and authority variants once. 145 inline
  `Extract<...>` sites use the named variants, three duplicate exported aliases
  are gone, and `Variant<U, K, V>` rejects discriminant values the union does not
  have (836cca3).
- [x] Name each registration response's success beside the response and use it
  at the 30 sites that narrowed `{ ok: true }` (7d74e01).
- [x] Phase 0: a CI ratchet, unused-code compiler checks and agent rules.
- [x] Delete every export nothing named: 687 exports and 25 emptied modules,
  14,258 lines (5aa72f4, 87baab3, 9f0ee44).
- [x] Phase 1, except finished plans: test-only and local-only exports, class
  members nothing calls, and dead-code suppressions and refactor citations
  outside R150's crates.
- [x] Phase 2: validation helpers, WebAuthn stores, `NearClient` and key-material
  brands, registration types, the NEAR signature-only flows, registration
  timing, wallet-recovery finalization, and the Rust role-command encodings and
  activation tests.
- [x] Phase 3 pilot: `rotationParsers.ts` converted, measured and landed
  (efe17f1).

### Remaining

- [ ] Phase 1: move finished refactor plans, once decided.
- [ ] Phase 3: decide whether to roll the combinators out further.
- [ ] Phase 4: restructure R150's largest files after R150 lands on `dev`.

## Findings

Baseline from `pnpm report:bloat` at `7c8a163`:

| Measure | Baseline | Where it concentrates |
| --- | --- | --- |
| Hand-written validation (`parse*`, `require*`, `assert*`, `is*`, ...) | 4,276 functions, 86,063 lines: 28.8% of top-level function lines | Each wire field is written in the type, in the exact-key list and in the parsed object |
| Local copies of basic validation helpers | 115 in 88 files | `requireRecord` 32, `requireNonEmptyString` 16, `isObject` 16 although `@shared/utils/validation` exports one |
| Exact duplicates of 10 meaningful lines | TypeScript 5.1% (21,753 lines), Rust 5.7% (19,427 lines) | The clusters in Phases 2 and 4 |
| Names exported from more than one file | 198 | Registration contracts in server and client (27), `keyMaterialBrands` (21), `NearClient` (7) |
| Files over 2,000 lines | 82 files, 362,562 lines | `router-ab-cloudflare`: `tenant_root_role_d1.rs` 22,478, `durable_object/tenant_root_creation.rs` 21,297, `lib.rs` 16,489 |
| Exports nothing else names | 464, 6,450 lines | |
| Exports only tests name | 272, 3,285 lines | |
| Exports used only in their own file | 2,272 | They hide dead code from the compiler |
| `?: never` padding | 2,684 lines | |
| Rust `allow(dead_code)` | 125 | 48 in `tenant_root_creation.rs` |
| Refactor plan docs | 32 docs, 13,291 lines | |
| Code comments citing refactor or phase numbers | 281 | |

`tsc --noUnusedLocals --noUnusedParameters` over the `packages/wallet` program,
which includes `wallet-server` and `shared-ts`, also reports about 200 unused
imports, locals and parameters.

The report is conservative. An export counts as used when any other tracked file
names it, so a name shared by unrelated code hides dead code. Only exact
duplicates count, not renamed copies; a "run" below is one repeated window of 10
meaningful lines. Validation code is classified by function name. Exports
reachable from a package's public entry points are reported separately (367)
and are not counted as dead.

## Goal

Stop these measures from growing, then reduce them, while wire formats, storage
formats, public APIs and behavior stay unchanged.

## Non-goals

- Changing what any parser accepts or rejects.
- Removing public exports without a separate deprecation decision.
- Reformatting code a change does not otherwise touch. Several large files
  differ from Prettier's output; format only the changed hunks.
- Splitting files for their own sake. A split must remove duplication or reduce
  conflicts between concurrent changes.
- Restructuring R150's most-changed files while R150 is in progress.

## Rules for every phase

- Run `pnpm report:bloat` before and after each change and record the deltas in
  the progress log below.
- Put one kind of change in each commit: removal, consolidation or
  restructuring. Other agents work in the same checkout: stage and commit only
  your own paths, and leave files with someone else's uncommitted changes alone.
- Delete the replaced code in the same change. Add no compatibility shims, flags
  or second paths.
- For type-only changes, prove each replacement is identical to what it replaces
  with an `Equal<A, B>` check, as the `Variant` pass did.
- For parser changes, run the old and new parser over the same fixtures and
  mutated inputs and require the same accept/reject result before deleting the
  old parser.
- Update the baseline with `pnpm report:bloat --write-baseline` only in a commit
  that lands a reduction, so the baseline never absorbs growth.

## Phases

### 0. Stop the growth

**Scope:** measurement, compiler settings and agent rules; no code removal.

- [x] Add the report and its baseline (164406d).
- [x] Add `--check` to the report (0af6f39). It fails when dead exports, files
  over 2,000 lines, local copies of the basic validation helpers, refactor
  citations, Rust `allow(dead_code)` or duplicated lines grow; the other measures
  grow with feature work and are only reported. Duplicated lines are ratcheted
  rather than the percentage, which rises whenever other code is deleted.
  `validate-wallet.yml` runs it after `pnpm install`.
- [x] Add `--rev <commit>` so a baseline measures a commit, not a working tree
  that other agents are editing, and leave generated modules out of dead
  exports (acc9f9f).
- [x] Enable `noUnusedLocals` and `noUnusedParameters` for `packages/wallet`
  and `packages/wallet-server`; `shared-ts` and the test projects inherit them.
  Fixing the reports deleted about 2,200 lines (5f5e527).
- [x] Add rules to `AGENTS.md`: run the check before committing; use the shared
  validation helpers instead of local copies; name a union's variants beside it
  with `Variant`; delete the replaced path in the same change; export only what
  another file uses; do not cite refactor or phase numbers in code comments; do
  not grow a file past 2,000 lines (d1b55b9). The rule for finished plans waits
  for the open decision below.

**Exit:** CI fails when a ratcheted measure grows, and the compiler reports no
unused locals or parameters.

### 1. Remove dead code

**Scope:** deletions that the compiler and the report verify; no behavior
change.

- [x] Delete the 464 exports nothing else names (6,450 lines), one package per
  commit. Removals exposed more in six rounds: 687 exports and 25 modules left
  without code, 14,258 lines (5aa72f4 wallet, 87baab3 wallet-server, 9f0ee44
  shared-ts). The pass mistook three published entries for dead code, because
  Rolldown publishes them under other names (`router/express.js` is built from
  `express-adaptor.ts`): b74937c restored `createRouterApiRouter`, the Vite
  plugin factories and one base64 export, and the report now treats every
  Rolldown input as an entry point.
- [x] Review the 272 exports only tests name (3,285 lines). Delete an export and
  its tests when the tests exercise nothing else, as the `Drop ...` commits of
  2026-09-29 did; keep deliberate test seams and say why. b7f4105 deleted 52
  exports that only `*.typecheck.ts` fixtures reached, with the checks that
  tested them (2,414 lines). Its message says 44, leaving out 8 that those
  deletions left unused. df764e0 deleted 10 more that were then reachable only by
  their own checks. 0ba6c71 and 9cbe238 then un-exported or deleted the names
  those deletions left used only in their own file. The 209 left stay:
  - 182 are test seams: their own module also uses them.
  - 19 build values that fixtures need to check live types, such as
    `allocateWalletAuthMethodId` in the registration-intent fixtures.
  - 8 are named by tests under `tests/`. Six build inputs for, or read state
    from, live code: the presignature pool's pool-hit signer and depth, the ECDSA
    context binding, the end-to-end harness's session-status parser, the EVM key
    identity builder and the signing-only delegated authority. The other two,
    `parseMpcReauthorizationPolicyRef` and `parseMpcRegisteredPublicKeyBindingRef`,
    complete the domain-ID parser family that `domainIds.boundary.unit.test.ts`
    checks as a set.
- [x] Remove `export` from the 2,272 exports used only in their own file, then
  delete what `noUnusedLocals` reports: 2,080 exports, and
  `walletAuthPolicyError.ts`, which nothing used (d79f236 shared-ts, e4ed6a8
  wallet-server, 554a09d wallet).
- [x] Replace each Rust `#[allow(dead_code)]` with
  `#[expect(dead_code, reason = "...")]`, or delete the code the compiler then
  reports. Outside R150's crates this is done (710060d): with the attributes
  removed and every feature and target checked, `router-ab-ecdsa-presign`'s 12
  hid nothing, and `wasm/evm_crypto` and `wasm/tempo_signer` each carried the
  same five dead codec helpers. The rest are legitimate and stay `allow`,
  because `expect` would fail in the builds where the item is used:
  `ed25519-yao`'s file-wide allows cover code that only feature-gated modules
  and unit tests use, `signer-core`'s fixture is shared by two test binaries
  that each use part of it, `near_signer`'s WebAuthn structs are constructed by
  serde, and test-support modules are shared by several test files.
  `router-ab-cloudflare`'s 51, 48 of them in
  `durable_object/tenant_root_creation.rs`, and `router-ab-dev`'s 2 wait for
  Phase 4.
- [x] Remove the comments that cite refactor numbers, keeping any explanation
  they carry. The measure counts only `Refactor N` and `R###` citations; "Phase
  N" alone is often a protocol term, since the Yao circuits have phases. No
  TypeScript comment under `packages/` or `tests/` cites one any more (63a82e6,
  e406924), and no Rust comment outside R150's crates (6f5b240, f5ded18), which
  also put three drifted doc comments back on their items. The 27 left are in
  `router-ab-cloudflare` and `router-ab-dev` and wait for Phase 4.
- [x] Delete public class members that nothing calls. Neither `noUnusedLocals`
  nor the dead-export pass reaches them. A language-service scan found 421
  unreferenced members. 7f49898 and cbcfceb deleted 18 of them, each meeting
  every one of these checks:
  - no reference anywhere;
  - the name appears nowhere else in any tracked file, including tests, Rust
    and config;
  - no published declaration reaches the class;
  - no runtime calls the member by name, as Durable Objects, custom elements
    and React do.

  Two of those members were the only way to reach the in-memory and Durable
  Object registration ceremony stores and the registration-prepare rate
  limiter, so those went too: 3,189 lines in all. Of the rest, 35 members sit on
  classes that public entry points return, such as the D1 stores and
  `AuthService`, and wait for the public API decision in Phase 4. The others
  have a name that appears elsewhere, which this check cannot tell apart from a
  use.
- [ ] Move finished refactor plans (32 docs, 13,291 lines) out of `docs/`; plans
  still in progress stay. This waits for the open decision below.

**Exit:** no export is named nowhere else, every remaining dead-code
suppression either hides nothing the compiler can find in any build or waits
for Phase 4, and every test-only export has been reviewed.

### 2. Consolidate duplicated code

**Scope:** one cluster per commit, outside R150's most-changed files. Compare
every copy first; copies that differ on purpose keep separate names.

Each landed cluster was proven unchanged by running the old and new code side
by side; the commit messages describe each harness.

- [x] Add `requireRecord`, `exactRecord`, `requireString`,
  `requireNonEmptyString` and `asRecord` to
  `packages/shared-ts/src/utils/validation.ts` and replace the 115 local copies in
  88 files. Where a copy's error text or exact-key rule differs, keep that
  behavior under its own name. 3778536 replaced 73 copies. Helpers that
  stringify their input are now `coerceNonEmptyString` and
  `coerceNonNullishString`, and `requireNonEmptyString` accepts only strings. The
  39 copies left in 29 files each have their own message or rule.
- [x] Give `WebAuthnLoginChallengeStore`, `WebAuthnSyncChallengeStore`,
  `WebAuthnAuthenticatorStore` and `WebAuthnCredentialBindingStore`
  (`packages/wallet-server/src/core/`) one shared store implementation. The first
  two share 120 runs. 996423f: `webAuthnStoreBackends.ts` holds the backends,
  and the four files shrink from 2,980 to 1,691 lines.
- [x] Move `NearClient` (91 runs, 7 same-named exports) and `keyMaterialBrands`
  (21 same-named exports) from `packages/wallet` and `packages/wallet-server` into
  `packages/shared-ts` (b6e1cee). Each package keeps only what differs: its
  `NearRpcError`, the wallet's throttling and retries, the server's failure
  classification, and `parseEcdsaThresholdKeyId`, whose messages differ. The
  server's unused `getAccessKeys` now sends a request like the wallet's.
- [x] Define once in `packages/shared-ts` the 27 types that both
  `packages/wallet-server/src/core/registrationContracts.ts` and
  `packages/wallet/src/core/rpcClients/relayer/walletRegistration.ts` declare.
  Some copies differ on purpose (the client's `WalletRegistrationFinalizeResponse`
  has no failure member); rename those instead of merging them. b6e1cee moved the
  6 identical ones. The other 21 differ and keep their names, because no file
  imports both modules; two of them look like drift (see Open decisions).
- [x] Merge the shared steps of `signNep413.ts` and `signDelegate.ts` (dbe4e9a):
  `shared/signatureOnlySigning.ts` holds them, and the two files shrink from 765
  and 603 lines to 396 and 244.
- [x] Rust: the tenant-root creation and refresh role commands share one field
  wire (7fc5eda), and the Yao generator's promotion digests and admission
  fixtures share their identical encodings. The committed vectors and goldens
  pass, and probes over 3,290 cases matched byte for byte.
- [x] Remove `registrationTiming.ts`'s internal repetition (184 runs): it writes
  its 130 timing buckets out four times. 43112f4 lists the 125 buckets once, in
  emitted order, and derives the types, zeroing and copying from that list. The
  file shrinks from 1,665 to 1,058 lines, and 150 scenarios emit byte-identical
  JSON.
- [x] Merge the shared code of `d1WalletRecoveryGoogleEmailOtpService.ts`,
  `walletRecoveryFinalization.ts` and `d1WalletCustodyCommitStore.ts` (76, 44 and
  33 runs between the pairs). 0639436 moved the storage-independent pieces into
  the domain module (−459 lines), and the repeats between the three go to zero.
  A harness over a SQLite-backed D1 with every migration recorded
  byte-identical transcripts across 245 scenarios.
- [x] In Rust: `router-ab-core`'s activation evidence and receipt tests (111
  runs), and `crates/router-ab-ed25519-yao-client/tests/registration.rs` against
  `wasm/wallet_custody_ceremony/src/circuit_tests.rs` (139 runs), which live in
  different crates. 9e72d4c gives the activation tests one fixture module,
  whose signers use each file's original keys, and every test count is
  unchanged. The second pair stays: its files are in separate workspaces.
  Sharing their relay harness would need a new crate, a public API in an R150
  crate, or a `#[path]` include across workspaces.
- Moved to Phase 4: the shared halves of `thresholdEcdsa.ts` and
  `thresholdEd25519.ts` (89 runs). R150's Gateway and presignature work changes
  both: 14 feature commits in 30 days, the latest on 2026-09-27.

**Exit:** each listed cluster has one implementation, and both languages'
duplication is below the baseline.

### 3. Pilot one declaration per wire field

**Scope:** one module. Its parser must accept and reject exactly what it does
today.

Validation is the largest measure. In
`packages/shared-ts/src/signing-lanes/rotationParsers.ts` (3,087 lines) each field
appears in the type, in `exactRecord`'s key list and in the returned object, and
the file defines its own small parsers such as `parseIso`.

- [x] On this module, compare three ways to declare each field once:
  1. a small set of in-house combinators over the shared validation helpers, from
     which the TypeScript type is inferred;
  2. types and parsers generated from the Rust definitions with `ts-rs`,
     extending `crates/signer-core/tests/export_typescript_schemas.rs` and
     `crates/router-ab-core/tests/export_typescript_bindings.rs`, which already
     generate `signerCoreCommands.ts` and `routerAbEd25519YaoCore.ts` (their
     headers name `pnpm generate:*` scripts that no longer exist);
  3. a third-party schema library in strict mode.
- [x] Judge them on strictness (unknown keys rejected, exact literals, branded
  IDs), error messages, wallet bundle size
  (`packages/wallet/scripts/checks/report-wallet-iframe-bundle-size.mjs`) and how
  easy the result is to review.
  - The combinators won. `utils/wireSchema.ts` (129 lines) provides
    `wireObject`, `wireLiteral`, `wireUnion`, `wireNonEmptyArray`, `wireResult`
    and `wireLabeled`. Each record is declared once, in the order of its type,
    and reuses the existing branded-ID parsers, so every message is reproduced
    byte for byte. The declared types stay, and 31 compile-time
    `ParsesExactly<P, T>` checks prove each schema produces exactly its type.
  - `ts-rs` fits only Rust-owned protocol messages. 15 of the 25 entry points
    are wallet-server records that no Rust type defines. Nothing on the Rust side
    derives `TS`, and the Rust fields are plain `String` and `u64`, so today's
    brands, literals and numbers would need an override on nearly every field.
    It also generates types, not validators: `routerAbEd25519Yao.ts` is built on
    generated types and still has 70 hand-written parse and require functions.
  - A schema library would add a dependency to the custody iframe and its
    workers. It would need a custom message or a wrapped domain parser on almost
    every field to keep today's messages, and Bun keeps its schemas too.
- [x] Prove parity: run the old and new parser over every fixture and over
  mutated inputs (missing, extra and renamed keys; wrong types and literals).
  60 fixtures over all 25 entry points, four of them from the Rust r102 wire
  vectors, gave no difference in 185,698 single-fault cases: same accept/reject,
  message, output key order and prototypes. With two faults, accept/reject is
  also identical, but 0.84% of random cases, and 0.46% with both faults in one
  object, report the other fault first. The combinators check exact keys, then
  literals, then the other fields in declaration order, then cross-field rules;
  the old parsers checked some child arrays and nested records early. The
  scope rule is accept/reject, so this order is accepted and documented in
  `wireSchema.ts`.
- [x] Record the change in lines and bundle size, then decide whether to roll
  out domain by domain.
  - The production workers are built with Bun, which keeps every schema built
    at module load, in every worker that imports the module, whether or not it
    parses anything. It also ignores `@__NO_SIDE_EFFECTS__`. The first version
    grew the ECDSA derivation worker by 1.45 kB gzip, and splitting the modules
    alone grew four other workers by 1.5 to 4.3 kB.
- [x] Land the pilot (efe17f1).
  - The client messages (the jobs, holder package and holder round) are in
    `rotationProtocolParsers.ts`, their shared fields in `rotationWireFields.ts`,
    and the server records stay in `rotationParsers.ts`.
  - Each schema is built inside a function, so bundlers drop the ones a worker
    never calls.
  - The four modules hold 1,601 lines where `rotationParsers.ts` had 2,675.
    TypeScript code is down 1,137 lines, validation functions 22 (1,733 lines),
    duplicated lines 315, and files over 2,000 lines by one.
  - The ECDSA derivation worker shrinks by 828 bytes gzip. The other twelve
    workers and the wallet iframe's boot path are unchanged.
  - `exactRecord` and `rejectUnknownFields` moved from `passkey-custody/primitives`
    to `utils/exactRecord.ts`. In `utils/validation.ts` they would have added
    609 bytes gzip to the wallet iframe's boot path.
- [ ] Roll out domain by domain, once decided (Phase 4 has the lane files).
  Candidates, by exact-key sites: `device-linking/parsers.ts` (88),
  `device-linking/sourceContribution.ts` (13), `passkey-custody/custodyEnvelope.ts`
  and `ordinaryInactiveSignerMaterialReservation.ts` (7 each), then
  `recordParsers.ts` and `participants.ts`. Build each schema in a function, and
  keep client parsers apart from server-only schemas in modules that workers
  import. Use `ts-rs` only for Rust-owned messages, as the declared type that
  `ParsesExactly` checks the schema against.
- [ ] Later, in a separate type-only change, infer the declared types from the
  schemas. That tightens about 70 digest fields in this module from `string` to
  `DigestB64u`.

Digest checks, canonicalization and cross-field rules stay hand-written; only
the field-by-field shape checking moves.

### 4. Restructure after R150 lands on `dev`

**Scope:** R150's most-changed files. Working in them before R150 merges would
conflict with the agents changing them.

- [ ] Roll out Phase 3's approach to the lane files in R150's hot paths.
- [ ] Split `crates/router-ab-cloudflare`'s largest files along their seams and
  remove the repetition the split exposes: `lib.rs` (16,489 lines, 66 commits in
  30 days, 210 runs), `tenant_root_role_d1.rs` (22,478 lines, 201 runs),
  `durable_object/tenant_root_creation.rs` (21,297 lines, 114 runs, 48
  `allow(dead_code)`), `tenant_root_role_runtime.rs` (11,134 lines, 125 runs) and
  `ed25519_yao_lifecycle.rs` (147 runs).
- [ ] In R150's crates, resolve the remaining `allow(dead_code)`
  (`router-ab-cloudflare` 51, `router-ab-dev` 2) as Phase 1 did elsewhere, and
  remove their 27 refactor citations.
- [ ] Merge the shared halves of `thresholdEcdsa.ts` and `thresholdEd25519.ts`
  (89 runs).
- [ ] `tenant_root_restore_refresh_role_command.rs` repeats the role-command
  encoder that 7fc5eda shared, with its own label and a 24 KiB limit; its
  encoder can use the shared wire, but its decoder's messages differ.
- [ ] Replace `?: never` padding (2,684 lines) with a shared exclusive-union helper
  where it shortens definitions without changing the types; prove identity as in
  the `Variant` pass.
- [ ] Decide on the public exports that nothing in the repository uses (367 at
  the baseline, 399 since the report counts every Rolldown input as an entry):
  keep and document them, or deprecate them. The same decision covers the 35
  public class members that nothing calls, on classes such as the D1 stores
  and `AuthService`, which public entry points return.
- [ ] `ThresholdStoreDurableObject` still handles `registrationCancelTerminal`
  and `getdelIfRelatedMatches`, which nothing has sent since cbcfceb deleted the
  unreachable store that sent them. Before removing a Durable Object handler,
  check that no deployed Worker version still sends it.
- [ ] Move the wallet's copy of `sameVerifiedActiveWalletAuthorityV1`
  (`SeamsWeb/operations/recovery/walletRecoveryCommit.ts`) into `shared-ts`
  beside the server's.

## Verification

```bash
pnpm report:bloat
pnpm -C packages/shared-ts type-check
pnpm -C packages/wallet-server type-check
pnpm -C packages/wallet type-check
pnpm -C tests type-check:intended
pnpm -C tests type-check:wallet-state
```

`pnpm type-check` also covers the docs app, the examples and the intended test
app. `tests/unit` has no tsconfig: type-check touched unit files with a temporary
one that extends `tests/tsconfig.wallet-intended.json`. For Rust, run
`cargo check` and the touched crates' tests. Run the behavior tests that cover a
consolidated cluster before committing it.

## Open decisions

- Whether to add Prettier as a dev dependency. `.prettierrc.json` exists, but no
  package installs Prettier, so formatting depends on each editor's copy.
- Which refactor plans are finished, and where finished plans go.
- Whether to roll Phase 3's combinators out beyond the pilot. The pilot
  recommends it, domain by domain, and efe17f1 shows the module layout that
  keeps the workers from growing.
- Whether the Vite plugin factories are public API. `packages/wallet` builds and
  ships them, but its `package.json` exports no path to them, so users cannot
  import them. b74937c restored them after the dead-export pass removed them.

Found during the cleanup and left unchanged, for their owners to check:

- Three export paths ignore an authorization argument: `exportAuthorizationWire`
  in `flows/recovery/ecdsaDerivationExport.ts` and
  `buildEcdsaExportVerificationRoutePlan` in `session/emailOtp/exportRecovery.ts`
  ignore their `EcdsaExplicitExportOperationAuthorization`, and
  `prepareAdmitExport` in `routerAbEd25519YaoExport.ts` ignores
  `authorizationIdentity`. 5f5e527 only prefixed the parameters with `_`. Either
  another step checks these, or a check is missing.
- `WalletRegistrationRouteTimingName` (the server has two names the client lacks)
  and `WalletRegistrationRouteDiagnostics` (different route names) differ between
  server and client in a way that looks like drift, not design.
- The unit tests `intendedYaoFault.isolation` and `walletSettingsPage` fail both
  before and after the cleanup changes.

## Progress log

- 2026-09-29: baseline recorded at `7c8a163` (164406d); the named-variant passes
  landed before it (836cca3, 7d74e01). Also before the baseline, eight `Drop ...`
  commits on this branch deleted 2,417 lines of dead tests and modules. After it,
  b143d76 merged `dev`'s test pruning (94c3aed, 5fabf28, 310f3a5, 4fb88bf), which
  deleted about 2,400 lines.
- 2026-09-29: Phase 0 landed (0af6f39, d1b55b9, 5f5e527, acc9f9f), then the
  dead-export pass (5aa72f4, 87baab3, 9f0ee44). Against the first baseline,
  measured at `964a714`: TypeScript code 539,841 -> 523,883 lines; dead exports
  464 -> 0; validation functions 4,276 -> 3,995 (86,063 -> 81,736 lines);
  duplicated TypeScript lines 21,753 -> 20,811; exports used only in their own
  file 2,272 -> 2,096. The baseline was re-recorded there, and CI now runs the
  check.
- 2026-09-29: a second test audit (d6dc822 to 5bf62b2) removed 2,556 lines and
  added 123. d6dc822 restored two checks that b143d76 had dropped. The rest
  deleted tests that echoed their inputs, repeated a stronger test or pinned
  deleted names, together with the Rust and test-fixture code that only those
  tests called. Found broken along the way, not fixed: two
  `tenant_root_role_cleanup_command` tests since 6877e11; four
  `router-ab-ecdsa-near-oracle-tests` checks; and the ed25519-yao test-count
  pins (`toolchain.toml`, `tasks/src/main.rs`) and phase-13a evidence, which
  dev's pruning left stale.
- 2026-09-29: Phase 1 continued. b74937c restored three published entries that
  the dead-export pass had removed, and the report now reads Rolldown's inputs.
  The un-export pass (d79f236, e4ed6a8, 554a09d) took exports used only in
  their own file from 2,096 to 0. Outside R150's crates, 710060d removed 12
  Rust `allow(dead_code)` that hid nothing and two dead codec modules (125 ->
  111). d416446 narrowed the citation measure to refactor numbers (274 -> 206).
  The baseline was re-recorded at `d416446`.
- 2026-09-29: the tests found broken above were deleted (7884aa9) along with
  three `.mjs` tests no runner picked up. Formal verification: 15bcdcf
  recounted the ed25519-yao pins and re-rendered `fixed-reference-v1.md`;
  f866095 dropped `just router-ab-core-fv-parity`'s nonexistent `--test
  evidence`; 3344736 regenerated signer-core's Ed25519 anti-drift vectors,
  which predated the Seams rename; e21cf93 and e54d863 gave router-ab-core's
  Verus fixture a valid digest; 3e46297 made the ECDSA-derivation LLBC
  extraction independent of the checkout path; a2c1c26 made `verus-check`
  count the crate's own obligations. `cargo yao-fv`'s aeneas-check and the
  ECDSA-derivation Lean boundary and privacy builds still need Mathlib
  locally, and `phase2b-review-subject-check` needs a clean checkout.
- 2026-09-29: Phase 1 finished apart from finished plans, and six Phase 2
  clusters landed. Refactor citations: 63a82e6 and e406924 in TypeScript, 40cba6c
  (the measure now also reads block comments) and 6f5b240 in Rust. Test-only
  exports: b7f4105 deleted 52 (its message says 44) and df764e0 10, and 0ba6c71
  and 9cbe238 removed what they left used only in their own file. Phase 2:
  996423f, dbe4e9a, b6e1cee, 3778536 and 7fc5eda. Against the first baseline,
  measured at `9cbe238`: TypeScript code 539,841 -> 519,444 lines; Rust code
  433,451 -> 428,928; duplicated TypeScript lines 21,753 (5.1%) -> 19,301
  (4.7%); duplicated Rust lines 19,427 -> 18,890; test-only exports 272 -> 205;
  names exported from 2+ files 198 -> 161; validation functions 4,276 -> 3,905
  (86,063 -> 81,227 lines); local helper copies 115 -> 39; `?: never` lines
  2,684 -> 2,557; Rust `allow(dead_code)` 125 -> 111; refactor citations 206 ->
  29 on the narrowed measure. The Phase 3 pilot reported. The baseline was
  re-recorded at `9cbe238`.
- 2026-09-29: Phase 2 finished, and the Phase 3 pilot landed. 43112f4 lists the
  registration timing buckets once. 9e72d4c shares the activation tests'
  fixtures. 0639436 shares the wallet-recovery finalization code. efe17f1
  lands the pilot with its client/server split. f5ded18 removed the last
  refactor citations outside R150's crates. 7f49898 and cbcfceb deleted 18
  class members nothing calls, and the registration ceremony stores and rate
  limiter that only they reached. R150 asked for a hold on packages/,
  crates/, wasm/ and tests/ during its contract runs and redeploy, and the last
  three patches landed after it, verified again on the new HEAD. Against the
  first baseline, measured at `efe17f1`: TypeScript code 539,841 -> 514,589
  lines; Rust code 433,451 -> 428,620; files over 2,000 lines 82 -> 80;
  duplicated TypeScript lines 21,753 (5.1%) -> 17,785 (4.3%); duplicated Rust
  lines 19,427 -> 18,524; validation functions 4,276 -> 3,848 (86,063 -> 77,776
  lines); refactor citations 27, all in R150's crates. The baseline was
  re-recorded at `efe17f1`.

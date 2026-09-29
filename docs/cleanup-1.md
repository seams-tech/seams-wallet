# Cleanup 1: dead, duplicated and boilerplate code

**Status:** Phase 0 is complete and Phase 1 has started. CI runs
`pnpm report:bloat --check`, which fails when a ratcheted measure grows past
`scripts/bloat-baseline.json`, now recorded at `d416446`. The packages compile
with the unused-code checks, and every export in `packages/*/src` is named by
another file or reachable from an entry point. Since the first baseline
(`7c8a163`), TypeScript code is down 15,958 lines. The findings below are the
first baseline's; run `pnpm report:bloat` for current numbers.

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

### Remaining

- [ ] Phase 1: test-only exports, local-only exports, dead-code suppressions,
  refactor citations and finished plans.
- [ ] Phase 2: consolidate the duplicated clusters listed below.
- [ ] Phase 3: pilot declaring each wire field once.
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
- [ ] Review the 272 exports only tests name (3,285 lines). Delete an export and
  its tests when the tests exercise nothing else, as the `Drop ...` commits of
  2026-09-29 did; keep deliberate test seams and say why. Of the current 269,
  about 200 are test seams that their own module also uses; about 70 (950
  lines) are code that only tests reach, mostly types that only `*.typecheck.ts`
  fixtures name.
- [x] Remove `export` from the 2,272 exports used only in their own file, then
  delete what `noUnusedLocals` reports: 2,080 exports, and
  `walletAuthPolicyError.ts`, which nothing used (d79f236 shared-ts, e4ed6a8
  wallet-server, 554a09d wallet).
- [ ] Replace each Rust `#[allow(dead_code)]` with
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
  `router-ab-cloudflare`'s 46 wait for Phase 4.
- [ ] Remove the comments that cite refactor numbers, keeping any explanation
  they carry. The measure now counts only `Refactor N` and `R###` citations
  (206); "Phase N" alone is often a protocol term, since the Yao circuits have
  phases. The TypeScript ones in `packages/` and `tests/` are next; the Rust ones
  sit mostly in R150's crates and wait for Phase 4.
- [ ] Move finished refactor plans (32 docs, 13,291 lines) out of `docs/`; plans
  still in progress stay.

**Exit:** no export is named nowhere else, every remaining dead-code
suppression either hides nothing the compiler can find in any build or waits
for Phase 4, and every test-only export has been reviewed.

### 2. Consolidate duplicated code

**Scope:** one cluster per commit, outside R150's most-changed files. Compare
every copy first; copies that differ on purpose keep separate names.

- [ ] Add `requireRecord`, `exactRecord`, `requireString`,
  `requireNonEmptyString` and `asRecord` to
  `packages/shared-ts/src/utils/validation.ts` and replace the 115 local copies in
  88 files. Where a copy's error text or exact-key rule differs, keep that
  behavior under its own name.
- [ ] Give `WebAuthnLoginChallengeStore`, `WebAuthnSyncChallengeStore`,
  `WebAuthnAuthenticatorStore` and `WebAuthnCredentialBindingStore`
  (`packages/wallet-server/src/core/`) one shared store implementation. The first
  two share 120 runs.
- [ ] Move `NearClient` (91 runs, 7 same-named exports) and `keyMaterialBrands`
  (21 same-named exports) from `packages/wallet` and `packages/wallet-server` into
  `packages/shared-ts`.
- [ ] Define once in `packages/shared-ts` the 27 types that both
  `packages/wallet-server/src/core/registrationContracts.ts` and
  `packages/wallet/src/core/rpcClients/relayer/walletRegistration.ts` declare.
  Some copies differ on purpose (the client's `WalletRegistrationFinalizeResponse`
  has no failure member); rename those instead of merging them.
- [ ] Merge the shared halves of `thresholdEcdsa.ts` and `thresholdEd25519.ts`
  (89 runs), of `signNep413.ts` and `signDelegate.ts`, and of
  `d1WalletRecoveryGoogleEmailOtpService.ts` and `walletRecoveryFinalization.ts`
  (76 runs); remove `registrationTiming.ts`'s internal repetition (184 runs).
- [ ] In Rust outside `router-ab-cloudflare`: the tenant-root creation and
  refresh role commands, the activation evidence and receipt tests, and
  `crates/router-ab-ed25519-yao-client/tests/registration.rs` against
  `wasm/wallet_custody_ceremony/src/circuit_tests.rs` (139 runs).

**Exit:** each listed cluster has one implementation, and both languages'
duplication is below the baseline.

### 3. Pilot one declaration per wire field

**Scope:** one module. Its parser must accept and reject exactly what it does
today.

Validation is the largest measure. In
`packages/shared-ts/src/signing-lanes/rotationParsers.ts` (3,087 lines) each field
appears in the type, in `exactRecord`'s key list and in the returned object, and
the file defines its own small parsers such as `parseIso`.

- [ ] On this module, compare three ways to declare each field once:
  1. a small set of in-house combinators over the shared validation helpers, from
     which the TypeScript type is inferred;
  2. types and parsers generated from the Rust definitions with `ts-rs`,
     extending `crates/signer-core/tests/export_typescript_schemas.rs` and
     `crates/router-ab-core/tests/export_typescript_bindings.rs`, which already
     generate `signerCoreCommands.ts` and `routerAbEd25519YaoCore.ts` (their
     headers name `pnpm generate:*` scripts that no longer exist);
  3. a third-party schema library in strict mode.
- [ ] Judge them on strictness (unknown keys rejected, exact literals, branded
  IDs), error messages, wallet bundle size
  (`packages/wallet/scripts/checks/report-wallet-iframe-bundle-size.mjs`) and how
  easy the result is to review.
- [ ] Prove parity: run the old and new parser over every fixture and over
  mutated inputs (missing, extra and renamed keys; wrong types and literals).
- [ ] Record the change in lines and bundle size, then decide whether to roll
  out domain by domain.

Digest checks, canonicalization and cross-field rules stay hand-written; only
the field-by-field shape checking moves.

### 4. Restructure after R150 lands on `dev`

**Scope:** R150's most-changed files. Working in them before R150 merges would
conflict with the agents changing them.

- [ ] Roll out Phase 3's approach domain by domain.
- [ ] Split `crates/router-ab-cloudflare`'s largest files along their seams and
  remove the repetition the split exposes: `lib.rs` (16,489 lines, 66 commits in
  30 days, 210 runs), `tenant_root_role_d1.rs` (22,478 lines, 201 runs),
  `durable_object/tenant_root_creation.rs` (21,297 lines, 114 runs, 48
  `allow(dead_code)`), `tenant_root_role_runtime.rs` (11,134 lines, 125 runs) and
  `ed25519_yao_lifecycle.rs` (147 runs).
- [ ] Replace `?: never` padding (2,684 lines) with a shared exclusive-union helper
  where it shortens definitions without changing the types; prove identity as in
  the `Variant` pass.
- [ ] Decide on the 367 public exports that nothing in the repository uses: keep
  and document them, or deprecate them.

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
- Phase 3's approach, after the pilot.

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

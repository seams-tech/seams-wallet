# Rust warning cleanup checklist and revert log

Review date: **2026-10-21**. Status: **review complete. Cleanup pending.**

The review found unused transport wrappers, broad worker imports, and repeated
lifecycle code. Start with the internal wrappers that have no callers.
Review role ownership and response contracts before deleting other flagged code.
This review changes documentation only. It leaves Rust code unchanged.

## Source baseline and measurements

Repository: `seams-wallet`, branch `dev`.
Source baseline: [`37d9f383d55810fd1f8d3fd93c989255d68ba17b`](https://github.com/seams-tech/seams-wallet/tree/37d9f383d55810fd1f8d3fd93c989255d68ba17b).
All source locations below refer to that commit.
The Rust sources and Cargo manifests match the previous review at
`faa9bc06827b00cf88704a0ec64511f52aa80002`.

Compiler: `rustc 1.97.1 (8bab26f4f 2026-07-14)`.
Worker and browser target: `wasm32-unknown-unknown`.
Native target: `aarch64-apple-darwin`.
All **11 compilation checks passed**.

| Check                     | Unused imports | Unused variables | Dead-code warnings | Total |
| ------------------------- | -------------: | ---------------: | -----------------: | ----: |
| Router                    |              5 |                7 |                132 |   144 |
| Deriver A                 |              6 |                8 |                102 |   116 |
| Deriver B                 |              8 |                7 |                116 |   131 |
| Signing Worker            |              7 |                1 |                170 |   178 |
| Tenant-root control plane |              5 |                7 |                151 |   163 |
| NEAR signer WASM          |              0 |                0 |                  0 |     0 |
| Custody ceremony WASM     |              0 |                0 |                  1 |     1 |
| ECDSA client WASM         |              0 |                0 |                  0 |     0 |
| Ed25519 Yao client WASM   |              0 |                0 |                  0 |     0 |
| Native CLI                |              0 |                0 |                  3 |     3 |
| Native development host   |              1 |                0 |                 16 |    17 |

The five worker checks emit **732 warning occurrences**.
They contain **218 distinct diagnostics at 217 source locations**:
198 dead-code diagnostics, 11 unused-import diagnostics, and nine unused-variable
diagnostics. A diagnostic can name several methods or imports.
The distinct key is file, primary source line, warning code, and message.
Different method groups at one location explain the extra diagnostic.

Exactly **37 diagnostics occur in all five worker roles**.
C01–C06 below account for all 37: `5 + 19 + 2 + 7 + 3 + 1`.
The other 181 worker diagnostics depend on the selected role.
All 11 checks emit 753 warning occurrences, including repeated dependency warnings.
These counts cover the listed builds. Other targets, features, and test builds need
their own checks when a cleanup affects them.

`pnpm report:bloat --check` passed at the source baseline:

| Rust measure                                      |              Current value | Change since 2026-10-16 baseline |
| ------------------------------------------------- | -------------------------: | -------------------------------: |
| Code lines in tracked Rust files, including tests |                    398,842 |                           +4,101 |
| Duplicated meaningful lines                       | 13,699 of 313,975, or 4.4% |                              −55 |
| `allow(dead_code)` occurrences                    |                         89 |                        Unchanged |

The duplication scan counts exact repeats of ten meaningful lines.
It excludes blank, comment, import, and punctuation-only lines.
It also skips selected module and attribute lines.
Generated code and independent tests require separate judgment.
A passing growth check permits existing waste. These measurements establish no
release-WASM size, startup, or runtime improvement.

Local raw evidence is under `.artifacts/rust-warning-review/review-20261021/`:
`warnings.json`, per-build JSON messages and stderr, and `bloat-check.txt`.
Git ignores that directory. This document records the source baseline,
measurements, symbols, and recovery procedure independently of those local files.

## Cleanup checklist

Complete one small batch at a time. Recheck references against the current tree
before each deletion. Record the actual before-commit and cleanup commit in the
ledger before starting the next batch.

### C01 — Delete five unused internal wrapper items

- [ ] Delete the four wrappers and their private role-selection helper in
      `crates/router-ab-cloudflare/src/lib.rs`.
- [ ] Delete imports that become unused. Preserve shared constants and transport
      functions that still have callers.

| Baseline line | Exact symbol                                                                            |
| ------------: | --------------------------------------------------------------------------------------- |
|         13482 | `execute_cloudflare_tenant_root_control_plane_restore_refresh_commands_service_call_v1` |
|         13500 | `execute_cloudflare_tenant_root_control_plane_cleanup_command_service_call_v1`          |
|         13513 | `cloudflare_tenant_root_peer_deriver_role_v1`                                           |
|         13529 | `execute_cloudflare_deriver_tenant_root_cleanup_service_call_v1`                        |
|         13544 | `execute_cloudflare_deriver_tenant_root_initial_activation_service_call_v1`             |

Evidence: all five workers report these items unused. Repository searches found
no wrapper callers. The private helper serves only those unused wrappers.
The live creation, refresh, and restore coordinators call `tenant_root_transport`
directly. Preserve its cleanup and initial-activation functions.

Classification: **deletion candidates**. Check all five worker builds afterward.

### C02 — Delete obsolete transport adapters and URL helpers

- [ ] Recheck the following wrapper chains, then delete each complete unused chain.
- [ ] Preserve the shared host transport, live route handlers, route paths,
      issuer verification, and service-binding constants with other callers.

All paths in this table start with `crates/router-ab-cloudflare/src/`.

| File and baseline line                        | Exact symbol                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `durable_object/tenant_root_creation.rs:3894` | `execute_cloudflare_router_tenant_root_refresh_attempt_reservation_call_v1`               |
| `durable_object/tenant_root_creation.rs:3958` | `worker_issuer_verifying_keys_v1`                                                         |
| `tenant_root_control_plane.rs:3457`           | `live::ROUTER_TENANT_ROOT_CREATION_DO_BINDING_V1`                                         |
| `tenant_root_control_plane.rs:3459`           | `live::local`                                                                             |
| `tenant_root_control_plane.rs:3758`           | `live::refused_owned`                                                                     |
| `tenant_root_control_plane.rs:4064`           | `execute_cloudflare_tenant_root_control_plane_restore_initial_activation_service_call_v1` |
| `env.rs:2536`                                 | `load_cloudflare_tenant_root_creation_role_signing_key_v1`                                |

The remaining 12 diagnostics concern six URL/helper pairs in `paths.rs`.
The constant name is `CLOUDFLARE_TENANT_ROOT_CONTROL_PLANE_<UPPERCASE_SUFFIX>_PRIVATE_REQUEST_URL`.
The function name is `cloudflare_tenant_root_control_plane_<lowercase_suffix>_service_url`.

| Suffix                       | Constant line | Function line |
| ---------------------------- | ------------: | ------------: |
| `restore_initial_activation` |           346 |           507 |
| `managed_restore_challenge`  |           351 |           513 |
| `managed_restore_authorize`  |           356 |           519 |
| `register_manifest`          |           361 |           525 |
| `restore_role_import_key`    |           366 |           531 |
| `restore_refresh_commands`   |           371 |           537 |

Evidence: all five workers report these 19 diagnostics.
The issuer-key helper serves the unused refresh-reservation adapter.
The environment adapter delegates to `load_tenant_root_creation_role_signing_key_v1`.
Preserve that shared loader. The similarly named Durable Object binding constant
in `durable_object/tenant_root_creation.rs:861` has live callers.

Classification: **deletion candidates after a complete reference check**.
Include the unused control-plane re-export when deleting its implementation.
Check all five worker builds and the native host afterward.

### C03 — Delete superseded Durable Object readers

- [ ] Delete the unused reader methods and their unused result type in
      `crates/router-ab-cloudflare/src/durable_object/tenant_root_creation.rs`.
- [ ] Preserve journal validation, activation validation, transaction boundaries,
      and shared storage readers that the active implementation still calls.

| Baseline line | Exact symbol                                                                       |
| ------------: | ---------------------------------------------------------------------------------- |
|          7031 | `LoadedTenantRootRoleCreationRequestV1`                                            |
|          7890 | `RouterAbTenantRootCreationDurableObject::load_role_creation_request`              |
|          8157 | `RouterAbTenantRootCreationDurableObject::load_authoritative_active_refresh_state` |

Evidence: the type and grouped method warning occur in all five workers.
Searches found definitions and construction inside the unused reader only.
The current implementation uses the shared store inside transactions.

Classification: **deletion candidates**. Check worker builds and creation/refresh
behavior if the patch touches any active transaction code.

### C04 — Audit unused D1 methods by owning type

- [ ] Classify each method below as unused, test-only, or required by another build.
- [ ] Delete proven unused methods. Restrict test-only methods with existing
      test configuration. Preserve stored fields and lifecycle parsing.

File: `crates/router-ab-cloudflare/src/tenant_root_role_d1.rs`.
These seven diagnostics group multiple methods.

| Baseline line | Owning type and methods                                                                                             |
| ------------: | ------------------------------------------------------------------------------------------------------------------- |
|          4196 | `CloudflareTenantRootRestoreImportKeyRecordV1::{installed_at_ms, created_at_ms, updated_at_ms}`                     |
|          4290 | `CloudflareTenantRootRestoreRefreshRoleAttemptLifecycleV1::as_str`                                                  |
|          4322 | `CloudflareTenantRootRestoreRefreshPromotionLifecycleV1::as_str`                                                    |
|          4369 | `CloudflareTenantRootRestoreRefreshPromotionSourceV1::refreshed_at_ms`                                              |
|          4513 | `CloudflareTenantRootRestoreRefreshRoleAttemptAdmissionV1::evidence_bytes`                                          |
|          4680 | `CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1::{pending, refreshed, closed, created_at_ms, updated_at_ms}` |
|  9558 / 10915 | `TenantRootRoleShareStoreV1<S>::{preflight_refresh_replay, load_active}`                                            |

Classification: **further usage and invariant review required**.
Common names such as `evidence_bytes` also belong to live types.
For example, `CloudflareTenantRootRestoreRefreshRoleAttemptRecordV1::refreshed_at_ms`
at line 4794 has callers. Keep it separate from the warned promotion-source method.
Preserve the validation that active store operations enforce.

### C05 — Separate test accessors from unused R2 convenience methods

- [ ] Restrict the five deletion-receipt accessors to tests after checking
      their complete caller set.
- [ ] Apply the same review to the environment's `backup_public_key` accessor.
- [ ] Delete `get_verified_provider_canary` if its only remaining use is its
      definition. Preserve `get_verified_provider_canary_with_metadata`.

Files under `crates/router-ab-cloudflare/src/`:

| File and baseline line                 | Symbols and evidence                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tenant_root_managed_backup_r2.rs:217` | `CloudflareTenantRootManagedBackupDeletionReceiptV1::{managed_backup_object_key, provider_canary_object_key, managed_backup, provider_canary, cryptographic_erasure}` have existing test callers at lines 873–889. |
| `env.rs:670`                           | `CloudflareTenantRootOperationalRotationProviderConfigV1::backup_public_key` has existing test callers at lines 3463 and 3513.                                                                                     |
| `tenant_root_managed_backup_r2.rs:486` | `get_verified_provider_canary` delegates to the metadata variant. The runtime calls the metadata variant at `tenant_root_role_runtime.rs:2038`.                                                                    |

Classification: **two test-only diagnostic groups and one wrapper candidate**.
Preserve deletion-receipt serialization and its explicit erasure claim.
Preserve signature verification, expected bindings, role checks, and metadata checks.

### C06 — Review the unread failure receipt without losing replay evidence

- [ ] Trace `CloudflareTenantRootAuthorizedCleanupDecisionV1::ReplayFailed`
      from stored terminal receipt to runtime refusal.
- [ ] Decide whether the runtime must consume the exact receipt bytes.
      Delete an in-memory copy only after establishing its redundancy.

Location: `crates/router-ab-cloudflare/src/tenant_root_role_d1.rs:7105`, field
`failure_receipt_bytes`. All five workers report the unread field.
Other decision types use the same field name.
`persist_authorized_cleanup` at line 12040 returns a refusal for this branch.

Classification: **retain pending semantic review**.
Preserve durable failure receipts, replay refusal, and cleanup authorization.
An unread field gives insufficient evidence for changing stored receipt data.

### C07 — Narrow existing worker-role and host configuration

- [ ] Review the 11 distinct unused-import diagnostics and role-dependent
      dead-code groups. Use the existing entrypoint features at their owning boundaries.
- [ ] Delete redundant imports and re-exports when direct consumers already import
      their owner. Preserve implementations with callers in another role.
- [ ] Check native host and PostgreSQL consumers before restricting shared SQL code.

Concrete starting points under `crates/router-ab-cloudflare/src/`:

- `ed25519_yao_lifecycle.rs:2–3` compiles and re-exports Deriver A execution broadly.
  `durable_object/deriver_a_pair.rs:868` calls `execute_deriver_a_role` in Deriver A.
- `tenant_root_control_plane.rs:1187,1197` re-exports control-plane functions into
  other roles. `strict_worker/mod.rs:144` broadly imports Signing Worker checks.
- `durable_object/mod.rs:82,93`, `router_coordinator.rs:9,23`,
  `registration_pair_preparation.rs:5`, `durable_object/tenant_root_creation.rs:4`,
  and `signing_worker/private_d1.rs:10` contain the other import diagnostics.
- `durable_object/signing_worker_wallet/package_delivery.rs:8` has a live caller
  in `ed25519_yao_signing_worker.rs:686`. Preserve Signing Worker delivery.
- `tenant_root_role_sql.rs:194` defines `parameter_positions`.
  D1 calls it at `tenant_root_role_sql/d1.rs:47`.
  PostgreSQL calls it at `tenant_root_role_sql/postgres.rs:224`.
- `env.rs:943` defines `google_cloud_kms_crypto_key_from_version_v1`.
  Google KMS calls it at `tenant_root_google_kms.rs:153,302`.

Classification: **build ownership cleanup**.
The native host emits 17 diagnostics with its current features.
Several concern excluded Worker or database implementations.
Keep live feature paths. Add no new feature flags or compatibility paths.

### C08 — Review the nine unused-variable diagnostics

- [ ] Delete redundant parameters only after checking their ownership and routing
      responsibilities. Update every caller in the same batch.
- [ ] Keep gateway routing validation and owner-generation checks where required.
      A leading underscore alone does not establish that a parameter is redundant.

All locations are under `crates/router-ab-cloudflare/src/`:

| Variable               | Baseline locations                                                                          | Review condition                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wallet_objects`       | `lib.rs:8385,10931,12362,12792`, `durable_object/ecdsa_presign_live_session.rs:123,578,786` | Unused in four worker roles, consumed by Signing Worker paths. Review the conditional branches before changing signatures.                                                         |
| `ownership_generation` | `durable_object/deriver_a_pair.rs:943`, `complete_work`                                     | The caller supplies the generation. Completion does not read this parameter. Trace physical-object selection, relocation fencing, owner checks, and completion before deleting it. |
| `runtime`              | `ecdsa_signing_fetch.rs:8`                                                                  | Unused in the Signing Worker build. Another conditional branch uses this runtime. Establish the handler's supported callers before narrowing it.                                   |

Classification: **ownership review required**.
The unused generation alone establishes no ownership defect.
Any change to a required owner check needs a separate behavior fix and evidence.

### C09 — Scope the Ed25519 client export helper to its existing owner

- [ ] Review configuration for `prepare_client_export_from_custody_seed_v1`
      in `crates/router-ab-ed25519-yao-client/src/lib.rs:778`.
- [ ] Preserve the export implementation and its WASM binding.
      Restrict the helper only when its complete consumer set permits it.

The custody ceremony disables the dependency's `wasm-bindings` feature and emits
one warning for this helper. The standalone client WASM check emits no warnings.
`crates/router-ab-ed25519-yao-client/src/wasm.rs:104` calls the helper.

Classification: **retain live export behavior. Review the existing feature boundary.**
Keep seed-manifest proof types separate from authenticated-envelope proof types.

### C10 — Audit the 89 dead-code suppressions

- [ ] Review each suppression against worker roles, native hosts, and test callers.
- [ ] Start with the module-wide suppression in
      `crates/router-ab-cloudflare/src/tenant_root_operational_provider.rs:1`.
- [ ] Delete proven dead code. Restrict test-only code or narrow existing features.
      Keep any necessary expectation local, with a precise reason.
- [ ] Rerun the warning matrix after changing suppressions and record newly exposed
      warnings. A higher visible count can result from better coverage.

Classification: **hidden inventory requires review**.
The operational-provider module contains live backup and online-share code.
Preserve secret erasure, provider checks, and cryptographic domain separation.
Delete no module solely because it contains a broad suppression.

### C11 — Consolidate specific duplication, then split oversized owners

- [ ] Review the exact duplicate blocks below for shared behavior.
      Preserve branch-specific validation and error behavior.
- [ ] Reuse an existing owner where possible. Introduce a helper only when it
      reduces total complexity.
- [ ] Separate large files along real storage, transport, or lifecycle ownership.
      Keep a structural move separate from a behavior change.
- [ ] Preserve independent cryptographic vectors and ceremony contracts until their
      invariant owners establish that consolidation retains coverage.

All locations are under `crates/router-ab-cloudflare/src/`:

| File                          | Baseline repeated blocks | Review focus                                                                                                                                          |
| ----------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.rs`                      | 6096–6155 and 6922–6981  | The two `into_signing_worker_effect_claim` implementations share 52 meaningful lines. Check curve-specific validation before sharing conversion code. |
| `tenant_root_role_d1.rs`      | 3017–3048 and 3199–3230  | Promotion-output and replay-seed readers repeat 32 meaningful binding-check lines. Preserve each envelope's extra checks and authenticated data.      |
| `tenant_root_role_runtime.rs` | 5159–5216 and 7519–7576  | Normal refresh and managed-restore refresh repeat 48 meaningful admission lines. Preserve freshness, replay, and completion differences.              |

The bloat report counts these large files as follows, including the final empty
line in newline-terminated files:

| File under `crates/router-ab-cloudflare/src/` | Reported lines |
| --------------------------------------------- | -------------: |
| `tenant_root_role_d1.rs`                      |         22,107 |
| `durable_object/tenant_root_creation.rs`      |         21,251 |
| `lib.rs`                                      |         15,179 |
| `tenant_root_role_runtime.rs`                 |         11,028 |

Together they contain 69,565 reported lines.
Classification: **maintainability work after small deletions**.
File length and duplicate windows identify areas for review.
Caller and behavior checks determine which code can be deleted.
Keep SQL predicates, transaction order, replay fences, wire names, and persisted
identifiers stable during structural work.

### C12 — Review the CLI's parsed response fields

- [ ] Review the three CLI diagnostics in `crates/seams-cli/src/console.rs`.
- [ ] Establish whether each field constrains an accepted response, carries needed
      lifecycle state, or serves only display data.
- [ ] Preserve valid server-response acceptance and the intended success/refusal
      behavior before simplifying the boundary types.

| Baseline line | Type and unread fields                                 |
| ------------: | ------------------------------------------------------ |
|           331 | `RotationResponseWire::status`                         |
|           342 | `RotationRefusalWire::{ok, message}`                   |
|           363 | `PolledOperationWire::{failure_code, accepted_result}` |

Classification: **response-contract review required**.
The refusal and polled-operation types use `serde(deny_unknown_fields)`.
Deleting an accepted field from either type can reject current server responses.
The start path also parses `status` without using it to select a domain outcome.
Check that behavior against the server contract before treating the field as waste.

## Verification and repeatable evidence

Run commands from the `seams-wallet` repository root.
These compilation commands reproduce the review. They check type correctness and
selected feature coverage. They do not execute wallet lifecycles.

```sh
for review_role in router deriver-a deriver-b signing-worker tenant-root-control-plane; do
  cargo check --locked \
    --manifest-path crates/router-ab-cloudflare/Cargo.toml \
    --target wasm32-unknown-unknown \
    --features "strict-worker-${review_role}-entrypoint" || exit 1
done

cargo check --locked --manifest-path wasm/near_signer/Cargo.toml --target wasm32-unknown-unknown
cargo check --locked --manifest-path wasm/wallet_custody_ceremony/Cargo.toml --target wasm32-unknown-unknown
cargo check --locked --manifest-path wasm/router_ab_ecdsa_client/Cargo.toml --target wasm32-unknown-unknown
cargo check --locked --manifest-path crates/router-ab-ed25519-yao-client/Cargo.toml --target wasm32-unknown-unknown
cargo check --locked --manifest-path crates/seams-cli/Cargo.toml
cargo check --locked --manifest-path crates/router-ab-dev/Cargo.toml
pnpm report:bloat --check
```

For a cleanup, use the narrowest affected compilation checks first.
Shared role configuration requires all five role checks and affected native checks.
Compile affected existing test targets when restricting test-only helpers.
Check PostgreSQL configuration when shared SQL or database conditions change.
The native development-host check above uses the manifest's default features.

For changes to active lifecycle behavior, select an existing medium or hard E2E
scenario and record its result and artifact path.
An E2E scenario exercises the assembled system through a complete operation.
Use the existing harnesses:

| Affected behavior                                       | Existing validation and artifact                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creation authorization renewal                          | Rebuild with `ROUTER_AB_WORKER_BUILD_PROFILE=release pnpm build:workers`, then run `ROUTER_AB_WORKER_BUILD_PROFILE=release node crates/router-ab-cloudflare/scripts/test-grant-renewal.mjs`. It writes `.artifacts/grant-renewal/<run>/evidence.json`. This scenario covers authorization renewal. |
| Role storage, refresh, restore, delivery, or relocation | Use `pnpm -C crates/router-ab-cloudflare test:private-d1`. It rebuilds the development Workers and emits scenario artifacts. Record the exact affected scenario and artifact. Broader startup prerequisites remain those of the existing harness.                                                  |
| Browser signing, recovery, and export                   | Select the relevant contract through `pnpm -C tests test:intended -- e2e/intended-behaviours/<contract>.test.ts`. Record the selected cases, source commit, Playwright report, and attached evidence. Google-token prerequisites apply to this command.                                            |
| Cryptographic or wire changes                           | Preserve the relevant existing vectors, type fixtures, and formal checks. Run the owning checks only when their invariants change. Regenerate generated artifacts with their existing commands.                                                                                                    |

The review did not rerun E2E scenarios because it changes documentation only.
Add no unit tests or source-text snapshot checks for this checklist.
If an existing check fails, classify its invariant before changing code or fixtures.
Record whether it is a production regression, valid test needing update, obsolete
test or fixture, or environment/infrastructure failure.

## Change ledger and recovery

All cleanup batches remain pending.
The source baseline preserves every listed implementation in Git.
Before each batch, record the current full commit SHA and exact symbols to delete.
Use a dedicated code commit for that batch.
Afterward, record its full commit SHA and verification evidence here.
Commit the ledger update before starting the next batch.
Use one ledger row per actual batch. Split rows further when necessary.

| Batch                             | Status                 | Before commit | Cleanup commit | Verification / artifact | Revert commit |
| --------------------------------- | ---------------------- | ------------- | -------------- | ----------------------- | ------------- |
| C01 — Internal wrappers           | Pending                | —             | —              | —                       | —             |
| C02 — Transport adapters          | Pending                | —             | —              | —                       | —             |
| C03 — Durable Object readers      | Pending                | —             | —              | —                       | —             |
| C04 — D1 methods                  | Needs classification   | —             | —              | —                       | —             |
| C05 — Test accessors / R2 wrapper | Pending                | —             | —              | —                       | —             |
| C06 — Failure receipt             | Retain pending review  | —             | —              | —                       | —             |
| C07 — Role and host configuration | Pending                | —             | —              | —                       | —             |
| C08 — Unused parameters           | Needs ownership review | —             | —              | —                       | —             |
| C09 — Client export configuration | Preserve live export   | —             | —              | —                       | —             |
| C10 — Suppressions                | Needs classification   | —             | —              | —                       | —             |
| C11 — Duplication and large files | Pending                | —             | —              | —                       | —             |
| C12 — CLI response fields         | Needs contract review  | —             | —              | —                       | —             |

For each completed row, record changed paths, deleted symbols, warning-count
changes, source-line changes, and any release-WASM byte measurements actually taken.
Record a retained item's reason instead of checking a deletion as complete.
Store shareable evidence without credentials, secrets, or wallet material.

Inspect the original source without replacing current files:

```sh
review_before=37d9f383d55810fd1f8d3fd93c989255d68ba17b
review_path=crates/router-ab-cloudflare/src/lib.rs
git show "${review_before}:${review_path}"
git log --oneline -- "$review_path"
```

For later batches, substitute the ledger's before-commit for `review_before`.
To undo an accidental deletion, inspect the recorded cleanup commit first.
Preserve concurrent edits and resolve any conflicts explicitly.

```sh
review_cleanup=FULL_CLEANUP_COMMIT_SHA_FROM_LEDGER
git status --short
git show --stat "$review_cleanup"
git revert "$review_cleanup"
```

Rerun that batch's verification and record the resulting revert commit.
If one commit contains multiple changes, restore only the required patch and
record the partial restoration. Avoid whole-file restoration over later work.
Keep recovery history in Git. Add no backup implementations or compatibility flags.

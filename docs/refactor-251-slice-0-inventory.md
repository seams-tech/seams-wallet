# Refactor 251, Slice 0: inventory and measures

Status: 2026-11-18, measured on `dev` at `9203a8805`. Slice 0 of
[Refactor 251](refactor-251-auth-wallet-checkout-modules.md). No product code changed.

Six read-only agents read the code, one for each group of audit areas. The main claims were
checked again in the code: the line counts of the largest files, the Email OTP release path, the
package entries and the device-link credential. Paths, line counts and imports are measured. The
owner of a row after the split is inferred from Sections 3 to 6 of the plan. Other inferred
items say so.

## Result

- **U2 (what belongs to auth and what to the wallet)** is answered for each IndexedDB store, D1
  table, secret and route. Auth and the wallet share one IndexedDB database, one D1 database
  and one method table today. See "U2" below.
- **U3 (seams-monorepo)**: seams-monorepo adds no route of its own on a route that moves. Its
  Console Gateway forwards the auth routes to the wallet's home region and injects the identity
  stores and the email sender. Slice 5 must give the Auth Worker a home-region lookup. See "U3".
- **U4 (a compromised Auth Worker and Email OTP)**: **it can take each owner Email OTP wallet**,
  if the wallet server accepts its email statement. The cause is larger: **today the wallet
  server alone can open these wallets**, against the public custody docs. This needs an owner
  decision (D26). See "U4".
- **U5 (lines of each area)**: about 319,000 source lines in the ten areas. New code replaces
  about 138,000 of them, and each area has a budget. See "U5".
- **The package entries**: the 37 entries map to 23 paths in Release A. See "The package
  entries".
- **The plan changes** in the same commit: Fact F20 is corrected, Facts F23 and F24 are new,
  Section 6 changes two rows, and D25 and D26 are new open decisions.

## U5: lines of each area

Areas can share a file, so the sums count some lines twice. "Replaced" is the old code that
new code replaces. The new code for an area must have fewer lines (Section 2).

| Area | Source files | Source lines | Test files | Test lines | Replaced, and the budget |
| --- | ---: | ---: | ---: | ---: | --- |
| 1. Ceremonies | 70 | 11,722 | 22 | 6,120 | 7,210 |
| 2. Factor secrets | 52 | 15,869 | 25 | 5,197 | 2,486, plus the factor hand-off |
| 3. Stored records | 61 | 27,706 | 23 | 6,924 | about 16,700 |
| 4. Sessions | 91 | 29,977 | 13 | 3,476 | 12,018 |
| 5. Account changes | 174 | 100,985 | 55 | 12,197 | about 65,900 |
| 6. Wire | 85 | 36,578 | 31 | 11,799 | 9,386, plus a part of 6.25 |
| 7. UI | 214 | 54,590 | 44 | 13,105 | 20,016 |
| 8. Errors | 15 | 3,672 | 5 | 597 | about 1,800 |
| 9. Shared contracts | 138 | 35,971 | 21 | 3,861 | about 2,700 |
| 10. Project credentials | 11 | 1,839 | 5 | 3,744 | 1,839, a reviewed move |
| **Sum** | | **318,909** | | | **about 138,000** |

The test harness `tests/e2e/intended-behaviours/harness.ts` (8,696 lines) serves every area and
is not counted. The rows that are not replaced move to their owner. A move does not grow.

## U4: what a compromised Auth Worker can do to an Email OTP wallet

How the Email OTP factor key works today:

1. At enrollment, the Email OTP worker makes a random 32-byte factor key S
   (`packages/wallet/src/core/signingEngine/workerManager/workers/email-otp/enrollment.ts:79-81`).
2. The worker and the server run Shamir three-pass. The worker uses a temporary key and removes
   its own seal at the end. The result is S under the server's seal only: enc_s(S)
   (`enrollment.ts:86-111`).
3. The server stores enc_s(S) in its enrollment record
   (`packages/wallet-server/src/core/EmailOtpStores.ts:88-102`, D1
   `email_otp_wallet_enrollments`). The seal key comes from one Worker secret.
4. After a valid email code, `/wallet/email-otp/factor-release` reads enc_s(S) from D1, removes
   the server seal, and encrypts S to any P-256 key that the caller sends
   (`router/transport/fetch/routes/sessions.ts:1305-1345`,
   `router/domains/emailOtp/emailOtpRouteHandlers.ts:66`).
5. S derives the unlock key that the server pinned at enrollment. With it, `/wallet/unlock/verify`
   returns the custody envelope and a Wallet Session (`walletUnlockRouteHandlers.ts:1682-1694`).
6. S and the envelope open the custody seed (`email-otp/custodyRestore.ts:558`,
   `wallet_custody_ceremony_join_v1`). Nothing from the user's device is necessary.
7. A valid Email OTP Wallet Session releases S again with no email code (`sessions.ts:1203-1227`).

What this means:

- **The Auth Worker.** If the wallet server accepts an Auth Worker statement where it checks the
  code today, a compromised Auth Worker can take each owner Email OTP wallet, on any device, for
  unlock, signing and export. The pinned key of D7 does not protect Email OTP, because the
  server releases S on the email check.
- **The wallet server today.** The wallet server, with its D1 data and its seal secret, can
  recover S and open the seed by itself. The public docs say that hosted infrastructure cannot
  sign or export a wallet key by itself (`apps/docs/src/concepts/custody/index.md`,
  `apps/docs/src/concepts/architecture.md:146`). `docs/otp/email-otp.md` says that enc_s(S)
  stays in the iframe's IndexedDB and that the server must not store it. The code has stored it
  on the server since the first commit of this repository (2026-09-12).
- **Not affected:** a method that exists only on a linked device (its material is on that
  device), and recovery (it needs a recovery code).
- **Also measured:** the server stored Email OTP codes in plaintext
  (`d1EmailOtpChallengeVerifier.ts:346`). Refactor 252 Slice 1 fixed this on 2026-11-18.

What the split must keep in the Wallet Gateway: the seal root secret, the enrollment records,
the envelopes, the grants and every route that releases S (factor release, step-up, the device
link target, the recovery release). The Auth Worker reads none of them.

The two options of Section 6 do not close the larger gap. "Accept it" keeps a trust that the
public docs do not describe. "The wallet server checks its own email code for the audience
`wallet`" keeps the Auth Worker out of the trust base, but it does not change the trust in the
wallet server. The owner decides D26.

## Findings for the owner

Problems found in passing. Slice 0 and Slice 2 change no product code, so none is fixed here.
The rows marked "Slice 2" were measured by a check of the conformance suite. Each fault that
breaks a contract has an expected failure there (see "What Slice 2 writes first").

| Finding | Where | Area |
| --- | --- | --- |
| The wallet server alone can open an owner Email OTP wallet, against the public custody docs | See U4 | 2 |
| The server never required user verification for a passkey assertion or registration (`requireUserVerification: false` in 4 checks), and the browser asked for it as `preferred`. Fixed on 2026-11-26: one server verifier refuses a missing UV flag with `user_verification_required` in every passkey check, and the browser asks for `required` | `packages/wallet-server/src/core/authService/webauthn.ts` (`verifyPasskeyAssertion`, `verifyWebAuthnRegistrationCredentialForIntent`) | 1 |
| Email OTP codes were stored in plaintext. Fixed on 2026-11-18 by Refactor 252 Slice 1: the server stores each code encrypted | `d1EmailOtpChallengeVerifier.ts:346` | 3 |
| Slice 2: the host event of the auth menu gets nothing from the link view, and nothing from the recovery view before `sign_in_ready` (for example a failed Google step). This breaks the integrator contract of Fact F16. Slice 2 corrected the Slice 0 claim about Google views: they send the raw text today. Their `status.message` branch would send the shown sentence, but no flow reaches it | `auth-menu/session.ts:532-549` | 7, 8 |
| Slice 2: the passkey button ignores the app's `passkeyCta` copy. It shows a fixed label for each mode, and the passkey view's `ctaLabel` is never rendered | `host/ui/auth-menu/AuthMenuSurface.tsx:1022` | 7 |
| Slice 2: a substring match maps `otp_locked_out` and `otp_attempts_exhausted` to `email_otp_invalid_code` | `googleEmailOtpWalletAuthFlow.ts:209` | 8 |
| Slice 2: a lockout or a rate limit that reaches the Google flow as a message only gives `unlock_failed`, because the Email OTP worker drops the server code. A valid code with no local signing session also gives `unlock_failed` | `googleEmailOtpWalletAuthFlow.ts:211-214,605`, `workers/email-otp/fetch.ts:44` | 8 |
| Slice 2: public codes that no code produces: `local_signing_session_not_ready`, `wallet_iframe_unavailable` and `flow_cancelled` (8.6), and `ACCOUNT_NOT_OWNED`, `AUTHORIZATION_TIMEOUT` and `INSUFFICIENT_BALANCE` (8.7) | `publicApi/types.ts:585`, `core/types/linkDevice.ts:59` | 8 |
| Slice 2: the V1 writers of the D1 method table (`put`, `preparePasskeyRegistrationStatements`) have no caller, and migration 0084 refuses the rows that they build | `wallet-server/src/core/d1WalletAuthMethodStore.ts:788,802` | 3 |
| Server messages, signer codes and the VoiceID mismatch text show in English under `ja` | `packages/wallet/src/core/ui/messages.ts:1171` | 8 |
| Dead code: 7 `lane_*` D1 tables, the `PasskeyErrorCode` enum, `shared-ts/src/index.ts`, and 7 Gateway environment fields | Areas 3, 8, 9 | 3, 8, 9 |

## What Slice 2 writes first

These behaviours had no test before Slice 2. The conformance suite needs them before any new
code replaces the old code.

**Done on 2026-11-18** in `tests/conformance/` (paths below are in that folder; its README says how
to run it). Each item has a check:

- **Integrator contracts (F16)** (rows 7.7, 7.8, 7.9, 8.2):
  `ui/authMenuIntegratorContracts.browser.test.ts` (the card radius, the copy and the host event,
  through the real wallet iframe), `ui/authMenuCopy.unit.test.ts` and
  `ui/authMenuErrorReports.unit.test.ts`.
- **Methods in the account menu** (7.10): `ui/authenticationMethods.browser.test.ts`. **The
  auth-menu outcome codes** (8.1): `ui/authMenuOutcomes.unit.test.ts`.
- **Key and scope refusals** (10.2, 10.3, 10.4, 10.10): `routes/projectKeys.test.ts`.
- **Stored records** (area 3):
  - `records/d1AuthRecords.test.ts`: `d1WebAuthnRecords.ts`, `d1VersionedJsonRecordStore.ts`, and
    the D1 method, authenticator, credential binding, challenge and Email OTP enrollment rows.
  - `records/linkedSignerMaterial.test.ts`: `linkedAuthoritySignerMaterial.ts`.
  - `records/indexedDbRecords.test.ts`: the VoiceID device record, the NEAR profile pivot, the V1
    and V2 method rows, the selection, and the VoiceID enrollment and availability records.
  - The fixtures are in `records/fixtures/`. Today's writers make them;
    `SEAMS_CONFORMANCE_WRITE_FIXTURES=1` writes them again.
- **Ceremonies** (1.1, 1.2, 1.3, 1.5): `ceremonies/webauthnServerChecks.test.ts`,
  `ceremonies/webauthnOptionBuilders.test.ts` and `ceremonies/prfSalts.test.ts`.
- **Routes** (6.3, 6.12, 6.15, 6.16, 6.17, and the routes of U3 that seams-monorepo uses):
  `routes/identityRoutes.test.ts`, `routes/custodyCredentialRoutes.test.ts`,
  `routes/syncAndMetadataRoutes.test.ts`, `routes/stepUpFactors.test.ts`,
  `routes/loginRoutes.test.ts` (6.1, 6.2), `routes/emailOtpChallengeRoutes.test.ts` and
  `routes/routeTable.test.ts`.
- **Error codes** (8.5, 8.6, 8.7): `errors/signerBoundaryCodes.test.ts`,
  `errors/googleEmailOtpCodes.test.ts` and `errors/deviceLinkingCodes.test.ts`.
- **Journeys** (Section 2 of the plan): `journeys/journeys.ts` holds 12 journeys as steps of the
  driver in `journeys/driver.ts`. `journeys/seamsWebDriver.ts` runs them with today's API through
  the intended-behaviour harness. `journeys/passkey.journeys.contract.test.ts` and
  `journeys/email-otp.journeys.contract.test.ts` define the tests.

Result against `dev` on 2026-11-18: the 120 fast checks give 114 passes and 6 expected failures.
The 12 journeys pass, each on a fresh local Wallet system.

**Expected failures.** Each one calls `expectKnownFault` with its row. Playwright reports the
check as failed when the fault is fixed, so the fix removes the marker.

| Row | Fault | Check |
| --- | --- | --- |
| 7.8 | The passkey button ignores the app's `passkeyCta` | `ui/authMenuIntegratorContracts.browser.test.ts` |
| 8.2 | The link view sends no host event | `ui/authMenuIntegratorContracts.browser.test.ts` |
| 8.2 | A failed Google step in recovery sends no host event | `ui/authMenuErrorReports.unit.test.ts` |
| 8.6 | `otp_locked_out` and `otp_attempts_exhausted` give `email_otp_invalid_code` | `errors/googleEmailOtpCodes.test.ts` |
| 8.6 | A lockout or rate limit that arrives as a message only gives `unlock_failed` | `errors/googleEmailOtpCodes.test.ts` |
| 8.6 | A valid code with no local signing session gives `unlock_failed` | `errors/googleEmailOtpCodes.test.ts` |

**Not covered, and why:**

- The three server-side WebAuthn option builders (`d1LinkedDeviceTargetPlanner.ts:259`,
  `d1WalletAuthMethodService.ts:2503` and the recovery builder in `d1PasskeyCustodyRouteService.ts`)
  and the add-passkey registration check (`d1WalletAuthMethodService.ts:2754`) are private. The
  journeys run them: registration, add a passkey, device linking and recovery.
- `voiceid-activation-v1` holds an envelope that only the WASM ceremony makes;
  `ib/voiceid-activation.contract.test.ts` covers it. The CryptoKeys of the VoiceID device record
  cannot go into a JSON file, so its fixture describes the record. A reader in new code must run
  today's writer in the same origin.
- `failureCodeForError` in `HostedSeamsAuthMenu/shell.tsx` is private to the React component.
- The journeys use a passkey for sign-in on an empty browser, device linking and recovery. The
  VoiceID journeys stay in the VoiceID contracts, which need audio fixtures. Google recovery is not
  a journey, because Refactor 252 removes it.
- No route check covers the Email OTP release (`/wallet/email-otp/factor-release`,
  `/wallet/email-otp/registration/seal`, the device-link base factor and the Google recovery
  release), because Refactor 252 changes it. The journeys and the stored enrollment rows check
  Email OTP, and no check requires that the server keeps the sealed factor.
- The Firefox and WebKit projects do not run the conformance UI checks.

## The package entries

Today's three packages have 37 entries: 16 of `@seams/wallet`, 16 of `@seams/wallet-server`
and 5 of `@seams/voiceid`. The table maps each one to a path of the six packages (D24).

Rules of the map:

- Release A changes the package name, not the path name, where the six-package rule allows it.
  A root path (`.`) is not allowed, so each root entry gets a named path.
- Release A has no change in behaviour. A path that only re-exports goes into the path of its
  package when the bundle check shows no growth for an app that does not use it.
- Release B moves the auth parts to `@seams/auth`.
- "Importers" counts the import lines in seams-monorepo and in this repository (examples,
  apps, tests) on 2026-11-18. A `package.json` dependency line is not counted.

### `@seams/wallet`

| Entry today | What it holds | Release A | Release B | Importers |
| --- | --- | --- | --- | --- |
| `.` | `SeamsWeb`, the page API | `@seams/mpc-wallet/client` | Auth parts to `@seams/auth/client` | 56 |
| `./advanced` | NEAR and EVM RPC clients (re-exports, 56 lines) | `@seams/mpc-wallet/client` | Same | 32 |
| `./threshold` | Session policy and PRF salt (re-exports, 12 lines) | `@seams/mpc-wallet/client` | The PRF salt to `@seams/auth/client` | 3, tests only |
| `./runtime` | `SigningRuntime` types (22 lines) | `@seams/mpc-wallet/client` | Same | 3, tests only |
| `./react` | React components and hooks | `@seams/mpc-wallet/react` | Auth components to `@seams/auth/react` | 116 |
| `./react/profile` | `AccountMenuButton` | `@seams/mpc-wallet/react` | `@seams/auth/react` | 10 |
| `./react/hosted-seams-auth-menu` | The hosted auth menu | `@seams/mpc-wallet/react` | `@seams/auth/react` | 2 |
| `./react/provider` | `SeamsWebProvider` | `@seams/mpc-wallet/react` | Same | 3 |
| `./react/styles` | CSS | `@seams/mpc-wallet/styles.css` | Also `@seams/auth/styles.css` | 26 |
| `./external-evm` | EVM wallet connectors | `@seams/wallet-connect/client` | Same | 0 |
| `./external-near` | NEAR wallet connectors | `@seams/wallet-connect/client` | Same | 7 |
| `./react/external-evm` | React bindings of the EVM connectors | `@seams/wallet-connect/react` | Same | 0 |
| `./react/external-near` | React bindings of the NEAR connectors | `@seams/wallet-connect/react` | Same | 3 |
| `./web/wallet-iframe-client-html` | The HTML document of the wallet origin | `@seams/host/wallet-origin-html` | The account origin document | 0 |
| `./voiceid-host` | The host contract of an auth-method plugin | `@seams/mpc-wallet/voiceid` | The plugin contract of `@seams/auth/client` | 6 |
| `./package.json` | | Kept in each package | | |

### `@seams/wallet-server`

| Entry today | What it holds | Release A | Release B | Importers |
| --- | --- | --- | --- | --- |
| `.` | Server types, config and the authorization domain | `@seams/host/server-types` | Split by owner | 0 |
| `./cloud-host` | The services that seams-monorepo builds its Workers from | `@seams/host/cloud-host` | Same | 411 |
| `./hosted-wallet-gateway` | The Wallet Gateway | `@seams/host/hosted-wallet-gateway` | Same | 5 |
| `./hosted-wallet-gateway-worker` | Its Worker entry | `@seams/host/hosted-wallet-gateway-worker` | Same | 0 |
| `./local-hosted-wallet-gateway-worker` | The local Worker entry | `@seams/host/local-hosted-wallet-gateway-worker` | Same | 0 |
| `./router/cloudflare` | The router roles on Cloudflare | `@seams/host/router/cloudflare` | Same | 1 |
| `./router/ror` | The router roles on another runtime | `@seams/host/router/ror` | Same | 1 |
| `./storage/tenant-route` | Tenant route storage | `@seams/host/storage/tenant-route` | Same | 0 |
| `./tenant-root` | Tenant root records | `@seams/host/tenant-root` | Same | 4 |
| `./wasm/signer` | The signer WASM | `@seams/host/wasm/signer` | Same | 1 |
| `./artifact-manifest.json` | The build manifest | `@seams/host/artifact-manifest.json` | Same | 4 |
| `./migrations/d1-signer/*` | 89 D1 migrations | `@seams/host/migrations/d1-signer/*` | Auth tables move to the Auth Worker | 2 |
| `./local-runtime` | Local runtime setup | `@seams/host/local-runtime` | Same | 3 |
| `./local-runtime/*` | Local runtime scripts | `@seams/host/local-runtime/*` | Same | 3 |
| `./application-auth` | `createApplicationAuthAssertion` for an app backend | `@seams/mpc-wallet/server` | `@seams/auth/server` | 1 |
| `./package.json` | | Kept | | |

seams-monorepo also reads five `cloudflare-router-ab/wrangler.*.toml` files from the package by
file path, not by an entry. They move with `@seams/host`, and Release A changes those paths.
It also compares the package name `@seams/wallet-server` in `scripts/deploy-backend.mjs` and
`tests/helpers/walletServerCandidate.ts`. Release A changes these names too.

### `@seams/voiceid`

| Entry today | What it holds | Release A | Release B | Importers |
| --- | --- | --- | --- | --- |
| `.` | `voiceIdAuthMethod` | `@seams/mpc-wallet/voiceid` | `voiceId()` in `@seams/auth/client` | 0 |
| `./react` | `VoiceAssistantCard`, `VoiceBeam` | `@seams/mpc-wallet/react` | `@seams/auth/react` | 0 |
| `./styles` | The card CSS | `@seams/mpc-wallet/styles.css` | `@seams/auth/styles.css` | 0 |
| `./hosting` | The hosting code and the models | `@seams/host/voiceid` | Same | 1 |
| `./package.json` | | Kept | | |

Result: Release A publishes 5 paths of `@seams/mpc-wallet` (`/client`, `/react`, `/server`,
`/voiceid`, `/styles.css`), 2 of `@seams/wallet-connect`, 16 of `@seams/host` and the CLI.
Release B removes `/voiceid` from the MPC wallet.

Slice 1 built this map on 2026-11-27. The bundle check: Rolldown and esbuild show no growth for
an app that does not use a merged entry; Bun does (see Slice 1 in the plan).

Entries with no importer in either repository: the wallet-server root, the two Worker entries,
`storage/tenant-route`, `external-evm` and its React path, `wallet-iframe-client-html`, and the
VoiceID root, React and styles entries. Apps reach VoiceID through `@seams/wallet/voiceid-host`
(inferred). Self-hosters can import these entries, so Release A keeps them. The audit of Slice 8
checks each one again.

## U2: stored records, secrets and routes by owner

### IndexedDB

There is one database, `seams_wallet`, at version 24, with 24 stores
(`packages/wallet/src/core/indexedDB/schemaNames.ts`). `packages/voiceid` and
`packages/shared-ts` store nothing. VoiceID data is in the wallet's `app_state` store. The
manager puts `wallet_auth_methods` in the same write group as the wallet-authority stores
(`seamsWalletDB/manager.ts:66-73`).

| Store | One record holds | Owner after the split |
| --- | --- | --- |
| `wallet_auth_methods` | Method rows in two shapes: V1 (passkey authenticator or email hash) and V2 (passkey, Email OTP or VoiceID, with the verified email) | auth. The wallet ID, authority ID and signer slot stay as references |
| `wallets` | The profile: passkey credential, `rp_id`, preferences, NEAR provisioning, signer slot | split: the credential and `rp_id` go to auth, the NEAR state and the signer slot to the wallet |
| `wallet_selections` | The selected method and the lock state | split: the method goes to auth, the lock generation to the wallet |
| `app_state` | Key-value records | per key, below |
| `wallet_authorities`, `wallet_authority_signer_materials`, `wallet_authority_export_roots`, `wallet_authority_installation_receipts`, `key_material` | Authority, sealed MPC material, export roots, install receipts, key shares | wallet. A method ID is an opaque reference |
| `signing_session_seals`, `signing_session_restore_leases`, `wallet_session_authorizations` | Warm sessions and Wallet Sessions | wallet |
| `wallet_signers`, `near_accounts`, `signer_ops_outbox`, `nonce_lane_leases`, `nonce_lane_locks`, six `ecdsa_*` stores, `email_otp_pending_recovery_code_backups` | Signers, NEAR, nonces, ECDSA state, pending backups | wallet |

The `app_state` keys:

- **Auth:** the VoiceID template (`voiceid-browser-enrollment-v1` and `-v2`), the microphone
  choice, and the enabled flag of a method on this device.
- **Auth, with a factor secret for the sink:** `voiceid-browser-device-v1`. It holds the VoiceID
  device key and a wrapped 32-byte factor secret. The AAD names `location.origin`, the wallet
  ID, the method ID and the device key ID.
- **Boundary:** `voiceid-activation-v1`, a pending VoiceID method before its envelope exists.
- **Wallet:** the profile state, the pending registration and recovery commits, the Ed25519
  capabilities, the device-linking resume records and the ECDSA ready records.

### D1

The Gateway's `SIGNER_DB` has 88 tables after migration 0089. 57 more names were created and
later dropped or renamed. No table holds an account without a wallet (Fact F5).

| Owner | Tables | Purpose |
| --- | --- | --- |
| auth | `webauthn_authenticators`, `webauthn_challenges`, `identity_links`, `email_otp_challenges`, `email_otp_auth_states`, `email_otp_rate_limits`, `email_otp_registration_attempts`, `wallet_email_otp_rate_limits`, `external_auth_attempts`, `external_auth_rate_limits` | Passkey keys and counters, OIDC links, email codes and limits, handoff attempts |
| split | `wallet_auth_methods`, `webauthn_credential_bindings`, `email_otp_wallet_enrollments`, `external_auth_associations`, `wallet_auth_method_revocation_replays`, `registration_passkey_claims`, `registration_ceremony_records`, `wallet_registration_directory_publications`, `registration_setup_rate_limits`, `voiceid_wallet_session_challenges`, `linked_device_target_credentials` | A method and the wallet that it unlocks; registration of a wallet with its first method |
| boundary | `email_otp_grants`, `email_otp_unlock_challenges`, `linked_device_email_otp_grants`, `verified_owner_proof_consumptions` | A proof that a wallet operation consumes |
| wallet | `wallets`, `wallet_signers`, `wallet_authorities`, recovery locators, Wallet Session tables, `authorized_operations`, signing credit, Router A/B records (which also hold the custody envelopes), 10 `linked_device_*` tables, 15 `wallet_relocation_*` tables, `speak_to_sign_voice_verdicts` | Wallets, sessions, operations, MPC state, device linking, relocation |
| wallet, probably dead | 7 `lane_*` tables | No reader. Only migration 0013 joins them |
| host | `vault_proxy_secrets`, `deployment_resource_challenges`, `regional_deployment_admissions`, `regional_deployment_write_checks` | Operator vault and deployment admission |

The router roles keep their own storage: Durable Objects, the Signing Worker's D1, the Derivers'
D1 and R2, and a Postgres role store. All of it belongs to the wallet.

### Secrets, variables and bindings

| Owner | Names |
| --- | --- |
| auth | `SESSION_COOKIE_NAME`, `GOOGLE_OIDC_CLIENT_ID`, `GITHUB_OAUTH_*`, `EMAIL_OTP_DELIVERY_MODE` and the other Email OTP delivery and limit variables, the email provider (a dependency) |
| wallet | `SIGNING_SESSION_SEAL_*`, `EMAIL_OTP_SERVER_SEAL_ACCEPTED_WARM_KEY_VERSIONS` and the Email OTP seal root secret, `ROUTER_AB_*`, `SIGNING_WORKER_ID`, `RELAYER_*`, `NEAR_RPC_URL`, the router-role keys, `LINKED_DEVICE_TARGET_DESCRIPTOR_HMAC_SECRET`, `SPEAK_TO_SIGN_*` |
| host | `WALLET_CONSOLE`, `SEAMS_TENANT_STORAGE_NAMESPACE`, `SEAMS_STAGING_*_ID`, `WALLET_LOCAL_DEPLOYMENT_JSON`, `RELAY_CORS_ORIGINS`, `HOSTED_WALLET_ORIGINS` |
| split | `SIGNER_DB` (all 88 tables), `LINKED_DEVICE_WEBAUTHN_RP_ID` (the RP ID is auth, D6) |

- No login-token key and no login JWKS exist today. The Auth Worker needs new ones (D8).
- The trusted application issuers have no variable. The project configuration gives them, with a
  trust revision.
- The Gateway's environment type declares fields that no wallet-server code reads:
  `RELAY_SESSION_*`, `ARC_RPC_URL`, `EMAIL_OTP_PROVIDER`, `EMAIL_OTP_FROM_ADDRESS`,
  `RESEND_API_KEY` and `EMAIL_OTP_SES_*`. seams-monorepo sets some of them for its own code.
  Check it before you delete a field.

### Server routes by owner

The route table is in `packages/wallet-server/src/router/framework/routeDefinitions.ts`, in
`routes/externalAuth.ts` and in the route extensions. Owners after the split are inferred from
Sections 3 to 6.

| Family | Paths | Owner after the split |
| --- | --- | --- |
| Passkey login | `/auth/passkey/{options,verify}` | **Auth Worker** |
| Google and GitHub | `/auth/google/{options,verify}`, `/auth/github/options`, `/auth/identities`, `/auth/link`, `/auth/unlink` | **Auth Worker**. `register_started` reserves a wallet ID, so it calls the wallet |
| Application auth | `/wallet/external-auth/*` | **Auth Worker**. The owner actions (associate, unlink) are split: the record goes to auth, the owner proof to the wallet |
| Email OTP | `/wallet/email-otp/challenge`, `/wallet/email-otp/dev/otp-outbox`, the send part of three more challenge routes | **Auth Worker** |
| Email OTP release | `/wallet/email-otp/factor-release`, `/wallet/email-otp/registration/seal` | Wallet Gateway (U4) |
| WebAuthn metadata | `/.well-known/webauthn`, `/webauthn/authenticators` | **Auth Worker** |
| Sync account | `/sync-account/{options,verify}` | Split: discovery goes to auth, the Wallet Session stays |
| Methods and custody | `/wallets/:walletId/auth-methods/*`, `/wallets/:walletId/custody/*`, `/wallets/custody/envelope`, `/wallet/voiceid/*` | Split: the method half and the credential list go to auth; envelopes and pinned keys stay |
| Unlock and sessions | `/wallet/unlock/*`, `/wallet/session/*`, `/router-ab/wallet-session/ed25519` | Wallet Gateway (D7) |
| Registration | `/wallets/register/*`, `/wallets/:walletId/signers/*`, `/router-ab/ed25519/yao/registration/*` | Wallet Gateway; the first method goes to auth |
| Device linking | `/wallet/device-linking/v1/*` | Wallet Gateway; the email send and the target method go to auth |
| Recovery | `/wallets/recovery/*`, `/wallets/:walletId/recovery/status` | Wallet Gateway; the Google and email proofs become auth proofs for the audience `wallet` |
| Signing | `/router-ab/*`, `/wallet/execution-lane/owner`, `/vault/proxy-use` | Wallet Gateway; step-up goes through `auth.prove` |
| Speak-to-Sign | `/speak-to-sign/v1/{verify,summary}` | Wallet Gateway (VoiceID plugin) |
| Project keys and Console | The Console binding, `/v1/wallets*`, `/signed-delegate`, `/sponsorships/evm/call`, placement and relocation routes | Key checks go to `host` for both Workers (D19). The Auth Worker also reads the project environments, which carry the trusted issuers |

### The iframe messages that carry auth work

The message types are in `wallet/src/SeamsWeb/walletIframe/shared/messages.ts`, protocol
version `25.0.0`.

| Owner after the split | Messages |
| --- | --- |
| auth | `PM_OPEN_AUTH_MENU`, `PM_CANCEL_AUTH_MENU`, `AUTH_MENU_EXTERNAL_AUTH_REQUEST`, `PM_RESOLVE_AUTH_MENU_EXTERNAL_AUTH`, `AUTH_MENU_ERROR`, `PM_EXTERNAL_AUTH`, `PM_ADD_PASSKEY`, `PM_ADD_EMAIL_OTP`, `PM_GET_AUTH_METHOD_AVAILABILITY`, `PM_SET_AUTH_METHOD_ENABLED`, `PM_REVOKE_AUTH_METHOD` (with the wallet's removal check), `PM_HAS_PASSKEY`, `PM_REQUEST_EMAIL_OTP_CHALLENGE`, `PM_REQUEST_WALLET_CUSTODY_EMAIL_OTP_CHALLENGE`, `PM_BEGIN_GOOGLE_EMAIL_OTP_WALLET_AUTH` and its resend, submit and cancel |
| boundary | `PM_UNLOCK_AUTH_METHOD` (VoiceID unlock uses it too), `PM_EXTERNAL_OWNER_AUTH`, `PM_ACTIVATE_AUTH_METHOD`, `PM_DEVICE_LINK_TARGET_FACTOR_ACTION`, `PM_DEVICE_LINK_EMAIL_OTP_BASE_FACTOR_ACTION`, `PM_SYNC_ACCOUNT_FLOW` |
| wallet | `PM_UNLOCK`, `PM_LOCK`, `PM_GET_WALLET_SESSION` and the session reads, `SESSION_CHANGED`, `PM_REDEEM_HOSTED_WALLET_SEAMS_SESSION`, `PM_REGISTER_WALLET`, the Google Email OTP reroll and complete, the device-linking flow messages, `PM_SPEAK_TO_SIGN_ENROLL` |
| wallet-connect | `PM_RESOLVE_WALLET_CONNECTION`, `WALLET_CONNECTION_REQUEST` |

Auth needs one new event for a login-session change. `SESSION_CHANGED` stays with the wallet.

### What Google and the application handoff give today

| Path | Gives |
| --- | --- |
| `/auth/google/verify` | A wallet lookup and an email address. Access comes only after the Email OTP code |
| `/auth/link` | An identity mapping. It needs a full-owner Wallet Session and a passkey step-up |
| `/wallet/external-auth/exchange`, `redeem`, `settings` | Settings access only (`external_authenticated`). No path mints a Wallet Session |
| `createApplicationAuthAssertion` | An EdDSA JWT (`iss`, `sub`, `aud=seams:external-auth:<envId>`, at most 120 s) that the app backend posts to `backend-exchange` with a secret key. The same settings access. With `associate` and an owner proof, it links the app identity |

## U3: seams-monorepo and the routes that move

seams-monorepo registers no route extension on a route that moves. Two mechanisms of its Console
Gateway extend these routes:

1. **Regional dispatch.** `wallet-console-server-ts/src/walletPlacement/authenticationDispatch.ts`
   and `regionalDispatch.ts` find the wallet's home region and forward
   `/auth/passkey/{options,verify}`, `/auth/google/verify`, `/sync-account/*`,
   `/wallet/external-auth/*` and `/wallet/email-otp/{challenge,dev/otp-outbox}`. The dispatch
   checks the Google ID token itself and maps `wallet:google:<sub>` to a wallet.
2. **Injected stores.** `router/cloudflare/d1GatewayWorker.ts` calls
   `handleSplitGatewayRequest` of `@seams/wallet-server/hosted-wallet-gateway` with
   `identityStore`, `credentialClaims`, `syncChallenges`, `googleRegistrationAttempts` and
   `emailOtpDeliveryProvider`. These back `/auth/google/verify`, `/auth/link`, `/auth/unlink`,
   `/auth/identities`, `/auth/passkey/*`, `/sync-account/*` and the Email OTP send (SES and
   Resend adapters in `email/otp/*`).

Also:

- `PUT /console/environments/:id/external-auth` stores the trusted issuers and the Google client
  for each environment. The Auth Worker reads them.
- The apps call `/auth/google/options` and `/.well-known/webauthn`, and the local dev Worker
  routes `/auth/*` to the wallet-server router. These are callers, not extensions.
- Not checked: whether Wallet Session routing (`walletPlacement/sessionLocators.ts`) proxies
  `/auth/link`, `/auth/unlink` and `/auth/identities`.

**Answer.** The Auth Worker needs a home-region lookup that is not a wallet lookup, or the
Console dispatch keeps calling a wallet lookup for auth routes. Slice 5 decides this with the
owner of seams-monorepo, and Release B changes both repositories in one coordinated commit. The
four seams-monorepo tests on this path are `regional-authentication-routing.scenario.mjs`,
`regional-session-routing.e2e.mjs`, `account-worker-composition.e2e.test.ts` and
`walletConsoleServiceBinding.unit.test.ts`.

## The audit table

Section 7 of the plan defines the columns. Two columns are left out here:

- **Old code to delete.** When a row closes, its old code is deleted, unless the row says that
  the code moves or stays.
- **Lines now** counts the files that belong mainly to the row. A file that serves several rows
  is counted once, and the other rows say "shared".

The owner names are: auth, wallet, wallet-connect, host, frame kit, boundary (`auth.prove` and
the secret sink) and split (part to auth, part to the wallet).

### Area 1: Ceremonies

`w/` is `packages/wallet/src/`, `se/` is `packages/wallet/src/core/signingEngine/`, `ws/` is
`packages/wallet-server/src/`, `sh/` is `packages/shared-ts/src/`, `vid/` is
`packages/voiceid/src/`, `ib/` is `tests/e2e/intended-behaviours/`.

Facts:

- The browser calls `navigator.credentials` in 5 places. Only one goes through
  `webAuthnPromptCoordinator`.
- The server has 2 assertion checks and 2 registration checks. Each one sets
  `requireUserVerification: false`, and the browser asks for user verification as `preferred`.
  The VoiceID owner confirmation is a third assertion check, in the browser, and it requires user
  verification. (Fixed on 2026-11-26. See "Findings for the owner".)
- The server parses no COSE key. `@simplewebauthn/server` 13.2.2 does it.

| # | Touch point | Old code | Old test | New owner | Compatibility check | Lines now | Bloat found |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| 1.1 | Passkey registration: options, `credentials.create`, the attestation check | `se/stepUpConfirmation/passkeyPrompt/touchIdPrompt.ts`, `webauthnPromptCoordinator.ts`, `se/webauthnAuth/walletOriginWebAuthn.ts`, `credentials/helpers.ts`, `registrationAuthority.ts`, `deviceLinkingTargetCredential.ts` | `ib/passkey.registration*.contract.test.ts`, `tests/e2e/registration-credential-reservation.e2e.mjs`. No unit test of the builders or verifiers | auth | Registration with a PRF virtual authenticator; D1 and IndexedDB method-row fixtures | 1,691 | 4 option builders with 3 `rp.name` values; `loadSimpleWebAuthnServer` 3 times |
| 1.2 | Passkey assertion (sign-in, unlock, sync) and the server check | Browser: `touchIdPrompt.ts`, `collectAuthenticationCredentialForChallengeB64u.ts`, `loginAssertion.ts`, `exactPasskeyAuthority.ts`, `sourcePasskeyProof.ts`, `auth-menu/passkey.ts`. Server: `ws/core/authService/webauthn*.ts` (4 files), `webAuthnCredentialCodecs.ts`, `d1WebAuthnAuthService.ts` | `ib/passkey.unlock.contract.test.ts`, `ib/passkey-browser-security.ts`. No test imports `webauthn.ts` | auth: a pure check that the Wallet Gateway also calls, against the pinned key | Sign-in, unlock and sync; the counter update | 2,744 | 2 assertion checks; the clientData parser twice; local record and `errorMessage` copies |
| 1.3 | PRF extension: salts, request, extraction | `sh/utils/signingSessionSeal.ts:38-46`, `credentialExtensions.ts`, `se/threshold/crypto/prfSalts.ts`, `threshold/crypto/webauthn.ts` | No direct test | boundary: auth asks for PRF only with a secret sink | A byte fixture of both salts; unlock of an old passkey and envelope | 74 | The salts reach callers in 3 ways. `prfSalts.ts` is public through `@seams/wallet/threshold` |
| 1.4 | RP ID | `walletIframe/shared/configuration.ts:19`, `touchIdPrompt.ts:23`, two server host checks | `tests/unit/configs.walletRpId.unit.test.ts` | auth | D6: each stored `rp_id` equals the new value in staging and production | shared | `requireWebAuthnRpId`, `requireRpId` and the RP ID parser each defined twice |
| 1.5 | Credential IDs and user handles | The user handle is the bytes of `walletId`, built 3 times on the server; a browser fallback adds a suffix | No direct test | auth | `user.id` stays the `walletId` bytes for migrated accounts (`account_id` equals `wallet_id`) | 58 | 3 copies; 2 rules for the user ID |
| 1.6 | COSE key parser | `crates/signer-core/src/webauthn_p256.rs:249`, `wasm/evm_crypto/src/cose.rs` | 3 Rust tests | wallet (chain signing); not auth code | - | 472 (Rust) | - |
| 1.7 | VoiceID owner confirmation by passkey | `w/core/authMethods/voiceId/ownerConfirmation.ts` | `ib/passkey.voiceid-ui.contract.test.ts` | auth (`prove` with a passkey) | Add or remove VoiceID while a passkey unlocks | 402 | A third assertion check, outside the coordinator |
| 1.8 | VoiceID capture, enrollment and check (plugin) | `vid/**` (23 files), `w/voiceid-host.ts` | 7 VoiceID behaviours, 3 type checks | auth (VoiceID module, moves) | Enrollment and unlock; `VOICE_ID_HOST_API_VERSION` 11 | 3,550 | `voiceid-host.ts` re-exports UI parts and helpers |
| 1.9 | VoiceID in the wallet core: device keys, template, activation, plugin host | `w/core/authMethods/voiceId/*` (11 files), `hostPlugin.ts`, `hostRegistry.ts`, `plugins.ts`, `availability*.ts` | Shared with 1.8 | auth; `prepareActivation` and `prepareUnlock` are the boundary | Device-key and template fixtures; activation | 2,241 | 4 exports used only in their file; 1 test-only |
| 1.10 | VoiceID device proof check | `ws/authorization/voiceIdDeviceProof.ts`, `sh/authorization/voiceIdDeviceAssertion.ts` | `ib/voiceid-device-proof.contract.test.ts` | auth (reviewed move) | Byte fixtures of the challenge and statement; old signatures verify | 490 | Test-only and file-only exports |

Area 1: 70 source files with 11,722 lines (472 of them Rust), and 22 test files with 6,120 lines.

- New code replaces rows 1.1 to 1.5, 1.7 and 1.9: **7,210 lines. Budget: under 7,210.** Row
  1.8 moves, row 1.10 is a reviewed move, and row 1.6 stays with the wallet.

**Reviewed-move candidates (Section 2):**

| File | Lines | Verdict |
| --- | ---: | --- |
| `ws/authorization/voiceIdDeviceProof.ts` with `sh/authorization/voiceIdDeviceAssertion.ts` | 490 | Qualifies. It checks a proof, has its own test and imports only pure helpers |
| `crates/signer-core/src/webauthn_p256.rs` | 465 | Meets the rules, but it is wallet signing code. It stays |
| `ws/core/authService/webauthn.ts` with `webauthnOidcHelpers.ts` | 582 | Does not qualify: no test imports it, and it writes counters and reads `process.env`. Auth writes a new pure check |
| `ownerConfirmation.ts` (`verifyPasskeySignature`) | in 402 | Does not qualify: it imports IndexedDB and the worker context |

### Area 2: Factor secrets

**No factor secret reaches the custody worker through a port today.** Each one passes through
JavaScript outside its worker:

- The PRF result crosses the iframe main thread as the string `passkeyPrfFirstB64u`
  (`w/SeamsWeb/operations/auth/login/custodyActivation.ts`). It also opens the NEAR custody cache
  in the Yao WASM on the main thread (`se/walletCustody/openCustodyCache.ts:123`).
- The Email OTP factor key leaves the `emailOtp` worker as `factorSecret32`
  (`se/workerManager/workerTypes.ts:322,335,818`) and goes back in at
  `se/session/emailOtp/ecdsaLogin.ts:276`.
- The VoiceID factor key is decrypted for plugin code (`vid/capture/deviceBridge.ts`), against
  Section 5.

So the secret sink of Section 4 is new code.

| # | Path of a factor secret | Old code | Old test | New owner | Compatibility check | Lines now | Bloat found |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| 2.0 | Custody worker operations that take a factor | `se/workerManager/workers/wallet-custody-ceremony.worker.ts`, operations in `workerTypes.ts:1803-2095` | 3 unit tests | wallet | An old envelope opens with the old factor | 1,301 | `workerTypes.ts` 2,234 lines |
| 2.1 | Passkey unlock: the PRF opens the caches and rejoins ECDSA | `custodyActivation.ts`, `se/walletCustody/*` (7 files) | `ib/passkey.unlock`, `ib/passkey-custody-cache*.ts` | boundary (`prove` with a sink) | Unlock of a wallet from the old code | 1,631 | Repeated windows in `ecdsaLogin.ts` and `custodyRestore.ts` |
| 2.2 | Wallet creation seals the first envelope | `se/walletCustody/registrationCeremony.ts`, `ceremonyDriver.ts`, `walletRegistrationEd25519.ts` | `ib/passkey.registration*`, 1 unit test | boundary | Registration; the resume fixture | 1,380 | Test-only exports |
| 2.3 | A new method reseals the seed | `se/walletCustody/passkeyLink.ts`, `emailOtpLink.ts`, `resealedEnvelopeResult.ts` | The add-method behaviours | boundary | Each add-method journey | 485 | A fourth option builder |
| 2.4 | Device linking seals the copied export root | `deviceLinking*Ed25519ExportRoot.ts` | `ib/passkey.device-linking.contract.test.ts` | wallet and boundary | Device linking | 506 | - |
| 2.5 | Recovery-code rotation | `se/walletCustody/walletRecovery*.ts`, `operations/recovery/walletRecoveryRotation.ts` | Recovery behaviours | wallet | The recovery manifest fixture | 566 | - |
| 2.6 | Key export, with the factor for each request | `passkeyMpcExportRuntime.ts`, `passkey-mpc-export.worker.ts`, `ed25519ExportContext.ts` | `ib/passkey.ed25519-yao-local` | boundary | Export for each method | 1,875 | 14 repeated windows |
| 2.7 | The Email OTP factor key: code check, seal removal, release, worker | Server auth part: `d1/emailOtp/d1EmailOtpChallenge*.ts` and 3 files (2,486 lines). Wallet part: `emailOtpRouteHandlers.ts`, `emailOtpSeal.ts`, `d1EmailOtpServerSealRuntime.ts`, `se/workerManager/workers/email-otp/*`, `shamir3pass*` | The Email OTP behaviours, 2 unit tests | auth: the code check and delivery. wallet: the seal and release | Email OTP unlock; enrollment and challenge fixtures | 7,902 | The release has 4 callers; a second copy of the custody join |
| 2.8 | The Email OTP key crosses the main thread | `workerTypes.ts` result fields, `ecdsaLogin.ts:276` | Shared | boundary | Unlock, then the export root | shared | Plain bytes leave the worker |
| 2.9 | The VoiceID factor key | `voiceId/deviceStore.ts:140` `openBrowserVoiceFactor`, callers in `vid/capture/deviceBridge.ts` | 4 VoiceID behaviours | boundary | VoiceID unlock; the encrypted-factor fixture | 223 | Plugin code holds the factor |

Area 2: 52 source files with 15,869 lines, and 25 test files with 5,197 lines.

- New code replaces the Email OTP code check (2,486 lines) and the factor hand-off of rows 2.1 to
  2.4, 2.6, 2.8 and 2.9. **Budget: under 2,486 for the code check. The sink must have fewer
  lines than the hand-off code it removes; Slice 6 measures that code exactly.** The custody
  worker (2.0), recovery rotation (2.5) and the Email OTP seal stay with the wallet.

### Area 3: Stored records

`idb/` is `packages/wallet/src/core/indexedDB/`. `srv/` is `packages/wallet-server/src/`.
`ib/` is `tests/e2e/intended-behaviours/`.

| # | Touch point | Old code | Old test | New owner | Compatibility check | Lines now | Bloat found |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| 3.1 | One database for auth and the wallet: one version, one upgrade, one write group | `idb/schemaNames.ts`, `seamsWalletDB/schema.ts`, `manager.ts`, `unifiedIndexedDBManager.ts` and 5 files | None direct | boundary | Open a v24 database from the old code; each module reads its own stores | 2,400 | The facade (1,065 lines) only passes calls on |
| 3.2 | Method records on this device | `idb/seamsWalletDB/repositories.ts` (method parts, 1,370 lines), `passkeyClientDB.types.ts` | `tests/unit/localLoginAuthMethods.unit.test.ts` and 2 files | auth | A fixture of V1 and V2 rows of each kind and status. V2 rows are missing from 5 indexes, V1 rows from 2 | 8,760 | Two row shapes and two parser sets in one store; `repositories.ts` 8,322 lines |
| 3.3 | The profile mixes the passkey credential and NEAR state | `repositories.ts:7190-7217`, `idb/profileAccountProjection.ts`, `lastProfileState.ts` | **None** | split | A NEAR-ready profile with its passkey under the NEAR profile ID | 179 | - |
| 3.4 | Selected method and lock state | `repositories.ts` (selection), `walletOwnershipGeneration.ts` | `ib/session-restore-lock.ts` | boundary | A reload keeps the lock generation and the method | 100 | - |
| 3.5 | The enabled flag of a method on this device | `authMethods/availability.ts`, `availabilityTypes.ts` | Type check only | auth | A disabled VoiceID method stays disabled | 133 | - |
| 3.6 | The VoiceID device record | `authMethods/voiceId/deviceStore.ts`, `unlockFromDevice.ts` | None direct | auth; the factor goes through the sink | A real-browser fixture (a CryptoKey cannot be copied). The AAD binds the origin and the wallet ID, so the account origin must equal the Wallet origin (D6) and `account_id` must equal `wallet_id` | 204 | - |
| 3.7 | The VoiceID template, keyed by the wallet authority | `authMethods/voiceId/enrollmentStorage.ts`, `contracts.ts`, `microphonePreference.ts` | Type check only | auth, keyed without the authority | v1 and v2 enrollment fixtures | 564 | An auth write reads wallet stores |
| 3.8 | VoiceID activation, before the envelope exists | `authMethods/voiceId/activationStore.ts` | `ib/voiceid-activation.contract.test.ts` | boundary | Pending and active fixtures resume | 140 | A port used only by tests |
| 3.9 | Envelope copies and sealed material keyed by method | `idb/linkedAuthoritySignerMaterial.ts`, `walletCustodyEd25519MaterialRecord.ts` and 3 files, matchers in `repositories.ts` | `ib/passkey-custody-cache.ts` | wallet | Rows of each factor open after unlock through the sink | 1,075 | - |
| 3.10 | Registration, recovery and install write method rows and wallet rows in one transaction | 21 functions of `repositories.ts` (1,247 lines), `pendingWalletRegistrationCommit.ts`, `pendingWalletRecoveryCommit.ts` and 3 files | `ib/recovery-journal.ts`, the registration-resume behaviours | boundary: two writes in the order of Section 6 | Pending journals from the old code resume | 2,880 | `pendingWalletRegistrationCommit.ts` 1,298 lines |
| 3.11 | Wallet Session and warm-session rows name the method | `walletSessionAuthorizationStore.ts`, `signingSessionSeals.ts` | Type check | wallet | The sealed rows of each method restore | 1,200 | - |
| 3.12 | The D1 method table has a foreign key to `wallet_authorities` and holds the key that D7 pins | `srv/core/d1WalletAuthMethodStore.ts` and 4 files | `ib/local-gateway-database.ts` | split | Staging rows of each kind and status; the counts of migration steps 2 and 4 | 2,664 | The V1 parser in two places; a local `trimString`; DDL copied into TypeScript; 5 exports used only in their file |
| 3.13 | The passkey key and counter are in two tables | `d1/webauthn/d1WebAuthnStore.ts`, `d1WebAuthnRecords.ts`, `webAuthnD1Statements.ts`, `WebAuthnCredentialBindingStore.ts` | `tests/e2e/registration-credential-reservation.e2e.mjs` | auth; bindings to the wallet | One source for the key and the counter | 1,469 | The key and the counter are stored twice |
| 3.14 | Email OTP challenges and grants (auth) and enrollment seals (wallet) | `emailOtpD1Statements.ts`, `d1/emailOtp/*` (3 files) | The Email OTP behaviours | split; the grants are the boundary | Staging enrollment and challenge rows | 1,760 | Codes were stored in plaintext (fixed by Refactor 252 Slice 1) |
| 3.15 | The envelope server record names the method but has no public key | `d1PasskeyCustodyEnvelopeStore.ts`, `passkey-custody/*` (3 files) | Shared | wallet; credential activity to auth | The binding bytes do not change; migration step 4 adds the pinned key | 2,115 | - |
| 3.16 | Identity links and external associations that name a wallet authority | `srv/core/d1IdentityStore.ts`, `IdentityStore.ts`, `srv/auth/externalAuthStore.ts` | `tests/e2e/external-auth.e2e.mjs` | auth; the association is the boundary | A trust revision revokes the association | 943 | DDL copied into TypeScript |
| 3.17 | VoiceID server rows | `d1VoiceIdWalletSessionChallenges.ts`, `d1VoiceIdActivation.ts`, `d1VoiceVerdictLedger.ts` | Shared | wallet | A challenge is used once | 426 | - |
| 3.18 | Relocation copies auth tables and wallet tables together | `d1/wallet/authorizationSnapshotLayout.ts` and 3 files | `tests/e2e/authorization-storage-transfer.e2e.mjs` | wallet; the auth tables leave the layout | The relocation journey after the split | 694 | A test file of 2,351 lines |

Area 3: 61 source files with 27,706 lines (34 browser files with 17,635 lines, 27 server files
with 10,071 lines), and 23 test files with 6,924 lines. Not counted: the 89 migrations (14,892
lines) and 10 wallet-only IndexedDB files (6,124 lines).

`repositories.ts` (8,322 lines) splits as follows: auth 1,370, boundary 251, mixed 1,247, wallet
5,270 and imports 184.

- New code replaces the auth, boundary and mixed parts: rows 3.1 to 3.8, 3.10, 3.12 to 3.14 and
  3.16. **About 16,700 lines. Budget: under 16,700.**
- Rows 3.9, 3.11, 3.15, 3.17 and 3.18 stay with the wallet and change only their references.
- **No direct test:** the VoiceID device record, the NEAR profile pivot, `d1WebAuthnRecords.ts`,
  `linkedAuthoritySignerMaterial.ts` and `d1VersionedJsonRecordStore.ts`. Slice 2 writes
  fixtures for them first.

### Area 4: Sessions

| # | Touch point | Old code | Old test | New owner | Compatibility check | Lines now | Bloat found |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| 4.1 | The server issues a Wallet Session after a proof | `walletUnlockRouteHandlers.ts`, `routes/sessions.ts`, `ws/authorization/*` (9 files) and 2 files | `tests/unit/walletSessionBudgetGrant.unit.test.ts`, `tests/e2e/session-issuance-transaction.e2e.mjs` | wallet | D7: the proof is checked against the pinned key; a login token is refused; session-table fixtures | 7,964 | `factorEvidence.ts` repeats itself; test-only exports |
| 4.2 | The browser unlocks and installs the Wallet Session | `operations/auth/login/*` (8 files), `operations/auth/*` (6 files), `core/authMethods/installSession.ts` and 3 files, `se/session/emailOtp/*` (4 files) | `ib/passkey.unlock`, `ib/email-otp.unlock`, `router.session*.test.ts`, 3 unit tests | wallet (it calls `auth.prove`) | Unlock for each method; the session fixture | 8,239 | `ecdsaLogin.ts` 1,781 lines |
| 4.3 | VoiceID Wallet Session | `d1VoiceIdSessions.ts`, `d1VoiceIdWalletSessionChallenges.ts`, `voiceId/*`, 3 route files | Shared VoiceID behaviours | wallet; auth owns the check (1.10) | The challenge fixture; the VoiceID routes | 845 | - |
| 4.4 | The passkey warm session | `passkey-mpc-session.worker.ts`, `warmSessionPrfHandles.ts`, `PasskeyMpcSessionManager.ts`, `se/session/passkey/*` | `tests/unit/warmSessionPrfHandles.unit.test.ts` | wallet | A reload restores a warm session from an old seal record | 3,455 | The manager is in `uiConfirm/`; `signingSessionSeal.ts` mixes salts, seals and paths |
| 4.5 | Email OTP warm sessions | `email-otp/sessionState.ts` and 5 files, `se/session/emailOtp/*` (13 files) | Shared | wallet | A reload restores the Email OTP session | 5,695 | Test-only exports |
| 4.6 | Step-up: a fresh proof for each operation | `se/stepUpConfirmation/*`, `voiceId/operationProof.ts`, `exportRecovery*.ts`, `routerAbOperationStepUp.ts`, `ecdsaOperationStepUpFactor.ts` | `tests/e2e/step-up-expiry.e2e.mjs`, `ib/voiceid.key-export` | boundary (`prove` with the operation in the challenge) | Step-up for each method; Email OTP `transaction_sign` and `export_key` | 3,779 | The passkey step-up challenge is an intent digest, not a nonce bound to an audience |

Area 4: 91 source files with 29,977 lines, and 13 test files with 3,476 lines.

- New code replaces rows 4.2 and 4.6: **12,018 lines. Budget: under 12,018.** Row 4.1 changes to
  the pinned-key check. Rows 4.3 to 4.5 stay with the wallet.

### Area 5: Account changes

`W/` is `packages/wallet/src/`, `S/` is `packages/wallet-server/src/`, `T/` is
`packages/shared-ts/src/`, `ib/` is `tests/e2e/intended-behaviours/`.

Facts that change the plan:

- **The method record and the wallet are one row today.** `wallet_auth_methods` has `wallet_id`,
  a foreign key to `wallet_authorities` and the credential public key (migration 0084). Six
  server files write method records inside wallet flows (`buildWalletAuthMethodRecordV2`):
  registration, add method, device-link install, recovery finalize and Google recovery.
- **Each method add needs an unlocked wallet today**
  (`W/SeamsWeb/operations/authMethods/addAuthMethodSourceClaim.ts:53`). The "sign-in only"
  method of Section 6 is new behaviour.
- **Removal** needs a fresh proof from another active method, so the last method cannot be
  removed. The envelope is revoked in the same D1 batch. There is no subscriber call, because
  one database holds both records.
- **Device linking makes a new method on the new device**: a new WebAuthn credential or an
  Email OTP grant (`d1LinkedDeviceTargetCredentialProvider.ts`). The local method list is
  copied once (Fact F12). Section 6 now says both.
- **Open question:** after recovery with a code, the user can have no method left. Which proof
  lets auth add a method then? Row 5.14. Recommended: the wallet server signs a one-time
  "recovered" statement for auth after the recovery finalize. The owner decides (D25).

| # | Touch point | Old code | Old test | New owner | Compatibility check | Lines now | Bloat found |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| 5.1 | Wallet creation: one ceremony writes the authority, the method, the envelope and the Wallet Session | `W/SeamsWeb/operations/registration/*`, `W/core/rpcClients/relayer/walletRegistration.ts`, `S/router/cloudflare/d1/registration/*`, `S/router/domains/walletRegistration/*` and 4 files | The registration behaviours (passkey, Email OTP, NEAR), `tests/e2e/registration-*.mjs` | boundary: auth makes the account and the method; the wallet creates with `prove('wallet')` | Passkey and Email OTP registration. A record fixture: `account_id` equals `wallet_id`, one method, one envelope with a pinned key | 35,225 | Five files over 2,000 lines (`registration.ts` 6,158, `d1WalletRegistrationService.ts` 6,365, `walletRegistration.ts` 4,781, `walletRegistrationRoutes.ts` 3,152, `d1RegistrationCeremonyRecords.ts` 3,100). Local validation helpers |
| 5.2 | Add a key set or a chain (`addSigner`) | `d1WalletAddSignerService.ts`, `d1WalletAddSignerFinalizeRecord.ts` | `ib/passkey.ed25519-yao-local.contract` | wallet | Add a signer to a passkey and an Email OTP wallet; the F1 binding stays | 2,450 | `d1WalletAddSignerService.ts` 2,314 lines; a local `errorMessage` |
| 5.3 | Add a passkey: one finalize writes the method and a new envelope | `W/SeamsWeb/operations/authMethods/passkey/*`, `addAuthMethodSourceClaim.ts`, `d1WalletAuthMethodService.ts` | `ib/email-otp.add-passkey.contract`, `auth-method-addition.matrix.contract` | split | Add while unlocked and while locked ("sign-in only"); the pinned key is the credential key | 4,622 | `d1WalletAuthMethodService.ts` 3,288 lines mixes add, revoke and unlock; one transport copied in two files |
| 5.4 | Add Email OTP | `W/SeamsWeb/operations/authMethods/emailOtp/*` (4 files) | `ib/passkey.add-email-otp.contract` | split; delivery goes to auth | Add Email OTP to a passkey wallet | 594 | The same copied transport |
| 5.5 | Add VoiceID: one D1 transaction writes the device key and the envelope | `W/core/authMethods/voiceId/activation*.ts`, `d1VoiceIdActivation.ts`, `walletVoiceIdActivation.ts` | `ib/voiceid-activation.contract` | split | The device public key in the method equals the pinned key | 1,393 | Test-only exports |
| 5.6 | A first passkey while VoiceID is selected | `addAuthMethodSourceClaim.ts:65`, `addPasskey.ts:244`, `W/core/authMethods/installSession.ts` | `ib/*.voiceid-selection.contract` | split | One email proof, no extra unlock, the VoiceID session stays | 179 | - |
| 5.7 | Remove a method | `revokeAuthMethod.ts`, `d1WalletAuthMethodService.ts:2567`, the replay store, `envelopeRevocationAdmission.ts`, `S/localIntendedRevokeFault.ts` | `ib/email-otp.add-passkey.contract` | split: auth removes after each subscriber agrees | The subscriber refuses the last envelope; the replay answer is unchanged | 795 | Two revoke routes for one action; test fault code in `src` |
| 5.8 | Device linking: the owner proof on the source device | `deviceLinkingOwnerAuthorization.ts`, `requestProof.ts` and 5 files | `ib/device-link-consent-scenario.ts` | boundary: `prove('wallet')` | Link a device; a reused nonce is refused | 3,226 | 7 exports public through `cloud-host` and unused; one export twice |
| 5.9 | Device linking: the new method on the new device | `d1LinkedDeviceTarget*.ts`, `d1LinkedDeviceEmailOtp*.ts` and 2 files | `ib/passkey.device-linking.contract` | auth, proven by the source | The target method and key; the Email OTP grant is used once | 3,792 | One file of 1,829 lines |
| 5.10 | Device linking: envelope and key-set copies | `d1LinkedDeviceAuthorityInstallService.ts` and 19 files | `ib/passkey.device-linking.contract`, 2 behaviours, 3 type checks | wallet; its method writes go to auth | Link, sign, export, revoke; the copies keep the F1 binding | 10,828 | `d1LinkedDeviceAuthorityInstallService.ts` 3,821 lines; `exactRecord` copied 4 times; a 1-line shim |
| 5.11 | Device linking: the session protocol and the new device's Wallet Session | 28 files in `S/core/deviceLinking`, `d1/deviceLinking`, `T/device-linking`, `W/SeamsWeb/operations/devices` | Type checks, `qr-camera` | wallet | QR scan, session, approval, then a Wallet Session | 15,540 | `routes/deviceLinking.ts` 2,007 lines |
| 5.12 | List and revoke linked devices | `linkedDeviceManagement.ts` and 4 files | `ib/passkey.device-linking.contract` | split | Revoke a device; retry after a refused commit | 1,612 | Repeats 5.7 |
| 5.13 | Recovery codes: issue, show, rotate, back up | `T/wallet-recovery/*` and 7 files | `recovery-code-backup`, `recovery-code.*.host`, `ib/google-email-otp.rotation.contract` | wallet | Rotation; the locator rows read back | 6,220 | A local `errorMessage` |
| 5.14 | Recover with a code: the finalize writes a new passkey method and new envelopes | `W/SeamsWeb/operations/recovery/*` (6 files), `walletRecoveryFinalization.ts` and 4 files | `ib/passkey.recovery.contract` | split (D25) | Recovery; a lost finalize response; a reused code is refused | 9,594 | `routes/passkeyCustody.ts` mixes envelope and recovery routes |
| 5.15 | Recover with Google, Email OTP and a code | `d1WalletRecoveryGoogleEmailOtp*.ts`, `walletRecoveryGoogleEmailOtp.ts`, `email-otp/recovery.ts` | `ib/google-email-otp.recovery.contract` | split: auth checks Google and the code; the wallet gets the factor through the sink | Google recovery | 2,619 | A local `requireString` |
| 5.16 | Sync an account on a fresh browser | `syncAccount.ts`, `routes/syncAccount*.ts`, `syncAccountRequestValidation.ts` | `ib/passkey.unlock.contract` | split: auth `signIn`, then the wallet unlocks | One sign-in and one unlock | 2,296 | `Extract` in place of `Variant` |

Area 5: 174 source files with 100,985 lines (9 files over 2,000 lines hold 34,986), and 55 test
files with 12,197 lines.

- New code replaces the account layer of the wallet (D13) and the auth parts: rows 5.1, 5.3 to
  5.9, 5.12, 5.14 to 5.16. **About 65,900 lines. Budget: under 65,900.** Much of row 5.1 is
  chain registration that the new code keeps by a move. Slice 7 records the exact split.
- Rows 5.2, 5.10, 5.11 and 5.13 stay with the wallet.
- 31 exports are public only through `export *` barrels and unused inside. 7 are used only by
  tests.

### Area 6: Wire

`rt/` is `packages/wallet-server/src/router/transport/fetch/routes/`. `wi/` is
`packages/wallet/src/SeamsWeb/walletIframe/`. `ib/` is `tests/e2e/intended-behaviours/`.

| # | Touch point | Old code | Old test | New owner | Compatibility check | Lines now | Bloat found |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| 6.1 | Passkey login | `rt/auth.ts`, `authRequestValidation.ts` | seams-monorepo only | auth | Options and verify shapes; 503 and 409 home errors | 655 | Paths written twice |
| 6.2 | Google login for Email OTP wallets | `rt/auth.ts:223-270`, `d1GoogleEmailOtpSessionResolver.ts`, `d1/oidc/*` | `tests/unit/githubOAuth.unit.test.ts` | auth; a wallet call for `register_started` | The modes `existing_wallet`, `register_started`, `wallet_identity_mismatch` | 1,198 | Two Google client-ID sources here and a third check in seams-monorepo |
| 6.3 | Google identity list, link, unlink | `rt/auth.ts:107-195`, `d1/identity/*` | **None** | auth | Link needs a full-owner session and a step-up | 98 | - |
| 6.4 | External auth (Google exchange, app handoff) | `rt/externalAuth.ts`, `srv/auth/*` (3 files), `application-auth.ts`, `shared-ts/src/auth/externalAuth.ts` | `tests/e2e/external-auth.e2e.mjs`, `ib/application-auth.ts`, `ib/application-login.ts` | auth | Each step; 403 on a mismatch; 429; the assertion claims and its 120 s life | 1,637 | - |
| 6.5 | External owner operations | `srv/auth/externalOwnerOperations.ts`, `walletOwnerOperationAuthorization.ts` | Shared | boundary | A replay returns the stored answer | 679 | 2 exports used only in their file |
| 6.6 | Email OTP send and check | `srv/router/domains/emailOtp/*`, four challenge routes | `ib/email-otp.challenge-expiry.contract.test.ts` | auth | The challenge carries its operation; expiry, resend, lockout | 456 | Four challenge routes |
| 6.7 | Email OTP factor release and seal | `rt/sessions.ts:1161,1496`, `emailOtpRouteHandlers.ts` | Shared | wallet (U4) | Release only after a valid wallet proof | shared | - |
| 6.8 | Unlock, hosted exchange, session status | `rt/sessions.ts`, `walletUnlockRouteHandlers.ts` and 1 file | `ib/passkey.unlock`, `ib/email-otp.unlock` | wallet | Each unlock gives a Wallet Session; a login token is refused | 3,537 | `/wallet/session/status` is not in the route table; one path written in 5 browser files |
| 6.9 | VoiceID activation and device-key unlock | `rt/walletVoiceId*.ts`, `srv/router/domains/voiceId/*` | 4 VoiceID behaviours | split | The device-proof message bytes; the activation answer | 508 | Test-only exports |
| 6.10 | Registration and add signer | `rt/walletRegistration.ts`, `srv/router/domains/walletRegistration/*` | `ib/passkey.registration` | wallet; the method in auth | Setup, respond, activate; resume; the same method ID in auth | 4,136 | `walletRegistrationRoutes.ts` 3,152 lines |
| 6.11 | Method add and remove routes | `walletRegistrationRoutes.ts` | `ib/auth-method-addition.matrix` and 2 | split | Each kind; the last envelope is refused | shared | - |
| 6.12 | Custody credentials and envelopes | `rt/passkeyCustody.ts` and 8 files | **None** | wallet; the credential list goes to auth | The envelope binding | 2,606 | - |
| 6.13 | Recovery routes | `walletRecovery*.ts` (4 files) | `ib/passkey.recovery`, `ib/google-email-otp.*` | wallet; the proofs are the boundary | Each recovery step | 2,150 | - |
| 6.14 | Device-linking routes | `rt/deviceLinking*.ts`, `rt/deviceManagement.ts` | `ib/passkey.device-linking.contract.test.ts` | split | The session states; the email base factor | 3,073 | A copy of `isPlainObject` |
| 6.15 | Sync account | `rt/syncAccount*.ts`, `syncAccountRequestValidation.ts` | **None** (harness only) | split | Options and verify | 848 | - |
| 6.16 | WebAuthn metadata | `rt/wellKnown.ts:38-64`, `rt/webauthnAuthenticators.ts` | **None** | auth | The `/.well-known/webauthn` body; the authenticator list | 111 | - |
| 6.17 | Step-up on signing routes | `rt/ecdsaOperationStepUpFactor.ts`, `ed25519AuthorizedOperationRevalidation.ts` | **None** | boundary | The step-up proof becomes `auth.prove` | 421 | - |
| 6.18 | Route table and router | `routeDefinitions.ts`, `createFetchRouter.ts`, `fetchRouter.types.ts` | `tests/unit/routerCorsPreflight.unit.test.ts` | one table for each Worker | A snapshot of id, method, path and plane for each Worker | 1,758 | Handlers compare path strings |
| 6.19 | Iframe: auth menu | `wi/host/handlers/authMenu.ts`, `authMenuPresentation.ts` | `tests/wallet-iframe/auth-menu.host.integration.test.ts` | auth | Open gives an outcome; the error `detail` | 92 | - |
| 6.20 | Iframe: unlock, lock, session | `wi/host/handlers/auth.ts` and 4 files | `tests/wallet-iframe/router.session*.test.ts` | wallet | The `SESSION_CHANGED` order; lock clears | 1,100 | - |
| 6.21 | Iframe: external auth | `wi/host/externalAuth.ts`, `externalOwnerApproval.ts` | Shared | auth and boundary | `PM_EXTERNAL_AUTH` results | 869 | `Extract` in place of `Variant` |
| 6.22 | Iframe: registration and methods | `createRegistrationCommands.ts`, `registrationCommands.ts`, `handlers/near.ts` | Shared | split | The result shape of each message | 668 | `near.ts` mixes signing and method messages |
| 6.23 | Iframe: Email OTP and Google | `handlers/emailOtp.ts` and 3 files | Shared | auth; the wallet for reroll and complete | Begin, submit, complete, resend, cancel | 1,567 | `emailOtp.ts` also routes recovery-code messages |
| 6.24 | Iframe: device link and sync | `handlers/deviceLink.ts` and 3 files | Shared | split | The factor progress payloads | 717 | - |
| 6.25 | Iframe: envelope and routers | `wi/shared/messages.ts`, `wi/client/router.ts`, `wi/host/requestRouter.ts`, `inboundMessages.ts` | `tests/wallet-iframe/router.behavior`, `handshake`, `client.connection` | split (`auth.channel(pluginId)`) | The handshake version; an unknown type is refused | 7,694 | `client/router.ts` 5,036 lines |

Area 6: 85 source files with 36,578 lines, and 31 test files with 11,799 lines. The
seams-monorepo files of U3 add 20 source files with 3,544 lines.

- New code replaces the auth routes and messages and the auth halves: rows 6.1 to 6.6, 6.9,
  6.11, 6.15, 6.16, 6.19 and 6.21 to 6.23: **9,386 lines. Budget: under 9,386,** plus the auth
  part of row 6.25, which Slice 6 measures.
- seams-monorepo has two identical copies of `googleIdentity.ts` (267 lines each) in two apps.
  Report it to seams-monorepo; it is not in this plan.

### Area 7: UI

| # | Touch point | Old code | Old test | New owner | Compatibility check | Lines now | Bloat found |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| 7.1 | The hosted auth menu entry | `react/components/HostedSeamsAuthMenu/` (`shell.tsx`, `types.ts`, `public.ts`, `SeamsAuthMenuMock.tsx`) | `tests/unit/hostedSeamsAuthMenu.ssr.unit.test.ts` | auth | The export names of `public.ts` stay; SSR render; open to outcome | 834 | A local `errorMessage` copy (`shell.tsx:101`) |
| 7.2 | Wallet alternatives in the menu | `HostedSeamsAuthMenu/walletAlternatives.ts`, `WalletAlternativesSection.tsx`, `session.ts:1805-2021` | `tests/wallet-ui/wallet-connector.browser.test.ts` | wallet-connect | The picker shows EIP-6963, Phantom and NEAR, and returns the same result | 353 | - |
| 7.3 | Menu session: sign-in (passkey, Google, VoiceID, account picker) | `walletIframe/host/auth-menu/session.ts` (`AuthMenuSession`), `controller.ts`, `domain.ts`, `passkey.ts`, `account-options.ts` | `tests/wallet-ui/auth-menu.browser.test.ts`, `auth-menu.failure-status.test.ts` | auth | Journeys: sign in with each method; Back and Escape; the outcome of each mode | 5,728 | `session.ts` has 4,084 lines. A local `errorMessage` copy (`:528`) |
| 7.4 | Menu session: wallet stages (recovery, device linking, wallet creation, VoiceID unlock) | Blocks of `session.ts` (about 1,940 lines) | `tests/wallet-ui/auth-menu.surface.test.ts`, `tests/wallet-iframe/recovery-code.*.host.integration.test.ts` | wallet (plugin stages) | Journeys: recover with a code; link a device with a passkey and an Email OTP target; create a wallet | shared | One class mixes auth, wallet, recovery and connectors |
| 7.5 | Menu surface: sign-in views | `host/ui/auth-menu/AuthMenuSurface.tsx` and 7 files (CSS, icons, mount, footer, origin) | `tests/wallet-ui/auth-menu.lifecycle.test.ts` | auth | A DOM check of each view; mount under a strict CSP | 5,566 | `AuthMenuSurface.tsx` 2,020 and `auth-menu.css` 2,404 lines. Three code inputs apart from `EmailOtpInput.tsx` |
| 7.6 | Menu surface: wallet views | `AuthMenuSurface.tsx` recovery and link blocks (about 880 lines), `RecoveryOptions.tsx`, `recovery-code-input.tsx`, `linkDeviceBadge.tsx` | As 7.4 | wallet | As 7.4 | 289 | - |
| 7.7 | F16 radius (`--seams-shape-card`) | `react/components/theme/*`, `src/theme/*`, `uiConfirm/ui/appearance*.ts` | **None.** The last test went in `3d87be7fd` | frame kit | An app's token sets the card radius exactly | 1,177 | The overlay caps the radius at `2rem`; the menu does not |
| 7.8 | F16 copy (`HostedAuthMenuCopy`) | `walletIframe/shared/messages.ts:165-704` | **None** for an override | auth | The app's copy renders; unknown keys are refused | shared | `messages.ts` has 1,902 lines |
| 7.9 | F16 host event `detail` | `session.ts:1786-1805`, `client/inboundMessages.ts`, `client/router.ts:602-614` | The status keeps `detail`. The event: **none** | auth | The raw text reaches the host event once for each change | shared | The link view sends no event; the recovery view sends one only at `sign_in_ready` (Slice 2) |
| 7.10 | Methods in the account menu | `AccountMenuButton/AuthenticationMethodsModal.tsx`, `VoiceIdAvailabilityControl.tsx` | **None** | auth | List, add and remove a method; the "sign-in only" label | 959 | - |
| 7.11 | The rest of the account menu (assets, send, receive, devices, export, region, QR) | `AccountMenuButton/*` (73 files), `ShowQRCode.*`, `QRCodeScanner.*` | `tests/wallet-ui/account-settings-modal`, `asset-send*`, `tests/e2e/account-menu-mock.e2e.mjs` | wallet (moves) | A journey for each panel | 13,603 | 6 exports of `types.ts` are used only in that file |
| 7.12 | Wallet steps with Back and Close | `walletIframe/shared/walletStep.ts`, `WalletStep.tsx`, `ModalSteps.tsx`, `walletModalSteps.ts`, `surfaces.ts`, `anchoredSurface*.ts`, `anchoredCard.ts` | `tests/wallet-ui/wallet-steps.browser.test.ts` | frame kit | The step events keep their wire shape and times | 1,911 | 3 parsers used only in their file |
| 7.13 | The old overlay dialog | `client/overlay/overlay-controller.ts`, `overlay-styles.ts` | `tests/wallet-iframe/overlay-elevation.browser.test.ts` | deleted (the frame kit's stage dialog) | The stage dialog passes the same tests | 1,741 | - |
| 7.14 | Confirmation shell and its flows | `uiConfirm/*` (44 files) | `tests/wallet-ui/confirmation-mount`, `confirm-ui` | wallet (moves) | Sign in the drawer and the modal; cancel; resize | 10,246 | - |
| 7.15 | Transaction review and receipt | `ui/preact/Transaction*.tsx`, `transaction-display/*`, `react/transactionReview/*` | `tests/wallet-ui/transaction-review`, `tests/unit/transactionReview.snapshot.test.ts` | wallet (moves) | Snapshots for each chain | 6,642 | - |
| 7.16 | The email code in a confirm (step-up) | `EmailOtpContent.tsx`, `EmailOtpInput.tsx`, `email-otp-session.ts`, `email-otp.css` | `tests/wallet-ui/confirm-content.browser.test.ts` | auth (`prove`) | Step-up for `transaction_sign`; resend; a short code is refused | 592 | The fourth code input |
| 7.17 | Passkey prompt and registration confirm | `PasskeyRegistration*.tsx`, `HaloBorder.tsx`, `handlers/flows/registration.ts` and 2 files | Shared | boundary | Passkey registration, with a cancel | 1,219 | - |
| 7.18 | Export and recovery-code backup | `ExportPrivateKeySurface.tsx`, `RecoveryCodeBackupSurface.tsx` and 6 files | `tests/wallet-ui/export-*`, `recovery-code-backup` | wallet (moves) | Export a key; acknowledge a backup | 2,674 | - |
| 7.19 | The VoiceID capture card | `voiceid/src/capture/*`, `react/VoiceAssistantCard.*` | `tests/wallet-ui/voiceid-loading`, `passkey.voiceid-ui.contract.test.ts` | auth (VoiceID plugin, moves) | The sign-in and unlock cards; the loading UI stays static | 1,056 | - |

Area 7: 214 source files with 54,590 lines, and 44 test files with 13,105 lines.

- New code replaces rows 7.1, 7.3 to 7.10, 7.12, 7.13, 7.16 and 7.17: **20,016 lines. Budget:
  under 20,016.**
- Rows 7.2, 7.11, 7.14, 7.15, 7.18 and 7.19 move: 34,574 lines. A move does not grow.
- Three integrator contracts of Fact F16 have no test: the radius, the copy and the host event.
  Slice 2 writes them first.

### Area 8: Errors

| # | Touch point | Old code | Old test | New owner | Compatibility check | Lines now | Bloat found |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| 8.1 | Auth-menu outcome codes (9) | `walletIframe/shared/messages.ts:260`, a copy in `HostedSeamsAuthMenu/shell.tsx:44` | **None** | auth; `wallet_error` and `registered` go to the wallet plugin | Each outcome kind and code | 652 | The type is defined twice |
| 8.2 | The raw error in the host event `detail` | `host/auth-menu/domain.ts:96-117`, `session.ts:532-555`, `client/router.ts:602-612` | The status only; the event: **none** | auth | Event name, flags, payload and raw text for passkey, Google and recovery | 615 | **The link view sends nothing, and the recovery view sends nothing before `sign_in_ready` (Slice 2).** The event name is not exported; seams-monorepo copies it as a literal |
| 8.3 | Server route codes | 232 code literals in 118 files, no registry: 31 auth, 23 both, 178 wallet | Few | auth or wallet by route; generic codes to `host` | Code and HTTP status for each route | spread | Auth folders hold wallet codes |
| 8.4 | Wallet Session codes (8) | `T/utils/walletSessionFailure.ts` and 2 files | `tests/unit/walletSessionStatusReadScope.unit.test.ts` | wallet | Same code and status | 174 | 38 files write the codes as literals |
| 8.5 | Signer boundary codes (14) | `host/canonicalSignerErrorCode.ts` | **None** | wallet; two step-up codes are the boundary | Step-up keeps the code | 391 | No Japanese text |
| 8.6 | Google and Email OTP flow codes (14) | `publicApi/types.ts:585`, `googleEmailOtpWalletAuthFlow.ts:203-225`, `googleEmailOtpErrors.ts` | **None** | split | Each server code gives the same public code | 2 | A substring match maps `otp_locked_out` and `otp_attempts_exhausted` to `email_otp_invalid_code` (measured in Slice 2) |
| 8.7 | Device linking codes (9) | `W/core/types/linkDevice.ts:59` | **None** | wallet | The journey codes | 196 | A literal repeated in two files |
| 8.8 | The old passkey error enum | `W/core/types/errors.ts`, exported at `W/index.ts:351` | **None** | delete | - | 114 | No user here or in seams-monorepo |
| 8.9 | Plain text for thrown errors | `T/utils/errors.ts` | `ib/passkey-browser-security.ts` | split | The same text for cancel, missing PRF and RP ID errors | 280 | 28 local `errorMessage` copies; English only |
| 8.10 | English and Japanese messages | `W/core/ui/messages.ts` (719 pairs), `locale.ts`, two `WalletLocale.tsx` | `tests/typecheck/wallet-locale.typecheck.ts` | split: about 140 entries go to auth | Each shown message has a Japanese entry | 1,248 | Unknown text shows in English under `ja`: server messages, 8.5 and the VoiceID mismatch. 17 keys differ only in case or a final period |

Area 8: 15 source files with 3,672 lines, and 5 test files with 597 lines.

- New auth code replaces rows 8.1, 8.2, the auth part of 8.6, 8.9 and the auth part of 8.10:
  **about 1,800 lines. Budget: under 1,800.** Row 8.8 is deleted.
- **One registry for each module.** Codes are defined in three places today (the server
  literal, the public union, the substring map). The new auth and the new wallet each export
  one table of codes with their status and their text in English and Japanese.

### Area 9: Shared contracts

Importers are counted by the `@shared/<folder>` alias. `packages/voiceid` imports nothing from
`shared-ts`.

| # | Folder or files | Holds | Importers (wallet, server, tests) | New owner | Compatibility check | Lines | Bloat found |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| 9.1 | `auth/` | Google and application-issuer config | 14, 9, 2 | auth | The `/wallet/external-auth` exchange with an issuer fixture | 321 | Imports parsers from `passkey-custody` |
| 9.2 | `authorization/` (not 9.3) | Wallet authority, capabilities, Wallet Session issuance | 121, 94, 23 | wallet | Fingerprint vectors; authority-record fixtures | 2,272 | A local `exactRecord`; 5 test-only exports |
| 9.3 | `authorization/voiceIdDeviceAssertion.ts` | The VoiceID device proof | - | auth (reviewed move) | The same message bytes for the audience `wallet` | 306 | One export used only in its file |
| 9.4 | `device-linking/` | Link contracts, parsers, credential delivery | 128, 49, 10 | wallet; the method-copy fields go to auth | Wire fixtures for each link message | 7,078 | 4 local `exactRecord` copies; `parsers.ts` 1,830 lines |
| 9.5 | `near/` | NEAR RPC client | 3, 7, 4 | wallet and wallet-connect | RPC decode fixtures | 1,071 | NEAR code in two places (`near/`, `utils/near*.ts`) |
| 9.6 | `passkey-custody/` | Custody envelope, ceremony commit, secret binding | 57, 43, 3 | wallet | The envelope AAD bytes do not change | 1,920 | A local `requireNonEmptyString`; generic parsers in `primitives.ts` |
| 9.7 | `signing-lanes/` | Lane records, owner continuity | 29, 23, 0 | wallet | Lane-record fixtures | 1,836 | 5 builders used only by type checks |
| 9.8 | `speakToSign/` | Spoken kinds, request, verdict keys | 12, 3, 2 | wallet | Verdict vectors | 1,260 | Not in the `exports` map |
| 9.9 | `tenant-root/` | Signing-root identity, Console operation record | 0, 12, 4 | host | Digest vectors against the Rust control plane | 986 | - |
| 9.10 | `threshold/` | Session budget and policy | 79, 61, 10 | wallet | The budget-grant table | 1,027 | `secp256k1.ts` has 1 line |
| 9.11 | `wallet-recovery/` | Recovery codes, rotation | 25, 15, 4 | wallet | Recovery-code fixtures | 2,032 | - |
| 9.12 | `utils/`, pure helpers (19 files) | Validation, encoders, digests | 571, 305, 82 | shared helper (D18) | - | 1,482 | `exactRecord` is outside `validation.ts`; WebAuthn classifiers in `errors.ts` |
| 9.13 | `utils/`, auth contracts (7 files) | Method records, add-method registration, WebAuthn device info | Shared | auth | Method-record fixtures for each method | 1,845 | `emailOtpDomain.ts` holds a wallet constant |
| 9.14 | `utils/walletAuthAuthority.ts`, `domainIds.ts` | Factor identities; auth and wallet IDs | Shared | boundary (split) | ID-parse fixtures | 1,033 | 8 test-only exports |
| 9.15 | `utils/`, wallet registration (7 files) | Registration intent, signer plan | Shared | wallet | Registration wire fixtures | 2,627 | `registrationIntent.ts` holds an auth grant |
| 9.16 | `utils/`, MPC and Router A/B (19 files) | Router A/B derivation, Yao, session seal | Shared | wallet | Router wire vectors | 7,990 | `routerAbEcdsaDerivation.ts` 3,845 lines; a local `requiredString` |
| 9.17 | `utils/`, chain helpers (4 files) | NEAR and EVM RPC results | Shared | wallet and wallet-connect | RPC decode fixtures | 869 | Local `requireRecord`, `requireString` |
| 9.18 | `utils/routerApiKeyAuth.ts` | Key-check failure codes | Server only | host | See 10.1 | 7 | - |
| 9.19 | `index.ts` | A re-export of 9 folders | **None** | delete | - | 9 | Nothing imports it |

Area 9: 138 source files with 35,971 lines, and 21 type-check files with 3,861 lines. 104 test
files outside the package import it (40,236 lines).

- 39 files in `utils/` with 14,371 lines are not pure helpers (rows 9.13 to 9.18). D18 moves
  each one to its owner.
- New auth code replaces rows 9.1, 9.13 and half of 9.14: **about 2,700 lines. Budget: under
  2,700.** Row 9.3 is a reviewed move. The other rows move to the wallet or to `host`.

### Area 10: Project credentials

| # | Touch point | Old code | Old test | New owner | Compatibility check | Lines now | Bloat found |
| --- | --- | --- | --- | --- | --- | ---: | --- |
| 10.1 | Ports, scopes and failure codes | `router/framework/apiCredentialPorts.ts`, `routeAuthPolicy.ts`, `shared-ts/src/utils/routerApiKeyAuth.ts` | Through 10.6 | host (reviewed move) | seams-monorepo adapters compile with no change | 211 | One export used only in its file |
| 10.2 | Publishable key, origin and environment | `router/auth/routerApiCredentialAuth.ts` | **None** here (seams-monorepo has one) | host (reviewed move) | Each refusal code: no key 401, no Origin 403, wrong environment 403 | 175 | - |
| 10.3 | Secret key | `routerApiCredentialAuth.ts:129` | None here | host (reviewed move) | No key 401; a wrong scope 403 | shared | Its only caller is in seams-monorepo |
| 10.4 | Header reads | `router/auth/routerApiKeyAuth.ts` | None | host; `extractBearerCredential` becomes a helper | Header-parse vectors | 57 | One function unused in both repositories; `externalAuth.ts:189` reads the header with no fallback |
| 10.5 | Route policy | `router/framework/enforceRoutePolicy.ts`, `routeDefinitions.ts` | Route tests | host; each module declares its scopes | Each route keeps its plane, credentials, scopes and bindings | 149 | 4 types used only in their file |
| 10.6 | Adapters behind the ports | `runtime/walletConsoleOpsClient.ts`, `walletConsoleOps.ts`, `staticWalletConsoleBinding.ts`, `walletGateway.ts` | `tests/e2e/external-auth.e2e.mjs` (happy path only) | host | An allowed origin passes; another origin gets 403 | 1,162 | 2 exports used only in their file |
| 10.7 | Registration context, environments, metering | `apiCredentialPorts.ts:74-143`, `router/auth/walletRegistrationContext.ts` | `tests/wallet-ui/registration-setup.browser.test.ts` | host; the registration context goes to the wallet | Setup keeps the placement and meters one `wallet_created` | 85 | - |
| 10.8 | Registration and intent routes | `walletRegistrationRoutes.ts` (3,152 lines) | Shared | wallet; the auth-method intent goes to auth | The checks of 10.2 | shared | The same 50-line block for both intents |
| 10.9 | Device-linking target routes | `routes/deviceLinking.ts:1656-1710` | `passkey.device-linking.contract.test.ts` | wallet | The checks of 10.2 | shared | The file has 2,007 lines |
| 10.10 | Login and Wallet Session scope | `router/auth/commonRouterUtils.ts:462-610` | None for refusals | host check; auth and wallet routes | No key needed; an environment with no key 401 | shared | A second copy of the publishable-key parse |
| 10.11 | Application-issuer trust | `routes/externalAuth.ts:183-230` | `tests/e2e/external-auth.e2e.mjs` | auth; host checks first | A wrong origin, environment or project key is refused | shared | Goes around the check of 10.2 |
| 10.12 | Routes in seams-monorepo | `runtime/walletGateway.ts:34-100` | seams-monorepo tests | wallet routes; host check | seams-monorepo route checks (U3) | shared | - |

Area 10: 11 source files with 1,839 lines, and 5 test files with 3,744 lines.

- **A reviewed move, not a rewrite.** Rows 10.1 to 10.7 move to `packages/host`. The move merges
  the two paths that call the adapters directly (10.10 and 10.11) and the repeated intent block
  (10.8). **Budget: under 1,839 lines after the move.**
- The refusal codes of the publishable-key check have no test in this repository. Slice 2 adds
  them.

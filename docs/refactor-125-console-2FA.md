# Refactor 118: Console 2FA implementation plan

Status: proposed. This document plans implementation; it does not change authentication behavior.

Support two account-level second factors: an authenticator app using TOTP and a passkey using WebAuthn. Keep Google/GitHub as the initial sign-in step. Once 2FA is enabled, completing either enrolled factor grants console access. Users may enroll both methods and multiple passkeys.

## Scope and product decisions

- Start with opt-in account-level 2FA. Enabling the first verified factor enables enforcement for that account across organizations. Mandatory owner/admin enrollment and organization-wide policy are separate follow-up work.
- Offer one active TOTP authenticator per account and multiple named passkeys, including hardware security keys that support user verification.
- Require 2FA on every new console sign-in. Session refresh preserves existing assurance and expiry rules; it never upgrades assurance. Defer remembered-device exceptions and standalone passkey sign-in.
- Include single-use recovery codes as the loss-of-device path. Email, SMS, and provider sign-in alone cannot reset enabled 2FA.
- Preserve existing custody-operation step-up requirements. Completing console TOTP does not authorize a tenant-root operation that currently requires WebAuthn.
- Store console authentication material independently of wallet custody seeds, signing roots, and wallet recovery material.

## Existing integration points

| Area | Current location | Planned change |
| --- | --- | --- |
| Google/GitHub login and auth dispatch | `packages/wallet-console-server-ts/src/router/hostedConsoleAuth.ts` | Introduce the second-factor gate before issuing usable console access. |
| Console session validation | `packages/console-server-ts/src/router/consoleAppSessionAuth.ts` | Require server-verified account assurance and current authentication version. |
| Session boundary | `packages/console-server-ts/src/boundary/session.ts` | Parse precise session states at the boundary; ensure refresh cannot bypass 2FA. |
| Route requirements | `packages/console-server-ts/src/router/consoleRouteDefinitions.ts` | Declare admission for challenge, enrollment, management, and normal console routes. |
| Existing WebAuthn implementation | `packages/wallet-console-server-ts/src/tenantRootSecurity/stepUpCeremony.ts`, `stepUpWebAuthnAdapter.ts`, `stepUpCredentialStore.ts` | Reuse verification patterns and the existing WebAuthn dependency. Account login gets explicit account ownership and challenge purpose. |
| Account storage | `packages/console-server-ts/src/account/`, `migrations/d1-console-core/` | Add account factor, challenge, and recovery persistence using established D1 patterns. |
| Login and account UI | `apps/wallet-console/src/core/dashboard/login/page.tsx`, `routes/account-settings/page.tsx`, `consoleSession.tsx` | Add enrollment, challenge, recovery, and factor management states. |

The existing WebAuthn adapter requests and verifies user verification. Existing step-up credentials are scoped by organization and user. They must not silently become account-wide credentials. Keep their custody purpose, require explicit account enrollment, and share only verification code that genuinely fits both flows. Audit the existing challenge store's separate read/delete consumption before reusing it: new authentication challenges require atomic consumption.

## 1. Define the session contract and server gate

Trace every console session issuance path, including provider callbacks, refresh, environment selection, organization switching, and any bearer-token admission. Determine how the existing app-session version can invalidate console access without changing wallet-session behavior.

Model the lifecycle with discriminated unions:

- `primary_verified`: required user identity, short-lived challenge ID, expiry, and authentication version; allows only challenge status, verification, recovery, and logout.
- `authenticated`: required user identity and session ID, plus assurance discriminated as `primary_only` or `second_factor_verified`. The verified branch requires factor identity, method, and verification time.
- `recovery_required`: restricted recovery authority that allows replacement enrollment and logout, with no organization or custody access.

An account with disabled 2FA may receive primary-only access. An account with enabled 2FA must satisfy second-factor verification before normal routes accept it. Enrollment requests have a separate pending state and do not change enabled status until verification succeeds.

Use branch-specific builders and narrow function inputs. Parse raw request bodies, database rows, and signed claims once. Use Result-style errors and exhaustive switches; avoid optional assurance fields and boolean bags. Pending credentials must have a distinct token purpose/audience or opaque server handle so existing app-session consumers cannot accidentally accept them.

Bind challenges to the account, initiating browser/session, purpose, and authentication version. Use a five-minute login challenge expiry and a two-minute WebAuthn ceremony expiry. Rotate the session identifier after successful verification and atomically consume the pending challenge. Read current account enforcement/version on protected requests; fail closed when it cannot be resolved. Retain existing authorization and membership checks.

## 2. Add persistence and factor services

Use the console-owned account identity, never email or an organization ID, as factor ownership. Preserve the current provider identity model; do not introduce account linking in this feature.

Persist:

- Account security state and an authentication version used for revocation.
- TOTP enrollment state, encrypted secret, encryption-key version, and last accepted time step. Separate pending and active records so replacement cannot overwrite a working factor prematurely.
- Passkey credential ID, public key, counter, transports, backup metadata supported by the library, account binding, name, and creation/last-use timestamps. Enforce credential ownership uniqueness within the relying party.
- Short-lived challenges with purpose, account/session binding, expiry, and attempt state.
- Recovery code hashes and consumption state.

Use atomic database operations for challenge consumption, accepted TOTP time steps, recovery-code use, and security-state transitions. Factor changes and version increments must commit together. Match the deployed D1 adapter's transaction capabilities; demonstrate that concurrent attempts produce at most one successful consumption.

Encrypt TOTP secrets with authenticated encryption under a deployment secret managed outside D1, binding ciphertext to account and factor identity. Reuse an existing suitable encryption helper if available. Never log secrets, provisioning URIs, codes, assertions, or recovery tokens. Keep encrypted backups and deployment-key availability in the operational requirements.

## 3. Implement TOTP end to end

1. A recently authenticated user starts setup. For an account already using 2FA, first require fresh proof from an existing factor.
2. Generate a random secret, persist an expiring pending enrollment, and return a QR provisioning URI plus a manual setup key over the authenticated response with caching disabled.
3. Use the interoperable profile: HMAC-SHA-1, six digits, 30-second period, with a maximum verification window of one time step either side of server time. Use a maintained implementation compatible with the deployed runtime.
4. Activate enrollment only after a valid code. Record its accepted time step so the enrollment code cannot immediately be replayed for login or factor management.
5. At sign-in, verify a code against the active factor, atomically advance the last accepted time step, consume the login challenge, and issue verified console access.
6. Expire abandoned setup records. Keep the current authenticator active until replacement verification commits.

Apply shared account-level and IP-level throttling across challenge recreation and both factor methods. Initial policy: five failed attempts per challenge, account-wide throttling after ten failures in fifteen minutes, and a bounded cooldown. Persist enforcement in shared storage; do not rely on a browser or worker-local counter. Handle code reuse and clock drift with recoverable errors.

The time-step and replay behavior follow [RFC 6238](https://www.rfc-editor.org/rfc/rfc6238.html).

## 4. Implement passkeys end to end

1. Start registration under recent primary authentication for first enrollment, or fresh existing-factor verification for subsequent enrollment.
2. Generate server-owned options using an explicitly configured console RP ID and allowed origins. Require user verification in both options and server verification. Use a stable opaque account user handle and exclude existing account credentials.
3. Verify challenge, origin, RP ID, account ownership, signature, and user verification through the existing WebAuthn library; persist the credential only after success.
4. During the second-factor challenge, offer the account's enrolled credentials. Successful assertion verification consumes the purpose-bound challenge and grants console assurance.
5. Permit naming and removing credentials. Handle cancellation, unavailable credentials, and alternate-method selection without granting access.

Support synced passkeys and hardware keys. Follow the library's counter and backup-state semantics; do not assume every legitimate authenticator increments a nonzero counter. Login evidence and custody-operation evidence have distinct purposes and cannot be substituted for each other.

## 5. Build the user flows and secure management

Account settings shows 2FA status, authenticator-app status, passkey list, and recovery-code availability. Setup includes a QR/manual-key flow for TOTP and a native browser ceremony for passkeys. The login challenge offers enrolled methods only and lets users switch methods. Preserve a validated local return destination across the flow.

Require fresh existing-factor verification, no older than five minutes, before adding/replacing factors, removing factors, disabling 2FA, or regenerating recovery codes. First enrollment requires recent provider authentication; an old console cookie alone is insufficient. Removing the last factor is an explicit disable-2FA operation with its own confirmation and verification.

Generate ten high-entropy single-use recovery codes when the first factor is activated. Display the plaintext once and allow download/copy; regeneration replaces the full set. If the response is lost, allow regeneration after fresh factor verification. Recovery requires provider authentication plus a recovery code, atomically consumes the code, revokes existing console sessions, and grants restricted replacement enrollment. Require a verified replacement factor before returning to console access. Never automatically disable 2FA during recovery.

Increment the authentication version and revoke older console sessions after security changes. Reissue the current session only after the authorized transition completes. Append audit events and send security notifications through existing delivery infrastructure, excluding secrets. Delivery failure must not undo enforcement.

Keep keyboard navigation, paste support, focus placement, accessible errors, and browser cancellation usable. Avoid storing secret setup material in local storage or URL parameters.

These management and recovery requirements follow [OWASP MFA guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).

## 6. Deliver in small working slices

1. **Session gate + TOTP vertical slice:** account persistence, enrollment, Google/GitHub challenge, verified session, and minimal settings/login UI. Demonstrate enrollment → sign-out → provider login → denied console request → valid TOTP → successful console request.
2. **Passkey vertical slice:** account registration, assertion, multiple credentials, and method switching. Demonstrate the same operating path with a passkey and confirm cancellation grants no access.
3. **Recovery and management:** backup codes, replacement, removal, explicit disablement, revocation, audit, and notifications. Complete these before enabling the feature for users.
4. **Contract verification and release:** update intended behavior documentation and contracts, exercise bypass/concurrency cases, apply migrations, and deploy server/client changes together.

Each slice should use the smallest existing service and route patterns. This is a cross-cutting auth feature; avoid combining it with the broader console-package migration or rewriting unrelated session code. Remove superseded paths as each replacement lands. Keep any necessary old-record conversion at the persistence boundary and delete it after migration.

## 7. Verification and release acceptance

After each working path is demonstrated, add focused behavioral coverage. Read `tests/AGENTS.md` before editing tests; keep all TypeScript tests in the top-level test workspace and create complex records through shared factories.

- Provider authentication alone cannot reach protected console routes for an enabled account, including through direct HTTP calls, refresh, bearer admission, environment selection, or organization switching.
- Disabled accounts retain the intended sign-in behavior; enabled accounts accept either enrolled method.
- Pending, expired, wrong-purpose, wrong-account, and wrong-session challenges fail. Concurrent challenge/code consumption succeeds once at most.
- TOTP covers the RFC vectors, accepted drift window, replay prevention, throttling across new challenges, and incomplete enrollment.
- WebAuthn rejects wrong RP/origin, missing user verification, and another account's credential; exercise a synced passkey and a hardware key in supported browsers.
- Enrollment and factor removal cannot be authorized by an old primary-only session. Recovery cannot produce ordinary console authority before replacement enrollment.
- Session revocation takes effect after factor changes. Account switching cannot bypass 2FA. Existing custody WebAuthn requirements remain intact for TOTP-authenticated users.
- Type fixtures reject invalid lifecycle branches, broad-spread escape hatches, and calls that pass pending authority to authenticated functions. Enforce unsafe-cast restrictions with the existing lint rules where applicable.

Update `docs/console-intended-behaviours.md` and its Console lifecycle contract in the same implementation change. Run focused tests first, then the relevant auth/console suites and `pnpm check`, since this changes shared authentication behavior. Classify failures under the repository testing policy before repairing them.

Deploy additive persistence before server/client cutover. Existing accounts begin with 2FA disabled; existing organization-scoped custody credentials remain purpose-bound. Enabling 2FA invalidates previously issued console access. A rollback must preserve enforcement for already-enabled accounts; use a forward fix or temporarily deny their access rather than accepting primary-only sessions.

Release is complete when both methods, management, recovery, and server-side enforcement work on the deployed operating path, and the focused auth contracts pass. Organization-mandated enrollment can build on this account-level foundation in a separate plan.

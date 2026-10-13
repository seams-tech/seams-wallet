# SeamsAuthMenu: NEAR account and signing-key selection

Status: proposed implementation plan, 2026-10-13. No product implementation is included.

## Outcome

Keep the current single-key account experience simple. When an account has two
managed keys, show separate selectable keys within one NEAR account group.
The first expected pair is an Ed25519 primary key and an ML-DSA-65 backup key.
Multiple devices can have permission to use either or both keys.

This plan covers presentation, selection, and their host integration. Production
ML-DSA custody, enrollment, signing, and recovery follow the
[NEAR support design](../chain-support/near-ml-dsa-65.md). The
[signing investigation](ml-dsa-65-investigation-plan.md) owns protocol readiness.

## Product decisions

- Each Seams-managed NEAR key belongs to at most one NEAR account on its configured network.
- One NEAR account initially has one managed key. Later it can have several managed keys.
- Each key is independently selectable. Keys for the same account share an account group.
- Devices and authentication methods do not create duplicate key entries.
- The key role, signature algorithm, and current selection are separate facts.
- `Primary` and `Backup` are roles. Ed25519 and ML-DSA-65 are algorithms.
- `Backup` does not promise recovery after participant loss or loss of authentication.
- The menu shows Seams-managed keys. Other on-chain access keys do not become selectable through discovery alone.
- Account balances and transaction history remain account-level information.
- Key selection never silently falls back to another key after failure or revocation.

## Current implementation and required changes

Paths in this document are relative to the repository root.

| Current behavior | Planned behavior | Reason |
| --- | --- | --- |
| `account-options.ts` deduplicates by wallet ID and authentication method. | Build account groups containing exact managed-key choices and their available authentication routes. | Several keys can belong to one account. Several methods can authorize one key. |
| `AuthMenuSurface.tsx` groups saved wallets under Passkey and Email OTP. | Group NEAR choices by account and network. Present authentication controls for the selected key. | Authentication method and signing identity need separate selection. |
| `domain.ts` can recover a missing selection through another wallet option. | An invalid explicit key selection returns a selection-required state. | A missing backup must not redirect signing to the primary. |
| `session.ts` invalidates preparation when the wallet changes. | Account, key, or authorization-target changes invalidate the affected preparation. | Two choices may share a wallet ID while requiring different authority. |
| The authority manifest allows one Ed25519 signer and one ECDSA signer. | Multiple NEAR keys require an authoritative inventory and exact authorization for each supported algorithm. | UI rows alone cannot establish signing capability. |

The React `HostedSeamsAuthMenu` component is a shell around the wallet-host
surface. Keep selection and authorization inside that host. Extend the existing
protocol only where the parent application needs the confirmed signing selection.

## Presentation

Single-key accounts retain one compact selectable entry. Key details remain
available without requiring a key-choice step. ECDSA-only wallets and wallets
awaiting NEAR provisioning keep their existing wallet presentation.

For multiple managed keys, show the account once and provide separate key rows:

```text
alice.near                                      NEAR Mainnet

  Primary key                                  Selected
  Ed25519 · 7dQ…3xP

  Backup key
  ML-DSA-65 · fingerprint
```

The fingerprint above is illustrative. Derive display fingerprints from the
validated key representation. Labels and shortened fingerprints never identify
the selection internally.

- Use the account name as the group heading. Show the network when it is ambiguous.
- Order the primary key first, followed by backup keys in stable inventory order.
- Use role labels initially. Reuse existing saved labels where available; a new key-renaming feature is outside this change.
- Show algorithm and fingerprint as readable secondary text for multiple-key accounts.
- Keep the selected key visible in the collapsed control and signing confirmation.
- Use a neutral selection mark. A backup key does not imply an error state.
- Place full-key inspection and copy actions in a separate key-details view.
- Keep nested buttons outside listbox options. Selecting a key and copying a key are separate actions.
- Keep account-level balances outside individual key rows. Do not duplicate balances in totals.

ML-DSA full public keys and NEAR access-key handles are different representations.
The support design defines a 1,952-byte full public key and a compact hash handle.
Use the validated handle or an agreed key fingerprint for the short display.
Label `Copy public key` and `Copy access-key handle` separately when both are available.
If the full key is unavailable, expose that state and omit its copy action.
Never present a handle as the full public key.

## Selection and authentication behavior

1. Open the menu with the current wallet/account context. A fresh login defaults
   to its available primary key. Selecting a backup requires an explicit action.
2. A confirmed active session can display its currently selected backup after
   refresh. A display preference alone cannot establish an authenticated selection.
3. Choose a key before choosing an authentication route when several keys exist.
   Passkey and Email OTP remain methods for authorizing that exact choice.
4. Selecting a row changes the pending choice. Authentication starts through the
   existing explicit sign-in action. Selection alone consumes no signing budget.
5. Validate the selected account, key, method, authority, and current availability
   before accepting completion. Reuse the existing host cancellation and observation mechanisms.
6. Keep the previous confirmed signing selection until the new selection succeeds.
   Cancellation leaves that confirmed selection intact. A stale completion cannot replace it.
7. Bind subsequent NEAR operations to the confirmed key. Preserve the existing
   exact-operation checks throughout confirmation, signing, and dispatch.
8. If the selected key disappears, becomes revoked, or becomes unsupported, show
   the reason and require a new choice. Never substitute the first inventory entry.

Wallet authentication and preferred NEAR signing key remain separate state.
A session may authorize more than one key. Selecting one key does not manufacture
a new authority or change access to unrelated chains.

Cold-browser login may start without an account/key inventory. Preserve the
existing discoverable authentication flow. Resolve the trusted inventory after
authentication and require a key choice if it is ambiguous. Do not invent an
account or key from the wallet ID, a signer slot, or incomplete cached metadata.
Explicit application requests for a wallet or key constrain the selectable choices.

## Device access

Reuse the existing device-management surface and authority inventory. A key-details
view can show which devices can use that key when authenticated inventory is available.
Represent unavailable inventory explicitly. Do not convert an unavailable read into zero devices.

A device may appear under both keys because its authority permits both. Device
labels do not prove possession of key material. In particular, the ML-DSA proposal
keeps shares on two server participants while the client authorizes operations.

Keep the existing removal scope explicit. If removing a device's final method
retires its authority across several keys, the confirmation must describe that scope.
Do not offer key-specific device revocation unless the backend supports it.
On-chain access-key removal and backup enrollment remain separate lifecycle work.

## Identity and state requirements

Reuse existing branded wallet, key, account, authority, and method identifiers.
Normalize raw storage and protocol input once at the host boundary.

- Account grouping uses the wallet/application scope, NEAR network, and account ID.
- Key choices additionally require the exact managed key ID and validated key representation.
- Authentication targets require the exact permitted method and authority binding.
- `signerSlot` can remain existing protocol metadata. It is insufficient as the sole UI or authorization identity.
- Enforce the one-account-per-managed-key rule at enrollment and persistence boundaries.
- Model discovery, available inventory, unavailable inventory, pending selection,
  and confirmed selection with discriminated unions. Require identity fields in resolved branches.
- Model algorithm-specific key representations with precise variants. Keep ML-DSA
  full keys and access-key handles distinct. Avoid a bag of optional algorithm fields.
- Use branch-specific builders, exhaustive switches, and the repository's `Variant` helper.
- Add type fixtures for invalid branch combinations, direct construction, and broad spreads.
  Reject casts in review because TypeScript assertions can bypass static guarantees.

Nonce tracking continues to use the account and access key. Sharing a key across
devices shares its chain nonce state. Different keys on the same account have
independent nonce state. This UI plan does not provide cross-device nonce exclusion.

## Implementation sequence

### 1. Establish the inventory and selection contract

Trace the canonical key and authority readers into the host menu. Define the
smallest inventory projection that supports the decisions above. Update
`docs/intended-behaviours.md` with the accepted selection behavior and its contract mapping.

Primary files:

- `packages/wallet/src/SeamsWeb/walletIframe/host/auth-menu/domain.ts`
- `packages/wallet/src/SeamsWeb/walletIframe/host/auth-menu/account-options.ts`
- `packages/wallet/src/SeamsWeb/walletIframe/host/auth-menu/controller.ts`
- Existing key inventory, authority, and account-binding boundaries identified by that trace.

Deliverable: precise inventory and selection types, boundary parsing, and type fixtures.
The current single-key path must remain functional. Authoritative multi-key inventory,
account binding, and ML-DSA availability are prerequisites for enabling a real backup row.

### 2. Connect exact selection through the host

Update `auth-menu/session.ts` and `auth-menu/passkey.ts` so preparation and completion
carry the selected key and permitted authentication route. Extend existing public
selection and iframe messages only where required by signing consumers.
The UI must not bypass the one-signer restrictions in current authority types.

Remove replaced wallet-only selection and fallback paths within the changed flow.
Keep any persisted-shape migration at the persistence boundary. Add no feature flags,
parallel menu implementation, or compatibility branches in core selection.

Deliverable: a key selection that reaches the signing boundary and survives valid
refresh, cancellation, and authentication changes without selecting a sibling key.

### 3. Render account groups and key details

Update the existing host surface and styles:

- `packages/wallet/src/SeamsWeb/walletIframe/host/ui/auth-menu/AuthMenuSurface.tsx`
- `packages/wallet/src/SeamsWeb/walletIframe/host/ui/auth-menu/auth-menu.css`
- `packages/wallet/src/SeamsWeb/walletIframe/host/ui/auth-menu/menu-view.css`
- `packages/wallet/src/react/components/AccountMenuButton/LinkedDevicesModal.tsx`
  and `packages/wallet/src/react/hooks/useWalletDevices.ts` only for required device projections.

Use development fixtures to review the future two-key state while production
ML-DSA support is incomplete. Keep fixtures inside the existing test harness.
Production rows come only from trusted inventory and actual supported capabilities.

Preserve listbox keyboard behavior, visible focus, Escape, and focus return.
Accessible names include account, network, role, algorithm, and selection state.
Support touch, narrow drawers, zoom, long account names, and long key details.
Secondary text must remain readable without hover. Reuse existing appearance tokens
and motion. Keyboard selection is immediate. Respect reduced motion and avoid
hover translation and one-sided highlight borders.

### 4. Verify behavior and enable the complete path

Extend the existing browser harness and intended-behavior E2E infrastructure.
Use branch-specific shared fixtures. Do not add unit tests or source-text guards.

| Scenario | Required observation |
| --- | --- |
| One key, several linked devices, both auth methods | One key choice; permitted authentication methods remain available. |
| One account, Ed25519 primary and ML-DSA backup | Two distinct choices; account and network remain visible; selection reaches the exact signing key. |
| Primary-only device and device authorized for both keys | Each device sees accurate availability; unavailable access is explained. |
| Backup selected while primary preparation finishes late | The late result cannot authenticate or select the primary. |
| Selected backup revoked during authentication, followed by reload | Completion fails safely; no automatic fallback; refresh reflects current authority. |
| Same account name on different networks; similar fingerprints | Groups and choices remain distinct by full identity. |
| Keyboard and narrow touch drawer with long names and ML-DSA key details | Selection, copy, focus, and layout remain usable. |

The main composed E2E should enroll both supported keys on one disposable account,
use separate device contexts, select the backup, authenticate, and sign a transaction.
Verify the signature and encoded account/key identity independently. From a surviving
primary-capable device, revoke the backup-capable device's authority during a second
authentication attempt. Prove that stale completion cannot select the backup or
fall back to the primary. Complete a fresh primary selection on the surviving device.
This scenario uses authority-wide revocation and does not assume key-specific removal.

Until the production ML-DSA prerequisites exist, browser fixture tests establish
presentation and selection behavior only. They do not establish real backup signing.
Keep that release gate open until the composed scenario passes against the supported network/runtime.

Save a Playwright trace, screenshots of the selected-key and failure states, and
a redacted JSON record of expected/observed account and public-key identities.
Include the revision, exact command, fixture setup, network/protocol, and artifact paths.
Exclude credentials, shares, recovery codes, and secret material.

Relevant existing validation entry points:

```sh
pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts wallet-ui/auth-menu.browser.test.ts
pnpm -C tests type-check:wallet-state
pnpm -C packages/wallet type-check
pnpm report:bloat --check
```

Add the composed scenario to `tests/e2e/intended-behaviours/` and use the existing
isolated runner. Record its exact command once the scenario exists. Classify any
failure against current domain types before repairing fixtures or production code.

## Completion criteria

- A single-key account requires no additional selection step.
- Two managed keys on one account are visually and behaviorally distinct.
- Authentication methods and devices do not duplicate key choices.
- Confirmed selection reaches the exact account/key at the signing boundary.
- Backup use is explicit. Stale, failed, or revoked selections never trigger fallback.
- Full ML-DSA keys and lookup handles remain distinguishable in types and copy actions.
- Existing non-NEAR wallet flows remain usable.
- Browser evidence and the real two-key E2E artifact establish the claimed release scope.

# Intended Behaviours

Date created: 2026-05-30

Last reviewed: 2026-09-16

Status: source-of-truth behavioural contract.

This document defines expected wallet behaviour across passkey and Email OTP
authentication methods. Current architecture specifications and tests should
point back here when deciding whether new code is correct. Historical refactor
plans explain how the design arose; they do not override this contract.

E2E enforcement lives in `tests/e2e/intended-behaviours` and follows
[Spec 9: Behaviour and test authority](spec-9-behaviour-and-test-authority.md).

## Terms

| Term                              | Meaning                                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `walletId`                        | Durable, protocol-independent wallet identity. It is distinct from every chain account id and address, including `nearAccountId`.                                                                         |
| `providerSubject`                 | External identity-provider subject, such as the Google subject used during an Email OTP flow.                                                                                                             |
| `challengeSubjectId`              | Subject recorded on an Email OTP challenge. For Google Email OTP it must equal the verified `providerSubject`.                                                                                            |
| root                              | Secret derivation origin. An `Id`, `Version`, or `Epoch` suffix identifies metadata about a root and never key material.                                                                                  |
| wallet custody seed               | One random secret per wallet. The owner signing roots derive from it independently. It never transfers to a linked device.                                                                                |
| owner signing roots               | The Ed25519 Yao Client root and ECDSA client root share. Both derive directly from the wallet custody seed; neither derives from the other.                                                               |
| lane holder share                 | Per-lane material provisioned by its signing protocol. It is independent of wallet-seed derivation and never belongs to a recovery set.                                                                   |
| custody envelope                  | Authenticated encryption of the wallet custody seed bound to one wallet, auth method, and key manifest. Opening an envelope authenticates that binding.                                                   |
| custody ceremony                  | Registration or recovery flow that derives the owner signing roots and verifies the complete key manifest. Unlock and auth-method addition are not custody ceremonies.                                    |
| verified key-manifest proof       | Proof produced by registration or recovery that a seed has just reproduced the wallet's complete key set.                                                                                                 |
| authenticated-envelope seed proof | Proof produced when an authenticated custody envelope opens for its bound wallet and manifest. It carries that claim into auth-method addition and cannot substitute for a verified key-manifest proof.   |
| Wallet authority                  | Permissioned grouping of auth methods and signer activations for one wallet installation or recovery authority. Adding a sibling auth method reuses it; linking a device or recovering creates a new one. |
| `walletAuthorityId`               | Opaque identity of one Wallet authority.                                                                                                                                                                  |
| `walletAuthMethodId`              | Opaque identity of one Passkey or Email OTP method attached to a Wallet authority. Core flows always select the exact method.                                                                             |
| signer activation                 | Durable authorization for one authority to use an exact signer and its holder material.                                                                                                                   |
| Wallet Session                    | Short-lived, multi-use server authorization issued through one exact auth method and constrained by permissions, expiry, and signing quota.                                                               |
| `walletSessionId`                 | Opaque identity of one exact Wallet Session. It does not identify cryptographic material or readiness by itself.                                                                                          |
| `quotaId`                         | Opaque identity of the server-authoritative signing quota attached to one exact Wallet Session. Remaining uses, expiry, and lifecycle are fields of that quota.                                           |
| owner proof                       | Server-only, purpose-bound result of Passkey or Email OTP verification. It is consumed once to issue a Wallet Session or authorize one exact operation.                                                   |
| operation credential              | Opaque primary or hosted credential bound to one exact Wallet Session. The server resolves its authorization, quota, expiry, and revocation state.                                                        |
| authorized operation              | Quota-neutral, one-operation authorization bound to the exact operation intent and required signing material.                                                                                             |
| signing lane                      | One permitted way for an authority to use a wallet key. Readiness is exact to its key family, material activation, and chain target where applicable.                                                     |
| material activation               | Exact durable identity of currently admitted holder material for a signing lane. Public key identity alone is insufficient.                                                                               |
| `thresholdSessionId`              | Cryptographic session identity for Ed25519 or ECDSA holder material. It is separate from Wallet Session authorization and quota identity.                                                                 |
| threshold                         | The multi-party signing protocol. It never names a key-derivation stage.                                                                                                                                  |
| `chainTarget`                     | Concrete ECDSA signing network and semantics. Readiness and authorization remain target-specific even when targets share one public key.                                                                  |
| warm session                      | Client signing state in which an exact active Wallet Session and quota are paired with usable hydrated material for the selected lanes.                                                                   |
| step-up auth                      | Fresh same-method verification that authorizes one exact privileged operation without renewing a Wallet Session or adding quota.                                                                          |
| tenant derivation root            | Server-side tenant secret derivation origin used for operational holder material. It is distinct from every wallet custody seed and owner signing root.                                                   |
| `deviceId`                        | Installation identity for one Wallet authority on one browser or device. It is not a hardware fingerprint.                                                                                                |

## Wallet settings presentation

- `WalletSettingsPage`, inside `SeamsWebProvider`, presents the account menu as a
  full-page sidebar and a selected settings panel. Signed-out users authenticate
  through the hosted authentication menu before accessing wallet settings.
- Page presentation retains the account menu's capability restrictions and uses
  the same export, recovery, authentication-method, device-linking, and preference
  operations. Authentication methods and linked devices render inline without
  modal focus trapping; sensitive-operation confirmations retain their existing UI.
- Narrow viewports expose the sidebar through an explicit settings disclosure.
  Selecting a section moves focus to its heading. Locking returns to authentication.

## Durable ECDSA preprocessing

- An owner pool-fill ceremony uses six dependent HTTP exchanges: initialization
  carries the client's first protocol message, followed by five step requests.
  Both participants advance from triples to presigning within a message batch.
  Every exchange retains live authorization and exact scope/deadline binding.
  The client creates a fresh 256-bit ceremony nonce; the server durably burns the
  expiry-bound identity before returning its first message, including on failure.
  Reinitialization is rejected after completion and worker restart. Requests that
  exceed authorized deadlines fail rather than changing an initialized binding.

- A confirmed foreground signing operation may claim an in-flight ceremony's final
  batch. Its complete request uses the verified public candidate R-derived
  material identity. The ordinary live signing authorization and quota admission
  precede terminal protocol execution; the server first persists this material as
  Reserved for that exact request. The client claims completed material directly
  without publishing it in the available pool. If the final batch has already
  been sent, signing uses ordinary completed-pool preparation.
- An ambiguous terminal prepare response does not trigger a replacement signing
  operation. Cancellation or invalidation destroys client material; server
  reservations remain single-use and expire under the existing lease. Exact
  completed finalization replay returns the durable first result, while altered
  finalization input is rejected.

- Retain unused reusable ECDSA presignatures encrypted on both participants for
  up to 90 days, subject to material retirement and revocation. Session expiry
  alone does not invalidate the retained material. Operation-scoped preparation
  remains bounded to its exact operation.
- Target five available entries per exact client pool identity. Restore and refill
  any deficit while the client can execute with an unexpired, unrevoked session
  scoped to the wallet and active material. Refill after every consumption,
  including the last permitted reusable signature. Preserve single-use and atomic
  cross-tab claim rules.
- Preprocessing requires no remaining signing uses and consumes no signing quota.
  Actual signing retains its quota checks. Stop refill on expiry, revocation,
  logout, or material invalidation; resume transient failures with bounded backoff.
  Generation cannot continue while the browser is closed.
- A returning user with an unchanged activation and an available persisted entry
  must restore it after a page or worker restart and reach signing without any
  presign-generation requests. Verify the 30-day return case explicitly.
- Registration and unlock return promptly while missing inventory is replenished
  in the background. Signing itself still requires current signing authorization.

## Global Invariants

- Passkey and Email OTP are separate auth methods. A flow selected as
  `email_otp` must not call passkey/WebAuthn credential lookup. A flow selected
  as `passkey` must not call Email OTP verification.
- Registration must persist the configured signer inventory and establish one
  exact Wallet Session for the authenticated registration authority. Default
  wallet unlock hydrates that durable inventory; explicit partial unlock
  hydrates only the requested lane subset.
- The registration-established Wallet Session can read and manage authentication
  methods immediately after registration completes.
- Tenant-root operational-share rotation preserves existing wallet signing
  keys and leaves normal signing available while a Deriver is unavailable.
  New derivation ceremonies may wait for rotation to finish. The local contract
  `tenant-root.rotation.contract.test.ts` verifies Ed25519 signatures before,
  during, and after a rotation held pending by a stopped Deriver.
  It also verifies warm Tempo and Arc/EVM signing after rotation, and preserves
  the original Ed25519 public key and ECDSA addresses through cold passkey unlock
  from empty browser storage and fresh-browser recovery using a code issued
  before rotation. A consumed recovery code remains unusable.
  Manual rotations have a one-minute cooldown in local development and a
  ten-minute production default. Retries resume the same operation during the
  cooldown. Retired-share cleanup receives fresh authorization when retried
  after the activation authorization expires.
  The dashboard resumes the server's pending rotation across tabs and reloads.
  A conflicting request is rejected and cannot become a queued later rotation.
- Transaction signing uses warm-session budget. It should not ask for step-up
  while a valid warm session has enough signature uses for the requested
  operation.
- Step-up authorizes one exact operation. It does not create, renew, or add
  budget to an exact Wallet Session.
- Key export always requires fresh operation-specific authorization. A normal
  transaction-signing warm session is not sufficient authority for export.
- ECDSA lanes are target-specific. Tempo and Arc/EVM may share key facts and
  source material, but readiness, budget lookup, and persistence must carry the
  concrete `chainTarget`.
- Page refresh must not create new authority by itself. It may rehydrate valid
  persisted/sealed session state. If rehydration fails or a session is expired
  or exhausted, the next operation must use normal unlock or step-up auth.
- Application authentication is outside the wallet SDK. An application token,
  cookie, user id, or provider session never proves wallet ownership.
- Primary and hosted operation credentials are opaque. Client code must not decode
  identity, budget, expiry, authority, or signing claims from them.

## Hosted Auth Menu Entry Point

When hosted wallet-iframe mode is configured, mounting `HostedSeamsAuthMenu` opens one
`modal_auth_menu` surface in the wallet-origin iframe. The app document contains
an inert loading shell until the hosted surface appears; auth inputs, progress, OTP prompts, and the final
CTA belong to the wallet origin.

- Login and registration prepare their asynchronous prerequisites before enabling
  the single wallet-origin CTA. The CTA starts the selected passkey ceremony from
  that wallet-origin activation.
- Registration uses the configured account-input policy and completes through the
  same prepared surface; it does not open a second registration-confirmation modal.
- The wallet host owns passkey and Email OTP validation, OTP state,
  registration continuation, and unlock continuation.
- A hosted-wallet handoff is single-use and bound to the application and wallet
  origins. The wallet iframe receives one short-lived hosted operation credential
  for the exact parent Wallet Session; the primary operation credential stays in
  the wallet origin and never reaches the outer application.
- The adapter emits exactly one terminal `HostedAuthMenuOutcome` for the session.
  Unmounting or closing cancels only that session and leaves direct
  `registerWallet()`, `addWalletSigner()`, and `unlock()` confirmation surfaces
  unchanged.

## Registration

### Passkey authentication

Expected behaviour:

- Registration prompts for one passkey credential creation.
- The newly created passkey credential is bound to the wallet and stored as a
  passkey auth method.
- Registration returns after the wallet, auth method, configured ECDSA signer
  inventory, and exact Wallet Session are durable and the primary operation
  credential has been issued. Tempo and Arc/EVM signing may begin immediately.
- Registration schedules bounded ECDSA presignature refill under the established
  session. Registration success does not await pool readiness. Immediate signing
  may use the first completed entry while background refill continues.
- A presign HTTP exchange has a five-second response budget capped by the
  ceremony's remaining lifetime, including response-body delivery. A stalled
  exchange is aborted; recovery starts a fresh ceremony identity. Foreground
  signing retains priority through failed-refill recovery so maintenance cannot
  launch competing generation before that signing operation finishes.
- Deferred mixed-authority publication reconciles ECDSA refill against the newly
  committed authority, including when the session credential is retained. A late
  failure from an older attempt cannot cancel the reconciled refill. Rejection
  without fresh lifecycle reconciliation stops refill without a retry loop.
- For a mixed signer set, Ed25519/NEAR provisioning continues under the same
  authenticated ceremony and publishes one of `near_pending`,
  `near_provisioning`, `near_ready`, or `near_failed_retryable`.
- NEAR admission and Yao execution cannot delay EVM registration or EVM signing.
  EVM activation and the NEAR continuation are saved atomically as separate records.
  Yao execution starts only after its encrypted completion checkpoint is durable.
- Reload and uncertain responses retain the exact NEAR attempt. Normal unlock
  with the founding method resumes its saved phase, using fresh session authority
  when the registration grant has expired. No replacement key is generated.
- NEAR completion extends the current Wallet Session while preserving its identity,
  expiry, remaining quota, revocation epoch, and existing ECDSA capabilities.
  Concurrent ECDSA signing continues through this NEAR-only authority extension.
  An exhausted session can finish provisioning with zero uses; its next signature
  requires normal same-method step-up without renewing the session or quota.
- A lock in either tab prevents late NEAR readiness publication. Readiness and
  removal of its repair journal commit atomically; an aborted transaction retains
  the journal for the next authorized unlock.
- After EVM activation, the retained NEAR journal supplies the exact session identity.
  Passkey client-seal preparation may overlap custody execution and server finalization.
  Preparation creates no signing authority and performs no server sealing. Temporary keys are consumed once for the matching
  session and factor, or discarded on failure, lock, expiry, or abandonment.
- After NEAR authority publication, passkey session hydration and local signer
  installation may overlap. Durable readiness waits for both; a failed hydration
  retains the repair journal for normal unlock.
- With remaining signing quota, NEAR signing becomes available at `near_ready`
  without a second passkey prompt.
  A retryable provisioning failure remains visible to the caller.
- ECDSA key export remains available while NEAR is pending and requires fresh
  export authorization.
- Passkey registration must not send or verify an Email OTP challenge.

Failure behaviour:

- If local persistence postconditions fail, registration must not report local
  success.
- If blockchain account creation has already happened, immutable chain-state
  rollback messaging must be separate from local persistence rollback/repair
  messaging.

### Email OTP authentication

Expected behaviour:

- Registration sends one Email OTP code for the active registration attempt.
- The user may reroll the wallet name without sending another OTP code.
- The final wallet id may differ from the wallet id shown when the OTP was sent.
- The OTP remains valid for registration reroll only when the provider subject,
  challenged email, challenge id, org, owner-proof binding, and allowed
  registration purpose match.
- Registration stores the Email OTP auth method and binds it to the final
  wallet id.
- Registration returns after the wallet, Email OTP auth method, configured ECDSA
  signer inventory, and exact Wallet Session are durable and the primary
  operation credential has been issued. Tempo and Arc/EVM signing may begin
  immediately.
- Registration schedules bounded ECDSA presignature refill under the established
  session without awaiting pool readiness, as in Passkey registration.
- For a mixed signer set, Ed25519/NEAR provisioning continues with the live
  registration factor and publishes one of `near_pending`,
  `near_provisioning`, `near_ready`, or `near_failed_retryable`.
- NEAR admission and Yao execution cannot delay EVM registration or EVM signing.
  EVM activation and the NEAR continuation are saved atomically as separate records.
  Yao execution starts only after its encrypted completion checkpoint is durable.
- Reload and uncertain responses retain the exact NEAR attempt. Normal unlock
  with the founding method resumes its saved phase, using fresh session authority
  when the registration grant has expired. No replacement key is generated.
- NEAR completion extends the current Wallet Session while preserving its identity,
  expiry, remaining quota, revocation epoch, and existing ECDSA capabilities.
  Concurrent ECDSA signing continues through this NEAR-only authority extension.
  An exhausted session can finish provisioning with zero uses; its next signature
  requires normal same-method step-up without renewing the session or quota.
- A lock in either tab prevents late NEAR readiness publication. Readiness and
  removal of its repair journal commit atomically; an aborted transaction retains
  the journal for the next authorized unlock.
- With remaining signing quota, NEAR signing becomes available at `near_ready` without a second OTP
  verification. A retryable provisioning failure remains visible to the caller.
- ECDSA key export remains available while NEAR is pending and requires fresh
  export authorization.
- Email OTP registration must not create passkey-owned runtime material.
- Email OTP registration must not call passkey PRF/touch-confirm sealed restore.

Failure behaviour:

- A wallet-unlock OTP challenge must not satisfy registration verification
  unless the request carries an explicit registration reroll proof whose
  provider subject, challenged email, challenge id, org, and owner-proof binding
  match.
- A registration OTP challenge must not satisfy wallet-unlock verification.
- Reroll must fail with a precise challenge/proof mismatch code when the
  provider subject or challenged email differs.

### Page Refresh During Registration

Expected behaviour:

- Refreshing during registration completion may restore UI progress from durable
  registration attempt state when available.
- Refreshing must not send a second OTP solely because the wallet name changed.
- Refreshing must not finalize registration without the same required
  operation-bound owner proof.
- Retrying the same activation or deferred NEAR provisioning request uses the
  original ceremony and idempotency key. The server returns the credential-free
  V2 committed projection without repeating custody effects; a changed request
  under that key is refused.
- Local pending registration state remains invisible until one exact readwrite
  publication succeeds. A failed publication leaves it pending for an exact
  retry.
- A credential-free committed projection identifies the exact method required
  for a fresh unlock and never replays a primary operation credential.
- After completed registration, a refresh follows the exact-session restoration
  behaviour below.

## Wallet Unlock

### Passkey authentication

Expected behaviour:

- Unlock prompts for the wallet's registered passkey.
- If the credential id is known, WebAuthn should request that credential
  directly so the browser does not show an unnecessary account picker.
- By default, unlock warms NEAR Ed25519 and configured ECDSA signing lanes.
- Callers may request an explicit subset, such as NEAR-only, ECDSA-only, or
  specific ECDSA targets, to avoid unnecessary unlock latency.
- Unlock issues one exact Wallet Session for the selected auth method and its
  primary operation credential. Local warm signing state can authorize multiple
  transactions within that session's quota.
- Unlock should not require Email OTP.
- Restoring durable key facts and display metadata must use local inventory without
  querying signing-session status. Readiness validation runs after hydration, with
  independent curve readers sharing one operation-scoped status Promise. The same
  scope spans verification and post-hydration checks, then is discarded. Each
  later operation reads current expiry, revocation, and quota state. The mixed-wallet
  passkey unlock contract makes at most three post-verification status requests:
  one for unlock and one for each of its two explicit public session reads.
- Unlock should not delete durable sealed/session records that are needed for
  future refresh or recovery unless the user explicitly removes the wallet,
  device, auth method, or account.

Failure behaviour:

- If no passkey auth method or credential can be found for the wallet, unlock
  fails before reporting success.
- If requested signing lanes cannot be hydrated, unlock fails or reports a
  typed partial-hydration error before normal signing begins.

### Email OTP authentication

Expected behaviour:

- Unlock sends one wallet-unlock OTP challenge.
- By default, verifying the OTP warms NEAR Ed25519 and configured ECDSA signing
  lanes.
- Callers may request an explicit subset, such as NEAR-only, ECDSA-only, or
  specific ECDSA targets, to avoid unnecessary unlock latency.
- Unlock issues one exact Wallet Session for the selected auth method and its
  primary operation credential. Local warm signing state can authorize multiple
  transactions within that session's quota.
- Unlock should not require passkey/WebAuthn.
- Unlock should not call passkey PRF/touch-confirm sealed restore.
- Default unlock should hydrate the same lane inventory as successful Email OTP
  registration for the same wallet and auth method. Explicit partial unlock
  should hydrate the requested lane subset only.

Failure behaviour:

- A registration OTP challenge must not unlock the wallet.
- A step-up/export OTP challenge must not unlock the wallet.
- Unlock must fail before reporting success if no usable Email OTP auth method
  exists for the wallet.

### Page Refresh After Unlock

Expected behaviour:

- Refresh may restore valid warm-session state from durable/sealed records
  without a user prompt.
- Refresh must preserve exact auth method, curve, chain target, session ids, and
  budget identity.
- If restored warm sessions are still valid, NEAR, Tempo, and EVM transaction
  signing should proceed without unlock or step-up prompts.
- If restored warm sessions are expired, exhausted, invalid, or missing, the
  wallet should require unlock or operation-specific step-up on the next
  privileged operation.
- Refresh must not silently switch an Email OTP-authenticated session to passkey
  paths or a passkey-authenticated session to Email OTP paths.
- Every unlock request names the exact `walletAuthMethodId`; a wallet-level
  method fallback is refused.
- A replayed unlock mint returns the exact committed session and quota identity
  without a credential. A fresh unlock through the exact method is required for
  a new primary operation credential.

## Account Recovery

Code recovery selects one exact active auth method and custody envelope as its
continuity anchor. The source auth-method family does not constrain the selected
Passkey or Google/Email OTP recovery target.

Expected behaviour:

- The hosted wallet-iframe menu accepts one unused recovery code. The server
  resolves the wallet from the code locator without an existing Passkey
  assertion, an old credential id, or a client-supplied wallet or source method.
- Preparation reserves the code and binds an immutable Passkey or Google/Email
  OTP target. Passkey creation and Google authentication begin from their own
  user actions; Google recovery also requires the issued Email OTP before
  factor release.
- The recovery code is the sole wallet-recovery authorization. The selected
  target still proves its own factor: Passkey registration for Passkey, or a
  server-verified Google identity followed by Email OTP for Email OTP.
- The server selects one exact active method and custody envelope as the
  continuity anchor. Passkey-only, Email-only, and mixed-method wallets admit
  either recovery target.
- Finalization verifies the complete stored key manifest and preserves the
  registered NEAR, Tempo, and Arc/EVM public identities.
- Recovery-code consumption and installation of a fresh recovery authority,
  target method, signer activations, and method-bound custody envelope are one
  atomic commit. Existing methods, envelopes, authorities, linked devices, and
  Wallet Sessions remain active.
- Recovery restores local continuity against the fresh recovery authority. An
  existing synced Passkey on a sibling authority does not block creation of the
  fresh recovery authority's Passkey.
- Recovery finalization itself does not issue a Wallet Session. Recovery
  completion proceeds through normal login with the newly installed method; that
  login creates a fresh exact Wallet Session and primary operation credential.
- Remaining recovery codes stay active. Re-entering the consumed code, or
  entering a code held by another active recovery, reports that it has already
  been used and directs the owner to another code. An abandoned reservation
  becomes reusable after it expires.

Failure behaviour:

- The unauthenticated server boundary identifies an exact consumed code through
  its non-secret locator tombstone. Unknown wallets, malformed or unknown codes,
  target-policy mismatches, unsupported auth shapes, and unrelated conflicts
  retain the generic refusal.
- Cancellation before finalization leaves the code usable after its reservation
  expires and clears client-held recovery material.
- A failed atomic finalization leaves existing access active and the code
  unconsumed. Transport uncertainty may replay the same exact additive
  finalization.
- Recovery material, server diagnostics, and code values never enter hosted
  outcomes, parent-window messages, or logs.

## Transaction Signing

### Passkey authentication

Expected behaviour:

- NEAR, Tempo, and EVM signing select an exact passkey lane for the requested
  curve and chain target.
- If the selected warm session has enough signature uses, signing proceeds
  without another prompt.
- The server resolves the operation credential to its exact Wallet Session and
  chooses exact admission, same-method step-up, or hard denial.
- NEAR action batching consumes one signature use per NEAR transaction, not one
  use per action.
- Multiple independent transactions in one signing request consume one
  signature use per transaction digest.
- Tempo and EVM each consume one signature use per transaction request unless a
  future batch API explicitly declares more.
- After successful signing, the Wallet Session quota is finalized exactly once.

Failure behaviour:

- If no exact lane exists, signing fails with a typed lane-selection error.
- If the exact lane exists but budget is exhausted or expired, signing plans
  same-method step-up.
- Passkey signing must not ask for Email OTP unless the user explicitly selected
  an Email OTP auth method for a wallet that supports it.

### Email OTP authentication

Expected behaviour:

- NEAR, Tempo, and EVM signing select an exact Email OTP lane for the requested
  curve and chain target.
- If the selected warm session has enough signature uses, signing proceeds
  without another OTP.
- The server resolves the operation credential to its exact Wallet Session and
  chooses exact admission, same-method step-up, or hard denial.
- NEAR action batching consumes one signature use per NEAR transaction, not one
  use per action.
- Multiple independent transactions in one signing request consume one
  signature use per transaction digest.
- Tempo and EVM each consume one signature use per transaction request unless a
  future batch API explicitly declares more.
- ECDSA shared-key material may be sourced from another EVM-family target, but
  signing readiness and budget checks must remain exact to the requested
  `chainTarget`.
- After successful signing, the Wallet Session quota is finalized exactly once.

Failure behaviour:

- If no exact lane exists, signing fails with a typed lane-selection error.
- If the exact lane exists but budget is exhausted or expired, signing plans
  Email OTP step-up.
- Email OTP signing must not call WebAuthn credential lookup, passkey PRF, or
  passkey/touch-confirm sealed restore.

### Page Refresh Before Signing

Expected behaviour:

- A refreshed page may use restored warm sessions if they are exact, valid, and
  have enough budget.
- A refreshed page must re-read lane inventory before signing.
- A refreshed page must not rely on stale in-memory diagnostics or stale
  candidates from before refresh.
- If restoration cannot prove exact readiness, the signing flow must request
  unlock or same-method step-up.

## Step-Up Auth

### Passkey authentication

Expected behaviour:

- Step-up uses the selected wallet's passkey auth method.
- If the credential id is known, WebAuthn should request that credential
  directly.
- Step-up is operation-specific and claims one quota-neutral authorized
  operation.
- Step-up preserves the existing key, lane, material activation, Wallet
  Session, and budget identity.
- Step-up for NEAR must not refresh ECDSA-only lanes unless the approved
  operation requires them.
- Step-up for Tempo/EVM must be exact to the requested ECDSA chain target.

Failure behaviour:

- Cancelling transaction review before the passkey prompt begins cancels only
  that operation and preserves the selected wallet authority.
- A cancelled passkey step-up prompt cancels the operation, leaves the wallet
  locked, and must not spend budget.
- A passkey step-up result cannot authorize an Email OTP lane.

### Email OTP authentication

Expected behaviour:

- Step-up sends an operation-specific Email OTP challenge.
- Verifying the OTP claims one quota-neutral authorized operation.
- Step-up preserves the existing key, lane, material activation, Wallet
  Session, and budget identity.
- Step-up for NEAR must authorize the selected Ed25519 lane.
- Step-up for Tempo/EVM must authorize the selected ECDSA lane and exact chain
  target.
- Step-up should show one OTP prompt per approved operation.

Failure behaviour:

- A cancelled Email OTP step-up prompt cancels the operation, leaves the wallet
  locked, and must not spend budget. A failed OTP attempt cancels the operation
  without spending budget.
- An Email OTP step-up result cannot authorize a passkey lane.
- A step-up OTP challenge cannot be reused for wallet unlock, registration, or
  key export.

### Page Refresh During Step-Up

Expected behaviour:

- Refreshing during an incomplete step-up cancels or resumes only through an
  explicit operation-state path.
- A stale step-up challenge must not authorize a different operation after
  refresh.
- A completed step-up may be restored only if the restored lane is exact to the
  same wallet, auth method, operation, curve, chain target, and session ids.

## Key Export

### Passkey authentication

Expected behaviour:

- Key export requires fresh export-scoped passkey authorization.
- A normal transaction-signing warm session is not enough to export keys.
- Ed25519 export selects an exact Ed25519 export lane.
- ECDSA export selects an exact ECDSA export lane for the requested chain target
  or shared EVM-family key, with source material explicitly resolved.
- Export opens the export viewer only after authorization and material
  preparation succeed.
- Export authorization is one-time or export-scoped according to policy.

Failure behaviour:

- Transaction step-up authorization must not be accepted for key export.
- If export material is unavailable, export fails with an exact export-lane or
  material error.
- Passkey export must not call Email OTP verification unless the user selected
  an Email OTP auth method for a wallet that supports it.

### Email OTP authentication

Expected behaviour:

- Key export requires fresh export-scoped Email OTP authorization.
- A wallet-unlock OTP or transaction step-up OTP is not enough to export keys.
- Ed25519 export selects an exact Email OTP Ed25519 export lane.
- ECDSA export selects an exact Email OTP ECDSA export lane for the requested
  chain target or shared EVM-family key, with source material explicitly
  resolved.
- Export opens the export viewer only after authorization and material
  preparation succeed.
- Export must not call WebAuthn credential lookup, passkey PRF, or
  passkey/touch-confirm sealed restore.

Failure behaviour:

- Transaction step-up authorization must not be accepted for key export.
- Wallet-unlock authorization must not be accepted for key export.
- If export material is unavailable, export fails with an exact export-lane or
  material error.

### Page Refresh During Export

Expected behaviour:

- Refreshing during export must not leak key material or leave an export viewer
  authorized without fresh operation state.
- If export resumes after refresh, it must revalidate export-scoped
  authorization and exact lane/material identity.
- A transaction-signing session restored after refresh must not become export
  authority.

## Adding an Authentication Method

A wallet authority holds at most one Passkey method and one Email OTP method.
The product offers one **Add authentication method** action, and which branch it
runs is decided by the exact active inventory of the selected authority rather
than chosen by the caller.

- The action is offered only when the authority is missing a family, and
  disappears once both are active.
- Adding a family the authority already has answers `already_configured` at
  admission, before any target factor is verified and before any code is sent.
  Repeating an addition must not cost the user a verification.
- The source method supplies a fresh proof bound to that exact addition. The
  target factor is verified independently; the source proof never serves as
  target verification.
- The new method reuses the authority and device it was added to. It creates no
  authority, signer activation, share, public key, export root, or key manifest,
  and it carries forward whatever signer access the authority already has. A
  wallet owning one signer family gains a method that correctly claims only that
  family.
- The source method and its Wallet Session stay selected. The added method comes
  into use only through explicit selection, or through lock and unlock naming
  it; an unlock that names it moves the selection to it, and that move is
  allowed only between members of one authority.
- A Wallet Session names the exact method that opened it, not merely its family.
  Each sibling method may have its own active session. Replacing or revoking one
  method retires only that method's session, quota, and hosted children; sibling
  methods and their sessions remain active.
- Either sibling can revoke the other, proving with its own factor rather than
  the one being removed. The last remaining method cannot be revoked.
- Revoking a method must not prevent adding another of that family afterwards.

## Linked Devices

Expected behaviour:

- Opening authentication-method or linked-device inventory never starts wallet
  unlock or step-up authentication. Inventory reads use the exact owner Wallet
  Session already established by wallet unlock, do not consume its signing-use
  budget, and surface an unavailable session without retrying or prompting.
- Exhausting the signing-use budget preserves the session's owner-management
  capabilities until the exact session expires or its method or authority is
  revoked or retired.
- Linking creates a fresh `deviceId`, `walletAuthorityId`,
  `walletAuthMethodId`, and signer activation for every signer family present
  on the source authority. The wallet's public signer identities remain
  unchanged, and Device 1's authority, methods, material, sessions, and
  revocation epoch remain unchanged.
- Device 2 never receives the wallet custody seed. An Ed25519 installation
  with `export_keys` receives only the one-use encrypted Yao Client export
  root and seals it under the verified target method.
- Activation gives Device 2 an exact Wallet Session and recipient-bound sealed
  operation-credential delivery. After the local worker opens it, Device 2 uses
  ordinary signing, export, reload, lock, unlock, inventory, and revocation
  paths. Those operations do not read the completed link session or repair
  missing material.
- Device inventory is derived from active wallet authorities with
  device-link provenance and their exact auth methods. A completed link
  session is temporary workflow state and is deleted after acknowledgement.
- A Passkey card displays server-derived authenticator metadata when it is
  available. An Email OTP card displays `Email OTP` and makes no browser,
  operating-system, provider, transport, sync, or hardware claim.
- Every card displays a stable shortened `deviceId`. Creation-order labels
  such as `Device 2` are not durable identity, and metadata must not imply an
  exact physical machine or exclusive possession of a synced Passkey.
- Device metadata is display and audit context only. Authorization, signing,
  export, unlock, and revocation never branch on labels, browser or operating-
  system names, providers, transports, or sync state.
- Raw User-Agent strings, attestation objects, PRF output, factor secrets, and
  Email OTP addresses do not enter the management response.
- User revocation targets one exact `walletAuthMethodId` and requires fresh
  proof from a different active method under a full-owner authority. Removing
  the wallet's final active method is refused without changing durable state.
- Revoking the final method attached to an authority retires that authority,
  invalidates its sessions, and disables its exact signer activations while
  leaving other methods, authorities, and devices operational.

Failure behaviour:

- Missing, duplicate, cross-wallet, wrong-kind, revoked, or digest-mismatched
  authority and auth-method records fail closed. Runtime operations do not
  select a sibling device or infer identity from timestamps or display data.
- An incomplete migrated enrollment returns `relink_required` at its boundary.
  Linking does not hydrate, recover, rotate, promote, or synthesize missing
  signer or export material.
- Retrying after the pending-authority commit reuses the exact authority,
  method, activation, package, and digest identities. It must not create a
  duplicate authority or signer activation.
- Activation replay returns the same exact session and sealed delivery.
  Acknowledgement cleanup is authenticated and remains resumable after the live
  link session is deleted.

## Test Matrix

Every release touching registration, auth methods, signing sessions, budget,
lane selection, worker material, or export should validate this matrix.

| Authentication method | Registration                            | Unlock                    | NEAR tx                   | Tempo tx                     | EVM tx                       | Step-up NEAR     | Step-up Tempo    | Step-up EVM      | Ed25519 export                | ECDSA export                | Page refresh                                       |
| --------------------- | --------------------------------------- | ------------------------- | ------------------------- | ---------------------------- | ---------------------------- | ---------------- | ---------------- | ---------------- | ----------------------------- | --------------------------- | -------------------------------------------------- |
| Passkey               | ECDSA-ready; NEAR readiness is explicit | warms exact present lanes | available at `near_ready` | no prompt while budget valid | no prompt while budget valid | passkey prompt   | passkey prompt   | passkey prompt   | fresh auth after `near_ready` | fresh passkey export auth   | restores durable readiness and exact present lanes |
| Email OTP             | one OTP; reroll allowed; ECDSA-ready    | warms exact present lanes | available at `near_ready` | no OTP while budget valid    | no OTP while budget valid    | Email OTP prompt | Email OTP prompt | Email OTP prompt | fresh auth after `near_ready` | fresh Email OTP export auth | restores durable readiness and exact present lanes |

## Validation Mapping

Each row needs either an automated test or an explicit manual verification note
when a change touches registration, unlock, signing, step-up, export, session
restore, lane selection, or budget handling.

| Behaviour                                                                                                        | Evidence                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Email OTP registration reroll reuses only the matching challenge and provider subject                            | Private boundary coverage: `seams-monorepo/tests/unit/authService.hostedAccountPrivacy.unit.test.ts`              |
| Passkey registration signs Tempo immediately and NEAR at readiness                                               | `tests/e2e/intended-behaviours/passkey.registration.contract.test.ts`                                             |
| Passkey unlock restores exact mixed-wallet signing, export, refresh, and step-up                                 | `tests/e2e/intended-behaviours/passkey.unlock.contract.test.ts`                                                   |
| Email OTP registration and unlock restore signing, export, refresh, and step-up without passkey fallback         | `tests/e2e/intended-behaviours/email-otp.unlock.contract.test.ts`                                                 |
| Local Ed25519 Yao execution preserves retry and terminal-failure semantics                                       | `tests/e2e/intended-behaviours/passkey.ed25519-yao-local.contract.test.ts`                                        |
| Adding Email OTP reuses the Passkey authority and enables every allowed signer and export family                 | `tests/e2e/intended-behaviours/passkey.add-email-otp.contract.test.ts`                                            |
| Adding Passkey reuses the Email OTP authority and enables every allowed signer and export family                 | `tests/e2e/intended-behaviours/email-otp.add-passkey.contract.test.ts`                                            |
| Auth-method addition works for Ed25519-only and ECDSA-only authorities                                           | `tests/e2e/intended-behaviours/auth-method-addition.matrix.contract.test.ts`                                      |
| Passkey recovery preserves public identities, signs through the fresh authority, and refuses code reuse          | `tests/e2e/intended-behaviours/passkey.recovery.contract.test.ts`                                                 |
| Google/Email OTP recovery preserves public identities, signs through the fresh authority, and refuses code reuse | `tests/e2e/intended-behaviours/google-email-otp.recovery.contract.test.ts`                                        |
| Tenant-root rotation preserves signing and recovery across operational-share changes                             | Private acceptance coverage: `seams-monorepo/tests/e2e/intended-behaviours/tenant-root.rotation.contract.test.ts` |
| Sibling revocation, inventory UI, and exact Email OTP boundary failures                                          | Private focused coverage in `seams-monorepo/tests/unit` as mapped by the owning change.                           |
| External EVM discovery, connection binding, stale-request rejection, and transaction outcomes                    | `tests/unit/externalEvmController.unit.test.ts`                                                                    |

## Non-Goals

- Do not use passkey fallback paths to repair Email OTP state.
- Do not use Email OTP fallback paths to repair passkey state.
- Do not hide registration failures by relying on a later wallet unlock to fix
  local runtime state.
- Do not treat public ECDSA identity as signing material.
- Do not use session ids alone to identify ECDSA readiness or budget.
- Do not send extra OTP codes during registration reroll.

## External EVM accounts

- Discovery uses EIP-6963 plus Phantom's wallet-specific
  `window.phantom.ethereum` namespace. It never selects the shared
  `window.ethereum` provider. The user explicitly selects the provider before
  `eth_requestAccounts` is sent.
- MetaMask, Rabby, and Phantom EVM providers use the same EIP-1193 connector.
  Provider metadata is display data; it cannot authenticate a wallet or establish
  Seams custody authority.
- External connection state is separate from Seams authentication, Wallet
  Sessions, custody seeds, and MPC signing lanes. An external account cannot be
  represented as a Seams `WalletSessionRef`.
- Account, chain, provider, and local-disconnect changes invalidate prepared
  operations. A returned transaction hash remains tied to its captured account
  and chain; a transport failure after dispatch is an unknown outcome and must not
  trigger an automatic resend.
- The connector validates account, chain, signature, transaction hash, and receipt
  responses at the provider boundary. Unsupported chains and methods are explicit
  failures, and connection alone does not imply transaction support.
- Local disconnect removes browser listeners and connection state. Revoking the
  site's permission remains an explicit action in the external wallet.

## Application transaction review

Hosted React transactions may supply an application review through an explicit
`TransactionReviewHost`. The six reviewed `useWallet()` transaction methods retain
their existing core results and callbacks. Ordinary calls need no review host.

- The application review and wallet approval share the existing transaction queue
  and outer modal. React stays in the application document; authorization stays
  inside the wallet iframe. Continue alone never signs.
- A same-wallet NEAR readiness update preserves an in-flight EVM review and
  wallet approval. Review ownership follows the wallet identity.
- Before wallet approval is submitted, Back returns to the same review and preserves
  component state and the original expiry. Continue resumes the pending approval
  without dispatching again. Both screens retain the same modal container.
- Transaction inputs are privately copied at invocation. Effective configuration
  is pinned before display and requires modal presentation and explicit approval.
- Queued cancellation, expiry, owner/host disposal, wallet changes and unrelated
  session replacement invalidate the request before signing. Old controls cannot
  act on a subsequent request. Request-owned credential work retains its lease.
- Wallet admission checks expiry after authentication and before each signature.
  Once a signature starts, cancellation and expiry preserve its actual outcome.
- Adapter failures before dispatch reject without invoking core callbacks. Wallet
  failures after dispatch retain the method's existing outcome conventions.

Consumer setup and styling: [Custom React transaction review](transaction-review.md).
Behavioral coverage: `tests/wallet-ui/transaction-review.browser.test.ts`,
`tests/unit/transactionReview.snapshot.test.ts`, and
`tests/typecheck/transaction-review.typecheck.ts`.

### Export viewer presentation

Key export follows the user's confirmation UI preference: modal or drawer. The
`none` preference displays exported keys in a modal. An explicit export variant
overrides the preference. Parent iframe geometry and the key viewer use the same
resolved variant; closing either presentation disposes the displayed key material.

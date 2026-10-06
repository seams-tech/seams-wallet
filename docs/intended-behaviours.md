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

## Application confirmation preferences

Preference setters update the application's display immediately. Each write captures
its wallet target at the call. Later wallet selection cannot redirect that write.
The client sends writes in order and keeps pending changes separate from confirmed
host state. Host updates do not replace a newer pending local change.

`preferences.flush()` waits for writes queued before the call. Later writes do not
extend that wait. It reports failures, including earlier failures that no caller
has observed. Concurrent flushes covering the same writes see the same failures.
A failed write removes its local change and leaves later writes able to proceed.
Background write failures do not cause unhandled promise rejections.

Signing waits for earlier writes for its wallet and default-scoped writes. A failed
write rejects that signing attempt before transport dispatch. Explicit flush or
signing observation consumes the reported failure. A subsequent attempt can use
the confirmed preferences. Host admission continues to enforce confirmation policy.

Disposal rejects pending synchronization and stops local preference events. It
cannot undo a write the host already accepted. Display-wallet selection is never
an authentication source. Acknowledgement covers host preference state; it does
not claim that a storage write has reached durable storage.

Browser enforcement: `tests/wallet-iframe/preferences.queue.test.ts` and
`tests/wallet-iframe/preferences.sync.test.ts`.

Email OTP transaction step-up belongs to the signing operation. Application code
must not request a signing-session challenge or refresh a signing session through
separate auth methods. The active signing bridge supplies the exact authority,
wallet session, chain, and operation fingerprint to its challenge request.
Custom login and registration flows retain their distinct proof contracts.

## Worker preparation

A fresh signed-out wallet host with no pending registration or recovery work
must not create signer or custody workers merely because the runtime is
constructed, the provider mounts, or a generic auth menu opens. Configuring
multiple chains does not select all of their workers. Confirmation UI assets
may load independently.

Signer and custody workers are initialized by the operation that requires them.
Selected registration preparation may start its required crypto during the
credential prompt; a best-effort preparation failure does not replace the real
operation's initialization check. A failed WASM load must be retryable on the
same worker when asset delivery recovers. Concurrent requests share initialization;
subsequent requests reuse the initialized module. A thread-ready notification
alone does not prove crypto initialization succeeded. Worker reuse, cancellation,
and durable presignature validity retain their existing contracts.

The provider connects through `connection.connect`. Operation-specific ECDSA
and Email OTP preparation remain internal. Applications do not expose or call a
presignature-pool preparation method. Registration, unlock, and eligible session
restoration schedule preparation inside the wallet host. Removing the public
preparation call does not delete durable presignatures or change lock semantics.

Google Email OTP registration prepares Yao only when its resolved signer
selection includes NEAR. Rerolling the wallet name retains that selection and
reuses preparation already started. ECDSA-only registration does not fetch the
Yao client binary for speculative preparation. Each operation still initializes
its required crypto independently of preparation.

NEAR-only Email OTP wallets restore signing material without an ECDSA capability.
The active wallet authority selects the restore branch. A combined wallet still
requires its exact ECDSA manifest and activation. Both branches verify the returned
Wallet Session against the selected wallet and factor before using it. Restored
NEAR-only authorization is persisted so subsequent reloads can restore signing.

Cleanup of volatile linked ECDSA holder material or Email OTP warm material must
not create an absent worker. An existing worker receives the cleanup operation.
Lock preserves valid durable presignatures. The production NEAR-only passkey
scenario verifies registration, lock, unlock, and restored signing without ECDSA
or Email OTP worker creation.

The custody worker loads ceremony WASM when starting a key-set ceremony,
restoring a NEAR registration ceremony, or rotating recovery codes. Continuation
steps use the ceremony handles already held by that worker. Envelope open/reseal,
export-root transfer, and lane-source operations initialize their own required
modules without loading ceremony WASM merely because they share its worker.

## Public account queries

Public NEAR account queries use `seams.near.accountExists(accountId)` and the
application's configured or injected RPC client. They work before wallet
connection or authentication. A successful query returns true for an existing
account and false for a confirmed missing account. Invalid account input and
unavailable RPC reads reject; an RPC failure does not establish account absence.
The SDK owns transient read retry and RPC handling. The browser contract is
`tests/wallet-iframe/account-query.test.ts`.

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
- A refill using a retired or expired Wallet Session receives HTTP 401
  `wallet_session_invalid`. Unlock can replace a session while an older background
  request is in flight; that request cannot continue under the replacement
  session. Storage failures remain unavailable errors.

- A foreground signer waiting for an in-flight ceremony waits for the existing
  Gateway-authorized pool-fill completion. The client verifies the matching
  completed material identity, admits its local material, then sends ordinary
  available-pool signing prepare. The Gateway derives private presign authority
  from the verified Wallet Session or operation step-up. A signing prepare cannot
  carry a terminal presign batch.
- An ambiguous pool-fill completion does not create a replacement signing
  operation or reuse unverified material. An ambiguous signing prepare does not
  trigger another prepare for the same material. Cancellation or invalidation
  destroys client material; server reservations remain single-use and expire
  under the existing lease. Exact completed finalization replay returns the
  durable first result, while altered finalization input is rejected.

- Reusable-session ECDSA prepare, finalize, and completed replay evaluate live
  signing policy. Project denial takes precedence over abuse denial; abuse
  rejection and rate limiting return their respective errors. Policy denial
  leaves quota, operation claims, and audit events unchanged. Clearing the
  denial permits the original request, including exact durable replay.

- Reusable-session ECDSA signing checks that the material verified during
  authorization still matches when prepare claims the operation and when
  finalize or replay is admitted. This covers canonical signer records, linked
  installations, and their canonical custody source. Retirement or replacement
  before that decision rejects the request without consuming quota or invoking
  the signing worker. An exact retry with unchanged live material retains the
  durable replay behavior.

- Retain unused reusable ECDSA presignatures encrypted on both participants for
  up to 90 days, subject to material retirement and revocation. Session expiry
  alone does not invalidate the retained material. Operation-scoped preparation
  remains bounded to its exact operation.
- The public `auth.lock()` retires session authority and clears volatile material,
  while retaining otherwise-valid durable presignatures. A later unlock requires
  fresh authorization before retained entries can sign. The SDK exposes no
  separate logout operation that deletes those entries.
- Target five available entries per exact client pool identity. Restore and refill
  any deficit while the client can execute with an unexpired, unrevoked session
  scoped to the wallet and active material. Refill after every consumption,
  including the last permitted reusable signature. Preserve single-use and atomic
  cross-tab claim rules.
- Preprocessing requires no remaining signing uses and consumes no signing quota.
  Actual signing retains its quota checks. Stop refill on expiry, revocation,
  lock, or material invalidation; resume transient failures with bounded backoff.
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

## Wallet preferences

Preference writes keep the wallet selected when the write starts. A wallet change
during storage work cannot redirect that write or apply its result to another
wallet. The host acknowledges wallet-bound writes after IndexedDB commits them.
Successful acknowledgements include the current wallet-bound preference snapshot
and revision, so immediate UI actions do not depend on event delivery timing.
Storage failures reject the request and leave the confirmed values unchanged.
Application `preferences.flush()` reports those failures through its existing queue.

A wallet's first confirmation preference write must produce a readable record.
Network and relayer choices are optional configuration values; preserve them when
present and validate their values. Confirmation preferences remain required when
a preference record exists. Preferences for no selected wallet remain in memory.

A delayed preference read cannot overwrite a later wallet selection, a newer read,
a committed write, or disposed state. Selecting another wallet resets the display
to default preferences until that wallet's stored preferences arrive.

Session bootstrap can restore a saved wallet when no wallet is selected. A wallet
selection or removal during the saved-wallet read takes precedence over that
read. Reading the session of an already selected wallet does not select it again.

The application discards a session response captured before an observed wallet
selection change and reads the current wallet again. Removing the selection clears
the application's session projection. A closed connection clears that projection.
Delayed session-read responses cannot repopulate it. Router disposal is terminal;
initializing a disposed router rejects the call.

Within a live connection, session snapshots carry a host-issued observation
revision. The application ignores snapshots older than the last accepted revision.
The host recaptures a read when a local authority commit or selection change occurs
during that read. It checks again immediately before publishing the response.
Selection removal returns a fresh locked projection. Repeated changes exhaust
three attempts and reject the read instead of publishing an unstable observation.

Session events and query responses use the same host observation revision sequence.
Every snapshot identifies its wallet selection, including locked snapshots. The
application ignores events for another selected wallet. Session expiry notifications
also carry an observation revision on the wire; the public lifecycle event stays
unchanged. An old expiry can cancel work bound to its exact session, but it cannot
replace a newer session projection.

The host publishes current session state after local authority commits and wallet
selection changes. It combines changes within a host operation before refreshing.
Unlock and successful hosted authentication publish the session before completion.
Unchanged projections do not produce repeated login-state notifications. Concurrent
wallet-session queries share pending work within the same connection, selection,
and session observation revision. A completed query does not cache later queries.
Replacing an identical exact-session record preserves the stored row without a write.
A known expiry remains expired when a delayed status response reports that same
session as active. A replacement session has its own identity and can become active.
Disposing or replacing the host observer stops its subscriptions and publication.

Committed authority changes notify other contexts through a database-scoped browser
broadcast channel. The notification contains no wallet identity, credential, or
session projection. A receiver advances its own observation revision and rereads
persisted authority. It never accepts authentication state from the notification.
Received notifications are not broadcast again. The final listener's removal closes
the receiving channel. Database changes and disabling persistence retire that
channel. Explicit reads retain their persisted-authority checks if browser broadcast
channels are unavailable. Cross-context delivery is limited to the browser's shared
broadcast scope; it does not synchronize independent database partitions.

Current-state reads never restore a saved selection. Bootstrap can restore it once.
If selection changes during bootstrap, the client retries as a current-state read.
This prevents selection removal from starting another saved-wallet lookup.

Clearing a wallet's persisted session credentials reads and deletes its keys in
one transaction. It preserves other wallets' credentials. A corrupt session read
or failed replacement rolls back any earlier deletions in that transaction.
A refresh cannot recreate an exact credential that was already retired.

A remote session-status response cannot make an older local authorization active
again. After that response, the host rechecks the selected factor, lock generation,
authority binding, exact session record, and operation credential. A changed binding
causes a fresh observation. Repeated changes stop after three attempts and report
`superseded`. The host also rechecks the expiry deadline after the response.

## Hosted Auth Menu Entry Point

The application resolves wallet configuration before sending it to the wallet
host. The host validates the complete snapshot without applying defaults again.
An incomplete snapshot is rejected before replacing the active configuration.
Execution configuration replacement advances the host's execution generation.
Pending runtime requests, including requests waiting for code to load, reject with
`wallet_configuration_changed`. Their later results and progress cannot update the
replacement runtime. Cached handlers cannot acquire a runtime from a newer generation.
Appearance updates and equivalent execution settings retain active work. Invalid
configuration leaves the current generation intact. Replacement disposes volatile
runtime state and preserves valid durable presignatures. Request rejection does not
roll back work already committed by the wallet or network.
Signing-only clients can initialize without registration credentials. Registration
still requires its normal configured credentials.

Appearance updates preserve execution settings and warm signing state. Updating
the same theme merges its colors and shape values. Selecting another theme removes
the previous theme's overrides. Configuration alone does not load the full wallet
runtime; the recovery summary can appear and cancel without that runtime.

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
- Demo email delivery displays its code inside the wallet-origin OTP prompt.
  Replacement delivery replaces the displayed code. Provider-only delivery shows
  no demo code. Displaying a code never submits it automatically. Hosted demo
  delivery does not require an application callback or a parent-window event.
  Custom UI reads the delivery result from its returned authentication flow.
- A hosted-wallet handoff is single-use and bound to the application and wallet
  origins. The wallet iframe receives one short-lived hosted operation credential
  for the exact parent Wallet Session; the primary operation credential stays in
  the wallet origin and never reaches the outer application.
- The adapter emits exactly one terminal `HostedAuthMenuOutcome` for the session.
  Unmounting or closing cancels only that session and leaves direct
  `registerWallet()`, `addSigner()`, and `unlock()` confirmation surfaces
  unchanged.

- Hosted exchange redemption publishes the child's home locator before consuming
  the validated one-use exchange. A directory publication failure leaves the
  exchange usable for retry. Concurrent redemption still produces one credential;
  an unused locator never grants authorization.

Wallet-origin transaction details and raw calldata use the same disclosure
sizing path. With normal motion, expanding or collapsing content announces one
target height before the card changes size. The card must fit within the iframe
throughout the resize. Reduced-motion behavior remains immediate.

## Registration

### Wallet-management protocol

- Wallet-management requests send `X-Seams-Wallet-Protocol: 2`. This wire
  contract covers registration, signer setup and inventory, auth-method
  management, and implicit NEAR funding through the wallet-management routes.
- Missing or unsupported values return HTTP 409 with code
  `wallet_protocol_mismatch` before body parsing or wallet-management service
  execution. The message asks the user to reload and, if necessary, asks the
  integrator to upgrade its Wallet SDK. Authentication remains independently
  required; the protocol header does not authorize an operation.
- The SDK preserves the server's actionable error. Reloading a page that serves
  the matching SDK must restore registration and signing. An integrator pinned
  to an older SDK must upgrade its package; a reload cannot change that pin.
- Preflight requests allow the protocol header. Fetch and Express expose the
  same contract. Signing, recovery and export routes retain their own contracts.

### Registration setup delivery

- Before the first setup request, the SDK durably records a random
  `registrationOperationId`, scoped to Gateway URL, publishable key, environment
  and the normalized registration request. Matching retries and concurrent tabs
  reuse that operation after a lost reply or reload. Storage failure prevents
  the request from being sent.
- The local journal stores digests and operation/accepted wallet/ceremony IDs.
  It never stores the publishable key or authentication proof. A later setup
  response cannot change an already accepted wallet or ceremony.
- Successful local registration publication clears that exact wallet/ceremony
  from the setup journal, including publication resumed after a reload. Failed
  cleanup cannot undo an already committed registration.
- Setup consumes the authoritative reservation for its authenticated tenant,
  Origin and normalized request. A replay returns the winning wallet, ceremony,
  founding IDs and preparation facts. Replaying setup after registration advances
  must preserve the current ceremony state. A changed request conflicts; replay
  does not extend the original setup expiry.
- Hosted setup fails closed without its reservation authority or at a different
  physical D1 resource. The local standalone host provides a persistent local
  authority for development.
- After a committed registration receipt, Console must confirm the wallet's
  established state before ceremony cleanup. A lost completion reply is reconciled
  idempotently. Definitive registration cancellation records the terminal outcome
  before local deletion; cancelled operations cannot resume. Established setup
  replay returns the saved response without recreating a mutable ceremony.
- Candidate setup forwarding occurs after publishable-key, Origin and policy
  admission. It selects a fixed regional service binding from Console's assignment;
  the receiving service rechecks admission and never forwards again. Unknown,
  cancelled, mismatched or unavailable homes fail closed on the covered paths.
  Shared identity routing, deployment-set activation, expiry reconciliation and
  explicit fresh attempts remain release gates.

### Hosted recovery/export lifecycle routing

- Direct Yao recovery and export entry requests resolve the scoped wallet home.
  Opaque recovery execute/activate and export execute requests resolve an immutable
  lifecycle route within that tenant and operation kind. A Wallet Session, when
  supplied, must belong to the same wallet. Receiving Gateways recheck the home.
- The admitted home writer publishes lifecycle ownership after authorization and
  before backend admission. Identical publication retries preserve ownership;
  another wallet or physical writer cannot take over a claimed lifecycle.
- Publication failure returns an explicit conflict or temporary-unavailable result.
  Routing metadata grants no authority: proof, expiry, revocation and one-use state
  remain enforced at the wallet home. Metadata left after a failed local commit
  remains inert and cannot be reassigned to another wallet.
- The candidate's private regional composition contract verifies lookup, publication,
  races and failure responses. Full hosted Yao execution remains a release gate.

### Explicit-wallet Google login

- A Google login request carrying `wallet_id` selects that exact wallet and routes
  to its home. The verified account must match its enrollment. A mismatch or
  missing enrollment returns `wallet_identity_mismatch`; it cannot fall back to a
  linked/discovered wallet or start registration. A supplied Wallet Session must
  agree with the selected wallet.
- Registration requests cannot carry a login wallet selection. Discovery without
  a selected wallet remains a separate flow and requires shared provider authority
  before regional release acceptance.

- Email login retains the code challenge's expiry separately from the provider
  flow's expiry. A missing or expired challenge fails before code collection.
  Submitting an expired code fails locally before factor release or wallet unlock.
  Resend can replace that challenge while the provider flow remains active.

### Passkey authentication

Expected behaviour:

- Hosted passkey login/unlock challenge creation resolves the selected wallet's
  home. Before exposing the challenge, the home publishes its immutable scoped
  challenge-ID route. Verification resolves that route and still requires the
  normal home-local WebAuthn proof and single-use challenge checks.
- A conflicting supplied wallet/session fails before consuming the challenge.
  Home-publication failure returns 409 for conflict or 503 for unavailability,
  without writing a local challenge. Auth provider routes require their canonical
  paths; repeated and trailing slash aliases are unsupported.

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
  launch competing generation before the replacement material is available.
  Once material is ready, bounded background refill continues during prepare and
  finalize. Reserving any available item triggers replenishment without waiting
  for the pool to become empty or for the signature to finish.
  Gateway requests remain independent: cancellation of one refill cannot block
  subsequent background ceremonies. Refill scheduling and foreground priority
  belong to the client pool; live Gateway authorization still applies per exchange.
- Deferred mixed-authority publication reconciles ECDSA refill against the newly
  committed authority, including when the session credential is retained. A late
  failure from an older attempt cannot cancel the reconciled refill. Rejection
  without fresh lifecycle reconciliation stops refill without a retry loop.
- For a mixed signer set, Ed25519/NEAR provisioning continues under the same
  authenticated ceremony and publishes one of `near_pending`,
  `near_provisioning`, `near_ready`, or `near_failed_retryable`.
- NEAR admission and Yao execution cannot delay EVM registration or EVM signing.
  EVM activation and the NEAR continuation are saved atomically as separate records.
  Authorized NEAR admission overlaps ECDSA respond. Yao execution starts only
  after its encrypted completion checkpoint is durable.
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
  Finalization applies the prepared server seal and returns it in the same response.
  Preparation creates no signing authority. Temporary keys are consumed once for
  the matching session and factor, or discarded on failure, lock, expiry, or abandonment.
- After NEAR authority publication, passkey session hydration and local signer
  installation may overlap. Durable readiness waits for both; a failed hydration
  retains the repair journal for normal unlock.
- With remaining signing quota, NEAR signing becomes available at `near_ready`
  without a second passkey prompt.
  A retryable provisioning failure remains visible to the caller.
- ECDSA key export remains available while NEAR is pending and requires fresh
  export authorization.
- Passkey registration must not send or verify an Email OTP challenge.
- `auth.unlock(walletId)` resumes pending passkey activation through the ordinary
  unlock flow. Applications do not call a separate registration resume operation.
  Successful recovery emits unlock completion and invokes the normal callback once.
  Explicit NEAR selection waits for NEAR readiness before reporting success.
  Default mixed recovery allows EVM use while NEAR completes in the background.
- Pending activation recovery selects the stored ceremony by wallet identity.
  Applications do not supply a ceremony ID or passkey origin. The executing wallet
  host supplies its origin. Ambiguous activation records and mismatched
  authentication methods fail before activation replay or credential collection.
  Replay verifies committed facts before requesting the exact founding passkey.
- Pending activation recovery uses the configured unlock session lifetime and use
  budget, including per-call unlock overrides. It does not replace them with
  registration defaults. A disabled session policy leaves the pending journal unchanged and fails before activation replay
  or credential collection. NEAR completion preserves the newly issued session's
  remaining budget and expiry.



Failure behaviour:

- If local persistence postconditions fail, registration must not report local
  success.
- If blockchain account creation has already happened, immutable chain-state
  rollback messaging must be separate from local persistence rollback/repair
  messaging.

### Selected signing assets

Generic confirmation preparation during registration or unlock does not load
EVM/Tempo signing modules. A NEAR-only wallet can register, unlock, sign, and
restore signing without the EVM/Tempo operation modules or the secp256k1 and
WebAuthn P256 signing engines. EVM and Tempo operations load their
required signing modules on first use. Shared host chunks can still contain
ECDSA support code; this is separate from operation preparation. Shared custody ceremony dependencies
remain required when an operation creates or verifies a key set.

### Device removal

`devices.remove({ walletId, walletAuthMethodId })` collects fresh authorization
inside the wallet host. The selected active method must differ from the target.
The host binds the proof to the wallet, target, and request timestamp. Applications
do not supply that timestamp, a code, or a raw proof. Network retries reuse the
same authorized request and preserve the management service's recorded result.

### Registration methods

- `registration.addSigner` adds a selected signer to an existing wallet.
- `registration.addEmail` adds email authentication through the existing verification flow.
- `registration.removeAuthMethod` removes a method using proof from a surviving method.
  The React device list uses this operation for both passkey and email authorization.
  The wallet host collects email proof in its confirmation view and binds the
  challenge to the exact removal operation. The application does not collect the code.
- React exposes signer addition as `addSigner`. These operations retain their
  existing authorization, retry, signing, and export behavior.

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
  Authorized NEAR admission overlaps ECDSA respond. Yao execution starts only
  after its encrypted completion checkpoint is durable.
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
- A completed lock in another tab removes the old local session credential.
  A delayed restoration response must leave that credential absent and preserve
  any newer exact session installed by a fresh unlock.
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

NEAR uses `signTransaction` for signing without broadcast, `signMessage` for the
existing NEP-413 message operation, and `sendDelegateAction` for delegate relay
submission. Message inputs and results retain their message, recipient, state,
nonce, account, public-key, and signature contracts. Sign-and-send delegate
orchestration uses the same relay operation. React exposes `signMessage`.


NEAR transaction submission uses `near.signAndSendTransaction({ receiverId,
actions, options })`, including React bindings. A single action is a one-element
`actions` array. Signing and submission failures reject the promise through the
existing send API; callers handle them with `try`/`catch`. There is no separate
`executeAction` operation or wire command that converts exceptions into a
`success: false` result. Confirmation, callbacks, wait status, and nonce reporting
retain the canonical send path's contracts.


EVM and Tempo use `signTransaction` for signing without broadcast and
`signAndSendTransaction` for signing, broadcasting, and waiting for finalization.
React wallet bindings use the same names. Existing result types, payload
verification, review reservations, cancellation, and nonce reporting retain their
contracts. Custom broadcasters report lifecycle outcomes through `advanced`.
Tempo exposes `getFeeToken`, `validateFeeToken`, and `setFeeToken`.
`setFeeToken` submits an on-chain transaction.


ECDSA reusable Wallet Session finalization requires an already admitted prepare
for the exact operation. An authenticated finalize with no matching prepare
returns `authorized_operation_missing` without creating a claim or audit event,
consuming quota, or invoking custody signing. Repeating that finalize preserves
the same state. Existing exact-response replay remains available after quota
exhaustion, subject to live authority and material checks.

A retired reusable Wallet Session cannot prepare or finalize an ECDSA signature.
The Gateway returns HTTP 401 / `wallet_session_invalid`. Retirement is a known
credential state and must not become HTTP 503 / `wallet_session_unavailable`.

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

### Admission expiry

- New step-up claims require matching, unexpired evidence at the atomic
  admission write. Delays during verification, evidence persistence, or database
  execution cannot extend the approved operation's deadline.
- ECDSA factor verification records its completion time and rejects an operation
  or Email OTP grant that expired during verification.
- Exact retries of pending claims require live evidence. Already-admitted work
  may finish after expiry; completed outcomes stay immutable and eligible exact
  retries recover the committed result without another quota debit.
- Expiry before admission or failed verification creates no operation claim and
  preserves Wallet Session identity, quota identity, balance, and expiry. A signing OTP grant
  consumed before expiry rejection remains consumed.

The controlled HTTP contract is `tests/e2e/step-up-expiry.e2e.mjs`; it checks VM
SQLite and local Cloudflare D1 and writes `.artifacts/tla-signing/admission-e2e/after.json`.

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

- Target passkey creation and verification run on the configured wallet origin.
  A cross-origin wallet iframe never forwards those operations to the parent
  application origin.

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
- Successful linked-device activation schedules bounded ECDSA presignature refill
  under the new device's exact Wallet Session and installed holder. Linking returns
  without awaiting pool readiness. The first signature uses completed background
  material when available; preprocessing consumes no signing quota and does not
  authorize the signature itself.
- Canonical, directly linked, and subsequently linked devices can each sign
  repeatedly under their own live Wallet Session. Switching the client presign
  worker to linked-holder authority retires its previous authority channel;
  subsequent inventory reads preserve the active linked material.
- Device inventory is derived from active wallet authorities with
  device-link provenance and their exact auth methods. A completed link
  session is temporary workflow state and is deleted after acknowledgement.
- Losing the final acknowledgement reply after server cleanup preserves the local
  activation completion. The target retries the exact acknowledgement with a fresh
  device proof and completes its authenticated state and success event without
  repeating signer installation or target-factor activation. Final acknowledgement
  has up to three attempts with fresh proofs, independently of an earlier
  activation-response retry; two lost final replies must still complete after
  activation itself was replayed.
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

- `waitForReceipt(submission, options?)` polls the configured chain RPC after
  validating its chain ID. It resolves to `confirmed` or `reverted` only after a
  receipt matches the submitted hash and account, with valid status and block.
  Confirmation means inclusion in one block, without a chain-finality guarantee.
- Receipt polling defaults to 90 seconds and a 1.25-second interval. Callers can
  supply `timeoutMs` or `signal`. Timeout, cancellation, unavailable RPC, missing
  configuration, and unverified receipts return `unresolved`; none cause resend.
  Cancellation follows the shared RPC wait behavior; an in-flight request can
  complete before cancellation settles.

Receipt behavior: `tests/wallet-ui/external-evm-receipt.browser.test.ts` produces
`receipt-observations.json` with outcomes and RPC counts.

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

### Hosted external identity authority

Hosted Gateway identity links share one authority within authenticated tenant
scope. Competing regions cannot claim the same provider subject for different
wallets. Existing explicit sole-identity move and unlink rules apply across
regions. An unavailable authority fails the operation without a regional fallback.
Provider proofs are verified before identity-dependent authentication; wallet
placement remains per wallet. Private regional composition covers storage and
scope isolation; verified-provider discovery forwarding remains an R152 gate.

### Google discovery and wallet homes

A Google login without an explicit wallet selection verifies its provider proof
before looking up the shared identity mapping. An existing mapping routes to the
wallet's assigned home, including when the request arrives in another region.
Invalid proof, a missing home for a linked identity, conflicting Wallet Session,
or unavailable authority cannot select a regional fallback. The receiving Gateway
rechecks ownership and cannot forward a second time. Registration of identities
without an existing mapping remains a separate R152 acceptance gate.

### Shared Google registration offers

Concurrent hosted offer requests for the same provider, email, owner-proof binding
and runtime scope reuse one pending attempt, wallet identity and candidate list
across regions. Regional retries read the same authority. An explicit restart
abandons the current offer; subsequent retries use its replacement. A delayed
update cannot revive a terminal or deleted offer, or downgrade finalized state.
Authority failures and mismatched runtime-policy scopes reject the operation.
Private regional composition covers these guarantees; candidate selection and
registration-completion concurrency remain R152 acceptance gates.

### Google registration candidate claims

After proof and scope validation, issuing registration authority claims one offer
candidate for the verified registration-intent digest. Identical retries reuse
that claim. A different candidate or intent cannot reuse the offer; stale writes
cannot change its selected wallet. Restart is permitted before candidate claim and
is rejected after the claim. Missing, terminal or expired offers cannot be claimed.
Shared-store concurrency is covered by private regional composition; full ceremony
completion and expiry/home reconciliation remain separate acceptance gates.

### Google registration completion

Registration completion atomically publishes the claimed wallet's provider link
and marks its offer active within the identity authority. Failure rolls back both
writes. Completion requires a live claimed offer; a conflicting multi-identity
owner prevents publication. Concurrent and later acknowledgements succeed only
while the active offer and identity link match the requested wallet. Pending-offer
expiry cleanup preserves completed offers for acknowledgement retry. Generic
record updates cannot bypass this transaction to activate an offer.

Regional custody persistence and shared completion still require R152 interrupted
registration/home-reservation acceptance before release.

### Resuming shared completion after a wallet commit

A claimed offer is retained when its offer expiry elapses so cleanup cannot erase
possible committed wallet work. Post-commit completion requires the original
verified registration-intent digest. Hosted completion also requires the assigned
home writer and a non-cancelled home assignment. Normal offer completion still
rejects an expired pending offer. Full interrupted registration and authoritative
terminal cleanup remain R152 acceptance gates.

### Claimed-offer cleanup boundaries

Shared offer authority exposes no unrestricted delete operation. Automatic
malformed-record cleanup removes only unclaimed offers. An expired pending claim
continues to occupy its offered wallet identities until authoritative reconciliation,
so ordinary allocation cannot treat it as abandoned merely because time elapsed.

### Hosted terminal registration and rate-limit authority

Only the assigned regional writer may establish or cancel a wallet home.
Cancellation atomically releases pending shared Google registration offers and
retains the immutable home tombstone. An active shared offer prevents cancellation.
The writer must reconcile regional custody before choosing a terminal outcome.

Hosted Email OTP challenge, verification, grant and Google-registration policies
consume counters in shared tenant authority. Requests through different regional
Gateways share an allowance; tenant scopes remain independent. An unavailable
shared counter fails the request without a regional counter fallback.

### Hosted passkey ownership reservation

Before a hosted regional credential-binding write, the assigned home writer claims
tenant + relying-party ID + credential ID for the wallet in shared authority.
Registration, adding a passkey, recovery and linked-device installation use this
boundary. A competing wallet cannot acquire the claim. The original wallet and
home may retry. Shared-authority failure prevents the regional binding write.

A claim alone grants no authentication or custody authority. Local authenticator,
method and custody state must still commit and pass their existing checks. Claims
survive uncertain regional outcomes and have no automatic expiry or reassignment;
terminal reconciliation and committed discovery publication remain release gates.

### Claimed passkey homes and account sync

A reserved home with a passkey ownership claim cannot be cancelled by the ordinary
terminal-completion operation. Shared authority cannot infer whether its regional
binding write committed. Claim insertion and cancellation are mutually exclusive;
a cancelled home cannot later accept a claim. The original owner may retry or
establish the retained home. Releasing retained claims requires authoritative
regional reconciliation, which remains a hosted release gate.

Hosted account sync stores its single-use challenge in shared tenant authority.
Known-wallet options retain the wallet scope; wallet-less options omit a credential
allow-list. Verification resolves the credential claim within the challenge RP and
tenant to its immutable wallet home. Only that home's writer may consume the
challenge. Claims provide routing only: the home verifier must find a committed
binding and active auth method and verify WebAuthn before returning wallet identity
or session authority. An uncommitted claim cannot authenticate.

A consumed challenge cannot be recreated by a creation retry. Expired challenges
cannot resolve or be consumed. An exact creation retry is idempotent while the
challenge is live. Directory outages return a typed unavailable result and never
fall back to regional challenge state. Standalone sync retains its local store.

### Hosted linked-device request-proof replay authority

Hosted Gateways consume linked-device request-proof nonces through one authenticated,
tenant-scoped Console authority. A valid signed request may be accepted once across
regional Gateways. Invalid signatures and expired proofs are rejected before nonce
consumption. Shared authority unavailability returns HTTP 503; it must never fall
back to a regional nonce store. A lost acknowledgement after consumption requires a
fresh signed request with a fresh nonce. Separate project scopes remain independent.
Standalone deployments use their configured local nonce authority.

### Hosted linked-device bootstrap and claim home

Unclaimed hosted QR sessions live in one tenant-scoped Console authority. Creation
and polling through different regional Gateways see the same record. An exact
creation retry preserves the existing state. After claim, creation retries resolve
to the assigned home and return current session state; a cleaned-up session returns
a conflict without replaying the frozen shared claim snapshot. Claim and preclaim cancellation or
expiry race at this authority; only one terminal bootstrap transition succeeds.

After owner authorization and QR validation, claiming atomically binds the session
identifier to the owner's wallet and commits the winning claim snapshot. Competing
wallets cannot rebind it. Conflict returns 409; authority unavailability returns 503.
Generic lifecycle publication cannot create a linked-device binding. Cancellation
before claim leaves no binding; cancellation after claim retains the binding.

The admitted home imports the winning session, claim transcript and durable import
receipt in one local transaction. A failed import can be retried. Lost replies from
either authority can be retried without creating a second claim. The import receipt
survives session cleanup so a delayed read cannot recreate a deleted session.
A different regional writer cannot import the claimed snapshot. Standalone
composition uses its configured local session store.

Claimed polling, approval, target preparation, credential/contribution, Email OTP,
receipt, cancellation and export-root requests route to the assigned wallet home.
A supplied Wallet Session must belong to that wallet. The directory grants routing
authority only; home handlers verify each owner/device request and transition.
Owner-session handlers independently compare the authenticated wallet with the
durable claim before returning contribution preparation, invoking source execution,
or accessing export-root transfers, including when called without regional dispatch.
Source preparation and execution reject cancelled, expired and failed-before-commit
links with 409 `invalid_state` before preparation lookup or Router dispatch. A
terminal link must not appear to be waiting for preparation with a 204 response.
Export-root recipient/package reads and writes also reject those terminal states
with 409 before parsing or accessing relay data. Recipient registration must match
the persisted target preparation's wallet, enrollment, device, factor, wallet key,
revocation epoch, application binding and registered public key. A signed request
with different binding facts receives 400 without creating a relay record. Recipient
insertion checks current session state atomically in D1: a request admitted before
cancellation cannot recreate the relay record after terminal cleanup commits.
Full linked-device installation remains a hosted acceptance gate.

### Linked-device target preparation concurrency

Concurrent target-preparation requests for the same approved session and delivery
recipient converge on one durable preparation. Fresh planner challenges and
auth-method IDs from losing insert attempts do not make an identical request fail.
Each response validates the persisted winner against the approved session; a
different delivery recipient returns a conflict. Subsequent retries return that
same preparation without allocating another durable challenge. Preparation
insertion checks the current session state atomically in D1. A planner admitted
before cancellation cannot recreate preparation after terminal cleanup commits;
it returns a conflict and leaves the target-credential table empty.
Target-credential commit reservation acquisition also checks current session state
atomically. An admitted registration cannot acquire a new reservation after
cancellation. If no reservation remains, registration returns a recoverable failure
without recursively retrying acquisition or entering verification/source work.
Email OTP grant issuance likewise checks the current session state in its INSERT.
If cancellation commits first, verification returns a refusal without a grant token.
Both new- and existing-enrollment verification propagate that refusal. Grant
consumption remains a single-use transactional state change.


### Application session subscriptions

`seams.auth.onSessionChange(listener)` publishes the complete reconciled
`WalletSession`. A subscription made before connection receives its first state
when the host is reconciled. A subscription made after connection requests the
current state. Subscribing alone does not open the connection. Later host
observations can repeat a state.

A newer observed wallet selection or authority revision supersedes older pending
read results. Reconnect retains subscribers and reconciles the new host; responses
from an earlier connection cannot publish. Unsubscribe and client disposal stop
pending delivery. A listener failure does not stop other listeners. Connection
failures belong to `connection.onChange`; they do not invent a signed-out session.
React consumes this subscription without an additional session read per event.


### Connection and operation preparation

The React provider connects on mount through `connection.connect`. It has no
separate idle prewarm lifecycle or `eager` option. Application clients have no
`prewarm` or `prefetchBlockheight` method. Their operations acquire the connection
through the same coordinator.

The wallet host owns required preparation for each selected operation. Keep
registration's signer-selection preparation, Email OTP Yao preparation, and
first-use worker/WASM initialization. Removing an unused generic preparation
entry must not remove these dependencies or create an all-signer startup path.

Opening a registration menu while its account-name input is empty must not
speculatively import unrelated signing implementations. The menu keeps its UI and
input-validation lifecycle. Once registration preparation has a valid input, the
existing selected-signer ceremony owns required crypto preparation. Cancellation
must not terminate shared workers or discard durable signing material.

Wallet creation uses `registration.registerWallet` in the client and explicit runtime,
and `registerWallet` in React. The request declares the authentication method,
wallet identity allocation, and signer selection. Passkey and Email OTP proofs
remain distinct branches of the existing authentication input. NEAR-only,
ECDSA-only, and combined signer selections use the same creation operation.
Chain namespaces do not expose separate wallet-creation calls. Registration
callbacks, pending NEAR results, and durable continuation retain their contracts.
Email OTP enrollment belongs to `registration.registerWallet` and
`registration.addEmail`. Applications do not request an enrollment challenge or
finalize enrollment separately. Custom authentication UI uses the existing flow
contract; the SDK retains challenge acquisition and factor preparation internally.

`registration.getNearAccountState` reads the wallet's NEAR provisioning state.
`registration.onNearAccountChange` observes its transitions.
`registration.waitForNearAccount` subscribes before reading current state, so it
cannot miss a readiness event between those operations. Omitting `timeoutMs`
uses 120 seconds. Explicit timeouts and abort signals remain supported. The wait
returns ready, retryable failure, or timeout; abort rejects and releases its
subscription. A pending NEAR account does not block available EVM-family signing.


Custom email-code UI requests delivery through `auth.requestEmailCode`. Use
`{ method: 'google', idToken, target }` for Google, or
`{ method: 'email', walletId, email }` for an existing local email method.
The successful result contains a host-owned challenge flow. Submit the code with
`auth.unlockWithEmailCode({ challenge: result.value, code })`.
The host retains the exact wallet, method, signer selection, and unlock purpose.
The SDK handles ECDSA, NEAR-only, added-method, and pending activation internally.
Operation-bound signing and device-removal proofs remain internal to their operations.

A challenge supports `resend()` and `cancel()`. Successful resend replaces the
old challenge. Expired or cancelled challenges cannot unlock. One operation can
use a challenge at a time. Cancellation before submission retires the challenge.
Cancellation during submission rejects because the host already owns that operation.
A successful submission ends the flow. Recoverable failures permit a retry while
the challenge remains valid. The hosted Google flow uses the same execution path.

### Persist local execution generations

The D1 execution-authority adapter records the generation admitted for registration.
Registration completion enables local execution. A lost local completion write can
resume from the registration authority's confirmed completion, using the same
wallet, ceremony, and generation. A conflicting registration cannot replace it.

Destination preparation installs the move's next generation as inactive.
Verified destination activation enables it in the same database transaction.
Source session retirement permanently closes its local generation. Cleanup retains
that execution record. A late registration reply cannot reopen the source.

Ordinary reads through this adapter use local storage. They reject missing,
inactive, retired, or differently scoped homes. They do not query Console or derive
an ownership generation from a signing key, cipher identity, or client connection.

### Restore authorization history during relocation

The internal restore path accepts authorities, auth methods, session quotas,
retired primary sessions, retired hosted credentials, and issued or consumed
exchanges. It also accepts scoped step-up evidence, completed operations, and their
terminal audit records. It preserves enrollment, identities, original expiry,
retirement, redemption, quota facts, and exact response status, content type, and body. SQLite decodes and inserts each assembled record,
so large integers do not pass through JavaScript numbers.

Each record, its exact stored-value check, and its acknowledgement commit
atomically. An exact retry returns the original acknowledgement. Changed content
or wallet scope is rejected. Ordinary lifecycle, identity, and parent guards stay
installed. A temporary context permits one exact historical insert.

The destination rejects ordinary changes to imported records while admission is
closed. Imported quotas receive this protection before their parent sessions
arrive. Import cannot close while an imported quota lacks its retired wallet
parent. Each imported operation must have its matching terminal audit before import
closes. Restoring history never claims an operation, consumes quota, or creates a
second audit. Imported step-up evidence cannot authorize new operations, even after
activation and before its original expiry. Exact retries of completed step-up
operations return the stored result. Retired Wallet Session credentials stay rejected.
Closing import rejects new records and preserves exact retries. Closure
does not verify the complete snapshot or activate the wallet.

`tests/e2e/authorization-storage-transfer.e2e.mjs` owns this D1 component contract.
It feeds exported snapshot records into production restore for all nine tables.
It verifies two-device retirement, exact values, large integers, rollback,
concurrent retries, inactive admission, and an unaffected neighboring wallet.
The record boundary accepts assembled records up to 2 MiB. The existing bounded
intake verifies the authorization manifest. Larger records require separate work.

### Settle Gateway ceremonies before session retirement

The authorization destination remains inactive after import verification. Its internal
activation route requires a live Console command for the cutover phase. That command
includes the pinned authorization manifest and destination verification receipt.
Activation atomically stores its exact receipt and opens ordinary authorization
writes. Repeated commands return the same activation time and digest.

The authorization storage E2E verifies that incomplete imports cannot activate,
Console denial prevents activation, and handler restart preserves the receipt.
After activation, a fresh session can be issued through the authorization service.
Transferred retired credentials remain invalid. This component check does not prove
fresh factor authentication, other participants' activation, or complete relocation.

Source authorization cleanup requires the Console's destination-activation receipt
and pinned authorization manifest. Each call deletes at most 16 selected rows and,
for session rows, their associated quotas in the same transaction. It deletes hosted
children before sessions, then auth methods and authorities. It also removes obsolete
import receipts and snapshot payloads. Source fences and exact completion metadata
remain durable. Other stores must remove dependent linked-device records before
authorization cleanup can remove their parent sessions.

The storage E2E interrupts deletion, resumes through new handlers, and verifies exact
completion replay. It checks quota removal, neighboring-wallet isolation, continued
destination session use, and refusal to issue a session at the cleaned source.

The Gateway commits each ceremony's wallet activity index with its lifecycle state.
Session retirement rejects wallets with unsettled registration, recovery, or export
work. Gateway registration admission must finish its local claim. The Router separately
requires execution and activation consumption to finish. Gateway finalization and
deferred provisioning must complete their durable operation journals before session
retirement. Recovery must reach promotion
or supersession. Export must reach completion. A stored failure alone does not prove
that its external effects settled.

The internal freeze command returns a repeatable pending response while this work
remains. It retires no sessions and seals no snapshot. Admitted work can finish while
the command waits. Retirement and new pending ceremony writes exclude each other in
one database transaction. A delayed admission cannot reopen work after retirement.

`tests/e2e/authorization-storage-transfer.e2e.mjs` verifies pending replies across
handler recreation, atomic retirement rejection, settlement, delayed admission
rejection, and completion through the original freeze command. It also verifies that
completed Gateway admissions permit local freeze, interrupted operation journals
delay freeze, and exact operation retries remain readable after freeze. Other participant
work and automatic reconciliation remain separate requirements.

Wallet Session operation claims also block session retirement until each operation
has a terminal result. The claim's exact session scope identifies its wallet.
The database rejects retirement if a new claim arrives after the pending check.
Failed completion leaves the claim pending and permits another completion attempt.
Another wallet's pending operation does not block retirement. After retirement,
the obsolete session cannot claim another operation.

The storage E2E verifies this race through the production claim and completion store.
It preserves completed responses at the source and repeats the original freeze command.
Step-up evidence stores its project and environment when verification completes.
Pending step-up operations block retirement through that stored scope. Evidence for a
claimed operation cannot change owner or disappear. Retirement rejects new claims,
even when their evidence has not expired. Completed step-up responses remain readable
through exact retries at the source. Another environment cannot use their stored claim.

`tests/e2e/step-up-expiry.e2e.mjs` verifies settlement and rejection through the production
HTTP admission and SQL store on Node SQLite and local Cloudflare D1. Its backend result
is symbolic; it does not establish cryptographic signing after a move. The migration
preserves existing evidence and claims when persisted signers identify one scope.
Missing evidence or ambiguous scope aborts migration without removing historical rows.
The authorization transfer includes these evidence sets, completed operations, and
matching audits. It rejects pending operation restore and freezes the source records.
Cleanup deletes audits and operations before their evidence or session parents.
The storage E2E preserves a response larger than one chunk, interrupts its import
acknowledgement, and checks exact results before and after destination activation.

### Reconcile Router execution while relocation drains

Router physical objects include the wallet's ownership generation. Ordinary commands
and source freeze use the admitted source generation. Destination preparation, import,
and verification use the destination generation. Export reads the frozen source object.
Returning to a prior region prepares a fresh object without changing its old source
snapshot. A prepared object stays inactive, including after a Router restart.

The local Router HTTP E2E verifies return preparation beside a frozen source, exact
preparation replay after restart, and rejection of work at the inactive destination.
This check does not establish complete wallet relocation.

The Router's authenticated internal transfer endpoint has separate activation and
cleanup commands. Its caller must authorize activation after directory cutover and
forward the destination's activation receipt before source cleanup. The complete
coordinator integration remains required.

Activation requires the exact locally verified snapshot. Its durable acknowledgement
and admission change commit together. Cleanup deletes at most 16 source records per
call, including old import segments. It preserves a tombstone that rejects ordinary
work. Cleanup retries resume after restart. A delayed activation retry returns its
old acknowledgement without reopening a source frozen or cleaned by a later move.

The local Router HTTP E2E transfers consumed registration history to generation two,
activates it, and returns it to generation three. It verifies exact consumption
results, rejection before verification, authenticated commands, independent cleanup,
and restart during bounded cleanup. This is Router-role evidence, not evidence of
post-relocation signing or a complete wallet move.

Each authenticated Router freeze call can reconcile one expired registration claim.
The Router uses the exact stored request and its existing claim-generation rules.
A live claim keeps its lease. A resumed old execution cannot replace the result
recorded by the takeover execution. Expiry permits reconciliation; it does not
prove that the work settled.

Completed registration still waits for Gateway activation consumption before the
Router seals its snapshot. Repeated freeze calls preserve that completed result.
The local worker HTTP takeover scenario verifies real Deriver completion, an
interrupted reply, freeze-driven takeover, refusal of the old run's result, and
exact result replay without another pair. Gateway finalization and recovery/export
reconciliation remain separate requirements.

### Freeze authorization history before relocation export

After admitted work settles and all wallet sessions retire, the internal D1
freeze operation preserves authorities, auth methods, primary sessions, hosted
credentials, exchange history, and their session quotas. It rejects subsequent
inserts, updates, identity changes, and deletes for that wallet. Retirement alone
does not establish this stronger freeze.

The freeze and its identity guard commit atomically. Concurrent and restarted
exact retries retain the original freeze time. A different move cannot replace
the fence. A failed freeze leaves these records mutable. Unrelated wallets can
continue to issue and use sessions.

`tests/e2e/authorization-storage-transfer.e2e.mjs` owns this component contract.
Its scenario retains record counts and digests after attempted delayed writes.
This fence does not attest other stores, a complete snapshot, activation, or
source cleanup. The coordinator must collect every participant's evidence before
it seals the common snapshot.

### Capture and export frozen authorization history

The internal snapshot operation requires the authorization source fence. It captures
all nine covered record families in a fixed table and column order. SQLite encodes
each row before JavaScript receives its bytes. This preserves integer precision,
nulls, and the exact contents of stored JSON strings.

Capture persists segments of at most 32 KiB with an ordered digest chain. The
schema and initial digest bind the wallet scope, move, and source generation.
An interrupted capture retains completed segments. An exact retry resumes from
the last durable chunk without replacing completed segments. Export remains closed
until all records are captured and the snapshot is sealed. Sealed snapshots retain the same manifest and bytes
through concurrent calls and store recreation.

`tests/e2e/authorization-storage-transfer.e2e.mjs` verifies interruption, concurrent
capture, exact export, a record larger than one segment, and an integer beyond
JavaScript's exact range. The transfer scenario consumes exported snapshot records.
All nine authorization tables use production restore. This component contract
does not establish a complete wallet move or signing after relocation.

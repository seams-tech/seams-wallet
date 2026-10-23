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

## Wallet display language

The SDK supports English (`en`) and Japanese (`ja`). English is the default.
Applications set `appearance.locale` in the SDK configuration.
Raw URL or browser language tags pass through `normalizeWalletLocale` at the application boundary.
Japanese regional tags select Japanese. Unsupported language tags select English.

The resolved appearance crosses the wallet iframe configuration boundary.
Locale changes do not replace signing sessions or change authentication, custody, budgets, or transaction data.
SDK controls, notices, accessible labels, and security warnings use the selected language.
Brand names, account identifiers, addresses, method names, and raw transaction payloads retain their values.
Applications translate their own custom copy. Unknown external service details retain their original text.

The catalogue requires a Japanese translation for every message key.
`tests/typecheck/wallet-locale.typecheck.ts` checks supported locales and message selection.
Existing browser and lifecycle contracts continue to enforce their original behavior.

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

## Wallet relayer configuration

The wallet host uses the relayer URL from the application's SDK configuration.
Its HTML document does not require a separate relayer-origin declaration.
Changing the execution configuration cancels work tied to the previous configuration.
An appearance change preserves that work. Invalid configuration remains rejected.

Browser enforcement: `tests/wallet-iframe/config.execution.test.ts`.

## Local VoiceID approval (prototype)

The wallet origin controls VoiceID through `/sdk/voiceid.html`. Enabling it
requires a ready local enrollment. The application cannot set this preference
through the wallet message protocol. This prototype supports one reviewed NEAR
testnet transfer per request. Other signing routes and reviews without an expiry
fail when VoiceID is required.

The wallet freezes and hashes the complete request and execution configuration.
The hash includes the wallet, transaction, request, connection, surface, review
generation, network, and expiry. Selecting Confirm starts one native voice check.
The result must match its attempt, operation hash, and exclusive deadline.
The existing signing boundary consumes the approval once. The existing wallet
session, authorization, quota, and MPC checks still apply.

Cancellation, lock, execution changes, settlement, expiry, and a changed VoiceID
preference invalidate pending approval. Another request requires its own approval.
VoiceID failure cannot choose an automatic approval path. Audio, transcripts,
speaker embeddings, templates, and wallet secrets do not cross this bridge.
The native result grants no server authentication or signing authority.

The MVP assumes a user-controlled device and OS. Spoof detection, camera input,
and standalone voice authentication remain outside this profile.

The public browser contract is
[`voiceid-approval.browser.test.ts`](../tests/wallet-ui/voiceid-approval.browser.test.ts).
It uses a deterministic perception boundary and writes a JSON evidence attachment.
The composed Wallet contract is
[`passkey.voiceid-near.contract.test.ts`](../tests/e2e/intended-behaviours/passkey.voiceid-near.contract.test.ts).
It uses real owner registration, passkey unlock, and Ed25519 Yao signing.
The test verifies the signed transfer against the registered public key.
Its NEAR RPC response is deterministic and does not confirm an on-chain transfer.
Denied preparations retain their spent quota use. Owner unlock replenishes the
session before the approved retry.

The same contract makes every broadcast reply unavailable after signing.
The SDK retries the identical signed bytes without another MPC signature.
The final broadcast error rejects the send promise and preserves spent quota.
A subsequent review requires fresh voice approval. Cancelling that voice check
prevents another signature and broadcast. The unavailable replies establish no
on-chain outcome.

The private repository owns the real extension, native models, capture, and
composed native/browser evaluation.

## Worker preparation

A fresh signed-out wallet host with no pending registration or recovery work
must not create signer or custody workers merely because the runtime is
constructed, the provider mounts, or a generic auth menu opens. Configuring
multiple chains does not select all of their workers. Confirmation UI assets
may load independently.

While the wallet origin stores no wallet, the host answers the connection reads
from its boot code: the current-wallet session read (`wallet_locked`), recent
unlocks (empty) and the confirmation preferences (defaults). It does not download
the wallet runtime for them and does not create its database. "Stores no wallet"
means that the wallet database is absent or holds no record. If the host cannot
prove this, the runtime answers. The first other request loads the runtime, and
from then on the runtime answers every read. `authMenu.prepare()` downloads the
runtime ahead of a sign-in; applications call it on sign-in intent.

Selected operations own signer and custody worker preparation. Passkey registration
with NEAR starts the NEAR signer worker and Yao Client initialization during preparation.
This warmup loads code without signing or installing wallet material. A preparation
failure does not replace the real operation's initialization check.

A failed WASM load must support retry in the same worker when asset delivery recovers.
Concurrent requests share initialization. Subsequent requests reuse the initialized module.
A thread-ready notification alone does not prove successful crypto initialization.
Worker reuse, cancellation, and durable presignature validity retain their existing contracts.
The NEAR registration contract checks failed worker warmup followed by two verified signatures.

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

- `AccountMenuButton` uses one fixed-width panel for overview, account addresses,
  export selection, recovery entry, authentication methods, linked devices, and
  QR scanning. Back returns to the previous screen. Transaction preferences
  have their own resizing screen. Closing the panel resets navigation to the overview.
- Screen changes animate the panel's measured height. Interruptions retarget from
  the current height. Reduced motion disables resizing motion and keeps a content
  fade. The panel does not introduce an overlay backdrop for its nested screens.
- Sensitive recovery backup and key export retain wallet-origin authentication and
  confirmation. The account menu never renders secret material in host-origin React.
- `AccountMenuButtonMock` shares the panel, navigation, and display components. All
  sample actions stay local; it makes no wallet requests and opens no camera.
  Completing the recovery preview requires an explicit saved-codes acknowledgement;
  copying or downloading does not check the box automatically.
  Its recovery preview shows four distinct 16-digit sample codes. Authentication methods opens directly for
  the current wallet and displays each enrolled method as its own row. Device
  inventory stays under Linked devices; methods are never a preference toggle.
  Export keys opens shared NEAR/EVM selection; preview choices display an
  authentication-required summary without exporting secrets.

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

- Reusable-session ECDSA prepare returns the exact active session projection
  validated for admission, including its pre-claim quota balance. The SDK reconciles
  this projection before committing the client presignature or computing its share.
  Signing requires no separate post-approval session-status request. Prepare still
  checks live revocation, expiry, policy, material identity, and atomic quota admission.
  An unavailable prepare or mismatched projection stops signing before finalization.
  Finalization retains its independent live authorization checks.
  A projection that prepare read before a NEAR-only authority extension names the
  same session on the authority that was extended. It reconciles with the rebound
  local session, and that signature completes.

- An admitted ECDSA or NEAR prepare claims one use of the balance it reports. The
  SDK records the balance that claim leaves as its local session observation, and
  the next confirmation plans against it. When the claim takes the last use, the
  next signature plans same-method step-up before the user confirms. That plan
  shows one confirmation and needs no session-status request.

- A warm-session NEP-413 or delegate-action signature sends its prepare when the confirmation
  dialog opens, bound to the digest the dialog shows and to the signing digest.
  The signature consumes the answer after the confirmation. A declined
  confirmation, a changed digest or a step-up leaves that prepare to expire
  with its lease, and the use it claimed stays spent. A step-up signature
  sends no prepare before the user confirms.
  A delegate action binds its displayed receiver and ordered actions, plus the
  complete signing digest, including nonce, expiry and signing key.

- A warm-session NEAR transaction sends its prepare while the confirmation
  dialog is open, as soon as the confirmation has reserved the nonce and block
  hash. The binding and the expiry rule are those of the message signature. The
  confirmation releases the reserved nonce on a decline, as before. An account
  that still needs funding and a step-up signature send no prepare before the
  user confirms.

- Another tab or device can use a shared session's quota. When prepare then
  refuses the session and asks for step-up, the SDK drops its local observation
  of that session, and that signature continues with step-up. The next plan
  reads the server status once. Later signatures plan step-up before the user
  confirms and send no prepare under the refused session.

- NEAR signing uses an existing, identity-matched session observation to select
  its lane. Repeated signing needs no separate session-status request while that
  observation is available. Prepare returns fresh authority and quota facts, which
  the SDK checks before creating a client signature share. Server admission still
  enforces revocation, expiry, policy, and quota. An exhausted session requires
  operation step-up. Missing observations after page refresh require a fresh
  status read. Export continues to use its exact authorization reader.

- NEAR signing validates the exact local material and proceeds directly to
  prepare. It makes no separate owner-lane preflight request. Prepare and finalize
  check live session authority, active signer material, policy, and operation
  admission. The SDK checks the prepare response before creating a client share.
  A retired reusable session cannot authorize signing or operation step-up.
  An authenticated unlock can establish a new session after retirement.

- Reusable-session NEAR prepare and finalize evaluate live signing policy for
  the wallet's authority. Project denial takes precedence over abuse denial;
  abuse rejection and rate limiting return their respective errors. Policy
  denial leaves quota unchanged. Policy records of another scope, wallet, or
  authority do not apply.

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
The host also shares an in-flight exact observation between a session notification
and an explicit query for the same wallet, read mode, selection, and authority
revision. Both consumers receive the same observation revision. Each consumer
checks authority and selection again before publication. Subsequent observations
read fresh server status. Signing prepare still verifies current authorization.
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
When validated execution configuration supplies registration credentials, the
iframe host may warm the setup route's CORS preflight. This best-effort OPTIONS request carries no
credentials or registration data and creates no wallet or custody work. A failed
warm-up does not prevent registration. Same-origin and signing-only clients send
no setup warm-up. Appearance updates and equivalent configuration do not repeat
the warm-up. Configuration warm-up precedes lazy runtime loading. Successful registration hydration consumes its temporary client
seal; failure paths still discard any unconsumed preparation before returning.

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
- After a successful login, registration, or account sync, the wallet-origin
  menu confirms the result in place: the wait's ring closes into a check, and
  then the card fades out. The terminal outcome follows the fade, so the app's
  session update arrives after the menu has gone. Closing or unmounting during
  the confirmation ends it at once with the success outcome.
- The adapter emits exactly one terminal `HostedAuthMenuOutcome` for the session.
  Unmounting or closing cancels only that session and leaves direct
  `registerWallet()`, `addSigner()`, and `unlock()` confirmation surfaces
  unchanged.
- A cancel that arrives while the open still waits for the wallet connection or
  its configuration stops the open; the wallet host never shows that menu. A
  menu whose anchor leaves the app document ends as unmounted; it does not move
  to the viewport centre.
- The menu stays transparent until its card reports its measured size. In the
  frame where it appears, the anchor reserves that height, hides the loading
  shell, and carries `data-seams-auth-menu-ready`. The anchor never reserves a
  guessed height first, so the app's layout moves at most once.

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

- Wallet-management requests send `X-Seams-Wallet-Protocol: 4`. This wire
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

- Hosted setup admits at most 30 attempts per minute per publishable key and
  source IP in each regional Gateway database. It returns 429 when exhausted.
  A counter failure returns 503 before reservation or custody startup.
- Passkey setup can prepare the NEAR branch's two custody admissions and peer
  connection, including in mixed registration. The session is fixed at setup.
  Each wallet holds one input-free preparation for at most 30 seconds. Setup
  grants no execution authority. Verified execution binds the encrypted inputs
  and claims both roles before Yao protocol material flows. Each owning wallet
  object durably binds its preparation to one authenticated input before reading
  the unchanged D1 grant. That read checks the current root and cancellation state.
  Input binding survives object restart and refuses a different input for the session.
  Expiry releases only an unconsumed preparation. A consumed grant remains until
  object-first settlement or cancellation closes it. Expired unconsumed preparation
  falls back to online admission. Abandoned preparations release their admissions;
  cancellation and relocation fences cannot be bypassed by a prepared connection,
  including when a fence arrives during a root read.
  Native Worker enforcement: `crates/router-ab-cloudflare/scripts/registration-prompt-evidence.mjs`.

- Setup requires fresh publishable-key validation and the exact active application
  environment. Revoked keys, forbidden origins, and mismatched environments fail.
  Missing or inactive environments also fail before setup issues a signed response.
  Hosts must preserve these checks when combining authentication and environment
  resolution with home reservation. Rejected credentials create no reservation. The Console service-binding E2E verifies durable
  key rotation, revocation, environment changes, and archival.
- A refused setup keeps the server's error code on the SDK error, for example
  `production_paused` when the host stops new production sign-ups.
- After a lost NEAR-only completion reply, credential-free replay may restore
  the committed wallet identity and sealed local material for exact-method unlock.
  When no local session exists, restoration creates a locked selection and installs
  no Wallet Session or operation credential. Publication and journal removal are
  atomic. Existing selections remain unchanged; corrupt session records fail closed.
- Successful setup returns its required `home`: either a direct endpoint or an
  existing regional home. NEAR-only respond, activation and provisioning carry
  that routing hint before a Wallet Session exists. The hint selects a handler;
  the signed setup, tenant binding and current local authority still authorize work.
- NEAR Yao registration admission and execution carry the setup home in both
  NEAR-only and mixed registration. Resumed mixed work uses its session credential
  home. Requests can enter another region without a Console directory lookup.
  Recovery, export and add-signer transports explicitly request discovery when
  their current inputs do not contain a known home.
- Before the first setup request, the SDK durably records a random
  `registrationOperationId`, scoped to Gateway URL, publishable key, environment
  and the normalized registration request. Matching retries and concurrent tabs
  reuse that operation after a lost reply or reload. Storage failure prevents
  the request from being sent.
- The local journal stores digests and operation/accepted wallet/ceremony IDs.
  It never stores the publishable key or authentication proof. A later setup
  response cannot change an already accepted wallet or ceremony.
- After the terminal receipt commits, obsolete ceremony deletion must not delay
  a hosted activation response. Registration and signing can finish while cleanup
  runs through the host's background-task hook. Exact replay remains valid before
  and after deletion. Hosts without that hook await cleanup before returning.
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
- Setup saves the authenticated wallet home generation with its ceremony in one
  local transaction. Continuations use that local execution identity. A missing
  identity fails locally and cannot create one through a directory lookup.
  Setup retries preserve the current ceremony and cannot reopen a retired home.
- Setup stores one set of namespace-issued object addresses per wallet ownership
  generation. Concurrent retries retain the stored winner before custody starts.
  A new generation receives fresh addresses. The Router may retain a bounded
  batch of unused identifiers for its binding environment. Unused identifiers
  contain no authority and create no objects. Restart can discard them safely.
  An allocation failure cannot replace an existing address assignment.
- APAC wallet objects request the Southeast Asia placement hint `apac-se`.
  Registration and relocation use the same hint. Existing object addresses
  remain unchanged. The hint does not guarantee a city; hosted acceptance must
  verify the actual object locations against the deployment's database primaries.
- Setup repeats its ceremony read and its ceremony write after a transient
  fault of the database connection, at most twice and with a short wait. The
  repeat is an exact retry: it stores nothing a second time. When the fault
  persists, setup returns HTTP 503 with the code `storage_unavailable`, and
  the same request can succeed later. Every other internal failure returns
  HTTP 500 with the code `internal`. Both carry a fixed message; the cause is
  logged on the server and never sent to the browser. A rejected request keeps
  HTTP 400 with its own code and message. The SDK reports the fixed message
  and does not repeat setup itself; a repeat by the caller reuses the recorded
  `registrationOperationId`. `registrationSetupTransientD1.unit.test.ts`
  verifies the retry and the three statuses.
- When registration starts, the SDK sends one `OPTIONS` request to each Gateway
  route that the registration calls after setup. A registration with a NEAR
  signer also sends one to each of the two NEAR signing routes. The requests
  carry no body and no credential. They let the browser finish its CORS
  preflight for those routes before their first request. A failed early request
  changes nothing, because the later request runs its own preflight. A relayer
  on the wallet's own origin receives no early request.
- After verifying the ceremony proof and activation identity, NEAR finalization
  can consume Router activation and reserve the passkey credential concurrently.
  Both requests settle before local wallet persistence. A refused or unavailable
  credential claim prevents local persistence. Exact retries retain the original
  activation consumer and credential owner.
- A NEAR-only respond that verified a new passkey starts the same credential
  claim after its admission, while the Yao execution runs. A granted
  claim is recorded in the regional database for that ceremony. Finalization
  sends no claim request when the record names the same wallet, relying party
  and credential. A refused, failed or unfinished early claim records nothing,
  and finalization then claims as before. The record never changes, and the
  cleanup of a finalized ceremony removes it. The claim itself stays in shared
  authority, under the rules for claimed passkey homes.
- Registration finalization starts the recovery-code route claim of its custody
  commit in that interval, for either signer leg. The claim stores no custody
  record, and local wallet persistence does not wait for it. A refused or
  unavailable route claim does not prevent local persistence: the response
  reports the custody commit as rejected, and the client retries it. The custody
  reservation reads existing custody records while the route claim runs.
  After the wallet commit, one local transaction stores new custody records,
  recovery-code locators, and the completion receipt. A failed transaction
  rolls back all those records and leaves the operation retryable. No response
  reports committed custody before that transaction succeeds. An exact retry
  retains existing recovery data and repeats the same route claim.
  A failed finalization settles its started route claim before it responds.
- Registration commits its session and the matching ceremony's established decision
  in one local transaction. A conflicting ceremony or cancelled registration prevents
  this commit. Fresh NEAR-only registration includes its wallet, signer, founding
  authority, auth method, capability, and lifecycle decision in that transaction.
  A failed session write rolls back those records. Concurrent exact retries retain
  the winning session credential and quota. The wallet remains unavailable for ordinary
  signing until the completed registration receipt commits. The Gateway saves that
  receipt, enables ordinary signing and records a pending Console publication in one
  local transaction, so none of them exists without the others. Only after that
  commit does the Gateway publish the session locator and complete the home in one
  Console request; the registration response does not wait for that request.
  Console atomically commits the session locator, established home, and display row.
  A failed or lost publication stays pending, and the Gateway's scheduled job resends
  the original session digest and expiry until Console acknowledges it. A Console
  refusal is final and keeps the pending record for an operator. Until Console
  acknowledges, the wallet is absent from the Console wallet list and cannot move to
  another region, and another region routes the registration session only by the
  home that the credential names. Exact retries preserve later display updates. Definitive registration cancellation records the terminal outcome
  before local deletion; cancelled operations cannot resume. Established setup
  replay returns the saved response without recreating a mutable ceremony.
- Candidate setup forwarding occurs after publishable-key, Origin and policy
  admission. It selects a fixed regional service binding from Console's assignment;
  the receiving service rechecks admission and never forwards again. Unknown,
  cancelled, mismatched or unavailable homes fail closed on the covered paths.
  Shared identity routing, deployment-set activation, expiry reconciliation and
  explicit fresh attempts remain release gates.

### Established-session home routing

- Issued primary and hosted credentials include an explicit direct or regional home.
  Regional metadata names US, WEUR, APAC, or OC. It never contains a destination URL.
  The SDK retains the home when it serializes and restores the credential.
- Signing, refill, and hosted exchange carry the regional hint through their request
  boundaries. The hint selects a configured service binding and grants no authority.
  The receiving home still checks the exact credential, wallet, tenant, ownership
  generation, revocation, expiry, budget, and material state.
- A request can forward once. A missing credential at a hinted or forwarded home
  returns `wallet_home_discovery_required`. It cannot trigger automatic region probing.
  Ordinary authorization failures do not trigger discovery or replay a signing operation.
- Hosted exchange retains the home across the parent-to-iframe message and redemption.
  Its existing origin, nonce, expiry, and one-use checks remain required.

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
- NEAR-only registration completes Yao and confirms recovery backup before one
  finalization request commits its wallet, signer, custody and session. It stores
  one finalization checkpoint for retry. It does not create an intermediate
  wallet without a signer. The same rule applies to Email OTP registration.
  Its authenticated response includes the admitted Yao request and receipt.
  An exact response retry retains the same admission and execution identity.
- Setup mints the Yao identity of a NEAR branch and stores it with the
  ceremony. A setup retry keeps that identity. The identity binds no authority
  and admits nothing. For a NEAR-only passkey registration, the setup reply
  also describes the Yao admission that respond will issue over it. The client
  prepares its execute request from that description while the user answers
  the passkey prompt, and sends it with the proof. Respond verifies the
  proof, stores the admission and runs the execution in that one request. Its
  reply then includes the activation result. No admission exists before the
  proof is verified, and an execute request without that admission is refused.
  Combined respond reuses the admission snapshot that this request committed.
  The separate execute route reads persisted admission. Both paths check the
  credential, binding, and expiry before the Router enforces its execution claim.
- An exact retry of that respond replays the admission and the recorded
  execution. When the execution does not complete inside respond, the reply
  includes the admission alone, and the client sends the same execute request
  to the execute route. That execution may still be running at the Router,
  which then answers that it is in progress; the client waits it out as a
  resumed execution does, below. Email OTP registration and mixed registration receive
  no description: their respond issues the admission, and the execute route
  runs the execution.
- NEAR admission and Yao execution cannot delay EVM registration or EVM signing.
  EVM activation and the NEAR continuation are saved atomically as separate records.
  Authorized NEAR admission overlaps ECDSA respond. Yao execution starts only
  after its encrypted completion checkpoint is durable.
- Reload and uncertain responses retain the exact NEAR attempt. Normal unlock
  with the founding method resumes its saved phase, using fresh session authority
  when the registration grant has expired. No replacement key is generated.
- A resumed Yao execution can reach the Router while an earlier send of the same
  request still executes. The Router answers that the execution is in progress.
  The SDK sends the exact request again with bounded backoff and completes with
  the recorded result. The total delay is at most 15 seconds; a longer execution
  leaves a retryable failure.
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
  Server sealing may overlap home publication after the Wallet Session is durable.
  The response waits for publication and the finalization receipt. It binds the seal
  to the committed wallet, session and expiry. A sealing failure does not prevent
  the registration receipt from committing. The client can recover through normal unlock.
  The server derives each signing-session seal lock key from the committed wallet ID
  and exact threshold session ID. The remove route checks an unexpired Wallet
  Session for both IDs before it transforms the stored ciphertext.
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
- Deriver B can discard unused encrypted registration input when its object
  restarts or its preparation window expires. An exact retry supplies the input
  again. No protocol material may be sent before the role's execution claim is
  durable. A completed registration remains replayable after the Router object
  restarts.
- A completed, validated Deriver A response includes Deriver B's sealed completion.
  Registration must finish while an otherwise successful B preparation reply is
  delayed. Failed A execution still uses B's preparation refusal to preserve the
  retry outcome. The completed result remains replayable after Router restart.
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
- The menu takes the code in its own step and checks only its format on the
  device. The owner then chooses the sign-in method that recovery adds: a new
  Passkey, or Google/Email OTP. That choice sends the code to preparation; a
  refused code returns the owner to the code step with the code kept.
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
- A committed custody registration response reports the server's recovery-code
  issuance time. Locally pending codes bind to that time after the commit.
- Recovery-code status and backup acknowledgement require fresh proof from an
  active full-owner method, bound to the exact request. Acknowledgement names
  the code issuance the owner saw. Rotating the set leaves newer codes awaiting
  their own acknowledgement.
- The browser keeps passkey PRF output local during recovery. Requests carry
  passkey assertions and registrations without defined WebAuthn extension output values.
- Email OTP recovery-code rotation collects separate codes for status, wallet
  seed unlock, and approval of the replacement set inside the wallet. The host
  application supplies only the selected factor kind.

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
- Recovery endpoints refuse passkey proofs and registrations that contain
  defined WebAuthn extension output values before they change wallet state.

## Transaction Signing

A successful NEAR or EVM signature writes one `wallet_signature_completions` row in
the statement that completes its authorized operation. Failed operations, key
exports, and operation history copied by a relocation write none. The hosting
deployment delivers each row to its usage count and then deletes it. A host may
refuse new signatures for a project through the normal-signing project policy
(`project_policy_rejected`); recovery and key export do not read that policy.

NEAR nonce recovery reads current chain state once per exact wallet/key lane in
each recovery pass. It shares that observation across saved nonce reservations.
A later pass reads the chain again. A failed read retains unexpired reservations.
Reload and concurrent-tab coordination must still prevent reuse of an unexpired
signed nonce. Existing expiry and chain-consumption rules remain unchanged.

NEAR reusable-session finalize uses one standalone lookup of the prepared operation
before transactional admission. It checks the receipt against the stored identity,
fingerprint, operation kind, and digests. Fresh transactional admission still checks authority, material,
replay, and quota. An exact retry can replay a completed operation after budget
exhaustion. A retired session cannot replay it. Missing or changed receipts cannot
create a new claim, consume quota, or invoke signing.

NEAR uses `signTransaction` for signing without broadcast, `signMessage` for the
existing NEP-413 message operation, and `sendDelegateAction` for delegate relay
submission. Message inputs and results retain their message, recipient, state,
nonce, account, public-key, and signature contracts. Sign-and-send delegate
orchestration uses the same relay operation. React exposes `signMessage`.

NEAR message signatures follow [NEP-413](https://github.com/near/NEPs/blob/master/neps/nep-0413.md).
The signed Borsh payload contains `message`, the 32-byte `nonce`, `recipient`, and
optional `callbackUrl`, in that order. The digest is SHA-256 of the little-endian
`2^31 + 413` prefix and that payload. The SDK generates and returns the nonce.
It signs a supplied `callbackUrl` and returns the result directly without a redirect.
An omitted `callbackUrl` encodes as the Borsh `None` option.
The SDK returns `state` unchanged, including an empty string. `state` is transport
data and does not enter the signed payload. Changes to message, nonce, recipient,
or callback URL invalidate the signature.
The hosted wallet receipt for a message signature is complete once the signature
exists. It names a message signature, says nothing was sent to the network, and
shows the signer, recipient and message. It has no broadcast or confirmation stage:
the receipt keeps the transaction receipt's three progress tracks, so its height
does not change, fills all three once signed, and labels only the first, Signed.

NEAR transaction submission uses `near.signAndSendTransaction({ receiverId,
actions, options })`, including React bindings. A single action is a one-element
`actions` array. Signing and submission failures reject the promise through the
existing send API; callers handle them with `try`/`catch`. There is no separate
`executeAction` operation or wire command that converts exceptions into a
`success: false` result. Confirmation, callbacks, wait status, and nonce reporting
retain the canonical send path's contracts.

EVM and Tempo use `signTransaction` for signing without broadcast and
`signAndSendTransaction` for signing, broadcasting, and waiting for finalization.
An EVM-family execution reports success only after a mined receipt names the
broadcast transaction hash and has execution status `0x1`. Status `0x0`
reports a revert. A missing or unrecognized status and a mismatched hash do
not report success. An unavailable transaction lookup does not replace a valid
receipt.
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

A retired reusable Wallet Session cannot prepare or finalize an ECDSA or Ed25519 signature.
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

### Regional execution

An established passkey Wallet Session can authorize an exact NEAR or ECDSA
operation after its shared signing budget is exhausted. Fresh factor verification
is required. Exhaustion does not invalidate the identity used for step-up, and
step-up does not renew that session or replenish its reusable budget.

ECDSA step-up requests for signing and key export carry passkey assertions with
`clientExtensionResults: null`. The Gateway rejects any other extension-output
value before it admits the operation.

NEAR signing uses its exact local material to reach prepare after exhaustion.
Prepare and finalize enforce the budget or require fresh step-up authorization.
There is no separate NEAR owner-lane metadata request.

With the regional home and custody services available, this flow must succeed
while Console is unavailable. Requests retain the admitted home and authenticate
locally. Another ingress must forward to that home. A request naming a different
wallet must fail before execution. Revocation, expiry, material retirement, and
ownership fences still apply.

The private composed regional contract verifies three shared-budget signatures,
including concurrent ECDSA signatures, followed by fresh NEAR and ECDSA step-up.
It asserts zero Console requests and five home-owned operation records.

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
- An active owner created through recovery can link a device after reload and
  unlock. Its exact active Ed25519 binding may come from registration or recovery.
  The target always uses a fresh registration binding and preserves the public key,
  stable context, participant identifiers, and root-share epoch.
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
- Linking does not hydrate, recover, rotate, promote, or synthesize missing
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
| Recovered owners link after reload and unlock, preserving signing, export, retries, and revocation               | `tests/e2e/intended-behaviours/passkey.device-linking.contract.test.ts`                                           |
| Google/Email OTP recovery preserves public identities, signs through the fresh authority, and refuses code reuse | `tests/e2e/intended-behaviours/google-email-otp.recovery.contract.test.ts`                                        |
| Tenant-root rotation preserves signing and recovery across operational-share changes                             | Private acceptance coverage: `seams-monorepo/tests/e2e/intended-behaviours/tenant-root.rotation.contract.test.ts` |
| Sibling revocation, inventory UI, and exact Email OTP boundary failures                                          | Private focused coverage in `seams-monorepo/tests/unit` as mapped by the owning change.                           |
| External EVM discovery, connection binding, stale-request rejection, and transaction outcomes                    | `tests/unit/externalEvmController.unit.test.ts`                                                                   |

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

`useSeams()` supplies authentication actions, lifecycle state, and the current
bound `wallet`. Authentication actions remain available while signed out, when
`wallet` is `null`. An authenticated wallet provides EVM and Tempo signers;
its NEAR signer remains `null` until a NEAR account is ready.
Unlock refreshes React state. The authenticated wallet appears in a subsequent
render, and each signing handler retains the wallet that its component rendered.

Hosted React transactions may supply an application review through an explicit
`TransactionReviewHost`. The reviewed `useSeams().wallet` transaction methods retain
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

Hosted Email OTP spam limits use the admitted Gateway's existing regional signer D1.
Wallet-specific counters have explicit tenant and wallet ownership. Foreign ingress
routes wallet requests to the fixed home before consuming those counters.
Relocation transfers counters unexpired at source freeze, preserving counts and
reset times. Snapshot retries use that fixed freeze time. Frozen sources and
inactive destinations reject ordinary wallet counter writes. Source cleanup removes
wallet counters after the destination activates.

IP, organization, provider, and subject counters are regional. They protect flows
before wallet creation and stay in their region when one wallet moves. Requests
served in different regions may receive independent allowances. This approximation
is intentional for spam control. Tenant scopes remain independent. Storage errors
fail the request without a Console or shared-database fallback.

OTP expiration, per-challenge verification-attempt limits, single-use consumption,
and authorization checks remain enforced independently of these spam limits.
No dedicated OTP database, shared counter RPC, or cross-region counter replication
is required.

Email-OTP enrollment and authentication state move with the wallet. The destination
preserves the sealed factor, provider identity, failure count, and lockout deadline.
Frozen sources and inactive destinations reject ordinary enrollment and auth-state
writes. Only the exact admitted import can install destination records. Source
cleanup removes these records after activation. A new destination OTP challenge
must honor the copied lockout and retain single-use verification.

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

One host observation supplies the exact session state and the complete public
`WalletSession`. Reconciliation and capability projection share the same scoped
server-status reads. A lock, wallet-selection change, or authority change during
that observation makes the host discard it and observe again. Each later explicit
`getSession` or `refreshSession` request obtains fresh server status.
Registration publishes that observation before returning. An informational
startup parity check cannot delay session observation or registration completion.
Operations that require sealed-refresh parity still await and enforce it. A NEAR-only
registration's response states the session the server issued as its last step,
so this one observation takes the session's status from the response and sends
no status request. A registration that includes ECDSA observes the server,
because its session changes after the response. React uses its session
subscription to display the registered wallet without another status request.
Signing prepare continues to enforce current revocation, expiry, and quota state.
The iframe protocol requires matching client and wallet-host assets at version 16.0.0.

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
and `registerWallet` in React. The public request declares the authentication
method. Omitting `wallet` selects a server-assigned wallet
ID. An explicit `{ kind: 'provided', walletId }` retains the caller's ID.
Omitting `signerSelection` selects NEAR and EVM-family signers from configured
chains and enabled provisioning defaults. Per-call signer options retain their
provisioning policy. NEAR uses the configured account provisioning policy.
An empty default signer set rejects before dispatch. Explicit signer selections
remain unchanged.
The public boundary resolves defaults before any internal command or iframe
request. Internal registration requests require wallet and signer selections.
Passkey and Email OTP proofs
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

Router-admitted ECDSA prepare and finalize commands require the complete wallet
scope and the Gateway-pinned ownership generation. Constructors validate that
scope against the admitted tenant and wallet. Missing scope cannot reach execution. Missing, zero, and unsafe integer generations are invalid.
The wallet store checks the active local generation before reserving or consuming
a presignature and before recording a new terminal result. Exact terminal-result
replays remain available after transfer and return. The generation does not change
the wallet scope used to authenticate stored ciphertext.
The ECDSA wallet store requires an explicit local execution-authority record.
Initial registration commits this record with its material. Verified import
activation commits destination authority with its activation receipt. Cleanup
retains local authority and source fences. Missing authority never implies
generation 1. A checked empty source can record closed authority for its move,
which grants no signing permission. Execution authority stays local and does not
form part of the transferred historical inventory.

A later move can prepare a completely cleaned ECDSA resource as its destination.
Preparation replaces the old local authority and fence with inactive import state.
It requires a later source generation and durable evidence of completed cleanup.
The old cleanup receipt remains local history. Exact cleanup retries return that
receipt without deleting the returned wallet. Changed cleanup receipts fail.
Verified activation installs the new generation before fresh signing can start.

The ECDSA source commits immutable snapshot pages with its frozen receipt.
Export reads the sealed pages and checks their digests. Each response contains
at most 65,536 bytes and reads at most 17 pages of 4,096 bytes. Live inventory
changes cannot alter the sealed bytes. Source cleanup removes these pages in
bounded batches after destination activation. Each source invalidation call commits
at most 16 records with its progress cursor. Restart resumes from that cursor.
A failed transaction rolls back both invalidation and progress. Snapshot
serialization reads at most 16 records per batch. Source sealing and the restored
inventory digest check stream their bytes without a complete-inventory buffer.
Destination decoding reads one staged chunk at a time and restores one typed
record at a time. It checks the complete input digest and restored inventory
before verification commits. Any late parse, binding, or digest failure rolls
back all restored records. Initial sealing and destination verification still
complete in one transaction each.

Linked presign inventory is available while the ECDSA wallet drains. Each entry
records its creation generation. The wallet cannot seal its snapshot until every
linked session from the source generation has a durable freeze acknowledgement.
The session stores its immutable snapshot before acknowledging the wallet. Lost
replies replay that acknowledgement. Changed receipts fail, and exact receipts
remain replayable after cleanup. Imported inventory remains historical and does
not hold a later generation open.

Each new operation claim reads the active local generation in its insert statement.
The database rejects an absent or inactive home before the claim can consume quota.
The stored generation cannot change. In-progress retries read that stored generation.
Historical restore preserves it, even when the destination now uses a later generation.
New destination claims use the activated destination generation.

The persistence migration leaves older records without a proven generation unchanged.
Such records cannot produce a pinned execution scope. The system must not infer a
generation from the current home to dispatch an older operation.

The Gateway includes the pinned generation in owner Wallet Session and step-up
bindings for Ed25519 and ECDSA. The Router requires that field and rejects zero
or values above JavaScript's maximum safe integer before forwarding signing work.
The generation remains execution metadata, separate from wallet cipher identity.
Ed25519 prepare and finalize commands require the admitted wallet scope and retain
that generation through SigningWorker admission. Missing wallet scope fails at request
decoding. Owner, step-up, and linked-device constructors require the scope before
validation. Prepared round-1 material records it. A finalize command with another
generation cannot consume that material. The original command can still complete
and replay its terminal result after a worker restart.
The native and wallet-DO stores commit initial Ed25519 execution authority with
registration. Prepare and fresh finalize check that stored generation in the same
transaction as their signing writes. Missing authority cannot default to generation

1. Historical terminal replay remains available without creating new signing work.
   The Ed25519 source fence records the exact move identity under dedicated
   Router-to-SigningWorker authentication. It closes new preparation and registration
   writes. Repeated commands return the stored identity after restart. Changed move
   inputs fail. Admitted finalize can settle while this fence is draining, and exact
   terminal replay stays available. This fence alone does not attest a sealed snapshot.
   The settlement command counts admitted rounds in the transaction that closes
   preparation. A claimed round or an unexpired preparation keeps settlement draining.
   Expired unclaimed preparations do not block settlement. When no round remains,
   the source stores the exact settlement identity and rejects fresh finalization.
   Known terminal results remain replayable. Exact settlement retries survive restart.
   Settlement permits subsequent snapshot capture; it does not attest that snapshot.
   The wallet-DO source captures registrations, retired activation indexes, linked
   material, and round-1 history only after that exact move has settled. Each capture
   command reads at most 16 records from one collection. It commits immutable 4,096-byte
   segments with its cursor and rolling digest. Restart resumes that cursor. The final
   receipt binds the source, record count, segment count, and digest. Export requires
   the exact final receipt and returns one stored segment. Changed moves, receipts,
   and missing segments fail. Unsettled registration material cannot enter a snapshot.
   The destination prepares before source settlement and closes ordinary writes.
   Each imported segment commits with its acknowledgement and progress. Exact retries
   return that acknowledgement after restart. Changed or out-of-order segments fail.
   The Router accepts typed Ed25519 settlement and snapshot commands with
   Gateway-to-Router authentication and bounded JSON input. It forwards them through
   its SigningWorker binding with the separate Router-to-SigningWorker credential.
   The Worker E2E sends source settlement, capture, export, and cleanup through this
   transport. The private Wallet Runtime dispatcher admits only its explicit
   relocation operation list, POST, JSON, and bounded bodies. It uses its configured
   Gateway-to-Router credential and ignores caller-supplied credentials. Public origins
   and unknown operations cannot select this transport. The Ed25519 Worker scenario
   executes source relocation through the production Runtime handler and real Router
   and SigningWorker Workers. Console source-command authorization now checks the
   running freeze attempt, source Runtime deployment, and pinned resource verification.
   It builds Ed25519 settlement/capture and ECDSA freeze commands from the journal,
   including one stable invalidation timestamp. The directory E2E verifies exact
   replies and rejects the destination Runtime and Gateway. Runtime consumption of
   these authorized commands remains unconnected.
   The same Router transport accepts typed ECDSA freeze, export, and
   transfer commands. The ECDSA Worker scenario verifies freeze, export, activation,
   and activation replay through this boundary. A SigningWorker credential cannot
   authorize the Router request. Linked-presignature inventory, fence, freeze, export,
   and transfer commands use the same typed transport. The ECDSA Worker scenario
   settles and exports source sessions through the Router, including the race with
   terminal replay and the requirement for both session acknowledgements.
   An authenticated status command returns the destination cursor or its verified or
   activated state under the exact receipt. It does not change import state. The
   Worker E2E resumes transfer from this cursor after each eviction.
   The final segment must complete the expected record count and digest. Verification
   restores at most 16 segments per command and retains an incomplete record across
   calls. Production readers validate each record before insertion. Stored values
   must equal the original values, including nullable indexes and terminal history.
   The destination remains inactive until verification finishes. Activation installs
   the next execution generation and removes only its preparation fence. An exact
   activation retry preserves a later source fence. The restored wallet accepts fresh
   signing under the new generation and rejects the old generation. Prepare and
   finalize return exact results after eviction. The next snapshot preserves the
   completed signing result. The Worker E2E verifies the resulting Ed25519 signature.
   Source cleanup deletes at most 16 records per transaction. It requires the exact
   frozen receipt supplied by the authenticated coordinator after destination
   activation. It retains execution authority, settlement, and the write fence.
   The Worker E2E resumes cleanup across eviction and repeats its completed receipt.
   The cleaned source rejects registration and snapshot export. Fresh destination
   signing succeeds after cleanup. A cleaned location can prepare for a higher
   source generation with a different move ID. Preparation archives its old cleanup
   receipt and replaces authority atomically. Delayed cleanup returns that receipt
   without deleting new data. The Worker E2E restores registration and terminal history
   to the original location and verifies fresh generation-3 signing after delayed
   cleanup retries and eviction. Full relocation still requires composed verification.

The same fence prevents new Ed25519 recovery and linked-device mutations. Native
refresh deliveries also check the fence. Each mutation commits with its fence check
in one storage transaction. Native control routes reload durable state after errors
and never save rejected in-memory mutations through automatic snapshot persistence.

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

### Reserve the authorization destination before source pause

Gateway preparation compares the source and destination authorization schema digests.
A schema mismatch leaves the destination unreserved. A matching destination reserves
its empty authorization store for the exact wallet, move, request digest, and source
generation. Exact retries return the same reservation. Conflicting moves fail.
The reservation blocks ordinary destination authority writes and requires no frozen
source snapshot. The source remains usable until admission pauses it.

`tests/e2e/authorization-storage-transfer.e2e.mjs` verifies these boundaries and then
imports the source history into the reserved destination. This component evidence
does not establish preparation or activation of every wallet participant.

### Reserve Deriver wallet destinations

The private Runtime forwards destination preparation through each authenticated
Deriver service boundary. Both roles use one reservation protocol while retaining
their separate owner types and physical objects. Preparation requires an empty
wallet pair store and binds its reservation to the wallet owner, move, request
digest, and generations. Exact retries retain the same receipt after object
restart. A nonempty store or conflicting reservation is rejected. Ordinary pair
commands cannot write to a reserved destination. SQL guards also reject deferred
writes to pair records and admission fences. Empty-store inspection remains
available through the existing read commands.

The Worker pair-execution E2E exercises separate destination objects for the same
wallet in both roles. It verifies private Runtime preparation, authentication,
restart replay, conflict rejection, and rejection of ordinary pair writes. It also
verifies that Deriver B reconciliation cannot add a fence to its reserved store.
Before reservation, the source reports a digest of its pair-encryption public key,
key version, environment label, role, and schema. Each role checks that its private
key opens ciphertext sealed with its configured public key. The destination must
match the source digest before it creates any reservation. The reservation retains
that digest, including during exact retries. No encryption key material is returned.
The E2E rejects a context from the other role, a changed encryption environment,
and a private key that does not match the configured public key.

Deriver state transfer, tenant-root and peer-key continuity checks, activation,
and the aggregate preparation adapter remain open.

### Read wallet placement from the application

`wallet.placement.get(walletId)` reads placement through the wallet host. The host
uses its existing owner credential and requires the matching authenticated wallet.
The parent request carries only the wallet identity. A lock or authentication
change during the request discards the response. A locked read sends no request.

The result distinguishes a settled home, a moving wallet, and unavailable placement.
Transfer stages report paused availability. Cleanup reports active availability,
including when cleanup waits for a retry. Invalid response combinations fail at
the boundary. Unauthorized reads fail before the directory receives a request.
This explicit read does not run during signing or refill.

`node tests/e2e/authorization-storage-transfer.e2e.mjs` exercises the application
commands, host handler, and Gateway with real D1 authorization. It checks cleanup
availability, invalid responses, and a lock during a pending read. Evidence is in
`.artifacts/r153/authorization-storage-transfer/placement-client-evidence.json`.
The scenario simulates the directory and host credential adapter. It does not
verify browser startup, settings, or local credential selection.

`wallet.placement.getMove(walletId, moveId)` reads one exact move. A parsed move
identity is required. The host keeps the owner credential out of parent messages.
After server-side session retirement, the approved original credential can still
read that move until its existing expiry. It cannot read general placement or an
unapproved move. Completed responses retain the original move identity and both
generations. A response for another move fails. Local lock prevents move reads.

For fresh move admission, Console requires a Wallet approval read that observes
the exact initiating Wallet Session active and unexpired. Retirement committed
before that read denies the approval. Retirement after that read does not cancel
admission already in progress. Console can return an already admitted exact move
because its journal records that move before the retry.

The same authorization E2E retires the initiating session in D1 before exercising
this client path. It also verifies that Wallet denies a fresh admission approval
while the exact move read remains available. It records client results in
`retired-move-client-evidence.json` beside the placement evidence. Local credential
retention across reload and post-move client reconciliation remain outside this
scenario.

`wallet.placement.move(request)` requires the wallet, move identity, destination,
and expected source generation. The host first reads that exact move. An existing
matching move returns without another factor prompt. If no move exists, the host
first attempts to resume an existing owner approval. Preparation failure can
therefore retry the same approved request without issuing another challenge.
The Gateway requires fresh owner approval when none exists. A new request then
collects its proof inside the wallet iframe. Proofs and owner credentials do not
cross into parent messages. A lost submission reply gets one retry with the same
intent and proof. An authentication change during approval prevents submission.

The authorization transfer E2E verifies this command through production client
factories, iframe handlers, Gateway authentication, and D1 OTP approval. It
simulates the prompt and Console admission. Evidence is in
`move-submission-client-evidence.json`. Actual move admission and the passkey browser
prompt remain unfinished. Settings evidence appears below.

The wallet host saves the last submitted move request before sending a relocation
POST. `wallet.placement.getLastMoveRequest(walletId)` reads this local locator,
including after lock or reload. The record contains only the wallet ID, move ID,
destination, and expected generation. It contains no credential or approval proof.
Reading it makes no server request and grants no authority. The caller can use the
same request to reconnect after authentication becomes available. The locator is
not authoritative progress and does not show whether admission succeeded.
The Chromium move-locator journey verifies an uncertain submission, lock, reload,
exact reconnect, and wallet isolation using real IndexedDB and simulated server
responses. Local lock continues to prevent authenticated progress reads.

The owner settings page includes Wallet region. It reads placement before enabling
other settings, displays the current region, and explains session retirement before
submission. Selecting the current region sends no move. A pending move keeps other
settings disabled and leaves local lock available. The view shows transfer stages,
service recovery for a blocked stage, and separate activation and cleanup messages.
Unknown outcomes keep the exact request for explicit retry. Automatic polling only
reads progress. The host locks obsolete sessions when it observes activation.
After fresh unlock, active-destination progress enables other settings while cleanup
continues. Another move remains unavailable until cleanup completes.
The region-settings browser journey verifies selection, an uncertain submission,
exact retry, blocked-stage reporting, cleanup, local lock, and narrow-screen layout.
It uses the production component with simulated placement and surrounding actions.
Global application signing controls, automatic activation reconciliation, and the
assembled regional move remain outside this UI evidence.

Successful host placement reads, exact move reads, and move submissions reconcile
the local ownership generation before returning success. An admitted move advances
the local generation to its destination generation, including while transfer is
paused. The same IndexedDB transaction removes obsolete durable presignatures.
Existing resident-pool checks reject subsequent use and delayed refill publication
from the source generation. Historical completed-move reads cannot lower this
local generation. This observation does not issue a destination credential.
Ordinary locking does not advance the generation or invoke this invalidation path.

When a placement response confirms destination activation, the host locks an
obsolete local session through the ordinary lock flow. Copying-stage reads retain
the original session for bounded move progress. A session already issued for the
active generation remains usable during cleanup. An activation response that locks
the wallet returns `wallet_unlock_required`. Later authenticated move reads require
ordinary unlock. No credential survives local lock for progress polling.
The activation-lock browser contract uses a real registered wallet, stored session,
and iframe commands with simulated regional responses. It verifies copying-stage
access, automatic lock at activation, no progress request after lock, and a locked
state after reload. It does not establish destination unlock or regional relocation.

The iframe request boundary checks the selected session's ownership generation
before new signing, export, recovery, factor changes, or owner device changes.
The check uses the requested wallet and local IndexedDB state. It makes no Console
request. A session from an obsolete generation fails before its operation handler
runs. Ordinary authentication checks still handle missing or expired sessions.
Move reads, exact move replay, local lock, fresh authentication, and completion
reports for admitted transactions remain available. Server writer fences remain
authoritative for requests already in flight and devices that have not observed
the move.

### Verify SigningWorker encryption context before admission

SigningWorker preparation compares source and destination wallet encryption contexts
before reserving either signing curve at the destination. The context identifies
the environment, wallet storage schema, key version, and recipient public key.
Each role checks its configured key pair through its existing seal and open methods.
A missing context, a different context, or a mismatched key pair prevents admission.
The source remains active. The context digest contains no private key material.

### Keep owner presign work retired after a return move

Fresh owner and linked-device operation credentials carry a required positive
`ownershipGeneration`. Issuance reads the local wallet execution record. Inactive
destinations and retired sources cannot issue fresh credentials. Registration may
issue its initial credential while its execution record is registering.
The client preserves this generation with the credential and rejects a different
generation for the same stored session and token. Credentials without a generation
require fresh authentication. This does not delete durable presignatures.

The authorization transfer E2E verifies generation 1 at the source and generation
2 after destination activation. ECDSA signing and refill carry this generation
into resident and durable pool identities. A pool cannot select material from a
different generation. The persistence boundary upgrades initial-generation rows
without changing their authenticated ciphertext. The browser lock E2E exercises
this upgrade and signs with a retained presignature.

Accepting a newer session generation persists that generation and removes older
session credentials and durable presignatures in one transaction. Durable
admission, listing, and consumption require the accepted generation. Ordinary
locking preserves this generation and usable durable material. The browser storage
contract uses a real registered presignature to verify deletion, delayed old
admission rejection, exact advancement retries, rollback rejection, and current
generation consumption. Its generation transition is local and does not prove
regional relocation.

Resident pool hydration, refill, and signing check the persisted ownership
generation. A stale pool stops maintenance, invalidates pending results, and
destroys resident handles. Hydration and refill check again before publishing
results. An old pool's invalidation does not clear a newer generation's pool.
The browser refill contract holds a real Gateway completion reply, advances the
local generation, and then releases the reply. The refill fails with zero resident
pool depth and no durable presignatures. Full regional relocation and offline
device reconciliation still require composed verification.

Owner presign authorities record the ownership generation at initialization. Each
protocol step requires that exact current generation. Returning to the original
region cannot reactivate an unfinished ceremony from an earlier generation.
Historical restore preserves these authorities without granting new execution.
It rejects an authority whose generation exceeds the source generation. Older
persisted authorities without a generation remain readable as history and cannot
resume protocol work. Completed durable presignatures and ordinary locking keep
their existing lifecycle.

The native ECDSA relocation scenario holds a real final presign batch before
source freeze. It rejects that batch during the move and after return at generation
3, then verifies a fresh signature. Run `scripts/test-private-d1.mjs
--ecdsa-wallet-do-pool` from `crates/router-ab-cloudflare` with the wallet-DO
harness and development Worker builds enabled.

Pool publication also requires the original presign session identity. Its stored
generation check and pool insertion run in one wallet transaction. A completed
result from an earlier generation cannot enter the pool after a return move.
Unbound pool-fill commands are rejected at the wallet object boundary.
The VM adapter uses the same store admission function.

The native scenario separately completes a real owner presign protocol, holds its
result before publication, and attempts publication during freeze and after return.
Both attempts fail. Fresh owner presigning and signing still succeed.

### Explicit home discovery during signing

For signing prepare/finalize and ECDSA refill requests, an HTTP 409 with code
`wallet_home_discovery_required` permits one retry without the region hint.
The retry uses the same public URL, serialized body, operation identity, bearer
token, and abort signal. It cannot retry again. Authentication, revocation, quota,
other conflicts, and network failures do not trigger this routing retry.

## External NEAR accounts

Applications configure an explicit allowed-wallet list through
`ExternalNearController({ network, rpcUrl, wallets })`. No wallet is enabled by
omission. An empty list disables all connectors. The controller copies and freezes
the list, removes duplicates, and preserves display order. Snapshots expose that
same list to the picker.

`setWallets` updates the allowed list. Removing a connected or connecting wallet
disposes that connection and invalidates its pending operations. Other wallet-list
changes preserve the selected connection. Disabled wallet requests return
`unavailable` before loading any adapter and cannot interrupt an enabled connection.
Network restrictions still apply to enabled wallets. Submitted hashes remain
associated with their original account and network after configuration changes.

The NEAR controller requires an explicit wallet: `meteor`, `hot`, or `intear`.
Each adapter loads separately. Connections retain the selected wallet and generation.
Switching wallets invalidates prepared requests. No adapter consumes unsolicited
wallet-registry announcements.

Meteor uses its captured direct extension transport with correlated request IDs. HOT calls the
captured `window.hotExtension` provider directly. Replacing either captured
transport blocks subsequent requests. These boundaries assume trusted application
code and cannot authenticate arbitrary scripts running in the same document.

HOT is limited to mainnet because its documented API has no network selector.
The testnet picker disables HOT and explains this limit. Meteor and Intear accept
configured mainnet or testnet requests.

Intear opens the fixed `https://wallet.intear.tech` origin. Responses must match
both this origin and the request's popup window. The adapter removes listeners
and closes the popup on success, error, closure, or timeout. Requests use an
in-memory, non-extractable Ed25519 session key for protocol authentication.
The key is never installed on chain. Requests omit function-call-key grants.
The adapter rejects bridge sessions, wallet-origin changes, and unexpected grants.

External accounts never authorize Seams custody. Transfers and function calls
use wallet approval. State remains in memory. Late submissions retain their
captured account and network. Transport failure after dispatch returns
`submission_unknown` without a retry. Status checks require matching transaction
identity and final execution from the configured network RPC.

`tests/wallet-ui/external-near.browser.test.ts` produces wallet-specific JSON
observations and picker screenshots. Controlled providers verify transport
replacement, popup source binding, stale requests, and unknown submission.
Real wallet qualification remains required before release.

Disconnect disposes the current adapter even while connection approval is pending.
Intear closes its popup. Meteor ends the local request and sends a disconnect
notification. An external wallet can retain its own approval window; local
cancellation never proves that a transaction was not submitted. A late operation
cannot clear a newer connection's busy state.

Meteor communicates through the captured `meteorComV2` object and method. Every
reply must match its request ID. Foreign replies are ignored. A reconnect
handshake resends inputs under the same ID. Terminal success is acknowledged once.
The browser adapter uses an unsigned Borsh template; Meteor owns key selection,
nonce selection, approval, signing, and broadcast.

Real Meteor evidence: `docs/evidence/refactor-185-meteor-testnet-20261026.json`.
The run verified final execution and exact greeting readback for `cyan-loong.testnet`.

### External Meteor ownership messages

`ExternalNearController.signMessage(connection, params)` requests a NEP-413 message
signature through Meteor's captured transport. The request uses `sign_message` and
includes the captured account and network. HOT and Intear return `unavailable`
before dispatch because this connector does not implement their message-signing APIs.

The caller supplies a message, recipient, and 32-byte nonce. The boundary copies
the nonce before asynchronous work. Optional callback URL and state retain their
exact values. The controller checks the current account before dispatch and rejects
a changed connection during approval or verification. Concurrent operations return
`pending_request`. Disconnect cancels approval without clearing a newer operation.

Success requires the captured account, a 32-byte Ed25519 public key, and a 64-byte
base64 signature. The connector verifies the signature over the SHA-256 digest of
the standard NEP-413 Borsh payload, including the tag and optional callback URL.
The response carries the caller's state through the correlated request. A decline,
malformed reply, or changed signed field returns `unavailable`. No transaction or
RPC request occurs during message signing. Account-key ownership and challenge
freshness remain application checks on the selected network.

`tests/wallet-ui/external-near-message.browser.test.ts` verifies ownership messages,
tamper rejection, nonce copying, concurrent requests, and cancellation across a
reconnect. It independently encodes and verifies NEP-413 with Node.js crypto.
Each run writes JSON evidence with the public request, signature, and digest.

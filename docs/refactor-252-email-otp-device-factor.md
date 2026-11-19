# Refactor 252: Email OTP as a device factor

Status: 2026-11-19. Slices 0, 1 and 2 are done, with the POPRF of D9, and are in the 0.75.0
release commit. Slice 3 (new devices) is in progress: 3a (the factor list of D11), 3b
(recovery) and 3c (device linking) are written. 3d (the menu) is next.

The owner decided on 2026-11-18 that the wallet server alone must not be able to open an owner
Email OTP wallet ([Refactor 251](refactor-251-auth-wallet-checkout-modules.md), D26). Today it
can ([Slice 0 inventory](refactor-251-slice-0-inventory.md), U4). This plan makes the Email OTP
factor key a device factor, as passkeys and VoiceID already are.

## Result

- The wallet server holds only its seal key and the pinned unlock public key. With every D1 row
  and every Worker secret, and no data from the user's device, nobody can get the factor key S
  or open the custody envelope. A test proves this.
- An owner Email OTP wallet opens only with two things: the sealed factor on the device and a
  fresh email code. On that device, a live Wallet Session can replace the code within its limits
  (D5).
- A new device gets wallet access by device linking or with a recovery code. Google and an
  email code on a new device give a sign-in only.
- No server copy of a factor remains. No hosted Email OTP wallet exists (U1), so Slice 2
  deletes the server-held path in the same change (D10).
- The server stores each email code encrypted, not as plain text.
- The public custody docs become true for Email OTP.

## Facts this plan builds on

Checked in the code on 2026-11-18. `wk/` is
`packages/wallet/src/core/signingEngine/workerManager/workers/`. `srv/` is
`packages/wallet-server/src/`.

- **F1. Enrollment.** The Email OTP worker makes a random S. Shamir three-pass with a temporary
  client key ends with S under the server's seal only, enc_s(S). The server stores enc_s(S) in
  its enrollment record (`wk/email-otp/enrollment.ts:79-111`, `srv/core/EmailOtpStores.ts:88-102`).
- **F2. Release.** After a valid code, `/wallet/email-otp/factor-release` reads enc_s(S) from D1,
  removes its seal and encrypts S to any P-256 key that the caller sends
  (`srv/router/transport/fetch/routes/sessions.ts:1305-1345`,
  `srv/router/domains/emailOtp/emailOtpRouteHandlers.ts:66`).
- **F3. Four server-side releases.** Unlock (`sessions.ts:1322`), step-up and export
  (`routes/thresholdEd25519.ts:340`), the device-link target
  (`d1LinkedDeviceEmailOtpTargetFactor.ts:363`) and Google recovery
  (`d1WalletRecoveryGoogleEmailOtpService.ts:425`).
- **F4. A Wallet Session bearer releases S with no code** (`sessions.ts:1203-1227`). The browser
  uses it in `session/emailOtp/exportRecovery.ts`, `wk/email-otp/unlock.ts:243` and
  `wk/email-otp/recovery.ts:343`.
- **F5. S alone opens the envelope** (`wk/email-otp/custodyRestore.ts:558`). The pinned unlock
  key comes from S and the wallet ID (`enrollment.ts:113-118`).
- **F6. The blinded step exists already.** The warm-session restore adds a temporary client seal
  before the server removes its seal, and removes the client seal in the worker. The server
  never sees that secret (`wk/email-otp/sessionState.ts:836-870`).
- **F7. Linked-device Email OTP methods keep their material on the device.** The server returns
  no envelope for them (`walletUnlockRouteHandlers.ts:1682-1684`, `wk/email-otp/unlock.ts:283`).
- **F8. A recovery code opens the seed** without Email OTP (`wallet_custody_ceremony`, recovery
  join; `d1PasskeyCustodyRouteService.ts:1170-1209`).
- **F9. Email OTP on a new browser works today.** Google verify returns `existing_wallet`, and
  the Email OTP unlock follows (`SeamsWeb/operations/authMethods/emailOtp/challenge.ts:206`). The
  unlock test runs only on the same browser (`email-otp.unlock.contract.test.ts`).
- **F10. Codes are stored in plain text** (`d1EmailOtpChallengeVerifier.ts:346`).
- **F11. The seal key has versions.** Each enrollment records `enrollmentSealKeyVersion`, and
  `EMAIL_OTP_SERVER_SEAL_ACCEPTED_WARM_KEY_VERSIONS` lists the accepted ones.
- **F12. seams-monorepo forwards** `/wallet/email-otp/{challenge,factor-release}` to the wallet's
  home region (`wallet-console-server-ts/src/walletPlacement/authenticationDispatch.ts`).

## Decisions

Decided:

- **D1. A device-held factor and a blinded release.** The device stores enc_s(S). The server
  stores no copy. Each release adds a temporary client seal first, so the server removes its
  seal from a value that it cannot read. The owner chose the goal on 2026-11-18: the wallet
  server alone must not open an owner Email OTP wallet.

The owner accepted D2 to D7, as recommended, on 2026-11-18:

- **D2. Access on a new device.** Device linking or a recovery code. Google and an
  email code on a new device give a sign-in only. This follows from D1. Each path that opens a
  wallet with only an email check lets the operator open it, because the operator runs the
  check and its email provider can see the code.
- **D3. Rotate, not copy,** and **D4. A 30-day deadline for server copies.** D10 replaced both
  on 2026-11-18, because no wallet needs them.
- **D5. The Wallet Session release (F4).** Keep it only with the sealed factor of
  the device, which it needs after D1 anyway. Export keeps its fresh email code. If the
  warm-session seal can serve its callers (U3), remove it.
- **D6. Rotation of the server seal key.** A blinded re-seal at unlock. The device
  adds a client seal, the server removes the old seal and applies the new one, and the device
  removes its client seal. An old key version stays accepted until the operator retires it.
  The re-seal uses the primitive of D9.
- **D7. The public docs until Slice 5.** A short note says that Email OTP wallets depend on the
  server until this plan is done. It was added on 2026-11-18 to the custody page and the Email
  OTP page, in English and Japanese. Slice 5 replaces it with the device-factor text.

Added by Slice 0 on 2026-11-18:

- **D8. A seal key for each wallet and enrollment.** Required by D1 (F13). The lock context of
  the Email OTP seal names the wallet and the enrollment, as the signing-session seal names the
  wallet and the session. A code for one wallet then removes the seal only from that wallet's
  factor. Done on 2026-11-18, before Slice 2, because the gap is also open today: registration
  takes the sealed factor from the client, so a reader of D1 could store another wallet's
  sealed factor in an Email OTP wallet of their own and unseal it with their own code. Both
  seals now derive their key through one path in `signingSessionSeal/crypto/cipher.ts`, and the
  four releases share `releaseEmailOtpFactorToWorker`. The registration seal request carries
  the enrollment ID. With an OPRF (D9), the same wallet and enrollment become the POPRF `info`.
- **D9. The primitive of the blinded release.** The owner chose the POPRF on 2026-11-18 and
  asked for a full switch with no migration, because the wallets will be reset. An OPRF (RFC
  9497, ristretto255) replaces Shamir three-pass for the Email OTP factor. The device keeps a
  random input, and S is encrypted under the POPRF output for that input (Section 1). The server
  learns neither the input nor S. It is a standard primitive at the 128-bit level, and no
  existing wallet needs the old scheme (U1). The other choice keeps Shamir three-pass with a
  group of at least 2048 bits. The signing-session seal uses the same 1024-bit group for every
  method; a separate plan replaces it.

  Facts for the choice, measured on 2026-11-18 on an Apple Silicon Mac in Node:
  - One lock step of the three-pass WASM (`shamir-3-pass` 0.6.0, `num-bigint`) takes 1.6 ms at
    1024 bits and 15.3 ms at 2048 bits. A release is three steps: two on the device, one on the
    server. 3072 bits is about 3.4 times the 2048-bit cost (inferred, not measured).
  - One ristretto255 scalar multiplication in JavaScript (`@noble/curves` 1.9.1) takes about
    1 ms. WASM on `curve25519-dalek` is faster.
  - The security level is about 80 bits at 1024, 112 at 2048 and 128 at 3072 bits (NIST SP
    800-57). ristretto255 gives about 128 bits.
  - `num-bigint` does not claim constant time. `curve25519-dalek` is constant time.
  - The crate already has `rfc3526-group14` (2048 bits), so the larger group is a one-line
    change. An OPRF needs the `voprf` crate or our own RFC 9497 code on `curve25519-dalek`,
    which `crates/threshold-prf` already uses with ristretto255.
  - D8 is needed with either primitive. With an OPRF, the POPRF mode of RFC 9497 takes the
    wallet and the enrollment as its public `info` input. With three-pass, they go in the
    context of `derive_lock_key_pair`. In both, the server sets them from the checked challenge,
    never from the request.
- **D10. No rotation and no deadline.** The owner decided on 2026-11-18. No hosted Email OTP
  wallet exists (U1), so the rotation of D3 and the deadline of D4 would migrate nothing. Slice 2
  replaces the server-held path and deletes it in the same change. A self-hosted server that has
  Email OTP wallets from an older version: the release notes say that such a wallet recovers
  with its recovery code after the upgrade.
- **D5, changed by U3.** Remove the bearer release. The NEAR Ed25519 re-hydrate gets S from an
  Ed25519 warm seal under the signing-session key (per wallet and per session, with the server's
  use and time limits) and a blinded restore. The `verified_grant` branch checks the operation.

Added on 2026-11-19, before Slice 3:

- **D11. A factor for each Email OTP method.** Required by F15. The enrollment row of a wallet
  keeps the email identity, the code checks and the lockouts. It holds a list of factors, one
  for each active Email OTP auth method, at most 8. Each factor has its own S, nonce, wrapped
  factor and pinned unlock key, and names its `walletAuthMethodId`. The row keeps one key version
  for all its factors, because nothing rotates it (D10). The release picks the factor by the
  device's nonce, as in Slice 2. A revoke deletes the method's factor
  in the same commit; the row goes with the last method, as now. The record keeps its version
  name, so an Email OTP wallet made by 0.75.0 does not open after Slice 3 and is reset (D9, D10).

## Unknowns: the answers of Slice 0

Answered on 2026-11-18. The counts come from read-only queries on the 12 signer databases
(staging, production testnet and production mainnet, four regions each). The queries returned
counts only.

- **U1. No hosted Email OTP wallet exists.** Staging has 3,764 wallets, production testnet 6
  and production mainnet 58. Each one has a passkey, and 12 also have VoiceID. No database has
  an Email OTP method or an Email OTP enrollment.
- **U2. Each wallet has an acknowledged recovery-code backup.** Registration does not commit
  custody without the acknowledgement (`walletCustodyRegistrationCommit.ts:114`).
- **U3. The Wallet Session release has one real caller.** It is the NEAR Ed25519 re-hydrate
  after a reload or a worker restart (`wk/email-otp/recovery.ts:331-345`). The other matches
  were a different `wallet_session` union. Two gaps:
  - The bearer branch checks no operation and uses no budget (`sessions.ts:1204-1227`). The
    same bearer gets the envelope from `/wallet/unlock/verify`, and S opens it. So code that
    holds the bearer, such as the iframe main thread, can get the seed with no export code.
  - The `verified_grant` branch consumes a grant with no operation check
    (`sessions.ts:1279-1293`).
  - Also, `recovery.ts:365` and `unlock.ts:785-792` drop S without zeroing it.
- **U4. seams-monorepo needs no product change.** Its dispatch reads only the top-level
  `walletId` of the release body, forwards the body unchanged, and turns a status of 500 or
  more into 503. Two seams-monorepo tests change: one matches the `operation` field of the
  release, and the harness checks the device-link factor release that Slice 3 removes.
- **U5. Linked-device material is sealed on the device under a key from S** (AES-GCM, HKDF of
  S; `core/indexedDB/linkedAuthoritySignerMaterial.ts:105-170`). It uses no server seal. The
  linked device gets S from the same unblinded release, so after D1 it also stores its sealed
  factor.

Two facts from the same reading change the design:

- **F13. The Email OTP seal key was the same for every wallet.** Its lock context named no
  wallet and no enrollment. Under D1 alone, a copy of the sealed factor of wallet A and a valid
  code for the attacker's own wallet B would give S of wallet A. D8 fixed this on 2026-11-18.
- **F14. The Shamir three-pass group is 1024 bits.** Both seals use `rfc2409-group2`
  (`shared-ts/src/utils/signingSessionSeal.ts:16`). With one key for all wallets, one discrete
  logarithm opens every sealed factor (D9).
- **F15. One enrollment row and one factor for each wallet.** The primary key of
  `email_otp_wallet_enrollments` ends with `wallet_id`, and the record holds one nonce and one
  wrapped factor. So a device-link target gets `new_enrollment` only when the wallet has no row
  (`target_enrollment_exists`, `d1LinkedDeviceEmailOtpTargetFactor.ts`), and the Google
  recovery `create` path refuses a wallet that has a row (`enrollment_conflict`,
  `prepareLinkedDeviceEnrollment`). Found on 2026-11-19. No test links an Email OTP target
  device end to end.

## 1. The design

### The device factor

RFC 9497, ristretto255-SHA512, POPRF mode, from `wasm/oprf_runtime` (the `voprf` crate 0.5.0).
The worker and the Gateway load the same module.

- **Server key.** For each key version: a 32-byte seed from the seal root (HMAC over a labelled
  tuple, `core/authService/emailOtpRootKey.ts`), then `DeriveKeyPair(seed, keyInfo)`
  (`core/authService/emailOtpFactorOprf.ts`).
- **`info`.** The tuple of the wallet, the enrollment and the factor nonce
  (`emailOtpFactorOprfInfo`, shared). The server takes all three from its own enrollment record.
- **Device.** The Email OTP worker keeps x (32 random bytes) for each wallet and nonce in its own
  IndexedDB database `seams_email_otp_device_factors` (`wk/email-otp/deviceFactor.ts`).
- **Server record.** The enrollment keeps `factorNonceB64u` and `wrappedFactorB64u`: S under
  AES-256-GCM with a key from HKDF of the POPRF output, bound to the wallet, the enrollment and the
  nonce. The server cannot compute the output without x, so it cannot open S.

### Enrollment

1. The worker makes S, as today, and a random x. It blinds x.
2. `/wallet/email-otp/registration/factor` picks a fresh factor nonce and evaluates the blinded
   element under the current key. Because the nonce is new on each call, this route, which needs
   no proof, never evaluates the function of an existing enrollment.
3. The worker checks the proof, removes the blind, wraps S under the output and stores x.
4. The finalize step stores the nonce, the wrapped factor and the pinned unlock key.

### Release (unlock, step-up, export)

1. The worker blinds x of each of its factors for the wallet (at most 4) and sends them as
   `deviceFactors` with the code proof.
2. The server picks the factor whose nonce matches its enrollment, before it uses the code. A
   device with no matching factor gets `email_otp_device_factor_missing` (409).
3. The server checks the code for its operation and returns an `email_otp_factor_evaluation_v1`:
   the evaluated element, the proof, the public key and the wrapped factor.
4. The worker checks the proof, removes the blind, opens S and deletes its other factors for
   the wallet. It proves the pinned unlock key, as today.

The Wallet Session release (`wallet_session`) uses the same evaluation, so it now needs the
device input too. Its operation check and the Ed25519 warm seal of D5 remain open.

### A new device

Since 3b and 3c, Google recovery and device linking give a new device its own factor. Until 3d,
the menu does not offer them to a device with no factor. Slice 3 is the design below.

- A device with no sealed factor does not offer the Email OTP unlock. Google and an email code
  give a sign-in only. The menu then offers two choices: link from a device that has the wallet,
  or enter a recovery code.
- **Device linking.** The new device enrolls its own Email OTP factor as a new linked-device
  method. The source device reseals the seed for it over the link channel. The server releases
  nothing, and the `email-otp-base-factor` route goes away. The source approves only the target
  address. The server picks the branch from the wallet's enrollment when it issues the code:
  - A wallet with no Email OTP: `new_enrollment`. The code is a registration code to the target
    address, and the install commit creates the enrollment with the target's factor.
  - A wallet with Email OTP: `existing_enrollment`. The target address must be the enrollment's
    address. The code is a device-link code under the enrollment's identity and lockout, and
    the install commit adds the target's factor to the row. The base method choice, its iframe
    event and chooser, and the factor release envelope go away.
- **A recovery code.** The code opens the seed (F8). The device then enrolls a new owner Email
  OTP factor. Google recovery releases no S, and that release (F3) goes away. With D11, the
  `existing` target adds the recovered method's factor to the row, and `create` makes the row.
  The factors of other devices stay, as the other methods of a recovered wallet stay.
- **The menu.** The Email OTP worker answers whether the device holds a factor for the wallet.
  If it does not, a Google sign-in requests no code and shows the existing "Link this device"
  and "Recover wallet" choices.

### Existing wallets

None exist on the hosted servers (U1), so there is no migration (D10). Slice 2 deletes the
server-held path, the ECDH release and the `enc_s(S)` column in the same change. A wallet that
an older self-hosted server made recovers with its recovery code.

### Email codes

The server stores each code encrypted with AES-256-GCM, with the challenge ID as associated
data, and compares codes in constant time. The key comes from the Email OTP seal root with its
own label, so no new secret is needed (`core/authService/emailOtpCodeSeal.ts`). A reader of D1
alone cannot read a code.

The first version stored an HMAC of each code. A test showed that a retried relocation
challenge must send the same code again, and that a reused challenge, the demo modes and the
dev outbox read the code. With the key, an HMAC of a six-digit code gives no more protection
than encryption, so encryption replaced it. A code that is in flight at the deploy fails, and
the user asks for a new code.

## 2. Invariants

- No route returns S, or a value that the server can turn into S without data from the device.
- The server stores no enc_s(S).
- With every D1 row and every Worker secret, and no device data, nobody can get S or open an
  Email OTP envelope.
- An email code alone never opens a wallet on a device that has no sealed factor.
- Export still needs a fresh email code for the operation `export_key`.
- A copy of the device's IndexedDB alone cannot open the wallet. The server removes its seal
  only after a valid code, or a live Wallet Session within its limits (D5).

## 3. Slices

- **Slice 0: facts.** Answer U1 to U5. No product code. Done on 2026-11-18.
- **Slice 1: encrypted email codes.** The change of Section 1, "Email codes". It does not depend on
  the other slices and can ship first. Done on 2026-11-18 (migration
  `0090_email_otp_code_seal.sql`).
- **Slice 2: the device factor.** The device-held factor and the blinded release for
  registration, adding Email OTP, unlock, step-up and export. In the same change, delete the
  server-held path, the ECDH release code and the column (D10). The operator test. Update
  [Browser workers](browser-workers.md), because the Email OTP worker then stores the sealed
  factor. Done on 2026-11-18 with the POPRF. The new-device paths refuse until Slice 3.
- **Slice 3: new devices.** The sign-in-only state with its two choices in the menu (English and
  Japanese text), device linking with the target's own factor, and recovery with no release.
  Order: 3a the factor list of D11 (server record, registration, release, revoke); 3b recovery;
  3c device linking; 3d the menu. Each part ships its behaviour test. The Email OTP behaviour
  tests need a fresh Google ID token (`pnpm ensure:intended-google-token`, which needs
  `gcloud` or the service account).
  - 3a, written on 2026-11-19: the record holds `factors`; the release, the step-up and the
    unlock proof pick their factor; registration, an added method, a linked device and Google
    recovery name the factor by the new method. The owner revoke and the linked-device revoke
    remove the method's factor, and the row goes with its last factor or method. The unused
    `verifyEmailOtpEnrollment` path is deleted. No wire change. Unit tests:
    `emailOtpEnrollmentFactors.unit.test.ts`.
  - 3b, written on 2026-11-19: Google recovery releases no factor. After the code check, the
    device enrolls a new factor for the recovered method. The finalization adds it to the
    wallet's enrollment (`existing`, `prepareAddedFactor`, with a batch guard after it) or
    creates the enrollment (`create`). The release route, its worker operation and the
    `existing` finalize branch are deleted. The verify route returns the identity, and the
    finalize route requires the factor material. Unit tests: the added factor and its guard in
    `emailOtpEnrollmentFactors.unit.test.ts`.
  - 3c, written on 2026-11-19: the approval and the target preparation carry only the target
    address; the grant and the verified target keep the branch. The target always enrolls its
    own factor under the grant's identity, and the install commit adds it
    (`prepareAddedFactor`) or creates the enrollment. The base-factor route, its types, the
    chooser in the iframe and `QRCodeScanner`, `onEmailOtpBaseFactorRequired`, the release
    envelope and the worker recipient key of the challenge start are deleted. Migration
    `0091_linked_device_email_otp_own_factor.sql` rebuilds `linked_device_email_otp_grants`
    without `base_wallet_auth_method_id`. The add-method `existing_enrollment` target carries
    its own factor, as `new_enrollment` does. The added factor's batch guard is part of its
    statements. Unit tests: `linkedDeviceEmailOtpTarget.unit.test.ts`. Not written: an Email OTP
    target device-link behaviour test; the harness links only Passkey targets, and the Email
    OTP tests need the Google token.
- **Slice 4: the release.** seams-monorepo in one coordinated commit if U4 needs it. The wallet,
  `wallet-server` and the seams-monorepo site ship together. Staging first, then production.
  The release notes carry the self-hosted note of D10. When seams-monorepo installs the new
  `wallet-server`, add the two `oprf_runtime` files to
  `packages/wallet-console-server-ts/scripts/ensure-d1-local-wasm.mjs`, and remove
  `/wallets/recovery/email-otp/release` from `walletPlacement/recoveryDispatch.ts`,
  `tests/e2e/regional-recovery-routing.scenario.mjs` and `tests/helpers/regional-real-gateway.mjs`
  (3b deleted the route). Apply migration `0091_linked_device_email_otp_own_factor.sql` before
  the server.
- **Slice 5: the docs.** When production has Slice 4, replace the D7 note and update the
  documents of the last section.

## 4. Tests

- **The operator test.** It loads every D1 row and every Worker secret and no device data. It
  must fail to get S and to open the envelope. Done on 2026-11-19 in
  `tests/unit/emailOtpFactorOprf.unit.test.ts`: with the seal root, the enrollment record and
  every value of the enrollment route, no tried key opens the wrapped factor, and the device
  input does. The wrap uses the real worker code (`wk/email-otp/deviceFactorWrap.ts`).
- **Email OTP unlock** on the same browser still works, and no release response carries an
  ECDH payload.
- **A new browser:** Google and an email code give a sign-in only. Then device linking gives an
  unlock. In a second run, a recovery code gives a new factor and an unlock.
- **Device linking** with an Email OTP target that enrolls its own factor.
- **Google recovery** releases no S and enrolls a new factor.
- **Email codes:** D1 holds no plain code. A wrong code fails. The lockout limits do not change.
- **The Wallet Session release (D5)** needs the device's sealed factor. Export needs a fresh
  code.

## 5. Relation to other plans

- **Refactor 251.** This plan decides D26. After Slice 4, a compromised Auth Worker cannot open
  an Email OTP wallet, because it has no sealed factor. So the Email OTP code check can move to
  the Auth Worker like the other methods, and the temporary rule of Section 6 of Refactor 251
  goes away. The conformance suite of Refactor 251 Slice 2 records the Email OTP journeys at the
  API, not the release wire, because Slices 2 and 3 here change that wire.
- **Refactor 250.** No change.

## 6. Not in this plan

- **The main-thread hop of S** ([Refactor 251](refactor-251-auth-wallet-checkout-modules.md),
  Fact F24). The secret sink of Refactor 251 closes it.
- **Email-only access on a new device.** It is not possible without trust in the operator (D2).
- **Sync of methods between devices.** Each device keeps its own methods by design.

## Documents to update when the slices land

- [Email OTP](otp/email-otp.md): remove the warning note and describe the device factor.
- `apps/docs/src/concepts/custody/index.md`, `apps/docs/src/concepts/auth-methods/email-otp.md`
  and their Japanese pages: Email OTP on a new device needs device linking or a recovery code.
- [Intended behaviours](intended-behaviours.md): the Email OTP, recovery and device-linking
  sections.
- [Browser workers](browser-workers.md): what the Email OTP worker stores (Slice 2).
- [Refactor 251](refactor-251-auth-wallet-checkout-modules.md): Fact F20 and Section 6.

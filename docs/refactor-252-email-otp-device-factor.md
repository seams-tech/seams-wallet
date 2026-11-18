# Refactor 252: Email OTP as a device factor

Status: 2026-11-18. Plan only. Nothing is built.

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
- Each existing wallet changes to a new factor key at its next unlock, and the server deletes
  its copy. After the deadline of D4, no server copy remains.
- The server stores each email code as an HMAC value, not as plain text.
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

Open, with a recommendation:

- **D2. Access on a new device.** Recommended: device linking or a recovery code. Google and an
  email code on a new device give a sign-in only. This follows from D1. Each path that opens a
  wallet with only an email check lets the operator open it, because the operator runs the
  check and its email provider can see the code.
- **D3. Rotate, not copy.** Recommended: each existing wallet gets a new factor key S′ at its
  next unlock. Only moving enc_s(S) to the device is not enough, because the server held S.
  The seed and the addresses stay the same, so the rotation cannot undo an earlier copy of S.
- **D4. The deadline for server copies.** Recommended: 30 days after Slice 3 reaches
  production. Then the server deletes each copy that is left. Those owners recover with their
  recovery code.
- **D5. The Wallet Session release (F4).** Recommended: keep it only with the sealed factor of
  the device, which it needs after D1 anyway. Export keeps its fresh email code. If the
  warm-session seal can serve its callers (U3), remove it.
- **D6. Rotation of the server seal key.** Recommended: a blinded re-seal at unlock. The device
  adds a client seal, the server removes the old seal and applies the new one, and the device
  removes its client seal. An old key version stays accepted until the D4 deadline.
- **D7. The public docs until Slice 5.** Recommended: add a short note now that Email OTP wallets
  depend on the server until this plan is done. Replace the note with the device-factor text in
  Slice 5.

## Unknowns to check first

- **U1.** How many owner Email OTP wallets exist in staging and in production? How many were
  unlocked in the last 30 days?
- **U2.** How many of them have a recovery-code backup that the owner acknowledged? A wallet
  with no backup and no device loses access at the D4 deadline.
- **U3.** What do the three callers of the Wallet Session release (F4) need? Can the
  warm-session seal give it?
- **U4.** Does the dispatch of seams-monorepo (F12) read more than the wallet ID from the release
  body?
- **U5.** Do the linked-device Email OTP materials (F7) use the same seal key? If yes, their code
  and the new release share one blinded step.

## 1. The design

### Enrollment

1. The Email OTP worker makes S, as today.
2. Shamir three-pass runs as today and ends with enc_s(S) in the worker.
3. The worker stores enc_s(S) in a new IndexedDB store `email_otp_device_factors`, keyed by the
   wallet and the method, with the enrollment ID and the seal key version.
4. The server stores the pinned unlock public key and the seal key version. It refuses a request
   that carries enc_s(S).

### Release (unlock, step-up, export)

1. The worker reads enc_s(S) and adds a temporary client seal: enc_c(enc_s(S)).
2. It sends this value with the code proof to `factor-release`.
3. The server checks the code for its operation, removes its own seal and returns enc_c(S).
4. The worker removes its client seal. S stays in the worker.
5. The worker proves the pinned unlock key, as today.

The response carries no ECDH-sealed S, and the route takes no worker public key. One blinded
helper serves this release, the warm-session restore (F6) and, if U5 says so, the linked-device
material.

### A new device

- A device with no sealed factor does not offer the Email OTP unlock. Google and an email code
  give a sign-in only. The menu then offers two choices: link from a device that has the wallet,
  or enter a recovery code.
- **Device linking.** The new device enrolls its own Email OTP factor as a new linked-device
  method. The source device reseals the seed for it over the link channel. The server releases
  nothing, and the `email-otp-base-factor` route goes away.
- **A recovery code.** The code opens the seed (F8). The device then enrolls a new owner Email
  OTP factor. Google recovery releases no S, and that release (F3) goes away.

### Existing wallets

At the next unlock of an owner method that still has a server copy:

1. The release runs as today. This is the last time that the server sees S.
2. In the same unlock, the worker makes S′, enrolls it with the blinded three-pass, and reseals
   the custody envelope for S′ (`resealWalletCustodyFromUnlockedCapability`).
3. One server commit, with a check on the enrollment version, stores the new pinned key, the new
   seal key version and the new envelope. In the same commit it deletes enc_s(S), the old
   envelope and the old pinned key.
4. If the commit fails, the old state stays, and the next unlock tries again.

A server copy is used only for this rotation. It never unlocks a wallet without the rotation.
If an owner used Email OTP on two devices, the second device has no factor after the rotation,
and it uses device linking or the recovery code. Slice 5 deletes the rotation path and the
column.

### Email codes

The server stores HMAC-SHA-256 of each code, with a new Worker secret, and compares in constant
time. A code that is in flight at the deploy fails, and the user asks for a new code.

## 2. Invariants

- No route returns S, or a value that the server can turn into S without data from the device.
- After the rotation of a wallet, the server stores no enc_s(S) for it. After Slice 5, the server
  stores none.
- With every D1 row and every Worker secret, and no device data, nobody can get S or open an
  Email OTP envelope.
- An email code alone never opens a wallet on a device that has no sealed factor.
- Export still needs a fresh email code for the operation `export_key`.
- A copy of the device's IndexedDB alone cannot open the wallet. The server removes its seal
  only after a valid code, or a live Wallet Session within its limits (D5).

## 3. Slices

- **Slice 0: facts and decisions.** Answer U1 to U5. Get D2 to D7. No product code.
- **Slice 1: hashed email codes.** The HMAC change of Section 1. It does not depend on the other
  slices and can ship first.
- **Slice 2: new enrollments.** The device-held factor and the blinded release for
  registration, adding Email OTP, unlock, step-up and export. A new wallet never has a server
  copy. The operator test for new wallets. Update [Browser workers](browser-workers.md), because
  the Email OTP worker then stores the sealed factor.
- **Slice 3: existing wallets and new devices.** The rotation at unlock, the sign-in-only state
  with its two choices in the menu (English and Japanese text), device linking with the target's
  own factor, and recovery with no release.
- **Slice 4: the release.** seams-monorepo in one coordinated commit if U4 needs it. The wallet,
  `wallet-server` and the seams-monorepo site ship together. Staging first, then production.
  The D4 deadline starts when production has Slice 3.
- **Slice 5: the end of server copies.** After the D4 deadline: delete each server copy that is
  left, the rotation path, the ECDH release code and the column. Run the operator test for all
  wallets. Update the docs of the last section.

## 4. Tests

- **The operator test.** It loads every D1 row and every Worker secret and no device data. It
  must fail to get S and to open the envelope. Slice 2 runs it for new wallets, Slice 5 for all.
- **Email OTP unlock** on the same browser still works, and no release response carries an
  ECDH payload.
- **A new browser:** Google and an email code give a sign-in only. Then device linking gives an
  unlock. In a second run, a recovery code gives a new factor and an unlock.
- **Rotation:** a wallet that the old code made unlocks once and rotates. Its server row then has
  no enc_s(S). A second unlock does not rotate again. A failed commit keeps the old state.
- **Device linking** with an Email OTP target that enrolls its own factor.
- **Google recovery** releases no S and enrolls a new factor.
- **Email codes:** D1 holds no code. A wrong code fails. The lockout limits do not change.
- **The Wallet Session release (D5)** needs the device's sealed factor. Export needs a fresh
  code.

## 5. Relation to other plans

- **Refactor 251.** This plan decides D26. After Slice 5, a compromised Auth Worker cannot open
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

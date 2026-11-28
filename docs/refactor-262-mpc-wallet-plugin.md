# Refactor 262: the MPC wallet as a plugin of Seams Auth

Status: 2026-11-29. Plan only; no slice is built. This is the browser half of
[Refactor 251](refactor-251-auth-wallet-checkout-modules.md), Slice 7. Slices 8 and 9 of Refactor
251 depend on it. The owner chose a separate plan on 2026-11-29.

## Decisions for the owner

Each one has a recommendation. The slices follow the recommendation until the owner decides.

- **Q1. The order: the transport first.** Slice 1 moves today's wallet host runtime behind the
  plugin contract (`auth.channel('mpc-wallet')`), with the old account layer inside it. Each later
  slice replaces one flow of the account layer with new code, while all 12 journeys stay green on
  the new driver. Recommended. The other order (a new account layer beside the old wallet iframe)
  puts two runtimes on one IndexedDB database.
- **Q2. One account, one wallet, one ID.** `wallet.create()` makes the wallet of the signed-in
  account, with the account ID as the wallet ID, as the migration of Refactor 251 does for each
  existing wallet. The Gateway takes the ID from a proof statement for naming only; the first
  envelope's factor proof binds the custody. The Gateway refuses a second wallet for one ID.
  Recommended.
- **Q3. The account frame on the Wallet origin (Refactor 251, D6).** The plugin must run on the
  origin of today's IndexedDB records and passkeys. The account frame is served at `/account/`
  of the Wallet origin. Recommended.
- **Q4. Passkey prompts at sign-up.** A new account makes its passkey in auth; the wallet needs
  that passkey's PRF result for its first envelope. Where the platform gives PRF at creation,
  sign-up and wallet creation use one prompt; otherwise two. Recommended: the same prompt count
  as today first, measured in Slice 3; a second prompt only where the platform needs it.
- **Q5. VoiceID.** Today's VoiceID host plugin becomes the `voice` gate of auth (Refactor 233,
  Section 4) in the slice that replaces its flow (Slice 2 for unlock). Recommended.

## Facts

- The journeys of `tests/conformance/journeys/journeys.ts` need registration, unlock, signing on
  NEAR and Tempo, a fresh proof, key export, adding and removing a method, sign-in on an empty
  browser, device linking and recovery (12 journeys, the `ConformanceDevice` interface).
- The old browser unlock alone is 9,523 lines (`SeamsWeb/operations/auth/**`). The account
  layer rows of Refactor 251 (5.1, 5.3 to 5.9, 5.12, 5.14 to 5.16) have about 65,900 lines.
- The wallet iframe host attaches to one `MessagePort` (`walletIframe/host/index.ts`,
  `onWindowMessage`). The client router speaks the `PM_*` protocol over that port. So the plugin
  channel can carry the same protocol.
- The Gateway's pinned-key check exists: `accountLayer/walletFactorProof.ts` (Refactor 251,
  Slice 7, `653299a7d`).
- Baseline on 2026-11-29: the old driver did not start. The intended Wallet build failed in
  `assert-static-wallet-assets.mjs`: `/sdk/phraseCard-*.js` references the missing
  `/sdk/voiceid/ort.wasm.bundle.min.js`. This came with the phrase card move of Refactor 233
  Slice 1 (`b3cc9ea6d`), not with Refactor 251. Slice 1 needs a green baseline first.

## Rules

- Write new code, as Refactor 251 Section 2 says. The Rust, the WASM, the workers and the
  signing engine stay (Refactor 251, D13).
- [Browser workers](browser-workers.md): the workers start from the account frame document in
  place of the wallet iframe document. No operation moves between workers. Update the document
  in the same change as any worker change.
- `packages/host` builds the hosted plugin file only after the Refactor 250 session reports; until
  then the build stays in `packages/mpc-wallet` and the tests serve the file themselves.
- After each slice: its journeys pass on the new driver, `pnpm report:bloat --check` passes, the
  result is written here, and one commit on `dev`.

## Slices

- **Slice 1: the plugin and its workers.** `/sdk/mpc-wallet/host.js` (the host half) starts
  today's wallet host runtime in the account frame and connects it to the plugin channel. Wallet
  screens use `host.openSurface`. `createMpcWallet({ auth })` (the page half) is today's client
  router over `auth.channel('mpc-wallet')`. A new driver (`journeys/mpcWalletDriver.ts`) and a
  test app with `createSeamsAuth` and `createMpcWallet` run against the local Wallet system and a
  local Auth Worker. Journeys: all 12, on the old account layer. Rows that Slice 8 can close:
  6.25 (the wallet half of the iframe protocol), 7.13 (the old overlay), 6.19 and 7.1 (the old
  hosted auth menu entry).
- **Slice 2: unlock.** New code: the plugin asks the Gateway for a challenge for the audience
  `wallet`, calls `host.prove` with a secret sink to the custody worker, and new Gateway routes
  check the proof with `verifyWalletFactorProof` and issue the Wallet Session with today's
  issuance services. Step-up uses the same proof. Journeys: unlock and signing (2), step-up (2),
  sign-in on an empty browser. Rows: 2.1, 2.8, 2.9, 4.2, 4.6, 5.16, 6.8, 6.17.
- **Slice 3: creation.** `wallet.create()` for the signed-in account (Q2, Q4): the first envelope
  from a proof with a secret sink, and the chain registration of today. Journeys: registration
  (2). Rows: 1.1, 2.2, 3.10, 5.1, 6.10.
- **Slice 4: method envelopes.** A method that auth adds while the wallet is unlocked gets an
  envelope; one added while locked is "sign-in only" until the next unlock. The Gateway's removal
  subscriber route uses `answerMethodRemoval`. Journeys: add and remove a method (2). Rows: 2.3,
  5.3 to 5.7, 6.11, 7.10.
- **Slice 5: device linking.** The new device's own method in auth, the envelope copies, and the
  owner proof through `prove('wallet')`. Journey: device linking. Rows: 2.4, 5.8, 5.9, 5.12,
  6.14, 6.24.
- **Slice 6: recovery.** A recovery code gives new envelopes and, by D25 of Refactor 251, a
  first method in auth. Journeys: recovery (2). Rows: 5.14, 5.15, 6.13, 7.4, 7.6.

When Slice 6 passes, the whole suite runs on the new driver, and Refactor 251 Slice 8 starts.

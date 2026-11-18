# Refactor 253: an OPRF for the signing-session seal

Status: 2026-11-19. D1 to D9 are decided. Slices 0, 1, 2 and 4 are done (Section 8, "What Slice
2 changed"). Slice 3, the release with seams-monorepo, waits for the owner.

The owner asked: "We use shamir-3-pass to persist signing session material between page
refreshes. Can it be replaced with the faster OPRF?" This plan answers the question. The OPRF is
RFC 9497 on ristretto255 with SHA-512, in POPRF mode, with `info` set to the wallet ID and the
threshold session ID. [Refactor 252](refactor-252-email-otp-device-factor.md) D9 proposes the
same OPRF for the Email OTP factor seal, and says that a separate plan replaces the
signing-session seal. This is that plan. The Email OTP factor seal is not in its scope.

## The answer

Yes, with four conditions:

- The device keeps a random OPRF input x and the secret encrypted under a key from the OPRF
  output. The server never gives back the sealed value itself. No flow needs that (Section 2).
- The server takes `info` from the admitted Wallet Session. It never reads `info` from the body.
- The Wallet, `wallet-server` and the seams-monorepo deploy config ship together. The new Wallet
  deletes the old sealed records when it reads them. Each affected session needs one normal
  unlock (D6, D7).
- The three-pass code goes away only if the Email OTP factor seal moves too (Refactor 252 D9).
  If only one seal moves, the WASM runtime, its worker and the group fields stay (D8).

The gain today is mainly security of the primitive, with a small speed gain. It is not a fix for
a practical attack on this seal:

- **Speed.** In Node, the math of one restore is about 5.5 ms with three-pass at 1024 bits and
  0.8 ms with the POPRF WASM runtime that Refactor 252 is building (F17, Section 4). In the
  browser, a restore after a reload runs cold code. There, the device work took about 33 ms with
  three-pass and about 13 ms with the POPRF (F18). So the POPRF saves about 20 ms for each restore
  after a reload. The seal route alone took 44 to 75 ms in a local benchmark (F14). The gain is
  much larger against a three-pass group of 2048 bits (about 50 ms of math in Node) or 3072 bits
  (about 165 ms, inferred).
- **Security.** The 1024-bit group gives about 80 bits, and ristretto255 about 128 bits. For this
  seal the practical risk today is small (F13). The gains are a standard primitive, constant-time
  code and one implementation for both seals.
- **Size.** If both seals move, the client assets shrink by about 10 KB (3 KB with gzip) and lose
  one worker script and one nested worker. If only the Email OTP factor seal moves, the client
  carries both runtimes, about 146 KB more (52 KB with gzip) (Section 4).

The 1024-bit group must go in any case. Of the two ways to replace it, a 2048-bit three-pass costs
about 45 ms more per seal and per restore. The POPRF costs about 5 ms less in Node, and about
20 ms less on the device after a reload. So the POPRF is the recommended replacement.

## Facts this plan builds on

Checked in the code on 2026-11-18 at `eb3ad8d77`. `seal/` is
`packages/wallet-server/src/threshold/session/signingSessionSeal/`. `srv/` is
`packages/wallet-server/src/`. `wk/` is
`packages/wallet/src/core/signingEngine/workerManager/workers/`. `sess/` is
`packages/wallet/src/core/signingEngine/session/`. `shared/` is `packages/shared-ts/src/utils/`.

- **F1. Two routes, one body.** `POST /wallet-session/seal/apply-server-seal` and
  `.../remove-server-seal` take `{thresholdSessionId, ciphertext, keyVersion?, metadata?}`
  (`seal/transport/shared.ts:38-78`). They return `{ciphertext, keyVersion, expiresAtMs}`
  (`seal/service.ts:257-262`).
- **F2. One lock key per wallet, session and key version.** The server signs a context of wallet,
  session and key version with an HMAC of the seal root, then derives the lock key pair from it
  (`seal/crypto/cipher.ts:187-202, 313-338`). The wallet is the admitted wallet, not a body field
  (`cipher.ts:465-470`).
- **F3. Key versions.** Apply accepts only `currentKeyVersion`. Remove accepts any version in
  `acceptedWarmKeyVersions` (`cipher.ts:357-383`). The Gateway reads both from its environment
  (`srv/hosted-wallet-gateway.ts:1124-1154`).
- **F4. The gate of both routes.** A bearer operation credential of a Wallet Session. The
  admission refuses a retired or expired session, an inactive authority or auth method, a changed
  authority digest or epoch, and a session with no signing permission for the signer
  (`srv/router/transport/fetch/createFetchRouter.ts:201-306`,
  `srv/router/domains/signingOperations/walletExecutionAdmission.ts:197-239`). The service then
  checks the session ID, the wallet and the expiry again (`seal/service.ts:208-222`).
- **F5. No server check of remaining uses.** The service says that the SigningWorker owns the
  signing budget (`seal/service.ts:239-240`). The route returns no `remainingUses`. The device
  checks its own count and expiry before and after the route (`wk/passkey-mpc-session.worker.ts:
  869-893`, `wk/email-otp/sessionState.ts:415-431`).
- **F6. Idempotency and single flight.** The service keys a request on the operation, the wallet,
  the session, the key version and a SHA-256 of the ciphertext (`seal/service.ts:155-176`). It
  replays stored results for 90 s, also six error codes (`service.ts:14-22, 178-181`), and joins
  equal requests in one isolate (`service.ts:357-409`). `createSigningSessionSealOptions` passes
  no store and no guard (`seal/options.ts:59-70`). So the hosted Gateway runs only the single
  flight, and no rate limit. Both lock operations are stateless and deterministic for one input,
  so the store is a cache, not a need. The device has its own single flight
  (`wk/passkey-mpc-session.worker.ts:790-804`, `wk/email-otp/sessionState.ts:339-360`).
- **F7. The prepared registration seal.** The registration body carries `sessionSeal`
  `{thresholdSessionId, ciphertext, keyVersion}` (`srv/router/domains/walletRegistration/
  registrationSessionSeal.ts:137-169`). After the commit, the server applies its lock with the
  committed wallet and checks the Ed25519 session, the wallet, the Wallet Session ID and the expiry
  (`registrationSessionSeal.ts:47-102`). A seal failure does not fail the registration (`:41-45`).
- **F8. The passkey seal.** The sealed value is `prfFirstB64u`, the passkey PRF output for the
  fixed salt `PASSKEY_PRF_FIRST_SALT_V1` (`shared/signingSessionSeal.ts:38-41`). The authenticator
  decides it, and it is the same for each session of one credential. The client lock is prepared
  during registration (`wk/shamir3pass/clientSealPreparation.ts:95-180`). Seal:
  `wk/passkey-mpc-session.worker.ts:911-1038`. Restore: `:1040-1147`. A cache keeps the sealed
  value for each wallet, credential, Wallet Session and quota (`:569-630`).
- **F9. The Email OTP seal.** The sealed value is the Email OTP factor key S. The unlock binds it
  as ECDSA warm material and as the Ed25519 Yao warm factor (`wk/email-otp/unlock.ts:663-667,
  700-704`). The worker made S at enrollment (Refactor 252 F1). Seal:
  `wk/email-otp/sessionState.ts:694-798`. Restore exists for ECDSA only (`:800-928`). The only
  caller seals an ECDSA target (`sess/emailOtp/ecdsaPublication.ts:675-685`), so the Ed25519 Yao
  branch of the seal has no caller. The Ed25519 re-hydrate uses the bearer release of Refactor
  252 U3.
- **F10. The ECDSA scope spans Wallet Sessions.** For ECDSA, the server sets the seal's session
  ID to the ECDSA active state ID: key ID, signing root, root version and activation epoch
  (`createFetchRouter.ts:159`, `shared/routerAbEcdsaDerivation.ts:3210-3219`). A new Wallet Session
  for the same activation can open an ECDSA record.
- **F11. The device records.** Record v2 holds `alg: 'shamir3pass-v2'`, `groupId`,
  `sealedSecretB64u`, `keyVersion`, `expiresAtMs` and `remainingUses`
  (`shared/signingSessionSeal.ts:182-222`). A record with another version, `alg` or group is
  classified as malformed and deleted when read (`sess/persistence/sealedSessionRecords.ts:749-781`,
  `sess/persistence/sealedSessionStore.ts:251-264`). Inactive ECDSA records keep
  `sealedSecretB64u` after expiry (`sealedSessionRecords.ts:125-140`). No code that I found
  unseals them (`sess/material/ecdsaSealedRuntime.ts:426-495` uses current records only).
- **F12. Session limits.** The default Wallet Session lives 24 hours with 5 uses. The maximum is
  30 days (`packages/shared-ts/src/threshold/sessionPolicy.ts:5-15`).
- **F13. What a solved discrete logarithm gives.** Each wallet and session has its own lock key,
  derived through an HMAC of the root (F2). To solve for that key, an attacker needs a value and
  its locked form under it. Only a holder of a live Wallet Session can get such a pair, and that
  holder gets the value from a normal restore anyway. Both sealed values outlive the session (F8,
  F9), so the key of one session protects nothing that such a holder does not have. So the
  1024-bit group weakens this seal little today. It matters more for the Email OTP factor seal
  (Refactor 252 F14).
- **F14. Measured browser timings.** A local benchmark on 2026-09-23 (40 registrations,
  Chromium, local Workers; `docs/near-custody-overlap-latency.json`) recorded the seal at session
  start: runtime setup 9 to 20 ms (median 11), client lock 41 to 74 ms (median 45), server route
  44 to 75 ms (median 48) and client unlock 39 to 49 ms (median 45). In Node, one lock step takes
  1.7 ms (Section 4). F18 explains a part of the difference (U1). The restore records no timings
  (`wk/passkey-mpc-session.worker.ts:1040-1147`).
- **F15. Code that both seals share.** `seal/crypto/cipher.ts` (the scopes, key versions and lock
  key derivation), `seal/crypto/shamir3PassWasm.ts`, `parseSigningSessionSealRootConfig`
  (`seal/options.ts:40-57`, also read by `srv/router/cloudflare/d1/auth/
  d1RouterApiAuthConfig.ts:700-724`), the root secret and current key version variables
  (`hosted-wallet-gateway.ts:1213-1247`), the group and algorithm constants, the client runtime
  `wk/shamir3pass/runtime.ts` with the nested worker, and `wk/email-otp/crypto.ts:117-130`. The
  Email OTP code seal key also comes from the same root (`d1RouterApiAuthConfig.ts:716`).
- **F16. seams-monorepo reads no seal wire field.** It calls `createSigningSessionSealOptions`
  (`packages/wallet-console-server-ts/src/router/cloudflare/d1LocalDevWorker.ts:249-251, 916-917,
  1598`, and two test helpers). Its deploy config checks `algorithm: 'shamir3pass-v2'` and
  `groupId: 'rfc2409-group2'` exactly (`packages/wallet-console-server-ts/scripts/
  gateway-deployment-config.mjs:387-408`, `deployment/wallet-system/targets.json`,
  `generate-github-env-values.mjs:1079-1081`,
  `scripts/local-wallet/d1-local-runtime-config.mjs:173`). `ensure-d1-local-wasm.mjs:12-13`
  copies the three-pass WASM.
- **F17. A POPRF runtime is being built.** On 2026-11-18 the Refactor 252 work added
  `wasm/oprf_runtime` (not yet committed). It wraps `voprf` 0.5.0 in POPRF mode on
  ristretto255-SHA512, and its lock file resolves `curve25519-dalek` to 4.1.3. It exports a client
  blind and finalize, with the blind kept in WASM behind a handle, a server evaluation from a
  32-byte seed and a key label, and the public key. Its tests check RFC 9497 Appendix A.1.3. The
  module is 129,500 bytes, and its JavaScript glue 16,083 bytes.
- **F18. Browser timings of the device steps.** Measured on 2026-11-18 in the Chromium 156 pane of
  the Claude app on an Apple Silicon Mac, with the built `shamir3pass.worker.js` and its WASM, and
  the runtime of F17. Each round ran in a new module worker, as a restore after a reload does.
  After a page reload, all 5 rounds ran cold:
  - Three-pass through the nested worker: the first client key 12 to 21 ms (worker start and WASM
    start), the first lock 7.5 to 14 ms and the first unlock 6 to 11 ms. Medians 16, 10 and 7 ms,
    about 33 ms for one restore. Later lock steps in the same worker took about 6.5 ms each.
  - The POPRF in process: module start 3 to 4.4 ms, the first blind 2.5 to 3.2 ms and the first
    finalize 5.4 to 12.5 ms. Medians 3.5, 2.7 and 6.8 ms, about 13 ms for one restore.
  - A message round trip to the nested worker took 0.1 ms. So the messages cost almost nothing.
    The cost is the worker start and cold WASM code. In one earlier page load, rounds 4 and 5
    became 3 to 4 times faster (1.7 ms for a lock step, as in Node), because the browser had
    compiled faster code by then. A reload lost that gain.

## 1. The flows

Each flow, except registration, calls the route from the worker that holds the secret. In
registration, the main thread carries the client-locked value to the server and the server's
response back to the worker. Both values are locked.

- **Passkey registration.** Seals `prfFirstB64u`. The client lock is prepared during the
  registration and sent in the registration body. The server applies its lock after the commit.
  Gate: F7, current key version only.
- **Passkey unlock or login.** Seals `prfFirstB64u` with the apply route. Gate: F4, current key
  version only.
- **Passkey reload.** Restores `prfFirstB64u` with the remove route. Gate: F4, an accepted key
  version, and the device count and expiry (F5).
- **Email OTP ECDSA unlock.** Seals S with the apply route under the ECDSA scope (F10). Gate: F4.
- **Email OTP ECDSA reload.** Restores S with the remove route. Gate: F4 and F5.
- **Email OTP Ed25519 Yao.** No seal caller and no restore today (F9). Refactor 252 D5 plans one.

All flows go through the server single flight of F6 and the device single flight. None uses a
server check of remaining uses.

## 2. Does a flow need a property that an OPRF lacks?

No. Each property in turn:

- **The exact value back.** Three-pass gives back the sealed value. With the OPRF, the device
  keeps x and an AEAD ciphertext of the value under a key from F(x). Every flow keeps its record
  on the device already. The new record holds x (32 bytes), a nonce (12), the ciphertext (32) and
  a tag (16): 92 bytes, against a group element of 128 bytes today.
- **A server re-key without the client.** No flow does this. The server stores no sealed value
  for this seal. (Refactor 252 D6 re-seals the Email OTP factor with the client, not without it.)
- **Key rotation.** New seals use the current version. Old records open while their version is
  accepted. The POPRF keeps this rule. No flow re-seals a record, because records live at most 30
  days (F12).
- **Retries with the same blinded value.** The POPRF evaluation is deterministic, so the same
  blinded element gives the same evaluated element. The proof has a random nonce, but each valid
  proof verifies. A replay key on a hash of the blinded element works as today.
- **A prepared seal.** The prepared client lock maps to a prepared blind: x, the blind r and the
  blinded element, kept in the worker until one session takes them.
- **The passkey cache (F8).** It relies on equal values giving equal sealed values. With the
  POPRF, the worker keeps x and the ciphertext for the session instead, and the cache goes away.
- **The 32-byte decode.** Group elements drop leading zero bytes, so
  `decodeSigningSessionSecret32` pads them back (`shared/signingSessionSeal.ts:28-36`). An AEAD
  returns the exact bytes, and this helper goes away.

## 3. The design

### The primitive

RFC 9497, suite ristretto255-SHA512, mode POPRF (0x02), from the runtime of F17 (D3).

- **Server key.** For each purpose and key version: `skS = DeriveKeyPair(seed, keyInfo)` (RFC
  9497 Section 3.2.1). The seed is an HMAC of the seal root over a tuple of a label, the purpose
  (`signing_session`) and the key version. `pkS = skS * G`.
- **`info`.** The length-prefixed tuple of `encodeSigningSessionHkdfTuple`: a label, the wallet ID
  and the threshold session ID. The server builds it from the admission (F4). For ECDSA the
  session ID is the active state ID (F10).
- **Device record (v3).** `sealedSecretB64u` holds x (32 random bytes), a random 12-byte nonce
  and the AES-256-GCM ciphertext of the secret (92 bytes in all), next to `keyVersion`,
  `expiresAtMs` and `remainingUses`. The AEAD key is HKDF-SHA256 of the 64-byte OPRF output with
  a label. The associated data is the wallet, the threshold session ID and the key version. No
  `groupId`.

### Seal at session start (one evaluation)

1. The worker draws x and a blind r, and computes the blinded element `B = r * H(x)`.
2. It calls `POST /wallet-session/seal/evaluate` with `{thresholdSessionId, keyVersion,
   blindedElementB64u}`. Registration sends the same fields in `sessionSeal` (F7).
3. The server runs the gate of F4, checks the key version and builds `info`. It returns
   `{evaluatedElementB64u, proofB64u, keyVersion, expiresAtMs}`.
4. The worker verifies the proof with `pkS` and its own `info`, removes the blind and gets the
   output y. It encrypts the secret, stores the record and zeroes y, r and the AEAD key.

### Restore after a reload (one evaluation)

The same four steps with the stored x. Step 4 decrypts instead of encrypting. A failed proof or
a failed AEAD tag is a restore failure. The next operation then uses a normal unlock, as today.

### Decisions

The owner accepted D1 to D9, as recommended, on 2026-11-18. Where an item names another choice,
that choice was declined.

- **D1. Replace three-pass with the POPRF for this seal.** Recommended. The group must change in
  any case (Refactor 252 F14), and the POPRF is faster than three-pass at 1024 bits when it runs
  in WASM.
- **D2. Verify the proof.** Recommended. The RFC POPRF mode includes the proof. It shows a wrong
  key version or a wrong `info` at seal time, before the device writes a record that never opens.
  Each evaluation response carries `pkS`, as the Refactor 252 device factor does, so the
  well-known document does not change (Section 8). This is a check of consistency, not of trust,
  because the same server publishes the key. Cost: about 0.3 ms on the device. The other choice
  is the base OPRF mode with a key derived for each scope, as the lock key was. It has no proof
  and no public key, and a wrong key shows only at restore.
- **D3. Reuse the runtime of F17.** Recommended, so that both seals have one implementation
  (D8). It uses the `voprf` crate, which is also the OPRF of `opaque-ke`, and it passes the RFC
  vectors. The other choice is our own RFC 9497 code on `curve25519-dalek` =4.1.3. We need only
  one suite, one mode and batches of one, and `crates/threshold-prf` already has DLEQ code on
  ristretto255 (with its own transcript, not the RFC one). But dalek's `hash_from_bytes` is not
  the RFC 9380 hash, so that code must add `expand_message_xmd`. A benchmark build of dalek alone
  without base tables is 56,831 bytes, so our own code could be about 60 KB smaller than the
  runtime. That gain does not pay for a second implementation now.
- **D4. One route.** `evaluate` replaces apply and remove, because the server does the same
  thing for a seal and for a restore. The key version rule stays: seals use the current version,
  and the device sends the version of its record at restore.
- **D5. The client runs the OPRF in its own worker.** `wasm/oprf_runtime` (F17) replaces
  `shamir3pass_runtime`. The passkey session worker and the Email OTP worker load it in process,
  so the nested Shamir worker goes away. The blind is a
  one-request secret, and the parent worker already holds the value that it protects. Record the
  reason in [Browser workers](browser-workers.md), under "Separations with no recorded reason", as
  that document asks before a layout change. The Gateway loads the same module.
- **D6. No conversion of old records.** Recommended. A record cannot become (x, ciphertext)
  without one three-pass removal. A dual-read period would keep the three-pass route for up to 30
  days (F12). The new reader deletes v2 records (F11), and the next operation unlocks. The cost
  is one unlock for each session that is alive at the deploy. AGENTS.md also asks for no
  compatibility paths.
- **D7. Ship together.** The Wallet, `wallet-server` and the seams-monorepo deploy config go out
  in one release (Section 5).
- **D8. One implementation for both seals.** If Refactor 252 D9 also chooses the POPRF, both
  seals use one crate, one WASM module and one evaluator with two scopes. Each purpose gets its own
  key from the root (Section 3, "Server key"), so the session seal, the factor seal and the Email
  OTP code seal never share a key. The three-pass deletion (Section 6) waits until both seals
  have moved.
- **D9. A rate limit on `evaluate`.** Recommended. Today no guard runs (F6). RFC 9497 Section
  7.2.3 explains that each evaluation under one key helps an attacker who wants that key. The
  existing guard, keyed on the wallet and the session, bounds this at no cost.

## 4. Cost

Measured on 2026-11-18 on an Apple Silicon Mac in Node 24.18.0:

- **Three-pass WASM** (`shamir-3-pass` 0.6.0): one lock step 1.7 ms at 1024 bits and 16.0 ms at
  2048 bits. A client key 0.3 ms and 0.8 ms. The first lock in a new process 2 to 4 ms and 17 ms.
  Module compile and start 11 to 13 ms.
- **`@noble/curves` 1.9.1** (JavaScript): one ristretto255 scalar multiplication 1.27 ms, a base
  multiplication 0.13 ms (the first one 20 to 22 ms, to build its table), a hash to the group
  0.16 ms.
- **`curve25519-dalek` 4.1.3 in WASM** (a benchmark build without tables, `wasm-opt -O3`): one
  scalar multiplication 40 µs, a base multiplication 40 µs (14 µs with tables), a hash to the
  group 8 µs, a scalar inversion 11 µs.
- **The POPRF runtime of F17** (the uncommitted build of 2026-11-18): client blind 0.055 ms,
  server evaluation 0.34 ms (with the key derivation from the seed), client finalize 0.39 ms. The
  first call in a new process 0.5, 1.2 and 0.8 ms. Module compile and start 11.5 to 12 ms.

The math of one seal or one restore:

| Scheme | Device | Server | Total |
| --- | ---: | ---: | ---: |
| Three-pass, 1024 bits | 3.7 ms | 1.7 ms | about 5.5 ms |
| Three-pass, 2048 bits | 32.8 ms | 16.0 ms | about 50 ms |
| Three-pass, 3072 bits (inferred) | about 110 ms | about 55 ms | about 165 ms |
| POPRF, runtime of F17 (measured) | 0.44 ms | 0.34 ms | about 0.8 ms |
| POPRF, noble JavaScript (estimate) | about 9.5 ms | about 5.3 ms | about 15 ms |

The JavaScript estimate counts the operations of RFC 9497. The device side is 7 scalar
multiplications, 2 base multiplications and one hash to the group (blind, the tweaked key, the
proof check and the unblind). The server side is 4 scalar multiplications and 2 base
multiplications.

So:

- In JavaScript, the POPRF is slower than three-pass at 1024 bits. The WASM runtime of D5 is the
  condition for any speed gain.
- In the browser, cold code and the worker start cost more than the math. A restore after a
  reload took about 33 ms on the device with three-pass and about 13 ms with the POPRF (F18). The
  route took 44 to 75 ms (F14). The Gateway must also warm the POPRF runtime, as it warms the
  three-pass runtime today (`shamir3PassWasm.ts:93-114`), because a cold first evaluation took 5 to
  45 ms in the browser.

Size. The three-pass client assets are `shamir3pass_runtime_bg.wasm` (117,117 bytes, 46,480 with
gzip), `shamir3pass_runtime.js` (15,390 and 3,417) and `shamir3pass.worker.js` (22,825 and 5,743):
155,332 bytes, 55,640 with gzip. The POPRF runtime of F17 is `oprf_runtime_bg.wasm` (129,500 and
48,842) and `oprf_runtime.js` (16,083 and 3,626): 145,583 bytes, 52,468 with gzip. It runs in
the parent worker, so no worker script comes with it. So:

- If both seals move, the client assets shrink by about 10 KB (3 KB with gzip).
- If only the Email OTP factor seal moves (Refactor 252 D9), the client carries both runtimes:
  about 146 KB more (52 KB with gzip).
- Our own RFC code (D3, the other choice) could save about 60 KB more, from the size of the dalek
  benchmark build.

The Gateway swaps its 117 KB three-pass module for the 130 KB runtime.

## 5. Migration and the wire

- **Records on devices.** The new reader deletes v2 records and v2 inactive ECDSA records (F11).
  The restore fails, and the next operation uses a normal unlock or step-up
  ([Intended behaviours](intended-behaviours.md), "Page refresh must not create new authority").
  Sessions alive at the deploy lose their reload restore once. Every hosted Wallet Session so far
  had a TTL of 24 hours or less, and none was alive on 2026-11-18 (U4). No key or fund is at
  risk.
- **Wire fields that change.**
  - Routes: `apply-server-seal` and `remove-server-seal` become `evaluate`.
  - Request: `ciphertext` becomes `blindedElementB64u`. `metadata` goes away (the server logs
    only its keys, and no client sends it).
  - Response: `ciphertext` becomes `evaluatedElementB64u`, `proofB64u` and `publicKeyB64u`.
  - Registration `sessionSeal`, request and response
    (`packages/wallet/src/core/rpcClients/relayer/walletRegistration.ts:4057-4284`,
    `registrationSessionSeal.ts:137-169`): the same change.
  - Well-known `signingSessionSeal.protocol`: `{algorithm: 'shamir3pass-v2', groupId}` becomes
    `{algorithm: 'ristretto255-sha512-poprf-v1'}`.
  - Client config defaults (`packages/wallet/src/core/config/defaultConfigs.ts:127-135`,
    `configBuilder.ts:138-151`) and the Email OTP seal transport `groupId`
    (`wk/email-otp/sessionState.ts:698-706`).
  - IndexedDB: record v3 (Section 3).
- **Ship together (D7).** Each order fails safe. If the server goes first, an old Wallet cannot
  seal or restore and falls back to an unlock. If the Wallet goes first, its seals fail, and a
  registration still commits (F7). Both orders lose reload restore for a while, so ship together.
- **seams-monorepo (F16).** No product code reads the seal wire. If
  `createSigningSessionSealOptions` keeps its name and its input, the local dev worker and the
  test helpers do not change. One coordinated commit changes the deploy config checks, the target
  values, the local runtime config and the WASM copy list. The secret name can stay.

## 6. What gets deleted

When both seals have moved (D8):

- `wasm/shamir3pass_runtime/` and its build steps (`packages/wallet/scripts/build/
  build-wasm.sh:95-99, 259, 298-299`, `build-sdk.sh:43-44, 120, 135-136`).
- `wk/shamir3pass.worker.ts`, `wk/shamir3pass/runtime.ts` and
  `wk/shamir3pass/clientSealPreparation.ts` (the prepared blind replaces it).
- `wk/email-otp/crypto.ts` `removeClientSealToSecret32` and the passkey sealed-value cache
  (`wk/passkey-mpc-session.worker.ts:32-43, 569-630`).
- `seal/crypto/shamir3PassWasm.ts`, the three-pass parts of `seal/crypto/cipher.ts`
  (`shamir3pass_root_v2`, the runtime interface) and the Gateway warm-up
  (`hosted-wallet-gateway.ts:1025-1035`).
- The group fields: `SIGNING_SESSION_SEAL_GROUP_ID`, `SigningSessionSealGroupId`,
  `SigningSessionSealProtocol.groupId`, the record and inactive record `groupId`, the transport
  `groupId`, and the group part of the single-flight and cache keys.
- `decodeSigningSessionSecret32` and its unit test.
- Maybe the idempotency store and its backends (`seal/idempotency*.ts`). The hosted Gateway does
  not use them (F6), but they are public exports. Check the public API first.

If only this seal moves, the WASM runtime, the nested worker, the client runtime and the group
constants stay for the Email OTP factor seal.

## 7. Unknowns: the answers of Slice 0

Answered on 2026-11-18.

- **U1. Where the browser time goes.** Mostly the worker start and cold WASM code, not the
  messages and not the math (F18). The 41 to 74 ms of F14 is more than the 7.5 to 14 ms of F18.
  The difference is probably CPU load from the local Workers and 40 back-to-back registrations
  (inferred, not measured). The restore diagnostics move to Slice 2, because Slice 2 rewrites the
  same functions, and their numbers then show the POPRF path.
- **U2. The bearer after a reload.** The restore reads the operation credential, with its token,
  from the `wallet_session_authorizations` store (`packages/wallet/src/core/indexedDB/
  seamsWalletDB/walletSessionAuthorizationStore.ts`). The sealed records are in
  `signing_session_seals` of the same database (`packages/wallet/src/core/indexedDB/
  schemaNames.ts:18-21`). So a copy of the Wallet origin's IndexedDB restores the value while the
  session is live and not retired. The seal protects a copy taken after expiry or retirement, and
  it keeps the value from the server alone. This is the same for both schemes.
- **U3. Inactive ECDSA records.** Nothing unseals them. Both restore paths need a positive
  `remainingUses` and a future `expiresAtMs`, which inactive records do not have
  (`sess/passkey/ecdsaRecovery.ts:84-110`, `sess/emailOtp/ecdsaRecovery.ts:415-433`). Their only
  reader skips them (`sess/availability/persistedAvailableSigningLanes.ts:262-276`). Record v3
  retires a record without its sealed fields.
- **U4. Hosted session lengths.** Read-only counts on the 12 signer databases on 2026-11-18.
  `wallet_session_authorizations_v2` holds 3,838 sessions on staging, 19 on production testnet
  and 58 on production mainnet, all in the `sin` databases. Each one has a TTL of 24 hours or
  less (the largest is 86,400,000 ms). None was alive: the latest expiry was 71 hours earlier on
  staging and 28 days earlier on mainnet.
- **U5. `@noble/curves` in the bundle.** The built `email-otp` and `passkey-mpc-session` workers
  hold no curve code (no `ristretto` or `edwards` symbols). So a JavaScript POPRF would add
  `@noble/curves`. D5 keeps the WASM runtime, so this does not apply.

## 8. Slices

- **Slice 0: measure.** Answer U1 to U5. No change to behaviour. Done on 2026-11-18 (Section 7).
  The restore diagnostics moved to Slice 2.
- **Slice 1: the shared runtime.** `wasm/oprf_runtime` landed with Refactor 252 (`14fb169e9`).
  Done with Slice 2.
- **Slice 2: the seal.** Server and Wallet in one change. Done on 2026-11-19, together with Slice
  4, because no code used three-pass any more. See "What Slice 2 changed" below.
- **Slice 3: the release (D7).** seams-monorepo in one coordinated commit. Staging first, then
  production. The release notes say that open sessions need one unlock after the upgrade.
- **Slice 4: the deletion.** Section 6. Done with Slice 2. The idempotency store stays.

### What Slice 2 changed

- **Server.** `seal/crypto/oprf.ts` (the evaluator and the Gateway warm-up) replaces
  `cipher.ts` and `shamir3PassWasm.ts`. `core/oprfKeyring.ts` holds the per-version keys of one
  POPRF purpose; the Email OTP factor and the signing-session seal both use it, with the root
  helper `core/sealRootKey.ts`. One `POST /wallet-session/seal/evaluate` route replaces apply
  and remove. `createSigningSessionSealOptions` keeps its input and turns on a rate limit of 30
  evaluations a minute for each wallet and threshold session (D9).
- **Wallet.** `workers/oprf/signingSessionSeal.ts` holds the seal, the restore, the route call
  and the prepared blinds. The passkey session worker and the Email OTP worker use it in
  process. The nested Shamir worker, the three-pass runtime, the passkey sealed-value cache, the
  32-byte decode helpers and every `groupId` field are gone, also from the capability reader.
- **Public types.** `groupId` is gone from the Email OTP login options and from the seal
  protocol. The prepared seal API takes no PRF output and returns `blindedElementB64u`.
- **A bug fixed on the way.** The Email OTP export and rotation sent the seal group
  (`rfc2409-group2`) as `orgId` in `/wallet/unlock/challenge`. That field is now absent, as in
  the login path.
- **Not done.** Restore diagnostics: nothing would read them, and F18 measures the same steps.
  The well-known `publicKeys` of D2: each response carries the key instead. The deploy config of
  seams-monorepo (F16) changes in Slice 3.

### The change list of Slice 2

Written on 2026-11-18 from the Refactor 252 code that was not yet committed. It already has the
shared parts: the server wrapper `packages/wallet-server/src/core/oprfWasm.ts`, the Email OTP
evaluator `core/authService/emailOtpFactorOprf.ts`, and the client wrapper
`wk/oprf/runtime.ts` (blind, finalize and the AES-GCM key from the output). Check the names
again before Slice 2 starts.

Server (`srv/`):

1. `core/authService/emailOtpRootKey.ts`: make `deriveEmailOtpRootBytes` the one root helper of
   both seals. Remove the copy of the same HMAC in `seal/crypto/cipher.ts:297-338`.
2. A new `seal/crypto/oprf.ts`, built like `emailOtpFactorOprf.ts`: a seed for each key version
   from the root under the label `seams/signing-session-seal/oprf`, a fixed key label, and `info`
   from the admitted wallet and threshold session. It calls `core/oprfWasm.ts`.
3. `seal/service.ts`, `seal/transport/` and `seal/signingSessionSeal.types.ts`: one `evaluate`
   operation and route, the request and response of Section 5, and a replay key on a hash of the
   blinded element.
4. `seal/options.ts` and `seal/routesOptions.ts`: the evaluator in place of the cipher adapter,
   and the rate-limit guard on by default (D9). `createSigningSessionSealOptions` keeps its name
   and its input (F16).
5. `router/framework/ror/normalize.ts` and `router/transport/fetch/routes/wellKnown.ts`: the new
   protocol and `publicKeys` by key version.
6. `router/domains/walletRegistration/registrationSessionSeal.ts`: the prepared evaluation.
7. `hosted-wallet-gateway.ts`: warm the OPRF runtime in place of the three-pass runtime.
8. Delete the signing-session scope and adapter of `seal/crypto/cipher.ts`.

Shared (`shared/signingSessionSeal.ts`): record v3, the algorithm
`ristretto255-sha512-poprf-v1`, the key label and the `info` builder. This seal has no group ID.

Wallet (`packages/wallet/src/core/`):

1. `wk/passkey-mpc-session.worker.ts`: seal and restore through `wk/oprf/runtime.ts`. Delete the
   client seal preparation, the sealed-value cache and the nested-worker calls. Add the restore
   diagnostics.
2. `wk/email-otp/sessionState.ts`: the same for the ECDSA seal and restore.
3. `signingEngine/uiConfirm/PasskeyMpcSessionManager.ts` and `PasskeyMpcSessionDurableState.ts`:
   a prepared blind in place of the prepared client lock, and the v3 fields.
4. `sess/persistence/sealedSessionRecords.ts` and `sealedSessionStore.ts`: record v3. A v2 record
   is malformed. An inactive record keeps no sealed fields (U3).
5. `rpcClients/relayer/walletRegistration.ts` and `sealedRefreshCapabilities.ts`: the
   registration `sessionSeal` fields and the published keys.
6. `config/defaultConfigs.ts`, `config/configBuilder.ts` and
   `../SeamsWeb/walletIframe/shared/configuration.ts`: the new protocol.
7. `../SeamsWeb/signingSurface/BrowserSigningSurface.ts`, `sess/passkey/ecdsaRecovery.ts`,
   `sess/emailOtp/ecdsaRecovery.ts` and `sess/emailOtp/ecdsaPublication.ts`: pass the v3 record
   and drop `groupId`.

Then the tests of Section 9 and the documents at the end of this plan.

## 9. Tests

- **RFC 9497 vectors** for ristretto255-SHA512 in POPRF mode, in the runtime of F17. Add the
  cases that it does not have yet: the identity element and a non-canonical encoding fail.
- **The gate.** `evaluate` refuses a missing bearer, an expired or retired session, a session of
  another wallet and an unknown key version. A body field cannot change `info`.
- **Scope.** A bearer of session A cannot open a record of session B of the same wallet. The proof
  or the AEAD tag fails.
- **The operator test.** With every Worker secret and every request and response of the route,
  and no device data, nobody gets the sealed value.
- **Reload.** `tests/e2e/intended-behaviours/passkey.unlock.contract.test.ts` ("default sealed
  refresh hydrates ...") passes, and so does the Email OTP ECDSA reload restore. A v2 record is
  deleted, and the next operation unlocks.
- **Timing.** After a reload, the restore diagnostics show the POPRF device steps below the
  three-pass numbers of F18 (about 13 ms against about 33 ms in the same browser).
- `pnpm report:bloat --check` passes after the deletion.

## 10. Relation to other plans

- **Refactor 252.** D9 there and D8 here decide together. The scope type of D8 there (wallet and
  enrollment) becomes the POPRF `info` of that seal. D5 there plans an Ed25519 warm seal under the
  signing-session key. With this plan, that seal uses `evaluate` like the other flows.

## Documents to update when the slices land

- [Browser workers](browser-workers.md): the worker inventory, the WASM table and the diagram.
- [Intended behaviours](intended-behaviours.md): the text on the seal lock key (around line 1478).
- `packages/wallet-server/src/README.md`: the `createSigningSessionSealOptions` example.

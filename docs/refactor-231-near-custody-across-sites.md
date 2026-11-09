# Refactor 231: NEAR custody material across sites and devices

Status: 2026-11-10. Plan. Nothing is built. Target release: 0.61.

The user chose option B (2026-11-10): no client key material goes to the server. The Router
re-issues client material for the current epoch when a browser has none. Research for this
plan found that most "stale" caches do not need the Router at all (Section 2), so the plan
has two parts: a local re-bind and a Router redelivery.

## 1. Problem

On 2026-11-09, VoiceID unlock of `redwood-monolith-skk7jk` on `staging.wallet.seams.sh`
failed with "Something went wrong." The raw error was "Cached NEAR custody belongs to another
material activation."

| Field | Browser cache | Server (`/wallet/voiceid/verify`) |
| --- | --- | --- |
| `walletId`, `nearEd25519SigningKeyId`, `signingWorkerId` | same | same |
| `stateEpoch` | `1` | `2` |

The server's material activation was `wallet-recovery-ed25519-material-activation-…` with
lifecycle `wallet-session-ed25519-recovery-…`: a cold rejoin from a passkey login.

How a cache goes stale:

1. The Wallet frame's IndexedDB is partitioned per top-level site. Each integrator app has
   its own cache. A second device or cleared site data has the same effect.
2. A passkey login that finds no cache runs a cold rejoin
   (`openAndActivatePasskeyEd25519CustodyLogin`,
   `packages/wallet/src/SeamsWeb/operations/auth/login/custodyActivation.ts`). The rejoin is
   a Router `Recovery`. It moves the SigningWorker to the next state epoch.
3. Every other site's cache keeps the old epoch.

Effect today (after the interim commit `096e03ddc`):

| Factor | Stale cache | No cache |
| --- | --- | --- |
| Passkey | Rejoin; one Router round; makes all other caches stale | Rejoin (same) |
| VoiceID | Fails: "Unlock with a passkey once" | Fails: "Unlock with a passkey or Email OTP once" |
| Email OTP | Opens the cache with no epoch check; signing can fail later | Fails: "recover with a recovery code" |

## 2. Facts that shape the design

- **A recovery keeps both shares.** Registration and recovery use the `Base` contributions
  (`crates/router-ab-ed25519-yao/src/lib.rs:220`). These come from the client root and the
  Deriver roots with the stable key context only
  (`crates/signer-core/src/ed25519_yao_derivation.rs:466-497`). The circuit gives the client
  `x_client = s + tau` and the SigningWorker `x_server = s + 2·tau`
  (`tools/ed25519-yao-generator/src/circuit/families.rs:455`). The random "output coins"
  (`crates/ed25519-yao/src/passive/role_protocol.rs:3544`) only split each share between
  Deriver A and Deriver B. The generator's recovery reference requires that `Tau`,
  `ClientScalarBase`, `SigningWorkerScalarBase` and both public points do not change
  (`tools/ed25519-yao-generator/src/continuity_reference.rs:14`).
- **So an older cache after a recovery holds the current client share.** Only its labels
  are old: the epoch in the sealed plaintext and in the binding
  (`crates/router-ab-ed25519-yao-client/src/local_material.rs:180-261`).
- **Refresh is off.** The Router refuses `Refresh`
  (`crates/router-ab-cloudflare/src/router_coordinator.rs:1593`). The wallet does not use
  lane provisioning or lane refresh. These are the only operations that change a share.
- **The cache key does not depend on the epoch.** It comes from the custody seed and the
  application binding digest (`crates/signer-core/src/wallet_seed_derivation.rs:154`). Any
  factor that opens the envelope can open and re-seal the cache.
- **The client's Deriver inputs come from the seed**
  (`crates/router-ab-ed25519-yao-client/src/lib.rs:454`). A run with other inputs gives a
  share that fails the public-relation check against the registered key.
- **The capability that the server returns has no SigningWorker verifying share**
  (`RouterAbEd25519YaoActiveCapabilityDescriptorV1`,
  `packages/wallet-server/src/router/domains/ed25519Yao/recovery/routerAbEd25519YaoRecovery.ts:615`).
- **No client material reaches the server** (Decision 2026-08-09,
  `packages/shared-ts/src/passkey-custody/ceremonyCommitPayload.ts:204`). This plan keeps
  that decision.

## 3. Design

### 3.1 Re-bind an older cache locally (no Router round)

If the cache epoch is lower than the server's epoch:

1. Open the envelope with the factor, derive the cache key, and open the cached share with
   its own (old) binding.
2. Check the current public relation: the share, together with the server's **current**
   SigningWorker verifying share, gives the registered public key. Check also that the
   registered key, participant ids and application binding digest are the same.
3. Seal the share again with the current epoch and the current verifying share. Write the
   new row.

The re-bind moves forward only (new epoch > old epoch). The public-relation check makes it
safe: a share that does not pair with the current SigningWorker share cannot pass. If the
check fails (a future refresh changed the shares), the path continues as for "no cache".

### 3.2 Redeliver client material for the current epoch (Router, option B)

A new Router operation, `Redelivery`, gives a browser with no usable cache the client
material of the **current** epoch:

- Admission needs an Active SigningWorker at epoch `E` and an authorized Wallet Session.
- The Derivers run the existing activation circuit with the current `Base` contributions,
  the client's seed-derived inputs, and fresh coins. The circuit does not change.
- The Derivers emit only the two client packages and the public commitments. They do not
  emit SigningWorker packages. The Router does not call the SigningWorker. The epoch stays
  `E`.
- The client completes with `Preserve(registered public key)`, checks the public relation
  against the current SigningWorker verifying share, and seals the share at epoch `E`.
- `Redelivery` has its own operation tag and transcript domain. A redelivery result cannot
  be read as a recovery, and the reverse.

Because the client inputs come from the seed, only a holder of the seed gets a share that
passes the relation check. Thus any factor that opens the custody envelope (passkey, Email
OTP, VoiceID) can request a redelivery.

### 3.3 One resolver for all unlock paths

`resolveWalletCustodyEd25519Material` returns one of:

- `current`: the cache epoch equals the server epoch;
- `rebound`: Section 3.1 succeeded;
- `redelivered`: Section 3.2 succeeded;
- `unavailable`: with a reason that the menu can show.

Passkey, Email OTP and VoiceID unlock use it. Passkey login no longer runs a cold rejoin.
`Recovery` stays for wallet recovery (recovery codes, a Staged SigningWorker).

## 4. Options not chosen

- **A: the server keeps the sealed client share.** Rejected by the user (2026-11-10). It
  reverses Decision 2026-08-09.
- **Derivers keep their client package halves.** Each Deriver would store a long-lived half
  of the client share. Server-side compromise of A, B and the SigningWorker would then give
  the whole key without the user. Today that needs the seed.
- **Let Email OTP and VoiceID run the existing `Recovery`.** No protocol change, but every
  new site still moves the epoch, and every redelivery is a SigningWorker transition. Keep
  this as the fallback if Step 4 slips past 0.61.

## 5. Steps

Steps 1–3 fix every stale cache with no protocol change. Steps 4–6 fix the "no cache" case
and stop the epoch churn.

### Step 1. The capability carries the current SigningWorker verifying share

- Add `signingWorkerVerifyingShare` to `RouterAbEd25519YaoActiveCapabilityDescriptorV1`, from
  the SigningWorker's active receipt (`crates/router-ab-ed25519-yao/src/activation.rs:170`).
- Return it on the passkey unlock (`projectPasskeyCustody`), Email OTP unlock
  (`projectEmailOtpCustody`) and VoiceID verify (`prepareVoiceIdNearInstallation`).
- Parse it in `parsePasskeyWalletCustodyUnlockV1`, the Email OTP custody parser, and
  `VoiceIdHttpClient.verify`. These parsers check exact keys: the Wallet and the
  wallet-server ship together in 0.61. Say so in the release notes.

### Step 2. Re-bind in the client crate and wasm

- `rebind_wallet_custody_ed25519_material_v1` in
  `crates/router-ab-ed25519-yao-client/src/local_material.rs`: open the envelope, derive the
  cache key, import with the old binding, check the relation with the current verifying
  share, refuse `new_epoch <= old_epoch`, seal with the new binding.
- Export it through the Yao client wasm and `RouterAbEd25519YaoClientV1`
  (`packages/wallet/src/core/signingEngine/threshold/ed25519/yaoClient.ts`).
- Rust tests: forward only; relation mismatch; verifying-share mismatch; other registered
  key; the opened share equals the old share.

### Step 3. Use the resolver in all unlock paths

- Add the resolver beside `openCustodyCache.ts`. Delete `openOrRejoinWalletCustodyEd25519V1`
  (no callers).
- Passkey: replace the rejoin-on-stale branch of `096e03ddc` with the resolver.
- VoiceID: replace the stale-epoch error of `096e03ddc` in `prepareNearSession.ts`.
- Email OTP: add the epoch check to `loadEmailOtpWalletCustodyEd25519Material`; use the
  resolver.
- Keep `NEAR_CUSTODY_STALE_MESSAGE` only for `unavailable`, with the right sentence per
  case.
- Validation on staging: VoiceID unlock of `redwood-monolith-skk7jk` on
  `staging.wallet.seams.sh` re-binds epoch 1 to epoch 2 with no Router call.

### Step 4. `Redelivery` in the Yao protocol and Router

- `Ed25519YaoOperationV1::Redelivery` with its own tag in
  `crates/router-ab-ed25519-yao-protocol/src/lib.rs`, canonical encodings and transcript
  domain.
- Deriver roles: reuse the activation family; build only client packages for `Redelivery`.
- Router coordinator: admit with an Active SigningWorker at the named epoch; no SigningWorker
  receipt; epoch unchanged; its own `ExpensiveWorkKindV1` budget.
- Client: `prepare_client_redelivery_with_root_v1` and its completion, with
  `Preserve(registered public key)` and the relation check.
- Update the generator corpus and vectors, `pnpm -C crates/router-ab-cloudflare
  test:wasm-vectors`, and the formal-verification artifacts that pin the operation enum (see
  the Aeneas line pins).
- Update `docs/router-ab/ed25519-yao.md`: the operation list, Section "Fixed Circuit
  Families" and "Root and Key-Continuity Policy".

### Step 5. Gateway route and authorization

- A Gateway route for redelivery admission and execution, with a Wallet Session bearer, like
  the recovery routes (`ROUTER_AB_ED25519_YAO_RECOVERY_*_PATH_V1`).
- Admit any factor that opened the custody envelope in this session: passkey, Email OTP,
  VoiceID. Rate-limit per wallet.

### Step 6. Use redelivery for "no cache"

- The resolver calls redelivery when the cache is absent or the re-bind fails.
- Passkey login and account sync (`syncAccount.ts`) stop the cold rejoin. Delete
  `rejoinWalletCustodyNearEd25519KeySet` and `buildWalletSessionEd25519RecoveryAdmissionRequestV1`
  if nothing else uses them.
- Email OTP: "recover with a recovery code" is no longer the answer for a new site.

### Step 7. End-to-end tests

An intended-behaviour test with two browser contexts (two storage partitions) for one wallet:

1. Register and unlock with a passkey in context A.
2. Unlock in context B: a redelivery; the server epoch does not change.
3. Force a recovery in context B: the epoch moves.
4. Unlock with VoiceID and with Email OTP in context A: re-bind, then sign a NEAR
   transaction.

## 6. Security review items

- The re-bind adds no new secret and no new party. It must refuse any binding change other
  than the epoch and the verifying share, and it must check the relation before it seals.
- `Redelivery` gives the client the same share as the last recovery. Each Deriver sees its
  own half again, as in every recovery. Nothing new is stored.
- A caller with a Wallet Session but substituted client inputs learns the same output as a
  `Recovery` with substituted inputs today. The review must confirm that `Redelivery` does
  not widen this. Rate limits apply.
- Domain separation: `Redelivery` packages and receipts cannot pass as `Recovery`,
  `Registration` or `Export`.

## 7. Open questions

1. Name: `Redelivery` or `ClientRedelivery`.
2. Does VoiceID alone authorize a redelivery, or only with a recent passkey or Email OTP
   unlock? The share is only useful to a seed holder, but the Router cost is real.
3. Ship Steps 1–3 in 0.61 even if Steps 4–6 move to 0.62?

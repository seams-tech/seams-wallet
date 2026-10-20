# R155G — One APAC anchor, hidden exchanges and custody execution

Status: **in progress.** Phase 1 is done on staging and open for both production
lanes. **All code and staging work is complete (Phases 2–5).** The only open
checklist items are the two production moves and their deployment windows.
Date: October 11, 2026.

This plan owns the optimizations that [R155F](refactor-155F-registration-round-trips.md)
does not: the location of every APAC component, the exchanges that the SDK can
hide behind user interaction, the serial chain and the CPU time of the Yao
execution, and the sealing CPU of finalization. R155F keeps its phases and their
owners. Do not repeat its work here, and do not report its savings again.

## Objective and ownership

Registration followed by an independently verified NEP-413 signature must reach
the existing **3–4 second target**, with **1–2 seconds preferred**. Registration
alone stays the primary metric. The first signature is reported separately.
User interaction, test automation, funding and blockchain confirmation stay
outside the SDK metrics, and the inclusive timings are retained.

Decisions recorded on October 11:

- Every APAC component of every lane moves to Hong Kong: the Gateway, Console,
  the role Workers and all their databases.
- The SDK sends sign prepare while the confirmation dialog is open.
- The finalization CPU profile is acted on.

The browser-to-Gateway distance and the Yao protocol's own CPU are not
optimized here. The two sections after the starting point explain why.

## Measured starting point

The stage costs come from the nine wallets of the
[home-publication comparison](evidence/refactor-155f-home-publication-hosted.md),
measured from Tokyo against the Hong Kong Gateway with real preflights.

| Stage | Browser | Gateway | Largest part |
| --- | ---: | ---: | --- |
| Setup | 709 ms | 497 ms | Console registration-setup 249 ms, own preflight and round trip 212 ms |
| Respond | 335 ms | 167 ms | Console active-lineage 96 ms, round trip 129 ms |
| Yao execution | 1,688 ms | 1,603 ms | Router execute 1,586 ms |
| Finalization | 1,231 ms | 920 ms | Two serial Console exchanges 335 ms, 13 D1 calls, 265 ms CPU |
| Client work between requests | 237 ms | | |
| First signature, prepare and sign | 673 ms | 414 ms | Two round trips 244 ms |

Each Console call costs more at the Gateway than Console works on it. The
difference is the Tokyo to Hong Kong distance, the Worker hop and isolate starts.

| Console call | Gateway sees | Console works | Difference |
| --- | ---: | ---: | ---: |
| registration-setup | 249 ms | 148 ms | 101 ms |
| active-lineage | 96 ms | 42 ms | 54 ms |
| claim-passkey, beside publish-routes | 253 ms | 138 ms | 115 ms |
| complete | 145 ms | 55 ms | 90 ms |

The placement of every lane, read from the Cloudflare API on October 11:

| Lane | APAC Gateway | Console Worker | Console database | Deriver A | Deriver B | Signing Worker |
| --- | --- | --- | --- | --- | --- | --- |
| Staging | HKG, pinned | NRT, pinned | NRT, 10 MB | HKG database | HKG database | HKG database |
| Production testnet | SIN, pinned | not pinned | SIN, 1 MB | NRT, pinned | NRT, pinned | KIX, pinned to Osaka |
| Production mainnet | HKG, pinned | not pinned | SIN, 1 MB | HKG database | SIN database | SIN database |

An unpinned Worker runs where its caller runs. Mainnet's Console therefore runs
in Hong Kong against a database in Singapore, on 13 database calls per
registration. Mainnet's Deriver B and Signing Worker do the same. Production
testnet's Router runs in Singapore and calls Derivers pinned to Tokyo. Staging
matches neither lane, so staging numbers predict neither lane. The role databases
of all lanes are small: 0.1 to 3 MB, except staging's Signing Worker at 18 MB.

## Why the Yao protocol CPU is an estimate

The [serial chain record](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-155F-registration-round-trips.md#serial-chain-of-one-yao-execution--october-11)
gives about 680 ms of protocol work. That figure is an estimate, not a measured
protocol span. Three measured facts stand behind it:

- The `deriver_a.yao_protocol` span measures 398 ms (275–459) by the Worker
  clock. The earlier local record measured 336 ms for A and 211 ms for B. These
  spans are clock spans. A Worker clock advances only when an I/O event arrives,
  so a span excludes the CPU work after its last incoming message.
- Cloudflare reports the CPU time of each invocation. Deriver A's execution
  object used 272–413 ms per execution. Deriver B's duplex object used 248–452 ms.
  These are totals for the invocation: the circuit, oblivious transfer, HPKE
  sealing, serialization of about 2 MB of tables, framing and bookkeeping.
- The July benchmark measured the circuit alone at 209 ms on Node WASM: 134 ms
  of garbling and 80 ms of evaluation. A Worker core may be slower than that
  laptop, and the Worker numbers include everything around the circuit.

The two objects work partly in parallel. The difference between 209 ms and the
invocation totals is not placed. A CPU profile of each Deriver must place it
before any change is chosen. Phase 3 holds that profile. A change to the circuit
or to the AES construction is crypto work and is outside this plan.

## The browser-to-Gateway distance

Each browser exchange between Tokyo and the Hong Kong Gateway costs about 100 ms
for a request that does no work. Registration and its first signature make six
exchanges, about 0.6 s. Setup also pays its own preflight.

- **Fewer exchanges.** Execute and finalization cannot merge: finalization needs
  the activation reference and the custody commit, which the client builds from
  the Yao result. Setup and respond cannot merge: respond carries the WebAuthn
  credential created against setup's challenge. One-request signing is protocol
  work and stays outside this plan.
- **Hidden exchanges.** Phase 2 hides sign prepare behind the confirmation dialog
  and the setup preflight behind page load. The wallet objects already start
  during the WebAuthn prompt. After Phase 2, five exchanges remain visible.
- **A Japan home.** A Gateway and database in Tokyo would remove the distance for
  Tokyo users, but the role databases are one set per lane. A Tokyo Gateway would
  then pay the distance on every role database call instead. This needs role
  databases per home, and that is a larger design than this plan.
- **No pin.** An unpinned Gateway runs beside the user and pays the distance on
  each of its 14 database calls per finalization. That is why it is pinned.

The distance is the price of one APAC anchor. It disappears for Hong Kong users.

## Implementation inventory

| Area | Files |
| --- | --- |
| Lane placement | `deployment/console/targets.json`, `deployment/wallet-system/targets.json`, `scripts/deploy-backend.mjs` (`renderWorkerPlacement`, the `d1PrimaryColo` check), `scripts/tenant-cutover.mjs` |
| Database moves | `.artifacts/r155g-apac-anchor/` in `seams-monorepo`, after `.artifacts/r155d-role-db-move/` |
| Sign prepare | `packages/wallet/src/core/signingEngine/flows/signNear/signNep413.ts`, `signTransactions.ts`, `session/operationState/trace.ts`, the Signing Worker prepare path in `crates/router-ab-cloudflare` |
| Setup preflight | `packages/wallet/src/core/rpcClients/relayer/relayerHttp.ts`, `walletRegistration.ts`, `SeamsWeb/operations/registration/registration.ts` |
| Yao chain | `crates/router-ab-cloudflare/src/durable_object/deriver_a_pair.rs`, `strict_worker/mod.rs`, `tenant_root_role_d1/bound_share.rs`, `ed25519_yao_lifecycle/deriver_b_start.rs` |
| Sealing CPU | `packages/wallet-server/src/threshold/session/signingSessionSeal/crypto/shamir3PassWasm.ts`, `router/domains/walletRegistration/registrationSessionSeal.ts` |
| Measurement | `tests/e2e/hosted-product/near-signing-latency.test.ts`, the hosted drivers under `.artifacts/`, `.artifacts/r155f-yao-chain/` |

## Phase 1 — One Hong Kong anchor per lane

> **Superseded on October 12: the anchor is Singapore, not Hong Kong.** The
> user decided it after a measurement: one durable write holds an object's
> response for 34 ms in Hong Kong and 2–4 ms in Singapore
> ([record](evidence/refactor-155h-write-hold-by-colo.md)), and most APAC
> users are expected in Singapore and Malaysia. The rule of this phase stays:
> one place per lane for the Gateway, Console, the role Workers and all their
> databases. **Do not run the open production moves below toward Hong Kong.**
> [R155H Phase 6](refactor-155H.md) holds the current state of every lane and
> the moves that a Singapore anchor needs. The staging work recorded below was
> done and stays as history.

The method is the staging role-database move of October 10: create a database
with the `apac` hint until one lands in Hong Kong, copy under a write freeze,
compare the dumps, change the deployment target, deploy, verify, and keep the
old database until every stored version that binds it is renewed or retired.

- [x] Staging: a Console database with a Hong Kong primary, the copy, the
  compared dumps, `placementRegion: aws:ap-east-1` and the new database in
  `deployment/console/targets.json`. The deploy was local, not through
  `deploy-console-backend.yml`; the record gives the reason.
- [x] Staging: verify. The serving Console runs in `aws:ap-east-1` and its
  database primary is `HKG`. Tenant activation passes. The
  [prewarm comparison](evidence/refactor-155g-yao-prewarm-hosted.md) registered
  and signed 24 wallets through a Console on the Hong Kong database.
- [x] Staging: comparison Console versions. Closed without a rebind: Cloudflare's
  version read failed for TypeScript Workers, so `rebind_exact.py` could not copy
  `4feb30ae`. A comparison deploys its Console against the new database. Every
  hosted driver prepared before the move carries the old database id and must
  prepare again. Console versions `29d08e63`, `d9f32622` and `4feb30ae` bind the
  Tokyo database and must not serve again.
- [ ] Mainnet: Console database and pin, Deriver B database, Signing Worker
  database. Add `d1PrimaryColo: HKG` for the three roles and the Console lane.
- [ ] Production testnet: Gateway pin and database, Console pin and database,
  Deriver pins and databases, Signing Worker pin and database.
- [ ] Each production cutover runs in a window the user chooses. Registrations
  and signings fail during the copy. The old databases stay until the user
  deletes them. The versions that bind them join the hazard list.

Existing wallet objects never move. New objects land beside their Workers,
because the `apac` hint is regional and Cloudflare places a new object near its
first caller. The relocation flow for existing wallets is a separate decision.

Acceptance: every serving version of a lane binds databases whose primary is
`HKG`, the deploy-time colo check covers each of them, and one registration
proof passes per lane. Expected gain: about 0.2 s per registration on staging,
and more on mainnet, where the Console, Deriver B and Signing Worker databases
are all in another city.

### Phase 1 record

**Staging Console moved on October 11, 19:13 JST.** Console version `adf09fee`
runs in `aws:ap-east-1` against `seams-console-staging-hkg` (`73ae681c`), whose
primary is `HKG`. The code is the Oct 7 commit `cc3993c` of the private
repository, the commit era of the staging Gateway originals, so the Gateway and
Console contract did not change. The 14 secrets and 19 variables of the live
Worker were kept. Private commit `3cfc9a0` records the lane in
`deployment/console/targets.json` and `deployment/wallet-system/targets.json`.

The copy is a verified equivalent of `seams-console-staging-nrt` (`f77260ef`,
`NRT`): 99 tables, 13,287 rows, 123 indexes, 86 triggers and views. Every line
of the two dumps matches except the SQL comment lines inside trigger bodies,
which Cloudflare's import drops. The old database stays until the stored
versions that bind it are retired. The run directory
`.artifacts/r155g-apac-anchor/` in `seams-monorepo` holds the scripts, dumps,
digests and the cutover record.

Four facts for the next move:

- Cloudflare's file import failed on this 10 MB dump with `D1_RESET_DO` in
  every attempt. The query API imports it when the statements run as tables,
  then indexes, then rows ordered parents first, then triggers and views
  through the file import, which accepts small files.
- The GitHub deploy workflows build `origin/dev`, not the local `dev` that
  holds the day's commits. A workflow deploy of the Console therefore carried
  the old lane; the original was restored within minutes, and the move used a
  local deploy of the archived commit instead.
- A plain deploy of the rendered Console config drops a live variable that the
  renderer does not emit. `keep_vars` keeps it.
- The comparison Console versions stored before the move bind the old database.
  A comparison deploys its Console against the new database instead.

## Phase 2 — Hide exchanges behind the user

- [x] Send sign prepare when the confirmation dialog opens, bound to the
  displayed digest. Await it after the user confirms. Keep the warm-session path
  free of WebAuthn. A declined confirmation leaves an admitted prepare: it
  spends one quota use and expires with its 120 s lease; no release was added.
  The specification and the contract test changed in the same commit. Done for
  NEP-413 messages; the record below holds the design and the measurement.
- [x] Extend the early prepare to transactions. Implemented for a warm-session
  transaction of a funded account; the staging measurement is still open. The
  design below replaces an earlier note that said the nonce reservation follows
  the confirmation. That is true only for an unfunded implicit account.
  - The confirmation flow already reserves the NEAR context when the dialog
    opens (`fetchNearContext` in `handleTransactionSigningFlow`), keeps the
    leases in the confirm session, and releases them on a decline. A funded
    account therefore has its nonce and block hash while the dialog is open.
  - Add one observer to the transaction confirm request. The confirm flow
    calls it with the `context_ready` readiness as soon as the context is
    reserved. The request already carries a progress callback and a readiness
    promise, so this crosses no new boundary.
  - On that call, a warm-session flow with one transaction builds the unsigned
    transaction from the reserved context, builds the prepare request with the
    display digest it expects, and sends it. The signature uses the answer after
    the confirmation only when the display digest and the signing digest both
    match the confirmed values. Any difference sends a new prepare, as today.
  - No early prepare for a step-up signature or for an account that needs
    funding. The flow signs one transaction per confirmation.
  - A decline needs no new code: the confirm session releases the leases, and
    the prepare expires with its lease, as for messages.
  - The specification states the rule, and the local Yao contract asserts the
    order `prepare_sent`, `confirmation`, `prepare` for a warm-session
    transaction, with exactly one `prepare_sent`.
- [x] Extend the early prepare to delegate actions. Their signing digest and
  their display digest (`computeUiIntentDigestFromTxs` over the receiver and
  the ordered actions) both exist before the dialog, so the NEP-413 mechanism
  applies unchanged. The browser contract verifies two warm delegate signatures,
  then a third signature that needs step-up after quota exhaustion. Warm prepares
  precede confirmation. Step-up sends no early prepare. Node Ed25519 verification
  accepts the serialized delegates and rejects altered digests. The repeatable
  artifact is `delegate-early-prepare.json`.
- [x] Setup preflight at page load: withdrawn. The hosted auth menu already
  runs the whole setup request while the user is still in the menu:
  `prepareHostedPasskeyRegistration` calls `setupThreeRouteRegistration` once
  the registration input is valid, and the early preflights for the later
  routes leave with it. A user of the hosted menu therefore waits for respond,
  the Yao execution and finalization after the click, not for setup. Only a
  direct `registration.registerWallet` call has setup on its path, and that is
  the call the hosted latency test measures. The specification also excludes
  an idle prewarm lifecycle for the provider. Report the stages after setup
  beside the full registration metric from here on.
- [x] Measure both on staging against the frozen candidate. Six wallets after
  three discarded warm-ups produced twelve delegate and twelve funded-transaction
  signatures. All verified. Delegate signature execution after confirmation
  measured 541 ms median (384–835 ms), with 92 ms median remaining prepare
  wait. Transactions held review open until context-dependent preparation
  started. Their confirmation-to-signature median was 461 ms (334–590 ms),
  with zero remaining prepare wait. These are hosted costs, not measured
  before/after savings. See the
  [hosted evidence](evidence/refactor-155g-early-delegate-transaction-hosted.md).

Expected gain: about 0.33 s on the first signature, and 0.1 to 0.2 s on setup.
Known cost: a page that opens and closes the confirmation dialog repeatedly spends
quota without signing. The quota is per Wallet Session and server-authoritative,
so the damage stays inside that session.

### Phase 2 record

**Sign prepare during confirmation, NEP-413 on the warm-session path.** The SDK
resolves the capability, computes the digest the dialog will show with the
dialog's own function (`computeUiIntentDigestFromNep413`) and the signing
digest, builds the prepare request and sends it before the confirmation command
runs. The confirmation returns the dialog's digest; the signature uses the
started prepare only when that digest and the signing digest match, and
consumes its answer in the same `PreparePayload` step as before, so the signing
state machine keeps its order. A step-up plan sends no early prepare, because
its prepare needs the step-up proof from the confirmation. Transactions now start
prepare when their reserved context arrives. Delegate actions also start early,
using the same receiver/action digest as their confirmation dialog.

Facts that fix the design:

- The Gateway claims one quota use at prepare and records the operation with
  the request's expiry. The SDK sets that expiry 120 s ahead. A prepare that no
  signature consumes expires with it; nothing else dangles.
- A refusal of the early prepare is observed where the late prepare's refusal
  was observed, inside the signature step, so the step-up fallback is unchanged.
  The started promise carries a no-op rejection handler, so a dropped prepare
  reports nothing as unhandled.
- The trace gains the stage `prepare_sent`, emitted when the early request
  leaves. The `prepare` stage then measures the wait that remains after the
  confirmation. The contract in `passkey.ed25519-yao-local.contract.test.ts`
  asserts, for a warm-session message signature, the stage order `prepare_sent`,
  `confirmation`, `prepare`, and exactly one `prepare_sent`.
- The specification records the behavior beside the prepare and quota bullets.

Commit `3670b1cd`. All 133 contract cases pass with it: 131 on release builds
and the two debug-only cases on debug builds. The
[staging comparison](evidence/refactor-155g-early-sign-prepare-hosted.md), six
wallets per side on identical Worker versions, measured the time from the
confirmation to the signature at **358 ms against 694 ms**, and the first
signature excluding the confirmation at 396 ms against 720 ms. The automated
confirmation is shorter than one prepare exchange, so 42–90 ms of the prepare
still followed it. Registration plus the first signature measured 4,144 ms on
the early-prepare side, with the Hong Kong Console and the Deriver B load, and
without R155F's later Gateway changes.

## Phase 3 — Yao execution: the serial chain and the CPU

- [x] Land the Deriver B Worker load beside Deriver A's admission and at wallet
  start. Commit `fedad1f3`. The [second staging run](evidence/refactor-155g-yao-prewarm-hosted.md),
  six executions per side on the Hong Kong layout with a warm-up group before
  each measured group, measured the hold at 0 ms against 186 ms and the
  connection at 161 ms against 336 ms. The admission no longer slows down,
  because the wallet-start request loads the Worker a second earlier. The
  Router's execute request measured 1,543 ms against 1,704 ms and registration
  3,599 ms against 3,873 ms at the median, inside overlapping ranges.
- [x] Profile each Deriver's CPU for one execution through the local stack's
  inspector ports. The [local profile](evidence/refactor-155g-deriver-cpu-local.md)
  measures 95 ms in Deriver A and 103 ms in Deriver B for a warm execution on a
  laptop. Curve arithmetic is 35% of that, the AES gate hash 27%, SHA-256 10%,
  the circuit engine 9% and wire-label zeroize 7%. Sealing, framing and
  serialization are 4% together.
- [x] Compute the joined root commitment with two point additions. More than
  half of the curve arithmetic built and parsed the tenant-root commitments,
  and `TwoPartyRootShareCommitments::new` used a scalar multiplication for
  `2A − B`. The warm CPU fell to 86.5 ms and 83.6 ms, 14% less for the two
  Derivers, and the local execute POST from about 229 ms to about 199 ms.
- [x] Try the 64-bit curve backend: rejected. On `wasm32` it calls a software
  128-bit multiplication and raises the warm CPU to 139 ms and 176 ms.
- [x] Review moving the base oblivious transfers ahead of execute: possible in
  the cryptography, not taken. After the commitment change they are the largest
  curve cost, 9 ms and 17 ms. Their session is a hash of the ceremony session,
  the circuit digest and the schedule digest (`ot_session` in
  `crates/ed25519-yao/src/passive/phase4.rs`), and the base choices are random.
  The base transfers therefore need neither the client's input nor the root
  share. Three facts speak against the move. Deriver B's wallet object accepts
  Deriver A's connection only after its own admitted preparation, and that
  preparation needs the client's input. The base seeds are secrets that would
  have to live from respond to execute and serve exactly one extension: a second
  extension on the same seeds shows the peer the difference of two choice
  vectors. The transfer module states that it has no reusable base state. The
  bound of the gain is the base-transfer CPU, 26 ms on a laptop for both roles.
  [R155H](refactor-155H.md) Phase 1 holds the precomputation as an optional
  last step under the same one-use rule.
- [x] Review an early Deriver admission, after respond and before execute: not
  possible as first described. The admission stores the digest of the custody
  binding, and the binding's outer transcript digest is the pair digest
  (`authenticate_for_ed25519_yao_v1`). The pair digest covers the digests of the
  client's two encrypted inputs. The client builds those inputs from the
  admission receipt in the respond reply and sends them with execute. The
  binding therefore does not exist before execute. An admission bound to the
  session and the epoch alone could run early, but the execution would still
  record or verify its binding, and the attempt-conflict rule would need a new
  home. That changes the admission identity for one D1 write per Deriver, about
  50 ms on staging. Not taken. [R155H](refactor-155H.md) Phase 1 takes the
  admission identity change, because the pair preparation and the garbling
  ride on it.
- [x] Remove debug metadata from release Worker modules. Commit `3f3800a4`
  strips only custom `name` and `.debug_*` sections after worker-build. The
  exact staging modules lost 1,300,897 bytes for A and 1,346,077 bytes for B.
  Cloudflare reported startup at 7 → 8 ms for A and 6 → 6 ms for B. This
  establishes smaller modules, with no demonstrated startup latency gain.
  Runtime data stays intact. Nine candidate registrations and signatures passed.
- [x] Keep the two deliberate checks: the second D1 round trip of each admission,
  and Deriver B's read of the admitted session before use. Both are kept.

Expected gain: 0.1 to 0.3 s was the estimate before the two reviews. The prewarm
and the commitment change are the realized part. The open item changes new
isolates only. The protocol CPU itself stays as it is.

## Phase 4 — Finalization sealing CPU

R155F's local profile places 78–80% of finalization's sampled CPU in
`addSigningSessionSealLock`, modular arithmetic in the Shamir WASM module. The
seal is already computed beside home publication. The CPU itself remains.

- [x] Measure the seal's CPU in isolation on a Worker, not a laptop. A bound
  exists from the staging records of the hosted run of October 11
  (`.artifacts/r155g-combined-hosted` in `seams-monorepo`): the Gateway used
  202 ms of CPU at the median for finalization (132–386 ms, 25 invocations),
  against 10–32 ms for each other registration and signing route. The browser
  measured 909 ms for the request, and the Gateway's last traced call ended at
  591 ms. By the local share of 78–80%, the seal is about 160 ms on a Worker.
  That share is not measured on a Worker. **These numbers come from a
  development build of the Shamir module.** The Gateway bundles and the SDK
  sites of the hosted comparisons were built from a local tree, whose
  `shamir3pass_runtime_bg.wasm` is 654,272 bytes. The published 0.9.0 packages
  hold the release build, 92,823 bytes. The
  [server-seal investigation](server-seal-release-profile.md) measured the
  server lock at 38.4 ms in the development build and 2.1 ms in the release
  build on a laptop. The local profile behind this phase used the development
  build as well. Measure finalization again after a deployment from published
  packages, before any decision here. A hosted comparison must build its
  candidates with `WASM_SDK_BUILD_MODE=prod`.
- [x] Choose release compilation for speed. Keep the seal in the response path.
  The session stays bound to its wallet, session and
  expiry, and the client must still receive the seal with the finalization reply.
- [x] Implement `opt-level = 3` and `wasm-opt -O3` in `a4bba328`. The
  [local release comparison](evidence/refactor-155g-seal-release-local.md)
  measured 2.062 → 1.728 ms. The isolated Cloudflare probe measured about
  5.44 ms for published 0.9.0 and 5.86 ms for the candidate, with overlapping
  batch ranges. No hosted speed gain is established. The earlier 160 ms
  estimate does not apply to release sealing. Keep the synchronous seal:
  moving it would change the response contract for a roughly 6 ms cost.
  The compiler change keeps the same arithmetic and exact output, with a
  local speed gain and a 26 KB size increase.

## Phase 5 — Measure and record

- [x] Run a discarded warm-up group of three wallets before each measured group.
  A version that was just deployed or switched in starts its Workers in new
  isolates, and the first group after a change is the slowest.
- [x] Use at least six wallets per measured group. Three cannot resolve less than
  about 0.5 s: two groups on identical versions differed by 1 s on October 11.
- [x] Measure the accumulated changes of R155F and this plan in one comparison
  on the Hong Kong layout. Record registration, first signature and the combined
  flow with medians, ranges and maxima, and the stage costs.
- [x] Commit accepted changes on `dev`. Link sanitized evidence from this plan.

### Phase 5 record

The [combined comparison](evidence/refactor-155g-combined-hosted.md) of
October 11 serves the complete R155F hosts in every group. With the Deriver B
load and the early sign prepare, registration plus the first signature measures
**4,368 ms** at the median over twelve wallets, against 4,675 ms over six
control wallets. Two of twelve wallets finished under 4.0 s. The target is not
met. The Yao execution is 1,770 ms, 47% of a registration; finalization is
912 ms, setup 698 ms and respond 257 ms. After setup, which the hosted auth
menu runs before the click, registration measures 3,138 ms.

The planned control repeat did not run: Deriver B's wallet object stalled for
14.6 s on one preparation after a version switch, and the driver restored
staging. The warm-up groups and at least six wallets per side are in place.

## Scope limits and completion

This plan creates replacement databases, which R155F excluded. It adds no
Worker, secret, environment-variable family, cache layer, queue or configuration
framework. One-request signing, a Japan home with its own role databases, a
cheaper Yao circuit and the relocation of existing wallets stay outside it.
Production rollout and publishing 0.9.0 remain separate release work.

Complete the plan when each item has implementation and evidence, or a recorded
reason. A completed checklist does not establish that the latency target was met.


### October 12 final registration comparison

The [final staging evidence](evidence/refactor-155g-final-staging.md) includes
three discarded warm-ups and six measured wallets for each of control, candidate
and repeat control. All 27 NEP-413 signatures passed independent verification.
The candidate contains the accumulated implementation. The control already
contains R155F and earlier R155G work; this last comparison isolates the
remaining module-size and seal-build changes.

Candidate registration measured **3.556 s excluding authentication**, and the
first signature measured **0.429 s excluding confirmation**. The combined flow
measured **3.978 s**, with a **3.755–5.018 s** range. Including authentication,
SDK registration measured **4.111 s**. The control combined median was 4.070 s
and its repeat was 3.967 s. These overlapping results establish no end-to-end
gain for the last batch. The four-second maximum remains unmet.

Staging returned to the verified October 12 deployment. Reactivation passed
after two US registration records expired naturally. No wallet records were
deleted. The temporary CPU probe is no longer serving. Production database
moves still require the user's deployment windows.

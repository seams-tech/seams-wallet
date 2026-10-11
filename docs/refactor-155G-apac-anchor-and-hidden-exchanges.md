# R155G — One APAC anchor, hidden exchanges and custody execution

Status: **in progress.** Phase 1 started on staging. Phases 2 to 4 are planned.
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

The [serial chain record](refactor-155F-registration-round-trips.md#serial-chain-of-one-yao-execution--october-11)
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

The method is the staging role-database move of October 10: create a database
with the `apac` hint until one lands in Hong Kong, copy under a write freeze,
compare the dumps, change the deployment target, deploy, verify, and keep the
old database until every stored version that binds it is renewed or retired.

- [ ] Staging: a Console database with a Hong Kong primary, the copy, the
  compared dumps, `placementRegion: aws:ap-east-1` and the new database in
  `deployment/console/targets.json`, and a deploy through `deploy-console-backend.yml`.
- [ ] Staging: verify. Console invocations report `HKG`, its database query
  reports `served_by_colo: HKG`, tenant activation passes, one registration and
  one signature pass through the new layout.
- [ ] Staging: rebind the comparison Console version `4feb30ae` to the new
  database with `rebind_exact.py`. Every hosted driver prepared before the move
  carries the old database id in its `candidate-console.json` and must prepare
  again. Record the old Console versions beside the earlier hazard list.
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
- [ ] Extend the early prepare to transactions and delegate actions. Their
  dialog fetches the nonce and block hash while it is open, so the signing
  digest exists only after that fetch; the prepare can leave when it returns.
- [ ] Send the setup preflight when the page loads, in `prewarmRelayerPreflights`,
  so setup joins the routes that need no preflight. Record the cost: one more
  request per page load, and a 600 s cache lifetime.
- [ ] Measure both on staging against the frozen candidate.

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
its prepare needs the step-up proof from the confirmation. Transactions and
delegate actions keep the late prepare: their dialog computes the display
digest from the transaction summary, and that merge is a separate step.

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
- [ ] Profile each Deriver's CPU for one execution through the local stack's
  inspector ports. Place the invocation CPU between the circuit, oblivious
  transfer, sealing, serialization and framing. Record the split.
- [ ] Review an early Deriver admission, after respond and before execute. The
  admission needs the custody binding and the attempt, which exist after respond.
  Deriver B's preparation also needs the client's input, so only the admission
  can move. Establish that an early admission cannot be claimed by another
  execution before implementing it.
- [ ] Measure the isolate cost of module size. Each Deriver module is 15.6 MB
  with a 1.3 MB name section and 6.2 MB of data. Remove what is not needed at
  run time, then measure a new isolate's start.
- [ ] Keep the two deliberate checks: the second D1 round trip of each admission,
  and Deriver B's read of the admitted session before use. Record them as kept.

Expected gain: 0.1 to 0.3 s. The protocol CPU itself stays as it is.

## Phase 4 — Finalization sealing CPU

R155F's local profile places 78–80% of finalization's sampled CPU in
`addSigningSessionSealLock`, modular arithmetic in the Shamir WASM module. The
seal is already computed beside home publication. The CPU itself remains.

- [ ] Measure the seal's CPU in isolation on a Worker, not a laptop.
- [ ] Decide between a cheaper computation and a seal off the response path.
  Both touch custody. The session must stay bound to its wallet, session and
  expiry, and the client must still receive the seal with the finalization reply.
- [ ] Implement the chosen option, or record the concrete reason to keep the cost.

## Phase 5 — Measure and record

- [ ] Run a discarded warm-up group of three wallets before each measured group.
  A version that was just deployed or switched in starts its Workers in new
  isolates, and the first group after a change is the slowest.
- [ ] Use at least six wallets per measured group. Three cannot resolve less than
  about 0.5 s: two groups on identical versions differed by 1 s on October 11.
- [ ] Measure the accumulated changes of R155F and this plan in one comparison
  on the Hong Kong layout. Record registration, first signature and the combined
  flow with medians, ranges and maxima, and the stage costs.
- [ ] Commit accepted changes on `dev`. Link sanitized evidence from this plan.

## Scope limits and completion

This plan creates replacement databases, which R155F excluded. It adds no
Worker, secret, environment-variable family, cache layer, queue or configuration
framework. One-request signing, a Japan home with its own role databases, a
cheaper Yao circuit and the relocation of existing wallets stay outside it.
Production rollout and publishing 0.9.0 remain separate release work.

Complete the plan when each item has implementation and evidence, or a recorded
reason. A completed checklist does not establish that the latency target was met.

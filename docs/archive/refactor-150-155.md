# Refactors 150–155: regional wallet homes, custody objects and registration latency

Status: closed. The work ran from September 24 to October 24, 2026, across
Wallet releases 0.7.3 to 0.13.0. This record keeps the architecture that landed,
the tests that were run and their results, and the items that stay open.
[R154](../refactor-154-region-change-notifications.md) is not part of this
record: it is an unimplemented draft and stays a live plan.

| Refactor     | Subject                                                                                                         | Result                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| R150         | Wallet ownership and custody: who owns which state, role-separated Durable Objects (DOs), tenant-root lifecycle | Landed; VM host removed later (October 13)       |
| R151         | Gateway D1 calls on the ECDSA signing path                                                                      | 18 → 5 D1 calls; released in 0.7.3               |
| R152         | Per-wallet regional homes and routing                                                                           | Released in 0.8.0 (October 4)                    |
| R153, R153B  | Owner-selected wallet relocation                                                                                | Closed October 7                                 |
| R155         | Reusable presign DO host                                                                                        | Landed October 6                                 |
| R155B        | Zero Console calls for established-session signing; regional OTP counters; NEAR latency phases 6A–6AS           | Landed October 9                                 |
| R155C        | Concurrent Deriver A/B dispatch, no peer attestation                                                            | Landed October 9                                 |
| R155D, R155F | Registration critical path and round trips                                                                      | Closed October 11                                |
| R155G        | Singapore anchor; early sign prepare                                                                            | Closed October 12–13                             |
| R155H        | Preparation at setup; one-request respond                                                                       | Closed October 14 (0.10.2)                       |
| R155J        | Registration tail latency (p99)                                                                                 | Fixes landed; target not met                     |
| R155L        | NEAR waits                                                                                                      | Selected changes landed October 21; not released |

Many evidence directories (`.artifacts/r15x/…`) are local and ignored by Git.
The tracked records are in [`docs/evidence/`](../evidence/) (`r152-*`, `r155-*`,
`r155b-*`, `near-*-202610*`, `refactor-155*`, `release-01*0-staging-*`).
Private names belong to `seams-monorepo`.

## Architecture landed

### Topology

- **Console (shared, private).** It owns the wallet home directory, registration
  reservations, uniqueness claims, digest-only routing locators, deployment
  activation and relocation coordination. It has no part in ordinary signing.
- **Regional homes.** Each home is a region: `US`, `WEUR`, `APAC` or `OC`
  (`WalletRegion` in `packages/wallet/src/SeamsWeb/publicApi/placement.ts`).
  Each home has one Gateway and one Wallet Runtime writer, which bind the home
  signer D1 as `SIGNER_DB`. Fixed service bindings are
  `WALLET_GATEWAY_US|WEUR|APAC|OC`.
- **Custody roles (shared).** Router, Deriver A, Deriver B, SigningWorker and the
  tenant-root control plane. Each role keeps its private state in role D1 and in
  SQLite-backed wallet DOs. The control plane is stateless and is the only
  holder of the issuer signing key; the Router may not hold it
  (`ROUTER_FORBIDDEN_ENV_KEYS`).
- **Placement.** One lane keeps its Gateway, Console, role Workers and
  databases in one place. The APAC anchor is **Singapore**. Hong Kong was the
  first choice but a durable write holds a response 34 ms in HKG and 2–4 ms in
  SIN. A DO write is confirmed by the third-nearest of five followers. Measured
  holds: HKG 34, Seoul 32, San Jose 29, Ashburn 14, Sydney 13, Tokyo 9,
  London 9, SIN 2 ms. DO location hints: US→`enam`, WEUR→`weur`, APAC→`apac`,
  OC→`oc`.

### Home assignment

- Each wallet gets one immutable home when registration starts. The server
  selects it from the trusted ingress location (`request.cf`) and ignores client
  hints. Travel, unlock, recovery, export, linking and retries keep that home.
  Only an owner-approved relocation (R153) changes it.
- Console `wallet_homes` holds the home: state `reserved` → `established` or
  `cancelled`, the request digest, the allocation mode and five setup IDs.
- The namespace-wide home of the first R152 experiment was replaced. Console
  migration `0052_drop_namespace_placement.sql` removed it. Existing test wallets
  were reset, with no migration or fallback.

### State ownership

| Owner                                                                 | State                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home signer D1, by exact `wallet_id`                                  | `wallets`, `wallet_signers`, `wallet_auth_methods`, `wallet_authorities`, sessions and quotas, `authorized_operations` and audit, proof consumptions, evidence sets, linked-device tables, `registration_ceremony_records`, `yao_lifecycle_decisions`, Email OTP enrollments and states, `wallet_email_otp_rate_limits`, `wallet_object_addresses` (migration 0077) |
| Home signer D1, mixed by key prefix                                   | `router_ab_yao_versioned_json_records` (lifecycle-keyed Yao ceremony records stay here: this is the final boundary), `router_ab_normal_signing_admission_records`                                                                                                                                                                                                   |
| Home signer D1, regional and not moved                                | `email_otp_rate_limits` (IP, org, recipient, provider)                                                                                                                                                                                                                                                                                                              |
| Home signer D1, tenant-wide                                           | `router-ab-ed25519-yao:shared` record (capability and identity indexes, recovery sessions, export nonces)                                                                                                                                                                                                                                                           |
| Shared Console D1                                                     | `wallet_homes`, `wallet_routes`, `wallet_session_locators`, `wallet_passkey_claims`, `identity_links`, `wallet_sync_challenges`, `linked_device_bootstrap`, `linked_device_request_proof_nonces`, registration offers, billing                                                                                                                                      |
| Router wallet DO (`ROUTER_WALLET_DO`)                                 | Registration execution record: claim, lease, generation, pinned request, terminal outcome                                                                                                                                                                                                                                                                           |
| Deriver A/B wallet DOs (`DERIVER_A_WALLET_DO`, `DERIVER_B_WALLET_DO`) | Yao pair records (`Prepare → Claim → Complete`, or `Expire`, or `Burn`), admission fences                                                                                                                                                                                                                                                                           |
| Deriver role D1 (each role separately)                                | Tenant-root shares, CAS guard, recovery, restore and retirement tables, `tenant_root_root_use_admissions`, `tenant_root_refresh_supersessions`                                                                                                                                                                                                                      |
| SigningWorker wallet DO (`SIGNING_WORKER_WALLET_DO`)                  | Activations, retirement fences, ECDSA pool, effect claims, terminal responses                                                                                                                                                                                                                                                                                       |
| SigningWorker presign DO (`SIGNING_WORKER_PRESIGN_SESSION_DO_*`)      | One host per wallet and material scope; per-session claims                                                                                                                                                                                                                                                                                                          |
| Router tenant-root-creation DO                                        | Creation journal, checkpoints, refresh fence                                                                                                                                                                                                                                                                                                                        |

The revision-14 ownership freeze counted 56 signer tables and 84 Console
tables. DO addresses are stored per ownership generation; there is no fallback
to name-derived IDs.

### Routing and fail-closed rules

- The ingress Gateway resolves the home through Console and forwards one hop.
  The receiver resolves again and never forwards a second time. A forwarding
  marker or a region hint grants no authority.
- Header `X-Seams-Wallet-Region` accepts only the four regions and must match the
  admitted catalog. On `wallet_home_discovery_required` the SDK retries once
  without the hint.
- Credentials carry a required `home`. A Gateway reads regional session tables
  before discovery, so a known credential makes no Console call.
- Deployment binding and session home come from one Console request: Console
  calls 2 → 1, Console D1 round trips 3 → 2.
- Errors: 400 `invalid_wallet_region`; 401 unknown credential; 403
  `wallet_session_scope_mismatch`; 404 unknown wallet or ceremony; 409 wrong home
  or `wallet_home_conflict`; 503 directory outage (`wallet_home_unavailable`).
- There is no cross-D1 transaction. Console publication comes before the local
  commit, so a failed commit can leave an inert locator. A locator never grants
  authority.

### Deployment admission and fences

- A binding carries a `resources` set. Activation needs a fresh proof through
  every writer: a one-use challenge in `deployment_resource_challenges`
  (five-minute expiry), the writer's serving version at 100%, and the expected
  `SIGNER_DB` UUID.
- `D1RegionalDeploymentAdmission` (private) installs the admitted writer in
  regional D1 (migration 0066). `DeploymentFencedDatabase` (private) adds a
  writer guard to every D1 batch in the same transaction, so a retired writer
  cannot write. The guard adds no round trip.
- Readiness checks all regional Runtimes with a 15 s timeout. Deploy order:
  migrations → deploy → fresh verification → activate → canary → smoke. It fails
  closed between deploy and activation, so it is not zero-downtime.

### Signing path

**ECDSA (R151, R152, R155).** A ready-material signature makes 5 Gateway D1
calls (6 statements, 2 write-bearing calls). It started at 18 (owner), 20 and 24
(linked).

| Call                                                 | Enforces                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| Prepare: credential + material + policy snapshot     | Live session, authority, auth method, quota, verified material, policy |
| Prepare: guarded claim INSERT + readback (one batch) | One quota use, one operation claim, no changed material                |
| Finalize: same snapshot                              | Fresh authorization and policy                                         |
| Finalize: existing operation + source (read-only)    | Prepare exists; material matches                                       |
| Finalize: completion `UPDATE … RETURNING`            | Replayable response and audit                                          |

- Finalize never inserts. A finalize with no prepare returns
  `authorized_operation_missing` and changes nothing. Changed material returns
  `material_mismatch`.
- Policy precedence: project, then abuse, then rate limit. A missing policy
  allows; a malformed policy fails closed.
- The custody side reads material and finalize state in one snapshot each
  (custody D1 round trips 20 → 8 → 6).
- ECDSA prepare returns the session projection, so a ready signature needs 2
  browser requests.
- One presign DO host serves each wallet and material scope. The rule is: reuse
  the DO, never the presignature. Pool target and capacity 5, refill trigger 4,
  one background refill at a time. Refill starts after the first durable ECDSA
  publication (registration) or after material bootstrap (unlock).
- The module-global refill gate (`backgroundInFlight`) was deleted: a cancelled
  request held it and stalled later refills for 5 s.

**NEAR (R155B, R155G).** Repeated signing sends only prepare and finalize
(down from 6 POSTs). The SDK sends prepare while the confirmation dialog is
open, bound to the displayed digest (NEP-413, warm transactions, delegates).
Step-up and accounts that need funding send no early prepare. A declined dialog
spends one quota use. The NEP-413 field order is `message, nonce, recipient,
callbackUrl` (fixed in `127dd7ec`).

**Zero Console calls (R155B).** Established-session signing, refill, step-up
and revocation make no Console call. They still pass with Console down.
Fresh passkey unlock, tenant-root context at registration and an unhinted
non-local session still use Console.

### Registration path

- Sequence: setup → respond (verifies the passkey proof and runs Yao in one
  request) → finalize. Setup mints a bounded session, admits the pair and opens
  the peer connection during the passkey prompt. Setup is limited to 30 per
  minute per publishable key and source IP, before custody work.
- The Yao execution always runs after the verified passkey proof. Running it
  earlier would defeat the proof (owner decision, October 16).
- Finalization commits the wallet, signer, custody and session in one step.
  Session issuance is one D1 transaction (`d1RegistrationSessionTransaction.ts`).
- Since 0.13.0 (`b42b35be`) the completion record activates the home and records
  a pending publication (`wallet_registration_directory_publications`, signer
  migration 0081). Console completion is sent after the response; a cron
  resends a failed one.
- The stateless Router Worker dispatches to the Derivers and the SigningWorker
  (`d8824ade`, 0.12.0). Dispatch from the fresh per-wallet Router object (0.11.0)
  started cold callee isolates on 89–97% of calls.

### Yao A/B protocol (R155C, R155H)

- One organisation runs both Derivers. Separate Workers keep plaintext inputs,
  keys and root shares apart. Authenticated service calls replace peer
  signatures. Readiness receipts and peer signing keys were deleted.
- The Router claims the registration, then runs B preparation and A execution
  together. A opens a WebSocket to B's exact wallet object; B's 101 response is
  B's durable claim. If B has no matching `Prepared` record, it polls every 5 ms
  until the run deadline, then refuses with `not_prepared`.
- A refusal before B claims is recoverable. A failure after B claims burns the
  pair. Each Router run stamps a new window, so a later run never claims an
  earlier preparation.
- Request type: `CloudflareEd25519YaoPairExecuteRequestV1`.

### Tenant-root lifecycle (R150)

- **Commit-first refresh.** The Router's persisted refresh-swap receipt is the
  commit point. A Deriver activates only on that exact receipt
  (`require_router_committed_activation_v1`). Retries roll forward. The old
  order (swap, persist, erase) left epochs split after a lost reply.
- **Delivery gate.** A pending receipt is delivered before new root work is
  admitted. Otherwise the answer is 503 `LifecycleTransitionInProgress`.
- **Abandonment.** A prepared refresh past 5 minutes is abandoned (409
  `tenant_root_refresh_abandoned`); the next attempt supersedes it. R2 writes
  replace an object only on `etagMatches`.
- **Scheduled refresh.** `TENANT_ROOT_SCHEDULED_REFRESH_INTERVAL_MS`, 30 days by
  default, with up to 1 day of jitter.
- **Work keeps its epoch.** `load_bound` loads the exact epoch that the custody
  binding names, including a retired one.
- **Admission identity.** The key is the Yao pair session, or the ECDSA
  operation ID plus epoch. Other fields are compared through
  `TenantRootCustodyBindingV1::attempt_digest`. Status `admitted` → `settled` or
  `cancelled`. A conflict returns `ConflictingPair`.
- **Erasure.** The `DELETE` itself checks that no admission is unsettled. Time
  never permits erasure, because Workers clocks pause during compute. The next
  refresh waits with 409 `tenant_root_retirement_pending`.

### Cross-owner finalization (R150)

- A registration decision row (`yao_lifecycle_decisions`) is written in the same
  batch as the signer row, which makes the wallet visible. The Router keeps no
  copy.
- Recovery commits replacement rows, the shared record and the `promoted` state
  in one batch. The Gateway numbers attempts. The SigningWorker keeps only the
  highest attempt; a lower one gets `SupersededAttempt` (HTTP 410). Promotion
  retires the old activation in the same write.
- Export commits the authorized state, the nonce claim and the operation in one
  D1 batch.

### Relocation (R153, R153B)

- The owner approves a region setting, which creates one persisted move
  (`WalletMoveId`, `wmove_…`). Steps: prepare the destination, block source
  writes, transfer immutable state, fence the source, activate the destination,
  clean up the source.
- Each D1 snapshot moves with one export and one import. One active driver moves
  the move forward with exact retries. A move retires sessions and usable
  presignatures, and every device must authenticate again.
- Wallet-owned OTP counters move with the wallet. Regional counters stay, so a
  sender that uses several regions gets several allowances (accepted).
- Retirement waits for settlement (guard `wallet_operations_unsettled`).

### Rejected designs

| Design                                                                                   | Reason                                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| One home per namespace                                                                   | Users in one tenant need different homes; replaced by per-wallet homes      |
| Gateway near D1 without moving D1 (Tokyo)                                                | Custody-proxy time rose; signing 43% slower                                 |
| D1 read replicas for admission                                                           | Writes still go to the primary; bookmarks miss another session's revocation |
| Three-round-trip ECDSA admission; policy after claim                                     | Rejected requests would consume quota; precedence would change              |
| Shared OTP D1 and Console rate-limit RPC                                                 | No global exact limit is needed                                             |
| DO proxy in front of D1; DO/D1 dual writes                                               | More cost; latency stays                                                    |
| Ceremony records in a wallet DO; DO copy of the decision                                 | Splits atomic units; a second authority                                     |
| B preparation on the A→B connection                                                      | Queued B behind A                                                           |
| Random DO IDs; `apac` and `apac-ne` hints                                                | Need a persisted locator; no repeatable gain                                |
| Console next to the Gateway                                                              | Console D1 read 14.5 → 67 ms                                                |
| SigningWorker placed in HKG                                                              | Consecutive signing 2.390 → 3.035 s                                         |
| Continuous A ceremony, early A→B connection, coordinator in the Router DO, native DO RPC | No repeatable gain; some slower                                             |
| 64-bit curve backend on wasm32                                                           | Slower (A 139 ms, B 176 ms vs 86/84 ms)                                     |
| Base OT before execute                                                                   | The seeds are one-use secrets                                               |
| Time-based retirement deadline                                                           | Workers clocks do not advance during compute                                |

## Tests and results

All hosted runs are small staging or bench cohorts unless a row says otherwise.
Medians unless stated.

### R150: DO custody against D1 custody

| Test                                                                                                                               | Date                 | Result                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Local matched diagnostic, 3 runs per profile                                                                                       | 09-25                | DO 3,641/1,494/1,489 ms vs D1 3,623/1,478/1,486 ms (registration/first/next). No local benefit                                               |
| Refresh lost delivery                                                                                                              | 09-26                | Before commit-first: retry failed, epochs split. After: retry 200 with the same receipt                                                      |
| VM rendezvous starvation                                                                                                           | 09-26                | 2 of 5 failed (A polled 32 times while B wrote for 1.5 s). After an in-process lock: 8 of 8                                                  |
| Refresh delivery after expiry; abandonment; admission races; claimed recovery; replay after erasure; refresh after managed restore | 09-26/27             | All passed on Workers and VM. Six stale-build runs were found and rerun                                                                      |
| Cross-owner slices 1–10 (real Gateway contracts)                                                                                   | 09-27/28             | Each passed on VM, wallet-object build and Workers D1                                                                                        |
| Step-up status race                                                                                                                | 09-29, fix `e5f9179` | Reproduced 1 in 61. With the fix, 20 randomized overlap runs passed                                                                          |
| Consolidated run, 14 contract files per host                                                                                       | 09-29, `da68f11`     | `router-ab-dev` 125 passed; `router-ab-cloudflare` 486 passed; contracts VM 83/0/1, wallet-object 83/0/1, Workers D1 84/0/0                  |
| Activation response-loss resume                                                                                                    | 09-29                | Passed; 4 production defects found and fixed                                                                                                 |
| Hosted pilot, Cloudflare Containers APAC `nrt13`, WEUR `lhr15`, ENAM `ord12`                                                       | 09-29                | 230/230 signatures verified. DO first-sign p95 lower by 23% (APAC), 32% (WEUR), 35% (ENAM). Registration −2% to +6%. Cost $0.64 of a $25 cap |

Hosted pilot, browser p50/p95 in seconds:

| Arm          | Registration          | First sign            | Next sign             |
| ------------ | --------------------- | --------------------- | --------------------- |
| APAC D1 / DO | 14.0/16.0 / 15.2/16.5 | 11.3/12.8 / 8.8/9.9   | 11.3/12.7 / 8.7/9.7   |
| WEUR D1 / DO | 22.9/24.1 / 23.9/25.5 | 18.8/20.3 / 12.5/13.9 | 18.8/19.6 / 13.2/14.2 |
| ENAM D1 / DO | 21.7/23.8 / 22.2/23.3 | 21.0/21.7 / 13.3/14.0 | 20.9/21.1 / 13.8/13.9 |

The cost model projected $0.00078 per active wallet per month (expected case)
and about $779 per month at 1 million wallets.

### R151: Gateway D1 calls (owner, ECDSA)

| Step                        | D1 calls | D1 wall (first/next) | Server prepare+finalize |
| --------------------------- | -------: | -------------------- | ----------------------- |
| Baseline `8ab7912d`         |       18 | 1,770 / 1,468 ms     | 1,964 / 1,853 ms        |
| Combined policy             |       16 | 1,231 / 1,175        | 1,496 / 1,335           |
| Batched claim/readback      |       15 | 1,077 / 1,091        | 1,330 / 1,289           |
| Operation/source join       |       14 | 1,025 / 1,002        | 1,300 / 1,178           |
| Persisted owner scope       |       12 | 865 / 901            | 1,111 / 1,142           |
| Fresh build r4 (whole path) |        7 | 559 / 533            | 755 / 690               |

SQL time stayed about 11 ms; the rest of the D1 wall time is not attributed.

London cohorts (27 verified signatures each, D1 primary in APAC):

| Cohort                      |  Owner SDK | Linked SDK |
| --------------------------- | ---------: | ---------: |
| r13 prefill                 | 4,318.8 ms | 3,517.5 ms |
| r14 joined linked read      |    4,243.8 |    3,061.5 |
| r15 policy snapshot         |    3,654.6 |    2,511.8 |
| r16 SDK authorization reuse |    3,123.6 |    2,494.2 |
| r17 status/material join    |    2,680.5 |    2,487.0 |

- Refill cancellation fix (20 hosted signatures per cohort): failed refills
  6 → 0, SDK median 2,746 → 2,335 ms, range max 7,771 → 3,060 ms. Local
  controlled E2E: 4,538 → 416 ms.
- Status POSTs per mixed-wallet refresh lifecycle: 59 → 51.
- Wallet 0.7.3 published on October 1 (release run 36808399655); tarball
  provenance verified.

### R152: regional D1 and per-wallet homes

| Test                                                                            | Result                                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| London ready signing, APAC D1 → WEUR D1 (30 owner + 60 linked)                  | Owner 2,445 → 850 ms (p95 2,638 → 943); linked 2,240 → 799 ms                                                                                                                 |
| London first sign / burst                                                       | 4,840 → 1,152 ms; 7,867 → 1,334 ms (APAC needed 7–8 foreground refills per burst)                                                                                             |
| Tokyo ready signing, WEUR D1 → APAC D1                                          | Owner 2,969 → 1,690 ms (p95 3,174 → 2,066); linked 2,614 → 1,448 ms                                                                                                           |
| Summed owner D1 wall time                                                       | London 1,762 → 114 ms; Tokyo 1,929 → 564 ms; SQL 10–17 ms                                                                                                                     |
| Console binding lookup, NRT                                                     | p50 64 ms with APAC Console D1 vs 246 ms with WEUR                                                                                                                            |
| Unlock Gateway D1 calls                                                         | 39 → 30 (no request-time schema init) → 29 (no duplicate readback)                                                                                                            |
| Hosted travel, prepare+execute                                                  | APAC home: Hong Kong 1.789 s, Madrid 2.194, Chicago 2.184. WEUR home: Madrid 3.733, Chicago 3.544, Tokyo 3.455. OC home: Sydney 3.661, Tokyo 3.412                            |
| Local correctness (`regional-session-routing.e2e.mjs`, `run-regional-real.mjs`) | All passed: routing, Yao entry, continuations, Google, OTP, passkey claims, linking, recovery, restarts (15 Gateway and 75 role-Worker replacements), concurrent registration |
| Hosted acceptance, October 4–5                                                  | Registration, unlock, export and linking with lost replies; concurrent registration from three cities; OC 15 signatures                                                       |
| Wallet 0.8.0                                                                    | Released October 4 (run `37199917268`); client and server must upgrade together                                                                                               |

Native NRT browser, APAC wallet, staging (October 5–6):

| Change                                        |           Ready |     Consecutive |
| --------------------------------------------- | --------------: | --------------: |
| Custody D1 snapshot (20 → 8 round trips)      | 3.198 → 2.489 s |               – |
| Finalize snapshot + approval planning (8 → 6) | 2.242 → 1.983 s |               – |
| Combined Gateway→Console lookup               | 1.870 → 1.745 s |  3.411 s (n=18) |
| Refill scheduling `f6753543`                  |         1.538 s | 2.955 → 2.268 s |
| Prepare returns session projection            | 1.594 → 1.441 s | 2.635 → 2.393 s |

First contact with a new DO took 643 ms for a no-op, against 2 ms of DO wall
time. The same stub took 3 ms next time.

### R155: reusable presign DO (October 6)

| Test                                    | Result                                          |
| --------------------------------------- | ----------------------------------------------- |
| Ready signing, control vs reusable host | 1.474 → 1.463 s                                 |
| 3-signature sequences                   | 2.844 → 1.559 s (−45%); refill waits 8/9 → 1/9  |
| Early preparation after unlock          | 3.449 → 1.609 s (1 sample per arm)              |
| Base ROT arithmetic, native             | 35.552 → 26.661 ms; no hosted gain              |
| DO lookup probe, first-call median      | Named 742.5 ms; random 222.5 ms (max 11,074 ms) |

### R155B: zero-Console signing and NEAR phases (October 6–9)

- Console-outage contracts passed for owner and linked ECDSA and Ed25519, for
  restarts of the Gateway and five role Workers, for linked revocation, and for
  step-up in WEUR, APAC and OC. All made zero Console calls.
- Fence contracts passed: writer retirement during prepare (503, no row change),
  retirement before settlement, lost NEAR provisioning reply, setup reply loss
  with reload, relocation against a pending signature, concurrent setup in three
  regions (one wallet, competing op 409 `wallet_conflict`).
- Browser relocation US→APAC with fresh passkey unlock: 2 passed (3.2 min).
- The first Email OTP outage test failed on the shared limiter. That failure
  moved the counters to regional D1.

NEAR registration, hosted (3 wallets per arm):

| Phase | Change                                                      | Result                                                 |
| ----- | ----------------------------------------------------------- | ------------------------------------------------------ |
| 6A–6D | Root-store batching; A validates once; B inside its DO      | Yao setup about 6.3 → 4.9–5.4 s                        |
| 6F–6J | Router startup; parallel object startup; prepared admission | Yao 4.9 → 3.5–4.2 s                                    |
| 6Q–6T | SDK signing path                                            | 2 POSTs per signature; signing 2.06 s                  |
| 6U    | Combined custody                                            | Registration → message 16.0 → 13.2 s                   |
| 6V    | No pure-NEAR activation                                     | 6 → 4 registration requests                            |
| 6AE   | Streamed SigningWorker delivery                             | Yao 3.088 s; registration → signature 10.738 → 9.194 s |
| 6AR   | One `registration-home` and `registration-context` call     | Gateway 8 → 7, Console 9 → 7 requests                  |

Most single phases proved a request cut but not a latency gain: the control
arms moved by up to about 550 ms.

### R155C: concurrent A/B dispatch (October 9)

| Metric                            | Baseline | Candidate `580cb508` |
| --------------------------------- | -------: | -------------------: |
| SDK registration                  | 10.303 s |              7.119 s |
| Registration → verified signature | 13.639 s |             10.599 s |
| Router Yao execution              | 3,758 ms |             2,009 ms |
| A dispatched after start          | 1,395 ms |                20 ms |

Local: 16 pair-connection scenarios, 24 Worker/DO scenarios and 22
intended-behaviour contracts passed.

### R155D–R155G: registration round trips and placement

- R155F (October 11): registration D1 calls 34 → 28; registration 3.929 s, first
  sign 0.713 s, combined 4.647 s.
- R155G early sign prepare: confirmation → signature 694 → 358 ms.
- R155G Deriver B prewarm: connection 336 → 161 ms; registration 3,873 →
  3,599 ms.
- R155G joined root commitment: Deriver CPU 95/103 → 86.5/83.6 ms.
- R155G final (October 12, 27 signatures): combined 3.978 s, but the controls
  were 4.070 and 3.967 s, so no gain.

### R155H–R155J: registration by release (staging, Tokyo client)

"After passkey" excludes the passkey prompt.

| Release             |   n | After-passkey p50 |   p95 |            Above 4 s |
| ------------------- | --: | ----------------: | ----: | -------------------: |
| 0.9.0               | 198 |          2,332 ms | 3,395 |                    – |
| 0.9.3               | 164 |             1,734 | 2,593 |                    4 |
| 0.10.0              | 197 |             1,747 | 2,824 |                    – |
| 0.10.2 (acceptance) | 203 |             1,619 | 3,025 | 11 (5.4%); p99 5,966 |
| 0.11.0              |  66 |             2,021 | 2,497 |                    2 |
| 0.12.0              |  66 |             1,561 | 2,830 |                    3 |
| 0.13.0              |  66 |             1,618 | 2,631 |                    2 |

- Full registration → first signature fell from about 16 s (October 7) to
  3.978 s (October 12).
- 0.12.0 cold callee calls: 21/24/8% (A/B/SigningWorker), against 97/89/95% on
  0.11.0.
- 0.13.0 finalize p95: 858 ms, against 1,381 ms on 0.12.0.
- 0.10.2: the first batch after idle had p50 5,127 ms; other batches 2,272 ms.

### R155L: NEAR waits (October 21)

Signer requests after finalization: 2 → 0 per wallet. Development hydration:
about 48 → 5.5 ms. Three local E2Es and 25 hosted registrations passed.

### R153: relocation

Hosted APAC → US → APAC with ECDSA, Ed25519 and cleanup in both regions passed.
Pause to fresh unlock and first signature: 43.8 s out, 43.3 s back (limit 60 s).

## Open items

- **Latency targets.** Registration p99 below 4 s with under 1% above 4 s is not
  met (0.10.2: 5,966 ms, 5.4%). Releases 0.11–0.13 had too few samples for a
  p99. No signing workload has a p95 guarantee.
- **Tail causes not found.** Deriver A startup before its first event (2.4 s in
  one failure); a 14.6 s B preparation stall after a version switch; a 30 s
  streamed-delivery wait; an isolated first-signature HTTP 503; the first batch
  after idle; D1 waits of 754–888 ms with under 0.5 ms of SQL.
- **Evening serving.** 20 of 72 evening samples were served from Portland or
  Seattle. The Cloudflare zone plan is the owner's decision.
- **Finalize.** The custody reservation (`publish-routes`) is the slowest
  finalize stage.
- **Background refill.** 503 `wallet_session_unavailable` and 401
  `wallet_session_invalid` are not fully classified. A hosted retired-session
  test gets 503 where it expects 401.
- **Coverage gaps.** Crash inside a D1 transaction; independently placed Router
  stacks; Yao recovery and export across a refresh; ECDSA presign settlement;
  retirement tests 3–7; concurrent two-device signing with material replacement.
- **Not built.** Moving-authority fences at every terminal owner; Deriver A
  executor loss after B completes (today it fails closed); recovery abandonment.
- **Cleanup.** The superseded D1 pair path (`yao_pair_sessions`,
  `signing_worker_ecdsa_pool`) and the `lane_*` tables are still in the schema.
  `SEAMS_D1_HOME_DATABASE_ID` is still read by the Gateway, Runtime and local dev
  Workers. The private `DERIVER_*_PEER_SIGNING_KEY*` secrets may still exist.
- **Production.** Production moves to the Singapore anchor, OC allocations and
  the drop of the old Console OTP counter table
  (`remove-shared-otp-counters.sql`) are not done.

## Full record

[Original plans, logs and per-phase evidence](https://github.com/seams-tech/seams-wallet/tree/7a3217307509da10a16b91d8472f4649be2b21f7/docs)
(`refactor-150-*.md` to `refactor-155L.md`, with `refactor-R155J-p99.md`). The
R152 per-wallet inventory there lists every route, index and trigger. The R152
state-ownership revision 14 lists the exact per-prefix selectors that
relocation uses.

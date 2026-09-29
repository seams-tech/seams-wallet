# R150 release readiness (2026-09-29)

Status: not ready for release. The work is on branch `codex/r150-do-backend`,
which is not merged to `dev`. Nothing is deployed to staging or production;
only the isolated `r150-bench-*` comparison resources exist. This record
gathers what the branch delivers, what the consolidated run verified on each
host, what failed and why, and what the managed milestone still needs.

## What the branch delivers

The [cross-owner finalization plan](./refactor-150-cross-owner-finalization.md)
records each slice, its evidence and what it left open.
1. The Router owns each registration's execution record. Takeover is fenced by
   generation, and the tenant root is pinned at admission.
2. Registration and add-signer finalize through one decision row per
   lifecycle.
3. A recovery promotes in one batch, with required companion writes.
4. A recovery resumes instead of sticking: interrupted attempts are
   superseded, not reactivated.
5. An export authorizes in one commit.
6. A recovery runs on the SigningWorker wallet object and retires the
   activation it replaces on every host. Recovery pins its tenant root.
7. An Email OTP export replay answers with its factor release. The VM burns
   a half-finished pair on replay, as the Workers D1 Router does.
8. Each recovery attempt keeps its own staged candidate at the SigningWorker,
   so a superseded attempt's late delivery displaces nothing.
9. Slice 9 replaces slice 8's per-attempt candidates: the SigningWorker
   stages only the candidate of a recovery's highest attempt, by the
   Gateway's attempt number, and refuses a late superseded attempt.
10. A D1 SigningWorker finalize commits only while its activation is
    unretired, so a signature made just before a recovery promoted never
    answers.
11. Device linking runs on every host. A linked device's Ed25519 and ECDSA
    reservations are kept with the wallet's material, every linking request
    carries the wallet scope, and revocation retires the linked activation.
    The linking contract, which loses an activation answer and retries it,
    passes on the VM, the wallet-object build and Workers D1.
12. A lost Router answer to a linking execute is recovered. The Gateway
    retries the same request, marked as the Router's replay, and each Router
    answers it from the pair the Derivers completed, with the reservation
    the SigningWorker already holds. The VM Router now reconciles that
    replay as the Workers Routers do. The linking contract loses this answer
    too, and passes on all three hosts (2026-09-28).
13. A linked device links another on a wallet whose signers are ECDSA only.
    Its contribution comes from its own ECDSA share. The SigningWorker
    reserves the new device's material from the linked device's share, and
    the Gateway follows the links back to the registration signer. The
    contract passes on all three hosts (2026-09-28).
14. A linked device links another on a wallet with an Ed25519 signer
    (b4f4253). At an unlock the linked device opens its own Client-root
    envelope into a separate linking capability. That capability only seals
    the export root to a transfer for the same wallet, key, application
    binding and registered key. It cannot reseal a seed or a factor, and a
    root received by transfer still cannot be forwarded. Device 3 receives
    the export root and signs NEAR and Tempo with the wallet's keys. All
    three linking contracts pass on all three hosts (2026-09-28).
15. An auth-method revocation's answer is recorded in the batch that revokes
    the method (274faf2). The record is bound to the operation fingerprint
    and a digest of the proof, and keeps no code. An exact retry is answered
    from it before its proof is examined again. An Email OTP code is spent
    in that same batch, not when it is checked, so a failed commit leaves it
    usable. The SDK retries a lost revoke answer once. On SQLite with the
    whole signer chain, a scratch check confirmed:
    - the spend and the record commit together;
    - a duplicate record, a spent code or an expired code aborts the batch.

    The Email OTP add-passkey contract now refuses the first commit and
    requires both the retry and a replay to succeed. It also requires
    changed copies of the committed request to be refused (992c4b5), one
    naming another operation and one carrying another code. 7ebcde5
    fences the approving method and authority at the revocation's commit,
    and a refused proof re-reads the record in case a concurrent copy
    committed first. The contract passes on all three hosts (2026-09-29),
    with a Google test ID token minted by impersonating the configured test
    service account. So do the Email OTP export replay, the Email-founded
    passkey recovery and both auth-method addition contracts, which lose
    the finalize answer and receive its replay.
16. A linked device exports its ECDSA key (793ba2d). The holder's ordinary
    export still verified the Derivers' proof bundles as V1, and every
    export answers with stable tenant-root (V2) bundles, so a linked
    device's ECDSA export failed "client-proof verification failed:
    InvalidShape". The holder now verifies V2 bundles as the explicit export
    ceremony does, bound to its request's transcript, recipient and its own
    application binding. In the three-device NEAR linking contract, Device 3
    signs NEAR and Tempo, then exports both keys:
    - the Ed25519 export must match the registered key;
    - the ECDSA export reconstructs to the threshold key and address.

    It passes on all three hosts (2026-09-29).
17. A status read no longer rebinds a session that deferred NEAR
    provisioning moved on (e5f9179). This resolves the Workers D1
    intermittent failure below.
18. The registration ceremony CAS guard has its seeded row (af763cd). Before
    it, the first guard to fire on a fresh database committed instead of
    aborting.
19. Every SigningWorker decides a Yao recovery's deliveries and promotion by
    the same shared functions (cd5a77c): the D1 SigningWorker, the wallet
    object and the VM. Each persists what they decide. The late superseded
    attempt and the replaced-activation retirement contracts pass on all
    three hosts (2026-09-29).
20. A linked-device revocation is answered from what committed (7879820), as
    item 15 does for an auth method. Its Email OTP code is spent in the
    batch that revokes the device's method, and the answer is recorded in
    the same batch. The answer names the device's authority and its new
    revocation epoch, so the record is built from the authority row the
    batch wrote. An exact retry is answered from the record, and then
    completes the revocation's idempotent effects again: the device's
    sessions retired and its signer material deactivated. The SDK retries a
    lost device-revoke answer once. The record says which route answered
    (migration 0039), so neither route answers from the other's record. The new
    `passkey.device-linking` contract revokes with an email code across a
    refused first commit and a lost answer, and requires the retry on the
    same code, an exact replay and two refused changed copies. With the
    passkey revocation contract, which now takes the same path, it passes
    on all three hosts (2026-09-29).

The lifecycle-keyed ceremony records stay in Gateway D1. That is the final
boundary.

## Consolidated verification

The latest consolidated run is at commit da68f11 (2026-09-29), with a clean
tree, after items 1 to 20. Its evidence is under
`.artifacts/r150/consolidated-20260929/`: each contract file's Playwright
JSON report and log, the persisted traces, the crate test logs, and a
summary per host. An earlier run at bae7273 was lost with its scratch
directory in a machine restart, so it is not counted.

Rust:
- `router-ab-dev`: 125 passed, none failed, 2 ignored (the two tests that
  wait out five-minute windows).
- `router-ab-cloudflare` native tests: 486 passed, none failed.

TypeScript: the wallet server, the wallet SDK and the intended E2E suite
type-check.

Intended contracts: all 14 contract files on each host, with a Google test
ID token for the Email OTP and Google flows. `google-email-otp.recovery`
runs through a scratch config, since the committed intended-wallet config
ignores it.

| Host | Passed | Failed | Skipped |
| --- | --- | --- | --- |
| VM | 83 | 0 | 1 |
| Wallet-object build | 83 | 0 | 1 |
| Workers D1 | 84 | 0 | 0 |

The skipped contract is slice 10's commit fence. Only Workers D1 has that
window, and it passes there.

### Resolved since the previous run

The intermittent Workers D1 failure of the previous run is resolved
(e5f9179). "sustained Tempo and Arc signing uses fresh presignatures beyond
pool capacity" had failed once with "exact ECDSA Wallet Session is
unavailable" at step-up Arc signing, while deferred NEAR provisioning landed
during the step-up.
- The check. With 2efb60a's reasons, a sweep that released provisioning as
  the step-up began reproduced it once in 61 runs as
  `wallet_session_identity_mismatch (authority digest)`: the stored exact
  session was bound to an authority digest the wallet no longer stored.
- The writer. Provisioning publishes the extended authority and rebinds
  the session in one transaction. A temporary write log over 50 runs
  showed:
  - after that publication, the only session writes were status
    projections: the ECDSA and NEAR readers write back a status they read
    over the network, after re-reading the authority to check it;
  - the only authority write was the publication's own.

  A projection whose re-read ran before the publication, and whose write
  committed after it, put the older session back.
- The fix. A projection writes only when two things still hold, checked in
  the write's own transaction: the stored authority carries the session's
  digest and revocation epoch, and the selection is unlocked on its method.
  Otherwise the status is dropped for that read.
- The evidence. A new contract forces that order: it holds the step-up's
  status answer, and holds the wallet's authority re-read behind a
  transaction on its auth-method store until provisioning's publication
  queues behind it.
  - Without the fix it failed 2 of 2 on Workers D1: provisioning's
    readiness check found the older session.
  - With the fix it passes on the VM, the wallet-object build and Workers
    D1, and each run records the dropped status.
  - After the fix, 20 randomized overlap runs passed.

Its failing and passing runs are kept under
`.artifacts/r150/stepup-status-race/`, with an index.

## Contracts that failed, classified

All four were repaired, and pass in the consolidated run above. They failed
in the first consolidated run, before slices 8 to 11.

1. **"a terminal NEAR execution remains failed under fresh unlock authority
   while EVM signs"** broke in slice 1. The test's fault answered "burned" at
   the Gateway without the Router ever seeing the request. Since slice 1
   only the Router records a registration's terminal answer, so the unlock's
   exact replay ran the execution for real and succeeded.
   - The product guarantee held: an exact retry gets the Router's recorded
     answer, byte for byte, and runs nothing.
   - The fault now works at the owner of the terminal record. It forwards
     the execute with a local-only header, and a Router built for the
     intended suite ends that registration burned instead of running it. The
     Router records the answer through the same finish as any run, so the
     unlock's exact replay gets it from the Router. The Workers Routers
     honor the header only in dev builds (`local-intended-router-burn`), and
     the VM Router only when the local VM script builds it with that
     feature.
   - "terminal burned execution fails without retry" uses the same fault.
   - Both pass on the VM, the wallet-object build and Workers D1
     (2026-09-28).

2. **The three overlapping-hydration contracts** held a request that fresh
   passkey registration no longer makes:
   - "passkey hydration overlaps signer installation and gates durable
     readiness";
   - "passkey overlapping hydration failure retains a repairable
     registration";
   - "passkey lock during overlapping hydration prevents late readiness".

   Their gate held the first `/apply-server-seal` after NEAR publication.
   Since 3cf0150 ("perf: overlap NEAR registration finalization"),
   finalization applies the prepared server seal and returns it in the same
   response, as the intended behaviours now specify. Hydration then completes
   that seal in the session worker and asks the server for nothing, so the
   gate held a later, unrelated seal request instead.
   - Production follows the rule: hydration starts at NEAR publication and
     overlaps signer installation. Registration awaits it before durable
     readiness, and a failed hydration leaves the NEAR journal for unlock to
     repair.
   - The gate now holds the one worker message that completes the prepared
     seal, once per wallet tab, through a test init script in the wallet
     frame. The failure case spoils that message, so the worker refuses it
     and hydration fails.
   - All three pass on the VM, the wallet-object build and Workers D1
     (2026-09-28). No product change was needed.

## Deployable setup and hosted measurements

VM:
- Each role has a read-only deployment check, `router_ab_local_worker --check`
  (433b7f0), and so does the Gateway, `check` (701bfb0). They report
  configuration, schema, address, peers and durable-job settings, and never
  write. The one-command setup runs all five at every start, so every VM
  contract run above exercised them.
- The VM setup guide documents the checks, the operator review they cannot
  replace, and recovery: restart behaviour, upgrades, and restoring custody
  from managed backups or the recovery kit, never from a copy of a file.

Cloudflare:
- The isolated comparison's manifests are checked against each role's
  committed config (6923926). That check found both Router arms without the
  Router's wallet object; both now bind it.
- The probes run on Cloudflare (owner decision, 2026-09-29): one Playwright
  container per region in Cloudflare Containers, placed by the constraints
  APAC, WEUR and ENAM, each recording its runtime identity (7c8a163). The
  runner keeps its ledger on the operator's machine and requires every
  attempt to run on the recorded container.
- The release wallet-object build keeps two test switches compiled in,
  `R150_TEST_B_BURN_BEFORE_COMPLETE` and
  `R150_TEST_ECDSA_INTERRUPT_AFTER_CLAIM`. Each acts only when its Worker
  var is set, and no rendered manifest sets either. A release build has no
  request-reachable test or debug route.
- The pilot is approved and under way: account access and the cost
  estimate were confirmed first, and pending migrations are applied to the
  eight benchmark databases. Its results are recorded in the
  [hosted comparison](./refactor-150-hosted-comparison.md).

## Before the managed milestone

- The review items the cross-owner plan leaves open. Explicit recovery
  abandonment stays deferred.
- The hosted pilot's latency and cost results, and the rollout decision
  made on them.
- If the decision is DO: a production wallet-object configuration and
  build for the managed roles. Today the wallet-object features build only
  the local harness and the isolated comparison.
- Integration into `dev`, and seams-monorepo consuming exact package and
  artifact versions.
- The new-wallet cohort, and the Phase 3 clean reset, as separately
  coordinated operations. Superseded wallet-local D1 stores and routing are
  removed only after the DO path replaces them.

Against `dev`: `dev`'s five test-pruning commits are merged into this
branch (2026-09-29, after the consolidated run); the branch is not merged
into `dev`. Where both sides pruned the same file, the merge keeps this
branch's code and takes `dev`'s deletions. After the merge,
`router-ab-cloudflare`'s native tests pass (480, none failed), as do
`router-ab-core`'s source guards, `router-ab-ecdsa-derivation`'s boundary
test, `router-ab-dev`'s all-target check, the intended suite's type check
and the two merged unit tests. The browser suite's type check reports two
errors in test files the merge does not touch.

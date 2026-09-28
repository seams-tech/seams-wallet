# R150 release readiness (2026-09-29)

Status: not ready for release. The work is on branch `codex/r150-do-backend`,
which is not merged to `dev`, and nothing is deployed. This record gathers what
the branch delivers, what the consolidated run verified on each host, what
fails and why, and what the managed milestone still needs.

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
    requires both the retry and a replay to succeed. It has not run: it
    needs a Google ID token.

The lifecycle-keyed ceremony records stay in Gateway D1. That is the final
boundary.

## Consolidated verification

The latest consolidated run is at commit f2d1627, after slices 8 to 11.

Rust:
- `router-ab-dev`: 124 tests passed, none failed. In the run itself one test
  failed: it pins the VM Router's owned paths and did not yet name the
  source-preserving execute route. 42816f7 adds it, and all 124 then pass.
- `router-ab-cloudflare` native tests: 486 passed, none failed.

TypeScript: the wallet server, the wallet SDK and the intended E2E suite
type-check.

Intended contracts: every contract that can run here, 50 of the suite's 73,
on each host.

| Host | Passed | Failed | Skipped |
| --- | --- | --- | --- |
| VM | 49 | 0 | 1 |
| Wallet-object build | 49 | 0 | 1 |
| Workers D1 | 49 | 1 | 0 |

- The skipped contract is slice 10's commit fence. Only Workers D1 has that
  window, and it passes there.
- The Workers D1 failure is an **unresolved intermittent failure**. "sustained
  Tempo and Arc signing uses fresh presignatures beyond pool capacity" failed
  once: the client reported "exact ECDSA Wallet Session is unavailable" at
  step-up Arc signing. It passed twice when rerun alone, passes on the other
  hosts, and passed in every earlier run. Two isolated passes do not show
  that it is harmless or unrelated to this branch. What its persisted trace
  shows:
  - The wallet's NEAR registration answered late, at 7.4 s (its custody join
    took 5.0 s), so deferred NEAR provisioning ran while the step-up signing
    was under way. The step-up began at 7.14 s. Provisioning installed its
    session at 7.53 s, activated its signer at 7.54 s and was durably ready
    at 7.55 s. The step-up was confirmed at 7.76 s and then refused.
  - The refusal message comes from any of three checks in
    `resolveExactEcdsaOperationStepUpSession`
    (`signingFlowRuntime.ts`, lines 168, 195 and 208). The selected authority
    may not be resolved, unlocked and active. The exact session record may be
    missing. Or the record may no longer match the selected authority's
    digest, revocation epoch or ECDSA capability, or it may have expired. The
    trace does not say which check failed. The run's Playwright artifacts were
    overwritten.
  - The overlap alone does not explain it. Five passing Workers runs of the
    same contract have the same overlap: the two reruns, the earlier D1 run
    and two wallet-object runs, with provisioning ready 0.2 to 1.5 s after
    the step-up began (0.4 s in the failing run). On the VM the custody join takes 1.7 s, and
    provisioning is ready before the step-up begins.
  - Candidate, not established: provisioning's session install or signer
    activation replaces state between the step-up's reads.
  - Since 2efb60a each of the three checks names its reason in the refusal,
    so the next failing trace will say which state was missing or changed.
    This diagnoses the failure; it does not resolve it. The contract passes on
    the VM with the change.

Each run's persisted traces are kept with the run, outside the repository.

The first consolidated run, before slices 8 to 11, passed 43 of 47 on each
host. The same four contracts failed on every host, and all four were
repaired (below).

Not run: the 23 Email OTP and Google-backed contracts. Those flows need a
Google ID token, and this environment has none. Minting one impersonates a
service account with the user's Google Cloud credentials. The contracts are:
- `email-otp.*` and `auth-method-addition.matrix`;
- `passkey.add-email-otp`;
- the Email-only, Combined and Email OTP cases of `passkey.recovery`.

Among them are the Email OTP export replay contract and the extended
auth-method addition contracts, which lose the finalize answer and check
that a revoked method is refused.

## Contracts that failed, classified

All four now pass on every host (below). The consolidated run above predates
their repair.

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

## Before the managed milestone

- Phase 2 auth-method addition and revocation, per the
  [plan](./refactor-150-regional-wallet-home-lanes.md#required-device-linking-and-auth-method-work):
  addition and revocation touch only the Gateway's shared SQL, and the
  extended contracts need the Email OTP run below. Device linking passes on
  every host, in the consolidated run too.
- An Email OTP run with a Google ID token.
- The Email OTP run above must include the revocation's refused commit,
  its retry on the same code and the replay (item 15). They are implemented
  but have not run.
- A linked-device revocation proven by Email OTP still spends its code when
  the code is checked. A failed commit there needs a new code. Only the
  auth-method revocation defers the spend.
- `registration_ceremony_cas_guard` has no seeded row in the d1-signer chain.
  The first guard that fires on a fresh database inserts the row and commits
  instead of aborting. Registration ceremony records and the Email OTP
  registration receipt use this guard. The fix is one seeding migration.
- The review items the cross-owner plan leaves open. Explicit recovery
  abandonment stays deferred.
- The new-wallet cohort, and the Phase 3 clean reset, as separately
  coordinated operations.

Against `dev`: `dev` has one commit this branch lacks, d8c1fe5, which removes
tests. A dry-run merge applies it cleanly.

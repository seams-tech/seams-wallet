# R150 release readiness (2026-09-28)

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

The lifecycle-keyed ceremony records stay in Gateway D1. That is the final
boundary.

## Consolidated verification

Rust:
- `router-ab-dev`: 124 tests passed, none failed.
- `router-ab-cloudflare` native tests: 469 passed, none failed.

TypeScript: the wallet server and the intended E2E suite type-check.

Intended contracts: every contract that can run here, 47 of the suite's 70,
on each host.

| Host | Passed | Failed |
| --- | --- | --- |
| VM | 43 | 4 |
| Wallet-object build | 43 | 4 |
| Workers D1 | 43 | 4 |

The same four contracts fail on every host (below). Each run's persisted
traces are kept with the run, outside the repository.

Slices 8 to 10 came after this run. Slice 8's contract and the retirement
contract passed on all three hosts after slice 8. Slice 9 changed the late
attempt contract to expect a refusal, and it passes on all three hosts.
Slice 10's contract passes on Workers D1, the only host with that window,
and the retirement contract passes there again. The rest of the suite was not
rerun for these slices.

Not run: the 23 Email OTP and Google-backed contracts. Those flows need a
Google ID token, and this environment has none. Minting one impersonates a
service account with the user's Google Cloud credentials. The contracts are:
- `email-otp.*` and `auth-method-addition.matrix`;
- `passkey.add-email-otp`;
- the Email-only, Combined and Email OTP cases of `passkey.recovery`.

The new Email OTP export replay contract is among them.

## Failing contracts, classified

1. **"a terminal NEAR execution remains failed under fresh unlock authority
   while EVM signs"** broke in slice 1. The test's fault answers "burned" at
   the Gateway without the Router ever seeing the request. Since slice 1
   only the Router records a registration's terminal answer, so the unlock's
   exact replay runs the execution for real and succeeds.
   - The product guarantee holds: an exact retry gets the Router's recorded
     answer, byte for byte, and runs nothing. The VM Router ownership test
     checks this with a succeeded answer; the record does not depend on
     which answer it holds.
   - The fix is a real terminal: a gated Router-side fault on each host that
     records the burned answer. Not done here.
2. **The three overlapping-hydration contracts** fail for a reason that
   predates this work:
   - "passkey hydration overlaps signer installation and gates durable
     readiness";
   - "passkey overlapping hydration failure retains a repairable
     registration";
   - "passkey lock during overlapping hydration prevents late readiness".

   In every trace, no registration flow hydrates its session during NEAR
   provisioning: the seal request comes only after provisioning completes.
   So the test's gate never holds it before readiness. The SDK hydrates
   there only for passkey material with remaining session uses.
   - These contracts last passed on 2026-09-23 at 04:05, recorded in
     [NEAR custody profiling](./near-custody-profiling.md).
   - 3cf0150, "perf: overlap NEAR registration finalization", rewrote that
     hydration block the same day at 17:28, and is the likely cause.
   - This branch's slices change no SDK behavior. A bisect over the SDK
     commits since would confirm the cause.

## Before the managed milestone

- Phase 2 device linking and auth-method addition and revocation, per the
  [plan](./refactor-150-regional-wallet-home-lanes.md#required-device-linking-and-auth-method-work).
- The four failing contracts above, and an Email OTP run with a Google ID
  token.
- The review items the cross-owner plan leaves open. Explicit recovery
  abandonment stays deferred.
- The new-wallet cohort, and the Phase 3 clean reset, as separately
  coordinated operations.

Against `dev`: `dev` has one commit this branch lacks, d8c1fe5, which removes
tests. A dry-run merge applies it cleanly.

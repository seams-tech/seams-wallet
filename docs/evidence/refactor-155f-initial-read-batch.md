# Registration finalization reads — October 11, 2026

Finalization now reads the wallet's home, operation retry record, and ceremony in
one D1 batch. The local composed Gateway uses **9 finalization calls**, down from
the preceding **11-call local result**. The later
[hosted comparison](refactor-155f-initial-read-hosted.md) verifies **12 → 10 hosted
finalization calls**. This document records the preceding local verification.

Before this change, the [wallet/session transaction](refactor-155f-wallet-session-hosted.md) measured
**3.839 s median registration (3.754–4.627 s)** and **4.854 s median registration
through the first verified signature**. Those measurements predate this batch.

## Change and preserved behavior

- The three reads share a database snapshot and deployment check. Their existing
  stores still own their query construction and record parsers.
- Home admission checks the ownership generation and relocation write block in
  the same query. An established wallet no longer needs a second home query.
- Admission completes before preparation or writes. Retired homes remain closed.
  Cancelled registration retains its existing cancellation-publication retry.
- Ceremony decoding occurs only when the operation needs preparation. A completed
  retry works after ceremony deletion and returns the original session identity.
  It does not return another operation credential.
- A resumed claim reads its current ceremony. A competing claim still triggers
  a fresh journal read. The existing claim and transaction guards remain.
- Mixed-wallet continuation uses its committed installation. It does not depend
  on a surviving registration ceremony.

The initial batch reports one timing span, `near_finalize_initial_read`. This
replaces the separate home and journal timing spans. No migration, environment
variable, or infrastructure resource was added.

## Local call graph

| Work and transaction owner | D1 calls | Required state |
| --- | ---: | --- |
| Initial reader: home, retry record, and ceremony snapshot | 1 | Verified setup claims |
| Operation journal: prepared claim | 1 | Validated ceremony and request fingerprint |
| Yao registration store: lifecycle state | 1 | Prepared claim, before Router consumption |
| Lifecycle-decision store: current decision | 1 | Prepared claim; overlaps consumption and credential claiming |
| Wallet commit store: founding authority and auth method | 1 | Verified activation and credential claim |
| Yao capability store: current capability | 1 | Same prerequisites; overlaps the founding-record read |
| Registration transaction: wallet, capability, session, and decision | 1 | Verified activation, claimed credential, and current record versions |
| Custody store: persistence | 1 | Wallet commit and recovery-route claim |
| Operation journal and home authority: activation and completed receipt | 1 | Durable initial session and Console completion acknowledgement |
| **Total** | **9** | |

The local trace contains **55 SQL statements**. Batching retains the three SELECT
statements while removing two database exchanges. The preceding local sequence
is recorded in the [transaction evidence](refactor-155f-wallet-session-transaction.md).

This trace excludes private Gateway admission, Console, custody-role databases,
and cleanup after the response. The later hosted comparison confirms the projected
reductions: **12 → 10 finalization calls**, **36 → 34 registration calls**, and
**43 → 41 calls through the first signature**. Its timings and trace coverage are
recorded separately from this local result.

## Verification

- Production server build, server type-check, and wallet-state type fixtures pass.
- All four public NEAR registration contracts pass. They cover replay, reload,
  lost credentials, failed session sealing, and verified signing after recovery.
- All three composed regional scenarios pass, including mixed-wallet reply loss
  and recovery after a lost Console completion reply.
- The normal composed scenario observes all three initial reads in one batch.
  It deletes the ceremony, replays finalization successfully with the same session,
  and signs through OC while Console is unavailable.
- The production relocation participant closes execution temporarily. Finalization
  replay returns HTTP 400 with `wallet_home_unavailable`. After release and permanent
  retirement, replay returns the same error.
- Registration setup, session-issuance transactions, and authorization storage and
  transfer scenarios pass. They exercise cancellation retries, concurrent issuance,
  closed generations, storage contention, and relocation fences.

The old private test probe required the journal request to start while a separate
home request was pending. That ordering assertion became obsolete. Its replacement
checks the combined batch and retains the lifecycle checks above.

The [JSON evidence](refactor-155f-initial-read-batch.json) is an unchanged copy of
`seams-monorepo/.artifacts/r155b-session-observation/normal/proof.json`. It contains
the database trace, replay outcomes, and independently verified NEP-413 signature.
SHA-256: `e73b89da809a258e27426eaf5e04d513e5cbc3240b11b876adb025fe65024674`.
The matching lost-reply record remains at
`seams-monorepo/.artifacts/r155b-session-observation/lost-reply/proof.json`.

### Completed retry call count

A later run of the same composed scenario also records the completed retry's
database trace. Private commit `67fe153` adds this observation to the existing
cleanup, retry, foreign-region signing, and relocation-fence scenario.
The scenario passes against public `1ef8306c`.

After ceremony deletion, the retry uses **one completed D1 batch**. Its three
queries read the current home and relocation block, the completed operation,
and the absent ceremony. One cleanup read remains pending at the response.
The retry returns the same session identity and no new operation credential.
Fresh finalization still uses nine completed calls in this run.

With valid setup authorization, one current-state batch is sufficient for this
completed retry. It checks home availability and reads the saved result together.
This count excludes the private Gateway's separate deployment-admission query.
It is a local measurement.

The [retry evidence](refactor-155f-initial-read-replay.json) retains both traces,
the cleanup and fence checks, and the verified NEP-413 signature. It is an
unchanged copy of `.artifacts/r155f-initial-read-hosted/local-replay-proof.json`
in `seams-monorepo`.
SHA-256: `6a2d857553d42fde01c4f2d42b2bb8262ce3bf2025f86750f48337d1b40ee529`.

## Reproduction

From `seams-wallet`:

```sh
pnpm -C packages/wallet-server build
pnpm -C packages/wallet-server type-check
pnpm -C tests type-check:wallet-state
node tests/e2e/registration-setup-startup.e2e.mjs
node tests/e2e/session-issuance-transaction.e2e.mjs
node tests/e2e/authorization-storage-transfer.e2e.mjs
SEAMS_LOCAL_PORT_OFFSET=1600 SEAMS_INTENDED_SKIP_BUILD=1 \
node tests/scripts/run-wallet-intended-isolated.mjs -- \
  e2e/intended-behaviours/passkey.near-registration-commit.contract.test.ts
pnpm report:bloat --check
```

From `seams-monorepo`:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
SEAMS_INTENDED_SKIP_BUILD=1 SEAMS_LOCAL_PORT_OFFSET=1000 \
node tests/scripts/run-regional-real.mjs passkey.registration.contract.test.ts \
  --grep 'NEAR registration combines|NEAR registration recovers a lost|mixed NEAR provisioning reply loss'
```

The [hosted record](refactor-155f-initial-read-hosted.md) contains the subsequent
control/candidate/control comparison and the next optimization priorities.

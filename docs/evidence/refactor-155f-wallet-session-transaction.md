# Wallet and initial-session transaction — October 11, 2026

Fresh NEAR-only registration now commits its wallet, capability, and initial
session in one D1 batch. The local composed Gateway measures **11 finalization
D1 calls**, down from the preceding **12-call local measurement**.
Hosted latency for this change remains unmeasured.

The last hosted result remains **3.950 s median registration**, with a
**3.902–4.949 s range**. Registration through the first signature measured
**4.804 s median**. Those results predate this change. See the
[Console comparison](refactor-155f-console-setup-hosted.md).

## Change and ordering

The session service prepares the same session identity, quota, and credential.
Its D1 store builds the existing issuance statements and winner read. The wallet
commit supplies its wallet, signer, authority, auth-method, capability, and
lifecycle-decision statements. One D1 batch executes both sets.

The existing capability version check can reconcile one concurrent write.
The session candidate stays the same during that reconciliation. The existing
session parser reads the winning identity and credential digest from the batch.
An exact retry returns the existing session without minting another credential.

The matching registration completion decision also commits in this batch.
Custody persistence follows it. Console publication and session sealing retain
their existing overlap. Ordinary signing remains closed until Console acknowledges
completion and the final local transaction activates the home with its replay receipt.

ECDSA registration and mixed-wallet continuation retain their respective session
flows. They do not create another initial NEAR session. No migration, new binding,
or new resource is required.

## Verified call counts

| Scope | Previous | Candidate |
| --- | ---: | ---: |
| Wallet, capability, and session segment | 4 | **3** |
| Local composed Gateway finalization | 12 | **11** |

The segment contains two independent reads and one combined write batch.
It previously needed a separate session batch. SQL statements remain; one D1
exchange is removed. The previous local finalization count is recorded in the
[committed-home evidence](refactor-155f-session-seal-overlap.md#completion-dispatch-without-a-second-home-read).

The composed candidate records this finalization sequence:

1. Home admission read.
2. Operation-journal read, overlapping home admission.
3. Ceremony read.
4. Prepared operation write.
5. Yao lifecycle read.
6. Lifecycle-decision read.
7. Founding authority and auth-method read.
8. Capability read, overlapping the founding-record read.
9. Combined wallet, capability, session, and completion-decision batch.
10. Custody persistence.
11. Home activation and completed-operation receipt.

This local trace excludes hosted Gateway admission. The last hosted candidate
used 13 finalization calls and 37 total Gateway/Console registration calls.
Those hosted totals require a new measurement; the local reduction does not
establish a measured regional latency saving.

## Verification

- Production server build, server type check, and wallet-state type fixtures pass.
- The production D1 scenario rejects a credential claim before any wallet write.
  An injected session-write failure rolls back the wallet, authority, capability,
  session, and completion decision. Two concurrent retries after an ignored
  successful reply preserve the winning credential and quota.
- The existing authorization-storage scenario passes. It covers capability
  contention, recovery state, relocation fences, and transferred authorization.
- The existing session-issuance scenario passes. It covers concurrent minting,
  revoked methods, closed generations, and lost directory completion replies.
- All four public NEAR registration contracts pass. They cover replay, reload,
  a lost finalization credential, a failed server seal, and subsequent signing.
- All three composed regional scenarios pass. They cover mixed-wallet reply loss,
  combined publication, and recovery after a lost Console completion reply.
  Foreign-region signing succeeds with Console unavailable.
- The Email OTP NEAR-only registration and passkey-addition contract passes.
  Its first attempt stopped because the Google test token had expired. This was
  an environment failure. The existing token refresh resolved it; no code repair
  was needed.
- The bloat check passes. No ratcheted measure grew.

The [transaction JSON](refactor-155f-wallet-session-transaction.json) is an unchanged
copy of `.artifacts/registration-credential-reservation/proof.json`. It records the
production SQL traces, rollback, concurrency, and retained credential checks.
The composed record is
`seams-monorepo/.artifacts/r155b-session-observation/normal/proof.json`.
Its ninth finalization call contains the wallet and session statements together.
Its matching `lost-reply/proof.json` records the completion-retry outcome.

## Reproduction

From `seams-wallet`:

```sh
pnpm -C packages/wallet-server build
pnpm -C tests type-check:wallet-state
node tests/e2e/registration-credential-reservation.e2e.mjs
node tests/e2e/session-issuance-transaction.e2e.mjs
node tests/e2e/authorization-storage-transfer.e2e.mjs
SEAMS_LOCAL_PORT_OFFSET=1600 SEAMS_INTENDED_SKIP_BUILD=1 \
node tests/scripts/run-wallet-intended-isolated.mjs -- \
  e2e/intended-behaviours/passkey.near-registration-commit.contract.test.ts
pnpm ensure:intended-google-token
SEAMS_LOCAL_PORT_OFFSET=1600 SEAMS_INTENDED_SKIP_BUILD=1 \
node tests/scripts/run-wallet-intended-isolated.mjs -- \
  e2e/intended-behaviours/auth-method-addition.matrix.contract.test.ts \
  --grep 'an Ed25519-only Email OTP wallet gains a passkey'
pnpm report:bloat --check
```

The browser command assumes the existing SDK, WASM, and local custody builds.
From `seams-monorepo`, using the rebuilt server:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
SEAMS_INTENDED_SKIP_BUILD=1 SEAMS_LOCAL_PORT_OFFSET=1000 \
node tests/scripts/run-regional-real.mjs passkey.registration.contract.test.ts \
  --grep 'NEAR registration combines|NEAR registration recovers a lost|mixed NEAR provisioning reply loss'
```

The public source before this change is `19723f38`. The composed Console source
is private `3db9b5d`. No live resources changed during this implementation.

## Next measurement

Freeze matching Gateway and Runtime builds. Compare the prior and combined
transactions on existing staging with the same SDK, Console, custody versions,
database bindings, and client location. Retain a repeated control and verify all
signatures. Report registration and first-signature median, range, and maximum,
plus finalization D1 counts. Restore and verify staging after the comparison.

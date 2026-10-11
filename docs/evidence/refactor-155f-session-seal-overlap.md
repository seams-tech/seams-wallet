# Registration session sealing overlap — October 11, 2026

Server sealing now overlaps home publication after the Wallet Session is durable.
The old sequence completed registration and then computed the seal. The new sequence
starts publication, computes the seal, commits finalization, and returns one response.

## Boundaries preserved

- Registration verifies authority and commits the wallet and session before sealing starts.
- The existing sealing service still checks the session and runs its configured guard.
- The prepared result remains inside its request. The route checks its wallet, session
  and expiry against the completed response before returning it.
- Home publication and sealing both settle on success or failure. Failed publication
  leaves registration retryable and returns no successful registration response.
- A sealing failure cannot prevent the already issued session from receiving a durable
  finalization receipt. The caller can recover through the existing exact-method unlock.
- Exact replay uses the persisted session. Resumed mixed registration uses its current
  session projection. Neither path reuses another request's preparation object.
- Cipher operations, key derivation, D1 calls, and HTTP endpoints are unchanged.

The old route helpers moved into `registrationSessionSeal.ts`. The request-local
object holds one result promise. There is no new persistent state or compatibility path.

## Verification

| Check | Result |
| --- | --- |
| Selected browser contracts | 9 pass |
| Composed regional completion and lost-reply scenarios | 2 pass |
| Real D1 credential reservation and wallet commit | Pass |
| Wallet-server build and type check | Pass |
| Wallet-state and intended-behavior type checks | Pass |
| Bloat check | Pass |

The private composed scenario withholds Console's completion reply until the real
server seal finishes. It then verifies registration, foreign-region signing during
a Console outage, explicit session refresh and lock. It recorded one seal service call.
The existing lost-completion scenario also passed and signed after normal unlock.

The public browser selection covers NEAR registration, exact replay, mismatched
session IDs, lost credentials, failed ciphertext sealing, recovery and mixed registration.
Each signature scenario verifies the signature independently and writes a JSON artifact.

Reproduce the composed checks from `seams-monorepo` after building the candidate:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
SEAMS_INTENDED_SKIP_BUILD=1 SEAMS_LOCAL_PORT_OFFSET=1000 \
node tests/scripts/run-regional-real.mjs passkey.registration.contract.test.ts \
  --grep 'NEAR registration combines|NEAR registration recovers a lost'
```

The composed artifacts are `.artifacts/r155b-session-observation/normal/proof.json`
and `.artifacts/r155b-session-observation/lost-reply/proof.json` in the private repository.
The first contains `sessionSealing.completedBeforeDirectoryReply: true` and one
`computationsDuringRegistration` service call.

The public scenarios are in
`tests/e2e/intended-behaviours/passkey.near-registration-commit.contract.test.ts`.
Run them with the existing `playwright.wallet-intended.ci.config.ts` configuration.
This run's browser artifacts are in `.artifacts/r155f-seal-local/browser-recheck/`.
Their evidence includes rejected mismatched seals, a failed initial seal, exact
finalization replay, and signatures after reload and fresh unlock.

The first test revision assumed every recovery request included a seal. The
unchanged recovery contract passed on the candidate backend. The corrected test
checks a seal only when the request includes one, as the current API permits.
This correction changed no production behavior.

## Measurement limits and next steps

At implementation time, hosted savings were unmeasured. The later
[hosted comparison](refactor-155f-finalization-overlap-hosted.md) tested this change
with the read overlaps. Candidate registration measured **4.267 s** against
**4.346 s** before and **4.227 s** afterwards on the baseline. It establishes
no clear total-latency gain. Finalization measured **1.030 s** against **1.234 s**
and **1.069 s**. The earlier **3.530 s / 4.204 s** early-preflight result remains
a separate historical measurement.

Sealing still requires its existing CPU work. Synchronous WASM can delay other
JavaScript continuations. The profile's 78–80% sample share cannot be converted into
an elapsed-time saving. The overlap must be measured on the hosted path.

The `near_finalize_session_seal` timing now measures only the wait after the service
completes. A zero value means preparation already finished. It does not mean zero CPU.
The session-issuance span includes the earlier computation and home publication.

Next, address Console's independent database reads and finalization's remaining
initial reads. Keep exact retry and completion ordering in each comparison.

## Completion dispatch without a second home read

Public commit `88ef6517` removes one D1 read before Console completion. The session
transaction already reads the home state and fixes the registration decision.
It now returns that state. Publication uses the result directly. The duplicate
decision-write path is deleted.

The previous overlap began publication before sealing, but publication first
awaited D1. Sealing could delay the continuation that sent the Console request.
The new path sends that request before sealing starts.

Private commit `caa6c88` strengthens the composed browser scenario. It verifies
that Console receives completion before the real sealing service starts. It also
withholds Console's reply until sealing finishes. Both ordering assertions passed,
with one seal computation during normal registration.

The [recorded evidence](refactor-155f-committed-home-publication.json) contains the
transaction results, local call counts, and independently verified signatures.

| Check | Result |
| --- | --- |
| Publication and activation after session commit | One activation batch; the prior SELECT is removed |
| Local Gateway finalization | 12 D1 calls, excluding hosted Gateway admission |
| Console completion requested before sealing | Verified |
| Normal registration and lost-completion browser scenarios | 2 pass |
| Concurrent issuance, wrong ceremony, cancellation, retired home and exact retry | Pass |
| Authorization transfer and atomic home activation | Pass |
| Credential reservation scenario | Pass |
| Server build, server type check, wallet-state type fixtures and bloat check | Pass |

The session transaction remains the only source of the established decision.
Wrong-ceremony issuance rolls back. A lost Console reply keeps signing blocked.
Retry reuses the committed session. An active replay sends no completion request.
A retired home rejects registration issuance. Home activation still commits with
the operation's completion record.

Reproduce the transaction checks from `seams-wallet`:

```sh
node tests/e2e/session-issuance-transaction.e2e.mjs
node tests/e2e/authorization-storage-transfer.e2e.mjs
node tests/e2e/registration-credential-reservation.e2e.mjs
```

Use the composed command above for the browser checks. The later
[home-publication comparison](refactor-155f-home-publication-hosted.md) confirms
**13 hosted finalization calls**, including admission, against 14 in the control.
The local count of 12 uses a different admission path.

That comparison also includes the initial home/journal read overlap. Finalization
measured **1.138 s**, between the controls' **1.420 s** and **0.961 s** medians.
Registration measured **4.102 s**, compared with **5.064 s** and **4.094 s**.
It establishes no clear overall latency gain. The Console lineage batch is fixed
in every group. Full batching of home, journal and ceremony remains open.

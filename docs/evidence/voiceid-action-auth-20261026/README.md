# VoiceID action authentication — 2026-10-26

Release target: SDK 0.24.0, after SDK 0.23.0 publishes. This work remains on
`codex/voiceid-browser`. The branch was rebased onto `ca0ddcd8` (the 0.23.0 release commit).

## Measured results

- ES256 and RS256 management journeys passed. A VoiceID session improved its
  enrollment with one fresh passkey assertion and retained its selected session.
- Both journeys rejected replayed and invalid passkey assertions. Cancellation
  and locking during recording preserved enrollment. Three accepted samples
  completed the operation. Saved samples survived reload and retired expiry fields.
- The Accounts journey added ECDSA from a VoiceID session with one passkey prompt.
  It displayed NEAR, Tempo, and Arc addresses without an automatic second unlock.
- VoiceID subsequently signed Arc and NEAR transfers. A cancelled second Arc
  transfer produced no transaction. These use real model inference and real
  signing protocols with deterministic RPC responses. They do not prove live settlement.

- Adding Email OTP from VoiceID passed with one passkey assertion. The selected
  VoiceID session remained unchanged. The test recovered a lost finalize response,
  rejected a duplicate addition, reloaded, and unlocked with the added Email OTP method.
- The existing Email OTP-to-passkey lifecycle and Email-confirmed removal journeys
  passed. The surviving method continued signing.
- Wallet/server/app/test type checks, both builds, and `report:bloat --check` passed.

Raw artifacts: [ES256 management](management-es256.json),
[RS256 management](management-rs256.json), [Arc and NEAR](arc-and-near.json),
[Accounts screenshot](accounts-with-evm.png), [VoiceID adds Email OTP](voiceid-add-email.json),
and [Email-confirmed removal](email-removal.json).

## Diagnosis

| Fact | Evidence | Limit |
| --- | --- | --- |
| The inventory mapper handled passkey and Email OTP, with no VoiceID branch. | `deviceLinkingOwnerAuthorization.ts` before this change | Code inspection alone does not measure browser behavior. |
| The management UI disabled its action when VoiceID was selected. | Previous `VoiceIdAvailabilityControl.tsx` gating | The existing passkey proof still protected the mutation. |
| The revised composed management test saves from a VoiceID session with one passkey request. | Both management JSON artifacts and the request-count assertion | Uses virtual passkeys and deterministic audio. |
| EVM setup requested an automatic unlock after adding the signer when its session was unavailable. | Previous `finishSetup` in `AddEvmAccount.tsx` | A still-authenticated session did not take that branch. |
| The revised Accounts journey uses one passkey request and then signs both chains through VoiceID. | Arc contract assertion and `arc-and-near.json` | No live RPC broadcast. |

| Candidate cause | Matching facts | Conclusion |
| --- | --- | --- |
| VoiceID cannot authorize inventory reads | Missing mapper branch; UI falls back after the request fails | Fixed the mapper and removed the false complete-inventory fallback. |
| Voice changes require a separate passkey session | Existing mutation already verifies a fresh passkey assertion | Removed the prerequisite. Bound initiating session and confirming passkey separately. |
| Signing requires the automatic passkey unlock after EVM setup | Revised Arc and NEAR journey succeeds without it | Removed automatic unlock. Later actions obtain their required authorization. |

The mutation checks the exact initiating session and the server's active passkey
inventory before proof and before commit. Local checks retain the wallet, authority,
method, lock generation, enrollment revision, availability revision, and expiry.
The addition intent retains the proving method, authority digest, and revocation
epoch. The retired source-session field did not authorize the addition on the server.

An independent reviewer found no concrete authorization bypass in these changes.

## Test setup and repeatability

Build the Wallet server and SDK from this checkout. Serve the intended app on
4320, the Wallet host on 4313, and the local gateway on 4600. The gateway must
use this checkout's Wallet server output. Keep model files available to the host.

Set these variables for the local test stack:

```sh
export SEAMS_INTENDED_APP_URL=http://localhost:4320
export SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:4313
export SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:4600
export SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID=local-smoke-project:dev
export SEAMS_INTENDED_PUBLISHABLE_KEY=pk_local
```

Run the composed contracts:

```sh
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/passkey.voiceid-ui.contract.test.ts \
  e2e/intended-behaviours/voiceid.unlock-arc.contract.test.ts \
  --workers=1 --output=/private/tmp/voiceid-action-auth
```

Email tests also require the existing Google test audience on the local gateway,
a current `SEAMS_INTENDED_GOOGLE_ID_TOKEN`, and the local development OTP outbox.
Run these checks with the same environment:

```sh
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/voiceid.add-email-otp.contract.test.ts \
  e2e/intended-behaviours/email-otp.add-passkey.contract.test.ts \
  --workers=1 --output=/private/tmp/voiceid-action-auth-email
```

The initial missing-token and missing-audience failures were infrastructure failures.
An older removal test used the retired `Email code` label. Its selector now names
Passkey and Email OTP directly. That was an obsolete UI fixture.

The new test first used a NEAR-only registration with the existing multi-chain
Email unlock helper. The helper requires an EVM address. The test now uses the
multi-chain registration profile. Production unlock behavior was unchanged.

The initial new addition test assumed duplicate API calls never request source
proof. The server checks duplicates before target enrollment, after source proof
in that path. The revised assertion retains duplicate rejection and verifies
one passkey request for the successful addition itself.

## Limits before release

- Adding a first passkey from a VoiceID session backed only by Email OTP is outside
  this change. That path still requires the Email OTP session's custody capability.
- Live Arc settlement, human speech accuracy, and removal of the temporary
  Recording details expander remain release acceptance work.
- Publish matching Wallet host, SDK, and server changes together for 0.24.0.
  Previously pending addition intents must restart after the wire-shape change.

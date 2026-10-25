# Manual adaptive VoiceID — browser evidence

Measured 2026-10-26. This record verifies the explicit Manage voice flow with
synthetic speech, native virtual passkeys, and the deployed browser models.
Human recognition benefit remains unproved. Automatic learning remains deferred.

All five composed browser journeys passed. See
[ES256 passkey with Ed25519 Wallet](es256-passkey-ed25519-wallet.json) and
[RS256 passkey with Ed25519 Wallet](rs256-passkey-ed25519-wallet.json).
The [settings screenshot](authentication-methods.png) shows the requested placement.
The [management screenshot](manage-voice.png) shows the available actions.

## Scope and fixed rules

Authentication methods places **Manage voice** beside the VoiceID toggle.
An enabled local method and a selected passkey owner session permit management.
Each change requires a fresh user-verified passkey assertion. This includes
improvement, reset, re-recording, and explicit import of a previous enrollment.

The speaker threshold remains **0.500**. The phrase gap limit remains **8**.
Prompts remain **6–7 words**. Three accepted supplements contribute 20% of the
effective template. The immutable baseline contributes 80%. Each supplement must
match that baseline at 0.500. The effective template must retain baseline cosine
similarity of at least 0.98. Supplements expire after 24 hours or 32 template uses.
Use never renews expiry. Rejected speaker checks also consume a reserved use.

These are experimental bounds. The earlier
[feasibility experiment](../voiceid-adaptive-enrollment/README.md) found 2/52
evaluation-group rejections both before and after adaptation. It established no
held-out improvement. This browser evidence establishes flow behavior only.

## Credential algorithms and wallet signers

| Role | Algorithm exercised |
| --- | --- |
| Passkey confirmation, first journey | ES256: ECDSA with P-256, COSE algorithm -7 |
| Passkey confirmation, second journey | RS256: RSA with SHA-256, COSE algorithm -257 |
| Wallet transaction signing, both journeys | Ed25519-Yao MPC for NEAR |

The fixture restricts credential creation to the selected passkey algorithm.
It checks the algorithm returned by the browser authenticator. The production
code verifies fresh signatures against the stored passkey public key.
RSA here describes a passkey credential. Wallet transaction signers remain
ECDSA/secp256k1 and Ed25519. VoiceID EVM support remains separate work.

## Composed journeys

The UI contract checks these behaviors for each passkey credential algorithm:

- Enroll, disable, and enable VoiceID through Authentication methods.
- Import a previous browser-wide enrollment with passkey confirmation.
- Preserve its baseline hash and remove the obsolete global record.
- Select VoiceID from the saved wallet menu and restore that menu after cancellation.
- Unlock with VoiceID and sign a reviewed transfer through the existing NEAR signer.
- Disable an active VoiceID session and reject another VoiceID unlock.
- Return to a passkey owner session without selecting VoiceID automatically.
- Cancel improvement capture and preserve the enrollment exactly.
- Reject a replayed assertion and a fresh assertion with a corrupted signature.
- Lock during recording, release the microphone, and preserve the enrollment.
- Save three supplements while preserving the original baseline and owner session.
- Unlock and sign again using the adapted template, consuming two of its 32 uses.
- Reset improvements while preserving baseline identity and contents.
- Return to the baseline after the last use and after expiry.
- Re-record the baseline while preserving the existing authentication method.
- Remove the VoiceID method and delete its scoped enrollment.

The lifetime cases reuse an actual generated enrollment with controlled stored
expiry or remaining-use counts. The test does not wait 24 hours. Other speech,
phrase matching, speaker inference, and signing execute through production paths.
NEAR RPC is deterministic test infrastructure. Signed transaction bytes and
signature checks are real. These runs do not broadcast a public-network transfer.

The JSON reports contain hashes, metadata, and signed synthetic transactions.
They contain no audio, biometric vectors, passkey private keys, or real user data.
The storage limit is 32 KiB. Each report records the actual serialized size.
The adapted records measured 16,551 bytes for the ES256 journey and 16,556 bytes
for the RS256 journey. Baselines measured 4,484 and 4,490 bytes respectively.

## Reproduce

Provision the pinned VoiceID model assets and the local Wallet test services.
Use fresh synthetic wallets in isolated browser contexts. Build the SDK first:

```sh
SEAMS_WALLET_APPROVED_RELAYER_ORIGINS='http://127.0.0.1:4510 http://127.0.0.1:4600 http://127.0.0.1:4800' \
  pnpm -C packages/wallet build:sdk

SEAMS_INTENDED_APP_URL=http://localhost:4320 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:4313 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:4600 \
SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID=local-smoke-project:dev \
SEAMS_INTENDED_PUBLISHABLE_KEY=pk_local \
  pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/passkey.voiceid-ui.contract.test.ts \
  --output=/private/tmp/voiceid-adaptive-management-repeat
```

The test writes JSON and screenshots into the selected output directory.
Use the existing [local service launcher](../../../tests/scripts/start-wallet-intended-services.mjs).
The [audio fixture instructions](../../../tests/fixtures/audio/README.md) describe
the synthetic recordings.

Supporting contracts cover cold passkey loading, explicit session selection,
noise-only rejection, noisy speech, phrase and speaker retries, model retirement,
microphone cancellation, and cancellation at the enrollment commit boundary.
Their reports are stored beside the management reports. The signing-admission
report uses a deterministic perception boundary and performs no broadcast.

- [Explicit session selection](voiceid-session-selection.json)
- [Noise handling](noise-capture.json)
- [Live-page capture and retry behavior](voiceid-live-page.json)
- [Signing admission](voiceid-wallet-gate.json)

With the same service environment, repeat the supporting contracts with:

```sh
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/passkey.voiceid-selection.contract.test.ts \
  e2e/intended-behaviours/voiceid.noise.contract.test.ts \
  e2e/intended-behaviours/voiceid.live-page.contract.test.ts \
  --output=/private/tmp/voiceid-adaptive-support-repeat
```

SDK build, SDK types, intended-contract types, Wallet state type fixtures, static
asset checks, and `pnpm report:bloat --check` also passed.

## Integration faults found during validation

Both failures were classified as production regressions before repair.

| Fact | Instrument | Check |
| --- | --- | --- |
| Login updated React state before the hosted menu delivered its terminal outcome. | The composed browser journey and hosted-menu controller lifecycle. | Await the host anchor's removal before opening the next menu. |
| The server revoked VoiceID, then the client rejected its response kind. | The final removal step and the strict response parser. | Accept the server's VoiceID revocation shape, then verify scoped data deletion. |

| Candidate cause | Menu evidence | Removal evidence | Result |
| --- | --- | --- | --- |
| Speaker inference failure | Authentication already succeeded. | No capture runs during removal. | Contradicted. |
| Hosted-menu effect cleanup on login | Cleanup cancelled the pending terminal outcome. | Does not explain response parsing. | Corrected by restarting on logout generation. |
| Missing VoiceID response branch | Does not explain the lost menu outcome. | Server response was valid and lacked a client parser branch. | Corrected at the response boundary. |

The final journeys exercise both repairs. They also check actual menu closure,
subsequent menu reuse, method removal, and local enrollment deletion.

## Live validation still required

Unlock with a passkey. Open Authentication methods, then Manage voice.
Import the previous enrollment if offered. Select Improve voice recognition and
record three phrases at a normal pace in a quiet place.

Compare later first-attempt unlock and signing results across separate sessions.
Record speaker and phrase failures separately. This is still needed to determine
whether the manual option helps the user's demonstrated failure pattern.

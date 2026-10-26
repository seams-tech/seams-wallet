# VoiceID unlock frame and automatic capture

All five browser contracts passed on 2026-10-26. The cold-preparation contract
passed after retiring its old fixed-height assertion. Download progress now gives
way directly to listening. Its replacement checks Back and the footer after loading.
SDK build, type fixtures, and the bloat check passed.

Screenshots: [unlock listening](unlock-listening.png) and [Manage voice](manage-voice.png).
The five generated JSON reports in this directory record the successful runs.

Unlock uses one rounded wallet surface with a Back control and the Seams footer.
The hosted menu retains its requesting-site label. The first Unlock with VoiceID
action starts recording after preparation. There is no second unlock button.
Retry remains explicit. Back stops the microphone and returns to the menu.

The generic `.seams-wallet-ui` rule supplied an opaque background behind the
rounded child. The VoiceID activation container now overrides that background
with transparency. This also applies to Manage voice and enrollment. Unlock owns
its separate rounded outer frame and clips its content to that boundary.

Tests use synthetic speech through browser capture, real model inference, and
real Ed25519-Yao signing against deterministic NEAR RPC. No personal recordings
or public-network transactions are involved. The intended browser contracts cover
automatic capture, Back cancellation, model/challenge preparation cancellation,
noise and phrase retries, wallet lock during verification, and management.

Run the [local service setup](../voiceid-adaptive-management/README.md#reproduce),
then use the same service environment with:

```sh
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/passkey.voiceid-selection.contract.test.ts \
  e2e/intended-behaviours/passkey.voiceid-ui.contract.test.ts \
  e2e/intended-behaviours/voiceid.noise.contract.test.ts \
  e2e/intended-behaviours/voiceid.live-page.contract.test.ts \
  e2e/intended-behaviours/voiceid.unlock-near.contract.test.ts \
  --grep-invert 'rs256 passkey' --output=/private/tmp/voiceid-unlock-frame-repeat
```

The requesting-site label and brand icons reuse the wallet's existing elements.
Enrollment still requires a Record action for each sample. Unlock requires the
Wallet to remain visible and focused when capture starts. Permission prompts remain
under browser control. No recognition or speaker thresholds changed.

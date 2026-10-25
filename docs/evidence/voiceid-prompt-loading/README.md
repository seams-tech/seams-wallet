# VoiceID prompt visibility and loading

VoiceID did not report its dimensions to the parent Wallet iframe overlay. The
parent kept the modal transparent and non-interactive until its four-second
measurement fallback. The prompt now uses the existing request measurement reporter.
It observes the stable outer section and disconnects when that section closes.

The optional plugin also separates its lightweight prompt entry from activation,
unlock, and review implementations. The prompt mounts and yields a frame before
loading the implementation. Core session cleanup and generation allocation run
during visible preparation. Model progress appears inside the card. Cancel remains
available, and a cancelled import cannot start session preparation or a challenge.
The lightweight entry itself still requires its first module download.

## Facts and instrument correction

| Fact | Instrument | Scope | Check |
| --- | --- | --- | --- |
| User reports 3–4 seconds before unlock modal appears | User report and screenshot | Live Chrome | User supplied |
| Child dialog passed visibility at 470 ms in the initial probe | Playwright child locator | Isolated Chromium | **Insufficient visibility instrument** |
| Screenshot taken after that type of child visibility check shows the app underneath | `before-transparent-modal.png` | Isolated delayed-load test | Inspected visually |
| Cancel click and completion took 4,346 ms | Node monotonic clock | Same delayed-load test | `before.json`, failed `< 1000 ms` assertion |
| Provisional request modals have opacity 0 and pointer-events none | Parent overlay CSS | Production implementation | `overlay/overlay-styles.ts` |
| Missing measurements trigger a 4,000 ms fallback | Parent router | Production implementation | `client/router.ts` |
| VoiceID previously created no measurement reporter | Capture surface before this change | Production implementation | Compared with existing confirmer and export surfaces |

The earlier 470 ms figure measured child DOM presence. It did **not** measure when
the user could see or click the modal. That visibility claim is withdrawn.
The corrected test checks parent opacity 1, pointer-events auto, and absence of
provisional, fallback, and reveal-pending classes. It then takes a screenshot and
clicks Cancel before the fallback deadline.

## Candidate causes

| Candidate | Evidence | Result |
| --- | --- | --- |
| Missing iframe measurement | Transparent screenshot, disabled pointer access, exact four-second fallback | Confirmed defect |
| Model loading alone | Prompt DOM exists while outer overlay remains transparent | Does not explain parent visibility gate |
| Core cleanup alone | Initial isolated probe measured 11 ms cleanup | Does not explain that probe's four-second visibility wait; now runs inside loading UI |
| Measurement error | Child visibility ignores transparent ancestor | Confirmed; corrected instrument checks the parent |
| Slow lightweight entry delivery | Entry must load before it can mount | Still a network-dependent boundary |

The reproduction matches the user's reported delay category and duration. The
user's exact browser timing was not independently captured. A refreshed live click
is the remaining device-specific check. No microphone access is needed to check
when this modal first appears.

An independent read-only reviewer confirmed the missing-reporter finding, request
binding ownership, and resize behavior during enrollment. Existing abort checks and
lock-generation-bound session installation remain in place.

## Repeatable browser checks

The unlock contract injects four-second delays into the implementation module and
inference runtime. It checks the painted parent modal, disabled recording, progress
inside the card, prompt cancellation, and no microphone or challenge after cancelled
implementation loading. It then completes real browser voice verification, session
installation, and NEAR signing against deterministic chain responses.

With the existing local Wallet service environment variables:

```sh
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/voiceid.unlock-near.contract.test.ts \
  e2e/intended-behaviours/voiceid.live-page.contract.test.ts \
  e2e/intended-behaviours/passkey.voiceid-near.contract.test.ts
```

Reports and screenshots accompany this record. Synthetic audio tests preserve the
existing signing and voice checks; they do not establish population voice accuracy.


All three composed browser contracts passed. SDK, intended-flow, Wallet-state,
and browser-test type checks passed. The SDK build and bloat check passed.

With implementation delivery held for four seconds, the painted modal appeared in 390 ms and cancellation completed in 45 ms.
With inference-runtime delivery held for four seconds, it appeared in 114 ms and remained visible until ready at 4687 ms.

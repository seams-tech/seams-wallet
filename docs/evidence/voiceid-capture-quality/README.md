# VoiceID capture-quality feedback

Rejected audio now stays in the unlock prompt with an explicit result and Try again.
The prompt provides a fresh phrase and retains the original server challenge and
expiry timer. Cancellation, expiry, and other errors remain terminal. Enrollment
also reports the measured failure. A signing rejection retains the existing review
retry policy. Phrase and speaker checks and all recording thresholds are unchanged.

## Facts

| Fact | Instrument | Scope | Check |
| --- | --- | --- | --- |
| The user sees the clear-speech rejection and a disabled transfer button | User screenshot and exact error text | Live Wallet | Supplied twice, including after a slower-reading suggestion |
| The old rejection occurs before phrase/speaker inference and session verification | Capture and unlock call path | Browser plugin | Independently reviewed |
| The gate requires 2 seconds of 10 ms frames at RMS >= 0.006 | Capture implementation | Same deployed policy | Preserved by this change |
| Short and quiet synthetic clips both fail this gate with different measurements | Real browser recording, decoding, and quality scan | Automated controls | Short clip has above-threshold frames; attenuated clip has none |
| Rejected attempts send no session-verification request | Request observer | Automated unlock journey | Counts checked before the successful third attempt |
| All three attempts use one challenge, and valid audio unlocks and signs | Request observer and NEAR contract | Automated control | JSON evidence supplied below |

## Causes and limits

| Candidate | Existing evidence | Status |
| --- | --- | --- |
| Successful unlock was later lost | Latest live attempt reports an unlock-quality failure | Not established for the earlier report |
| Phrase or speaker mismatch caused this error | Quality rejection precedes both checks | Excluded for this error |
| Server signing or NEAR broadcast failed | This attempt stopped before new session verification | Excluded for this error |
| Insufficient audible duration, low volume, suppression, or another input | Each can produce too few qualifying frames | Unresolved for the user's microphone |
| Meter movement was mistaken for approval | Meter observes amplitude while recognition is still pending | Movement alone cannot establish approval |
| Measurement was stale | Old failures discarded all quality statistics | New measurements carry unique attempt IDs and timestamps |

The controls reproduce the rejection category. Parity with the user's microphone
conditions is not established. The next needed observation is the live Recording
details output. It contains input label, decoded audio duration, qualifying duration,
and maximum frame RMS. These values do not generally distinguish brief speech from
quiet or suppressed speech. No user recording has been retained or inspected.

The earlier statement that a successful unlock was not retained was not established
by the screenshots. The subsequent exact error establishes a failed unlock attempt.
An independent review also caught rounding that could display rejected 1.99 seconds
as 2.0 seconds. The UI now uses two decimal places.

## Validation and artifacts

The composed browser contracts use synthetic audio through MediaRecorder, real B1
and Aurora inference, and local Wallet session and Ed25519 Yao signing services.
NEAR RPC responses are deterministic. The short and quiet recordings do not reach
session verification. A valid third recording unlocks and signs under one challenge.
SDK and intended-flow type checks pass. Capture-state type fixtures and bloat checks
also pass. The build includes the new prompt behavior on the existing live page.

- `voiceid-unlock-near.json`: capture metrics and unlock/signing evidence.
- `voiceid-live-page.json`: enrollment, mismatch retry, cancellation, and signing.
- `voiceid-browser-broadcast-failure.json`: signature reuse across broadcast retries.
- `voiceid-quality-retry.png`: measured rejection inside the prompt.

Reproduce with the existing local Wallet service variables:

```sh
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/voiceid.unlock-near.contract.test.ts \
  e2e/intended-behaviours/voiceid.live-page.contract.test.ts \
  e2e/intended-behaviours/passkey.voiceid-near.contract.test.ts
```

The synthetic quality fixtures derive from the tracked Aurora `0.wav`. Exact
regeneration commands are in `tests/scripts/voiceid-aurora/README.md`.

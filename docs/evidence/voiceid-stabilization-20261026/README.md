# VoiceID stabilization checkpoint — 2026-10-26

Status: not stabilized for live use yet. The user reported approximately five
successes and three failures after the requested quiet-room, normal-paced baseline.
This is a self-report of roughly 63% success, not a controlled accuracy estimate.
The failure-stage breakdown and capture measurements are still missing.

## Changes

- Speaker mismatch guidance recommends moving closer only when the measured noise
  estimate is high. Quiet/unknown cases request a natural retry.
- Unlock and signing use the same speaker-rejection guidance.
- Recording details and local diagnostics include the duration of the actual
  cropped PCM sent to the speaker model, separate from recording and speech time.
- The obsolete volume-only tone capture test was retired. It incorrectly treated
  an oscillator as positive speech after VAD replaced the RMS-only classifier.

No thresholds, models, enrollment, or audio processing changed. Speaker threshold
remains 0.5 and phrase gap limit remains 8.

## Checks

- Live-page and noise contracts passed: 2 tests, 2.0 minutes. They cover retries,
  wrong-speaker/phrase rejection, startup cancellation, noisy capture, unlock, and
  signing. The speaker rejection details now include model input duration.
- Visual contract passed: listening, processing, retry, reduced motion, light theme,
  cleanup, and strict style CSP.
- Review-admission browser contract passed: missing/stale approval cannot authorize
  signing, and operation identity remains bound to the approval.
- SDK build, SDK/intended-test type checks, and bloat checks passed.

Browser audio is synthetic and NEAR RPC is deterministic. These checks do not
supersede the user's live failure report. Raw user audio was not recorded or saved
by this work.

## Next live evidence

Obtain one failed attempt's Recording details: speaker similarity and threshold,
model input duration, detected speech, microphone settings, noise estimate, and
phrase outcome. The user was asked for one failure, without another batch or
re-enrollment. Fix the demonstrated quiet-room failure before requesting café
qualification or starting EVM support. Do not lower thresholds from success counts
alone. Follow with a user-confirmed reviewed testnet transfer once unlock is
repeatable at normal pace.

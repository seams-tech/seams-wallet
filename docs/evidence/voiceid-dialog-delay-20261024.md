# VoiceID modal preparation delay — 2026-10-24

The capture modal now mounts before asynchronous plugin preparation. It keeps
recording disabled until preparation succeeds and allows cancellation throughout.
The shared prompt is “My voice unlocks my wallet.” Users speak slowly for about
three seconds. Recording limits, B1 model identity, and voice templates are unchanged.

## Facts

| Observation | Instrument and scope |
| --- | --- |
| User reported roughly five seconds before enrollment/unlock modals appear | User clarification; no trace of that exact event |
| A repeat live unlock opening took 352 ms | CUA wall-clock observation, including tool overhead, existing warm page |
| Old unlock code awaited local validation, model preparation, and server challenge before mounting the capture surface | Source at 1c2420b1 |
| Old activation code awaited owner/session preparation before mounting | Same source revision |
| A five-second injected challenge delay produced a 5893.5 ms modal delay | Isolated browser E2E against the prior built SDK |
| Updated modal appeared in 14.1 ms with the five-second injected delay still present | Updated browser E2E |
| Updated activation modal appeared in 109.7 ms | Same E2E, initial plugin activation |

## Cause table

| Candidate | Evidence | Conclusion |
| --- | --- | --- |
| A fixed five-second delay on every open | Warm live open completed in 352 ms | Excluded as a universal explanation |
| Preparation awaited before modal construction | Source ordering and controlled delayed-challenge reproduction | Confirmed avoidable display delay |
| Model download or initialization caused the user's exact delay | No trace captured for that event | Unresolved |
| Cold plugin/core initialization caused the user's exact delay | Plugin loading and lockCore still precede plugin.unlock | Unresolved |

The reproduction establishes the delayed-challenge path. It does not establish
parity with the exact cause of the user's earlier event. No claim is made that
all cold SDK initialization now completes in 14 ms.

The new preparation lifecycle preserves the click that starts microphone capture.
Cancel aborts the challenge request and prevents later UI or capture. Shared model
loading can continue and populate the cache after the surface closes. Expiry starts
from the server challenge deadline, and expired challenges cannot enable recording.

## Validation

The baseline test failed the modal-responsiveness assertion with 5893.5 ms. This
was classified as production_regression: an actual UI behavior defect, not an
obsolete fixture. Both updated E2Es passed. They cover download progress, cache
reuse, owner re-enrollment, preparation cancellation, late responses, concurrent
lock during unlock, speaker mismatch/retry, and real MPC signing with deterministic
NEAR RPC. Type checks and bloat checks also passed.

An independent reviewer found no production blocker. The reviewer requested that
the timing probe observe modal visibility before awaiting the upstream response;
the test now does so. The reviewer also confirmed that cancellation does not stop
shared model loading and that the original untraced delay remains uncertain.

Evidence: [unlock and timing](voiceid-dialog-unlock-20261024.json),
[full enrollment/cache/signing journey](voiceid-dialog-live-page-20261024.json).
The updated timing case is in
[voiceid.unlock-near.contract.test.ts](../../tests/e2e/intended-behaviours/voiceid.unlock-near.contract.test.ts).

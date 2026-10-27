# Browser VoiceID transfer mismatch — 2026-10-24

The user completed real enrollment and VoiceID unlock. Transfer approval then
reported a speaker mismatch. The application incorrectly displayed cancellation.
The fix keeps a mismatched review open and requires another Confirm click.

## Facts

| Fact | Instrument and scope |
| --- | --- |
| Three samples and VoiceID unlock succeeded | User report and live Chrome page, wallet misty-reef-hv6mdb |
| Transfer approval reported a speaker mismatch | User screenshot of Chrome console |
| Application displayed Request cancelled | Same screenshot and live DOM |
| Unlock and signing call the same verification function | browser/enrollment.ts and capture call sites |
| Verification allowed five seconds, enrollment eight | Prior microphone.ts at 5fe4b70d |
| Failed approval was published as cancellation | Prior ConfirmationDecisionQueue.approve catch path |

## Causes checked

| Candidate | Evidence | Status |
| --- | --- | --- |
| Missing enrollment or device credential | Real voice unlock succeeded | Excluded for this attempt |
| NEAR RPC or MPC failure caused this error | Voice mismatch occurred before approval consumption and signing | Excluded for this error |
| Failure-to-cancellation conversion | ConfirmationDecisionQueue called cancel for a mismatch exception | Confirmed |
| Short or inconsistent speech, different microphone, or threshold calibration | No capture measurements retained for that attempt | Unknown |

The capture now allows eight seconds and requires two seconds of voiced audio
for both enrollment and verification. Both display the same sentence. This is
a consistency improvement, not proof of the human mismatch cause. The threshold
remains 0.6. The last verification exposes microphone, duration, voiced duration,
similarity, and threshold in the local Wallet DOM. It exposes no audio or template.

## Validation

The repeatable [E2E artifact](voiceid-browser-mismatch-retry-20261024.json)
records a different synthetic voice rejected at similarity -0.00128. It records
no signature or broadcast for that mismatch. An explicit retry with the enrolled
synthetic voice then completes real Yao MPC signing against deterministic NEAR RPC.
The test also covers enrollment cancellation and fresh VoiceID unlock.
All 21 selected confirmation and VoiceID policy browser checks passed.
Wallet and intended/state type checks, SDK build, and bloat checks passed.

The reproduction matches the mismatch/retry UI path. Parity with the cause of
the human mismatch is not established. A further live attempt and its local
capture measurements are needed. No live transfer success is claimed here.
An independent review found no actionable cancellation, deadline, or state issue.

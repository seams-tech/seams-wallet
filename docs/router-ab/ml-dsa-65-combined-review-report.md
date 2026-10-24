# Combined signer selection and transaction review

Date: 2026-10-24. Base: `5fd3d870`.

Multi-key NEAR signing now uses one semantic transaction approval with the key selector inside it.
The host snapshots wallet/account subjects, actions, receiver, signer slot, and requested ML-DSA session policy before awaiting the user.
A host-only, single-use receipt binds the chosen key and those inputs. A mismatch consumes the receipt and fails.
The receipt does not cross the iframe boundary or grant signing authority.

After this review, the existing confirmation path omits its duplicate semantic click.
Passkey authentication, Email OTP code entry, and platform-required activation still apply.
Explicit-key and single-key requests retain their ordinary review.
The saved default remains unchanged by a transaction-specific choice.

Optional signing-session consent describes the maximum operation count and rounded-up duration in seconds.
A source review found that flooring minutes understated non-integral durations. The corrected browser scenario uses 600,001 ms and checks a 601-second maximum.
The same review moved policy validation ahead of mounting the UI.

## Validation

SDK/server type checks and receipt type fixtures pass.
The browser contract clicks Approve transaction once and awaits the signature without an auto-confirm loop.
The full lifecycle passes: normal Ed25519 signing, default persistence, ML-DSA signing, full-owner linking, recovery, standard FIPS seed import, restoration, revocation, and a finalized NEAR testnet transaction.

- [Public lifecycle evidence](../evidence/ml-dsa-combined-review-20261024.json)
- [Combined review screenshot](../evidence/ml-dsa-combined-review-20261024.png)
- [Discovery request timings](../evidence/ml-dsa-discovery-requests-20261024.json)

This qualifies Chromium with local workerd services and live testnet. It does not establish hosted latency or one physical interaction on every platform.
Wallet-seed recovery, FIPS export, two-at-once consumption, and pool capacity remain unchanged.
Authentication and device-linking parity work continues separately.

## Failed runs and limits

Raw runs remain under `/private/tmp/ml-dsa-combined-approval-20261024`.

1. Attempt 1 timed out after 15 seconds while Signing keys was loading, before combined review. The exact awaited step was not recorded. No production timeout change was made.
2. Attempt 2 failed before the feature at the testnet faucet's hourly limit. This is an infrastructure failure.
3. Attempt 3 reused the existing disposable test sponsor, funded the synthetic wallet with 0.1 test NEAR, and passed the complete lifecycle. It retained request timing without headers, credentials, or RPC params.

The first loading timeout did not recur. Its cause remains unknown. A recurrence needs per-await timings for metadata, preference reads, codec initialization, finalized access-key RPC, and component cleanup.

| Fact | Instrument | Scope |
| --- | --- | --- |
| Publication metadata returned before the loading timeout. | Browser scenario progression | Attempt 1 |
| Settings remained in Loading signing keys. | Playwright failure snapshot | Attempt 1 |
| Discovery and single-click semantic approval completed. | Request trace and browser assertions | Attempt 3 |

| Cause | Evidence | Status |
| --- | --- | --- |
| Universal metadata or combined-review failure | Contradicted by attempt 3; attempt 1 never reached approval. | Rejected. |
| Transient RPC, codec, preference, or component-lifecycle delay | Attempt 1 lacks per-await timing. | Unresolved. |
| Faucet availability | HTTP 429 explicitly names the hourly limit in attempt 2. | Confirmed infrastructure failure for that attempt only. |

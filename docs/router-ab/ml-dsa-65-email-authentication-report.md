# ML-DSA Email OTP signing and combined approval

Date: 2026-10-25 JST. Base: `0e0fa582` on `ml-dsa`.

The SDK now supports ML-DSA signing through the selected full-owner Email OTP method. Signer metadata and saved defaults use the same method-neutral owner check. The combined signer selector and transaction approval remain in the preceding checkpoint.

## Authorization behavior

- The request names a precise Passkey or Email OTP actor. The Gateway resolves the Email OTP provider identity from its enrollment, then checks the exact primary session and method.
- A fresh code binds to the full transaction challenge. Session creation binds to the transaction, key, operation limit, expiry, token digest, origin, and publication version.
- OTP consumption and durable approval commit in one D1 transaction. A failed commit leaves the code available for an exact retry. The signing journal stores proof metadata and a digest, never the OTP code.
- The client cache includes the exact actor. Warm signing retains the existing budget, publication, epoch, and revocation checks.
- Pending Passkey records normalize at the persistence boundary. Core requests use the new exclusive actor union.
- ML-DSA execution remains lazy-loaded. Wallet-seed recovery, standard FIPS export, two-at-once consumption, and pool capacity remain unchanged.

## Validation

SDK, Gateway, intended-app, and wallet domain-type checks pass. Seven cancellation, deadline, and nonce-settlement scenarios pass.

The focused browser contract passed fresh OTP signing, session creation, warm signing, wrong-operation proof rejection, and completed-result replay. It blocks Passkey fallback. Node independently verifies every resulting ML-DSA signature.

The final fault-injection run passed in 3.2 minutes. It forced D1 approval writes to fail, then successfully retried the same OTP proof for both fresh signing and session creation. The observed authorization kinds were fresh Email OTP, Email OTP session start, and warm session.

- [Authentication and rollback evidence](../evidence/ml-dsa-email-authentication-20261025.json)
- [Seven cancellation receipts](../evidence/ml-dsa-authentication-cancellation-20261025.json)

The focused contract uses real local Gateway/D1/Router/A/B services and a real Google test identity with the local OTP outbox. NEAR RPC responses are controlled. It makes no hosted-performance or on-chain qualification claim.

Repeat with the normal intended-test runner and a configured Google test identity:

```sh
pnpm -C tests test:intended -- e2e/intended-behaviours/ml-dsa.authentication.contract.test.ts
```

The complete live-testnet recovery/linking repeat did not finish. Earlier checkpoint `0e0fa582` has a successful complete lifecycle. During this change, current Passkey signing, fresh Email signing, and grant creation passed in the full scenario. The later repeat was stopped by test identity lifetime and funding limits. Recovery, FIPS export, and linked-device signing behavior were not changed here.

## Failures and diagnosis

Runs remain under `/private/tmp/ml-dsa-email-approval-20261024` and `/private/tmp/ml-dsa-email-auth-local-20261024`.

| Observation | Evidence | Classification and correction |
| --- | --- | --- |
| Registration stopped before the feature because the SDK omitted its local relayer-origin policy. | Full attempt 1 | Environment failure. Rebuilt with the required test origin. |
| Email enrollment lacked a Google test identity. | Full attempt 2 | Environment failure. Reused the configured test service account. |
| The Email confirmation renderer reported `missing_email_challenge`. | Full attempt 3 | Production regression in the new integration. Put the prompt in its canonical auth-plan field and require it in the type. |
| Warm signing waited until the 60-second RPC timeout. Its operation remained awaiting approval; the grant retained one use. | Full attempt 4 and read-only D1 state | Test fixture defect. A completed Email unlock left a stale action label that suppressed the transaction click. Use the action label only while its state is running. |
| Faucet cooldown, then insufficient prepaid funding cost, then near-expiry test identity interrupted later full runs. | Full attempts 5–7 | Environment failures. No limits or production timeouts were relaxed. |
| The cancellation fixture lacked the new signer-selection method. | Initial cancellation run | Valid test needed an update. Added the missing surface method. The retry control and all seven scenarios then passed. |

| Candidate cause of the warm-signing timeout | Facts | Conclusion |
| --- | --- | --- |
| Pool or private protocol wait | The warm operation never reached durable approval. | Rejected for this timeout. |
| OTP or grant creation failure | Fresh signing completed; the grant was active with one use left. | Rejected. |
| Stale test-driver unlock action | Completed unlock action remained selected; its Google-only branch skipped the confirmation button. | Supported by source and D1 evidence. The corrected focused browser test completed warm signing. |

The source review also found an initial consume-before-commit retry gap. The implementation now uses the existing deferred-consumption verifier. This is a focused review, not a complete security audit.

## Remaining integration

Full-owner device parity is approved and recorded in the investigation plan. It still requires exact ML-DSA activation in the central signer manifest, encrypted transfer of a key-specific owner root, target-factor sealing, and full-owner export/restoration support. ML-DSA-only linking must not depend on Ed25519 activation. Email OTP export and participant restoration also remain open.

The bloat check still fails on inherited Rust duplication: 13,972 lines against 13,754. This checkpoint changes no Rust code. TypeScript duplication remains 10,065 against 10,216. The baseline is unchanged.

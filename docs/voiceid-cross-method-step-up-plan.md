# Cross-method transaction approval

Status: deferred. Written 2026-10-26. This document plans future work; it does not change current behavior.

## Goal and size

Allow an owner to unlock with a passkey and explicitly choose VoiceID to approve a reviewed NEAR testnet transfer. Keep the original session, selected authority, signer, permissions, expiry, and remaining-use accounting.

This is a medium-sized authentication refactor for the first supported path. It spans trusted Wallet policy, plugin approval, review state, and signing admission. General support for every authentication method and operation is a larger project. The amount of server work depends on the operation-authorization trace described below. It is not a UI-only change or a Wallet rewrite.

## Current coupling

| Boundary | Current behavior | Relevant source |
| --- | --- | --- |
| Review policy | Loads VoiceID approval only when the requested wallet's selected auth method is VoiceID. | `packages/wallet/src/SeamsWeb/walletIframe/host/runtimeContext.ts`, `walletAuthMethodReviewPolicy` |
| Plugin contract | Provides unlock, activation, and one required-or-disabled review policy. It does not express independently selected operation methods. | `packages/wallet/src/core/authMethods/hostPlugin.ts` |
| Review admission | Requires VoiceID signing material and a required plugin policy to agree. This prevents a method switch from bypassing review. | `packages/wallet/src/core/signingEngine/uiConfirm/transactionReviewAdmission.ts`, `assertAuthMethodPolicy` |
| NEAR material preparation | Checks the actual signing-lane auth method against captured review admission. | `packages/wallet/src/core/signingEngine/flows/signNear/signNear.ts`, `prepareReviewBoundNearMaterial` |
| Core step-up | Selects warm-session, passkey, or Email OTP preparation through the signing lane and policy. | `packages/wallet/src/core/signingEngine/stepUpConfirmation/{requireStepUpAuth,methodSelection,types}.ts` |
| Voice approval | Verifies locally and consumes an approval bound to the reviewed request and deadline. Scope is one NEAR testnet transfer. | `packages/wallet/src/plugins/voiceid/capture/{approval,bridge}.ts` |

The current intended-behavior specification also contains same-method step-up requirements. They must be changed alongside implementation and contract tests, never weakened incidentally.

## First release

Support this explicit combination:

1. The owner has a valid passkey-authenticated Wallet Session.
2. VoiceID is enrolled and enabled for the same wallet and selected local authority.
3. Trusted Wallet policy permits VoiceID approval for a reviewed NEAR testnet transfer.
4. The owner selects VoiceID inside the transaction review.
5. Successful voice and phrase checks authorize that reviewed operation once.
6. Signing uses the existing passkey session and its permitted signing material.

Retain normal passkey approval and existing VoiceID-unlocked behavior. Do not extend this release to Email OTP combinations, EVM-family chains, NEP-413, delegate actions, batches, key export, recovery, factor removal, or device linking. Those need separate policy and proof reviews.

## Authorization distinction to resolve before coding

Trace a warm-session transfer and a transfer requiring fresh server step-up, from review to the final signing boundary.

- A local VoiceID confirmation can gate an operation that the server already authorizes under the existing session.
- A local confirmation cannot replace fresh passkey proof that the server requires.
- If the requested path needs fresh server authorization, add or extend an operation-bound VoiceID device assertion through the existing step-up machinery. Verify the enrollment and permitted method relationship server-side. Do not reuse the VoiceID unlock endpoint to mint a replacement session.
- A device assertion proves use of the enrolled browser-held credential. Speaker and phrase verification still rely on trusted Wallet code; this does not add hardware attestation or server-side biometric verification.

The intended end state is policy-authorized cross-method operation approval. A warm-session-only confirmation shortcut must be labeled and scoped explicitly if shipped as an intermediate milestone. It must not be presented as complete server step-up support.

## Implementation sequence

### 1. Trace authorization and define the contract

Map every check for session authentication, review approval, signer readiness, and fresh server proof. Record which existing capabilities can be reused. Resolve the server-authorization distinction above before editing admission checks.

Define a narrow Wallet-owned eligibility policy for the first combination. The embedding app may request the transaction and advertise plugin availability. It cannot provide trusted eligibility, assert approval, or silently select an alternative method.

Deliverable: an updated intended-behavior contract and one composed test design covering passkey unlock followed by VoiceID transaction approval.

### 2. Separate session identity from operation approval

Represent these as distinct required values:

- The existing session and signing identity.
- The eligible methods for this operation.
- The explicitly selected operation-approval method and enrollment identity.
- The one-use approval, its request binding, expiry, and consumed/cancelled state.

Use discriminated unions, branch-specific builders, and exhaustive handling. Make pending, approved, consumed, and cancelled states exclusive. Parse external requests and stored selections at boundaries. Do not let diagnostics control authorization.

Bind approval to the wallet, selected authority, session/generation, method identity, complete transaction and execution configuration, review identity, and deadline. Keep existing canonical request binding where it already supplies these guarantees. Verify the final binding at the signing boundary.

Replace the current same-method boolean comparison with explicit checks for both identities. Keep the protections that comparison currently provides. Do not merely remove it or mark a passkey lane as VoiceID.

Deliverable: typed approval plumbing plus type fixtures for wrong-wallet, wrong-authority, stale-session, and invalid lifecycle combinations.

### 3. Add trusted method selection and plugin execution

Expose eligible methods in the transaction review, with passkey as the default for a passkey session. Show VoiceID only when enrolled, enabled, supported, and permitted by policy. Discover availability without loading voice models.

Selecting VoiceID loads the plugin and opens the existing minimal prompt. Capture starts only after explicit approval. Preserve the reviewed transaction during local retries and keep its deadline. A method change cancels any in-flight capture and invalidates the previous attempt.

A rejected or cancelled voice attempt must not automatically fall back to passkey or Email OTP. The user must choose another method explicitly. After completion, the session still reports passkey authentication.

Deliverable: the reviewed transfer can complete with either permitted method, with clear cancellation and retry behavior.

### 4. Integrate server proof where required and enforce final admission

Reuse the existing operation credential, replay protection, and budget rules. If new cross-method proof is needed, include the original session identity and the explicitly allowed VoiceID method identity in its verified scope. Resolve eligibility from authoritative records, not caller labels.

Reject a disabled, revoked, different-wallet, or different-authority method. Define whether remote revocation is checked at preparation, consumption, or both, consistent with the existing authorization contract.

Recheck lock generation, session validity, review expiry, transaction integrity, and one-use approval at signing. Preserve current use-claim semantics on cancellation and failure. Do not create extra quota, renew expiry, switch lanes, reopen custody, or mutate the selected login method as a side effect.

Deliverable: the supported flow works without bypassing an existing server or credential requirement.

### 5. Verify and remove replaced paths

Use browser E2E tests and required type fixtures. Do not add unit or source-text snapshot tests.

Required scenarios:

- Passkey unlock → explicit VoiceID approval → verified NEAR signature; the session remains passkey-authenticated.
- Passkey-only approval performs no VoiceID runtime or model requests.
- Enrollment alone does not make VoiceID the selected transaction method.
- Wrong phrase, wrong speaker, cancellation, and expiry never reach the signing boundary.
- A transaction, wallet, authority, session, or generation change invalidates approval.
- Locking or disabling VoiceID during capture prevents signing.
- Method switching, duplicate callbacks, replay, and double-clicks cannot reuse approval or produce a second signature.
- Existing VoiceID-session signing continues to work.
- Unsupported operations remain rejected; sensitive settings retain their required authentication rules.
- Budget and permission checks remain effective even after successful voice verification.

Produce repeatable JSON evidence, signed-transaction verification, and screenshots of method selection and capture. State whether chain execution was deterministic or live. A live testnet transfer remains user-confirmed.

Delete replaced selection paths in the same change. Update the specification, plugin documentation, and any wire protocol version only when the corresponding behavior changes. Run the narrow E2E contracts, relevant type checks, static asset checks, and bloat check.

## Main risks

- Confusing a local confirmation with fresh server authorization.
- Reusing an approval after changing the transaction or session.
- Switching custody/signing identity while the UI still displays the original session.
- Making every configured plugin eligible, or loading models while merely displaying settings.
- Treating a successful voice match as permission to bypass session budgets or operation policy.

Voice recognition reliability remains a separate qualification issue. This refactor must preserve the current speaker and phrase thresholds. Changes to those thresholds, the supported operation scope, or the default method require explicit decisions.

## Completion criteria

The first release is complete when a passkey session can authorize the supported transfer through explicitly selected VoiceID, with the original session identity intact and the required server proof satisfied. All rejection, race, replay, lazy-loading, and budget cases above must pass.

No implementation is authorized by this planning document. Resume implementation when the user requests it.

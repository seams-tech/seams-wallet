# Refactor 190B — VoiceID EVM unlock and transfer

Status: implemented and composed browser contracts pass. Live Arc settlement remains a manual acceptance step. Authorized 2026-10-26.

## First supported behavior

An owner with an active local VoiceID method and an existing ECDSA signer can unlock
that wallet with VoiceID, review a native-token transfer on one configured EVM
testnet (Arc, chain ID 5042002), approve it with a fresh voice capture, and produce a verifiable transaction.
The recovered signer address must equal the existing wallet address.

Speaker verification remains ReDimNet B1 at 0.5. Aurora and the bounded phrase rule
remain unchanged. No new voice model download or voice enrollment is required.
Cross-method approval remains deferred: the selected session must itself be VoiceID.

## Authorization trace

Paths below are relative to the repository root.

| Boundary | Starting point | Implemented behavior |
| --- | --- | --- |
| VoiceID challenge | `packages/wallet-server/src/router/cloudflare/d1/wallet/d1VoiceIdSessions.ts` resolves an active full-owner authority, active device method, and its sealed seed envelope. | Preserve exact wallet, method, origin, authority, and challenge binding. |
| Session issuance | The same service verifies and consumes the device assertion, then calls `issueDirectWalletSessionAuthorizationV2` with the authoritative Wallet authority and normal expiry/use policy. | Resolve the issued session's ECDSA capability subject. Do not create an unrelated signing identity or enlarge its permissions. |
| Verification response | `walletVoiceIdSessions.ts` calls `walletVoiceIdNear.ts`. The browser parser in `plugins/voiceid/session/httpClient.ts` accepts only the NEAR installation descriptor. | No extra response descriptor is needed: the issued session already carries the exact ECDSA material subject, and local continuity carries its public facts. |
| Custody installation | `core/authMethods/prepareNearSession.ts` opens cached Ed25519 material. `BrowserSigningSurface.installAuthMethodNearSession` publishes only a NEAR lane. | The shared installer validates identity once, opens the seed envelope, and installs existing NEAR and ECDSA material. ECDSA-only wallets can unlock. |
| ECDSA restore primitives | `BrowserSigningSurface.restoreWalletCustodyEcdsaContinuity` imports continuity and opens role-local material. `threshold/ecdsa/postRegistrationSessionActivation.ts` validates capability and public-fact consistency for session activation. | Use `copyWalletCustodyEcdsaContinuityToAuthMethod` after the seed envelope opens, then open the method-bound worker material. The existing direct-capability runtime pairs it with live session status. No ECDSA session activation request is needed. |
| Lane identity | `session/identity/exactSigningLaneIdentity.ts` excludes VoiceID from ECDSA identities and rejects it at parsing. | VoiceID has a direct ECDSA session runtime with its own method/device authority. Type fixtures reject mixed passkey fields, VoiceID sealed sessions, and VoiceID key export. |
| Signing preparation | `flows/signEvmFamily/authPlanning.ts` rejects VoiceID operation step-up. Generic `stepUpConfirmation/methodSelection.ts` directs VoiceID users to unlock again. | Support the authorized VoiceID-session path. Expired/exhausted sessions must require a fresh VoiceID unlock, not silently fall back to another method. |
| Review approval | `plugins/voiceid/capture/approval.ts` permits only a reviewed NEAR testnet transfer; it rejects `PM_SIGN_TEMPO`, the EVM-family signing envelope. | A bounded Arc native-transfer branch validates the configured network and exact transaction shape. Request hashing supports bigint fields and freezes the complete request. |
| Final admission | `uiConfirm/transactionReviewAdmission.ts` requires the lane method to agree with required VoiceID policy. | ECDSA checks the prepared authentication method against the review policy, then consumes voice approval at the existing final signature boundary. |

The existing device assertion proves possession of the enrolled browser credential.
Trusted Wallet code performs speaker and phrase matching. No biometric claim is
added to server verification by this work.

## Acceptance contract

- VoiceID unlock selects the same wallet, authority, ECDSA key slot, and address.
- Session installation validates capability subjects, material activation, authority
  digest, method/device identity, lock generation, and server authorization.
- No signing root derives from another signing root. Existing custody primitives
  remain responsible for opening the wallet custody seed and restoring its ECDSA material.
- One reviewed native transfer is supported initially. Chain ID, recipient, value,
  calldata, nonce, fees, wallet, session, and review deadline remain bound to approval.
- The first supported network must be an explicitly allowed configured EVM testnet.
  Mainnet, token transfers, contract calls, batches, personal messages, and typed-data
  signatures remain rejected by this initial VoiceID policy.
- Wrong speaker, out-of-bounds phrase, cancellation, expired review/session, wallet
  lock, revocation, method change, and modified transaction prevent signing.
- An approval cannot be replayed, consumed twice, or applied to another chain/wallet.
- Voice matching cannot bypass ECDSA permissions, session budgets, or use claims.
- Passkey and Email OTP paths retain their current behavior and lazy voice loading.
- NEAR VoiceID unlock and signing continue to work.

## Validation and remaining decisions

The trace confirms direct-capability signing uses the existing operation credential
and original quota. The session does not need an additional activation or mint.
The demo configures Tempo 42431 and Arc 5042002. The first supported transfer uses
Arc's existing EIP-1559 flow. Tempo remains outside this initial approval policy.

The local manifest capability ID can differ from the server material capability ID.
Copy selection compares the complete material activation and active authority
membership. It does not equate those two capability identifiers.

Use composed browser contracts and type fixtures. Verify serialized transaction
fields and recover its sender from the signature. Exercise rejection and lifecycle
cases above, with repeatable JSON evidence. Finish with an explicit live testnet
self-transfer and verify its chain receipt. Deterministic RPC tests and live chain
execution must be labeled separately.

Before the next SDK release, remove the user-facing **Recording details** expander
and its technical diagnostic text from VoiceID prompts. Keep it during the current
debugging work. Released prompts retain concise failure guidance and retry controls.
Update browser checks to verify that the expander is absent from released UI.

## Results

See [repeatable evidence](evidence/voiceid-evm-20261026/README.md). Both ECDSA-only and existing-NEAR enrollment journeys passed. The latter adds ECDSA without replacing voice enrollment, signs Arc, and signs NEAR afterward. Both reject a cancelled second Arc transfer.

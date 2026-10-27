# VoiceID Arc acceptance evidence — 2026-10-26

Both composed browser journeys passed with speaker threshold **0.5** and the existing
ReDimNet B1 and Aurora models. No new model was added. The capture fixture plays
natural-paced synthetic speech through browser audio; matching uses the real models.
Signing uses the local ECDSA MPC services. Arc RPC replies are deterministic fixtures.
These artifacts do not establish live Arc settlement or production biometric accuracy.

- `ecdsa-only.json`: register an ECDSA-only wallet, enroll VoiceID, lock, unlock with
  VoiceID, and sign a native Arc self-transfer. Recover the original wallet address
  from the serialized transaction. Cancel a second review and observe no second broadcast.
- `add-ecdsa-after-voice.json`: enroll VoiceID on a NEAR-only wallet, add ECDSA with
  the owner passkey, and perform the same Arc journey without re-enrollment. Then
  verify a NEAR transfer signed with VoiceID.
- `review-policy.json`: the browser review gate rejects mainnet, a mismatched chain,
  calldata, contract creation, access lists, and missing review metadata. A permitted
  request is frozen and cannot be consumed without current voice approval.

- `method-selection.json`: passkey signing avoids voice downloads, explicit VoiceID
  unlock selects voice approval, and a fresh passkey unlock returns to passkey signing.
  The test audio fixture ignores inactive transition cards when selecting its phrase.

The JSON files are copied unchanged from Playwright output. They include signed
transaction bytes, sender recovery, chain ID, recipient, value, and nonce.

## Repeat

Build the SDK with the local relayer origins enabled, then run:

```sh
SEAMS_INTENDED_APP_URL=http://localhost:4320 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:4313 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:4600 \
SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID=local-smoke-project:dev \
SEAMS_INTENDED_PUBLISHABLE_KEY=pk_local \
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/voiceid.unlock-arc.contract.test.ts

SEAMS_TEST_FRONTEND_URL=http://localhost:4356 \
pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts \
  wallet-ui/voiceid-approval.browser.test.ts --project=chromium
```

## Diagnosis record

| Fact | Instrument | Result |
| --- | --- | --- |
| A local manifest capability can differ from its server material capability. | Initial unlock diagnostic and persisted-manifest source review | Full material activation comparison selects the existing signer correctly. |
| A remaining ECDSA candidate filter accepted only passkey and Email OTP. | Signing-boundary diagnostic and source inspection | Adding the exact VoiceID branch allows review preparation. |
| The second-review cancellation control is named Cancel. | Confirmation component and browser journey | Correcting the new test's Close locator prevents its worker timeout. |
| Both wallet profiles produce valid ECDSA signatures for their original address. | Serialized transaction decoding and sender recovery in the Arc RPC fixture | Both composed journeys pass. |

| Candidate cause | Evidence | Disposition |
| --- | --- | --- |
| Missing source ECDSA material | An active same-authority source existed with the exact material activation. | Eliminated. The initial new lookup compared different identifier domains. |
| VoiceID absent from ECDSA discovery | The filter dropped the VoiceID projection. | Fixed without changing session permissions or quota. |
| Signature failure caused the final timeout | The first transfer and signature assertions passed before the cancellation step. | Eliminated. The test used the wrong cancellation label. |
| The NEAR control played a phrase from a retiring card | Its synthetic audio fixture selected the first phrase in the DOM, including inert cards. | Fixed the fixture to read the active card. The repeated control passed. |
| A new model or lower speaker threshold was needed | Both journeys passed with the existing models and 0.5 threshold. | No model or threshold change. |

An independent source review found no concrete binding or authorization defect.
It did not reproduce revocation, expiry, quota races, or live Arc settlement.

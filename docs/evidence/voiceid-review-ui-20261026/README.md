# Transaction review and receipt UI — 2026-10-26

The Arc VoiceID browser journey passed after these changes:

- Opening the admitted review focuses its surface. The Back button has no opening
  focus ring. A subsequent Tab reaches Back and retains normal keyboard focus.
- USDC uses the official filled token artwork from
  [Circle's brand kit](https://www.circle.com/pressroom), specifically
  `Token Logo/USDC Token.svg` in its USDC logo download.
- Both review and receipt render that icon. The receipt uses a 32px icon beside
  its compact amount and USDC symbol.

The journey adds EVM to a VoiceID wallet, signs an Arc self-transfer, verifies the
recovered sender, cancels another review, and signs NEAR afterward. It uses real
model inference and signing with deterministic RPC responses. This run does not
broadcast a live transaction.

Artifacts:

- [Review on opening](arc-usdc-review.png)
- [Confirmed receipt](arc-usdc-receipt.png)
- [Signing evidence](voiceid-arc-transfer.json)

Repeat with the local app, Wallet host, and gateway running. Set their normal
`SEAMS_INTENDED_*` URL, environment, and publishable-key variables, then run:

```sh
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/voiceid.unlock-arc.contract.test.ts \
  --grep add_ecdsa_after_voice --output=/private/tmp/voiceid-usdc-ui
```

Wallet and intended-test type checks, SDK build, and bloat check also passed.

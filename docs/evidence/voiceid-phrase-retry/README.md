# VoiceID phrase retry — 2026-10-25

The live-page browser E2E now injects an incorrect phrase during unlock. It verifies that the wallet stays locked, the prompt remains open, a different phrase appears, recognition details can be expanded, and an explicit Try again succeeds. The same journey checks incorrect-speaker and incorrect-phrase signing rejections before a successful reviewed transfer.

The contract passed in 1.6 minutes. It uses real browser models and local signing services with synthetic microphone input and deterministic NEAR RPC. The screenshot records the retry prompt with its diagnostic expanded. No new human voice success rate or on-chain transfer is claimed.

Phrase rejection retries retain the original challenge deadline. Enrollment shows concise guidance with expandable recognition details. Signing returns concise guidance to the transaction review and requires another Confirm click. Phrase limit 8 and speaker threshold 0.5 remain unchanged.

SDK build, SDK and intended-test type checks, and the bloat check passed.

Repeat `voiceid.live-page.contract.test.ts` with `playwright.wallet-intended.config.ts` and the local connection settings in ../voiceid-ui-integration/README.md.

# VoiceID phrase tolerance — 2026-10-25

The user approved minor wording differences. The phrase log-likelihood gap limit is now 8. Speaker similarity remains 0.5. The selected phrase must still equal the displayed challenge.

The saved screening comparison in ../voiceid-natural-phrase-diagnostics/cutoff-comparison.json shows two accepted article omissions among 48 near misses at this limit. Both were disclosed before the user approved this behavior. Other evaluated near misses and out-of-vocabulary samples remain rejected. This is a prototype cutoff, not a human accuracy estimate.

The live-page and unlock-NEAR browser contracts both passed (2.4 minutes). They exercise real browser models with synthetic audio, wrong-phrase and wrong-speaker rejection, natural-paced capture, fresh sessions, and reviewed signing. NEAR RPC is deterministic. No new human success rate or on-chain transfer is claimed.

SDK build, SDK and intended-test type checks, and bloat checks passed. Existing enrollment remains valid. Refresh the live page to use the new build.

Reproduction: use the connection environment in ../voiceid-ui-integration/README.md and run voiceid.live-page.contract.test.ts and voiceid.unlock-near.contract.test.ts with playwright.wallet-intended.config.ts.

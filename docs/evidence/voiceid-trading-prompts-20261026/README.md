# Short trading prompts

The bank now contains 16 trading-oriented phrases of 4–6 words. Natural fixtures
use Samantha at 160 words per minute without audio stretching. These clips last
about 1.5–2.2 seconds. The tokenizer and all model weights remain unchanged.

The browser Aurora contract passed all 16 matching challenges, 240 cross-phrase
rejections, and nine approximate or invalid-speech cases. The composed browser
journey passed enrollment, VoiceID unlock, Arc signing, cancellation, and NEAR
signing. It uses real models and MPC with deterministic chain RPC responses.

The speaker threshold remains 0.5. The native ONNX synthetic screen passed all 16
phrases against both the previous synthetic enrollment and a new enrollment. The
lowest score was 0.762. This full-clip screen is separate from the browser capture
journey and does not establish human microphone accuracy.

The stored public-corpus comparisons explain why the threshold was retained:
for the two-second evaluation group, 0.50 rejected 4/56 owner probes and accepted
0/728 other-speaker probes; 0.48 rejected 3/56 and accepted 1/728; 0.45 rejected
1/56 and accepted 2/728. These are small historical benchmark samples, not deployment
error-rate guarantees. Threshold selection was not changed based on these results.

## Reproduce

Generate the vocabulary with `tests/scripts/voiceid-aurora/vocabulary.py` and the
pinned Aurora tokenizer. Regenerate standard, natural, and tolerance audio with
`tests/scripts/voiceid-aurora/fixtures.py`; its README gives the commands. Regenerate
noise mixtures with `tests/scripts/voiceid-noise/fixtures.py`. Build the SDK.

```sh
SEAMS_TEST_FRONTEND_URL=http://127.0.0.1:4283 \
pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts \
  wallet-ui/voiceid-phrase-tolerance.browser.test.ts --project=chromium

SEAMS_INTENDED_APP_URL=http://localhost:4320 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:4313 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:4600 \
SEAMS_INTENDED_PROJECT_ENVIRONMENT_ID=local-smoke-project:dev \
SEAMS_INTENDED_PUBLISHABLE_KEY=pk_local \
pnpm -C tests exec playwright test -c playwright.wallet-intended.config.ts \
  e2e/intended-behaviours/voiceid.unlock-arc.contract.test.ts --grep add_ecdsa_after_voice
```

The browser reports are copied unchanged (the phrase matrix is gzip-compressed).
The speaker screen contains scores only. No user audio or embeddings are included.
`threshold-comparison.json` names and hashes the raw trial table used for its counts.

# Unified VoiceID loading — 2026-10-27

The card shows one cumulative download indicator for the engine WASM and three
models (26,769,398 decoded bytes). The total stays fixed while assets download.
Verified cached bytes count toward the same total. Once all downloads finish,
the card shows **Preparing VoiceID…** while inference sessions initialize.

Enrollment, unlock, and transaction approval use the same preparation function.
Approval starts its bounded recording attempt after preparation, while preserving
the review's expiry. Speaker acceptance remains 0.5. Phrase acceptance is unchanged.

The engine uses the existing hash-verified Cache Storage path. ONNX Runtime receives
the downloaded engine through its `wasmBinary` option, preventing a second fetch.
Small JavaScript loader modules are imported during preparation; their byte counts
are outside the four-asset total. The runtime binary hash matches the pinned
`onnxruntime-web` dependency. Browser storage remains best effort.

## Browser evidence

Validation passed: nine browser checks, a three-browser rerun with stricter cache
assertions, and six production lifecycle journeys. SDK build, workspace types,
focused test types, package boundaries, documentation links, and bloat checks also
passed. See [run results](results.json).

The journey streams real assets over a throttled local HTTP server. It verifies:

1. No engine or model request before selecting Load VoiceID.
2. A failed engine request produces an error, and retry succeeds.
3. One meter reports a fixed total and a nondecreasing downloaded count.
4. Preparing VoiceID appears after download, before inference becomes ready.
5. Each engine/model URL is requested once during a successful cold load.
6. All three real models initialize, and Aurora matches a real recorded phrase.
7. Invalid cached bytes are replaced. Valid retained bytes cause no download.

Artifacts: [Chromium](chromium.json), [Firefox](firefox-ui.json), and
[WebKit](webkit-ui.json). Screenshots show [download](downloading.png) and
[preparation](preparing.png).

Chromium and Firefox retain all four assets, replace only the corrupted phrase
model, and make zero engine/model requests on the final reload. These expectations
are asserted explicitly. This WebKit test environment discards Cache Storage on
navigation. Its test verifies successful fallback and compares requests with the
actual missing or invalid cache entries. WebKit cache persistence is not established.

## Cache investigation

| Fact | Instrument | Where and when | Checked |
| --- | --- | --- | --- |
| Four entries had correct body lengths and SHA-256 hashes after cold loading | Cache API reads and Web Crypto | WebKit local browser, October 27 JST | `cache-bytes/cache.json` in the raw artifact directory |
| The cache was empty immediately after reload, before the next load action | Same reader | Same browser and origin | `cache-bytes/cache-reloaded.json` |
| Cache writes reported no exceptions | Temporary test instrumentation around Cache.put | Same cold load | Instrumentation removed after diagnosis |
| Persistent profile and localhost controls also lost cache entries | Separate browser runs | `persistent` and `localhost` artifacts | No production cache change made to force persistence |
| Chromium and Firefox retain and reuse the cache | Strict reload assertions | Final browser journeys | Their final asset request lists are empty |

| Cause | Evidence | Conclusion |
| --- | --- | --- |
| Bad model bytes or incorrect hashes | Stored hashes and actual inference succeed | Rejected |
| Loader ignores valid retained cache entries | Chromium/Firefox reuse them; WebKit entries disappear before loading | Rejected for the measured failure |
| Only temporary profiles cause cache loss | Persistent-profile control also loses entries | Rejected |
| Browser storage retention differs in this environment | Cache disappears before loader execution | Supported; exact WebKit retention cause remains unknown |

The independent reviewer confirmed that best-effort caching remains appropriate.
The reviewer also required strict Chromium/Firefox assertions so a broken cache
write cannot pass the test merely by downloading everything again.

Two earlier test setup errors were corrected: the local server initially attached
its handler before initialization, and one Chromium run overlapped SDK asset
rebuilding. Subsequent runs used a completed build and a working request handler.

## Reproduce

```sh
pnpm -C packages/wallet build:sdk
pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts \
  wallet-ui/voiceid-loading.browser.test.ts \
  wallet-ui/voiceid-approval.browser.test.ts \
  wallet-ui/voiceid-phrase-tolerance.browser.test.ts
```

The existing production lifecycle journeys also cover the manual VoiceID demo,
NEAR unlock/signing, both Arc account setups, Email OTP without voice downloads,
and adding the first passkey from an Email-backed VoiceID session.

Raw artifacts are in `/private/tmp/voiceid-loading-20261027`. The browser tests save
screenshots and JSON evidence. Raw service logs stay outside the repository because
they can contain test authentication credentials.

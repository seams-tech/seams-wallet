# VoiceID final release validation — 2026-10-27

Target: SDK 0.24.0. Package manifests still say 0.23.0. This validation does
not publish packages or merge the VoiceID branch.

The branch was rebased onto `dev` at
`8c31712baa79e37a03596bc83f0b26950bc73f4a` without conflicts.
Validation includes the concurrent animation commit `5f420197f` and the fixes
recorded below. The work remains in `codex/voiceid-browser`.

## Scope and evidence

The checks follow `validate-wallet.yml`, with broader VoiceID and authentication
coverage. See [results](results.json) for test names, final outcomes, and run counts.
Final outcomes: **58 lifecycle journeys, 131 browser tests, and 149 existing CI
tests passed**. There are no unresolved failures in this selection. The lifecycle
count combines 56 initial passes with two corrected cases that passed on rerun.
The final browser and existing CI suites each passed in one complete run.

- Frozen dependency installation and all 38 Cargo lock checks.
- Production WASM, five Worker artifacts, native local tools, wallet-server, and SDK builds.
- Full workspace type checks, including intended-behaviour tests and type fixtures.
- Production lifecycle journeys for VoiceID, authentication methods, registration,
  passkey unlock, Email OTP unlock, and challenge expiry.
- Chromium, Firefox, and WebKit checks for VoiceID prompts, phrase tolerance,
  transaction review, receipts, confirmation surfaces, and connection closure.
- The existing CI unit suite. No new unit tests were added.
- Packed package boundaries and license notices.
- Documentation links, code fences, documentation build, example builds, and the production test app.
- Real local Worker [grant renewal evidence](grant-renewal.json).
- Voice model [sizes and SHA-256 hashes](model-integrity.json).
- Repository bloat check and whitespace check.

The browser tests use isolated contexts. Lifecycle tests use production bundles,
local Workers, virtual passkeys, deterministic audio, and deterministic chain RPC
responses. They verify inference and signing flows. Human speech accuracy and live
settlement rely on the separate [live acceptance record](../voiceid-release-readiness-20261026/README.md).

The local native-tool build covers this Mac's architecture. The release workflow
still builds its macOS and Linux distribution matrix.

Raw logs and browser artifacts are retained locally at
`/private/tmp/voiceid-final-release-20261027`. Raw service logs are excluded from
this record because they can contain test authentication credentials.

## Failure classification and changes

| Initial failure | Classification | Resolution |
| --- | --- | --- |
| Type fixture required expiring voice samples | Obsolete fixture | Removed the retired lifetime requirement. Existing persistent-sample constraints remain. |
| Account-menu test expected an extra unlock gate | Obsolete fixture | Deleted the retired test and its unused fixture branch. Action-level authentication contracts remain. |
| Generic unlock helper rejected an expected recoverable network notice | Valid test needs update | The fault test hands retry control to its existing visible-error driver after the initial click. Ordinary cases retain fail-fast handling. |
| NEAR failure-retry test clicked a removed unlock button | Obsolete fixture | Removed the extra click. The current unlock request starts capture directly. |
| Firefox executable was absent | Environment failure | Installed and verified the required Playwright Firefox build. |
| Focused Confirm moved below a short viewport during disclosure expansion | Production regression | Local animation completion restores visibility when the focused control is outside the viewport. |

## Focus diagnosis

| Fact | Instrument | Where and when | Checked |
| --- | --- | --- | --- |
| Confirm was focused below the viewport after expansion | Browser geometry and screenshot | Isolated 640×360 review test, October 27 JST | Button bottom 391.45px; iframe viewport 328px; document scroll offset 0. |
| A global resize completion correction did not restore visibility | Three-browser control | `focus-fixed` artifacts | All three cases failed. |
| Changing horizontal overflow from clip to hidden did not restore visibility | Three-browser control | `focus-css` artifacts | All three cases failed; root scroll offset remained 0. |
| Local completion restored scrolling | Three-browser control | `focus-local` artifacts | Firefox passed. Chromium reached scroll offset 63px, leaving 0.453px clipped. |
| Centering the clipped control removed fractional clipping | Repeated browser test | `focus-final` artifacts | Nine checks passed across three browsers. |
| Visible controls must retain their scroll position | Independent code review | Final change | The correction now checks viewport bounds before scrolling. |

| Candidate cause | Evidence | Conclusion |
| --- | --- | --- |
| Horizontal overflow prevents all scrolling | The local completion hook scrolls with the original CSS | Rejected; CSS experiment removed. |
| Only hosted resize settlement needs correction | The global hook failed; local completion restored scrolling | Rejected; global experiment removed. |
| Local expansion moves a focused control after native focus scrolling | Geometry, local completion control, and repeated final checks | Supported; correct visibility after local animation completion. |
| The added Tab loop reliably measures the original invariant | WebKit did not reach Confirm | Rejected as a measurement change; retain the existing direct-focus test. |

The final test waits for expansion to finish, asserts full visibility, saves
geometry and a screenshot, then activates Confirm with Enter. It verifies focus
visibility and keyboard activation. It does not claim complete Tab-order coverage.
The test uses the real confirmation component in an isolated Wallet iframe.
Final screenshots: [Chromium](focus-chromium.png), [Firefox](focus-firefox-ui.png),
and [WebKit](focus-webkit-ui.png). Corresponding geometry files use the same names
with a `.json` extension.

## Reproduce

Build production artifacts, then run the repository checks:

```sh
pnpm install --frozen-lockfile
pnpm check:cargo-locks
WASM_SDK_BUILD_MODE=prod pnpm build
pnpm type-check
ROUTER_AB_WORKER_BUILD_PROFILE=release node crates/router-ab-cloudflare/scripts/test-grant-renewal.mjs
pnpm check:packed-wallet
pnpm -C apps/docs check:links
node apps/docs/scripts/check-code-fences.mjs
pnpm build:docs
pnpm build:example
pnpm report:bloat --check
```

Use Node 24 and the installed Playwright browser versions for UI checks:

```sh
pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts \
  wallet-ui/voiceid-approval.browser.test.ts \
  wallet-ui/voiceid-phrase-tolerance.browser.test.ts \
  wallet-ui/transaction-review.browser.test.ts \
  wallet-ui/external-evm-receipt.browser.test.ts \
  wallet-ui/confirm-ui.browser.test.ts \
  wallet-iframe/router.connectionClosed.test.ts
pnpm -C tests test:wallet-unit
```

Supply the repository's Google test audience and a fresh test token for composed
lifecycle tests. Use the isolated production CI configuration after building:

```sh
SEAMS_INTENDED_PRODUCTION=1 SEAMS_INTENDED_SKIP_BUILD=1 \
ROUTER_AB_WORKER_BUILD_PROFILE=release \
pnpm -C tests exec playwright test -c playwright.wallet-intended.ci.config.ts \
  '(?:^|/)(?:[^/]*voiceid[^/]*|auth-method[^/]*|passkey\.add-email-otp|email-otp\.add-passkey|passkey\.registration|passkey\.unlock|email-otp\.unlock|email-otp\.challenge-expiry)\.contract\.test\.ts$' \
  --workers=1
```

## Release steps still required

Merge the validated branch into `dev`, prepare the 0.24.0 package versions and
release notes, then run the release workflow from its required release branch.
Rebuild and validate the versioned packages before publication. Deployment and
published-package smoke checks remain part of that release operation.

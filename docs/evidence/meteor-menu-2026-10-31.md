# Meteor menu checks — 2026-10-31

The real Meteor extension connected through the current SDK in Chrome.
The original failure occurred on another computer. Its exact cause remains unknown.

## Facts

| Fact | Instrument | Place and date | Check |
| --- | --- | --- | --- |
| The iframe briefly measured 406 px high while its content measured 419 px. | Browser measurements every 10 ms during connection failure | Controlled hosted-menu test, 2026-10-31 | The same document fit after the next resize. |
| Wallet artwork used a grayscale filter. | Computed CSS in the existing browser contract | Hosted menu | The updated contract checks original colors before and during hover. |
| The real extension returned a connected testnet account. | Chrome UI and the local acceptance page | `http://localhost:4286/external-wallet-acceptance.html`, 2026-10-31 | The result reported `ok: true`, wallet `meteor`, and network `testnet`. |
| Extension detection was false at page load and true at connection time. | Acceptance page detection text | Same Chrome page | The connection used the adapter's current transport lookup. |
| The controlled browser can fail without a Meteor transport, then connect after transport injection. | Real adapter with a controlled extension transport | Hosted-menu browser contract | One connected callback and one `wallet_connected` outcome. |
| The isolated menu test has no relayer. | Visible preparation notice | Browser harness | Brand assertions use the recovery view, where the notice no longer replaces the brand. |

## Causes assessed

| Candidate | Evidence | Result |
| --- | --- | --- |
| The iframe resize follows a content change. | A 13 px excess disappears after resize. | Confirmed source of temporary overflow in the controlled test. |
| Meteor always fails in the SDK. | The real Chrome extension connected. | Rejected. |
| The other computer does not expose Meteor to the app. | That browser was unavailable for inspection. | Unknown. The new message identifies a missing transport. |
| A connection failure should increase the menu body height. | Status now uses the existing footer. | Removed from the implementation. |
| Custom branding is missing from the iframe request. | Browser tests load the image and show it in recovery. | Rejected. |

The scroll check records dimensions and scrollbar visibility during connection changes.
The wallet document hides its scrollbars while the parent applies measured dimensions.
The parent retains scrolling for content taller than its viewport.

## Reproduction and artifacts

Run `pnpm -C packages/wallet build:sdk` first.
Run `pnpm -C tests test:wallet-browser wallet-ui/wallet-connector.browser.test.ts`.
Each scenario writes screenshots and JSON observations to its Playwright output directory.
The tests cover cancellation, stale replies, controller replacement, recovery navigation,
all recovery display modes, custom branding, and connection after transport availability.

For the real extension check, run:

```sh
pnpm -C tests exec vite browser-app --host 127.0.0.1 --port 4286 --strictPort
```

Open `http://localhost:4286/external-wallet-acceptance.html` in Chrome with Meteor.
Select **Connect Meteor** and approve the connection. No signing or transaction is required.
The captured result is in `output/playwright/meteor-live-connection/connection.png`.

This run establishes direct-adapter compatibility with the installed local extension.
The hosted-menu automated tests use controlled transports. Parity with the other
computer's failure is not established.

## Validation

All nine focused cases passed in Chromium, Firefox, and WebKit.
Twenty existing auth-menu, host-integration, and external-NEAR browser cases passed in Chromium.
The SDK build, SDK type check, state type fixtures, example type check, and bloat check passed.
The broader browser-test TypeScript project still reports errors in unrelated existing fixtures,
including VoiceID and surface measurement tests. It reports none in this change's browser test.

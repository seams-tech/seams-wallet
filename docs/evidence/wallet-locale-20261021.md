# Wallet SDK display language

The SDK now supports English and Japanese through `appearance.locale`.
English remains the default. `normalizeWalletLocale` accepts raw language tags at application boundaries.
The catalogue requires Japanese text for every message key.

The existing appearance message carries locale into the hosted wallet.
Its configuration parser accepts only supported internal locales.
Locale stays outside signing, authentication, custody, quota, and session state.
The existing runtime fingerprint excludes appearance, so locale updates preserve signing sessions.
The iframe protocol remains 16.0.0. This change needs no Rust bindings or generated wire fixtures.

The React and Preact renderers translate SDK copy before creating text nodes or accessible attributes.
They preserve identifiers, addresses, method values, transaction payloads, and brand names.
Application copy and unknown external service details remain the application's responsibility.
Native passkey prompts and Google account chooser windows follow their providers' language settings.

## Verification

- `pnpm -C packages/wallet build:sdk` passed, including declarations and static wallet assets.
- `pnpm type-check` passed across SDKs, examples, docs, intended contracts, and type fixtures.
- `pnpm check:packed-wallet` passed for the prepared 0.18.0 packages.
- 62 existing Chromium browser checks passed across authentication, recovery backup, transaction review, receipts, and settings.
- 18 focused browser checks passed again after the translation fixes.
- The existing `passkey unlock restores immediate export and shared-budget signing` lifecycle contract passed.
  That contract registers a wallet, locks and unlocks it, exports keys, and signs transactions.
- Documentation fence classification passed.
- Internal documentation links and external package declaration checks passed.
- `pnpm report:bloat --check` passed with the new files staged.
- No site navigation or unit tests were added.

The lifecycle command used isolated local ports to preserve other running services:

```sh
SEAMS_LOCAL_PORT_OFFSET=220 \
SEAMS_INTENDED_APP_URL=http://localhost:4421 \
SEAMS_INTENDED_WALLET_ORIGIN=http://localhost:4422 \
SEAMS_INTENDED_ROUTER_URL=http://127.0.0.1:4320 \
SEAMS_INTENDED_ROUTER_AB_ROOT=/tmp/seams-wallet-locale-runtime \
SEAMS_INTENDED_SKIP_BUILD=1 \
pnpm -C tests exec playwright test -c playwright.wallet-intended.ci.config.ts \
  e2e/intended-behaviours/passkey.unlock.contract.test.ts \
  --grep 'passkey unlock restores immediate export and shared-budget signing'
```

The local artifact directory is `.artifacts/wallet-i18n/`.
It contains 34 screenshots, a text and width manifest, configuration evidence, a capture script, and a browser trace.
The captures cover 390 px and 1280 px widths. Neither width produced horizontal overflow.
They include registration, unlock, device prompts, Google email verification, linking, recovery, backup, review, receipts, and settings.
The transaction fixture preserves the method value `Transfer` while translating its field label.
All recovery codes in the screenshots are synthetic display values.

The configuration capture checks `JA-jp → ja`, unsupported tags → `en`, and the serialized iframe configuration.
It also checks that switching locale preserves the signing fingerprint.
Run the capture script with `tsx` after starting the existing browser fixture app on port 4214.

The first browser attempts hit occupied ports. The reruns used separate ports.
A later run with forced tracing timed out.
The same selected checks passed with tracing disabled. The standalone capture trace completed.
These failures were classified as environment or infrastructure failures. They required no production workaround.

## Release and Console integration

The browser and server manifests prepare version 0.18.0. Publication remains pending.
The repository publishes the paired packages through `release-wallet-packages.yml` on `main`.
Integrate the committed `dev` changes into `main`, then run that workflow with version `0.18.0`.
The CLI keeps its separate 0.17.0 release.

After publication, pin `@seams/wallet@0.18.0` and `@seams/wallet-server@0.18.0` in `seams-monorepo`.
Deploy wallet-origin assets from that same SDK build with the application update.
Pass `appearance: { locale: 'ja' }` into the SDK configuration for Japanese previews and product pages.
Normalize a raw iframe query parameter before passing it into configuration.
An older hosted wallet build cannot display these translations through an application-only package update.

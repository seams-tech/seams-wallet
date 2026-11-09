# Seams Wallet

Open-source browser and server Wallet SDKs, signer runtimes, Rust/Wasm
implementation crates, documentation, examples, and recovery CLI.

SDK version: **0.62.0**. [Read the documentation](https://docs.wallet.seams.sh/) or start with the [release notes](./apps/docs/src/releases.md).

Packages for this release:

- `@seams/wallet@0.62.0` — browser SDK and React components.
- `@seams/wallet-server@0.62.0` — server SDK and packaged Worker runtimes.
- `@seams/voiceid@0.62.0` — optional VoiceID authentication plugin.
- `@seams/speak-to-sign@0.62.0` — experimental, testnet-only spoken payments; needs VoiceID.
- `@seams/wallet-cli@0.29.0` — with its signed native release;
  see the [recovery CLI](./apps/docs/src/deploy-and-operate/recovery-cli.md).

Seams Wallet is licensed under Apache-2.0. See `LICENSE.md`.

The browser and server SDKs use wallet iframe protocol `23.0.0`. Upgrade the browser
SDK, wallet-origin assets, server SDK, and enabled VoiceID plugin together.
The browser SDK, server SDK, VoiceID plugin, and Speak-to-Sign plugin use version **0.62.0**.
The signed recovery CLI remains at **0.29.0**.
See [release notes](./apps/docs/src/releases.md) and the
[hosted integration guide](./apps/docs/src/deploy-and-operate/hosted-integration.md)
for changes and deployment requirements. The development checkout can contain
changes that npm does not yet publish.

The hosted Seams Console, product sites, and deployment configuration live
in the private `seams-tech/seams-monorepo` repository.

## Release 0.62.0

- A NEAR custody cache from an older state epoch re-binds locally. A Router recovery, such as the first passkey login on another site, keeps both shares and moves only the epoch, so passkey login, account sync, VoiceID and Email OTP re-seal the old row under the current epoch with no Router round. VoiceID no longer fails after a login on another site.
- The active Ed25519 capability carries `signingWorkerVerifyingShare`. Release the Wallet, the server and the hosted assets together: a 0.61.0 Wallet's Email OTP unlock refuses the new field, and a 0.62.0 Wallet needs it.
- A passkey login that rejoins the key set now reports the recovery, so the local authority follows the new activation.
- Install all four packages at 0.62.0. No database migrations.

## Release 0.61.0

- Speak-to-Sign (experimental, NEAR testnet only) approves a pull request merge by voice: `requestMergeApproval` signs one `approve_merge` call after the owner says "merge pull request 42 into main". It needs verifier 0.5.0 or later.
- A voice-approved plain transfer shows "Sent" when a block holds it, about two blocks before its outcome. A recording of a known sentence ends after 0.8 s of silence instead of 1.5 s, once the whole sentence was said. The result times start at the last spoken word.
- Verifier 0.5.1 (`cdb46fea…`) writes the used-audio mark during its requests, about 0.2 s off each verification. A refused recording is used up.
- A passkey unlock refreshes a NEAR custody cache that is older than the server's keys. The Wallet host loads its plugins with a version key in the URL.
- The Speak-to-Sign host API is version 8. `@seams/speak-to-sign` releases from `seams-tech/speak-to-sign`. Install all four packages at 0.61.0. No database migrations.

## Release 0.60.0

- Speak-to-Sign (experimental, NEAR testnet only): the Seams co-signer checks the verifier's verdict again before it adds its part of a voice-approved signature. It checks the pinned key, the expiry, the transaction against the spoken request, the owner and single use, and it applies the voice limits: 10 NEAR in one voice-only payment and 20 NEAR in any 24 hours for each wallet. A refusal is `refused` with `voice_limit` or `cosigner_refused`.
- A `step_up` verdict needs a fresh approval: a passkey or Email OTP step-up of the same operation, or a new VoiceID unlock after the verdict.
- `requestTransfer`, `requestNote` and `requestRating` take an optional `onProgress`. The verify route answers with `text/event-stream`, and the Wallet prefetches the NEAR nonce and block hash while the verifier works.
- Without `rpIdOverride`, passkeys are scoped to the host of `walletOrigin`. Before, every wallet origin kept the local default `example.localhost`.
- Without a `routerAb` setting, the Seams-hosted wallet origins (`staging.sign.seams.sh`, `test.sign.seams.sh`, `sign.seams.sh`) enable Router A/B normal signing with their own SigningWorker. So `seamsTestnetConfig` with `walletOrigin`, `relayerUrl` and `publishableKey` can sign NEAR. Before, NEAR signing stayed off until the app set `routerAb`.
- Verifier 0.4.1 (`d078eb11…`) accepts more spoken forms in transfers: separators said in other words or left out ("seams v one"), "to" joined with the account, and "oh" for zero.
- D1 migration `0089_speak_to_sign_voice_verdicts.sql` adds one table. Apply it, deploy the server, then the Wallet host; Speak-to-Sign needs both at 0.60.0. The Speak-to-Sign host API is version 7. Install all four packages at 0.60.0.

## Release 0.59.0

- Speak-to-Sign signs spoken community notes and note ratings. `requestNote` posts a typed note when the author reads aloud its summary of 1 to 12 plain words; the verdict binds the full note by its SHA-256. `requestRating` rates a note when the owner says "this note is helpful", "somewhat helpful" or "not helpful". Wallet core signs one `add_note` or `rate_note` call on the notes contract, with no deposit and no confirm.
- Verifier 0.4.0 (`8a0b7ba0…`) adds the note requests. Transfers are unchanged.
- The Speak-to-Sign host API is version 6, and the VoiceID host API stays at version 10. Install all four packages at 0.59.0.

## Release 0.58.1

- Speak-to-Sign shows one VoiceID card for the whole spoken payment. After the recording, the card stays open: it shows the verifier check, the payment and the result in place. A refusal offers "Try again" on the same card, up to five recordings in all, and a step-up asks for the passkey in the card. `requestTransfer` returns when the owner closes the card. The Wallet pays at most once in each flow.
- Verifier 0.3.1 (`5b6fad5d…`) accepts sound-alikes of the words that hold no value, such as "year" for "NEAR". On the saved Whisper transcripts, 98.0% of transfers pass, up from 94.6%, with no false accepts.
- The VoiceID host API is version 10 and the Speak-to-Sign host API is version 5. Install all four packages at 0.58.1.

## Release 0.58.0

- Speak-to-Sign pays from the owner's own account. There is no vault: the Wallet checks the verifier's signed verdict and sends the transfer through the owner's Wallet Session. An accepted spoken payment shows no confirm and no passkey. A policy rule can ask for the confirm again; today one stub rule asks for it above 10 NEAR.
- `speakToSign({ network })` replaces `speakToSign({ vault, network })`. A `sent` result has `approval` (`voice` or `voice_and_passkey`). The refusal `vault_rejected` becomes `transaction_failed`, `vault_missing` is gone, and an enrollment result has no transaction hash.
- Enrollment signs one NEP-413 message for exactly the three recordings. Each owner enrolls again once, because the verifier keys templates by owner only.
- The Speak-to-Sign host API is version 4, and the verifier is version 0.3.0 (`09f4ce1b…`). Install all four packages at 0.58.0. The VoiceID host API stays at version 9. Speak-to-Sign stays experimental and NEAR testnet only.
- Wallet iframe protocol remains **23.0.0**. This release adds no database migrations.

## Integrate the SDK

```sh
npm install @seams/wallet@0.62.0
# Server applications:
npm install @seams/wallet-server@0.62.0
# Applications that enable VoiceID:
npm install @seams/voiceid@0.62.0
# Experimental Speak-to-Sign (needs VoiceID):
npm install @seams/speak-to-sign@0.62.0
```

Use `HostedSeamsAuthMenu` from `@seams/wallet/react` inside `SeamsWebProvider`.
Its optional `walletAlternatives` configuration supplies ordered `primary` and
`secondary` groups. Omitted or empty groups stay hidden. Authentication stays on
the wallet origin, while external connections remain owned by application controllers.
Wallet icons retain their original colors.

Start with the [runnable connector example](./examples/seams-auth-menu/README.md),
the [React reference](./apps/docs/src/reference/react.md), and the
[hosted integration guide](./apps/docs/src/deploy-and-operate/hosted-integration.md).

## Local development

Local development uses two terminals:

```sh
pnpm router
pnpm site
```

`pnpm router` starts the five isolated MPC Router roles, bootstraps the local tenant
root, migrates signer D1, and serves the Wallet Gateway. `pnpm site` starts Caddy,
Wallet Console Lite, the hosted Wallet iframe/assets, and the Wallet documentation.
Together they provide a complete local Wallet stack without `seams-monorepo`.

Wallet Console Lite supports local organisation/project setup, registration, unlock,
session inspection, safe message signing, and the public CLI workflows for server-share
export, rotation, and deployment restore. See
[`examples/wallet-console-lite`](./examples/wallet-console-lite/README.md).

### TypeScript compiler

Project checks, declaration builds, and the packed SDK consumer check use the exact
`tsrs` version in the root `package.json`. The root `typescript` dependency supplies
the JavaScript API used by build-analysis scripts and declaration comparison.
Vite, Rolldown, and Bun still produce application JavaScript.

```sh
pnpm type-check
pnpm -C packages/wallet build:sdk
pnpm -C packages/wallet-server build
pnpm -C packages/wallet check:declarations-external
```

The SDK build uses existing WASM outputs. Use `pnpm build:wasm` when those outputs
need regeneration.

Compare tsrs with its matching upstream compiler from the repository root:

```sh
npm install --prefix .artifacts/typescript-reference --ignore-scripts --no-audit --no-fund typescript@7.1.0-dev.20260930.4
node tests/e2e/typescript-compiler-comparison.e2e.mjs \
  --reference .artifacts/typescript-reference/node_modules/typescript/bin/tsc \
  --candidate node_modules/.bin/tsrs
```

The comparison covers ten configurations, including lifecycle type fixtures and
browser tests, plus both declaration builds. It compares checked source files and
declaration syntax. Record property order may differ. Overload and signature order
must match. Declaration maps must have matching metadata and source paths, while
encoded position mappings may differ. Run the comparison without concurrent builds
or tests. It excludes one warmup and records three samples per project.

Logs, declarations, source manifests, times, and peak resident memory go to
`.artifacts/typescript-compiler-comparison/result/`. A successful run prints
`Verified` and sets `verified: true` in `result.json`. Linux requires GNU
`/usr/bin/time`; macOS uses its bundled `/usr/bin/time`.

### Packaged local runtime

`@seams/wallet-server` includes prebuilt Worker roles, signer/private-role
migrations, and the native local identity initializer. Consumers can run
`seams-wallet-server-local` (complete local Wallet system),
`seams-wallet-server-local-roles`, or `seams-wallet-server-local-init --root <directory>`.
Supported initializer targets match the CLI release: macOS arm64/x64 and Linux
x64. `pnpm build:local-tools` builds the host initializer in this source repo;
the npm release pipeline assembles all supported targets.

Private Console adapters use `@seams/wallet-server/local-runtime` for local
configuration and `@seams/wallet-server/tenant-root` for portable protocol
contracts. Console governance/security-state models stay in the private repo.

## Architecture specifications

Start with [How the wallet works](./docs/README.md), then choose a topic from the
numbered `spec-{x}-{title}.md` chapters. Each explains the main flow and links to
further detail. [Intended Behaviours](./docs/intended-behaviours.md) defines the
supported user journeys.

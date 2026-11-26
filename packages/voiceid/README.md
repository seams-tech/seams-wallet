# VoiceID host plugin (internal)

`@seams-internal/voiceid` is not published. It builds the trusted VoiceID plugin that the
Wallet host loads from `/sdk/voiceid/host.js`: microphone capture, enrollment, local inference,
the voice UI in the Wallet iframe, and the model and engine assets. The Wallet SDK owns custody,
sessions, signing and the host API.

The packages publish the parts of VoiceID:

| Part | Package path |
| --- | --- |
| The app descriptor `voiceIdAuthMethod()` and the host contract | `@seams/mpc-wallet/voiceid` |
| `VoiceAssistantCard` and `VoiceBeam` | `@seams/mpc-wallet/react`, styles in `@seams/mpc-wallet/styles.css` |
| This plugin, its models and `composeVoiceIdWalletAssets` | `@seams/host/voiceid` |
| The `seams-voiceid-host` command | `@seams/host` |

## Build

```sh
pnpm -C packages/voiceid build
```

The build needs the MPC wallet types (`pnpm -C packages/mpc-wallet build:sdk`). It writes
`dist/public/sdk/voiceid/` (the plugin chunks, the models and their licences) and
`dist/hosting.mjs`. Each import of the Wallet's `/sdk/voiceid-host.js` carries the version
of `packages/mpc-wallet`, so a new plugin chunk never runs against a cached older bridge.
`pnpm -C packages/mpc-wallet-server package:voiceid` copies the build into the host package.

The browser downloads only the selected speech model, plus the shared speaker model, speech
detector and inference engine:

| Speech model | Uncompressed | Gzip |
| --- | ---: | ---: |
| Citrinet INT8 (default) | 10.48 MB | 8.84 MB |
| Aurora INT8 | 1.34 MB | 1.02 MB |

The cold payload before transfer compression is roughly 27 MB with Aurora or 36 MB with
Citrinet. A Wallet host without VoiceID serves none of it.

Use the [public VoiceID guide](https://docs.wallet.seams.sh/concepts/auth-methods/voiceid)
for the app and host steps, enrollment, unlock, signing and storage. See the
[implementation notes](src/README.md) for the code boundaries and enrollment storage.

# VoiceID authentication plugin

`descriptor.ts` is the app-facing opt-in. It contains no capture or model code.
`host.ts` implements `WalletAuthMethodHostPlugin` and is loaded by the trusted
registry in `core/authMethods/hostRegistry.ts` on the first enabled use.

```ts
const wallet = new SeamsWeb({ authMethods: [voiceIdAuthMethod()] });
await wallet.registration.activateAuthMethod({ walletId, method: 'voiceid' });
```

The plugin owns activation and unlock UI, native capture, server proof exchange, and the
prototype's transaction approval. The native service and model assets remain
separate local components. Session authorization, custody worker execution,
quota checks, and NEAR signing belong to the SDK core.

To replace the browser implementation, register another module implementing
`WalletAuthMethodHostPlugin` under the same descriptor. It must preserve the
device assertion and custody-envelope contracts accepted by the server.
A different proof protocol also needs its server verifier; an app cannot
install executable code into the Wallet iframe through configuration.

To omit VoiceID from a Wallet build, remove its registry entry, descriptor
catalog entry, public descriptor exports, and this directory. Omitting it from
`authMethods` is enough to prevent runtime loading and native requests.

The host contract now includes `unlock`, with a required core session installer.
The plugin resolves its active local method, requests a challenge, and waits for
an Unlock click on the Wallet origin. Its capture surface expires with that
challenge. The proof handoff erases the factor buffer after the installer ends.

The core NEAR installer and app-facing unlock dispatch remain in progress.
The Wallet must complete custody and signing installation before reporting an
unlocked session. The plugin hook alone does not mark the wallet authenticated.

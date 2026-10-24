# VoiceID authentication plugin

`descriptor.ts` is the app-facing opt-in. It contains no capture or model code.
`host.ts` implements `WalletAuthMethodHostPlugin` and is loaded by the trusted
registry in `core/authMethods/hostRegistry.ts` on the first enabled use.

```ts
const wallet = new SeamsWeb({ authMethods: [voiceIdAuthMethod()] });
const method = await wallet.registration.activateAuthMethod({ walletId, method: 'voiceid' });
await wallet.auth.lock();
await wallet.auth.unlockWithAuthMethod({
  walletId,
  walletAuthMethodId: method.walletAuthMethodId,
  method: 'voiceid',
});
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

The SDK dispatches `auth.unlockWithAuthMethod` to the enabled plugin. The core
installer opens the device's seed-encrypted NEAR custody cache with the scoped
factor. It installs a live Yao client and the fresh server session before it
marks the exact method unlocked. A lock-generation check prevents an older
unlock from overriding a later lock.

This installer supports NEAR on the activated device. The custody cache must
already exist from an owner unlock. Missing custody requires another passkey
or Email OTP unlock. Reload requires a fresh VoiceID unlock. ECDSA signing and
key export require their supported owner methods.

# A login-only app with Seams Auth

This example signs a user in with a passkey or an email code. It installs only `@seams/auth`. It
loads no wallet package, starts no worker and loads no WASM.

- `src/app.ts`: the app page. It calls `createSeamsAuth`, opens the auth menu and sends the login
  token to its backend.
- `src/backend.ts`: the app's backend. It checks the login token with `verifyLoginToken`.
- `scripts/start-local.mjs`: runs the account origin (the account frame and the Auth Worker over
  a local D1 database) and the app on this computer.

## Run

```bash
pnpm -C examples/seams-login dev
```

Open `http://localhost:4700`. The terminal prints each email code in the subject of its email.

## VoiceID

The app lists `voiceId()`, and the auth core has the device key of VoiceID. The voice check
itself is a gate that the operator installs at `/sdk/voiceid/gate.js` on the account origin. This
example installs no gate, so "Add VoiceID" answers that VoiceID is not set up on this device.

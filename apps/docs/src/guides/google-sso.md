---
title: Bring your own Google authentication
description: Reuse an application's Google SSO login for associated wallet settings in SDK 0.31.0.
---

# Bring your own Google authentication

Use the application's existing Google ID token to open an associated wallet without another login prompt.
This flow grants settings access. Signing and custody operations retain their existing authentication requirements.
SDK **0.31.0** supports direct Google trust and [application-session handoff](/guides/application-auth).
Pass the Google **ID token** issued for the configured OAuth client. Google access tokens and arbitrary WebAuthn assertions are not supported by this API.

## Configure trust

Through the authenticated Console environment update API, set:

```json [Partial example]
{
  "kind": "google",
  "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com"
}
```

Use `PUT /console/environments/:environmentId/external-auth` with the existing Console administration session.
The environment owns its configuration revision. Callers cannot choose that revision.
The environment's publishable key must allow the application origin and the hosted wallet origin.
The SDK configuration must include the environment ID and its publishable key.

Send `{ "kind": "disabled" }` to disable exchanges and deny existing sessions.
Changing the configuration increments its revision and invalidates earlier external sessions.
Self-hosted deployments provide the same `externalAuth` configuration through their existing static deployment configuration.
Increase the static configuration revision whenever trust changes.

## Associate a wallet once

Verify the Google identity and request a fresh wallet-origin owner approval:

```ts [Partial example]
const association = await seams.auth.associateExternalAuth({ method: 'google', walletId, idToken });
if (!association.ok) {
  showAuthenticationError(association.code);
}
```

For new NEAR-only passkey wallets, `registration.registerOwnerWallet` supports onboarding without a reusable signing session.
Association preserves the wallet's custody seed, keys, and signing permissions.
Matching email addresses never create an association automatically.
The API uses Google's stable subject identifier and the current application environment.

## Browser receives the Google token

After the app completes its existing Google login:

```ts [Partial example]
const result = await seams.auth.authenticate({ method: 'google', walletId, idToken });
if (result.ok) {
  // The React provider observes the installed settings session.
  navigateToWalletSettings();
} else {
  showAuthenticationError(result.code);
}
```

The hosted wallet retains the session credential. The result exposes only session metadata.
The Google token remains transient and is not stored in browser persistence.

## Backend retains the Google token

The SDK first prepares a browser-bound attempt:

```ts [Partial example]
const prepared = await seams.auth.prepareExternalAuth(walletId);
if (!prepared.ok) throw new Error(prepared.code);
```

Send `prepared.value` to your authenticated app backend.
The backend obtains the Google ID token belonging to that app session and calls:

```http
POST /wallet/external-auth/backend-exchange
Authorization: Bearer YOUR_APPLICATION_SECRET_KEY
x-seams-environment-id: YOUR_ENVIRONMENT_ID
Content-Type: application/json

{
  "walletId": "SELECTED_WALLET_ID",
  "attemptId": "PREPARED_ATTEMPT_ID",
  "proof": { "kind": "google", "idToken": "GOOGLE_ID_TOKEN" }
}
```

The API key needs `wallets.read` permission for the selected environment.
A successful response is `{ "ok": true, "value": { "code": "OPAQUE_HANDOFF" } }`.
Return only that code to the browser, then complete the original SDK attempt:

```ts [Partial example]
const result = await seams.auth.authenticate({
  method: 'handoff',
  walletId,
  attemptId: prepared.value.attemptId,
  code,
});
```

Attempts expire after two minutes.
Preparation, verification, and association requests share a limit of 120 requests per minute for each environment and source IP.
The hosted browser retains the binding secret and the proposed session token.
Concurrent redemption of the same bound attempt yields the same session.
Neither replay nor recovery of a lost response extends its expiry.
A different browser binding or session token cannot redeem the code.
After a lost exchange response, prepare a new attempt. After a lost redemption response, retry the same handoff.

## Lifecycle and permissions

External sessions expire at the earlier of one hour or the Google token's expiry.
Reload can restore an unexpired session within the same browser tab and embedding app origin.
The server rechecks provider configuration, association status, and wallet authority for settings requests.

Call `await seams.auth.lock()` when the application logs out or switches accounts.
Then authenticate the new account explicitly. Background refresh must respect an explicit wallet lock.
Google logout elsewhere does not instantly revoke a previously issued ID token.

The SDK exposes `session.authentication.kind === 'external_authenticated'` and `session.capabilityProjection.kind === 'not_requested'`.
The settings screen can display accounts, active method summaries, and active device summaries.
Security changes require normal owner authentication. Settings credentials cannot enter owner or signing admission.

To remove an association, authenticate as the wallet owner and call:

```ts [Partial example]
await seams.auth.removeExternalAuth({ walletId, associationId });
```

The external session metadata contains its `associationId`.
Revoking its wallet authority or removing the association also blocks its outstanding handoffs.
Wallet relocation preserves associations. External sessions and pending handoffs must be established again at the new home.

## Verification

SDK **0.31.0** uses wallet iframe protocol **20.0.0**.

Run `pnpm -C packages/wallet build:sdk`, then `node tests/e2e/external-auth.e2e.mjs` from the repository root.
The scenario writes `.artifacts/external-auth/result.json` and a settings screenshot.
It uses real signature verification with generated test tokens and test-only Google public-key interception.
The E2E uses controlled test identities. Verify the application's actual Google login and logout flow before enabling it for users.

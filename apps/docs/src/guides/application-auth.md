---
title: Application sessions and owner approval
description: Connect an application account and approve each NEAR operation with a wallet-origin owner passkey.
---

# Application sessions and owner approval

SDK **0.31.0** accepts a handoff from an explicitly trusted application backend.
Google and application-passkey login can use the same stable application user ID.
The wallet connection grants settings access. Each transaction requires fresh wallet owner proof.

## Configure the application issuer

Set `PUT /console/environments/:environmentId/external-auth` through an authenticated Console administration session:

```json [Partial example]
{
  "kind": "application",
  "issuer": "https://app.example.com",
  "publicKeyB64u": "YOUR_ED25519_PUBLIC_KEY_BASE64URL"
}
```

The issuer must be a canonical HTTPS origin. The public key contains 32 Ed25519 bytes in canonical base64url.
Keep the private key on the application backend.
The environment must allow the application origin and the hosted wallet origin.
Trust changes increment the environment revision and revoke earlier external sessions.

An application identity consists of the provider, issuer, and stable subject.
Email matching never establishes wallet ownership.
Changing from direct Google trust to application-issuer trust requires a fresh owner-approved association.
Wallet keys remain unchanged.

## Enroll and associate

Existing wallets need one association approved by an enrolled wallet-origin owner passkey.
The owner does not need to open a reusable signing session.

```ts [Partial example]
const attempt = await seams.auth.prepareExternalAssociation(walletId);
if (!attempt.ok) throw new Error(attempt.code);
const { code } = await applicationBackend.handoff(attempt.value);
const linked = await seams.auth.associateExternalAuth({
  method: 'handoff', walletId, attemptId: attempt.value.attemptId, code,
});
if (!linked.ok) throw new Error(linked.code);
```

For a new NEAR-only wallet, call `registration.registerOwnerWallet` with a wallet-origin passkey and an explicit NEAR signer selection.
The result has `kind: 'wallet_owner_registered'`.
It stores encrypted owner material and leaves the wallet locked.
It issues no reusable session, signing quota, or export capability.
Then associate the application identity as shown above.
This onboarding API initially supports NEAR-only passkey wallets.

## Connect an existing application session

```ts [Partial example]
const attempt = await seams.auth.prepareExternalAuth(walletId);
if (!attempt.ok) throw new Error(attempt.code);
const { code } = await applicationBackend.handoff(attempt.value);
const connected = await seams.auth.authenticate({
  method: 'handoff', walletId, attemptId: attempt.value.attemptId, code,
});
if (!connected.ok) throw new Error(connected.code);
```

The backend reads its verified application session. It never accepts the subject from the browser.
Use `createApplicationAuthAssertion` from `@seams/wallet-server/application-auth` to sign the attempt, wallet, environment, purpose, and session expiry.
Send the assertion as `proof: { kind: 'application', assertion }` to `POST /wallet/external-auth/backend-exchange` with the environment's secret API key.
Return only the handoff code to the browser.

Assertions expire within two minutes.
The hosted wallet retains browser-binding secrets and the session credential.
Read access lasts at most one hour and expires with the authenticated application session.

## Approve one NEAR transaction

```ts [Partial example]
const operation = seams.near.prepareOwnerTransaction({
  authentication: connected.value,
  nearAccountId,
  transaction: {
    receiverId: nearAccountId,
    actions: [{ type: ActionType.Transfer, amount: '1' }],
  },
});
const outcome = await operation.approve();
```

The wallet reviews the complete transaction and requests a fresh passkey assertion.
Server authorization binds that proof to the wallet, signer, network, transaction contents, and expiry.
Warm signing state cannot satisfy this API.
The SDK disposes the temporary signing client after the operation.
A second operation requires another approval.
Cancellation preserves the external read connection.

An existing enrolled passkey and encrypted signing material must be available on the wallet origin in this browser.
A GetSignal passkey authenticates GetSignal. Wallet approval initially uses a wallet-origin owner passkey.
Direct approval with another relying party's passkey is outside this API.

## Observe and recover

Use `operation.getState()` or React's `useOwnerNearOperation(operation)`.
States distinguish `prepared`, `approval`, `submitting`, `completed`, `cancelled`, `expired`, `failed`, `reverted`, and `unknown`.
A React wallet with `access: 'external'` exposes owner-operation handles separately from reusable signing controls.

Persist `state.recovery` as non-secret transaction metadata before starting an operation.
After reload, use `near.resumeOwnerTransaction({ authentication, recovery })`, then call `recover()`.
Recovery reads the recorded transaction hash and queries its outcome. It never broadcasts again.
An unresolved submission blocks another transaction for that wallet connection until recovery settles it.

## Maintained example

See [`examples/seams-auth-menu/application-auth.html`](https://github.com/seams-tech/seams-wallet/blob/dev/examples/seams-auth-menu/application-auth.html).
Its browser component covers onboarding, association, connection, approval, cancellation, and recovery.
Its backend handler accepts the application's verified session reader.
The SDK does not require GetSignal's source or retained Google tokens.

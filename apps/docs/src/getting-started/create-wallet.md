---
title: Create a wallet
description: Register a passkey wallet and handle ready, pending, and failed results.
---

# Create a wallet

Call `registerWallet` in response to a user action, such as a button click. The SDK
opens the passkey prompt and reports progress. It returns a result whose branch
identifies the available capability.

## Register a passkey wallet

Use the hook when your product owns the registration button and result UI.
Render `CreateWalletButton` inside the `SeamsWebProvider` from [Start
here](/). Supply its `registration` prop with an explicit `authMethod`, `wallet`,
and `signerSelection`. Select passkey or email authentication through `authMethod`.
Use `{ kind: "server_allocated" }` for a new server-assigned wallet identity.
The signer selection declares the required NEAR and EVM-family capabilities.

For example, this request creates a passkey wallet with an implicit NEAR account:

```ts
import type { SeamsWeb } from '@seams/wallet';
import { parseWebAuthnRpId } from '@seams/wallet/advanced';

const rpId = parseWebAuthnRpId('wallet.example.com');
if (!rpId.ok) throw new Error(rpId.error.message);

const registration: Parameters<SeamsWeb['registration']['registerWallet']>[0] = {
  authMethod: { kind: 'passkey', rpId: rpId.value },
  wallet: { kind: 'server_allocated' },
  signerSelection: {
    kind: 'signer_set',
    signers: [
      {
        kind: 'near_ed25519',
        accountProvisioning: {
          kind: 'implicit_account',
          accountIdSource: 'ed25519_public_key',
        },
        signerSlot: 1,
        participantIds: [1, 2],
        derivationVersion: 1,
      },
    ],
  },
};
```

Use your wallet origin's relying-party ID in place of `wallet.example.com`.
Pass `registration` to the button below, or call
`seams.registration.registerWallet(registration)` from your own UI.

<<< ../examples/registration.tsx

The example checks `result.success` before logging the result's `kind`. Check the result
branch before reading its fields, such as the NEAR provisioning state.

## Read the result

- `wallet_registered` means the wallet and its returned capabilities are ready.
- `ecdsa_wallet_registered_near_pending` means the EVM-family capability is
  ready while NEAR provisioning is pending or retryable. This branch carries no
  NEAR account ID. Await `seams.registration.waitForNearAccount({ walletId })`
  before signing NEAR.
- `near_wallet_registered_pending` means NEAR provisioning still needs to
  reach a ready state before you read a NEAR account.
- `wallet_signer_added` means a signer was added to an existing wallet.
- `success: false` contains the error text to show or log for the current
  attempt.

The returned `walletId` is the stable wallet identifier used by signing, session
provisioning, and every other operation on that wallet. Store it with your application
account record. Never store passkey or holder secrets in application state.

## If registration stops

Passkey cancellation ends the current attempt. Let the person start a new attempt from
the same button. A retryable NEAR provisioning result preserves the wallet identity.
Check provisioning before offering a retry. Do not register a second wallet:

- `seams.registration.waitForNearAccount({ walletId })` waits for provisioning to
  settle and resolves with `near_ready`, `near_failed_retryable`, or
  `timed_out`. It never rejects unless you abort it with a `signal`.
- `seams.registration.getNearAccountState({ walletId })` reads the current
  state without waiting.

Origin, publishable-key, and authentication errors require configuration or
account changes before retrying.

## Continue

[Sign an operation with policy](/getting-started/sign-with-policy).

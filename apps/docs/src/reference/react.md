---
title: React SDK
description: Providers, hooks, components, hosted auth surfaces, and theme exports available from @seams/wallet/react.
---

# React SDK

Import React integrations from `@seams/wallet/react` and place consumers inside a
`SeamsWebProvider` or `SeamsContextProvider`.

```tsx [Import example]
import { SeamsWebProvider, HostedSeamsAuthMenu, useSeams } from '@seams/wallet/react';
```

## Providers and hooks

| Export                                            | Purpose                                                 |
| ------------------------------------------------- | ------------------------------------------------------- |
| `SeamsWebProvider`                                | Creates and owns the SDK client for a React subtree.    |
| `SeamsContextProvider`                            | Supplies an existing context value.                     |
| `useSeams`                                        | Reads the current SDK capabilities and lifecycle state. |
| `useWallet`                                       | The signed-in wallet, with signing bound to it.         |
| `useWalletAuth`                                   | The sign-in, sign-out, and registration slice.          |
| `useWalletDevices`                                | The linked-device slice.                                |
| `useDeviceLinking`                                | Runs the approving-device side of a link flow.          |
| `useNearClient`, `useAccountInput`, `useQRCamera` | Focused integration helpers.                            |

### `useWallet`

Returns `{ status, wallet, near, evm, tempo, walletId, nearAccountId }`. `near`, `evm`,
and `tempo` are top-level fields. Check the relevant field before signing:

```tsx [Partial example]
const { near } = useWallet();
if (!near) return <SignInButton />;

await near.signAndSendTransaction({
  receiverId: 'guest-book.testnet',
  actions: [functionCall({ method: 'set_greeting', args: { greeting: 'hi' } })],
});
```

`near` is `null` both when nobody is signed in and when the signed-in wallet has
no NEAR account. Read `status` — `'signed_out' | 'no_near_account' | 'ready'` —
when the UI needs to say something different about each.

`useWalletAuth` and `useWalletDevices` read different parts of the same context.
`useSeams` exposes the complete context.

### Refresh session and account input

Use `refreshSession(walletId?)` from `useSeams` or `useWalletAuth` to refresh
React's session display after a wallet operation. It returns `Promise<void>`.
Use `getSession` when you need the session result itself.

Use `setAccountName(name)` from `useSeams` or `useAccountInput` to update the
account input. It retains lowercase normalization and saved-wallet matching.

## Components

The stable surface includes `HostedSeamsAuthMenu`, `WalletSettingsPage`,
`AccountMenuButton`, `ProfileSettingsButton`, `QRCodeScanner`, and `ShowQRCode`. Use the
hosted auth menu when the wallet-origin boundary owns the complete auth experience.
`SeamsAuthMenuMock` is a loading placeholder and preview with no active controls.
`HostedSeamsAuthMenu` shows it while the wallet UI opens.

`AccountMenuButtonMock` is an interactive, provider-free account-menu preview.
It shares the connected `AccountMenuButton` renderer, including the authentication-methods
view and enrollment rows. The connected menu supplies its live wallet inventory and
authenticated actions; the preview supplies sample data. Navigation, confirmation
preferences, device details, recovery previews, and locking use local state.
It never creates a wallet session, signs, exports keys, requests camera access,
or accesses wallet storage. Export keys opens the shared key-selection screen. Its sample NEAR and EVM
choices show an authentication-required summary.

```tsx
import { AccountMenuButtonMock } from '@seams/wallet/react/profile';
import '@seams/wallet/react/styles';

<AccountMenuButtonMock username="Alex Chen" walletId="alex.near" theme="light" />;
```

Use `defaultOpen={false}` to start collapsed. All screens stay inside one panel;
there is no overlay backdrop. The panel animates its measured height between screens,
and respects reduced-motion preferences. Authentication methods opens directly for the current wallet, with separate
Passkey and Email OTP rows. Device linking is available from the main menu.
Transaction settings open in a separate resizing screen. The scanner is a static
camera preview. The recovery preview shows four distinct 16-digit sample codes. Method rows display enrollment rather than selectable preferences.
Live enrollment and removal retain authenticated SDK operations.
The preview never starts wallet operations or reveals real signing keys.

`WalletSettingsPage` provides account, auth-method, recovery-code, linked-device,
export, and transaction-preference settings. It uses the same provider and
wallet-origin operations. Signed-out users see hosted authentication. The page
also shows the wallet region setting, which moves the wallet to another region when
the deployment and the current device allow it. The setting uses
`useSeams().seams.placement`. See [Wallet region](/reference/core#wallet-region) for
the calls, their results, and the unlock that each device needs after a move.

Focused entrypoints are available for applications that need smaller or
SSR-specific imports:

- `@seams/wallet/react/provider`.
- `@seams/wallet/react/profile`.
- `@seams/wallet/react/hosted-seams-auth-menu`.
- `@seams/wallet/react/styles`.

## Custom transaction review

Mount `TransactionReviewHost` beneath the wallet provider, then pass `review` to
`near.signAndSendTransaction` or the EVM and Tempo
`signTransaction` and `signAndSendTransaction` methods returned by `useWallet()`.

| Export                       | Purpose                                                                   |
| ---------------------------- | ------------------------------------------------------------------------- |
| `TransactionReviewHost`      | Hosts app review content in the SDK dialog.                               |
| `TransactionReview`          | Requires `title`, `validity`, and `render`. Accepts optional `className`. |
| `TransactionReviewControls`  | `continueToWallet()`, `cancel()`, and `fail(error)`.                      |
| `TransactionReviewValidity`  | `{ kind: 'unbounded' }` or `{ kind: 'expires_at', atMs: number }`.        |
| `TransactionReviewError`     | Review failure class with a typed `code`.                                 |
| `TransactionReviewErrorCode` | Union of review failure codes.                                            |

The renderer returns React content synchronously. Continue leads to a separate
wallet approval. Hosted iframe mode, modal confirmation, and explicit approval
are required. See the [guide and compiled example](/guides/transaction-review)
for setup, expiry, error handling, and styling.

## Appearance

`Theme`, `useTheme`, `LIGHT_TOKENS`, `DARK_TOKENS`, and `SHAPE_PRESETS` style
app-owned React surfaces. Send the corresponding appearance into the browser
SDK for wallet-iframe surfaces. See the [theming guide](/guides/theming).

## React boundary

Keep credential prompts and signing actions attached to a direct user action.
Render loading, success, cancelled, and recoverable failure branches from the
result union instead of collapsing them into a Boolean.

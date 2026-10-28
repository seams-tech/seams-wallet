---
title: React SDK
description: Providers, hooks, components, hosted auth surfaces, and theme exports available from @seams/wallet/react.
---

# React SDK

For Seams authentication and custody, import React integrations from `@seams/wallet/react` and place consumers inside a
`SeamsWebProvider` or `SeamsContextProvider`.

```tsx [Import example]
import { SeamsWebProvider, HostedSeamsAuthMenu, useSeams } from '@seams/wallet/react';
```

## External NEAR bindings

The development preview uses `@seams/wallet/react/external-near`.
Its picker and hook require an `ExternalNearController`, independently of the
Seams providers below. The picker disconnects on unmount; the hook only subscribes.
See the [compiled example and availability notice](/guides/external-near-wallets#react-example).

The picker displays only the controller's configured `wallets`. Change the list
with `setWallets`; an empty list disables every wallet. See
[wallet selection configuration](/reference/configuration#external-near-wallet-selection).

## Providers and hooks

| Export                                            | Purpose                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| `SeamsWebProvider`                                | Creates and owns the SDK client for a React subtree.                     |
| `SeamsContextProvider`                            | Supplies an existing context value.                                      |
| `useSeams`                                        | Authentication, lifecycle state, and the current wallet's bound signers. |
| `useWalletAuth`                                   | The sign-in, sign-out, and registration slice.                           |
| `useWalletDevices`                                | The linked-device slice.                                                 |
| `useDeviceLinking`                                | Runs the approving-device side of a link flow.                           |
| `useNearClient`, `useAccountInput`, `useQRCamera` | Focused integration helpers.                                             |

### `useSeams`

Use one hook for authentication and signing. `unlock`, `lock`, and `registerWallet`
remain available while signed out. `wallet` is `null` until authentication succeeds.
The authenticated wallet provides `near`, `evm`, `tempo`, and `exportKey`.
Check the relevant signer before signing:

```tsx [Partial example]
const { unlock, wallet } = useSeams();
if (!wallet?.near) return <SignInButton onUnlock={unlock} />;

await wallet.near.signAndSendTransaction({
  receiverId: 'guest-book.testnet',
  actions: [functionCall({ method: 'set_greeting', args: { greeting: 'hi' } })],
});
```

`wallet.near` is `null` when the authenticated wallet has no NEAR account.
`wallet.evm` and `wallet.tempo` remain available in that state. Each signer binds
requests to the wallet that the component rendered. Use `wallet.walletId` for
its identity and `wallet.near.accountId` for its NEAR account.

After `unlock` succeeds, React supplies the authenticated wallet in a subsequent
render. A handler retains the wallet from its own render. Keep unlock and signing
in their respective user actions.

`useWalletAuth` and `useWalletDevices` read different parts of the same context.
`useSeams` exposes the complete context.

### Refresh session and account input

Use `refreshSession(walletId?)` from `useSeams` or `useWalletAuth` to refresh
React's session display after a wallet operation. It returns `Promise<void>`.
Use `getSession` when you need the session result itself.

Use `setAccountName(name)` from `useSeams` or `useAccountInput` to update the
account input. It retains lowercase normalization and saved-wallet matching.

## Components

The stable surface includes `WalletConnectorMenu`, `HostedSeamsAuthMenu`, `WalletSettingsPage`,
`AccountMenuButton`, `ProfileSettingsButton`, `QRCodeScanner`, and `ShowQRCode`. Use the
hosted auth menu when the wallet-origin boundary owns the complete auth experience.
`SeamsAuthMenuMock` is a loading placeholder and preview with no active controls.
`HostedSeamsAuthMenu` shows it while the wallet UI opens.

### Wallet connector menu

Use `WalletConnectorMenu` for the default “Connect wallet” panel. It offers a Seams
wallet and the external NEAR wallets enabled by your controller. Selecting Seams
resizes the panel into `HostedSeamsAuthMenu`. Authentication remains on the wallet
origin. The component uses the provider's theme tokens and supports reduced motion.

```tsx [Partial example]
import { WalletConnectorMenu } from '@seams/wallet/react/hosted-seams-auth-menu';
import { ExternalNearController } from '@seams/wallet/external-near';
import '@seams/wallet/react/styles';

const nearWallets = new ExternalNearController({
  network: 'testnet',
  rpcUrl: 'https://rpc.testnet.near.org',
  wallets: ['meteor'],
});

<WalletConnectorMenu
  onOutcome={handleSeamsOutcome}
  externalNear={{ controller: nearWallets, onConnected: handleExternalConnection }}
  title="Connect wallet"
  options={{
    seams: { label: 'Create a wallet', description: 'Start with a passkey' },
    meteor: { label: 'Connect Meteor', icon: <MeteorIcon /> },
  }}
  authMenu={{ initialMode: 'register' }}
/>;
```

Mount the component inside `SeamsWebProvider`. `externalNear` is optional. Without it,
the panel offers only Seams. The controller's `wallets` list controls the enabled
wallets and their order, including changes through `setWallets`.

Customize `title`, `description`, `closeLabel`, `backLabel`, `className`, and `style`. The `options`
map accepts `label`, `description`, and a React `icon` for `seams`, `meteor`, `hot`,
and `intear`. Pass authentication copy and provider options through `authMenu`.
Configure colors and corners through the existing provider appearance settings.
Meteor and HOT use bundled official wallet icons by default. App-supplied icons override them.

When opened from the connector, the auth view includes a back button that returns to
wallet selection and cancels the pending auth session without calling `onClose`.
The standalone `HostedSeamsAuthMenu` does not show this connector navigation button.

Supply `onClose` to show a close button. Canceling authentication returns to the
connector and calls `onClose` when supplied. Authentication failures return to the
connector with an error. Every auth outcome also reaches `onOutcome`.

External connection success calls `externalNear.onConnected`. The app owns that
controller: closing the connector preserves a completed connection. Unmounting
while an external connection is pending cancels that pending request.

`AccountMenuButton` defaults to `presentation="dropdown"` and includes the SDK trigger.
Use `presentation="modal"` to open the same settings from an application button.
Modal mode requires both `isMenuOpen` and `onMenuOpenChange` and renders no SDK trigger.

```tsx [Partial example]
import { useState } from 'react';
import { AccountMenuButton, useSeams } from '@seams/wallet/react';
import '@seams/wallet/react/styles';

function WalletSettingsControl() {
  const [open, setOpen] = useState(false);
  const { loginState } = useSeams();
  return (
    <>
      <button type="button" onClick={setOpen.bind(null, true)}>
        Wallet settings
      </button>
      <AccountMenuButton
        nearAccountId={loginState.nearAccountId}
        presentation="modal"
        isMenuOpen={open}
        onMenuOpenChange={setOpen}
      />
    </>
  );
}
```

Mount this control inside `SeamsWebProvider`. The modal renders in a themed portal under `document.body`.
It traps focus, blocks background interaction and scrolling, and restores focus when closed.
Escape, the close button, and a backdrop click call `onMenuOpenChange(false)`.
You can also close it by setting `open` to `false`. Closing resets its navigation.
`ProfileSettingsButton` and `AccountMenuButtonMock` accept the same presentation and control props.
Controlled dropdowns also require `onMenuOpenChange` when you pass `isMenuOpen`.

The menu's anchor element (`[data-seams-auth-menu-host]`) gets
`data-seams-auth-menu-ready="true"` in the frame where the measured menu appears.
The anchor reserves the menu's height from that frame on. If your page draws its own
controls around the menu, such as a close button, show them from that attribute so
that they appear with the card and at its final place:

```css
.my-auth-dialog .my-close-button {
  opacity: 0;
}
.my-auth-dialog:has([data-seams-auth-menu-ready]) .my-close-button {
  opacity: 1;
}
```

A signed-out page does not download the wallet's sign-in code until a sign-in starts.
If you mount `HostedSeamsAuthMenu` only after a click, call
`useSeams().seams.authMenu.prepare()` on pointer, focus or touch on your sign-in
control. The download then starts before the click.

`AccountMenuButtonMock` is an interactive, provider-free account-menu preview.
It shares the connected `AccountMenuButton` renderer, including the authentication-methods
view and enrollment rows. The connected menu supplies its live wallet inventory and
authenticated actions; the preview supplies sample data. Navigation, confirmation
preferences, device details, recovery previews, and locking use local state.
It never creates a wallet session, signs, exports keys, requests camera access,
or accesses wallet storage. Export keys opens the shared key-selection screen. Its sample NEAR and EVM
choices show an authentication-required summary.

```tsx [Partial example]
import { AccountMenuButtonMock } from '@seams/wallet/react/profile';
import '@seams/wallet/react/styles';

<AccountMenuButtonMock username="Alex Chen" walletId="alex.near" theme="light" />;
```

Use `defaultOpen={false}` to start the dropdown preview collapsed. All screens stay inside one panel.
Dropdown mode has no overlay backdrop. Modal previews use controlled `isMenuOpen` and `onMenuOpenChange` props.
The panel animates its measured height between screens,
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
`signTransaction` and `signAndSendTransaction` methods on `useSeams().wallet`.

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

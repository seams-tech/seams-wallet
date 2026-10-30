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

The stable surface includes `HostedSeamsAuthMenu`, `WalletSettingsPage`,
`AccountMenuButton`, `ProfileSettingsButton`, `QRCodeScanner`, and `ShowQRCode`. Use the
hosted auth menu when the wallet-origin boundary owns the complete auth experience.
`SeamsAuthMenuMock` is a loading placeholder and preview with no active controls.
`HostedSeamsAuthMenu` shows it while the wallet UI opens.

### Wallet alternatives

`HostedSeamsAuthMenu` combines Seams authentication and external wallet connections
in one wallet-origin screen. Pass `walletAlternatives` to choose the groups and order.
Omit it to hide both groups. Empty arrays hide their own headings and controls.

```tsx [Partial example]
import { HostedSeamsAuthMenu } from '@seams/wallet/react';
import { ExternalNearController } from '@seams/wallet/external-near';

const nearWallets = new ExternalNearController({
  network: 'testnet',
  rpcUrl: 'https://rpc.testnet.near.org',
  wallets: ['meteor'],
});

<HostedSeamsAuthMenu
  onOutcome={handleOutcome}
  walletAlternatives={{
    primary: [
      {
        kind: 'near',
        wallet: 'meteor',
        controller: nearWallets,
        onConnected: handleNearConnection,
      },
    ],
    secondary: [],
  }}
/>;
```

Primary entries appear under “Or connect another wallet”. Secondary entries appear
inside “More wallets”, initially collapsed. “Recover or link wallet” contains device
linking and recovery. Wallet icons retain their original colors.

Set `recoveryOptions` to `"collapsible"` (default), `"expanded"`, or `"hidden"`.
Use `footerBrand` to replace the complete “Secured by seams” line with your logo.
The logo must use an absolute HTTPS URL or an image data URL. `name` supplies its
accessible text. Relative URLs would resolve against the wallet origin.
The wallet host must allow remote image origins in its CSP `img-src` directive.
Use an image data URL when the host permits only local images.

```tsx [Partial example]
<HostedSeamsAuthMenu
  onOutcome={handleOutcome}
  recoveryOptions="expanded"
  footerBrand={{
    kind: 'custom',
    logo: 'https://example.com/logo.svg',
    name: 'Example application',
  }}
/>
```

Omit `footerBrand`, or use `{ kind: 'seams' }`, to restore the default branding.
Connection notices temporarily replace either brand line.

Each entry accepts optional `label`, `description`, and `icon` display overrides.
`icon` is an HTTPS image URL or an image data URL. React elements and callbacks stay
outside the iframe. The SDK sends only the display descriptors across that boundary.
Identifiers must be unique across both groups.

For EVM entries, use `kind: 'evm'`, an `ExternalEvmController`, and a wallet object
from its discovery snapshot. Mount discovery in the application with `useExternalEvm`.
Pass a typed EVM `onConnected` callback. MetaMask and Rabby use the same connector.
Discovery alone never adds wallets to the menu. The application selects the entries.
Keep the controller mounted for the lifetime of the application's connection.

A successful connection calls the entry's `onConnected` callback and emits a
`wallet_connected` menu outcome with `alternativeId`. This outcome establishes no
Seams session. Closing the menu preserves a completed external connection. Closing
during a pending request invalidates it and ignores its later result.

The low-level `authMenu.open()` request accepts the same serializable groups.
Applications handle `authMenu.onWalletConnectionRequest()` and reply through
`authMenu.resolveWalletConnection()`. Requests carry the menu session, request
identity, and configured `alternativeId`. The React component handles this exchange.

`AccountMenuButton` defaults to `presentation="dropdown"` and includes the SDK trigger.
Use `presentation="modal"` or `presentation="drawer"` to open the same settings from an application button.
Both modes require `isMenuOpen` and `onMenuOpenChange` and render no SDK trigger.

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
        presentation="drawer"
        isMenuOpen={open}
        onMenuOpenChange={setOpen}
      />
    </>
  );
}
```

Mount this control inside `SeamsWebProvider`. Settings render in a themed portal under `document.body`.
The drawer opens from the inline-end edge on desktop and from the bottom at widths up to 600px.
Its header and footer stay visible while the content scrolls. Colors, spacing, corners, and shadow follow SDK theme tokens.
It slides for 240ms and respects reduced motion. An interrupted close can reopen the same dialog.
Use `presentation="modal"` for the centered dialog.
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

---
title: UI components
description: The ready-made React components in @seams/wallet/react, what each one renders, and where to find its props and examples.
---

# UI components

`@seams/wallet/react` ships ready-made components for sign-in, wallet settings,
device linking, and transaction review. Import the stylesheet once, and mount every
component except the mocks inside `SeamsWebProvider`.

```tsx [Import example]
import { SeamsWebProvider, HostedSeamsAuthMenu, AccountMenuButton } from '@seams/wallet/react';
import '@seams/wallet/react/styles';
```

## Component list

| Component                 | Renders                                                                       | Needs the provider |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------ |
| `HostedSeamsAuthMenu`     | The complete sign-in, registration, and recovery menu on the wallet origin.   | Yes                |
| `SeamsAuthMenuMock`       | A static preview of the auth menu with no active controls.                    | No                 |
| `AccountMenuButton`       | An account button that opens wallet settings as a dropdown, modal, or drawer. | Yes                |
| `ProfileSettingsButton`   | The same component as `AccountMenuButton`, under a second name.               | Yes                |
| `AccountMenuButtonMock`   | An interactive account-menu preview with sample data.                         | No                 |
| `WalletSettingsPage`      | Full-page wallet settings. Signed-out users see hosted authentication.        | Yes                |
| `WalletBalances`          | The settings balance card, for your own wallet panel.                         | Yes                |
| `ShowQRCode`              | The new device's link code, from start to expiry.                             | Yes                |
| `QRCodeScanner`           | The existing device's camera scanner and link approval.                       | Yes                |
| `TransactionReviewHost`   | The dialog for your own review content before wallet approval.                | Yes                |
| `ExternalEvmWalletPicker` | A picker for injected EVM wallets.                                            | No                 |
| `Theme`                   | Theme tokens for every component below it.                                    | No                 |

The package also exports the small icons `TouchIcon`, `QRCodeIcon`, `SunIcon`, and
`MoonIcon` for your own controls.

Focused entrypoints give smaller or SSR-specific imports:

- `@seams/wallet/react/hosted-seams-auth-menu` for the auth menu and its mock.
- `@seams/wallet/react/profile` for the account menu, its mock, and the settings page.
- `@seams/wallet/react/provider` for `SeamsWebProvider`.
- `@seams/wallet/react/external-near` for the external NEAR picker (development preview).

## Sign-in

`HostedSeamsAuthMenu` puts the full auth experience on the wallet origin. Your page
gets one outcome per mounted session through `onOutcome`. The main optional props are:

- `initialMode` selects the first view. The default is sign-in.
- `walletAlternatives` adds external NEAR and EVM wallets to the menu.
- `recoveryOptions` shows, collapses, or hides recovery and device linking.
- `footerBrand` replaces the “Secured by seams” line with your logo.
- `copy` overrides the menu text.
- `placeholder` shows your own inert content while the menu loads.

See [hosted auth menu](/reference/react#wallet-alternatives) for each prop and
[authentication](/guides/authentication) for the sign-in flow.

## Wallet settings

`AccountMenuButton` opens the balance, account, auth-method, recovery-code,
linked-device, export, and transaction settings. It needs `nearAccountId`. The default
`presentation="dropdown"` includes the SDK trigger button. With `"modal"` or
`"drawer"`, your own button opens the settings through `isMenuOpen` and
`onMenuOpenChange`.

`WalletSettingsPage` shows the same settings as a full page. It also shows the
wallet region setting. See [React components](/reference/react#components)
for the presentation modes, the drawer behaviour, and the region setting.

### Balances, receive, and send

The settings overview starts with a balance card. It shows the three leading balances,
an **All assets** link, and **Receive** and **Send**.

- **Assets** lists each asset on the wallet's own list for the configured chains. On
  NEAR mainnet these are NEAR, stNEAR, USDC, USDt, ETH, BTC, SOL, and ZEC. BTC, SOL, and
  ZEC are NEAR Intents tokens on NEAR. On NEAR testnet the list is NEAR, stNEAR, and
  USDC. EVM chains add their native coin and listed tokens.
- **Receive** shows the wallet's address for one asset, a QR code, and the network it
  must arrive on. It receives only on that network.
- **Send** checks the amount and the recipient, then opens the wallet's confirm card.
  Nothing is signed before the user confirms. A token recipient without token storage
  gets a `storage_deposit` in the same transaction. If the amount is more than the
  balance, Send offers **Receive** for the same asset.

A balance that cannot be read shows as **Unavailable**, never as zero. Amounts show
without prices. `WalletBalances` renders the same card in your own panel. Without
handlers, its buttons open the matching screen of the mounted settings panel. Pass
`onReceive`, `onSend`, and `onOpenAssets` to open your own flow instead.
`seams.assets.openScreen()` opens these screens from your own code.
`seams.assets` gives the same data without UI; see
[core reference](/reference/core#asset-balances).

## Device linking

Device linking uses two components, one on each device:

1. On the new device, `ShowQRCode` starts a link session and shows its code.
2. On the existing device, `QRCodeScanner` reads the code and runs the approval.

<<< ../examples/qr-code-scanner.tsx

`QRCodeScanner` calls `onQRCodeScanned` after the new device is active, and then
calls `onClose`. `onEvent` receives each link progress event. If the session expires,
the scanner shows an expiry screen. If the person closes the scanner during a link,
the scanner cancels the link.

| Prop              | Purpose                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `isOpen`          | Starts and stops the camera. The default is `true`.              |
| `presentation`    | `"modal"` (default) for a dialog or `"embedded"` for inline use. |
| `cameraId`        | Selects a camera. The default is the browser's choice.           |
| `showCamera`      | Set to `false` to keep the camera off.                           |
| `onQRCodeScanned` | Receives the scanned payload after the link succeeds.            |
| `onEvent`         | Receives each `LinkDeviceFlowEvent`.                             |
| `onError`         | Receives camera and link failures.                               |
| `onClose`         | Runs once when the scanner closes.                               |

The account menu already includes a scanner. Use `deviceLinkingScannerParams` on
`AccountMenuButton` to receive its events. See [linked devices](/guides/linked-devices)
for the flow and [advanced wallet operations](/examples/advanced-wallet-operations)
for the `ShowQRCode` example.

## External wallets

`ExternalEvmWalletPicker` lists the injected EVM wallets that `useExternalEvm`
discovers. It takes the controller and its snapshot. See
[external EVM wallets](/guides/external-evm-wallets).

## Transaction review

`TransactionReviewHost` shows your own React content before the wallet approval.
Pass `review` to a signing method on `useSeams().wallet`. See
[custom review components](/guides/transaction-review).

## Previews without a wallet

`SeamsAuthMenuMock` and `AccountMenuButtonMock` need no provider. They never create
a session, sign, export keys, or read wallet storage. Use them for design reviews,
loading states, and marketing pages.

```tsx [Partial example]
import { AccountMenuButtonMock } from '@seams/wallet/react/profile';
import '@seams/wallet/react/styles';

<AccountMenuButtonMock username="Alex Chen" walletId="alex.near" theme="light" />;
```

## Appearance

All components read the `Theme` tokens. Wallet-origin surfaces, such as the auth
menu and the transaction confirmer, read the appearance that you send to the SDK.
Drive both from the same preset. See [theming](/guides/theming) and
[UI customization](/examples/ui-customization).

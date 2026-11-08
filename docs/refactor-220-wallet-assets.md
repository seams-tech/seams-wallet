# Refactor 220: wallet assets, receive and send in Settings

Status: complete, 2026-11-08. Phase 1 is built on `dev` for the 0.55.0 SDK release. The owner
decided that Phases 2 and 3 are not built (see "Decisions"). The front page tasks wait for the
0.55.0 release (see "Front page demo components").

## Result

The Settings panel gets one new part, **Assets**:

- A balance card on the overview screen. It shows the three largest balances, an "All assets" link,
  and two actions: Receive and Send.
- Three new screens: Assets, Receive and Send.
- A public read, `seams.assets.read()`, that the panel and applications use.
- A standalone `<WalletBalances>` component for an application's own wallet panel.

The panel stays anchored to its button. The drawer and modal presentations show the same screens.

The assets are NEAR, stNEAR, USDC, USDT, ETH, SOL, ZEC and BTC.

## Facts this plan builds on

- The SDK has no public balance read. The only balance read is the internal NEAR shortfall check,
  `ownerNearShortfall` in `packages/wallet/src/SeamsWeb/walletIframe/host/ownerNearAffordability.ts`.
  It reads `view_account` and computes the storage reserve (10^19 yoctoNEAR per stored byte).
- `KNOWN_NEAR_TOKENS` in `packages/wallet/src/core/signingEngine/chains/near/tokenTransfers.ts` is the
  wallet's own token list for the transfer review. On mainnet it lists all eight assets:
  `wrap.near`, `meta-pool.near`, native USDC, `usdt.tether-token.near`, `USDT.e`, `eth.bridge.near`,
  `btc.omft.near`, `nbtc.bridge.near`, WBTC, `sol.omft.near` and `zec.omft.near`.
  The `*.omft.near` tokens are NEAR Intents bridge tokens.
- On testnet the list has only USDC, wNEAR and stNEAR (`meta-v2.pool.testnet`).
- Official artwork for all eight assets is in
  `packages/wallet/src/core/signingEngine/uiConfirm/ui/preact/TokenIcon.tsx`. It is Preact and the
  review card uses it. The Settings panel is React.
- The shared NEAR client has `viewAccount`, `view` and `callFunction`
  (`packages/shared-ts/src/near/nearClient.ts`). `seams.near.accountExists` already reads through the
  application's RPC client before connection (spec: "Public account queries").
- `createEvmClient` (`packages/wallet/src/core/rpcClients/evm/EvmClient.ts`) sends `eth_call`
  for the Tempo fee token. No code reads `eth_getBalance` or ERC-20 `balanceOf` yet.
- The configured networks are `near-*`, `tempo-*`, `arc-*` and `ethereum-*`
  (`packages/wallet/src/core/config/chains.ts`).
- The Wallet has no Bitcoin, Solana or Zcash signer. BTC, SOL and ZEC exist in this wallet only as
  tokens on NEAR.
- The menu routes are `AccountMenuRoute` in `packages/wallet/src/react/components/AccountMenuButton/index.tsx`.
  The groups are in `ProfileDropdown.tsx`. Each sub-screen uses `AccountMenuScreen`.
- `qrcode` 1.5.4 is a dependency. Device linking loads it on demand.
- A VoiceID session signs only reviewed calls (`packages/wallet/src/react/transactionReview/boundCalls.ts`).

## Terms

Each term names one thing in this plan and in the UI copy.

- **asset** — one token contract (or native coin) on one network. USDC on NEAR and USDC on Arc are
  two assets.
- **asset list** — the wallet's own list of assets. It is the one source for names, decimals,
  artwork and "verified". It extends `KNOWN_NEAR_TOKENS`; it does not copy it.
- **available** — the amount the wallet can send now. For NEAR it is the balance minus the storage
  reserve. For a token it is `ft_balance_of`.
- **receive** — funds that arrive in this wallet from outside.
- **send** — funds that leave this wallet to an address that the user enters.
- **app account** — a balance that an application holds for the user in its own contract.
  The SDK does not read it in Phases 1 and 2.

## Decisions

The owner decided on 2026-11-08:

1. The wallet uses "Receive" and "Send". The 0.53.0 and 0.54.0 releases used "Deposit" and
   "Withdraw"; 0.55.0 renames them (see "Built").
2. BTC, SOL and ZEC stay NEAR tokens. Phase 2 is not built.
3. No prices. Phase 3 prices are not built.
4. Option B: the application keeps its own app account. Phase 3 app accounts are not built.

The questions as the plan asked them:

1. **Action words.** An application can use "Deposit" to mean "move funds from the wallet into the
   app". If the wallet uses "Deposit" to mean "receive into the wallet", one page shows one word with
   two meanings. Recommendation: the wallet uses "Receive" and "Send"; applications keep "Deposit"
   and "Withdraw" for app accounts. The mockup uses "Deposit" and "Withdraw".
2. **BTC, SOL and ZEC from their own networks.** A native deposit needs the NEAR Intents bridge,
   which holds the native coins. That adds a trusted party. Recommendation: Phase 1 shows these
   assets as NEAR tokens only; Phase 2 waits for this decision.
3. **Prices.** A total in dollars needs a price source. Recommendation: Phase 1 shows amounts only.
4. **App account.** Option A: an `appAccount` prop gives the label, the balance and the deposit and
   withdraw transactions; the SDK shows them and the review step checks each transaction.
   Option B: the application keeps this part. Recommendation: B until an integrator asks for A.

## Design

### Asset list

- Move the asset data out of `tokenTransfers.ts` into one module, for example
  `packages/wallet/src/core/assets/assetList.ts`. The transfer review and the balance read both
  import it.
- Each entry has: network, contract (or `native`), symbol, display name, decimals, artwork key,
  display order and, for bridged tokens, the bridge name.
- Add the EVM entries: Arc USDC and Ethereum ETH. Add Tempo entries only if a Tempo asset is wanted.
- Keep one row for each contract. Do not add two contracts together (for example `btc.omft.near`
  and `nBTC`), because a send needs one exact contract. A variant with a zero balance stays hidden.
- On testnet, list only the assets that exist there. The Assets screen says that the other assets
  are on mainnet only.

### Balance read

- Public API: `seams.assets.read({ walletId? })`. It returns an `AssetBalances` value:
  one entry per asset, each `{ kind: 'read', available, total?, reserved? }` or
  `{ kind: 'unavailable', reason }`. A failed read never shows as 0.
- NEAR native: `viewAccount`. Share the storage-reserve math with `ownerNearShortfall`, so that
  "available" and the shortfall error never disagree.
- NEP-141: `ft_balance_of` through `view`, one call per contract, in parallel, with a timeout.
- EVM native: `eth_getBalance`. ERC-20: `balanceOf` through `eth_call`.
- The read uses the application's RPC configuration, as `accountExists` does. It needs no secret,
  so it does not go through the wallet iframe.
- Refresh: when the panel opens, after each transaction that the SDK sends, and every 15 s while the
  Assets screen is open. No poll while the panel is closed.
- `seams.assets.onChange(listener)` lets an application show the same values.

### Shared artwork

- Move the SVG artwork from `TokenIcon.tsx` into a framework-free module (SVG markup or path data).
  The Preact review card and the React panel both render from it. The review keeps its rule:
  official artwork only for an asset on the asset list.

### Settings overview

- `BalancesCard` sits between the identity row and the Wallet group.
- It shows the three largest balances by amount (no prices in Phase 1, so "largest" means
  non-zero first, then the asset list order), then "All assets · N", then Receive and Send.
- Signed out or locked: the card is not shown.
- Read failure: the card shows "Balances unavailable" and a Retry action.

### Assets screen (route `assets`)

- One row per asset: artwork, symbol, network chip, display name, available amount.
- NEAR shows the storage reserve under its name.
- Zero amounts use the muted text color.
- Receive and Send stay at the bottom.

### Receive screen (route `receive`)

- Asset field, network choice, QR code, the full address, Copy address, and a warning:
  "Send only <asset> on <network> to this address."
- NEAR assets show the NEAR account id. EVM assets show the EVM address.
- Opens with an asset already chosen when it starts from a balance error or from
  `seams.assets.openScreen`.

### Send screen (route `send`)

- Asset field with the available amount, amount field with Max, recipient field.
- NEAR recipient: check that the account exists (`accountExists`). Token send: check
  `storage_balance_of`; if the recipient has no storage, add `storage_deposit` and show its cost.
- EVM recipient: check the address format and checksum.
- Max keeps the gas allowance for a native coin.
- "Review and send" sends the transaction through the existing review card. Nothing is signed
  before the user confirms. A VoiceID session can send, because the call is reviewed.
- A balance error on Send offers "Receive <asset>", which opens Receive for that asset.
- The owner shortfall error reaches the application, not an SDK screen: the card closes before
  the passkey prompt. `seams.assets.openScreen({ screen: 'receive', assetId })` lets the
  application offer "Receive NEAR" for it.

### Full settings page and other presentations

- The `page` layout (`WalletSettingsLayout`) gets an Assets section with the same content.
- Drawer and modal presentations use the same routes. No new presentation.

### Standalone component

- Export `<WalletBalances>` from `@seams/wallet/react`. It takes `onReceive?`, `onSend?` and
  `onOpenAssets?`. With no handlers, its buttons open the SDK Assets, Receive and Send screens
  through `seams.assets.openScreen`.

## Phases

### Phase 1 — balances and same-network receive and send

Done on `dev` (commits `88dafc404`, `70bcf4804` and the completion commit).

1. Move the asset list into its own module; the transfer review imports it. No behaviour change.
2. Move token artwork into a shared module; the review card renders from it. No visual change.
3. Add `seams.assets.read` and `seams.assets.onChange`, with the typed `unavailable` state.
4. Share the storage-reserve math between the balance read and `ownerNearShortfall`.
5. Add `BalancesCard` and the `assets` route.
6. Add the `receive` route with the QR code from `qrcode`.
7. Add the `send` route: NEAR native, NEP-141 with storage registration, EVM native and ERC-20.
8. Add "Receive <asset>" to the Send balance errors, and `seams.assets.openScreen` so that an
   application can offer "Receive NEAR" for the owner shortfall.
9. Add the Assets section to the full settings page.
10. Add the locale strings (English and Japanese) for every new string.
11. Export `<WalletBalances>`.
12. Add the same screens to `AccountMenuButtonMock` and `AccountMenuMockScreens`, with fixed sample
    balances, so that showcases can render them with no wallet.

### Phase 2 — BTC, SOL and ZEC from their own networks

Not built: Decision 2 keeps BTC, SOL and ZEC as NEAR tokens. The plan was:

1. Receive: request a NEAR Intents deposit address for the asset and show it with its own warning.
2. Send: a NEAR Intents withdrawal to a native address, through the review card.
3. The review card names the bridge as a party to the transfer.

### Phase 3 — prices and app accounts

Not built: Decision 3 keeps amounts without prices, and Decision 4 leaves app accounts to the
application.

## Built

- `seams.assets`: `list`, `read`, `onChange`, `prepareSend` and `openScreen`. `prepareSend`
  replaces 0.53.0's `prepareWithdrawal`; the types are `SendRequest`, `SendRejection` and
  `PreparedSend`. `WalletBalances` takes `onReceive`, `onSend` and `onOpenAssets`. This is a
  breaking change for 0.55.0 release notes. No seams-monorepo code used the old names.
- Settings routes `assets`, `receive` and `send`; the full settings page shows them in its
  Assets section.
- Spec: "Asset balances" and "Wallet settings presentation" in `docs/intended-behaviours.md`.
- Tests: `tests/unit/walletAssets.unit.test.ts` and `tests/wallet-ui/asset-send.browser.test.ts`
  (the Send screen, its checks, and the real review card for a NEAR and a USDC send, in
  Chromium, Firefox and WebKit).

## Front page demo components

The private marketing app shows SDK components on the Wallet front page
(seams-monorepo `apps/wallet-console/src/pages/wallet/ComponentShowcase.tsx`). Its `profile` preview,
labelled "Recover and Link Devices", loads `src/showcase/account.tsx`, which renders
`AccountMenuButtonMock`. The page also has background cards (`BackgroundPreview.tsx`: unlock,
recovery, payment, receipt). These tasks run after Phase 1 step 12 is in a released SDK, because
the showcase renders the installed SDK release. They stay open until seams-monorepo installs
0.55.0; the SDK part of this plan does not wait for them.

1. Render the account showcase with the new SDK and check that the overview still fits its slot
   on desktop, at 375 px and at 320 px. The balance card adds about 200 px of height.
2. Decide if the `profile` preview keeps its label or changes to a label that includes assets.
   Update `recoverLink` in `src/marketing/i18n/catalog.ts` (English and Japanese) if it changes.
3. If the showcase plays a scripted tour of screens, add the Assets, Receive and Send screens
   to it, or record that they stay out.
4. Decide if a background card shows a balance. If yes, add a `balances` kind to
   `BackgroundPreview.tsx` and place it on the canvas in `ComponentShowcase.tsx`.
5. Check the light and dark themes and the Japanese locale (`?lang=ja`).
6. Check that no showcase sample address or amount looks like a real account.

## Tests and spec

- `docs/intended-behaviours.md`: add an "Asset balances" section (the read, the `unavailable`
  state, the refresh rule, testnet scope) and extend "Wallet settings presentation" with the new
  routes. Add each in the same change as its code.
- Unit tests built on shared factories for the balance read: NEAR reserve, token read failure,
  EVM read, testnet scope.
- A type fixture that makes an `unavailable` balance impossible to read as an amount.
- A wallet-iframe or wallet-ui browser test for the Send screen up to the review card.
- The existing transfer review tests must stay green after the asset list move.

## Mockup

A static mockup of the overview card and the three screens was made on 2026-11-07 with the SDK
showcase tokens and the review-card artwork. It is not in this repository.

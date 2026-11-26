---
title: Wallet Connect
description: 既存のEVMとNEARのブラウザーウォレットに接続する、@seams/wallet-connectのコントローラーとReactのセレクター。Seamsのアカウントも鍵管理も不要です。
---

# Wallet Connect {#wallet-connect}

`@seams/wallet-connect`は、ユーザーがすでに持っているウォレットに接続します。対象は、MetaMask、Rabby、その他のEIP-6963拡張機能、Phantom、NEARのウォレットのMeteor、HOT、Intearです。
鍵はウォレットが保持し、すべての承認はウォレットが表示します。
このパッケージはSeamsのセッションも鍵管理の記録も作らず、MPCウォレットやSeamsの認証をインポートしません。

```sh
pnpm add @seams/wallet-connect@0.76.0
```

## インポートパス {#import-paths}

| インポートパス | エクスポート |
| --- | --- |
| `@seams/wallet-connect/client` | `ExternalEvmController`、`ExternalNearController`、`nearWalletName`、接続・スナップショット・結果・取引の型 |
| `@seams/wallet-connect/react` | `ExternalEvmWalletPicker`、`useExternalEvm`、`ExternalNearWalletPicker`（開発プレビュー）、`useExternalNear` |

コントローラーはReactなしで動きます。Reactの機能にはReact 19が必要で、プロバイダーは不要です。

```ts [インポート例]
import { ExternalEvmController, ExternalNearController } from '@seams/wallet-connect/client';
import { ExternalEvmWalletPicker, useExternalEvm } from '@seams/wallet-connect/react';
```

## MPCウォレットと一緒に使う {#with-the-mpc-wallet}

`@seams/mpc-wallet/react`の`HostedSeamsAuthMenu`は、Seamsのサインインの横に、これらのコントローラーを別のウォレットとして表示できます。
`@seams/mpc-wallet`は`@seams/wallet-connect`をピア依存関係にしているため、両方を同じバージョンでインストールしてください。
[ウォレット接続メニュー](/ja/reference/react#wallet-connector-menu)を参照してください。

## スタイル {#styling}

各セレクターは、自分のテーマ境界（`data-seams-root`と`seams-theme-provider`クラス）を描画し、スタイルはこの境界から始まります。
セレクターは`@seams/mpc-wallet/react`の`Theme`トークンを読みません。
色を変えるには、CSS変数の`--seams-wallet-picker-text`、`--seams-wallet-picker-background`、`--seams-wallet-picker-card`、`--seams-wallet-picker-border`、`--seams-wallet-picker-hover`を設定してください。

コントローラーの呼び出し、結果、ウォレットの制限は、[外部EVMウォレット](/ja/guides/external-evm-wallets)と[外部NEARウォレット](/ja/guides/external-near-wallets)を参照してください。

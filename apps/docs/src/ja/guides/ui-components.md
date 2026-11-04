---
title: UIコンポーネント
description: '@seams/wallet/reactが提供する既製のReactコンポーネント、それぞれが表示する内容、プロパティと実装例の参照先。'
---

# UIコンポーネント {#ui-components}

`@seams/wallet/react`は、サインイン、ウォレット設定、デバイスのリンク、取引の確認に使う既製のコンポーネントを提供します。
スタイルシートを一度だけインポートします。モック以外のコンポーネントは、すべて`SeamsWebProvider`内に配置します。

```tsx [インポート例]
import { SeamsWebProvider, HostedSeamsAuthMenu, AccountMenuButton } from '@seams/wallet/react';
import '@seams/wallet/react/styles';
```

## コンポーネントの一覧 {#component-list}

| コンポーネント            | 表示する内容                                                               | プロバイダー |
| ------------------------- | -------------------------------------------------------------------------- | ------------ |
| `HostedSeamsAuthMenu`     | ウォレットオリジン上の、サインイン、登録、復旧の完全なメニュー。           | 必要         |
| `SeamsAuthMenuMock`       | 操作できない、認証メニューの静的なプレビュー。                             | 不要         |
| `AccountMenuButton`       | ウォレット設定をドロップダウン、モーダル、ドロワーで開くアカウントボタン。 | 必要         |
| `ProfileSettingsButton`   | `AccountMenuButton`と同じコンポーネントの別名。                            | 必要         |
| `AccountMenuButtonMock`   | サンプルデータを使う、操作できるアカウントメニューのプレビュー。           | 不要         |
| `WalletSettingsPage`      | ページ全体のウォレット設定。未サインインの場合はホストする認証を表示。     | 必要         |
| `ShowQRCode`              | 新しいデバイスのリンクコード。開始から期限切れまでを処理。                 | 必要         |
| `QRCodeScanner`           | 既存デバイスのカメラスキャナーとリンクの承認。                             | 必要         |
| `TransactionReviewHost`   | ウォレットの承認前に独自の確認内容を表示するダイアログ。                   | 必要         |
| `ExternalEvmWalletPicker` | ブラウザーに注入されたEVMウォレットのセレクター。                          | 不要         |
| `Theme`                   | 配下のすべてのコンポーネントにテーマトークンを提供。                       | 不要         |

独自のコントロールに使う小さなアイコンとして、`TouchIcon`、`QRCodeIcon`、`SunIcon`、`MoonIcon`も提供します。

インポートを小さくする場合や、SSRで使う場合は、個別のエントリーポイントを使います。

- `@seams/wallet/react/hosted-seams-auth-menu`：認証メニューとそのモック。
- `@seams/wallet/react/profile`：アカウントメニュー、そのモック、設定ページ。
- `@seams/wallet/react/provider`：`SeamsWebProvider`。
- `@seams/wallet/react/external-near`：外部NEARウォレットのセレクター（開発プレビュー）。

## サインイン {#sign-in}

`HostedSeamsAuthMenu`は、認証体験全体をウォレットオリジン上に表示します。
アプリのページは、マウントしたセッションごとに1つの結果を`onOutcome`で受け取ります。
主な任意のプロパティは次のとおりです。

- `initialMode`：最初の画面を選択します。既定はサインインです。
- `walletAlternatives`：外部のNEARウォレットとEVMウォレットをメニューに追加します。
- `recoveryOptions`：復旧とデバイスのリンクを表示、折りたたみ、非表示にします。
- `footerBrand`：「Secured by seams」の行をアプリのロゴに置き換えます。
- `copy`：メニューの文言を変更します。
- `placeholder`：メニューの読み込み中に、操作できない独自の内容を表示します。

各プロパティは[ホストする認証メニュー](/ja/reference/react#wallet-connector-menu)を、サインインの流れは[認証](/ja/guides/authentication)を参照してください。

## ウォレット設定 {#wallet-settings}

`AccountMenuButton`は、アカウント、認証方式、復旧コード、リンク済みデバイス、エクスポート、取引の設定を開きます。
`nearAccountId`が必要です。既定の`presentation="dropdown"`は、SDKのトリガーボタンを含みます。
`"modal"`または`"drawer"`の場合は、`isMenuOpen`と`onMenuOpenChange`を使い、アプリ独自のボタンから設定を開きます。

`WalletSettingsPage`は、同じ設定をページ全体に表示します。ウォレットのリージョン設定も表示します。
表示方法、ドロワーの動作、リージョン設定は[Reactコンポーネント](/ja/reference/react#components)を参照してください。

## デバイスのリンク {#device-linking}

デバイスのリンクには、各デバイスに1つずつ、2つのコンポーネントを使います。

1. 新しいデバイスでは、`ShowQRCode`がリンクセッションを開始し、コードを表示します。
2. 既存のデバイスでは、`QRCodeScanner`がコードを読み取り、承認を実行します。

<<< ../../examples/qr-code-scanner.tsx

`QRCodeScanner`は、新しいデバイスが有効になった後に`onQRCodeScanned`を呼び出し、その後`onClose`を呼び出します。
`onEvent`は、リンクの進行イベントを1つずつ受け取ります。
セッションが期限切れになると、スキャナーは期限切れの画面を表示します。
リンクの途中でスキャナーを閉じると、スキャナーはリンクを取り消します。

| プロパティ        | 目的                                                            |
| ----------------- | --------------------------------------------------------------- |
| `isOpen`          | カメラを開始・停止します。既定は`true`です。                    |
| `presentation`    | ダイアログには`"modal"`（既定）、ページ内表示には`"embedded"`。 |
| `cameraId`        | カメラを選択します。既定ではブラウザーが選択します。            |
| `showCamera`      | `false`にすると、カメラを停止したままにします。                 |
| `onQRCodeScanned` | リンクの成功後に、読み取ったペイロードを受け取ります。          |
| `onEvent`         | 各`LinkDeviceFlowEvent`を受け取ります。                         |
| `onError`         | カメラとリンクの失敗を受け取ります。                            |
| `onClose`         | スキャナーが閉じたときに一度だけ実行します。                    |

アカウントメニューには、スキャナーがすでに含まれています。
そのイベントを受け取るには、`AccountMenuButton`の`deviceLinkingScannerParams`を使います。
流れは[リンク済みデバイス](/ja/guides/linked-devices)を、`ShowQRCode`の実装例は[ウォレットの高度な操作](/ja/examples/advanced-wallet-operations)を参照してください。

## 外部ウォレット {#external-wallets}

`ExternalEvmWalletPicker`は、`useExternalEvm`が検出した、ブラウザーに注入されたEVMウォレットを表示します。
コントローラーとそのスナップショットを受け取ります。[外部EVMウォレット](/ja/guides/external-evm-wallets)を参照してください。

## 取引の確認 {#transaction-review}

`TransactionReviewHost`は、ウォレットの承認前にアプリ独自のReactの内容を表示します。
`useSeams().wallet`の署名メソッドに`review`を渡します。[独自の確認コンポーネント](/ja/guides/transaction-review)を参照してください。

## ウォレットなしのプレビュー {#previews-without-a-wallet}

`SeamsAuthMenuMock`と`AccountMenuButtonMock`には、プロバイダーが不要です。
セッションの作成、署名、鍵のエクスポート、ウォレットストレージの読み取りは行いません。
デザインの確認、読み込み中の表示、マーケティングページに使います。

```tsx [部分的な実装例]
import { AccountMenuButtonMock } from '@seams/wallet/react/profile';
import '@seams/wallet/react/styles';

<AccountMenuButtonMock username="Alex Chen" walletId="alex.near" theme="light" />;
```

## 外観 {#appearance}

すべてのコンポーネントは`Theme`のトークンを使います。
認証メニューや取引の確認画面などのウォレットオリジン側の画面は、SDKに送った外観の設定を使います。
両方を同じプリセットから設定します。[テーマの設定](/ja/guides/theming)と[UIのカスタマイズ](/ja/examples/ui-customization)を参照してください。

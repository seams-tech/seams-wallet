---
title: React SDK
description: '@seams/wallet/reactが提供するプロバイダー、フック、コンポーネント、ホストする認証UI、テーマの公開API。'
---

# React SDK {#react-sdk}

Seamsの認証と鍵管理に使うReact向けの機能を`@seams/wallet/react`からインポートし、利用するコンポーネントを`SeamsWebProvider`または`SeamsContextProvider`内に配置します。

```tsx [インポート例]
import { SeamsWebProvider, HostedSeamsAuthMenu, useSeams } from '@seams/wallet/react';
```

## 外部NEAR向けのReact機能 {#external-near-bindings}

開発プレビューでは`@seams/wallet/react/external-near`を使用します。
セレクターとフックには`ExternalNearController`が必要ですが、以下のSeamsプロバイダーは不要です。
セレクターはアンマウント時に切断します。フックは購読だけを行います。
[実装例と提供状況](/ja/guides/external-near-wallets#react-example)を確認してください。

セレクターには、コントローラーの`wallets`に指定したウォレットだけを表示します。
`setWallets`で実行中に変更でき、空のリストですべて無効になります。
[ウォレットの選択設定](/ja/reference/configuration#external-near-wallet-selection)を参照してください。

## プロバイダーとフック {#providers-and-hooks}

| 公開名                                            | 目的                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `SeamsWebProvider`                                | Reactのサブツリー用にSDKクライアントを作成・所有。           |
| `SeamsContextProvider`                            | 既存のコンテキスト値を提供。                                 |
| `useSeams`                                        | 認証、ライフサイクル状態、現在のウォレットに紐づく署名機能。 |
| `useWalletAuth`                                   | サインイン、サインアウト、登録の機能。                       |
| `useWalletDevices`                                | リンク済みデバイスの機能。                                   |
| `useDeviceLinking`                                | 連携フローの承認側デバイスの処理を実行。                     |
| `useNearClient`、`useAccountInput`、`useQRCamera` | 用途別の導入用ヘルパー。                                     |

### `useSeams` {#useseams}

認証と署名に1つのフックを使います。
`unlock`、`lock`、`registerWallet`は、サインアウト中も利用できます。認証が成功するまで、`wallet`は`null`です。
認証済みウォレットは、`near`、`evm`、`tempo`、`exportKey`を提供します。
署名前に、対象の署名機能を確認してください。

```tsx [部分的な実装例]
const { unlock, wallet } = useSeams();
if (!wallet?.near) return <SignInButton onUnlock={unlock} />;

await wallet.near.signAndSendTransaction({
  receiverId: 'guest-book.testnet',
  actions: [functionCall({ method: 'set_greeting', args: { greeting: 'hi' } })],
});
```

認証済みウォレットにNEARアカウントがない場合、`wallet.near`は`null`です。
その状態でも`wallet.evm`と`wallet.tempo`は利用できます。
各署名機能は、コンポーネントが表示したウォレットへリクエストを紐づけます。
ウォレットの識別には`wallet.walletId`を、NEARアカウントには`wallet.near.accountId`を使います。

`unlock`が成功すると、その後のレンダーでReactが認証済みウォレットを提供します。
ハンドラーは、自身のレンダー時点のウォレットを保持します。アンロックと署名は、それぞれのユーザー操作で実行してください。

`useWalletAuth`と`useWalletDevices`は、同じコンテキストの異なる部分を読み取ります。
`useSeams`は、コンテキスト全体を公開します。

### セッションの更新とアカウント入力 {#refresh-session-and-account-input}

ウォレット操作後にReactのセッション表示を更新するには、`useSeams`または`useWalletAuth`の`refreshSession(walletId?)`を使います。
戻り値は`Promise<void>`です。セッション結果自体が必要な場合は、`getSession`を使ってください。

アカウント入力を更新するには、`useSeams`または`useAccountInput`の`setAccountName(name)`を使います。
小文字への正規化と保存済みウォレットとの照合を維持します。

## コンポーネント {#components}

安定版のAPIには、`HostedSeamsAuthMenu`、`WalletSettingsPage`、`AccountMenuButton`、`ProfileSettingsButton`、`QRCodeScanner`、`ShowQRCode`を含みます。
ウォレットオリジン側で認証体験全体を管理する場合は、ホストする認証メニューを使います。
`SeamsAuthMenuMock`は、操作を実行しない読み込み用プレースホルダー兼プレビューです。
`HostedSeamsAuthMenu`は、ウォレットUIを開く間にこれを表示します。

### ウォレット接続メニュー {#wallet-connector-menu}

`HostedSeamsAuthMenu`は、Seams認証と外部ウォレット接続を同じ画面に表示します。
省略可能な`walletAlternatives`で、表示項目と順序を指定します。
`primary`は「Or connect another wallet」の下に表示します。
`secondary`は、初期状態で閉じた「More wallets」に表示します。
設定を省略すると両方を非表示にします。空の配列に対応する見出しも表示しません。

NEARの項目には`kind: 'near'`、ウォレットID、`ExternalNearController`、
`onConnected`を指定します。EVMの項目には`kind: 'evm'`、検出したウォレット、
`ExternalEvmController`、型付きの`onConnected`を指定します。
EVMの検出はアプリ側の`useExternalEvm`で開始します。
MetaMaskやRabbyも既存のEVMコネクターを利用します。
検出しただけでは項目を追加しません。表示するウォレットはアプリ側で選択します。

各項目の`label`、`description`、画像URLの`icon`を変更できます。
アイコンは元の色で表示されます。
「Recover or link wallet」を開くと、デバイス連携と復元の操作を表示します。
認証操作はウォレットオリジン内に残り、接続コントローラーはアプリ側に残ります。

外部接続の成功時は`onConnected`と`wallet_connected`の結果を通知します。
Seamsの認証セッションは作成しません。メニューを閉じても完了した接続は維持します。
接続待ちの間に閉じた場合は、その要求を無効にして遅れて届く結果を無視します。

### 認証メニューの表示設定

`HostedSeamsAuthMenu` の `recoveryOptions` は `"collapsible"`（既定）、
`"expanded"`（常時表示）、`"hidden"`（非表示）を指定できます。
`footerBrand` に `{ kind: 'custom', logo: 'https://example.com/logo.svg', name: 'Example' }` を指定すると、
フッター全体をアプリのロゴに置き換えられます。`logo` は HTTPS の絶対 URL または
画像のデータ URL です。`name` は画像の代替テキストです。
省略するか `{ kind: 'seams' }` を指定すると、既定のブランド表示に戻ります。
接続状態やエラーはフッターに表示されます。

`AccountMenuButton`の既定値は`presentation="dropdown"`です。SDKのトリガーボタンを表示します。
アプリ独自のボタンから同じ設定画面を開く場合は、`presentation="modal"`または`presentation="drawer"`を指定します。
どちらも`isMenuOpen`と`onMenuOpenChange`が必須です。SDKのトリガーボタンは表示しません。

```tsx [部分的な実装例]
import { useState } from 'react';
import { AccountMenuButton, useSeams } from '@seams/wallet/react';
import '@seams/wallet/react/styles';

function WalletSettingsControl() {
  const [open, setOpen] = useState(false);
  const { loginState } = useSeams();
  return (
    <>
      <button type="button" onClick={setOpen.bind(null, true)}>
        ウォレット設定
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

`SeamsWebProvider`内に配置してください。設定画面は`document.body`配下のポータルにテーマを維持して表示します。
ドロワーはデスクトップでは行末側から、幅600px以下では画面下部から開きます。
ヘッダーとフッターを固定し、内容をスクロールできます。色、余白、角丸、影はSDKのテーマ設定に従います。
開閉は240msで動き、視差効果を減らす設定では即座に切り替わります。閉じる途中でも同じダイアログを開き直せます。
中央に表示する場合は`presentation="modal"`を指定してください。
フォーカスを内部に保ち、背景の操作とスクロールを止めます。閉じると、開く前にフォーカスされていた要素に戻します。
Escape、閉じるボタン、背景のクリックは`onMenuOpenChange(false)`を呼びます。
アプリから`open`を`false`に変更して閉じることもできます。閉じると画面遷移を初期状態に戻します。
`ProfileSettingsButton`と`AccountMenuButtonMock`も同じ表示・開閉プロパティを受け付けます。
ドロップダウンでも`isMenuOpen`を渡す場合は`onMenuOpenChange`が必須です。

メニューのアンカー要素（`[data-seams-auth-menu-host]`）は、計測済みのメニューが表示されるフレームで
`data-seams-auth-menu-ready="true"`を受け取ります。そのフレーム以降、アンカーはメニューの高さを確保します。
閉じるボタンなど、ページ側でメニューの周りに独自のコントロールを描く場合は、この属性を条件に表示してください。
コントロールはカードと同時に、最終的な位置に表示されます。

```css
.my-auth-dialog .my-close-button {
  opacity: 0;
}
.my-auth-dialog:has([data-seams-auth-menu-ready]) .my-close-button {
  opacity: 1;
}
```

サインアウト中のページは、サインインを開始するまでウォレットのサインイン用コードをダウンロードしません。
クリック後に`HostedSeamsAuthMenu`をマウントする場合は、サインイン部品へのポインター操作、フォーカス、タッチで`useSeams().seams.authMenu.prepare()`を呼んでください。
これにより、クリック前にダウンロードを開始します。

`AccountMenuButtonMock`は、プロバイダーなしで操作できるアカウントメニューのプレビューです。
認証方法の画面と登録行を含め、接続済み`AccountMenuButton`と同じ描画処理を使います。
接続済みメニューは実際のウォレット一覧と認証済み操作を渡し、プレビューはサンプルデータを渡します。
ナビゲーション、確認設定、デバイス詳細、復元プレビュー、ロックにはローカル状態を使います。
ウォレットセッションの作成、署名、鍵のエクスポート、カメラへのアクセス要求、ウォレットストレージへのアクセスは行いません。
鍵のエクスポートは、共通の鍵選択画面を開きます。NEARとEVMのサンプル選択肢は、認証が必要であることを表示します。

```tsx [部分的な実装例]
import { AccountMenuButtonMock } from '@seams/wallet/react/profile';
import '@seams/wallet/react/styles';

<AccountMenuButtonMock username="Alex Chen" walletId="alex.near" theme="light" />;
```

ドロップダウンのプレビューを折りたたんだ状態から始めるには、`defaultOpen={false}`を指定します。
すべての画面は1つのパネル内に収まります。ドロップダウンには背景のオーバーレイがありません。
モーダルのプレビューでは、`isMenuOpen`と`onMenuOpenChange`で開閉を制御します。
画面間では計測した高さをアニメーションし、動きを減らす設定に従います。
認証方法の画面は現在のウォレットを直接開き、パスキーとメールOTPを別々の行に表示します。
デバイス連携はメインメニューから利用できます。取引設定は、サイズを変更する別画面で開きます。
スキャナーは静的なカメラのプレビューです。復元プレビューは、それぞれ異なる16桁のサンプルコードを4つ表示します。
認証方法の行は、選択可能な設定ではなく登録状態を表示します。
実際の登録と削除は、引き続き認証済みSDK操作を使います。
プレビューは、ウォレット操作の開始や実際の署名鍵の開示を行いません。

`WalletSettingsPage`は、アカウント、認証方法、復元コード、リンク済みデバイス、エクスポート、取引の設定を提供します。
同じプロバイダーとウォレットオリジンの操作を使います。サインアウト中は、ホストする認証画面を表示します。
デプロイ環境と現在のデバイスが許可する場合、別のリージョンへ移動する設定も表示します。
この設定は`useSeams().seams.placement`を使います。
呼び出し、結果、移動後に各デバイスで必要なアンロックは、[ウォレットのリージョン](/ja/reference/core#wallet-region)を参照してください。

小さなインポートやSSR専用のインポートが必要なアプリには、用途別のエントリーポイントがあります。

- `@seams/wallet/react/provider`。
- `@seams/wallet/react/profile`。
- `@seams/wallet/react/hosted-seams-auth-menu`。
- `@seams/wallet/react/styles`。

## 取引確認UIのカスタマイズ {#custom-transaction-review}

ウォレットプロバイダーの内側に`TransactionReviewHost`を配置します。
`useSeams().wallet`の`near.signAndSendTransaction`、またはEVM・Tempoの`signTransaction`や`signAndSendTransaction`へ`review`を渡します。

| 公開名                       | 目的                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| `TransactionReviewHost`      | SDKのダイアログ内にアプリの確認内容を表示。                           |
| `TransactionReview`          | `title`、`validity`、`render`が必須。`className`は任意。              |
| `TransactionReviewControls`  | `continueToWallet()`、`cancel()`、`fail(error)`。                     |
| `TransactionReviewValidity`  | `{ kind: 'unbounded' }`または`{ kind: 'expires_at', atMs: number }`。 |
| `TransactionReviewError`     | 型付き`code`を持つ確認失敗のクラス。                                  |
| `TransactionReviewErrorCode` | 確認失敗コードのユニオン。                                            |

レンダラーは、Reactの内容を同期的に返します。続行すると、別のウォレット承認へ進みます。
ホストするiframeモード、モーダル確認、明示的な承認が必要です。
設定、有効期限、エラー処理、スタイルは、[ガイドとコンパイル対象の実装例](/ja/guides/transaction-review)を参照してください。

## 表示設定 {#appearance}

`Theme`、`useTheme`、`LIGHT_TOKENS`、`DARK_TOKENS`、`SHAPE_PRESETS`は、アプリ側のReact画面を装飾します。
ウォレットiframe用には、対応する表示設定をブラウザーSDKへ渡します。
[テーマの設定](/ja/guides/theming)を参照してください。

## Reactの境界 {#react-boundary}

認証情報の入力要求と署名は、直接のユーザー操作に紐づけてください。
結果ユニオンから、読み込み中、成功、キャンセル、対処可能な失敗をそれぞれ表示してください。
単一の真偽値にまとめないでください。

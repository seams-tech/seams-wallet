---
title: ウォレットの設定と認証
description: Seamsプロバイダーを設定し、パスキーでウォレットを登録・アンロックするか、GoogleとメールOTPで認証します。
---

# ウォレットの設定と認証 {#wallet-setup-and-authentication}

## ホスト環境での登録とサインインの準備 {#hosted-registration-and-sign-in-intent}

登録画面を開いたら、`SeamsWebProvider`内に`HostedRegistration`を表示してください。
その画面が開いている間に、ウォレットとチャレンジを準備します。結果はアプリ側で処理してください。

`SignInIntentButton`は、ポインター操作、フォーカス、タッチを契機にサインイン用コードをダウンロードします。
認証メニューを表示するために、`onOpen`を指定してください。
ダウンロードだけでは、ウォレットの予約やパスキーのチャレンジの準備は行いません。
`registerWallet()`を直接呼ぶ場合は、その呼び出しの中で準備を開始します。
[ホスト環境への導入](/ja/deploy-and-operate/hosted-integration#prepare-registration-through-the-hosted-menu)を参照してください。

<<< ../../examples/hosted-auth-menu.tsx

新しいアプリにSeamsを追加する際は、この実装例を使ってください。
プロバイダーを一度設定し、ウォレットを登録します。署名前にウォレットセッションを作成してください。

## 前提条件 {#prerequisites}

`@seams/wallet`をインストールし、設定したウォレットオリジンを配信してください。
設定例にある登録用とリレーヤー用の環境変数を指定してください。

## プロバイダーを設定する {#configure-the-provider}

`useSeams`を呼ぶコンポーネントより上に、`SeamsWebProvider`を配置します。

<<< ../../examples/setup.tsx

`seamsTestnetConfig`には、ウォレットオリジン、リレーヤーURL、公開可能キーが必要です。
ウォレットサービスのパス、SDKのベースパス、リレーヤーアカウント、チェーンのRPC・エクスプローラーURLには既定値を設定します。
この実装例は、アプリ環境から`VITE_WALLET_ORIGIN`、`VITE_RELAYER_URL`、`VITE_SEAMS_PUBLISHABLE_KEY`を読み取ります。
デプロイ先ごとに、自社の値を指定してください。テストネット以外のネットワークには`defineSeamsConfig`を使います。

## パスキーで登録する {#register-with-a-passkey}

`CreateWalletButton`を表示するか、独自の登録画面から`seams.registration.registerWallet`を呼び出します。

<<< ../../examples/registration.tsx

`RegistrationResult`は型付きのユニオンです。
登録が成功すると、すぐに利用可能な状態か、NEARのプロビジョニング待ちの状態を返します。
チェーン固有の機能を参照する前に、結果の分岐を確認してください。
待機中の分岐では、`seams.registration.waitForNearAccount({ walletId })`を待ってください。
`getNearAccountState`を独自にポーリングする必要はありません。

## 既存のウォレットをアンロックする {#unlock-an-existing-wallet}

アプリのアカウントレコードにあるウォレットIDを、`unlockWallet`へ渡します。

<<< ../../examples/unlock.ts

成功すると、再利用可能な署名セッションへのアクセスを得られます。
エクスポートには、操作ごとの新たな承認が必要です。
両方の鍵方式に対応するアプリでは、`near_wallet_unlocked`と`ecdsa_wallet_unlocked`の両分岐を処理してください。

## GoogleとメールOTPで認証する {#authenticate-with-google-email-otp}

IDプロバイダーのGoogle IDトークンを使い、独自UIでOTPを入力してもらいます。

<<< ../../examples/email-otp.ts

`startGoogleEmailOtpLogin`には、既存ウォレットのログインフローが必要です。
アカウントの登録が必要な場合、このヘルパーはログインフローをキャンセルし、その状態を通知します。
アプリは、先に登録へ案内できます。

## 期待する結果 {#expected-result}

登録は、ウォレットIDと、利用可能または準備待ちの機能を返します。
アンロックは、利用可能なチェーン識別情報を含むウォレットセッションの結果を返します。
メールOTPは、コードの受理後に認証済みログイン結果を返します。

## 対処可能な失敗 {#recoverable-failures}

- パスキーやOTPの入力をキャンセルすると、現在の試行は終了します。同じ画面から再開できるようにしてください。
- 登録やアンロックの失敗結果には、エラー文字列が含まれます。簡潔なメッセージを表示し、結果にウォレットIDがある場合は保持してください。
- Googleのログインフローが登録モードの場合は、登録画面へ進めてください。同じウォレット状態でログインを繰り返さないでください。
- セッションが期限切れか利用枠を使い切った場合は、署名やエクスポートの前に、再度アンロックしてください。

次に、[署名](/ja/examples/signing)、[ウォレットの高度な操作](/ja/examples/advanced-wallet-operations)、[結果とエラー](/ja/reference/results-and-errors)を参照してください。

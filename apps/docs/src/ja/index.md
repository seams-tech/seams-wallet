---
title: はじめに
description: Seamsをインストールし、ウォレットの作成と最初の取引への署名を行います。
---

# はじめに {#start-here}

Seamsのしきい値ウォレットを使う場合は、まずウォレットを作成し、取引に署名します。その後で、復元、デバイス連携、権限の委任を追加してください。
Reactアプリと、ウォレットオリジン、リレーヤーURL、管理登録用の認証情報を設定したSeamsプロジェクトが必要です。
ウォレットオリジンは、ウォレットの保護されたUIとSDKアセットを配信する専用のオリジンです。

<!-- prettier-ignore -->
## ウォレットの利用方法を選ぶ {#choose-your-wallet-path}

以下の手順は、Seamsのしきい値ウォレットを作成するためのものです。
Meteor、HOT Wallet、Intear Walletを接続する場合は、[外部NEARコネクター](/ja/guides/external-near-wallets)を参照してください。
外部接続にはSeamsのプロバイダーやログインは不要です。
この機能は開発プレビューです。

Google SSOを使うアプリは、[同じログインでウォレット設定を開けます](/ja/guides/google-sso)。
SDK 0.36.0では、関連付けたウォレットに対してGoogle IDトークンとバックエンド経由の引き渡しを使えます。
署名とセキュリティ設定の変更には、引き続き所有者の認証が必要です。

## 1. SDKをインストール {#\_1-install-the-sdk}

```sh
pnpm add @seams/wallet@0.36.0
```

<!-- prettier-ignore -->
## 2. プロバイダーを配置 {#_2-mount-the-provider}

アプリのルート付近で、分離されたウォレットオリジンを一度設定します。
`seamsTestnetConfig`には、ウォレットオリジン、リレーヤーURL、管理登録用の認証情報が必要です。
その他の設定にはSDKの既定値を使います。この例では`import.meta.env`から値を読み込みます。
同じ環境変数名を使うか、独自の設定ローダーを使用してください。
別のネットワークを設定する場合は`chains`を渡します。テストネット以外では`defineSeamsConfig`を使います。

このドキュメントは`@seams/wallet` **0.36.0**を対象としています。
ウォレットオリジンのアセットと`@seams/wallet-server`も、対応するリリースに合わせてください。
既存の実装を更新する前に、[デプロイ要件](/ja/deploy-and-operate/hosted-integration)を確認してください。

[VoiceID](/ja/concepts/auth-methods/voiceid)は、音声の登録、アンロック、送金承認に使う任意のパッケージです。
エンジンとモデルは、VoiceIDを使うときだけ読み込みます。

ウォレットiframeのプロトコルは**22.0.0**、復元CLIは**0.29.0**です。
導入とデプロイの要件は[リリース 0.36.0](/ja/releases)を参照してください。

<<< ../examples/setup.tsx

ウォレットUIは`SeamsWebProvider`の内側に配置します。
ウォレットサービスとSDKアセットは、設定したウォレットオリジンから配信してください。

登録UI全体を利用する場合は、[ホスト型メニューの実装例](/ja/examples/wallet-setup-and-authentication#hosted-registration-and-sign-in-intent)にある
`HostedRegistration`を使います。メニューは登録画面を開いている間にセットアップを準備します。
以下のカスタムボタンは、登録処理の呼び出し内でセットアップを開始します。

<!-- prettier-ignore -->
## 3. ウォレットを作成 {#_3-create-a-wallet}

プロバイダーの内側に、登録の実装例にあるボタンを配置します。
ユーザーがクリックすると、SDKがパスキーの認証画面を開きます。
この例では、その登録処理の進行状況と結果をログに出力します。

<<< ../examples/registration.tsx

結果の各分岐と再試行の扱いは、[ウォレットを作成](/ja/getting-started/create-wallet)を参照してください。

<!-- prettier-ignore -->
## 4. 取引に署名 {#_4-sign-a-transaction}

要求した署名者の準備が完了すると、`useSeams().wallet`からログイン中のウォレットの署名メソッドを利用できます。
これらのメソッドには取引だけを渡します。各要求でウォレットの確認画面が開き、ユーザーがウォレットの認証方法で取引を承認します。

ログイン中とは別のウォレットを指定する場合は、`useSeams().seams`を使い、呼び出しに明示的な`walletSession`を渡します。

- [NEAR取引に署名](/ja/getting-started/sign-with-policy#near-transaction)
- [EVM系の取引を実行](/ja/getting-started/sign-with-policy#evm-family-transaction)

アクションは`functionCall`や`transfer`などのヘルパーで作成してください。
`{ type: ActionType.FunctionCall, … }`のようなオブジェクトを直接組み立てないでください。
`onEvent`に`logWalletEvents()`を渡すと、コンソールに進行状況を出力できます。

`transfer`には単位付きの金額を渡します。`transfer('1 NEAR')`は1 NEAR、
`transfer('1000 yoctoNEAR')`は1000 yoctoNEARを送金します。単位のない文字列はコンパイルできません。
実行時に計算した金額には、NEARの小数文字列を受け取る`parseNear(amount)`、
またはyoctoNEAR単位の値を受け取る`yoctoNear(amount)`を使います。

EVMの`value`はwei単位の`bigint`です。`parseEther('0.5')`で記述できます。
このヘルパーは、チェーンの小数点以下18桁のネイティブ通貨（ETH、POLなど）の金額を受け取ります。
小数桁数が異なるERC-20などのトークンには、`parseUnits('1.5', 6)`を使います。
これらのヘルパーは、負数、数値ではない値、許容桁数を超える値に対して`AmountError`を送出します。

`seams.evm`と`seams.tempo`は、どちらも`signTransaction`、`signAndSendTransaction`、`advanced`を提供します。
取引形式は異なり、EVMはEIP-1559、TempoはEIP-2718を使います。

これらの要求に事前のアンロック操作は不要です。
取引ごとの認証画面を省いて繰り返し署名する場合は、署名セッションを作成します。
[ウォレットセッションと署名レーン](/ja/guides/wallet-sessions-and-signing-lanes)を参照してください。

## 高度な機能を追加 {#add-advanced-capabilities}

最初の署名処理が動作したら、[デバイス連携、鍵のエクスポート、復元](/ja/getting-started/delegate-or-rotate)に進んでください。
認証方法、ポリシー、デプロイ時の境界については[ガイド](/ja/guides/)を参照してください。

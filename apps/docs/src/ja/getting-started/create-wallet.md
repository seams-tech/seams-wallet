---
title: ウォレットを作成
description: パスキーウォレットを登録し、準備完了・処理中・失敗の結果を扱います。
---

# ウォレットを作成 {#create-a-wallet}

ボタンのクリックなど、ユーザーの操作に応じて`registerWallet`を呼び出します。
SDKはパスキーの認証画面を開き、進行状況を通知します。
戻り値の分岐によって、利用できる機能を判断できます。

## パスキーウォレットを登録 {#register-a-passkey-wallet}

登録ボタンと結果のUIを自社で実装する場合は、フックを使います。
[はじめに](/ja/)で設定した`SeamsWebProvider`の内側に`CreateWalletButton`を配置してください。
`registration`プロパティには、明示的な`authMethod`を含む値を渡します。
`authMethod`でパスキー認証またはメール認証を選択します。

`wallet`を省略すると、サーバーがウォレットIDを割り当てます。
IDを指定する場合は、`wallet: { kind: 'provided', walletId }`を渡します。
`signerSelection`を省略すると、SDKは設定済みチェーンと有効なプロビジョニングの既定値に従って署名者を選択します。
NEARは設定済みのアカウント作成ポリシーを使います。署名者を独自に選ぶ場合は`signerSelection`を渡してください。

次の要求は、設定済みチェーン用のパスキーウォレットを作成します。

<<< ../../examples/registration-input.ts

`wallet.example.com`を、ウォレットオリジンのRP ID（パスキーの登録先を識別するID）に置き換えてください。
`registration`を次のボタンに渡すか、自社のUIから`seams.registration.registerWallet(registration)`を呼び出します。

<<< ../../examples/registration.tsx

この例は`result.success`を確認してから、結果の`kind`をログに出力します。
NEARのアカウント作成状況などのフィールドを読む前に、結果の分岐を確認してください。

## 結果を確認 {#read-the-result}

- `wallet_registered`：ウォレットと、戻り値に含まれる機能の準備が完了しています。
- `ecdsa_wallet_registered_near_pending`：EVM系の機能は利用できます。NEARのアカウント作成は処理中、または再試行可能です。
  この分岐にはNEARアカウントIDがありません。NEARで署名する前に、`seams.registration.waitForNearAccount({ walletId })`の完了を待ってください。
- `near_wallet_registered_pending`：NEARアカウントを参照するには、アカウント作成の準備完了を待つ必要があります。
- `wallet_signer_added`：既存のウォレットに署名者を追加しました。
- `success: false`：今回の試行について、表示またはログ出力するエラーテキストが含まれます。

戻り値の`walletId`は、署名、セッションの準備、そのウォレットのその他すべての操作に使う安定した識別子です。
アプリのアカウントレコードと一緒に保存してください。パスキーや署名シェアの保持者が持つ秘密情報を、アプリの状態に保存しないでください。

## 登録が中断した場合 {#if-registration-stops}

パスキー認証をキャンセルすると、今回の試行が終了します。同じボタンから新しい試行を開始できるようにしてください。
NEARのアカウント作成が再試行可能な場合も、ウォレットの識別情報は維持されます。
再試行を案内する前に作成状況を確認し、別のウォレットを登録しないでください。

- `seams.registration.waitForNearAccount({ walletId })`は、アカウント作成の結果を待ち、
  `near_ready`、`near_failed_retryable`、`timed_out`のいずれかを返します。
  `signal`で中断した場合を除き、Promiseはrejectされません。
- `seams.registration.getNearAccountState({ walletId })`は、待機せずに現在の状態を取得します。

オリジン、公開可能キー、認証に関するエラーでは、再試行の前に設定またはアカウントを修正する必要があります。

## 次の手順 {#continue}

[ポリシーに従って署名](/ja/getting-started/sign-with-policy)に進んでください。

---
title: リリース 0.56.0
description: seams.speakToSign.enroll()でSpeak-to-Signのためにオーナーの声を登録できるようになり、0.55.0の「受け取り」と「送金」、openScreen、ウォレットとサーバーの修正を引き継ぎます。
---

# リリース 0.56.0

ブラウザーSDK、サーバーSDK、VoiceID、Speak-to-Signは **0.56.0** です。

- **実験的機能、NEARテストネット専用:** `seams.speakToSign.enroll({ walletId })`は、オーナーの声をSpeak-to-Signの検証器に登録します。オーナーはVoiceIDの画面で3つの短いフレーズを読み、次に1回の`authorize_enrollment`呼び出しを承認します。この呼び出しは、これらの録音だけを10分間承認します。検証器は、ボールトが承認した音声についてだけ声のテンプレートを保存します。新しい登録はテンプレートを置き換えます。結果は`enrolled`、`refused`(`speaker`や`quality`などの理由付き)、`cancelled`、`unavailable`のいずれかです。新しい型は`SpeakToSignEnrollmentRequest`と`SpeakToSignEnrollmentResult`です。[実験的機能: Speak-to-Sign](/ja/concepts/auth-methods/speak-to-sign)を参照してください。
  - 最初の音声による支払いの前に、オーナーはVoiceIDを有効にし、連絡先が1つ以上あるボールトを作成し、`enroll`を呼び出します。テストネットでは、オーナーのアカウントに約0.3 NEARが必要です。
  - Seamsの検証ルート`POST /speak-to-sign/v1/verify`は、登録の要求(3つの録音、最大1,100 KB)を受け付けます。
- 0.55.0の変更(0.56.0でも同じです):
  - **破壊的変更:** ウォレット設定の残高操作は**受け取り**と**送金**です(0.53.0と0.54.0では**入金**と**出金**でした)。`seams.assets.prepareWithdrawal()`は`seams.assets.prepareSend()`になり、型は`SendRequest`、`SendRejection`、`PreparedSend`です。`WalletBalances`は`onReceive`と`onSend`を受け取ります。
  - `seams.assets.openScreen({ screen, assetId })`は、表示中の設定パネルで**資産**、**受け取り**、**送金**を開きます。**送金**は、金額が残高を超える場合に、同じ資産の**受け取り**を表示します。[コアリファレンス](/ja/reference/core#asset-balances)を参照してください。
  - `ExternalEvmController.switchChain()`は、切り替えの後もウォレットが別のネットワークにある場合に接続を維持し、`unsupported_chain`を返し、`network.kind: 'unsupported'`を設定します。[外部EVMウォレット](/ja/guides/external-evm-wallets)を参照してください。
  - ウォレットの修正: ワーカーのリセット、すべての署名レーンのウォームセッションの素材、消去後のECDSA事前署名プール、ECDSAの登録セレモニー、チェーンごとのEmail OTP封印済みレコード、パスキーのウォームセッションとエクスポートルートの準備、**最大**の手数料を見積もる間の**送金**フォーム、ホスト型認証メニューのGoogleコードの送信。
  - `@seams/wallet-server`の修正: 登録のキャンセル、セッションのないリンク済みデバイスの確認、Speak-to-Signの検証ルート。検証ルートは`500`ではなく`401 unauthorized`または`503 session_unavailable`を返し、セッションの使用回数を消費しません。
- 4つのパッケージをすべて0.56.0でインストールしてください。VoiceIDのホストAPIはバージョン**9**のままです。Speak-to-Signは引き続き実験的機能で、NEARテストネット専用です。実際の資金では使わないでください。

ウォレットのiframeプロトコルは **23.0.0**、ウォレット管理プロトコルは **5** のままです。
署名付きの復旧CLIは **0.29.0** のままです。このリリースにデータベースのマイグレーションはありません。

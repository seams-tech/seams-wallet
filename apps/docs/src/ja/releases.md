---
title: リリース 0.54.0
description: 新しい@seams/speak-to-signパッケージで、実験的でテストネット専用の音声による支払いSpeak-to-Signを追加し、VoiceIDのホストAPIをバージョン9にします。
---

# リリース 0.54.0

ブラウザーSDK、サーバーSDK、VoiceID、Speak-to-Signは **0.54.0** です。

- **実験的機能、NEARテストネット専用:** 新しい任意のパッケージ`@seams/speak-to-sign`で、音声による支払いができます。所有者が「Send 2 NEAR to alice dot testnet」のように支払いを話すと、証明付きの検証者が声と言葉を確認した後でだけ、ボールトのコントラクトが支払います。[実験的機能: Speak-to-Sign](/ja/concepts/auth-methods/speak-to-sign)を参照してください。実際の資金では使わないでください。
- `transactionFeatures`に`speakToSign({ vault, network: 'testnet' })`を追加します。`seams.speakToSign.requestTransfer({ walletId, receiver, amount })`は、`sent`、`refused`、`cancelled`、`unavailable`のいずれかを返します。記述子を設定しないアプリは、Speak-to-Signのコードとアセットを一切ダウンロードしません。
- Speak-to-SignにはVoiceIDが必要です。`@seams/wallet`、`@seams/voiceid`、`@seams/speak-to-sign`を0.54.0でインストールし、`npx --no-install seams-speak-to-sign-host <dir>`でWalletのホストを構成してください。
- `@seams/wallet-server`に、Seamsの検証ルート`POST /speak-to-sign/v1/verify`を追加しました。6つの`SPEAK_TO_SIGN_OUTLAYER_*`変数をすべて設定しない限り、このルートは無効です。有効なウォレットセッションが必要です。
- VoiceIDのホストAPIはバージョン**9**になります。VoiceIDのホストプラグインに`recordPhrase`を追加しました。`@seams/voiceid` 0.54.0と`@seams/wallet` 0.54.0を一緒にインストールしてください。Walletは、別のバージョンのVoiceIDホストプラグインを拒否します。
- 0.53.0では、ウォレット設定に残高カード、**入金**、**出金**と`seams.assets`を追加しました。0.54.0でも変更はありません。

ウォレットのiframeプロトコルは **23.0.0**、ウォレット管理プロトコルは **5** のままです。
署名付きの復旧CLIは **0.29.0** のままです。このリリースにデータベースのマイグレーションはありません。

---
title: リリース 0.60.0
description: Seamsの共同署名者がSpeak-to-Signの各判定を音声の上限とともに確認し、音声によるリクエストが進行状況を知らせます。
---

# リリース 0.60.0

ブラウザーSDK、サーバーSDK、VoiceIDプラグイン、Speak-to-Signプラグインは **0.60.0** を使います。

- **実験的機能、NEARテストネット専用:** Seamsの共同署名者は、音声で承認された署名に自分の部分を加える前に、Speak-to-Signの判定をもう一度確認します。[信頼モデル](/ja/concepts/auth-methods/speak-to-sign#trust-model)を参照してください。
  - 音声で承認された取引の署名リクエストは判定を含みます。共同署名者は、固定された検証者の鍵による署名、期限、未署名の取引が話したリクエストを実行すること、そしてセッションのNEARアカウントが署名することを確認します。
  - 1つの判定は1つの署名リクエストだけを承認します。共同署名者は、新しいテーブル`speak_to_sign_voice_verdicts`に判定を記録します。
  - 各ウォレットの音声の上限: 声だけの支払いは1回最大10 NEAR、任意の24時間で最大20 NEARです。
  - `step_up`の判定には新しい承認が必要です。同じ操作のパスキーまたはEmail OTPのステップアップか、判定の後の新しいVoiceIDのアンロックです。VoiceIDのセッションでは、同じ署名の呼び出しの中で、新しいアンロックが新しい承認の要求を満たすようになりました。
  - 共同署名者の拒否は、理由が`voice_limit`または`cosigner_refused`の`refused`です。`detail`には`over_daily_limit`や`reused`のような理由が入ります。何も署名されていません。
- `requestTransfer`、`requestNote`、`requestRating`には、省略できる`onProgress`があります。`recording_sent`、`verifier_running`、`verdict`、`step_up`、`transaction_sent`、`settled`を受け取ります。[実験的機能: Speak-to-Sign](/ja/concepts/auth-methods/speak-to-sign#install)を参照してください。
- 検証ルートは確認の後、`text/event-stream`で応答します。`verifier_running`の後に、`verdict`か`failed`のイベントを1つ送ります。検証者が動作している間に、Walletは支払いのためのアクセスキーのnonceと最近のブロックハッシュを先に読みます。
- `rpIdOverride`がない場合、パスキーは`walletOrigin`のホストに結び付きます。以前は、すべてのウォレットのオリジンがローカルの既定値`example.localhost`のままでした。
- `routerAb`を設定しない場合、Seamsがホストするウォレットのオリジン(`staging.sign.seams.sh`、`test.sign.seams.sh`、`sign.seams.sh`)は、自身のSigningWorkerでRouter A/Bの通常署名を有効にします。そのため、`walletOrigin`、`relayerUrl`、`publishableKey`だけの`seamsTestnetConfig`でNEARに署名できます。以前は、アプリが`routerAb`を設定するまでNEARの署名は無効でした。[ホストするウォレットの設定](/ja/reference/configuration#hosted-wallet-branch)を参照してください。
- Speak-to-SignのホストAPIはバージョン **7** です。VoiceIDのホストAPIはバージョン **10** のままです。Walletは、別のバージョンのホストプラグインを拒否します。
- 次の順序でデプロイしてください。D1のマイグレーションを適用し、サーバーをデプロイし、その後にWalletホストをデプロイします。検証の応答がストリームになったため、Speak-to-SignにはサーバーとWalletホストの両方が0.60.0である必要があります。その他の署名は、2つのデプロイの間も動作します。0.59.0のアプリは進行状況のメッセージを無視しますが、2つの新しい拒否理由を読めないため、アプリも更新してください。
- 0.60.0にも含まれる0.59.0の変更:
  - Speak-to-Signは、音声によるコミュニティノート(`requestNote`)とノートの評価(`requestRating`)に署名します。
  - 検証者0.4.0(`8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef`)はノートの要求を追加します。送金は変わりません。
- 4つのパッケージをすべて0.60.0でインストールしてください。Speak-to-Signは引き続き実験的機能で、NEARテストネット専用です。実際の資金では使わないでください。

ウォレットのiframeプロトコルは **23.0.0**、ウォレット管理プロトコルは **5** のままです。
署名付きの復旧CLIは **0.29.0** のままです。このリリースはD1のマイグレーション`0089_speak_to_sign_voice_verdicts.sql`を1つ追加します。

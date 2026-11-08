---
title: リリース 0.56.1
description: 失敗したNEARトランザクションはNEARの理由付きでrevertedとして報告されます。Speak-to-Signのボールトは任意のNEARアカウントをオーナーにできます。VoiceIDの画面は高さを保ちます。0.56.0のenrollを引き継ぎます。
---

# リリース 0.56.1

ブラウザーSDK、サーバーSDK、VoiceID、Speak-to-Signは **0.56.1** です。

- 最終結果がFailureのNEARトランザクションは、`{ success: false, kind: 'reverted', transactionId, error, result }`になりました。`error`には、"The contract refused the call: Smart contract panicked: receiver is not a contact"のようなNEARの理由があります。以前の結果は`unresolved`で、受領画面は結果が不明だと表示していました。[結果とエラー](/ja/reference/results-and-errors)を参照してください。
  - NEARが実行前にトランザクションを拒否した場合、結果は`not_submitted`で、新しい任意のフィールド`rejection`が付きます。`NotEnoughBalance`の理由には、NEAR単位の残高と費用があります。
  - 受領カードは、リバートまたは拒否の理由を表示します。「承認状態を取得できません」は、結果が本当に不明な場合だけ表示します。
- **実験的機能、NEARテストネット専用:** 64桁の16進数の暗黙的アカウントを含め、任意のNEARアカウントがSpeak-to-Signのボールトを所有できます。オーナーが話すのは金額と連絡先だけです(例: "Send 0.5 NEAR to alice dot testnet")。以前は、ボールトが暗黙的アカウントのオーナーを"account is not speakable"で拒否していました。
- VoiceIDの画面は、モデルのダウンロード中も高さを保ちます。以前は、ダイアログが435 pxから553 pxに大きくなりました。
- 0.56.0の変更(0.56.1でも同じです):
  - **実験的機能、NEARテストネット専用:** `seams.speakToSign.enroll({ walletId })`は、オーナーの声をSpeak-to-Signの検証器に登録します。オーナーは3つの短いフレーズを読み、次に1回の`authorize_enrollment`呼び出しを承認します。結果は`enrolled`、`refused`、`cancelled`、`unavailable`のいずれかです。[実験的機能: Speak-to-Sign](/ja/concepts/auth-methods/speak-to-sign)を参照してください。
  - 0.55.0から: ウォレット設定の残高操作は**受け取り**と**送金**です。`seams.assets.prepareWithdrawal()`は`seams.assets.prepareSend()`になり、`seams.assets.openScreen({ screen, assetId })`は表示中の設定パネルで**資産**、**受け取り**、**送金**を開きます。[コアリファレンス](/ja/reference/core#asset-balances)を参照してください。
- 互換性:
  - `ActionResult`のすべての`kind`を扱う`switch`には、`reverted`を追加してください。0.56.0のアプリを0.56.1のWalletホストで使うと、リバートしたトランザクションは`submission_unknown`として報告されます。
- 4つのパッケージをすべて0.56.1でインストールしてください。VoiceIDのホストAPIはバージョン**9**のままです。Speak-to-Signは引き続き実験的機能で、NEARテストネット専用です。実際の資金では使わないでください。

ウォレットのiframeプロトコルは **23.0.0**、ウォレット管理プロトコルは **5** のままです。
署名付きの復旧CLIは **0.29.0** のままです。このリリースにデータベースのマイグレーションはありません。

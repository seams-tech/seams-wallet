---
title: リリース 0.56.2
description: 暗黙的アカウントを含め、任意のNEARアカウントがSpeak-to-Signのボールトを所有できます。0.56.1のrevertedの結果とVoiceIDの高さの修正を引き継ぎます。
---

# リリース 0.56.2

ブラウザーSDK、サーバーSDK、VoiceID、Speak-to-Signは **0.56.2** です。

- **実験的機能、NEARテストネット専用:** 64桁の16進数または`0x`の暗黙的アカウントを含め、任意のNEARアカウントがSpeak-to-Signのボールトを所有できます。オーナーが話すのは金額と連絡先だけです(例: "Send 0.5 NEAR to alice dot testnet")。テストネットのボールトと検証器は、任意のオーナーを受け付けます。
  - 0.56.1は、暗黙的アカウントまたは`0x`アカウントのオーナーに`{ kind: 'unavailable', reason: 'owner_not_speakable' }`を返していました。0.56.2では、このチェックを削除し、`SpeakToSignUnavailableReason`からこの理由を削除しました。
- 0.56.1の変更(0.56.2でも同じです):
  - 最終結果がFailureのNEARトランザクションは、`{ success: false, kind: 'reverted', transactionId, error, result }`です。`error`には、"The contract refused the call: Smart contract panicked: receiver is not a contact"のようなNEARの理由があります。[結果とエラー](/ja/reference/results-and-errors)を参照してください。
  - NEARが実行前にトランザクションを拒否した場合、結果は`not_submitted`で、任意のフィールド`rejection`が付きます。`NotEnoughBalance`の理由には、NEAR単位の残高と費用があります。
  - 受領カードは、リバートまたは拒否の理由を表示します。「承認状態を取得できません」は、結果が本当に不明な場合だけ表示します。
  - VoiceIDの画面は、モデルのダウンロード中も高さを保ちます。
- 0.56.0の変更(0.56.2でも同じです):
  - **実験的機能、NEARテストネット専用:** `seams.speakToSign.enroll({ walletId })`は、オーナーの声をSpeak-to-Signの検証器に登録します。オーナーは3つの短いフレーズを読み、次に1回の`authorize_enrollment`呼び出しを承認します。結果は`enrolled`、`refused`、`cancelled`、`unavailable`のいずれかです。[実験的機能: Speak-to-Sign](/ja/concepts/auth-methods/speak-to-sign)を参照してください。
  - 0.55.0から: ウォレット設定の残高操作は**受け取り**と**送金**です。`seams.assets.prepareWithdrawal()`は`seams.assets.prepareSend()`になり、`seams.assets.openScreen({ screen, assetId })`は表示中の設定パネルで**資産**、**受け取り**、**送金**を開きます。[コアリファレンス](/ja/reference/core#asset-balances)を参照してください。
- 互換性:
  - 0.56.1のために追加した`case 'owner_not_speakable'`を削除してください。この理由はなくなったので、TypeScriptがエラーを報告します。
  - `ActionResult`のすべての`kind`を扱う`switch`は、0.56.1で追加された`reverted`を扱う必要があります。
- 4つのパッケージをすべて0.56.2でインストールしてください。VoiceIDのホストAPIはバージョン**9**のままです。Speak-to-Signは引き続き実験的機能で、NEARテストネット専用です。実際の資金では使わないでください。

ウォレットのiframeプロトコルは **23.0.0**、ウォレット管理プロトコルは **5** のままです。
署名付きの復旧CLIは **0.29.0** のままです。このリリースにデータベースのマイグレーションはありません。

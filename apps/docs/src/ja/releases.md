---
title: リリース 0.57.0
description: 音声による支払いは任意の名前付きNEARアカウントに送れます。連絡先は任意です。任意のNEARアカウントがボールトを所有でき、revertedの結果を引き継ぎます。
---

# リリース 0.57.0

ブラウザーSDK、サーバーSDK、VoiceID、Speak-to-Signは **0.57.0** です。

- **実験的機能、NEARテストネット専用:** 音声による支払いは、`bob.testnet`のように所有者が読み上げられる任意の名前付きNEARアカウントに送れます。送金先がボールトの連絡先である必要はなくなりました。テストネットのボールトは、このような送金先を同じ1回ごとの上限と1日の上限で受け付けます。[実験的機能: Speak-to-Sign](/ja/concepts/auth-methods/speak-to-sign)を参照してください。
  - `SpeakToSignRefusalReason`から`receiver_not_contact`を削除しました。暗黙的アカウント(64桁の16進数)または`0x`の送金先には`receiver_not_speakable`を、存在しない送金先には`receiver_missing`を追加しました。
  - 連絡先は任意です。検証者は言葉を保存済みの連絡先と比較します。所有者が連絡先の名前を話し、リクエストが別のアカウントを指している場合、言葉の確認は失敗します。
  - 任意の名前付きアカウントが受け取れるため、声の確認が複製または再生を受け入れた場合、任意の名前付きアカウントに支払われる可能性があります。損失を制限するのは上限だけです。
  - 2つ目の登録用の文は"I send money only when I say so."になりました。
- Speak-to-SignのホストAPIはバージョン **3** です。Walletは、別のバージョンのSpeak-to-Signホストプラグインを拒否します。
- 0.56.2と0.56.1の変更(0.57.0でも同じです):
  - 64桁の16進数または`0x`の暗黙的アカウントを含め、任意のNEARアカウントがSpeak-to-Signのボールトを所有できます。
  - 最終結果がFailureのNEARトランザクションは、`{ success: false, kind: 'reverted', transactionId, error, result }`です。`error`にはNEARの理由があります。[結果とエラー](/ja/reference/results-and-errors)を参照してください。
  - NEARが実行前にトランザクションを拒否した場合、結果は`not_submitted`で、任意のフィールド`rejection`が付きます。
- 互換性:
  - `case 'receiver_not_contact'`を`receiver_not_speakable`と`receiver_missing`に置き換えてください。古い理由はTypeScriptがエラーを報告します。
  - `ActionResult`のすべての`kind`を扱う`switch`は、0.56.1で追加された`reverted`を扱う必要があります。
- 4つのパッケージをすべて0.57.0でインストールしてください。VoiceIDのホストAPIはバージョン**9**のままです。Speak-to-Signは引き続き実験的機能で、NEARテストネット専用です。実際の資金では使わないでください。

ウォレットのiframeプロトコルは **23.0.0**、ウォレット管理プロトコルは **5** のままです。
署名付きの復旧CLIは **0.29.0** のままです。このリリースにデータベースのマイグレーションはありません。

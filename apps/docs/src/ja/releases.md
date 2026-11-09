---
title: リリース 0.59.0
description: Speak-to-Signは、音声によるコミュニティノートとノートの評価に署名します。
---

# リリース 0.59.0

ブラウザーSDK、サーバーSDK、VoiceIDプラグイン、Speak-to-Signプラグインは **0.59.0** を使います。

- **実験的機能、NEARテストネット専用:** Speak-to-Signは、コミュニティノートやノートの評価に音声で署名します。[音声によるコミュニティノート](/ja/concepts/auth-methods/speak-to-sign#spoken-community-notes)を参照してください。
  - `seams.speakToSign.requestNote({ walletId, contract, postId, text, summary })`: 作成者はノートを入力し、1〜12語の短い要約を読み上げます。判定はノート全体をSHA-256で結び付けます。
  - `seams.speakToSign.requestRating({ walletId, contract, noteId, rating })`: 所有者は「this note is helpful」「this note is somewhat helpful」「this note is not helpful」のどれかを話します。
  - 判定が承認されると、Wallet coreは所有者のアカウントから呼び出しを1件作ります。ノートのコントラクトの`add_note`または`rate_note`で、デポジットも確認画面もありません。どちらも`requestTransfer`と同じ種類の結果を返し、新しい拒否理由`summary_not_speakable`と`note_not_valid`があります。
  - `@seams/wallet`の`summaryRefusal(text)`と`MAX_SUMMARY_WORDS`で、Walletを開く前に要約を確認できます。
- 検証者0.4.0(`8a0b7ba0dff61a4b45e5d1d164c011525e11fe9f4fd02a4e22368882447329ef`)は、`community_note`と`note_rating`の要求を追加します。送金は変わりません。4語以上の要約は、1語が違って聞こえても、1語が抜けても通ります。ただし「not」の追加や欠落は通りません。
- Speak-to-SignのホストAPIはバージョン **6** です。VoiceIDのホストAPIはバージョン **10** のままです。Walletは、別のバージョンのホストプラグインを拒否します。
- 0.59.0にも含まれる0.58.1の変更:
  - Speak-to-Signは、録音、確認、結果を1つのVoiceIDカードで示します。1つの流れで録音は5回まで、支払いは最大1回です。
  - 検証者は、値を持たない語の似た音の語(「NEAR」に対する「year」など)を受け入れます。
- 4つのパッケージをすべて0.59.0でインストールしてください。Speak-to-Signは引き続き実験的機能で、NEARテストネット専用です。実際の資金では使わないでください。

ウォレットのiframeプロトコルは **23.0.0**、ウォレット管理プロトコルは **5** のままです。
署名付きの復旧CLIは **0.29.0** のままです。このリリースにデータベースのマイグレーションはありません。

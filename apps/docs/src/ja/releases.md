---
title: リリース 0.52.0
description: NEARが送信時に拒否した所有者のNEARの取引(`NotEnoughBalance`など)は、レシートに理由を1回だけ示してRejected by NEARと表示します。
---

# リリース 0.52.0

ブラウザーSDK、サーバーSDK、VoiceIDは **0.52.0** です。

- NEARがアカウントの状態による理由(`NotEnoughBalance`など)で所有者の取引を送信時に拒否した場合、レシートは**Rejected by NEAR**を表示します。拒否の理由を1回だけ示し、署名済みの取引は期限切れまで実行される可能性があることを伝えます。これまでは**Confirmation unavailable**を表示し、拒否の理由を2回示していました。結果はこれまでどおり`rejection`付きの`unresolved`です。すぐに終えるには`cancelTransaction()`を呼んでください。
- 署名済みのバイト自体が拒否され、操作が`not_submitted`で終わる場合も、レシートは理由を1回だけ示します。
- 0.51.0は、所有者のNEARの費用の確認でガスをNEARの最低ガス購入価格(`min_gas_purchase_price`)で計算するようにしました。0.52.0もこの修正を含みます。
- `@seams/voiceid` 0.52.0と`@seams/wallet` 0.52.0を一緒にインストールしてください。VoiceIDのホストAPIはバージョン8のままです。

ウォレットのiframeプロトコルは **23.0.0**、ウォレット管理プロトコルは **5** のままです。
署名付きの復旧CLIは **0.29.0** のままです。このリリースにデータベースのマイグレーションはありません。

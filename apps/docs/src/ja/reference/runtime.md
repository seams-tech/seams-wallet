---
title: 独自の署名ランタイム
description: 署名ランタイム全体を管理するアプリ向けに、@seams/wallet/runtimeが公開するポートとファクトリー。
---

# 独自の署名ランタイム {#custom-signing-runtime}

`@seams/wallet/runtime`は、署名エンジンの周囲のプラットフォームを提供するホスト向けです。
`SeamsWeb`より低レベルの導入方法です。

`createSigningRuntime`、`createSigningRuntimeStatePorts`と、ランタイム設定、サービス、状態ポート、UI依存関係、準備済みセッションのUIポートの型を公開します。

ランタイムは、ホストが実装するインターフェースである「ポート」を通じてプラットフォームのサービスを受け取ります。
対象は次のとおりです。

- 認証。
- 時刻と乱数。
- HTTP通信。
- 永続レコードと安全な秘密情報。
- 署名の暗号処理。
- ランタイム固有のUI。

`RuntimePortsKind`を1つ選び、対応する`RuntimePorts`分岐の全項目を提供してください。
ポートを構築する前に、ホストからの生データを検証してください。
独自ランタイムは、安全な保存、キャンセル、ライフサイクルの復元、ユーザーの存在確認も管理します。
これらを管理する意図がある場合に利用してください。通常はブラウザーSDKを使います。

先に、[アーキテクチャ](/ja/concepts/architecture)と[オリジン・iframeの境界](/ja/deploy-and-operate/security-boundaries)を読んでください。

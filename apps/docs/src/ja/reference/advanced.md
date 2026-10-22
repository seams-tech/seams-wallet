---
title: 高度なヘルパー
description: '@seams/wallet/advancedが公開する低レベルの識別情報ビルダー、RPCクライアント、符号化ヘルパー、Tempoのユーティリティー。'
---

# 高度なヘルパー {#advanced-helpers}

`@seams/wallet/advanced`は、ライフサイクルとセキュリティの境界を独自に管理する実装に、低レベルのツールを提供します。

```ts [インポート例]
import { createEvmClient, MinimalNearClient } from '@seams/wallet/advanced';
```

## 識別情報ビルダーの公開先 {#identity-builders-moved}

境界で使う参照ビルダーは、このパスに加え、[`@seams/wallet`](/ja/reference/core)と`@seams/wallet/react`からも公開されます。
最初の署名呼び出しに、このパスからのインポートは必要ありません。

- `toWalletId`。
- `walletSessionRefFromSession`。
- `nearAccountRefFromAccountId`。
- `thresholdEcdsaChainTargetFromConfig`。
- `walletIdFromWalletProfile`。

これらは、ウォレット、セッション、アカウント、チェーンの関係を維持します。
参照は一度作成し、必要な操作へ渡してください。
チェーン対象には、`seams.config.chainTarget(selector)`を優先してください。クライアントに設定済みのチェーンだけを選択できます。

## その他の公開機能 {#other-exports}

このエントリーポイントには、最小限のNEAR・EVM RPCクライアント、トランザクションの符号化、base64urlとハッシュのヘルパー、
WebAuthn RP IDの解析、操作意図ID、しきい値セッションの上限、Tempoの手数料トークン用ヘルパーも含みます。

これらの基本機能では、プロトコルの詳細を多く扱い、製品向けの既定値は少なくなります。
登録、認証、署名、復元、デバイスの処理には、メインSDKを優先してください。

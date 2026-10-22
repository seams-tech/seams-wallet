---
title: EVM ECDSA
description: 厳密なRouter A/Bのロール分離で、EVM系ネットワーク向けのsecp256k1しきい値署名を使います。
---

# EVM ECDSA {#evm-ecdsa}

EVM系の署名は、secp256k1上のしきい値ECDSAを使います。
厳密なRouter A/Bのしきい値PRF導出が、クライアントとサーバーの加算スカラーシェアを生成します。

```text
x = x_client + x_server mod n
X = X_client + X_server
ethereum_address = address(X)
```

ECDSAは、Ed25519 Streaming Yao回路を使いません。
ライフサイクル操作中、Deriver AとBがロール内のしきい値PRF素材を管理します。
ブラウザーWorkerはクライアントシェアを受け取ります。
SigningWorkerは、有効化済みサーバーシェアと1回限りの事前署名状態を受け取ります。

## アドレスの不変条件 {#address-invariant}

Tempo、Arc、Ethereum、将来のEVM系対象は、同じウォレット、RP、署名ルート、鍵バージョンに対し、1つのしきい値所有者アドレスを共有します。

チェーン対象ごとに、セッション、利用枠、ノンスレーン、取引形式を分けられます。
同じ永続ECDSA鍵と、表示する所有者アドレスを使う必要があります。

## 通常署名 {#normal-signing}

通常のECDSA署名は、Routerの受付とSigningWorkerの参加を使います。
Deriver AやBを呼びません。プール補充と通常署名は、厳密なRouter A/Bルートと1回限りの事前署名状態を使います。

## EVM系トランザクションを実行する {#execute-an-evm-family-transaction}

アプリは、チェーン対象と型付きトランザクションを渡します。
ノンスの割り当ては、署名エンジン内で行います。

::: details 実行可能なTypeScriptの実装例

<<< ../../../examples/evm-signing.ts

:::

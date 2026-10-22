---
title: しきい値署名
description: 検証可能な公開識別情報を維持し、ウォレットの署名権限を保持者とサービスのロールに分割します。
---

# しきい値署名 {#threshold-signing}

しきい値署名により、Seamsは署名権限を保持者側とサーバー側の素材に分割します。
有効な署名には、選択した保持者レーンと、受け付けたサーバーの参加が必要です。

通常署名は、先行する導出や有効化の段階で生成した署名シェアを使います。
通常の署名のために、ウォレット鍵を再構成しません。

## 基本の考え方 {#mental-model}

```text
保持者側のシェア + 受付済みのサーバー側シェア -> 署名
```

Routerは、操作を署名処理へ進めてよいか判断します。SigningWorkerは、Routerの受付後だけ参加します。
Ed25519 Streaming YaoとECDSAのしきい値PRF導出は、ライフサイクルの手順中に実行します。
通常署名は、先に準備したシェアと事前署名状態を使います。

## セッション識別情報と署名権限 {#session-identity-versus-signing-authority}

しきい値署名は、独立したライフサイクルの識別情報を追跡します。

| 識別情報                      | 目的                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `thresholdSessionId`          | しきい値プロトコルのセッションと署名素材を識別する。プロトコル状態、復元した保持者素材、サーバー素材は、すべて同じIDを参照する必要がある。 |
| `AuthorizationGrantRef`       | 再利用可能なウォレットセッションの承認を識別する。                                                                                         |
| `walletSessionId` + `quotaId` | ウォレットセッションと、サーバーが管理する残り回数を識別する。                                                                             |
| `AuthorizedOperationId`       | 再利用可能な承認または検証済み追加認証の受付で、正確な1つの承認済み操作を識別する。                                                        |

プロトコルセッションは、しきい値署名の素材を選びます。
ウォレットセッションの利用枠や承認済み操作が、実行の可否を決めます。

## 素材の準備状態 {#material-readiness}

保存済みレコードは、Workerが使える署名素材を持つ証明にはなりません。
各ブラウザーWorkerは、現在の操作用に素材を読み込み、検証する必要があります。
検証は、承認元、承認済み操作、しきい値セッション、署名ルート、Router A/Bの範囲、Worker識別情報を対象とします。

実際に使う状態は、次のとおりです。

| 状態                          | 意味                                               |
| ----------------------------- | -------------------------------------------------- |
| 認証準備完了（Auth-ready）    | セッションの認証と利用枠が存在する。               |
| 復元準備完了（Restore-ready） | 永続的な封印済み素材があり、署名前に復元できる。   |
| 素材待ち（Material pending）  | 素材のヒントはあるが、Workerは未検証。             |
| 署名準備完了（Sign-ready）    | 正確な現在の紐づけに対し、Workerが素材を検証済み。 |

通常署名は、署名準備完了の状態からだけ開始します。
復元と追加認証は独立した段階で、最終署名前に完了する必要があります。

次に読むページ：

- [Router A/B](/ja/concepts/threshold-signing/router-ab)
- [Streaming Yao A/B](/ja/concepts/threshold-signing/streaming-yao-ab)
- [ブラインド決定的導出](/ja/concepts/threshold-signing/blind-deterministic-derivation)
- [サーバーレスのしきい値署名](/ja/concepts/threshold-signing/serverless-threshold-signing)
- [Ed25519](/ja/concepts/threshold-signing/ed25519)
- [EVM ECDSA](/ja/concepts/threshold-signing/evm-ecdsa)

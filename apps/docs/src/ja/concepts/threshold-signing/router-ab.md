---
title: Router A/B
description: 独立して管理するRouter A/Bのロールで、導出と署名の鍵管理を分離します。
---

# Router A/B {#router-a-b}

Router A/Bは、鍵の導出、SigningWorkerの有効化、通常署名リクエストの受付のサーバーロールを分離します。

## ロール {#roles}

| ロール        | 役割                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| Router        | 公開API、認証、ポリシー、利用枠、リプレイ、セッション検証、承認済み操作の受付、応答の紐づけ。 |
| Deriver A     | A側のサーバー導出素材と、A側の証明・出力パッケージ。                                          |
| Deriver B     | B側のサーバー導出素材と、B側の証明・出力パッケージ。                                          |
| SigningWorker | 通常署名経路の、有効化済みサーバー署名素材。                                                  |

## フローの構成 {#flow-shape}

Ed25519の登録、復元、エクスポート、更新、シェアの準備、有効化は、次の経路を使います。

```text
クライアント -> Router -> Deriver A + Deriver B -> クライアントまたはSigningWorker
```

日常の署名は、次の経路を使います。

```text
クライアント -> Router -> SigningWorker -> Router -> クライアント
```

Deriver AとBは、通常署名の経路に参加しません。

## 安全性の説明 {#security-claims}

Routerが見るのは、公開メタデータ、ルート認証、ポリシー状態、リプレイ状態、利用枠状態、暗号化ロールエンベロープです。
Deriver AはA側の素材を、Deriver BはB側の素材を見ます。
SigningWorkerは、選択した署名ルート、鍵バージョン、レーン、セッション用の有効化済みサーバー署名素材を見ます。

公開クライアントは、Router A/Bの通常署名APIを使います。

Ed25519のライフサイクル手順は、AとB間のStreaming Yaoを使います。
ECDSAは、厳密なしきい値PRFと加算シェアの経路を使います。
どちらも有効化後はDeriverを離れ、RouterとSigningWorkerで通常署名を行います。

## 署名準備完了の境界 {#sign-ready-boundary}

Router A/Bは、署名権限と署名素材の準備状態を分離します。

```text
AuthorizationGrantRef + WalletSessionId + quotaId -> 再利用可能な権限
検証済み追加認証の証跡 -> 1回の操作権限
AuthorizedOperationId -> 正確な受付済み操作
thresholdSessionId + Worker素材 -> しきい値署名への参加が可能
両方を一緒に検証 -> 署名準備完了
```

Routerは、セッション検証、不可分な操作受付・利用枠消費、リプレイ、リクエスト受付を管理します。
ブラウザーWorkerは保持者側署名素材を、SigningWorkerはサーバー側署名素材を管理します。
公開署名ルートを呼ぶ前に、現在のブラウザーWorkerが検証済みの素材を持つレーンを選択してください。
素材は、Router A/Bの範囲と承認済み操作に一致する必要があります。

SDKは、次の状態名を使います。

| 状態                          | Router A/Bでの意味                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `runtime_validated`           | 署名準備完了。承認元、承認済み操作、しきい値識別情報、利用枠、Router A/Bの範囲、Worker素材を一緒に紐づけ済み。 |
| `restore_available`           | 永続的なWorker素材があり、署名前に復元できる。                                                                 |
| `material_hint_unvalidated`   | 保存済み素材ハンドルはあるが、現在のWorkerは未検証。                                                           |
| `auth_ready_material_pending` | セッション認証は利用可能だが、必要な保持者側素材がない。                                                       |
| `non_signing`                 | 別のライフサイクル機能用の有効なレコード。Router A/B署名は承認できない。                                       |
| `invalid`                     | 必須の認証、範囲、利用枠、識別情報、素材の項目が欠けているか、不一致。                                         |

最終署名が受け付けるのは、`runtime_validated`だけです。
それ以外は、署名要求の送信前に、復元、追加認証、診断、失敗のいずれかへ進める必要があります。

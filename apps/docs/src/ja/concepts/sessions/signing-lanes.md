---
title: 署名レーン
description: 1回の署名操作に必要な、正確な鍵管理、機能、ポリシー、ノンスのレーンを選択します。
---

# 署名レーン {#signing-lanes}

署名レーンは、1回の操作で選択する、正確な署名機能です。

次の問いに答えます。

```text
誰が署名するか。
どの認証方法または委任レーンが、その機能を管理するか。
どの曲線とチェーン対象を使うか。
どの再利用可能なセッション承認または検証済み追加認証の証跡が、操作を承認するか。
どのしきい値セッションと鍵素材を使う必要があるか。
```

## ライフサイクル {#lifecycle}

1. 副作用のないスナップショットを読む。
2. 具体的なレーンを1つ選ぶか、型付きエラーで失敗する。
3. その正確なレーンだけを復元する。
4. そのレーンの認証を計画する。
5. 正確な承認済み操作を受け付け、該当する場合は利用枠を消費する。
6. 同じレーンで署名し、最終処理する。

スナップショットの読み取りでは、復元、入力要求、利用枠の消費、レコード削除、代替認証方法の選択を行わないでください。

## 署名準備完了のレーン {#sign-ready-lane}

同じ識別情報に対して、承認と署名素材の準備が完了した場合だけ、レーンは署名できます。

```text
署名準備完了 =
  （正確なAuthorizationGrantRef + WalletSessionId + quotaId
    または検証済み追加認証の証跡）
  + 正確なAuthorizedOperationId
  + 正確なthresholdSessionId
  + Router A/Bの範囲
  + 再利用時の有効な利用枠状態
  + 実行時に検証済みのWorker素材
```

他の状態は計画に使えますが、最終署名へ進めてはいけません。

```ts [プロトコルの概要]
switch (state.kind) {
  case 'runtime_validated':
    // The only sign-ready state: authorization, operation, threshold identity, quota,
    // Router A/B scope, and worker-owned material were validated together.
    return state.value;

  case 'restore_available':
    // Durable material exists, so an explicit restore phase can run first.
    throw new Error(`not sign-ready: ${state.reason}`);

  case 'material_hint_unvalidated':
    // A persisted handle exists, but the current worker has not validated it.
    throw new Error(`not sign-ready: ${state.reason}`);

  case 'invalid':
    // Required signing identity, auth, quota, material, or scope is missing.
    throw new Error(`not sign-ready: ${state.reason}`);

  case 'non_signing':
    // Valid lifecycle state for another purpose, but not Router A/B signing.
    throw new Error(`not sign-ready: ${state.reason}`);
}
```

最終署名には、`runtime_validated`状態が必要です。
復元、再発行、修復、新たな認証は、最終署名前の独立した計画段階で実行します。

## 例 {#examples}

署名レーンは、NEARのEd25519トランザクションと、Tempo・EVM系チェーンのECDSA署名を扱います。
パスキーとGoogle・メールOTPの認証は、それぞれの方法に紐づく正確なレーンを選択します。
リンク済みデバイスは、[デバイス連携フロー](/ja/concepts/delegation/linked-devices)で独自の署名権限を確立します。

再利用可能な利用枠が期限切れまたは消費済みの場合、選択したレーンの認証方法で、新たな追加認証を要求できます。
選択したレーンと署名主体の識別情報を維持する必要があります。
委任エージェントの実行は、別の[計画中機能](/ja/concepts/delegation/delegated-agents)です。

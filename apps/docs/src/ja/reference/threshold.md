---
title: しきい値署名API
description: '@seams/wallet/thresholdが公開する、安定したセッションポリシーのヘルパー、PRFソルト、操作意図のダイジェスト。'
---

# しきい値署名API {#threshold-apis}

`@seams/wallet/threshold`は、しきい値セッションポリシーの入力や登録ダイジェストを再現する必要があるアプリ向けの、安定したプロトコルAPIです。

次の機能を公開します。

- `THRESHOLD_SESSION_POLICY_VERSION`。
- `buildEd25519SessionPolicy`。
- `computeEd25519SessionPolicyDigest32`。
- `Ed25519SessionPolicy`型。
- `PRF_FIRST_SALT_V1`と`PRF_SECOND_SALT_V1`。
- `computeThresholdEcdsaKeygenIntentDigest`。

ポリシーは、信頼できる境界で構築してください。ダイジェストは、承認を正確なポリシーに紐づけます。
入力を変えると、別の承認オブジェクトになります。
一般的なブラウザーへの導入では、この処理を`SeamsWeb`に任せてください。

直接利用する前に、[しきい値署名](/ja/concepts/threshold-signing/)を読んでください。

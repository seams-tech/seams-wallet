---
title: Google認証を持ち込む
description: SDK 0.31.0で、アプリのGoogle SSOログインを関連付けたウォレットの設定表示に再利用します。
---

# Google認証を持ち込む {#bring-your-own-google-authentication}

アプリのGoogle IDトークンを使うと、関連付けたウォレットの設定を、再ログインなしで開けます。
署名と鍵管理には、引き続き所有者の認証が必要です。
SDK **0.31.0**では、Googleが最初のBYO認証プロバイダーです。
設定したOAuthクライアント向けの**IDトークン**を渡してください。
このAPIは、Googleアクセストークンや任意のWebAuthnアサーションには対応していません。

## 信頼するクライアントを設定 {#configure-trust}

Consoleの管理者セッションで、`PUT /console/environments/:environmentId/external-auth`を呼び出します。

```json [部分的な実装例]
{
  "kind": "google",
  "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com"
}
```

設定のリビジョンはサーバーが管理します。呼び出し側では指定できません。
環境の公開キーでは、アプリとホストするウォレットの両方のオリジンを許可してください。
SDKの設定には、その環境IDと公開キーが必要です。

`{ "kind": "disabled" }`を送ると、交換処理を無効にし、既存のセッションを拒否します。
設定を変更するとリビジョンが増加し、それ以前の外部認証セッションが無効になります。
自社運用の環境では、既存の静的デプロイ設定の`externalAuth`で同じ設定を指定します。
信頼設定を変更するたびに、静的設定のリビジョンも増加させてください。

## ウォレットを一度関連付ける {#associate-a-wallet-once}

所有者が既存のウォレット認証を完了した状態で、Google IDを関連付けます。

```ts [部分的な実装例]
const association = await seams.auth.associateExternalAuth({ method: 'google', walletId, idToken });
if (!association.ok) {
  showAuthenticationError(association.code);
}
```

`registration.registerOwnerWallet` で、再利用可能な署名セッションを作らずにNEAR専用ウォレットを登録できます。
関連付けには、ウォレットのオリジンで新しい所有者承認が必要です。
関連付けによって、ウォレットの鍵管理シード、公開鍵、署名権限は変わりません。
メールアドレスが一致しても、自動では関連付けません。
Googleの安定したサブジェクト識別子と、現在のアプリ環境を使います。

## ブラウザーでトークンを受け取る場合 {#browser-receives-the-google-token}

アプリのGoogleログイン完了後に呼び出します。

```ts [部分的な実装例]
const result = await seams.auth.authenticate({ method: 'google', walletId, idToken });
if (result.ok) {
  navigateToWalletSettings();
} else {
  showAuthenticationError(result.code);
}
```

ホストするウォレットがセッション認証情報を保持します。結果にはセッションのメタデータだけが含まれます。
Googleトークンは一時的に扱い、ブラウザーの永続ストレージには保存しません。
Reactプロバイダーは、作成された設定セッションを監視します。

## バックエンドでトークンを保持する場合 {#backend-retains-the-google-token}

SDKで、ブラウザーに結び付いた試行を準備します。

```ts [部分的な実装例]
const prepared = await seams.auth.prepareExternalAuth(walletId);
if (!prepared.ok) throw new Error(prepared.code);
```

`prepared.value`を、認証済みのアプリバックエンドに送ります。
バックエンドは、そのアプリセッションに属するGoogle IDトークンを取得し、次を呼び出します。

```http
POST /wallet/external-auth/backend-exchange
Authorization: Bearer YOUR_APPLICATION_SECRET_KEY
x-seams-environment-id: YOUR_ENVIRONMENT_ID
Content-Type: application/json

{
  "walletId": "SELECTED_WALLET_ID",
  "attemptId": "PREPARED_ATTEMPT_ID",
  "proof": { "kind": "google", "idToken": "GOOGLE_ID_TOKEN" }
}
```

APIキーには、対象環境の`wallets.read`権限が必要です。
成功時の応答は、`{ "ok": true, "value": { "code": "OPAQUE_HANDOFF" } }`です。
ブラウザーには、そのコードだけを返します。
元の試行を使って引き渡しを完了します。

```ts [部分的な実装例]
const result = await seams.auth.authenticate({
  method: 'handoff',
  walletId,
  attemptId: prepared.value.attemptId,
  code,
});
```

試行は2分で失効します。
準備、検証、関連付けの要求は、環境と送信元IPごとに毎分120回の制限を共有します。
同じ試行を同時に引き換えても、作成されるセッションは同じです。
再送や応答の復旧によって、有効期限は延長されません。
別のブラウザーの結び付きやセッショントークンでは、コードを引き換えられません。
交換の応答を受け取れなかった場合は、新しい試行を準備してください。
引き換えの応答を受け取れなかった場合は、同じ引き渡しを再試行してください。

## 有効期限とログアウト {#lifecycle-and-permissions}

外部認証セッションは、1時間またはGoogleトークンの有効期限の、早い方で失効します。
同じタブと埋め込み元のオリジンでは、有効なセッションを再読み込み後に復元できます。
サーバーは、設定の要求ごとに、プロバイダー設定、関連付け、ウォレット権限を再確認します。

アプリのログアウトとアカウント切り替え時には、`await seams.auth.lock()`を呼び出してください。
その後、新しいアカウントを明示的に認証します。
別の場所でGoogleからログアウトしても、発行済みIDトークンは直ちには失効しません。

`session.authentication.kind === 'external_authenticated'`で外部認証セッションを識別します。
その`session.capabilityProjection.kind`は`'not_requested'`です。
設定画面には、アカウント、有効な認証方法、デバイスの概要を表示できます。
セキュリティ設定の変更には、通常の所有者認証が必要です。
設定セッションの認証情報は、所有者や署名の要求を承認できません。

所有者を認証した状態で、関連付けを削除できます。

```ts [部分的な実装例]
await seams.auth.removeExternalAuth({ walletId, associationId });
```

外部認証セッションのメタデータには、`associationId`が含まれます。
ウォレット権限を失効させるか関連付けを削除すると、未完了の引き渡しも拒否されます。
ウォレットを移動しても関連付けは保持されます。
移動先では、外部認証セッションと未完了の引き渡しを再作成してください。

## 検証 {#verification}

対象は、SDK **0.31.0**とウォレットiframeプロトコル**20.0.0**です。
リポジトリのルートで、`pnpm -C packages/wallet build:sdk`の後に`node tests/e2e/external-auth.e2e.mjs`を実行します。
構造化された結果と設定画面の画像を、`.artifacts/external-auth/`に保存します。
E2Eは生成したテストトークンと、テスト専用のGoogle公開鍵の差し替えを使います。
実際の利用を有効にする前に、アプリのGoogleログインとログアウトを検証してください。

アプリ自身のログインセッションを使う場合は、[アプリのセッションと操作ごとの所有者承認](/ja/guides/application-auth)を参照してください。

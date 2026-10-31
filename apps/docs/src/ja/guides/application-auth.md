---
title: アプリのセッションと操作ごとの所有者承認
description: アプリのログインを再利用し、NEARの各操作をウォレット所有者のパスキーで承認します。
---

# アプリのセッションと操作ごとの所有者承認

SDKは、明示的に信頼したアプリのバックエンドから認証を引き継ぎます。
Googleログインとアプリのパスキー認証には、同じ安定したユーザーIDを使ってください。
外部認証の接続は、ウォレット設定の読み取りを許可します。
送金には、その操作専用の新しい所有者承認が必要です。

## 信頼の設定

ウォレットの運用者に、アプリの発行者とEd25519公開鍵の信頼設定を依頼してください。
`issuer` は正規化したHTTPSオリジンです。
公開鍵は32バイトのEd25519公開鍵をbase64urlで表します。
秘密鍵はアプリのバックエンドに保持します。
環境では、アプリとホストするウォレットの両方のオリジンを許可する必要があります。
設定の変更はリビジョンを更新し、以前の外部セッションを失効させます。
Consoleの管理手順は、運用者向けの非公開ドキュメントで管理します。

ユーザーの識別には、プロバイダー、発行者、安定したユーザーIDを使います。
メールアドレスの一致だけでは、ウォレットを関連付けません。
Googleを直接信頼する設定からアプリ発行者の設定へ移行する場合、所有者による新しい関連付けが必要です。
ウォレットの鍵は維持されます。

## 登録と関連付け

新しいNEAR専用ウォレットには、`registration.registerOwnerWallet` を使えます。
ウォレットのオリジンで所有者のパスキーを登録します。
暗号化した署名素材を保存し、ウォレットはロック状態にします。
再利用できる署名セッション、署名枠、エクスポート権限は発行しません。
この登録APIは、初期段階ではNEAR専用のパスキーウォレットを対象とします。

既存のウォレットは、次の操作でアプリのユーザーに関連付けます。
所有者がウォレットのパスキーで承認します。

```ts [部分的な実装例]
const attempt = await seams.auth.prepareExternalAssociation(walletId);
if (!attempt.ok) throw new Error(attempt.code);
const { code } = await applicationBackend.handoff(attempt.value);
await seams.auth.associateExternalAuth({
  method: 'handoff', walletId, attemptId: attempt.value.attemptId, code,
});
```

バックエンドは、検証済みのアプリセッションからユーザーIDを取得します。
`@seams/wallet-server/application-auth` の `createApplicationAuthAssertion` で署名します。
アサーションは、試行、ウォレット、環境、用途、有効期限に紐付きます。
有効期限は最大2分です。
ブラウザーには、バックエンドの交換処理が返す引き継ぎコードだけを渡します。

## 接続と送金

読み取り接続には `prepareExternalAuth` と `auth.authenticate({ method: 'handoff', ... })` を使います。
接続は最大1時間で、アプリの検証済みセッションより長くは続きません。

`near.prepareOwnerTransaction` は、各NEARトランザクションの承認ハンドルを返します。
`approve()` は内容を表示し、新しい所有者のパスキー応答を要求します。
サーバーはウォレット、署名者、ネットワーク、内容、有効期限を検証します。
既存の署名セッションがあっても、このAPIは新しい証明を要求します。
キャンセルしても、読み取り接続は維持されます。

GetSignalのパスキーはGetSignalを認証します。
ウォレットの操作承認には、ウォレットのオリジンで登録した所有者のパスキーを使います。
このAPIは、別のRPのパスキーをウォレット所有者の証明として受け付けません。

## 状態と結果の復元

`operation.getState()` またはReactの `useOwnerNearOperation(operation)` で状態を取得します。
準備、承認、送信、完了、キャンセル、期限切れ、失敗、結果不明を区別します。
Reactの `access: 'external'` のウォレットは、操作専用の承認ハンドルを提供します。

操作前に、秘密情報を含まない `state.recovery` を保存してください。
再読み込み後は `near.resumeOwnerTransaction({ authentication, recovery })` と `recover()` を使います。
`not_submitted` は未送信が確認された状態です。この試行の保留状態を解除し、新しい承認を提示できます。
`recovery_unavailable` は送信状態を確認できない状態です。保留中の記録を保持し、`recover()` で再確認できます。
`submitting` と `unresolved` は既知の `transactionId` を返します。このハッシュを保存し、チェーン上の結果を確認してください。
別の操作が承認をブロックした場合は、返された `recovery` を保存してください。新しく準備した操作とはIDが異なる場合があります。
タイムアウトや記録の欠落だけでは未送信を証明できません。エラー文の解析ではなく、型付きの状態を使ってください。
送信と状態照会は30秒で待機を終了します。タイムアウト時はハッシュを保持した `unresolved` を返し、再送信しません。
復元は保存済みのトランザクション結果を照会し、再送信しません。
未解決の送信がある場合、その接続の次の送信を停止します。

完全な[英語ガイド](/guides/application-auth)と、リポジトリの `examples/seams-auth-menu/application-auth.html` を参照してください。

対応するパッケージのバージョンは、[リリースノート](/ja/releases)で確認してください。

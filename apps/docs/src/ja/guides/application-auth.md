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

## 承認の前に独自の確認画面を表示する

読み取り用の `useSeams().wallet` で `review` を渡すと、ウォレットの承認の前にReactコンポーネントを表示できます。
呼び出し元の上に [`TransactionReviewHost`](/ja/guides/transaction-review#mount-the-host) を配置してください。

```tsx [部分的な実装例]
const operation = wallet.near.prepareOwnerTransaction({
  transaction,
  review: {
    title: '入金の確認',
    validity: { kind: 'unbounded' },
    render: (controls) => <DepositReview quote={quote} controls={controls} />,
  },
});
await saveDepositRecord(depositId, operation.getState().recovery);
const outcome = await operation.approve();
```

`DepositReview`、`quote`、`depositId`、`saveDepositRecord` はアプリケーション側で用意します。
`approve()` で確認画面が開き、状態は `reviewing` になります。「ウォレットへ進む」を選ぶと、同じモーダルがウォレットの承認に切り替わります。
このとき状態は `approval` になり、120秒の期限が始まります。確認画面の表示時間は、この期限に含まれません。
確認画面をキャンセルすると `cancelled` を返します。見積もりの期限切れでは `expired` を返します。その他の失敗では `not_submitted` を返します。
Coreの `seams.near.prepareOwnerTransaction` は `review` を受け付けません。

## 状態と結果の復元

`operation.getState()` またはReactの `useOwnerNearOperation(operation)` で状態を取得します。
準備、独自の確認、承認、送信、完了、キャンセル、期限切れ、失敗、結果不明を区別します。
Reactの `access: 'external'` のウォレットは、操作専用の承認ハンドルを提供します。

操作前に、秘密情報を含まない `state.recovery` を保存してください。
再読み込み後は `near.resumeOwnerTransaction({ authentication, recovery })` と `recover()` を使います。
`not_submitted` は未送信が確認された状態です。この試行の保留状態を解除し、新しい承認を提示できます。
`recovery_unavailable` は送信状態を確認できない状態です。保留中の記録を保持し、`recover()` で再確認できます。
`submitting` と `unresolved` は既知の `transactionId` を返します。このハッシュを保存し、チェーン上の結果を確認してください。
別の操作が承認をブロックした場合は、返された `recovery` を保存してください。新しく準備した操作とはIDが異なる場合があります。
NEARが送信を拒否した場合、`not_submitted` または `unresolved` に `rejection` が含まれます。`NotEnoughBalance` などの種類と、`signer_id`、`balance`、`cost` などのフィールドを表示できます。署名済みのバイト自体が無効な拒否(`InvalidSignature` など)は、すぐに `not_submitted` になります。`InvalidNonce` を含むその他の拒否は `unresolved` のままです。
アカウントが費用を支払えない場合、ウォレットは署名せず、`not_submitted` に `shortfall` を含めます。

### 止まった取引のキャンセル

`unresolved` または `retirement_available` の操作では、`operation.cancelTransaction()` を呼び出せます。所有者は、同じアクセスキーと同じnonceで署名した、自分のアカウントへの0 NEARの送金を承認します。NEARはキーの1つのnonceに1つの取引しか含めないため、このキャンセルが確定すると、操作は `proof.execution: 'not_executed'` と `proof.replacement` を含む `retired` で終了し、すぐに新しい取引を提示できます。この証明はキャンセル自身の確定結果に基づくため、遅れたRPCや応答のないRPCが誤って操作を終了させることはありません。NEARがキャンセルを拒否した場合は、`cancellationRejection` を含む `unresolved` のままです。`NotEnoughBalance` の場合は、NEARを追加してから再度キャンセルするよう案内してください。

`UNKNOWN_TRANSACTION` だけでは操作を終了できません。確定ブロックが有効期間(NEARでは約25時間)を過ぎるまで `unresolved` のままです。待機中の `unresolved` には `retirementWait` が含まれます。`retirementWait.lastAcceptedBlockHeight` を過ぎても自動では終了しないため、その後に `recover()` を再度呼び出してください。このブロックをエラー文から読み取らないでください。他の `unresolved` には `retirementWait` がありません。SDK 0.39.0以前のレシートはハッシュのみを保持するため、`retirementWait.submission.kind` は `hash_only` となり、更新後の最初の `recover()` から期間を数えます。この上限はNEARの制限ではなく安全のための待機で、実際の有効期間はより早く終わっている場合があります。
保留中でも、同じネットワークのRPCであればNEAR RPC URLを変更できます。ただしSDK 0.40.0以前の操作は、URLを変更する前に完了するか、元のURLで一度開いてください。別のURLでは `recovery_unavailable` を返し、新しい取引をブロックしなくなります。
`retired` で `proof.execution` が `not_executed` の場合、取引は期限切れで未実行です。この操作の保留だけを解除し、新しい承認を提示できます。
`retirement_available` は、NEARが今後この取引を実行できないものの、以前に実行された可能性がある状態です。保留を維持し、残高または台帳を確認してから `retire()` を提示してください。`retire()` はWalletの確認画面とパスキーを求め、再送信しません。キャンセルすると `unresolved` を返します。
`retired` で `proof.execution` が `unverified` の場合、所有者が期限切れの取引を解放しました。新しい承認を提示する前に残高または台帳を確認してください。
タイムアウトや記録の欠落だけでは未送信を証明できません。エラー文の解析ではなく、型付きの状態を使ってください。
送信と状態照会は30秒で待機を終了します。タイムアウト時はハッシュを保持した `unresolved` を返し、再送信しません。
復元は保存済みのトランザクション結果を照会し、再送信しません。
未解決の送信がある場合、その接続の次の送信を停止します。

完全な[英語ガイド](/guides/application-auth)と、リポジトリの `examples/seams-auth-menu/application-auth.html` を参照してください。

対応するパッケージのバージョンは、[リリースノート](/ja/releases)で確認してください。

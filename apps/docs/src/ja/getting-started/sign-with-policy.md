---
title: ポリシーに従って署名
description: 対象を明示した参照と取引ごとの承認を使って、NEAR、NEP-413、EVM系の要求に署名します。
---

# ポリシーに従って署名 {#sign-with-policy}

各要求は、承認の主体と対象チェーンを指定します。主体を省略すると、ログイン中のウォレットを使用します。
EVM系の呼び出しには、設定済みチェーンを示す`chainTarget`が必要です。
複数のウォレットを同時に管理する製品では、ウォレットを明示してください。
事前のアンロック操作は不要です。各要求で確認画面が開き、ユーザーがウォレットの認証方法で取引を承認します。
以下の例では、ボタンに`useSeams().wallet`を使い、単独の署名呼び出しに`SeamsWeb`クライアントを使います。

## NEAR取引 {#near-transaction}

この例は、NEARテストネットのアカウントに`set_greeting`関数の呼び出しを送信します。
送信先、アクション、実行ステータスは、アプリに合った値に置き換えてください。

<<< ../../examples/near-signing.tsx

`useSeams()`の`wallet.near`は、ウォレットにNEARアカウントができるまで`null`です。
署名ボタン付近のチェックによって、アカウントが存在する前の要求を防ぎます。
主体を明示する場合は、`walletSessionRefFromSession`と`nearAccountRefFromAccountId`で作成した
`walletSession`と`nearAccount`を渡して、`seams.near.signAndSendTransaction`を呼び出します。

## EVM系の取引 {#evm-family-transaction}

`seams.evm`はEIP-1559取引に署名します。`seams.tempo`はTempoのEIP-2718型付き取引に署名します。
どちらも`signTransaction`、`signAndSendTransaction`、`advanced`を提供しますが、取引形式と署名結果は異なります。
`seams.evm`は`txHashHex`、`seams.tempo`は`senderHashHex`を返します。

EVM用ユーティリティで取引を作成します。`'ethereum-sepolia'`など、設定済みのネットワークスラッグでチェーンを選択してください。
セレクターは、ちょうど1つのチェーンに一致する必要があります。2つに一致すると、SDKは両方の名前を含むエラーを送出します。
署名の前に`seams.config.chainTarget(selector)`で対象を解決してください。対象チェーンを示す参照を直接渡すこともできます。

<<< ../../examples/evm-signing.ts

この例はEthereum Sepoliaを対象とし、取引の値には仮の値を使っています。
ヘルパーを呼び出す前に、対象チェーンを設定に追加してください。
[チェーン設定の実装例](/examples/signing#execute-an-evm-family-transaction)も参照してください。
実際に送信する前に、チェーン、送信先、手数料、データを置き換えます。
SDKは対象チェーンから`tx.chainId`を設定し、チェーン設定のRPCエンドポイントを使います。
呼び出し時に、これらの値を重ねて渡す必要はありません。成功すると取引ハッシュを返します。

アプリ自身がペイロードをブロードキャストする場合は、`signTransaction`を使います。
ブロードキャストの結果は`seams.evm.advanced`または`seams.tempo.advanced`を通じて通知してください。

## 認証の手間を減らす {#sign-with-less-friction}

導入中は取引ごとの承認を使ってください。取引ごとの認証画面を省いて複数回署名する場合は、`unlock`で署名セッションを作成します。
[ウォレットセッションと署名レーン](/ja/guides/wallet-sessions-and-signing-lanes)を参照してください。

## キャンセルと再試行 {#handle-cancellation-and-retries}

- 確認のキャンセルやポリシーによる拒否は、その要求の結果として扱い、再試行の操作を明示してください。
- ブロードキャストの状態が不明な場合は、別の要求を送る前に取引またはノンスの状態を照合してください。
- 進行状況のUIや監査ログを実装する間は、`onEvent`コールバックを接続したままにしてください。
  正式な各実装例は、同じイベント形式を使っています。

## 次の手順 {#continue}

[デバイス連携、鍵のエクスポート、復元](/ja/getting-started/delegate-or-rotate)に進んでください。

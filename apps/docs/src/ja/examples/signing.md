---
title: 署名
description: ウォレットセッションで、NEARトランザクション、NEP-413メッセージ、EVM系トランザクションに署名します。
---

# 署名 {#signing}

署名呼び出しは、認証済みウォレットを自動的に特定します。
アプリが複数のウォレットやチェーンを扱う場合は、対象を明示してください。
以下の実装例は進行状況のイベントを通知するため、署名処理の状態をUIに表示できます。

## 前提条件 {#prerequisites}

設定済みの`SeamsWebProvider`と、サインイン済みのウォレットが必要です。
まだロック中の場合は、[ウォレットの設定と認証](/ja/examples/wallet-setup-and-authentication)を参照してください。

署名に個別のアンロック手順は必要ありません。
各リクエストでウォレットの確認画面が開き、ユーザーが取引を承認できます。
連続する署名のたびに確認を求めない製品では、`unlock`で署名セッションを用意します。

<<< ../../examples/unlock.ts

## NEARトランザクションを送信する {#send-a-near-transaction}

この実装例は、NEARテストネットのアカウントに`set_greeting`の関数呼び出しを送り、`EXECUTED_OPTIMISTIC`を待ちます。

<<< ../../examples/near-signing.tsx

ボタンの処理は、設定した実行状態に達してから完了します。
`useSeams()`は、サインアウト中に`wallet: null`を返し、NEARアカウントの準備完了まで`wallet.near: null`を返します。
ボタンの前の型ガードにより、そのアカウントがない状態での署名を防ぎます。

## NEP-413メッセージに署名する {#sign-a-nep-413-message}

購入の承認など、ドメインに紐づくオフチェーンのメッセージにはNEP-413を使います。

<<< ../../examples/nep413-signing.ts

成功結果には、署名済みメッセージのデータが含まれます。
このヘルパーは、SDKが`success: false`を返した後だけ例外を送出します。
必要に応じて、呼び出し側で例外を画面内のエラー状態へ置き換えてください。

## EVM系トランザクションを実行する {#execute-an-evm-family-transaction}

型付きのEIP-1559リクエストを作成し、対応するネットワークのチェーン対象を指定します。

既定の`seamsTestnetConfig`は、NEARとTempoを選択します。
Ethereum Sepoliaの実装例を実行するには、プロバイダーを作成する前に明示的に設定してください。

```ts [部分的な実装例]
import { defineSeamsConfig } from '@seams/wallet/react';

const config = defineSeamsConfig({
  walletOrigin: import.meta.env.VITE_WALLET_ORIGIN,
  relayerUrl: import.meta.env.VITE_RELAYER_URL,
  publishableKey: import.meta.env.VITE_SEAMS_PUBLISHABLE_KEY,
  chains: [{ network: 'near-testnet' }, { network: 'ethereum-sepolia', chainId: 11_155_111 }],
});
```

<<< ../../examples/evm-signing.ts

この実装例はEthereum Sepoliaを対象とし、トランザクションハッシュを返します。
実際に送信する前に、宛先、手数料、チェーン対象をアプリのトランザクションビルダーの値へ置き換えてください。
`tx.chainId`とRPCエンドポイントは、どちらもチェーン対象から取得するため、呼び出し時に再指定しません。

TempoのEIP-2718型付きトランザクションには、同じメソッド構成の`seams.tempo`を使います。

## 期待する結果 {#expected-result}

- NEAR署名は、指定したトランザクション実行状態に達してから完了します。
- NEP-413は、署名済みメッセージの成功結果を返します。
- EVM系の実行は、トランザクション送信後に`txHash`を返します。

進行状況のコールバックは、`SigningFlowEvent`を受け取ります。
状態表示に使い、照合用に最終的な操作識別情報を保持してください。

## 対処可能な失敗 {#recoverable-failures}

- 承認のキャンセルやポリシーによる拒否は、現在のリクエストを終了します。操作意図の下書きを保持し、再確認と再試行を可能にしてください。
- ウォレットセッションが期限切れか利用枠を使い切った場合は、再試行の前に再度アンロックしてください。
- 署名やRPCの失敗は、試行中の操作に紐づけてください。最初のハッシュまたはノンスの状態を照合してから、2つ目の取引を送信してください。
- SDKを呼ぶ前に、アプリ側でチェーンID、宛先、手数料、アカウント参照を検証してください。

次に、[ウォレットの高度な操作](/ja/examples/advanced-wallet-operations)、[イベントと進行状況](/ja/reference/events-and-progress)、[結果とエラー](/ja/reference/results-and-errors)を参照してください。

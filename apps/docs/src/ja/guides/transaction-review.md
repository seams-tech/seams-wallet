---
title: 独自の取引確認UI
description: 有効期限とキャンセルを明示し、ウォレットでの承認前に独自のReactコンポーネントを表示します。
---

# 独自の取引確認UI {#custom-transaction-review}

`useSeams().wallet`の取引メソッドに`review`オブジェクトを渡すと、ウォレットでの承認前に独自のReactコンポーネントを表示できます。
処理は、次の順序で進みます。

**独自の確認画面 → ウォレットへ進む → ウォレットで承認 → 取引の結果**

## ホストを配置する {#mount-the-host}

`SeamsWebProvider`と、確認画面が必要とするすべてのアプリ用プロバイダーの内側に、`TransactionReviewHost`を1つ配置します。
取引を送信するコンポーネントも、このホストの内側に配置してください。

```tsx [Partial example]
import { SeamsWebProvider, TransactionReviewHost } from '@seams/wallet/react';

<SeamsWebProvider config={config}>
  <TransactionReviewHost>
    <App />
  </TransactionReviewHost>
</SeamsWebProvider>;
```

確認画面は、ホストの祖先にあるコンテキストを継承します。
呼び出し元のボタンの周囲にだけ配置したプロバイダーは、確認画面にコンテキストを提供しません。

## Reactコンポーネントを渡す {#pass-a-react-component}

`render`コールバックは操作用のコントロールを受け取り、コンポーネントを返します。
返すコンポーネントでは、フック、コンテキスト、ローカル状態、`React.lazy`とSuspenseを使えます。

```tsx [Partial example]
review: {
  title: 'Review purchase',
  validity: { kind: 'unbounded' },
  render: (controls) => (
    <PurchaseReview quote={quote} controls={controls} />
  ),
}
```

この例の`PurchaseReview`と`quote`は、アプリ側で用意します。
同期コールバックからJSXを返し、フックは返すコンポーネントの内側に配置してください。

ダイアログ、背景、フォーカス管理はSDKが提供します。
別のダイアログやフォーカストラップを重ねずに、内容とボタンを渡してください。

| コントロール         | 動作                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `continueToWallet()` | ウォレットの承認画面を表示します。署名前に、ユーザーがその画面で承認する必要があります。            |
| `cancel()`           | 確認処理をキャンセルします。                                                                        |
| `fail(error)`        | 閉じることができるSDK標準のエラー画面を表示します。イベントハンドラーやデータ取得の失敗に使います。 |

## 有効期限を明示する {#choose-validity-explicitly}

`validity`は必須です。各呼び出しで、確認対象の取引に期限を設けるかを明示します。

- `{ kind: 'unbounded' }`：確認の期限を設けません。有効期限のある見積もりを伴わない送金などに使います。
- `{ kind: 'expires_at', atMs: quote.expiresAtMs }`：見積もりの期限を、**ミリ秒**単位のUnixタイムスタンプで渡します。
  値は正の安全な整数である必要があります。

期限切れは、承認と追加の署名を防ぎます。すでに開始した署名を取り消すことはできません。
期限切れの見積もりを更新し、新しい見積もりで新たに呼び出してください。
既存の見積もりを書き換えても、呼び出し時に取り込まれた取引は更新されません。
取引自体の経済的な条件を保証するには、コントラクトの期限とスリッページ上限を使ってください。

## 動作するNEARの実装例 {#runnable-near-example}

ログイン済みのNEARアカウントがある状態で、ホストの内側にこのボタンを配置します。
金額0の自己送金を実行します。ガス代は発生します。試す際は、テストネットのウォレットを使ってください。

<<< ../../examples/transaction-review.tsx

## 対応するメソッドと設定 {#supported-methods-and-settings}

| `useSeams().wallet`の署名者 | `review`を受け付けるメソッド                |
| --------------------------- | ------------------------------------------- |
| `near`                      | `signAndSendTransaction`                    |
| `evm`                       | `signTransaction`、`signAndSendTransaction` |
| `tempo`                     | `signTransaction`、`signAndSendTransaction` |

独自の確認画面には、ホストされたウォレットiframeと、実効値が`uiMode: 'modal'`、`behavior: 'requireClick'`となる確認設定が必要です。
保存済みの設定と互換性がない場合も上書きできるよう、実装例のとおり明示的に設定してください。
遅延後の自動承認には対応しません。Core SDKの呼び出し、メッセージ署名、エクスポート、認証は、このReactの確認APIを受け付けません。

SDKは、呼び出し時に取引の入力と確認設定を取り込みます。
戻り値のPromiseとライフサイクルコールバックの意味は、元のメソッドから変わりません。
「ウォレットへ進む」だけでは取引のPromiseは完了しません。呼び出しは、他のウォレット取引と同じキューに入ります。
呼び出し元やホストのキャンセル・アンマウントは、待機中または署名開始前の処理を無効にします。
署名が始まった後は、ウォレットが実際に返した結果を維持します。

## エラーとスタイル {#errors-and-styling}

署名処理への送出前に確認処理が失敗すると、`TransactionReviewError`でrejectされ、署名用コールバックは呼ばれません。
送出後の署名エラーは、正式な取引APIを通じてrejectされます。既存の接続エラーとRouterエラーの型は変わりません。

| `TransactionReviewError.code` | 意味                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `cancelled`                   | 確認をキャンセルしました。                                         |
| `review_expired`              | 期限が切れました。再試行の前に、新しい見積もりを取得してください。 |
| `review_invalid_input`        | 確認設定または取引の入力が無効です。                               |
| `review_host_unavailable`     | 利用可能な確認ホストがありません。                                 |
| `review_owner_disposed`       | 呼び出し元またはホストを破棄しました。                             |
| `review_unsupported_mode`     | ランタイムまたは確認モードが、この確認APIに対応していません。      |
| `review_identity_changed`     | 処理中にウォレットの識別情報が変わりました。                       |
| `review_render_failed`        | 描画に失敗したか、アプリが`fail(error)`を呼び出しました。          |
| `review_prepare_timeout`      | 確認画面の読み込み、またはウォレットの準備がタイムアウトしました。 |

任意の`review.className`で、確認画面のラッパーにスタイルを適用できます。
アプリのCSSは利用できますが、ポータルによってDOMの祖先が変わります。
祖先セレクター、継承するCSS変数、CSS-in-JSの挿入先は、調整が必要な場合があります。
SDKのライト・ダークと形状のトークンは引き続き利用できます。表示内容は、アプリのCSPを満たす必要があります。

アプリ側の確認画面から開いたウォレット承認画面には、**Back to review**（確認画面に戻る）が表示されます。
戻ると、確認コンポーネントのローカル状態と、元の見積もりの期限を維持します。
再度進むと、新たな取引を送出せずに、同じ保留中の承認を再開します。
共有モーダルは、どちらの方向でもサイズを調整し、画面をクロスフェードで切り替えます。
戻る操作は、ウォレット承認を送信するまで利用できます。取引の入力を変える場合は、新たに呼び出してください。

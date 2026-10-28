---
title: 実装例
description: 動作するSeamsウォレットを作成し、署名、復元、デバイス連携、エクスポート、テーマ設定を追加します。
---

# 実装例 {#examples}

これらの実装例は、アプリにコピーして利用できます。Seamsウォレットを使う場合は、まずプロバイダーを設定し、ウォレットを登録またはアンロックします。
その後、製品に必要な操作を選んでください。

外部NEARウォレットには、[コンパイル対象のコネクター実装例](/ja/guides/external-near-wallets#react-example)を使用してください。
専用のインポート先を使う開発プレビューで、Seamsのプロバイダーは不要です。
以下の前提条件はSeamsウォレットの実装例に適用されます。

## 前提条件 {#prerequisites}

SDKをインストールし、アプリが使うウォレットオリジン、リレーヤー、登録用の環境変数を設定してください。

```sh
pnpm add @seams/wallet@0.26.0
```

<<< ../../examples/setup.tsx

実装例の対象は、リリース**0.26.0**とiframeプロトコル**17.0.0**です。
この設定例では、NEARとTempoのテストネットを設定します。
Ethereum Sepoliaの実装例を使う場合は、[署名ガイド](/ja/examples/signing#execute-an-evm-family-transaction)のとおり、そのチェーンを追加してください。

設定例は、プロバイダーをアプリの境界に配置します。ウォレットUIは`SeamsWebProvider`の内側に配置してください。
各操作の実装例には、`seams`インスタンスとウォレットの識別情報を渡します。

## 実装例を選ぶ {#choose-an-example}

- [ウォレットの設定と認証](/ja/examples/wallet-setup-and-authentication)：パスキー、アンロック、GoogleとメールOTP。
- [取引とメッセージへの署名](/ja/examples/signing)：NEAR、NEP-413、EVM系チェーン。
- [ウォレットの高度な操作](/ja/examples/advanced-wallet-operations)：デバイス連携、復元、鍵のエクスポート。
- [ウォレットUIのカスタマイズ](/ja/examples/ui-customization)：ReactとウォレットiframeのUIの統一。

## コードの使い方 {#how-to-use-the-snippets}

`<<<`ブロックは、ソースの`examples`ディレクトリーにある共通のTypeScript実装例を読み込みます。
必要な関数やコンポーネントをコピーし、自社のUIとエラー通知につないでください。
`walletId`、`nearAccountId`、Google IDトークンなどの値は、認証済みのアプリ状態から取得します。

各処理は、型付きの成功・失敗結果を返すか、イベントコールバックで進行状況を通知します。
実装例を変更する際も結果の分岐処理を残し、キャンセル、ポリシーによる拒否、セッションの期限切れに対処できるようにしてください。

## 次に読む {#continue-building}

- [SDKリファレンス](/ja/reference/)：公開される型とエントリーポイント。
- [結果とエラー](/ja/reference/results-and-errors)：失敗の分岐。
- [イベントと進行状況](/ja/reference/events-and-progress)：処理の進捗。
- [基本概念とセキュリティ](/ja/concepts/)：動作する実装の背景にあるプロトコル。

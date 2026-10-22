---
title: ガイド
description: Seamsウォレットの導入に必要な設定、処理の流れ、アプリ側の責任範囲を確認します。
---

# ガイド {#guides}

まず動作する実装例から始めてください。その後、各ガイドで設定を選び、リリース前に処理の流れを確認します。
各ガイドは、アプリ側が担当する処理を説明します。

## 実装例から始める {#start-with-an-example}

- [ウォレットの設定と認証](/ja/examples/wallet-setup-and-authentication)：プロバイダーの設定、ウォレットの登録、アンロック。
- [署名](/ja/examples/signing)：NEAR取引の送信、NEP-413メッセージへの署名、EVM系の取引の実行。
- [ウォレットの高度な操作](/ja/examples/advanced-wallet-operations)：デバイス連携、ウォレットの復元、鍵のエクスポート。
- [UIのカスタマイズ](/ja/examples/ui-customization)：アプリ側とウォレット側のUIの統一。

## 機能を追加する {#keep-building}

- [認証](/ja/guides/authentication)：認証要素の選択と、キャンセル、期限切れ、再試行の状態の扱い。
- [組み込みウォレット](/ja/guides/embedded-wallets)：ウォレットの認証情報と署名ランタイムをウォレットオリジン内に維持。
- [外部EVMウォレット](/ja/guides/external-evm-wallets)：秘密鍵を拡張機能内に保持したまま、MetaMask、Rabby、PhantomのEVMアカウントを接続。
- [ポリシーと委任条件](/ja/guides/policies-and-mandates)：各操作を明示的な主体、対象、利用上限に紐づける。
- [ウォレットセッションと署名レーン](/ja/guides/wallet-sessions-and-signing-lanes)：署名処理の全体で同じセッション識別情報を使用。
- [権限を委任したエージェント](/ja/guides/delegated-agents)と[リンク済みデバイス](/ja/guides/linked-devices)：個別に取り消せる権限を追加。
- [復元・エクスポート・鍵のローテーション](/ja/guides/recovery-export-and-rotation)：影響の大きいアカウント変更を、新たな操作として扱う。
- [テーマの設定](/ja/guides/theming)：アプリ側とウォレット側の画面の見た目を統一。
- [取引確認UIのカスタマイズ](/ja/guides/transaction-review)：有効期限とキャンセルを明示し、ウォレットでの承認前に独自のReactコンポーネントを表示。

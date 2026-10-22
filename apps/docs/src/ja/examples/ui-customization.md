---
title: UIのカスタマイズ
description: Reactコンポーネントとウォレットiframeの画面に、共通の色と形状プリセットを適用します。
---

# UIのカスタマイズ {#ui-customization}

ウォレットの承認前に、アプリ独自の購入内容や取引内容を表示する場合は、[取引確認UIのカスタマイズ](/ja/guides/transaction-review)を参照してください。
`useSeams().wallet`のトランザクションメソッドの`review.render`を通じて、Reactコンポーネントを渡します。

Seamsは、アプリ側のReactコンポーネントとウォレットiframeで共通のテーマ設定を使います。
まず、少数のテーマトークンを変更してください。
操作部品の形状や寸法を変える場合は、形状プリセットを追加してください。

## 共通のテーマを適用する {#apply-one-theme}

React側のコンポーネントには`Theme`を使い、ウォレットiframeには`seams.config.setAppearance`を使います。
どちらにも、同じ色と完全な形状プリセットを渡します。

<<< ../../examples/theming.tsx

初期テーマは、プロバイダー設定の`appearance`で指定します。
実行中にテーマを切り替える場合は、`seams.config.setAppearance`を使います。

`seams.config.setAppearance`にも、形状レコード全体を送ってください。
表示設定の更新はキーごとにマージします。
完全なプリセットを渡すと、丸い部品から四角い部品へ戻す際に、古い値が残るのを防げます。

## 期待する結果 {#expected-result}

React側のアカウント・認証コンポーネントは、`Theme`のトークンを読み取ります。
認証メニュー、取引確認、エクスポートビューアーは、iframeの表示設定を読み取ります。
同じプリセットから両方を設定すると、テーマの切り替えが視覚的に統一されます。

## 対処可能な失敗 {#recoverable-failures}

- 指定がないトークンにはSDKの既定値を使います。形状を変える際は、`SHAPE_PRESETS.square`または`SHAPE_PRESETS.rounded`から始めてください。
- トークンを受け取るすべてのReactコンポーネントより上に、`Theme`を配置してください。境界の外のコンポーネントは、独自のスタイルを保持します。

トークン名、CSS変数、実行中の切り替え、iframeの詳細は、[テーマの設定](/ja/guides/theming)を参照してください。

---
title: ウォレットUIのテーマ設定
description: アプリ側のReactコンポーネントとウォレットオリジンのiframe画面に、共通の意味を持つ色と形状の設定を適用します。
---

# ウォレットUIのテーマ設定 {#theming-wallet-surfaces}

[UIのカスタマイズ](/ja/examples/ui-customization)の実装から始めてください。
Seamsは、アプリオリジンのReactコンポーネントと、ウォレットオリジンの保護された画面の2か所にUIを表示します。
両方で、同じ役割の色と同じ形状設定を使ってください。

## テーマを適用する {#apply-a-theme}

- アプリ側のReactコンポーネントには、`Theme`とそのトークンを使います。
- ウォレットiframe内の認証メニュー、確認画面、エクスポートビューアーには、SDK設定時の`appearance`、
  または`seams.config.setAppearance`を使います。
- `LIGHT_TOKENS`、`DARK_TOKENS`、および`SHAPE_PRESETS`のいずれかを基に設定します。
- 色の役割を上書きする際は、ライト・ダーク両方の値を揃えます。
- パレットを変更したら、テキストのコントラスト、フォーカスの見やすさ、状態の伝わり方、強制カラーモードでの表示を確認してください。

詳細なトークンとコードは、[テーマ設定のリファレンス](/ja/getting-started/theming)を参照してください。

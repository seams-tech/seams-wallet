---
title: ウォレットUIのテーマ
description: Reactコンポーネントとウォレットオリジンの画面に、同じ色と形状のトークンを適用します。
---

# ウォレットUIのテーマ {#theme-wallet-surfaces}

Seamsは、Reactアプリと保護されたウォレットiframeの両方にUIを表示します。
色と形状の値を共通にして、認証、署名、エクスポートの画面を製品に合わせてください。

## 共通のテーマを適用 {#apply-one-theme}

この例は、アプリ側の認証メニューとウォレットiframeの画面に、同じ色と丸みのある形状を適用します。

<<< ../../examples/theming.tsx

`Theme`は、Reactアプリが表示するコンポーネントにトークンの上書きを適用します。
`SeamsWeb`クライアントの作成後に`applyWalletTheme`を呼び出すと、ウォレットオリジンの認証メニュー、
取引確認画面、エクスポートビューアーにも同じ値を渡せます。

## 初期表示を設定 {#set-the-initial-appearance}

初期値は`SeamsConfigsInput.appearance`で設定します。
ユーザーがテーマを変えた場合や、システムの表示モードが変わった場合は、`seams.config.setAppearance`を使います。
更新内容は、現在の表示設定にマージされます。

## 形状を変更 {#change-shape-safely}

`SHAPE_PRESETS`は、カードの角丸、操作部品のサイズ、入力欄の見た目を統一します。
iframeを更新する際はプリセット全体を展開し、以前の形状の値が残らないようにしてください。

## トークン名 {#token-names}

色は`--seams-colors-<key>`、形状は`--seams-shape-<key>`になります。
主な色の役割には、`colorBackground`、`textPrimary`、`textSecondary`、`buttonBackground`、
ステータスの色、取引のハイライトがあります。
ウォレットiframeの表示設定は追加の色キーも受け付けるため、SDKをリリースせずにコンポーネント固有の値を渡せます。

アクセシビリティの確認事項は[テーマ設定ガイド](/ja/guides/theming)、
公開されているトークンの型は[Reactリファレンス](/ja/reference/react#appearance)を参照してください。

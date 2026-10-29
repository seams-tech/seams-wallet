---
title: SDKリファレンス
description: ブラウザー、React、しきい値署名、低レベル操作、独自ランタイムに対応するSeams SDKの公開インポート先を選択します。
---

# SDKリファレンス {#sdk-reference}

このリファレンスは、**@seams/wallet 0.28.0**を説明します。
Seamsパッケージは、少数の公開インポートパスを提供します。まずブラウザーAPIまたはReact APIから始めてください。
低レベルのインポートパスは、対応するランタイムやプロトコルを自社の実装で管理する場合に使います。

| インポートパス                                                  | 用途                                                                                                |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`@seams/wallet`](/ja/reference/core)                           | ブラウザーSDKの設定、登録、認証、署名、復元、デバイス、公開される結果の型。                         |
| [`@seams/wallet/react`](/ja/reference/react)                    | プロバイダー、フック、認証・プロフィール用コンポーネント、QRフロー、テーマのトークン。              |
| [`@seams/wallet/advanced`](/ja/reference/advanced)              | 対象を明示した識別情報のビルダー、RPCクライアント、エンコーダー、その他の低レベルの導入用ヘルパー。 |
| [`@seams/wallet/threshold`](/ja/reference/threshold)            | 安定したしきい値セッションのポリシーと、暗号処理の定数。                                            |
| [`@seams/wallet/runtime`](/ja/reference/runtime)                | プラットフォームの明示的な入出力インターフェースから、独自の署名ランタイムを作成。                  |
| [`@seams/wallet/external-evm`](/ja/guides/external-evm-wallets) | Seamsの鍵管理と独立した、ブラウザーのEVMウォレット拡張機能への接続。                                |
| [`@seams/wallet-server`](/ja/reference/server)                  | サーバーサービス、Workers、マイグレーション、ローカルランタイムのエントリーポイント。               |
| [`@seams/wallet-cli`](/ja/deploy-and-operate/recovery-cli)      | 署名済みネイティブバイナリーによるバックアップの検証と、テナントルートの復元。                      |

パッケージは、用途を絞ったReactコンポーネントのサブパスと、ホストするウォレットHTMLアセットも公開します。
これらは、[Reactリファレンス](/ja/reference/react)と[ホスト環境への導入](/ja/deploy-and-operate/hosted-integration)で説明します。

ブラウザーSDKとサーバーSDKは**0.28.0**を使用します。復元CLIは**0.28.0**です。
導入とデプロイの要件は、[リリース 0.28.0](/ja/releases)を参照してください。

## 準備中のNEARコネクター {#prepared-near-connector}

バージョン**0.28.0**には、次のインポート先が含まれます。コネクターは開発プレビューです。
提供状況、実装例、結果の分岐は[外部NEARウォレット](/ja/guides/external-near-wallets)を参照してください。

| インポート先                        | 公開API                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `@seams/wallet/external-near`       | `ExternalNearController`、`ExternalNearConfig`、`nearWalletName`、外部NEARの状態・結果の型。 |
| `@seams/wallet/react/external-near` | `ExternalNearWalletPicker`、`useExternalNear`。                                              |

## 状態と失敗のリファレンス {#state-and-failure-references}

- [設定](/ja/reference/configuration)
- [結果と対処可能なエラー](/ja/reference/results-and-errors)
- [イベントと進行状況](/ja/reference/events-and-progress)

公開リファレンスは、パッケージがエクスポートする機能を説明します。
内部のソースモジュールや保存レコードは実装の詳細であり、公開の移行手段を用意せずに変更する場合があります。

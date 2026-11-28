---
title: SDKリファレンス
description: ブラウザー、React、しきい値署名、低レベル操作、独自ランタイムに対応するSeams SDKの公開インポート先を選択します。
---

# SDKリファレンス {#sdk-reference}

このリファレンスは、**@seams/mpc-wallet 0.77.0**と、一緒に提供するパッケージを説明します。
各インポートパスは、コードが動く場所を示します。ルートのインポートを持つパッケージはありません。まずブラウザーAPIまたはReact APIから始めてください。
低レベルのエクスポートは、対応するランタイムやプロトコルを自社の実装で管理する場合に使います。

| インポートパス | 用途 |
| --- | --- |
| [`@seams/mpc-wallet/client`](/ja/reference/core) | ブラウザーSDKの設定、登録、認証、署名、復元、デバイス、公開される結果の型。 |
| [`@seams/mpc-wallet/client`](/ja/reference/advanced) | 対象を明示した識別情報のビルダー、RPCクライアント、エンコーダー、その他の低レベルの導入用ヘルパーも提供。 |
| [`@seams/mpc-wallet/client`](/ja/reference/threshold) | 安定したしきい値セッションのポリシーと、暗号処理の定数も提供。 |
| [`@seams/mpc-wallet/client`](/ja/reference/runtime) | プラットフォームの明示的な入出力インターフェースから作る、独自の署名ランタイムも提供。 |
| [`@seams/mpc-wallet/react`](/ja/reference/react) | プロバイダー、フック、認証・プロフィール用コンポーネント、QRフロー、VoiceIDの表示部品、テーマのトークン。 |
| `@seams/mpc-wallet/styles.css` | Reactコンポーネントのスタイルシート。 |
| [`@seams/mpc-wallet/voiceid`](/ja/concepts/auth-methods/voiceid) | VoiceIDの記述子`voiceIdAuthMethod()`と、VoiceIDのホスト契約。 |
| [`@seams/mpc-wallet/server`](/ja/guides/application-auth) | アプリのバックエンド向けの`createApplicationAuthAssertion`。 |
| [`@seams/wallet-connect/client`と`/react`](/ja/reference/wallet-connect) | 既存のEVMとNEARのブラウザーウォレットへの接続。Seamsのアカウントも鍵管理も不要です。 |
| [`@seams/host`](/ja/reference/server) | サーバーサービス、Workers、マイグレーション、ローカルランタイムのエントリーポイント、ウォレットオリジンのドキュメント、VoiceIDのホストプラグイン。 |
| [`@seams/cli`](/ja/deploy-and-operate/recovery-cli) | 署名済みネイティブバイナリーによるバックアップの検証と、テナントルートの復元。 |

ブラウザーSDKとサーバーSDKは**0.77.0**を使用します。復元CLIは**0.29.0**です。
導入とデプロイの要件は、[リリース 0.77.0](/ja/releases)を参照してください。

## 準備中のNEARコネクター {#prepared-near-connector}

バージョン**0.77.0**には、次のインポート先が含まれます。コネクターは開発プレビューです。
提供状況、実装例、結果の分岐は[外部NEARウォレット](/ja/guides/external-near-wallets)を参照してください。

| インポート先                        | 公開API                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `@seams/wallet-connect/client` | `ExternalNearController`、`ExternalNearConfig`、`nearWalletName`、外部NEARの状態・結果の型。 |
| `@seams/wallet-connect/react` | `ExternalNearWalletPicker`、`useExternalNear`。 |

## 状態と失敗のリファレンス {#state-and-failure-references}

- [設定](/ja/reference/configuration)
- [結果と対処可能なエラー](/ja/reference/results-and-errors)
- [イベントと進行状況](/ja/reference/events-and-progress)

公開リファレンスは、パッケージがエクスポートする機能を説明します。
内部のソースモジュールや保存レコードは実装の詳細であり、公開の移行手段を用意せずに変更する場合があります。

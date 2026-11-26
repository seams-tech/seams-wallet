---
title: HostとCLI
description: 対応する@seams/hostのエントリーポイント、同梱ランタイムのコマンド、復元CLIの管理範囲。
---

# HostとCLI {#server-sdk-and-cli}

`@seams/host@0.76.0`は、運用者がデプロイするサービスのパッケージです。再利用可能なWalletサービス、ストレージアダプター、Cloudflare Workers、マイグレーション、署名用WASMバインディング、ウォレットオリジンのドキュメント、VoiceIDのホストプラグインを提供します。`@seams/wallet-server`に代わるパッケージです。
現在の復元CLIランチャーは、`@seams/cli@0.29.0`です。
デプロイ用アセットを選ぶ前に、[リリース状況](/ja/releases)を確認してください。

```sh
pnpm add @seams/host@0.76.0
npm install --global @seams/cli@0.29.0
```

## サーバーのエントリーポイント {#server-entry-points}

| インポートパス                                            | 範囲                                       |
| --------------------------------------------------------- | ------------------------------------------ |
| `@seams/host/server-types` | 共通のサーバーサービスと契約               |
| `@seams/host/router/cloudflare`                  | Cloudflare Routerアダプター                |
| `@seams/host/router/ror`                         | Router-of-Routersアダプター                |
| `@seams/host/storage/tenant-route`               | テナントルートの経路ストレージ             |
| `@seams/host/wasm/signer`                        | 署名用WASMバインディング                   |
| `@seams/host/cloud-host`                         | ホストする登録・権限サービス               |
| `@seams/host/hosted-wallet-gateway`              | Gatewayの構成                              |
| `@seams/host/hosted-wallet-gateway-worker`       | ホストするGateway Worker                   |
| `@seams/host/local-hosted-wallet-gateway-worker` | ローカルGateway Worker                     |
| `@seams/host/tenant-root`                        | テナントルートのライフサイクルと復元の契約 |
| `@seams/host/local-runtime`                      | ローカルランタイムの設定スクリプト         |
| `@seams/host/local-runtime/*`                    | 同梱のローカルランタイムスクリプト         |
| `@seams/host/artifact-manifest.json`             | 同梱ランタイムの識別情報                   |
| `@seams/host/migrations/d1-signer/*`             | 署名用マイグレーションファイル             |
| `@seams/host/wallet-origin-html` | ウォレットオリジンのHTMLドキュメント（`getWalletServiceHtml`） |
| `@seams/host/voiceid` | VoiceIDのホストプラグイン、そのモデル、`composeVoiceIdWalletAssets` |
| `@seams/host/package.json`                       | パッケージのメタデータ                     |

各エントリーポイントは、異なる境界を公開します。記載したパッケージパスからインポートしてください。
内部ソースファイルは、対応する公開APIに含まれません。
Walletバックエンドは、Workers、Durable Objects、D1、Rust/WASMを使います。
旧Node Gateway、Expressアダプター、ネイティブVMのロールホストは削除済みです。

## ローカルコマンド {#local-commands}

インストールしたサーバーパッケージは、次のコマンドを提供します。

- `seams-wallet-server-local`：ローカルのWalletシステム全体を起動。
- `seams-wallet-server-local-roles`：分離したプロトコルロールを起動。
- `seams-wallet-server-local-init --root <directory>`：ローカルの識別情報を初期化。
- `seams-wallet-server-d1-migrate`：同梱のローカル署名用マイグレーションを適用。
- `seams-voiceid-host <新しいディレクトリー>`：`@seams/mpc-wallet`のWalletアセットとVoiceIDのホストプラグインを、新しい静的ディレクトリーに構成。

公開ソースのチェックアウトでは、別々のターミナルで`pnpm router`と`pnpm site`を使います。
非公開Consoleのチェックアウトでは、そのリポジトリーのコマンドと、バージョンを固定したnpm依存関係を使います。
公開Walletの実装ソースを、Consoleリポジトリーへコピーしないでください。

## ホスト環境での登録 {#hosted-registration}

独自の登録権限サービスでは、`@seams/host/cloud-host`の`resumeRegistrationDirectoryPublicationsV1`を定期実行する必要があります。
ローカルで確定済みでも、ディレクトリーから未確認の完了通知を再試行します。
同梱のローカルGatewayは、この処理を定期実行します。
マイグレーションと実行時期の要件は、[ホスト環境への導入](/ja/deploy-and-operate/hosted-integration#registration-completion)を参照してください。

非公開のロール間プロトコルが変わった場合は、対応するバックエンドロールをデプロイしてください。
アプリとiframe間の互換性だけでは、鍵管理Worker間の互換性は保証されません。

## 復元CLI {#recovery-cli}

npmランチャーは、実行前に署名済みネイティブマニフェストとバイナリーを検証します。
macOS Apple Silicon、macOS Intel、Linux x86-64に対応します。ランチャーにはNode.js 22以降が必要です。

ダッシュボードの承認、保持者の鍵、バックアップ検証、中断した復元、アクティベーションは、[復元CLIガイド](/ja/deploy-and-operate/recovery-cli)を参照してください。
CLIは、未設定の移動先を許可したり、ウォレットのリージョン移動の所有者承認を代行したりしません。
テナントルートの復元とウォレットの移行は、対象範囲が異なります。
[復元機能の提供状況](/ja/deploy-and-operate/recovery-and-portability#availability)を参照してください。

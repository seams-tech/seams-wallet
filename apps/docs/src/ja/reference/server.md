---
title: サーバーSDKとCLI
description: 対応するWallet Serverのエントリーポイント、同梱ランタイムのコマンド、復元CLIの管理範囲。
---

# サーバーSDKとCLI {#server-sdk-and-cli}

`@seams/wallet-server@0.21.0`は、再利用可能なWalletサービス、ストレージアダプター、Cloudflare Workers、マイグレーション、署名用WASMバインディングを提供します。
現在の復元CLIランチャーは、`@seams/wallet-cli@0.21.0`です。
デプロイ用アセットを選ぶ前に、[リリース状況](/ja/releases)を確認してください。

```sh
pnpm add @seams/wallet-server@0.21.0
npm install --global @seams/wallet-cli@0.21.0
```

## サーバーのエントリーポイント {#server-entry-points}

| インポートパス                                            | 範囲                                       |
| --------------------------------------------------------- | ------------------------------------------ |
| `@seams/wallet-server`                                    | 共通のサーバーサービスと契約               |
| `@seams/wallet-server/router/cloudflare`                  | Cloudflare Routerアダプター                |
| `@seams/wallet-server/router/ror`                         | Router-of-Routersアダプター                |
| `@seams/wallet-server/storage/tenant-route`               | テナントルートの経路ストレージ             |
| `@seams/wallet-server/wasm/signer`                        | 署名用WASMバインディング                   |
| `@seams/wallet-server/cloud-host`                         | ホストする登録・権限サービス               |
| `@seams/wallet-server/hosted-wallet-gateway`              | Gatewayの構成                              |
| `@seams/wallet-server/hosted-wallet-gateway-worker`       | ホストするGateway Worker                   |
| `@seams/wallet-server/local-hosted-wallet-gateway-worker` | ローカルGateway Worker                     |
| `@seams/wallet-server/tenant-root`                        | テナントルートのライフサイクルと復元の契約 |
| `@seams/wallet-server/local-runtime`                      | ローカルランタイムの設定スクリプト         |
| `@seams/wallet-server/local-runtime/*`                    | 同梱のローカルランタイムスクリプト         |
| `@seams/wallet-server/artifact-manifest.json`             | 同梱ランタイムの識別情報                   |
| `@seams/wallet-server/migrations/d1-signer/*`             | 署名用マイグレーションファイル             |
| `@seams/wallet-server/package.json`                       | パッケージのメタデータ                     |

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

公開ソースのチェックアウトでは、別々のターミナルで`pnpm router`と`pnpm site`を使います。
非公開Consoleのチェックアウトでは、そのリポジトリーのコマンドと、バージョンを固定したnpm依存関係を使います。
公開Walletの実装ソースを、Consoleリポジトリーへコピーしないでください。

## ホスト環境での登録 {#hosted-registration}

独自の登録権限サービスでは、`@seams/wallet-server/cloud-host`の`resumeRegistrationDirectoryPublicationsV1`を定期実行する必要があります。
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

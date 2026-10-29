---
title: ホスティング先
description: Seamsウォレットのサーバーロールを実行するCloudflare Workers、Google Cloud VM、AWS EC2と、各環境で検証した内容。
---

# ホスティング先 {#hosting-targets}

Seamsウォレットのサーバーロールは、3つのホスティング先で実行できます。

| 対象         | ランタイム                                 | ストレージ            | 状況                                                 |
| ------------ | ------------------------------------------ | --------------------- | ---------------------------------------------------- |
| Cloudflare   | WorkersとDurable Objects                   | D1、KV、R2            | 本番環境の構成。Seamsのホストサービスはここで稼働。  |
| Google Cloud | Compute Engine VM上のSeamsランタイムビルド | Cloud Storageバケット | 通常のVMとConfidential VM（AMD SEV-SNP）で検証済み。 |
| AWS          | EC2インスタンス上のSeamsランタイムビルド   | S3バケット            | 通常のインスタンスで検証済み。                       |

全環境でロールは同じです。Router、Deriver A、Deriver B、SigningWorker、テナントルートのコントロールプレーンを使います。
各環境は、リクエストハンドラーを変更せずに、リリース済みWallet Serverパッケージを実行します。

## Seamsランタイムビルド {#seams-runtime-build}

VM上では、オープンソースの[celld](https://github.com/denoland/celld)をSeams向けにビルドしたランタイムで各ロールを実行します。
Workerコードを実行し、Durable Objects、D1、KVのAPIを提供し、永続状態をオブジェクトストレージに保存します。
別のデータベースやキャッシュサービスは必要ありません。

1台のVMが、1つのホスト障害ドメインになります。2台以上のVMは、1つのフリート用バケットを共有します。
ノードが故障すると、別のノードがそのDurable Objectsを引き継ぎます。

## 各環境で検証した内容 {#what-each-target-has-been-tested-for}

**Cloudflare。** Walletのライフサイクル契約テストは、Workersランタイム上で実行します。
ホストサービスはCloudflare上で稼働します。

## 過去のプロバイダー検証 {#historical-provider-qualification}

現在のSDKは**0.28.0**です。以下は、各検証時のバージョンと構成を記録したものです。
古いバージョンの検証結果は、0.28.0の同じ環境での検証を示しません。
現在のデプロイ要件は[リリース 0.28.0](/ja/releases)を参照してください。

**Google Cloud。** `us-central1`でWallet Server 0.11.0を検証しました。
選択した16件のWalletブラウザー契約テストは、通常のVMとAMD SEV-SNP Confidential VMの両方で成功しました。
進行中のYao鍵生成手順は、ノード停止や相手との通信切断でも安全性を維持します。
中断した試行は利用不能のままです。残ったノードが引き継ぎ、新しいウォレットの処理を完了します。

**AWS。** 2026年10月21日、`ap-southeast-1`（シンガポール）で、Wallet Server 0.17.0を検証しました。
S3ストレージと2台の`m7i.xlarge`を使いました。
単一ノードのサービス確認では、HTTPS転送、リクエスト本文の上限、強制再起動後の状態復元に成功しました。
Google Cloudと同じYaoのノード停止・通信切断の確認も成功しました。

Confidential VMで動作しても、アテステーションに基づく鍵の解放は実現しません。それには別の設計が必要です。

## 未提供の機能 {#not-yet-available}

- **セルフサービスのデプロイツール。** 現在、VMへのデプロイには当社の支援が必要です。早期利用についてお問い合わせください。顧客向けのデプロイツール、ウォレットのインポート、検証付き切り替えは計画中です。[復元と移行](/ja/deploy-and-operate/recovery-and-portability)を参照してください。
- **AWS。** ブラウザー契約テスト一式、S3アクセス拒否の確認、Confidentialインスタンスは未検証です。シンガポールにはSEV-SNPのインスタンスタイプがありません。
- **稼働中のデプロイ環境の移行。** ウォレットは、承認済みの移動または復元フローだけで移してください。ホスト間でストレージのスナップショットをコピーしないでください。

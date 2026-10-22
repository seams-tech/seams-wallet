---
title: デプロイと運用
description: ウォレットUIのホスティング、オリジンの保護、環境設定、監視、トラブルシューティングに関する本番環境向けの手順を確認します。
---

# デプロイと運用 {#deploy-and-operate}

本番環境への導入は、製品のアプリと、分離されたウォレットランタイムの2つで構成されます。
それぞれをレビュー済みのアーティファクトからデプロイし、個別のオリジンとセキュリティポリシーを設定してください。
鍵管理の各ロールが使う秘密情報を、ブラウザーに渡さないでください。

ウォレットサーバーの各ロールは、Cloudflare Workers、Google Cloud VM、AWS EC2で動作します。
各環境で確認済みの範囲は、[ホスティング先](/ja/deploy-and-operate/hosting-targets)を参照してください。

このセクションを使って、リリースを準備してください。

1. [ウォレットの導入環境をホスト](/ja/deploy-and-operate/hosted-integration)します。
2. [オリジン、iframe、CSP、要求認証の境界](/ja/deploy-and-operate/security-boundaries)を確認します。
3. [環境変数](/ja/deploy-and-operate/environment)を、適切な管理主体に割り当てます。
4. [本番環境の確認事項](/ja/deploy-and-operate/production-checklist)を完了します。
5. [監視と監査](/ja/deploy-and-operate/observability-and-audit)を設定します。
6. [トラブルシューティング](/ja/deploy-and-operate/troubleshooting)の手順を練習します。

R2に保存する個別のA/B復元用コピー、Google KMSの鍵の所有権、復元時の動作、運用費用は、
[テナントルートのバックアップ](/ja/deploy-and-operate/tenant-root-backups)を参照してください。

[復元CLI](/ja/deploy-and-operate/recovery-cli)を使って、ダウンロードしたバックアップキットを検証します。
オフラインで検証できるネイティブバイナリーを保持し、承認済みの空の移行先に、両方の保持者のシェアを復元してください。

バックアップ方針を選ぶ前に、[復元と移行](/ja/deploy-and-operate/recovery-and-portability)を確認してください。
このページは、管理されたルートの復元、テナント管理の復元、計画中のウォレット・デプロイ環境の移行を区別し、各運用経路の利用状況を示します。

リポジトリーの運用担当者は、対象のレーン、環境、リリース手順について、非公開のデプロイ手順書にも従ってください。
公開アプリの開発者に、鍵管理用の認証情報や内部サービスの構成情報を渡す必要はありません。

---
title: 図のソース
description: Seamsのアーキテクチャ、鍵管理、委任、ランタイム、Router A/Bの図に使うMermaidソースを再利用します。
---

# 図のソース {#diagram-sources}

ドキュメントは、Mermaidコードブロックから構成図を描画します。
`/diagrams/`内のソースコピーを、課題、計画、外部資料に再利用できます。

| 図                                   | 目的                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `/diagrams/platform-layers.mmd`      | 証明からポリシー、実行、監査までの製品レイヤー。                         |
| `/diagrams/runtime-architecture.mmd` | アプリオリジン、ウォレットiframe、Router、Deriver、SigningWorkerの構成。 |
| `/diagrams/router-ab-flows.mmd`      | 分割した導出経路と通常署名の経路。                                       |
| `/diagrams/custody-boundaries.mmd`   | クライアント、Router、Deriver、SigningWorker間の素材の境界。             |
| `/diagrams/delegated-lanes.mmd`      | リンク済みデバイスと委任エージェントのレーン構成。                       |

SVGへの出力は、静的画像が必要な用途が生じた時点で対応します。

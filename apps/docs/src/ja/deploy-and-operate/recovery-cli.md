---
title: 復元CLI
description: Seams Wallet CLIをインストール・検証し、テナント保有のバックアップキットを確認して、承認済みの空の移行先へテナントルートを復元します。
---

# 復元CLI {#recovery-cli}

`seams-wallet`は、テナントルートのバックアップと復元を行う、持ち運び可能なコマンドラインツールです。
署名済みアセットをローカルで検証し、ホスト環境の操作に必要な、範囲を限定したブラウザー承認だけを開きます。
CLIは、コマンドライン引数や環境変数から、復元・移行先の認証情報を受け取りません。

ランチャーは**0.28.0**です。署名済みネイティブアセットは、タグ[`seams-cli-v0.28.0`](https://github.com/seams-tech/seams-wallet/releases/tag/seams-cli-v0.28.0)で公開します。

バージョン0.21.0は、公開前に交換した新しい復元ルートを固定します。古い復元キットと保存済みの
信頼状態では、新しい権限を確立できません。新しい復元パッケージを取得し、空の信頼ファイルから
接続してください。古いルートとの継続ブリッジはありません。

## インストールとオフラインコピーの保管 {#install-and-retain-an-offline-copy}

Node.js 22以降でランチャーをインストールし、実行できることを確認してください。

```bash
npm install --global @seams/wallet-cli@0.28.0
seams-wallet --help
```

npmランチャーは、対応するネイティブバイナリーをダウンロードし、実行前に署名済みリリースマニフェストを検証します。
macOSのApple Silicon・Intelと、Linux x86_64向けのバイナリーを提供します。

オフライン復元が必要な場合は、検証済みネイティブバイナリーを復元素材と一緒に保管してください。
利用前に、ダウンロードしたアセットを検証します。

```bash
seams-wallet release verify \
  --manifest ./seams-release-manifest.json \
  --artifact ./seams-wallet-aarch64-apple-darwin
```

ランチャーは、リリースで信頼する署名権限を固定します。復元権限は、デプロイ環境が別途提供します。
その環境に未接続のデバイスでは、展開した復元フォルダーから、ダッシュボードの信頼コマンドを実行してください。

```bash
seams-wallet derivation-root trust connect \
  --console-url https://wallet.seams.sh
```

このコマンドは、検証済みHTTPSで権限情報を取得し、マニフェストを検証して、オフライン用に保存します。
バックアップ内の信頼ファイルは、自分自身を承認できません。
更新情報は、信頼済みルートから連続する必要があります。次のコマンドで信頼状態を確認・更新できます。

```bash
seams-wallet derivation-root trust show
seams-wallet derivation-root trust update \
  --bundle ./recovery-trust-bundle.json \
  --output ./trusted-recovery-roots.json
```

## バックアップキットを検証する {#verify-a-backup-kit}

完全な復元セットには、署名済みマニフェスト、Deriver AとBの暗号化バックアップパッケージ、対応する保持者の鍵ファイルを含みます。
2人の保持者で管理する場合は、各保持者に自分のロールのパッケージと鍵だけを渡します。

展開した保持者キットから、1つのロールを検証します。

```bash
seams-wallet derivation-root backup check --role deriver-a
```

もう一方の保持者は、`--role deriver-b`を使います。
両ロールを含む単一所有者のキットでは、`--role`を省略できます。
検証は保持者の鍵で暗号化パッケージを開き、マニフェストと復元権限を確認します。鍵や開封したシェアはアップロードしません。

保持者パッケージを開かず、署名だけを検証するには、次を実行します。

```bash
seams-wallet derivation-root backup verify --role deriver-a
```

オフライン検証は、`cryptographically_valid_offline`を報告します。
有効な署名済み信頼スナップショットを渡すと、`valid_at_trust_snapshot`を報告できます。
現在のオンライン失効確認は、`current_trust_confirmed`を報告できます。
署名、証明書、ロール承認、`invalidBefore`の失敗を無視する方法はありません。

## 復元鍵を登録する {#enroll-recovery-keys}

ダッシュボードに表示されるロール別の設定コマンドを使ってください。
ローカルの暗号化鍵ファイルを作成または再利用し、その公開鍵に対するブラウザー承認を開きます。
秘密鍵をアップロードせず、ローカルの鍵の管理権を証明します。

```bash
seams-wallet derivation-root recovery-key setup \
  --console-url https://wallet.seams.sh \
  --environment YOUR_ENVIRONMENT \
  --role deriver-a
```

もう一方の保持者は、`--role deriver-b`で実行します。
承認前に、ブラウザーで範囲と照合コードを確認してください。
公開鍵ペアを確定してバックアップに使う前に、両方の登録を完了する必要があります。

既定の設定先は、`deriver-a-wrapper.key`または`deriver-b-wrapper.key`です。
別のパスを選ぶには、`--wrapping-key-file`を使います。CLIは、ConsoleからダッシュボードURLを取得します。

完全な復元ZIPを保存するには、ダッシュボードに表示される正確な復元セットIDを使います。
登録済みラッパー鍵を含むフォルダーから実行してください。

```bash
seams-wallet derivation-root backup kit \
  --console-url https://wallet.seams.sh \
  --environment YOUR_ENVIRONMENT \
  --recovery-set YOUR_RECOVERY_SET \
  --output ./seams-recovery.zip
```

CLIは、ZIPを書き込む前にパッケージと鍵を検証します。
任意のパスワードを指定すると、各項目をAES-256で暗号化します。
復元コマンドを使う前に、対応するツールでZIPを展開してください。鍵とパスワードはターミナル内に留まります。

バックアップのディスク保存と検証成功をサービスに記録させる場合は、CLIのダウンロード経路を使ってください。

```bash
seams-wallet derivation-root backup download \
  --console-url https://wallet.seams.sh \
  --environment YOUR_ENVIRONMENT \
  --role deriver-a \
  --output ./deriver-a.backup \
  --manifest ./manifest.json
```

コマンドは新規ファイルを書き込み、同期し、再度開いて検証した後、永続的な受領記録を残します。
失敗した出力は削除し、既存ファイルは上書きしません。

## 空の移行先へ復元する {#restore-into-an-empty-destination}

復元には、両ロールのパッケージ、両保持者の鍵、マニフェスト、空の移行先、ダッシュボードで承認した範囲付き復元アクセスが必要です。
元のデプロイ環境は必要ありません。

各保持者は、展開した自分のフォルダーから、同梱の復元フローを実行できます。

```bash
seams-wallet derivation-root restore \
  --destination https://destination.example \
  --role deriver-a \
  --wrapping-key-file ./deriver-a-wrapper.key \
  --console-url https://wallet.seams.sh \
  --environment YOUR_ENVIRONMENT
```

もう一方の保持者は、`--role deriver-b`と自分の鍵を使います。
CLIはアセットを検証してマニフェストを登録し、1つのロールパッケージをローカルで開きます。
そのシェアを移行先の1回限りのインポート鍵へ再封印し、封印したエンベロープだけをアップロードします。
開封したシェアをディスクに書き込むことはありません。

復元が完了するまで、生成した`.restore-*`セッションと暗号化エンベロープのファイルを保持してください。
同じコマンドを再実行すると、保持者の鍵を再開封せずに、応答を失った処理を再開します。
コマンドは、ルートを自動的に有効化しません。

両保持者が完了したら、移行先を確認して有効化します。

```bash
seams-wallet derivation-root restore status \
  --destination https://destination.example \
  --console-url https://wallet.seams.sh \
  --environment YOUR_ENVIRONMENT

seams-wallet derivation-root restore activate \
  --destination https://destination.example \
  --session-file ./destination-activation.session.json \
  --console-url https://wallet.seams.sh \
  --environment YOUR_ENVIRONMENT
```

有効化は、安定したルートのコミットメントを検証し、運用シェアを移行先の鍵管理系統へ更新します。
続いて、取り込んだシェアと1回限りの鍵を破棄し、初期化用アクセスを消費します。
有効化が中断した場合は、同じ非公開セッションファイルを再利用してください。完了後に削除します。

## 復元の境界 {#recovery-boundaries}

復元に成功しても、元のデプロイ環境は変更・廃止されません。
また、移行先が唯一であることも保証しません。同じ復元セットを使い、別の承認済みの空の移行先へ復元できます。
各移行先は、独自の鍵管理系統を受け取ります。

移行先で管理型の再ダウンロードを提供する場合は、移行先で新しい復元バックアップを作成してください。
移行元の廃止は別の運用者操作です。
対象となる元の系統について、必要な破棄、復号試験、認証情報の失効、拒否の証跡を生成する必要があります。

事故前に、実際の保持者と検証用の空の移行先で、手順全体を練習してください。
練習の復元は、稼働中のデプロイ環境を変更しません。

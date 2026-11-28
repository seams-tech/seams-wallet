---
title: ホスト環境への導入
description: 専用HTTPSウォレットオリジンからSeamsのウォレットサービスとSDKアセットを配信し、許可したアプリオリジンを接続します。
---

# ホスト環境への導入 {#hosted-integration}

製品のアプリは、`@seams/mpc-wallet/client`と`@seams/mpc-wallet/react`をインポートします。
専用のウォレットオリジンは、分離したiframeが使うウォレットサービス、SDK補助アセット、Worker、エクスポートビューアーを配信します。

## 必要なルート {#required-routes}

ウォレットサービスを設定済みの`walletServicePath`へ、ランタイムアセットを`sdkBasePath`へデプロイします。
アセットのContent-Typeを維持してください。名前にコンテンツハッシュを含む不変ファイルはキャッシュします。
古いHTMLが古いランタイムマニフェストを選ばないようにしてください。

アプリには、絶対HTTPS URLのウォレットオリジンを設定します。
アプリのオリジン経由でウォレットのルートをプロキシしたり、ランタイムアセットの複製を配信したりしないでください。

## ホストするメニューで登録を準備する {#prepare-registration-through-the-hosted-menu}

パスキーボタンを選ぶ前に準備を開始するには、登録に`HostedSeamsAuthMenu`を使います。
登録画面が開いている間に、対象ウォレット、署名機能の選択、パスキーのチャレンジを準備します。
パスキーボタンは、その準備を利用します。メニューを閉じると、ローカルの準備をキャンセルします。
期限切れの準備から、認証情報の要求を開始することはできません。

<<< ../../examples/hosted-auth-menu.tsx

`SeamsWebProvider`内に`HostedRegistration`を表示してください。アプリ用の結果ハンドラーを指定します。
`SignInIntentButton`は、操作の予兆でコードをダウンロードし、クリック時に`onOpen`を呼びます。
そのハンドラーで、ホストする認証メニューをマウントします。

`authMenu.prepare()`は、サインイン用コードをダウンロードします。
ウォレットの予約や登録チャレンジの準備は、登録画面が開始します。
`registration.registerWallet()`を直接呼ぶ場合は、その呼び出し内でパスキーの入力前に準備を開始します。
独立した公開の準備ハンドルはありません。

ホストするGatewayは、任意のペア準備を`waitUntil`で実行します。
準備の応答前に、ウォレットのオブジェクトアドレスを永続化します。
ペア準備はパスキーの入力と並行できますが、Yaoの実行には検証済みのパスキー証明が必要です。
任意の準備が失敗したり期限切れになったりしても、通常の実行経路で復旧できます。

事前準備がパスキー選択後の待ち時間を減らすのは、メニューが十分長く開いていた場合だけです。
サーバーの総処理量は減りません。

## リリースの確認 {#release-verification}

- ウォレットサービスを直接開き、期待するリリース識別情報を確認する。
- 許可したアプリオリジンから登録とアンロックを行う。
- 一覧にないオリジンが拒否されることを確認する。
- 署名の確認、キャンセル、再試行可能な失敗を各1回実行する。
- 本番のCSPでWorkerとWASMが読み込めることを確認する。
- エクスポート内容が、ウォレットオリジンのビューアー内に留まることを確認する。

公開アセットの`@seams/host/wallet-origin-html`は、対応するホスト型ウォレットのビルド経路だけで使ってください。
パッケージのコードとホストするアセットを、互換性のある同じリリースに揃えてください。

## リリース 0.77.0 {#release-0-77-0}

`@seams/mpc-wallet`、`@seams/wallet-connect`、`@seams/host`を**0.77.0**に固定してください。`@seams/cli`は**0.29.0**に固定してください。署名済みネイティブアセットは[復元CLIのガイド](/ja/deploy-and-operate/recovery-cli)を参照してください。

0.77.0はパッケージの名前を変えます。

- アプリは`@seams/wallet`の代わりに`@seams/mpc-wallet`をインストールし、`@seams/wallet-connect`も一緒にインストールします。
- 運用者は`@seams/wallet-server`の代わりに`@seams/host`をインストールします。パスの名前は変わりません。ルートのパスは`@seams/host/server-types`になります。
- `@seams/voiceid`は公開しません。アプリは`voiceIdAuthMethod`を`@seams/mpc-wallet/voiceid`からインポートします。`@seams/host`にVoiceIDのホストプラグインとモデルが含まれ、`npx --no-install seams-voiceid-host ./wallet-with-voiceid`はこれまでと同じように静的デプロイ用のディレクトリーを作成します。VoiceIDのホストAPIはバージョン11です。Walletは別のバージョンのホストプラグインを拒否します。
- 復元CLIのランチャーは`@seams/cli` **0.29.0**です。`seams-wallet`コマンドと署名済みネイティブアセットは同じです。
- ウォレットオリジンのドキュメントは`@seams/host/wallet-origin-html`です。

`@seams/host`の署名用D1マイグレーションは、1つのベースライン`0001_signer_d1_baseline.sql`になります。アップグレードの前に、0.76.0のリリースの署名用マイグレーションを`0091_linked_device_email_otp_own_factor.sql`まですべて適用してください。その後、`wrangler d1 migrations apply`はベースラインを1回だけ実行しますが、何も変更しません。データベースのスキーマとデータはそのまま残ります。マイグレーション0091のないデータベースでは、ベースラインは失敗します。新しいデータベースは、ベースラインからすべてのスキーマを受け取ります。

次に0.77.0のサーバーとWalletホストを一緒にデプロイし、最後にアプリをデプロイしてください。パスキーのオプションとEmail OTPの解放の本文が両側で変わったため、0.77.0のWalletホストには0.77.0のサーバーが必要です。逆も同じです。デプロイの時点で開いているEmail OTPの許可は失敗するため、ユーザーは新しいコードを求めます。古いインポートから新しいインポートへの表は[リリースノート](/ja/releases)にあります。

Speak-to-Sign(実験的機能、NEARテストネット専用)は`@seams/mpc-wallet`の一部です。[実験的機能: Speak-to-Sign](/ja/concepts/auth-methods/speak-to-sign#prepare-the-wallet-host)を参照してください。アプリとホストの手順は、[VoiceIDの設定](/ja/concepts/auth-methods/voiceid#prepare-the-wallet-host)を参照してください。

Gatewayは`/router-ab/ed25519/yao/reissue/admit`と`/router-ab/ed25519/yao/reissue/execute`を提供します。自分で組み立てるGatewayは、これらを`@seams/host/cloud-host`の`handleRouterAbEd25519YaoReissueRequestV1`に渡してください。Routerのプロジェクトポリシーは`reissue`の作業種別を許可する必要があります。

APACのウォレットオブジェクトは、`apac-se`で東南アジアへの配置を要求します。
ホスト環境を受け入れる前に、実際のオブジェクトとデータベースの配置を確認してください。
Consoleの移動処理も、同じ配置ヒントを使う必要があります。

期限切れの初期テナント承認を更新できるのは、作成ジャーナルの開始前だけです。
Consoleが代替承認を発行する前に、Routerは永続的なフェンスを記録します。
フェンスは、期限切れ承認による遅延リクエストを遮断します。
開始済みの手順は、復旧用に元の承認をそのまま保持します。
対応するウォレットホスト、Gateway、Wallet Runtime、Router、コントロールプレーン、両Deriver、Signing Workerをデプロイしてください。
非公開のアドレス割り当て応答はバッチを含むため、鍵管理Workerは一緒に更新する必要があります。
アプリとウォレットホストは、どちらも公開iframeプロトコル**25.0.0**を使います。

登録は確定済みの受付を再利用し、完了記録とともに鍵管理を確定します。
Bの準備応答を待たず、検証済みのAの完了後に終了できます。
ホスト環境での有効化は、応答後に不要となった手順のクリーンアップも実行します。
これらの変更は、証明、鍵管理、リプレイの確認を維持します。

### Speak-to-Signの検証者 {#speak-to-sign-verifier}

WalletのSpeak-to-Signの検証者は、Cloudflare WorkerのSaySoです。OutLayerは無効です。検証者のあるレーンは、Gateway Workerに次を設定します。

| 設定                    | 種類                   | 値                                |
| ----------------------- | ---------------------- | --------------------------------- |
| `SPEAK_TO_SIGN_BACKEND` | 変数                   | `sayso`                           |
| `SAYSO`                 | サービスバインディング | レーンのSaySo Worker              |
| `SAYSO_API_KEY`         | シークレット           | そのSaySo Workerの`SAYSO_API_KEY` |

- レーンごとに、専用の判定の鍵とAPIキーを持つ専用のSaySo Workerを使ってください。現在、検証者があるのは`staging-testnet`だけです。Walletは、テストネットについてそのSaySo Workerの判定の鍵を固定しています。
- GatewayとWalletホストより先に、`POST /v1/template/delete`を提供するSaySo Workerをデプロイしてください。WalletはVoiceIDが無効になるときに所有者の声のテンプレートを削除し、削除が失敗するとVoiceIDは有効のままです。
- 検証者のないレーンは、これらの項目も`SPEAK_TO_SIGN_OUTLAYER_*`変数も設定しません。そのGatewayには検証のルートがありません。
- 0.76.0の`SPEAK_TO_SIGN_OUTLAYER_*`変数があり`SPEAK_TO_SIGN_BACKEND`がないGatewayは、起動時に停止します。変数を削除してください。`SPEAK_TO_SIGN_BACKEND=outlayer`のGatewayは、このWalletのすべての検証のリクエストに409 `backend_mismatch`で応答します。
- 各所有者は声をもう一度登録します。SaySoには、OutLayerの検証者のテンプレートがありません。

ルートと共同署名者の確認は、[Seamsサーバーの設定](/ja/concepts/auth-methods/speak-to-sign#configure-the-seams-server)を参照してください。

## 登録の完了 {#registration-completion}

新しいGatewayが処理を開始する前に、Gatewayの署名用D1マイグレーションを適用してください。
マイグレーションは、ディレクトリーが未確認の登録完了を保持するテーブルを作ります。

登録の応答は、完了情報のディレクトリー書き込みを待ちません。
Gatewayは1つのローカルトランザクションで、ウォレットの有効化と完了の保留記録を行い、応答後に完了情報を送ります。
署名は直ちに利用できます。書き込みが失敗すると、定期ハンドラーが同じセッションダイジェストと有効期限を、確認されるまで再送します。
独自の登録権限サービスでGatewayを構成する場合は、定期ハンドラーで`@seams/host/cloud-host`の`resumeRegistrationDirectoryPublicationsV1`を呼んでください。
例えば、1分ごとに実行します。同梱のローカルGateway Workerは、この処理を実行します。

ディレクトリーの確認まで、通常は1秒以内ですが、ウォレットはConsoleの一覧に現れず、別リージョンへ移動できません。
登録直後に一覧を読むバックエンドでは、その間、新しいウォレットを取得できない場合があります。

## リージョン別のルーティング {#regional-routing}

リージョン別のデプロイでは、登録時に各ウォレットへホームリージョンを割り当てます。
共有ディレクトリーは、リンク済みデバイスや移動中のユーザーを含め、その後のライフサイクル・署名リクエストをホームへ送ります。
ホームが変わるのは、所有者が別のリージョンへ移動した場合だけです。
同じプロジェクトのウォレットでも、異なるホームを持てます。
[ウォレットごとのホームリージョン](/ja/concepts/architecture#per-wallet-regional-homes)を参照してください。

アプリは、プロジェクトに設定したGateway URLを使います。
D1データベースの選択や、署名ごとのリージョン指定は行いません。
運用者はホームを受け入れる前に、リージョン別Workerのバインディング、D1のプライマリー提供リージョン、DO・Containerの配置を確認します。
ディレクトリーが失敗した場合は、操作を利用不能として報告する必要があります。別リージョンでの書き込みを許可できません。

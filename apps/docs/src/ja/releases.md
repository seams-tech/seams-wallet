---
title: リリース 0.65.0
description: Walletのカードをアプリ自身のダイアログの1ステップとして表示でき、アプリのステップをWalletのモーダルの中に表示できます。
---

# リリース 0.65.0

ブラウザーSDK、サーバーSDK、VoiceIDプラグイン、Speak-to-Signプラグインは **0.65.0** を使います。

- Walletのカードを、上に重なる2つ目のダイアログではなく、アプリ自身のダイアログの1ステップとして表示できます。アプリのコンテンツがWalletのiframeの中に描画されることはなく、所有者は引き続きWallet自身のカードで承認します。
  - `HostedSeamsAuthMenu`と`seams.authMenu.open(request, anchor, step)`は、イベント`onEnter`(まだ非表示のカードのサイズ)、`onReady`、`onResize`、`onExit`、`onBack`、`onClose`を受け取ります。`chrome: 'back' | 'close'`は、カードのオリジン行にBackまたはCloseを描画します。`layer: 'top'`は、カードをすべてのアプリのコンテンツの上に描画します。
  - NEAR、EVM、Tempoの署名メソッドと`seams.speakToSign`のリクエストに`presentation: { kind: 'anchored', anchor, chrome, ... }`を渡してください。取引の確認画面またはVoiceIDのカードが、アプリのダイアログに表示されます。アンカーされた取引は承認にクリックが必要で、受領画面を表示しません。そのため、結果はアプリが自分で表示します。`presentation`がない場合、カードは以前と同じくWalletのモーダルに表示されます。
  - `@seams/wallet/react`の`WalletStep`と、Reactを使わない場合の`seams.surfaces.mount(anchor, options)`は、サインインメニュー、取引の確認画面、またはSpeak-to-Signのリクエストを1つのステップとして表示します。
  - トップレイヤーのカードは、全体が表示され、何にも覆われていない間だけクリックを受け付けます。後から開いたポップオーバーやダイアログに覆われた場合も同じです。Chromiumでは、ページが変更できないブラウザーの報告によって、カード自身もこれを確認します。
  - アプリのダイアログ内の取引またはVoiceIDのカードは、180 msかけて新しいサイズに変わります。動きを減らす設定では、すぐに新しいサイズになります。
  - `chrome: 'back'`の場合、VoiceIDのカードはCancelの代わりにBackを表示します。
- アプリのステップを、Walletのカードの前と後に、Walletのモーダルの中で表示できます。ステップはReactのコンテンツを描画するため、`@seams/wallet/react`の`TransactionReviewHost`が必要です。
  - レビュー付きの取引は`steps: { title, validity, before, after }`を受け取ります。`review`は引き続き別名として使え、`review.render`は`steps.before`です。
  - `seams.authMenu.open(request, undefined, { steps })`と`seams.speakToSign`のリクエストは`steps: { title, before, after }`を受け取ります。カードのBackは、状態を保ったまま`before`に戻ります。完了した呼び出しは、`after`が表示される前に結果を返します。Walletのカードが終わる前に離れた場合、呼び出しはキャンセルの結果を返します。
- ログインモードのサインインメニューは、メールコードでロック解除できる場合だけ「Unlock with email code」を表示します。保存されたウォレットがない端末か、選んだウォレットがこの端末でメールコードの方法を持つ場合です。以前は、メールコードのないパスキーやVoiceIDのウォレットにも表示されていました。作成モードは変わりません。
- SDKとホストされたWalletは一緒にリリースしてください。auth menuのリクエストには新しいフィールド`chrome`、リクエストには新しいフィールド`presentation`があり、ページは新しいメッセージ`PM_SURFACE_VIEW`を送ります。古いWalletホストは、`chrome`を含むauth menuのリクエストを拒否します。
- VoiceIDのホストAPIはバージョン **11**、Speak-to-SignのホストAPIはバージョン **9** のままです。`@seams/voiceid` 0.65.0は、カードのBackを0.65.0のWalletホストから読むため、`@seams/wallet` 0.65.0と一緒にインストールしてください。Speak-to-Signのベリファイアーは **0.5.2** のままです。OutLayerのバージョンキーは`96b79b518613a50538b060da2279c91e12b0619499c532c2708f61ddb790d7e5`です。
- Walletホストを両方のプラグインと一緒にデプロイし、アプリを0.65.0に更新してください。このリリースでは、サーバーの変更は不要です。
- 4つのパッケージをすべて0.65.0でインストールしてください。Speak-to-Signは引き続き実験的機能で、NEARテストネット専用です。実際の資金では使わないでください。

ウォレットのiframeプロトコルは **23.0.0**、ウォレット管理プロトコルは **5** のままです。
署名付きの復旧CLIは **0.29.0** のままです。このリリースはデータベースのマイグレーションを追加しません。

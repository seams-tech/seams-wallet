---
title: リリース 0.68.0
description: Speak-to-Signは@seams/walletの一部になり、NEARの通常の署名の呼び出しで音声による承認を使えます。
---

# リリース 0.68.0

ブラウザーSDK、サーバーSDK、VoiceIDプラグインは **0.68.0** を使います。このリリースには、Speak-to-Signを使うアプリとWalletホストに影響する破壊的変更があります。古い名前の別名はありません。

- Speak-to-Signは`@seams/wallet`の一部になりました。流れは最初の音声リクエストのときに読み込まれ、使わないWalletは読み込みません。
  - アプリとWalletホストから、パッケージ`@seams/wallet-voice-sign`を削除してください。最後のバージョンは0.67.0です。
  - WalletホストにSpeak-to-Sign専用の手順はありません。`seams-speak-to-sign-host`を削除してください。所有者はVoiceIDの画面で録音するため、ホストはこれまでどおりVoiceIDを構成します(`seams-voiceid-host`)。
  - ホストのファイル`/sdk/speak-to-sign/host.js`、エントリー`@seams/wallet/speak-to-sign-host`、Speak-to-SignのホストAPIのバージョンはなくなりました。VoiceIDのホストAPIはバージョン **11** のままです。
- 設定では、音声による承認を`approvals`に指定します: `approvals: [spoken({ network: 'testnet' })]`。`spoken`は`@seams/wallet`からインポートします。`transactionFeatures`と`speakToSign()`は削除しました。
- NEARの通常の署名の呼び出しは`approval: { kind: 'spoken', summary }`を受け取ります: `near.signAndSendTransaction`、`near.signTransaction`、`near.signDelegateAction`、`near.signMessage`。
  - `summary`は所有者が読み上げる文です。`approval`には`onProgress`も指定できます。
  - `approval`を指定した呼び出しは、`kind`のある結果を返します: `approved`、`refused`、`cancelled`、`unavailable`。拒否のときに例外を投げません。`approved`の結果には、`approval`なしの呼び出しが返す値が入ります。
  - `approval`を指定しない呼び出しは、これまでどおりです。
  - `approvals`に記述子がない場合、`approval`を指定した呼び出しは例外を投げます。
- `seams.near.spoken`には、リクエストの項目から文を作る呼び出しがあります: `transfer`、`note`、`rating`、`mergeApproval`、`bet`。`enroll`と`network`もあります。`seams.near.speakToSign`とその`typed`を置き換えます。
  - ウォレットは、通常の呼び出しと同じく`walletSession`で指定します。省略した場合は、認証済みのウォレットが対象です。これらのリクエストの`walletId`は削除しました。
- Walletの内部の変更です。結果は変わりません。
  - Walletのコアは、すべての音声リクエストを1つの経路で署名します。コアとSeamsの共同署名者は、型付きの種類の同じ表を読むため、両者が食い違うことはありません。共同署名者は、自分が署名するバイト列だけから型付きのリクエストを作ります。
  - 各種類の制限はコアにあります。文で言えない送金(暗黙的アカウントの受取先、または0.01〜1,000,000 NEARの100分の1単位でない金額)は、カードを開く前に拒否します。
  - カード上の流れは録音を保持しません。コアが録音し、封印して送り、使用後に消去します。
  - 共同署名者は、`msg`にリクエストの判定とは別の判定が入ったベットを拒否します。
- Seamsのサーバーは、`@seams/voice-sign/server` **0.68.0** の`relayToVerifier`でベリファイアーを呼び出します。これは`@seams/wallet-server`の新しい依存関係です。OutLayerへのリクエスト、`POST /speak-to-sign/v1/verify`のイベントと失敗コードは変わりません。例外は次の2つです。
  - このルートは、ベリファイアーの`verify`と`enroll`の操作だけを扱います。ほかの操作には400 `unsupported_operation`を返します。これまでは、どの操作も実行していました。
  - ベリファイアーのエラー出力は、`verifier_failed`の`failed`イベントになります。これまでは`verdict`イベントとして送り、Walletが無効な出力として扱っていました。
- `@seams/voice-verdict`と`@seams/voice-capture`は **0.68.0** です。音声カードのメインボタンは、テーマのボタンの色(`appearance.theme.colors`の`buttonBackground`と`textButton`)を使います。既定のテーマでは、ライトテーマの「録音」ボタンが濃い灰色からほぼ黒に変わります。
- OutLayerが時間内にベリファイアーを実行しない場合(`verifier_timeout`)、支払いのカードと登録のカードは「OutLayer timed out」と表示し、録音が原因ではないこと、1分後にもう一度試すことを伝えます。これまでは一般的な文を表示していました。Seamsの検証ルートがOutLayerを待つ時間は、20秒から30秒になりました。
- 音声リクエストのカードは、「録音」を押さなくてもすぐに録音を始めます(`@seams/voice-capture`の`autoStart`)。ブラウザーが操作なしで音声を開始しない場合は、カードに「録音」ボタンが残ります。登録では、これまでどおり各文で「録音」を押します。
- Walletのステップ:
  - アプリのダイアログ内のカードは`transition`を受け取ります: フェードインの前の待ち時間(`enterDelayMs`)、フェードイン、フェードアウトで、それぞれ0〜1000ミリ秒です。`WalletStep`、`HostedSeamsAuthMenu`、`surfaces.mount`、`authMenu.open`のステップ、アンカー付きの表示が受け取ります。
  - `chrome: 'back_and_close'`は、カードに「戻る」と「閉じる」の両方を表示します。「戻る」は`onBack`を、「閉じる」は`onClose`を呼びます。VoiceIDのカードも両方を表示します。
- ウォレットのiframeプロトコルは **24.0.0** です。アプリがWalletに送る設定に`approvals`が入ります。0.67.0のアプリは0.68.0のWalletホストでは動作せず、その逆も動作しません。
- 次の順番でデプロイしてください。最初にサーバー、次にSDKとホストされたWalletを一緒にリリースします。ベリファイアーは0.12.0のままです。
- 3つのパッケージをすべて0.68.0でインストールしてください。Speak-to-Signは引き続き実験的機能で、NEARテストネット専用です。実際の資金では使わないでください。

ウォレット管理プロトコルは **5** のままです。署名付きの復旧CLIは **0.29.0** のままです。このリリースはデータベースのマイグレーションを追加しません。

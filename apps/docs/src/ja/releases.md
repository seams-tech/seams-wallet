---
title: リリース 0.67.0
description: WalletのコアはSpeak-to-Signの録音をベリファイアー宛てに封印し、VoiceIDは@seams/voice-captureで録音します。
---

# リリース 0.67.0

ブラウザーSDK、サーバーSDK、VoiceIDプラグイン、Speak-to-Signプラグインは **0.67.0** を使います。

- Walletのコアは、Speak-to-Signの録音がデバイスを出る前に、すべての録音を封印します。SeamsのサーバーとOutLayerは暗号文だけを運び、ベリファイアーはTEEの中で録音を開きます。
  - Walletは、ベリファイアーの音声用の鍵(X25519)を、判定の鍵と並べて自分のコードに固定します。アプリから鍵を受け取ることはありません。
  - 封印はHPKEのbaseモードで、X25519、HKDF-SHA256、ChaCha20-Poly1305を使います。操作と所有者を拘束します。コードは`@seams/voice-verdict`の`sealAudio`です。
  - コアは、音声リクエストの録音と登録の録音を封印します。コアが封印できない録音は、デバイスを出ません。その場合、呼び出しは`unavailable`で終わり、理由は`verifier_unavailable`、詳細は`recording_not_sealed`です。
  - プラグインは鍵を受け取りません。リクエストと結果のフィールドは変わりません。
- Speak-to-Signのベリファイアーは **0.12.0** です。OutLayerのバージョンキーは`bfe81633b9ed596df239201f153a84c860d71ddd8edf713c1c785ef2b7c1c946`です。Seamsのサーバーは`SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`にベリファイアー0.12.0以降を指定し、シークレットのプロファイルにシークレット`PROTECTED_AUDIO_KEY`を持つ必要があります。古いベリファイアーは、すべての音声リクエストを`unsupported`で拒否します。ベリファイアー0.12.0は封印していない録音も受け取るため、0.66.0のWalletでも動きます。
- Walletのコアと共同署名者は、`@seams/voice-verdict`の`checkVerdict`で判定を確認します。以前は、それぞれがルールのコピーを持っていました。`@seams/voice-verdict` **0.67.1** は、`@seams/wallet`と`@seams/wallet-server`の新しい依存関係です。
  - ルールは変わりません。固定した鍵、署名、リクエスト、話した文、レンダラー、有効期限です。鍵と署名の確認が最初になりました。
  - 余分なフィールドのある判定、ルールのない`step_up`の判定、空の判定は、詳細`verdict fields are invalid`で拒否されます。
- VoiceIDは`@seams/voice-capture` **0.67.1** で録音します。これは`@seams/voiceid`の新しい依存関係です。マイク、音声の検出、品質の確認、アセットの読み込み、モデルのエンジン、プロンプト、フレーズのカードは、このパッケージのものです。`onnxruntime-web`は`@seams/voiceid`の直接の依存関係ではなくなりました。
  - 文言とカードは変わりません。VoiceIDのビルドは、同じモデルのファイルを`/sdk/voiceid/`にコピーします。
  - 修正:マイクの確認の後も「録音」ボタンが表示されたままになります。以前は、「Listening」のフェードの途中で確認が終わると、ボタンが隠れることがありました。
- 取引確認カードには、新しい色トークン`transactionCardBorder`(`--seams-colors-transactionCardBorder`)で1pxの枠線があります。既定値は透明です。`appearance.theme.colors.transactionCardBorder`で設定してください。
- 「Secured by seams」フッターのseamsのロゴは https://wallet.seams.sh へのリンクで、新しいタブで開きます。
- 修正:
  - Wallet設定の受け取り画面は、どのアプリでもQRコードを表示します。`qrcode`は省略可能なピア依存関係ではなく、`@seams/wallet`の依存関係になったため、アプリでインストールする必要はありません。以前は、`qrcode`のないアプリで空の枠が表示されていました。Walletがコードを作れない場合は、画面にそのことを表示します。
  - 取引カードは、開くとき、詳細を表示するとき、詳細を閉じるときも、角の丸みが同じままです。以前は、`shape.card`が`2rem`のアプリで、止まっているカードの角は32px、動いているカードの角は26pxでした。
  - 認証方法の「追加」と「削除」のボタンに、ラベルが収まる余白ができました。以前は、ラベルがボタンからはみ出していました。
  - 「Secured by seams」フッターのロゴは、テキストと同じ行の中央に揃います。以前は、ロゴがテキストより高い位置にありました。
- Speak-to-SignのホストAPIはバージョン **10**、VoiceIDのホストAPIはバージョン **11** のままです。`@seams/voiceid` 0.67.0と`@seams/speak-to-sign` 0.67.0を、`@seams/wallet` 0.67.0と一緒にインストールしてください。
- 次の順番でデプロイしてください。最初に、サーバーのベリファイアーを0.12.0に設定します。次に、SDK、ホストされたWallet、サーバーを一緒にリリースします。0.67.0のWalletは、古いベリファイアーでは音声で署名できません。
- 4つのパッケージをすべて0.67.0でインストールしてください。Speak-to-Signは引き続き実験的機能で、NEARテストネット専用です。実際の資金では使わないでください。
- WebKitでVoiceIDをテストする場合は、Playwright 1.64.1以降(WebKit 27.2)を使ってください。Playwright 1.56.1のWebKit 26.0は、ONNX Runtimeをランダムに壊し、VoiceIDのモデルの読み込みに失敗します。Wallet自身のテストは1.64.1を使います。

ウォレットのiframeプロトコルは **23.0.0**、ウォレット管理プロトコルは **5** のままです。
署名付きの復旧CLIは **0.29.0** のままです。このリリースはデータベースのマイグレーションを追加しません。

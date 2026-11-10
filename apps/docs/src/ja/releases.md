---
title: リリース 0.66.0
description: Speak-to-SignはNEARの音声による署名者になり、seams.nearの各署名呼び出しに音声の呼び出しがあります。
---

# リリース 0.66.0

ブラウザーSDK、サーバーSDK、VoiceIDプラグイン、Speak-to-Signプラグインは **0.66.0** を使います。

- Speak-to-SignはNEARの音声による署名者になりました。`seams.near`の各署名呼び出しには、`seams.near.speakToSign`に同じ名前の音声の呼び出しがあります。
  - `signAndSendTransaction`、`signTransaction`、`signDelegateAction`は、受信者とアクションを問わず、任意のNEARの取引または委任アクションに署名します。所有者は1語から12語の平易な要約を話します。判定は受信者と、Walletが署名するアクションのバイト列のSHA-256を拘束します。共同署名者は、自分が署名するバイト列からリクエストを組み立て直します。
  - `signMessage`はNEP-413のメッセージに署名します。判定はNEP-413のバイト列のSHA-256を拘束します。Walletは所有者が話す前にnonceを決めます。
  - 文がリクエストのフィールドから作られる呼び出しは`typed`にあります。`transfer`、`note`、`rating`、`mergeApproval`と、新しい`bet`です。`typed.bet`は予測市場へのトークンの`ft_transfer_call`に署名し、確認済みの判定を`msg`に入れます。そのため、市場のコントラクトも判定を確認できます。賭けに使えるトークンは、そのネットワークで固定されたUSDCのコントラクトだけです(テストネットではCircle USDC)。
  - 一般的なリクエストの要約はアプリが書き、カードは要約だけを表示します。音声は、誰が承認したかと所有者が何を話したかを証明します。要約が取引を正しく説明していることは証明しません。
  - 1つの判定は1回だけ署名します。`step_up`の判定は、委任アクションとメッセージには署名しません。
  - リクエストは引き続き`presentation`と`steps`を受け取ります。
- 互換性のない変更:
  - `seams.speakToSign`はなくなりました。古い名前の別名はありません。`seams.near.speakToSign`を使ってください。

    | 0.65.0 | 0.66.0 |
    | --- | --- |
    | `seams.speakToSign.requestTransfer` | `seams.near.speakToSign.typed.transfer` |
    | `seams.speakToSign.requestNote` | `seams.near.speakToSign.typed.note` |
    | `seams.speakToSign.requestRating` | `seams.near.speakToSign.typed.rating` |
    | `seams.speakToSign.requestMergeApproval` | `seams.near.speakToSign.typed.mergeApproval` |
    | `seams.speakToSign.enroll` | `seams.near.speakToSign.enroll` |

  - すべての署名呼び出しは、成功すると`{ kind: 'approved', result, approval, times }`を返します。それ以外は`refused`、`cancelled`、`unavailable`です。kind `sent`はなくなりました。`result`は、送信した取引とすべての`typed`の呼び出しでは`{ transactionHash }`、`signTransaction`と`signDelegateAction`では通常の結果、メッセージでは`{ accountId, publicKey, signature, nonce, state? }`です。リクエストのフィールドは変わりません。
  - 共同署名者の固定の音声上限(1回の支払いで10 NEAR、24時間で20 NEAR)はなくなりました。結果の理由`voice_limit`と、拒否`over_payment_limit`、`over_daily_limit`もなくなりました。上限はWalletのポリシーエンジンのルールです。
- Speak-to-SignのホストAPIはバージョン **10** です。ホストプラグインには新しいメソッド`requestMessage`があります。Walletは別のバージョンのホストプラグインを拒否するため、`@seams/speak-to-sign` 0.66.0を`@seams/wallet` 0.66.0と一緒にインストールしてください。VoiceIDのホストAPIはバージョン **11** のままです。
- Speak-to-Signのベリファイアーは **0.9.0** です。OutLayerのバージョンキーは`6725917bd01355f08bb402271dff6265c0d03650c1b1acf8d0992b2537d65ef1`です。`signAndSendTransaction`、`signTransaction`、`signDelegateAction`、`signMessage`には0.9.0が必要です。`typed.bet`には0.8.0以降が必要です。`typed.transfer`、`typed.note`、`typed.rating`、`typed.mergeApproval`は0.5.2でも動きます。
- 取引確認カードには、新しい色トークン`transactionCardBorder`(`--seams-colors-transactionCardBorder`)で1pxの枠線があります。既定値は透明です。`appearance.theme.colors.transactionCardBorder`で設定してください。
- 「Secured by seams」フッターのseamsのロゴは https://wallet.seams.sh へのリンクで、新しいタブで開きます。
- 修正：
  - Walletのモーダルで、開いたカードがフレームより高い場合も、トランザクションの詳細が1回の動きで開きます。以前は2段階で開き、「確認」ボタンが画面の外に押し出されました。
  - VoiceIDとSpeak-to-Signのプラグインは、Walletのブリッジ（`/sdk/voiceid-host.js`、`/sdk/speak-to-sign-host.js`）を`?v=`と固定したWalletのバージョン付きで読み込みます。以前は、ブラウザーが新しいプラグインのファイルを、キャッシュに残った前のリリースのブリッジと一緒に実行し、プラグインの読み込みに失敗することがありました。
  - Wallet設定の受け取り画面は、どのアプリでもQRコードを表示します。`qrcode`は省略可能なピア依存関係ではなく、`@seams/wallet`の依存関係になったため、アプリでインストールする必要はありません。以前は、`qrcode`のないアプリで空の枠が表示されていました。Walletがコードを作れない場合は、画面にそのことを表示します。
  - 認証方法の「追加」と「削除」のボタンに、ラベルが収まる余白ができました。以前は、ラベルがボタンからはみ出していました。
  - 「Secured by seams」フッターのロゴは、テキストと同じ行の中央に揃います。以前は、ロゴがテキストより高い位置にありました。
- SDK、ホストされたWallet、サーバーは一緒にリリースしてください。`@seams/wallet-server` 0.66.0の共同署名者が新しいリクエストの種類を確認し、古いWalletホストはそれを拒否します。
- 4つのパッケージをすべて0.66.0でインストールしてください。Speak-to-Signは引き続き実験的機能で、NEARテストネット専用です。実際の資金では使わないでください。

ウォレットのiframeプロトコルは **23.0.0**、ウォレット管理プロトコルは **5** のままです。
署名付きの復旧CLIは **0.29.0** のままです。このリリースはデータベースのマイグレーションを追加しません。
テーブル`speak_to_sign_voice_verdicts`は金額の列を残し、値は0です。

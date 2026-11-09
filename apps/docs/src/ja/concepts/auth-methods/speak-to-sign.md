---
title: '実験的機能: Speak-to-Sign'
description: 証明付きの検証者が所有者の声と言葉を確認して承認し、所有者自身のアカウントから送る、実験的な音声によるNEARの支払いです。テストネット専用です。
---

# 実験的機能: Speak-to-Sign {#experimental-speak-to-sign}

::: warning 実験的機能
Speak-to-Signは実験的機能です。**NEARテストネットだけ**で動作します。リリース0.54.0が最初のリリースで、0.56.0で`enroll`を追加しました。
パッケージとルートは予告なく変わることがあります。実際の資金では使わないでください。
:::

Speak-to-Signでは、ウォレットの所有者が声で支払えます。所有者は「Send 2 NEAR to alice dot testnet」のような文を話します。
証明付きの検証者が、所有者の声でリクエストと同じ文が話されたことを確認し、判定に署名します。
Walletは判定を確認し、所有者自身のアカウントから送金します。話した文が確認の代わりになるため、受理された支払いでは確認画面もパスキーも出ません。

Speak-to-Signは取引機能であり、認証方法ではありません。ウォレットのアンロックやセッションの開始には使いません。
[VoiceID](/ja/concepts/auth-methods/voiceid)の登録が必要で、VoiceIDの録音画面を使います。

## 音声による支払いの流れ {#how-a-spoken-payment-works}

1. WalletがVoiceIDの画面に話すべき文を表示し、最長8秒の音声を1回録音します。カードは開いたままで、次の各手順を示します。
2. Seamsのサーバーが、録音と型付きのリクエストをOutLayer上の検証者に送ります。OutLayerは、TEE(信頼できる実行環境)でコードを実行するNEARのオフチェーン計算サービスです。
3. 検証者は、Phala Cloud上のサービスから話者埋め込みを、NEAR AIから文字起こしを同時に受け取ります。
   声は所有者が登録したテンプレートと、言葉は検証者自身が作ったリクエストの文と比較します。
   金額は完全に一致する必要があります。値を持たない語は、似た音の語でも受け入れます(「NEAR」に対する「year」、「send」に対する「sent」、「testnet」に対する「testnode」など)。
   送金先も、アカウント名に似た音の名前を受け入れます。その後、ポリシーの手順が追加の承認を求めることがあります。
4. 検証者が、120秒で期限が切れる署名付きの判定を返します。Walletは、Wallet自身が固定した検証者の鍵で、リクエスト、話した文、録音、期限、署名を確認します。
5. `accept`の場合、Walletは確認画面なしで所有者のウォレットセッションを使って送金に署名し、送ります。
   `step_up`の場合、カードは所有者に、セッション自身の方法でもう一度承認するよう求めます(パスキーのセッションではパスキーです)。
   署名のリクエストは判定を含みます。Seamsの共同署名者は、署名の自分の部分を加える前に判定をもう一度確認します([信頼モデル](#trust-model)を参照)。
6. カードは結果を示します。送金した場合は取引へのリンクを、拒否された場合は理由を示します。言葉または声が拒否された後、所有者は文をもう一度録音できます。録音は合計で5回までです。呼び出しは、所有者がカードを閉じたときに戻ります。

音声による支払いには、有効なウォレットセッションが必要です。セッションがロック中または期限切れの場合、Walletは先にアンロックを求めます。

## インストール {#install}

3つのパッケージを同じバージョンでインストールします。

```sh
pnpm add @seams/wallet@0.58.1 @seams/voiceid@0.58.1 @seams/speak-to-sign@0.58.1
```

VoiceIDの認証方法と一緒に、記述子を`transactionFeatures`に追加します。

```ts [部分的な実装例]
import { SeamsWeb } from '@seams/wallet';
import { voiceIdAuthMethod } from '@seams/voiceid';
import { speakToSign } from '@seams/speak-to-sign';

const seams = new SeamsWeb({
  // ...the rest of your configuration
  authMethods: [voiceIdAuthMethod()],
  transactionFeatures: [speakToSign({ network: 'testnet' })],
});

if (seams.speakToSign) {
  const result = await seams.speakToSign.requestTransfer({
    walletId,
    receiver: 'alice.testnet',
    amount: '2',
  });
}
```

`seams.speakToSign`は、設定に記述子がある場合だけ存在します。送金先には、`alice.testnet`のように所有者が読み上げられる任意の名前付きNEARアカウントを指定できます。
暗黙的アカウント(64桁の16進数)または`0x`アカウントの場合、結果は`receiver_not_speakable`の`refused`です。
存在しないアカウントの場合、結果は`receiver_missing`の`refused`です。
金額は小数点以下2桁までのNEARの10進数です。結果の`kind`は、`sent`、`refused`、`cancelled`、`unavailable`のいずれかです。
`sent`の結果には`approval`があります。判定だけで承認した場合は`voice`、ポリシーのルールが確認画面を再び求めた場合は`voice_and_passkey`です。
現在、検証者には仮のルールが1つあります。10 NEARを超える音声による支払いにはパスキーが必要です。

Seamsの共同署名者が判定を拒否した場合、結果は`refused`で、理由は`voice_limit`(1回の支払いまたは24時間の音声の上限を超えた場合)か、
`cosigner_refused`(共同署名者のその他の拒否)です。このとき`detail`には、`over_daily_limit`や`reused`のような共同署名者の理由が入ります。
何も署名されていません。

記述子を設定しないアプリは、Speak-to-Signのコード、WASM、アセットを一切ダウンロードしません。
記述子を設定したアプリも、音声による支払いを始めるまでは何も追加で読み込みません。

## 所有者の準備 {#set-up-the-owner}

最初の音声による支払いの前に、所有者には次のものが必要です。

1. ウォレットでVoiceIDが有効であること:
   `seams.registration.activateAuthMethod({ walletId, method: 'voiceid' })`。
2. 検証者での声のテンプレート:

```ts [部分的な実装例]
const enrollment = await seams.speakToSign.enroll({ walletId });
if (enrollment.kind === 'enrolled') {
  console.log('template', enrollment.templateEpoch);
}
```

`enroll`は、VoiceIDの画面に短い文を3つ表示します。その後、所有者はウォレットの確認画面で、署名付きのメッセージ(NEP-413)を1回承認します。
メッセージには、これらの録音だけのダイジェストが入っています。検証者は、所有者のフルアクセスキーがそのメッセージに署名したことを確認し、その音声だけを登録します。
新しい登録は以前のテンプレートを置き換えます。結果の`kind`は、`enrolled`、`refused`、`cancelled`、`unavailable`のいずれかです。

送金ごとのガスは所有者のアカウントが支払います。テストネットでは約0.00005 NEARです。

## 音声によるコミュニティノート {#spoken-community-notes}

同じ流れで、コミュニティノートやノートの評価にも署名できます。ノートのコントラクトには
`add_note({ post_id, text, summary })` と `rate_note({ note_id, rating })` が必要です。
作成者はノートを入力し、短い要約だけを読み上げます。判定はノート全体をSHA-256で結び付けます。
Wallet coreが呼び出しを1件作り、デポジットも確認もなしで署名します。

```ts [Partial example]
import { summaryRefusal } from '@seams/wallet';

if (summaryRefusal(summary) === null) {
  await seams.speakToSign.requestNote({
    walletId,
    contract: 'community-notes.testnet',
    postId: 7,
    text: 'The city closes one lane for two weeks. The bridge stays open.',
    summary: 'Only one lane closes for two weeks.',
  });
}
await seams.speakToSign.requestRating({
  walletId,
  contract: 'community-notes.testnet',
  noteId: 3,
  rating: 'helpful',
});
```

- 要約は、ASCII文字だけの1〜12語です。数は単語で書きます。数字、アポストロフィ、ハイフン、URL、ハンドルは `summary_not_speakable` になります。
- 評価は「this note is helpful」「this note is somewhat helpful」「this note is not helpful」のどれかを話します。
- 4語以上の要約は、1語が違って聞こえても、1語が抜けても通ります。ただし「not」の追加や欠落は通りません。
- ノートには検証者0.4.0以降が必要です。

## Walletホストの準備 {#prepare-the-wallet-host}

`walletOrigin`の運用者は、同じパッケージをインストールし、新しいディレクトリーにアセットを構成します。

```sh
npx --no-install seams-speak-to-sign-host ./wallet-with-speak-to-sign
```

そのディレクトリーを`walletOrigin`の静的ルートとしてデプロイしてください。
Walletは、音声による支払いを始めたときだけ`/sdk/speak-to-sign/host.js`を読み込みます。ホストAPIのバージョンが異なるホストプラグインは拒否します。

## Seamsサーバーの設定 {#configure-the-seams-server}

Seamsのサーバーは、6つの変数をすべて設定した場合だけ`POST /speak-to-sign/v1/verify`を追加します。

| 変数                                        | テストネットの値                                                   |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `SPEAK_TO_SIGN_OUTLAYER_BASE_URL`           | `https://testnet-api.outlayer.ai`                                  |
| `SPEAK_TO_SIGN_OUTLAYER_PROJECT`            | `seams-v1.testnet/voice-verifier`                                  |
| `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`        | `5b6fad5df11440847e13508f57736da8de371526824cf12178dfc20be2c9c1d1` |
| `SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY`        | OutLayerの支払い用の鍵です。シークレットストアに保管してください。 |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE`    | `main`                                                             |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID` | `cyan-loong.testnet`                                               |

このルートは、呼び出し元のウォレットセッションを本人確認として読みます。セッションがない場合は401 `unauthorized`、
セッションストアが失敗した場合は503 `session_unavailable`を返し、署名の使用回数は消費しません。
別の所有者の声のリクエストは拒否します。検証者の`verify`と`enroll`の両方の操作を扱い、本文は最大1,100 KBです。
検証者の出力は変更せずに返します。

同じ6つの変数で、共同署名者による判定の確認も有効になります。共同署名者は、受け入れた判定を署名者データベースのテーブル
`speak_to_sign_voice_verdicts`(D1のマイグレーション`0089_speak_to_sign_voice_verdicts.sql`)に記録します。
これらの変数がないSeamsのサーバーは、判定を含む署名のリクエストをすべて理由`unavailable`で拒否します。

## 検証者の鍵 {#the-verifier-key}

検証者はOutLayerのプロジェクト`seams-v1.testnet/voice-verifier`です。判定の鍵
`ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`はプロジェクトに結び付いており、バージョンが変わっても同じです。
Walletはこの鍵を自身のコードに固定します。アプリがSeamsのサーバーのURLを選ぶため、鍵をアプリから受け取ることはありません。
Walletは、1つの流れで最大1回だけ、同じ流れで録音した音声に対してだけ支払います。

## 信頼モデル {#trust-model}

- Walletは、固定された鍵がこのリクエスト(ネットワーク、所有者、送金先、金額)とこの流れの録音に署名した判定の後でだけ署名します。
  ウォレットセッションとSeamsの共同署名者は、すべての署名に引き続き参加します。
- Seamsの共同署名者は、署名の自分の部分を加える前に判定をもう一度確認します。確認するのは、判定を含む署名のリクエストだけです。
  通常の署名のリクエストは判定を含まず、共同署名者はこれまでどおりに扱います。共同署名者は次の項目を確認します。
  - 署名。同じ固定された検証者の鍵で確認します。
  - 期限。検証者の署名から最長120秒です。
  - 取引。共同署名者は、署名を求められた未署名の取引を読み、リクエストを作り直します。送金先と金額を持つ1つの送金か、
    デポジットなしの1つの`add_note`または`rate_note`の呼び出しです。作り直したリクエストのダイジェストは、判定のダイジェストと同じである必要があります。
  - 所有者。取引の署名者は、ウォレットセッションのNEARアカウントである必要があります。
  - 1回だけの使用。共同署名者は受け入れた各判定を記録し、別の署名のリクエストでは拒否します。
  - 各ウォレットの音声の上限。1回の音声による支払いは最大10 NEAR、任意の24時間では最大20 NEARです。
    拒否された支払いは数えません。受け入れた支払いは、その後チェーン上で失敗しても数えます。
  - `step_up`の判定。共同署名者は、新しい承認がある場合だけ受け入れます。新しい承認とは、同じ操作のパスキーまたはEmail OTPのステップアップか、
    検証者が判定に署名した後の新しいVoiceIDのアンロックです。このような支払いは声だけの承認ではないため、音声の上限は適用しません。
    VoiceIDだけのウォレットでは、新しい承認は2回目の声の確認(デバイス上のVoiceID)になるため、その支払いは声で2回承認されます。
- 共同署名者の確認は、WalletのSpeak-to-Signの経路の障害から守り、上限と1回だけの使用をサーバーで保ちます。
  判定を省く`walletOrigin`のコードは止めません。そのようなコードは、開いているウォレットセッションですでに署名できるためです。
- 音声による支払いを制限するコントラクトはありません。ポリシーのルールの金額を超える支払いでは、確認画面が再び必要です。
- 検証者はOutLayerのTEEで動作します。OutLayerのプロジェクトの所有者は、同じ鍵で署名する新しいバージョンをデプロイできます。
- 話者の確認は、鍵を固定したPhalaのdstack CVMで動作します。Phalaのアプリの所有者は、その鍵を保ったままコードを変更できます。
- 文字起こしはNEAR AIが作ります。文字起こしには署名がないため、検証者はNEAR AIのゲートウェイを信頼します。
- `walletOrigin`のコードは、所有者が話した後にリクエストを変更できません。変更すると言葉が一致しなくなります。
- 任意の名前付きアカウントが音声による支払いを受け取れます。声の確認が所有者の声の複製または再生を受け入れた場合、
  支払いは任意の名前付きアカウントに送られる可能性があります。ステップアップの金額より下では、声だけで支払えます。
- 検証者は、似た音の送金先の名前を受け入れます。音のキーが同じ名前と、最初の2つの音が同じで音が1つだけ異なる名前です(`alice.testnet`に対する`alicia.testnet`など)。
  そのため、`bob.testnet`と`bobb.testnet`のような2つのアカウントを区別できません。所有者は、話す前に画面のアカウントを読んでください。

[VoiceID](/ja/concepts/auth-methods/voiceid)のアンロックと異なり、音声はブラウザーの外に送られます。
音声はOutLayer、Phala、NEAR AIに送られ、声のテンプレートはOutLayerのストレージに保存されます。

次に読むページ:

- [VoiceID](/ja/concepts/auth-methods/voiceid)
- [Wallet iframe](/ja/concepts/custody/wallet-iframe)

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
   Walletは送信の前に、録音を検証者の音声鍵で封印します。そのためSeamsのサーバーは暗号文だけを運び、検証者がTEEの中で録音を開きます。
2. Seamsのサーバーが、録音と型付きのリクエストをOutLayer上の検証者に送ります。OutLayerは、TEE(信頼できる実行環境)でコードを実行するNEARのオフチェーン計算サービスです。
   検証者が動作している間に、Walletは支払いのためのアクセスキーのnonceと最近のブロックハッシュを読みます。判定の前には何も署名しません。
3. 検証者は、Phala Cloud上のサービスから話者埋め込みを、NEAR AIから文字起こしを同時に受け取ります(サーバーに`venice`ビルドがあれば、NEAR AIのWhisperが停止している間はVenice AIから受け取ります。[Seamsサーバーの設定](#configure-the-seams-server)を参照)。
   声は所有者が登録したテンプレートと、言葉は検証者自身が作ったリクエストの文と比較します。
   金額は完全に一致する必要があります。値を持たない語は、似た音の語でも受け入れます(「NEAR」に対する「year」、「send」に対する「sent」、「testnet」に対する「testnode」など)。
   送金先も、アカウント名に似た音の名前を受け入れます。区切りは別の言い方でもかまいません(「dot」に対する「period」、「dash」に対する「hyphen」など)。
   区切りと「testnet」は省略できます。「seams v one」は`seams-v1.testnet`です。その後、ポリシーの手順が追加の承認を求めることがあります。
4. 検証者が、120秒で期限が切れる署名付きの判定を返します。Walletは、Wallet自身が固定した検証者の鍵で、リクエスト、話した文、録音、期限、署名を確認します。
5. `accept`の場合、Walletは確認画面なしで所有者のウォレットセッションを使って送金に署名し、送ります。
   `step_up`の場合、カードは所有者に、セッション自身の方法でもう一度承認するよう求めます(パスキーのセッションではパスキーです)。
   署名のリクエストは判定を含みます。Seamsの共同署名者は、署名の自分の部分を加える前に判定をもう一度確認します([信頼モデル](#trust-model)を参照)。
6. カードは結果を示します。送金した場合は取引へのリンクを、拒否された場合は理由を示します。言葉または声が拒否された後、所有者は文をもう一度録音できます。録音は合計で5回までです。呼び出しは、所有者がカードを閉じたときに戻ります。

音声による支払いには、有効なウォレットセッションが必要です。セッションがロック中または期限切れの場合、Walletは先にアンロックを求めます。

## インストール {#install}

2つのパッケージを同じバージョンでインストールします。Speak-to-Signは`@seams/wallet`の一部で、専用のパッケージはありません。

```sh
pnpm add @seams/wallet@0.70.0 @seams/voiceid@0.70.0
```

VoiceIDの認証方法と一緒に、`spoken`の記述子を`approvals`に追加します。

```ts [部分的な実装例]
import { SeamsWeb, spoken } from '@seams/wallet';
import { voiceIdAuthMethod } from '@seams/voiceid';

const seams = new SeamsWeb({
  // ...the rest of your configuration
  authMethods: [voiceIdAuthMethod()],
  approvals: [spoken({ network: 'testnet' })],
});

const result = await seams.near.spoken?.transfer({
  receiver: 'alice.testnet',
  amount: '2',
});
```

`seams.near.spoken`は、`approvals`に記述子がある場合だけ存在します。送金先には、`alice.testnet`のように所有者が読み上げられる任意の名前付きNEARアカウントを指定できます。
暗黙的アカウント(64桁の16進数)または`0x`アカウントの場合、結果は`receiver_not_speakable`の`refused`です。
存在しないアカウントの場合、結果は`receiver_missing`の`refused`です。
金額は小数点以下2桁までのNEARの10進数です。結果の`kind`は、`approved`、`refused`、`cancelled`、`unavailable`のいずれかです。
`approved`の結果には`result`(`transactionHash`)、`times`、`approval`があります。判定だけで承認した場合は`voice`、ポリシーのルールが確認画面を再び求めた場合は`voice_and_passkey`です。
現在、検証者には仮のルールが1つあります。10 NEARを超える音声による支払いにはパスキーが必要です。
`walletSession`は、通常の呼び出しと同じく省略できます。省略した場合は、認証済みのウォレットが対象です。

`onProgress`は省略できます。通常の呼び出しでは`approval`の中に、`spoken`の呼び出しではリクエストの中に指定します。リクエストの各段階を順に受け取ります。

| `stage`            | タイミング                                                     |
| ------------------ | -------------------------------------------------------------- |
| `recording_sent`   | WalletがSeamsの検証ルートに録音を送りました。                  |
| `verifier_running` | Seamsのサーバーが検証者を呼び出しました。                      |
| `verdict`          | 検証者が応答しました。`ms`には各段階の時間が入ります。         |
| `step_up`          | ポリシーのルールが新しい承認を求めます。`policyText`がルールです。 |
| `transaction_sent` | 署名した取引がネットワークに送られました。                     |
| `settled`          | NEARが取引の最終結果を返しました。`transactionHash`で示します。 |

検証者は結果を最後にだけ送るため、`verifier_running`と`verdict`の間にイベントはありません。リスナーのエラーはリクエストを止めません。

`autoStart`は省略でき、`onProgress`と同じ場所に指定します。`true`(リクエストの既定値)では、カードは開いたときに「録音」を押さなくても録音を始めます。`false`では、所有者が「録音」を押します。ブラウザーが操作なしで音声を開始しない場合は、カードに「録音」ボタンが残ります。

Seamsの共同署名者が判定を拒否した場合、結果は`refused`で、理由は`cosigner_refused`です。
このとき`detail`には、`reused`や`request_mismatch`のような共同署名者の理由が入ります。
何も署名されていません。Speak-to-Sign自体は金額の上限を設けません。

Speak-to-Signの流れはWalletの一部で、最初の音声リクエストのときに読み込まれます。記述子のないWalletは読み込みません。

## 通常の署名の呼び出しで音声による承認を使う

NEARの通常の署名の呼び出しは`approval`を受け取ります。指定すると、所有者はWalletの確認画面の代わりに音声で承認し、呼び出しは`kind`のある結果を返します。指定しない場合は通常の呼び出しです。

```ts [部分的な実装例]
const result = await seams.near.signAndSendTransaction({
  receiverId: 'guest-book.testnet',
  actions,
  approval: { kind: 'spoken', summary: 'Sign the guest book.' },
});
if (result.kind === 'approved') console.log(result.result.transactionHash);
```

| `approval`を指定する呼び出し  | 承認された結果の`result`          |
| ----------------------------- | --------------------------------- |
| `near.signAndSendTransaction` | `{ transactionHash }`             |
| `near.signTransaction`        | 署名済みの取引                    |
| `near.signDelegateAction`     | 署名済みのデリゲートアクション    |
| `near.signMessage`            | NEP-413の署名とノンス             |

所有者は`summary`(1〜12語の平易な単語)を読み上げます。判定は、Walletが署名する内容(取引の受取先とアクションのバイト列、またはNEP-413メッセージのバイト列)に結び付きます。`summary`はアプリが書きます。音声は、誰が承認し、何を言ったかを証明しますが、`summary`がリクエストを正しく説明していることは証明しません。
`approval`を指定した呼び出しは、拒否のときに例外を投げません。`approvals`に記述子がない場合は例外を投げます。

リクエストの項目から文を作る呼び出し(`transfer`、`note`、`rating`、`mergeApproval`、`bet`)と`enroll`は、`seams.near.spoken`にあります。

## 所有者の準備 {#set-up-the-owner}

最初の音声による支払いの前に、所有者には検証者での声のテンプレートが必要です。

```ts [部分的な実装例]
const enrollment = await seams.near.spoken?.enroll();
if (enrollment?.kind === 'enrolled') {
  console.log('template', enrollment.templateEpoch);
}
```

`enroll`は、VoiceIDの画面に短い文を3つ表示します。ウォレットにまだVoiceIDがない場合、`enroll`は先にVoiceIDを有効にします。そのVoiceID登録の3つのサンプルが、検証者の録音にもなります。そのため、所有者は両方のために文を1組だけ読みます。その後、所有者はウォレットの確認画面で、署名付きのメッセージ(NEP-413)を1回承認します。
メッセージには、これらの録音だけのダイジェストが入っています。検証者は、所有者のフルアクセスキーがそのメッセージに署名したことを確認し、その音声だけを登録します。
新しい登録は以前のテンプレートを置き換えます。結果の`kind`は、`enrolled`、`refused`、`cancelled`、`unavailable`のいずれかです。

既定では、所有者は各文で「録音」を押します。`enroll({ autoStart: true })`では、各文のカードは開いたときに録音を始めます。これはVoiceIDのあるウォレットに適用されます。`enroll`が先にVoiceIDを有効にする場合、VoiceIDのカードでは、これまでどおり各サンプルで「録音」を押します。

所有者がVoiceIDを無効にした場合、`enroll`は理由`voiceid_unavailable`の`unavailable`を返します。`seams.registration.setAuthMethodEnabled({ walletId, method: 'voiceid', enabled: true })`で再び有効にしてください。

送金ごとのガスは所有者のアカウントが支払います。テストネットでは約0.00005 NEARです。

## 音声によるコミュニティノート {#spoken-community-notes}

同じ流れで、コミュニティノートやノートの評価にも署名できます。ノートのコントラクトには
`add_note({ post_id, text, summary, verdict_json, signature_b64 })` と
`rate_note({ note_id, rating, verdict_json, signature_b64 })` が必要です。
作成者はノートを入力し、その短い要約だけを読み上げます。アプリが渡すのはノートだけで、要約は渡しません。

1. WalletはSeamsサーバーに要約を求めます(`POST /speak-to-sign/v1/summary`)。サーバーは、NEAR AIのチャットモデルでノートから要約を書きます。
2. カードは、ノートを要約の上に表示します。作成者は要約を話します。
3. 検証者はノートの本文を受け取ります。ノートをSHA-256で結び付け、要約がノートの要点を述べているかをJEV(はい・いいえで答えるNEAR AIのモデル)に尋ねます。合わない要約は`summary_mismatch`になります。

そのため、アプリは作成者が話す言葉を選べません。
Wallet coreが呼び出しを1件作り、デポジットも確認もなしで署名します。
呼び出しは判定とその署名を運ぶので、ノートのコントラクトは判定を自分で確認できます。
確認しないコントラクトは、この2つの引数を無視します。

```ts [Partial example]
await seams.near.spoken?.note({
  contract: 'community-notes.testnet',
  postId: 7,
  text: 'The city closes one lane for two weeks. The bridge stays open.',
});
await seams.near.spoken?.rating({
  contract: 'community-notes.testnet',
  noteId: 3,
  rating: 'helpful',
});
```

- ノートは1〜280文字です。
- サーバーから要約が来ない場合、結果は理由`summary_unavailable`の`unavailable`で、カードは開きません。Walletはサーバーの要約を`summaryRefusal`の規則(ASCII文字だけの1〜12語、数は単語)で確認します。規則に合わない要約は`summary_not_speakable`になります。
- JEVが答えない場合、検証者は`summary_check_unavailable`で拒否します。
- 評価は「this note is helpful」「this note is somewhat helpful」「this note is not helpful」のどれかを話します。
- 4語以上の要約は、1語が違って聞こえても、1語が抜けても通ります。ただし「not」の追加や欠落は通りません。
- ノートには検証者0.13.0以降が必要です。古い検証者は、ノートの本文を`unsupported`で拒否します。

## Walletホストの準備 {#prepare-the-wallet-host}

Speak-to-Signのために、Walletホストで行う専用の手順はありません。流れは`@seams/wallet`の中にあります。録音にはVoiceIDの画面を使うため、`walletOrigin`の運用者はVoiceIDのホストと同じようにVoiceIDを構成します。

```sh
npx --no-install seams-voiceid-host ./wallet-with-voiceid
```

0.67.0までは、ホストにプラグイン`@seams/wallet-voice-sign`もインストールし、`seams-speak-to-sign-host`で構成していました。両方とも削除してください。

## Seamsサーバーの設定 {#configure-the-seams-server}

Seamsのサーバーは、6つの変数をすべて設定した場合だけ`POST /speak-to-sign/v1/verify`を追加します。

| 変数                                        | テストネットの値                                                   |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `SPEAK_TO_SIGN_OUTLAYER_BASE_URL`           | `https://testnet-api.outlayer.ai`                                  |
| `SPEAK_TO_SIGN_OUTLAYER_PROJECT`            | `seams-v1.testnet/voice-verifier`                                  |
| `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`        | `bfe81633b9ed596df239201f153a84c860d71ddd8edf713c1c785ef2b7c1c946` |
| `SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY`        | OutLayerの支払い用の鍵です。シークレットストアに保管してください。 |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE`    | `main`                                                             |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID` | `cyan-loong.testnet`                                               |

もう1つの変数は任意です: `SPEAK_TO_SIGN_OUTLAYER_VENICE_VERSION_KEY`は、同じ検証者の`venice`ビルド(検証者0.14.0以降、speak-to-signリポジトリーの`./build.sh --venice`)のWASMハッシュです。
このビルドは、NEAR AIのWhisperの代わりにVenice AIへクリップを送り、その判定は`0.14.0+venice`のようにビルドの名前を示します。
サーバーが呼び出しごとにビルドを選び、ページは選べません。

- この変数がない場合、または`SPEAK_TO_SIGN_NEAR_AI_API_KEY`がない場合、すべての呼び出しをNEAR AIが処理します。
- 両方がある場合、サーバーはNEAR AIを確認します: モデルの一覧と、`openai/whisper-large-v3`への0.5秒の無音のクリップです。1回の確認を60秒間すべての呼び出しで使います。5xxの応答、または10秒以内に応答がない場合は停止とみなします。4xxの応答は停止とみなしません。
- NEAR AIまたはそのWhisperが停止している間、または確認が3秒以内に応答しない場合だけ、Veniceが呼び出しを処理します。それ以外はNEAR AIが処理します。

Venice AIはTEEの中で動かないので、受け取った録音を聞くことができます。その呼び出しの判定はそれを示し、Walletのレシートは「Speech to text: Venice AI, outside a TEE」を表示します。

Walletは各録音を封印するので、バージョンは検証者0.12.0以降が必要です。また、シークレットのプロファイルには、
Walletが固定している音声鍵のシークレット`PROTECTED_AUDIO_KEY`が必要です。古いバージョンは、すべての音声リクエストを`unsupported`で拒否します。

このルートは、呼び出し元のウォレットセッションを本人確認として読みます。セッションがない場合は401 `unauthorized`、
セッションストアが失敗した場合は503 `session_unavailable`を返し、署名の使用回数は消費しません。
別の所有者の声のリクエストは拒否します。検証者の操作は`verify`と`enroll`だけを扱い(ほかの操作は400 `unsupported_operation`)、本文は最大1,100 KBです。
検証者を呼ぶ前の拒否はJSONのエラーです。確認の後、ルートは`text/event-stream`で応答します。すぐに`verifier_running`イベントを送り、
次に検証者の出力をそのまま含む`verdict`イベントか、`verifier_timeout`のような固定のコードを含む`failed`イベントを1つ送ります。
ルートは`@seams/voice-sign/server`(speak-to-signリポジトリ)の`relayToVerifier`で検証者を呼びます。封印された録音は読めません。
転送するのは既知の種類の出力だけで、検証者のエラー出力は`verifier_failed`の`failed`になります。

`verdict`を送る前に、ルートは呼び出しのTDXクォートを確認します。判定の鍵はOutLayerのプロジェクトに結び付いているので、プロジェクトのどのバージョンも同じ鍵で署名します。クォートは実行されたWASMを示します。
ルートはOutLayerから呼び出しのアテステーションの記録を読みます。OutLayerは呼び出しの少し後に記録を保存するので、ルートは1秒ごとに最大15秒試します。
その後、`@seams/voice-verdict`で次を確認します。

- クォートが、出力を、ルートが呼んだビルドのWASMのハッシュ(`SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`、Veniceの呼び出しでは`SPEAK_TO_SIGN_OUTLAYER_VENICE_VERSION_KEY`)とプロジェクトに結び付けていること(`checkAttestationBinding`)。
- Intelがクォートに署名し、呼び出しの時点のIntelのコラテラルがプラットフォームを失効させていないこと(`checkQuoteCollateral`。コラテラルは`GET <api>/public/collateral`から取得)。
- OutLayerのワーカーのコントラクト(`worker.outlayer.testnet`)が、クォートの5つの測定値を承認していること(`measurementsApproved`。`https://rpc.testnet.fastnear.com`を使用)。

サーバーは、プラットフォームごとのコラテラルを次の更新までメモリーに保持し、コントラクトの承認を10分間保持します。
確認が失敗した場合、または記録が時間内に来ない場合、ルートは`attestation_wasm_not_accepted`や`attestation_unavailable`のようなコード`attestation_<code>`を含む`failed`を送ります。
ログにはコードと時間だけが出ます。`verdict`には記録の完全なURL`attestationUrl`と`transcriber`(`nearai`または`venice`)があり、その`timing`には、待ち時間を含む確認の時間`attestationMs`があります。

ルート`POST /speak-to-sign/v1/summary`は、音声によるコミュニティノートの要約を書きます。サーバーがこのルートを追加するのは、上の6つの変数と、NEAR AIの鍵`SPEAK_TO_SIGN_NEAR_AI_API_KEY`があるときだけです。鍵はシークレットストアに保管してください。
`SPEAK_TO_SIGN_SUMMARY_MODEL`は任意で、既定は`Qwen/Qwen3.8-27B`です。ルートはこのモデルを思考なしで呼びます。ルートは、verifyのルートと同じくウォレットセッションを読みます。
`{ text }`(1〜280文字)を受け取り、`{ ok: true, summary }`を返します。モデルが要約の規則を破った場合は、もう一度だけ尋ねます。
失敗は固定のコードを含むJSONのエラーです:`summary_unreachable`、`summary_failed`、`summary_not_speakable`。鍵がないと、Walletは音声によるノートに署名できません。

同じ6つの変数で、共同署名者による判定の確認も有効になります。共同署名者は、受け入れた判定を署名者データベースのテーブル
`speak_to_sign_voice_verdicts`(D1のマイグレーション`0089_speak_to_sign_voice_verdicts.sql`)に記録します。
新しい記録を追加するたびに、そのウォレットの24時間より古い記録を削除します。サーバーのログには、拒否のたびに理由、ウォレット、署名のリクエストを含む警告が1行出ます。
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
  - 運ばれる判定。ノート、評価、ベットは判定をコントラクトに運びます。それは署名のリクエストに付いた判定と同じである必要があります。
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
- NEAR AIのWhisperが停止している間、`venice`ビルドを持つサーバーはクリップをVenice AIに送ります。VeniceはTEEの中で動かないので、録音を聞くことができ、検証者はその文字起こしを信頼します。
- `walletOrigin`のコードは、所有者が話した後にリクエストを変更できません。変更すると言葉が一致しなくなります。
- 任意の名前付きアカウントが音声による支払いを受け取れます。声の確認が所有者の声の複製または再生を受け入れた場合、
  支払いは任意の名前付きアカウントに送られる可能性があります。ステップアップの金額より下では、声だけで支払えます。
- 検証者は、似た音の送金先の名前を受け入れます。音のキーが同じ名前と、最初の2つの音が同じで音が1つだけ異なる名前です(`alice.testnet`に対する`alicia.testnet`など)。
  区切りとネットワークの接尾辞のない名前も受け入れます。そのため、`bob.testnet`と`bobb.testnet`、`bob-1.testnet`と`bob1.testnet`のような2つのアカウントを区別できません。所有者は、話す前に画面のアカウントを読んでください。

[VoiceID](/ja/concepts/auth-methods/voiceid)のアンロックと異なり、音声はブラウザーの外に送られます。
音声はOutLayer、Phala、NEAR AI(NEAR AIのWhisperが停止している間はVenice AI)に送られ、声のテンプレートはOutLayerのストレージに保存されます。

次に読むページ:

- [VoiceID](/ja/concepts/auth-methods/voiceid)
- [Wallet iframe](/ja/concepts/custody/wallet-iframe)

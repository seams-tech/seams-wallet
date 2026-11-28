---
title: '実験的機能: Speak-to-Sign'
description: 所有者自身のアカウントから送る、実験的な音声によるNEARの支払いです。Cloudflare上のSeamsの検証者が所有者の声を確認して聞き取った言葉に署名し、Walletが言葉を確認します。テストネット専用です。
---

# 実験的機能: Speak-to-Sign {#experimental-speak-to-sign}

::: warning 実験的機能
Speak-to-Signは実験的機能です。**NEARテストネットだけ**で動作します。リリース0.54.0が最初のリリースで、0.56.0で`enroll`を追加しました。
パッケージとルートは予告なく変わることがあります。実際の資金では使わないでください。
:::

Speak-to-Signでは、ウォレットの所有者が声で支払えます。所有者は「Send 2 NEAR to alice dot testnet」のような文を話します。
Seamsの検証者は、声が所有者のものであることを確認し、聞き取った言葉を含む判定に署名します。
Walletは判定を確認し、聞き取った言葉がリクエストの言葉と完全に同じであることを確認します。その後、所有者自身のアカウントから送金します。
話した文が確認の代わりになるため、受理された支払いでは確認画面もパスキーも出ません。

Speak-to-Signは取引機能であり、認証方法ではありません。ウォレットのアンロックやセッションの開始には使いません。
[VoiceID](/ja/concepts/auth-methods/voiceid)の登録が必要で、VoiceIDの録音画面を使います。

## 検証者 {#the-verifier}

各レーンのSeamsのサーバーは、1つの検証者のバックエンドを呼び出します。サーバーの設定`SPEAK_TO_SIGN_BACKEND`がバックエンドを指定します([Seamsサーバーの設定](#configure-the-seams-server)を参照)。

- **SaySo**はWalletのバックエンドです。Seamsの運用者が動かすCloudflare Workerです。Cloudflare Workers AIのWhisper large-v3-turboで文字起こしを作り、Cloudflare ContainerのReDimNet B1で話者を確認し、Ed25519の判定に署名します。レーンごとに、専用のSaySoのデプロイ、判定の鍵、声のテンプレートがあります。
- SaySoを使う最初のレーンは`staging-testnet`です。ほかのレーンにはまだ検証者がないため、そのSeamsのサーバーには検証のルートがありません。
- **OutLayer**は0.76.0までの検証者です。OutLayer上のTEE(信頼できる実行環境)で動作しました。コードは無効のモジュールとして残り、どのレーンも動かしていません。

OutLayerの声のテンプレートはSaySoに移りません。各所有者は声をもう一度登録します([所有者の準備](#set-up-the-owner)を参照)。

## 音声による支払いの流れ {#how-a-spoken-payment-works}

1. WalletがVoiceIDの画面にリクエストと話すべき文を表示し、最長8秒の音声を1回録音します。カードは開いたままで、次の各手順を示します。
2. Walletは、録音をWAVとしてリクエストと一緒にSeamsのサーバーに送ります。サーバーは、Cloudflareのサービスバインディングと自分の鍵でSaySoを呼び出します。ブラウザーがSaySoの鍵を持つことはありません。
   検証者が動作している間に、Walletは支払いのためのアクセスキーのnonceと最近のブロックハッシュを読みます。判定の前には何も署名しません。
3. SaySoは、Workers AIから録音の文字起こしを、コンテナーから話者埋め込みを受け取ります。声を所有者が登録したテンプレートと比較し、以前に見た録音は拒否します。言葉の判断はしません。
4. SaySoが、120秒で期限が切れる署名付きの判定を返します。判定には、所有者、リクエストのダイジェストと文を結び付けるインテントのダイジェスト、録音のダイジェスト、文字起こしが入っています。
5. Walletは、Wallet自身が固定したSaySoの鍵で判定を確認します。署名、期限、所有者、リクエスト、録音を確認します。
   次に、Speak-to-Signの文の読み取り部品`spoken-intent`で文字起こしを読み、リクエストの言葉と比較します。金額は完全に一致する必要があります。
   送金では、値を持たない語は似た音の語でも受け入れます(「send」に対する「sent」、「NEAR」に対する「nir」など)。送金先も、リクエストの送金先に似た音の名前を受け入れます。
   区切りは別の言い方でもかまいません(「dot」に対する「period」、「dash」に対する「hyphen」など)。区切りと「testnet」は省略できます。「seams v one」は`seams-v1.testnet`です。
6. Walletは確認画面なしで所有者のウォレットセッションを使って送金に署名し、送ります。署名のリクエストは判定を含みます。Seamsの共同署名者は、署名の自分の部分を加える前に判定をもう一度確認します([信頼モデル](#trust-model)を参照)。
7. カードは結果を示します。送金した場合は取引へのリンクを、拒否された場合は理由を示します。言葉または声が拒否された後、所有者は文をもう一度録音できます。録音は合計で5回までです。呼び出しは、所有者がカードを閉じたときに戻ります。

音声による支払いには、有効なウォレットセッションが必要です。セッションがロック中または期限切れの場合、Walletは先にアンロックを求めます。

SaySoが受け付ける文は、最大16語、最大160文字です。これより長い文のリクエストには、音声による承認がありません。Walletはカードを開かず、結果は理由`verifier_unavailable`の`unavailable`です。
`detail`が理由を示します。例:「The sentence has 18 words; the verifier takes at most 16.」このようなリクエストには、Walletの確認画面を使ってください。`approval`なしで呼び出します。

## インストール {#install}

MPCウォレットのパッケージをインストールします。Speak-to-SignとVoiceIDの記述子は`@seams/mpc-wallet`の一部で、専用のパッケージはありません。

```sh
pnpm add @seams/mpc-wallet@0.77.0
```

VoiceIDの認証方法と一緒に、`spoken`の記述子を`approvals`に追加します。

```ts [部分的な実装例]
import { SeamsWeb, spoken } from '@seams/mpc-wallet/client';
import { voiceIdAuthMethod } from '@seams/mpc-wallet/voiceid';

const seams = new SeamsWeb({
  // ...the rest of your configuration
  authMethods: [voiceIdAuthMethod()],
  approvals: [spoken({ network: 'testnet' })],
});

const result = await seams.near.signAndSendTransaction({
  receiverId: 'guest-book.testnet',
  actions,
  approval: { kind: 'spoken', summary: 'Sign the guest book.' },
});
if (result.kind === 'approved') console.log(result.result.transactionHash);
```

NEARの通常の署名の呼び出しは`approval`を受け取ります。指定すると、所有者はWalletの確認画面の代わりに音声で承認し、呼び出しは`kind`のある結果を返します。指定しない場合は通常の呼び出しです。

| `approval`を指定する呼び出し  | 承認された結果の`result`       |
| ----------------------------- | ------------------------------ |
| `near.signAndSendTransaction` | `{ transactionHash }`          |
| `near.signTransaction`        | 署名済みの取引                 |
| `near.signDelegateAction`     | 署名済みのデリゲートアクション |
| `near.signMessage`            | NEP-413の署名とノンス          |

- `summary`は所有者が読み上げる文です。1〜12語の平易な単語です(`summaryRefusal`)。
- 判定は、Walletが署名する内容に結び付きます。取引とデリゲートアクションでは受取先とアクションのバイト列、NEP-413メッセージではそのバイト列です。Seamsの共同署名者は、自分が署名するバイト列で判定をもう一度確認します。
- `summary`はアプリが書きます。音声は、誰が承認し、何を言ったかを証明しますが、`summary`がリクエストを正しく説明していることは証明しません。
- カードは`summary`の上に、Walletの確認画面と同じ言葉でリクエストを表示します。取引とデリゲートアクションでは受取先と各アクション、メッセージでは宛先と本文です。この表示は、Walletが署名するリクエストからWalletが書くので、所有者は話す前に読めます。
- デリゲートアクションの送信者はWalletが設定し、メッセージのノンスはWalletが作ります。
- `walletSession`は、通常の呼び出しと同じく省略できます。省略した場合は、認証済みのウォレットが対象です。
- `approvals`に記述子がない場合、`approval`を指定した呼び出しは例外を投げます。

`approval`を指定した呼び出しは、すべて同じ形の結果を返し、拒否のときに例外を投げません。`kind`は、`approved`、`refused`、`cancelled`、`unavailable`のいずれかです。
`approved`の結果には`result`、`times`、`approval`、`attestationUrl`があります。SaySoでは、`approval`は常に`voice`です。判定だけでリクエストを承認しました。
SaySoにはアテステーションがないため、`attestationUrl`は常に`null`です。OutLayerの検証者は、ポリシーのルールが確認画面を再び求めた場合に`voice_and_passkey`を設定し、呼び出しのTDXクォートへのリンクを返しました。

## 型付きの呼び出し {#typed-calls}

`seams.near.spoken`には、リクエストの項目から文を作る呼び出しがあります。そのため、所有者はWalletが署名する内容を話します。`approvals`に記述子がある場合だけ存在します。

```ts [部分的な実装例]
const result = await seams.near.spoken?.transfer({
  receiver: 'alice.testnet',
  amount: '2',
});
```

| 呼び出し               | 所有者が話す文                                  |
| ---------------------- | ----------------------------------------------- |
| `spoken.transfer`      | 「send two near to alice dot testnet」          |
| `spoken.note`          | Seamsが書く、コミュニティノートの要約           |
| `spoken.rating`        | 「this note is helpful」                        |
| `spoken.mergeApproval` | 「merge pull request forty two into main」      |
| `spoken.bet`           | 「bet zero point five usdc yes on market nine」 |

`spoken.transfer`の送金先には、`alice.testnet`のように所有者が読み上げられる任意の名前付きNEARアカウントを指定できます。
暗黙的アカウント(64桁の16進数)または`0x`アカウントの場合、結果は`receiver_not_speakable`の`refused`です。
存在しないアカウントの場合、結果は`receiver_missing`の`refused`です。
金額は小数点以下2桁までのNEARの10進数です。パスキーのステップアップと同じく、声はどの金額も承認します。

`onProgress`は省略できます。通常の呼び出しでは`approval`の中に、型付きの呼び出しではリクエストの中に指定します。リクエストの各段階を順に受け取ります。

| `stage`            | タイミング                                                         |
| ------------------ | ------------------------------------------------------------------ |
| `recording_sent`   | WalletがSeamsの検証ルートに録音を送りました。                      |
| `verifier_running` | Seamsのサーバーが検証者を呼び出しました。                          |
| `verdict`          | 検証者が応答しました。`ms`には各段階の時間が入ります。             |
| `step_up`          | ポリシーのルールが新しい承認を求めます。`policyText`がルールです。 |
| `transaction_sent` | 署名した取引がネットワークに送られました。                         |
| `settled`          | NEARが取引の最終結果を返しました。`transactionHash`で示します。    |

検証者は結果を最後にだけ送るため、`verifier_running`と`verdict`の間にイベントはありません。ポリシーのルールはOutLayerの検証者だけにあるため、SaySoは`step_up`を送りません。リスナーのエラーはリクエストを止めません。

`autoStart`は省略でき、`onProgress`と同じ場所に指定します。`true`(リクエストの既定値)では、カードは開いたときに「録音」を押さなくても録音を始めます。`false`では、所有者が「録音」を押します。ブラウザーが操作なしで音声を開始しない場合は、カードに「録音」ボタンが残ります。

Seamsの共同署名者が判定を拒否した場合、結果は`refused`で、理由は`cosigner_refused`です。
このとき`detail`には、`reused`や`request_mismatch`のような共同署名者の理由が入ります。
何も署名されていません。Speak-to-Sign自体は金額の上限を設けません。

Speak-to-Signの流れはWalletの一部で、最初の音声リクエストのときに読み込まれます。記述子のないWalletは読み込みません。

## 所有者の準備 {#set-up-the-owner}

最初の音声による支払いの前に、所有者には検証者での声のテンプレートが必要です。

```ts [部分的な実装例]
const enrollment = await seams.near.spoken?.enroll();
if (enrollment?.kind === 'enrolled') {
  console.log('template', enrollment.templateEpoch);
}
```

`enroll`は、VoiceIDの画面に短い文を3つ表示します。ウォレットにまだVoiceIDがない場合、`enroll`は先にVoiceIDを有効にします。そのVoiceID登録の3つのサンプルが、検証者の録音にもなります。そのため、所有者は両方のために文を1組だけ読みます。

その後、Walletは所有者に、パスキーでもう一度アンロックするよう求めます。声は支払いを承認する方法になるので、Seamsのサーバーは、このようなアンロックが過去120秒以内に発行したウォレットセッションがある場合だけ声を登録します。
VoiceIDのアンロックは同じ声をもう一度使うだけなので、数えません。Walletは、この登録の3つの録音だけを送ります。

Walletは、このアンロックをパスキーだけで求めます。パスキーのないウォレット(Email OTPだけでサインインするウォレットなど)は、まだSpeak-to-Signの声を登録できません。
アンロックが完了しない場合、`enroll`は理由`not_submitted`の`unavailable`を返し、検証者は何も登録しません。

新しい登録は以前のテンプレートを置き換えます。結果の`kind`は、`enrolled`、`refused`、`cancelled`、`unavailable`のいずれかです。検証者にテンプレートがない所有者の音声リクエストは、`template_missing`の`refused`になります。

既定では、所有者は各文で「録音」を押します。`enroll({ autoStart: true })`では、各文のカードは開いたときに録音を始めます。これはVoiceIDのあるウォレットに適用されます。`enroll`が先にVoiceIDを有効にする場合、VoiceIDのカードでは、これまでどおり各サンプルで「録音」を押します。

所有者がVoiceIDを無効にした場合、`enroll`は理由`voiceid_unavailable`の`unavailable`を返します。`seams.registration.setAuthMethodEnabled({ walletId, method: 'voiceid', enabled: true })`で再び有効にしてください。

送金ごとのガスは所有者のアカウントが支払います。テストネットでは約0.00005 NEARです。

### 音声による承認を無効にする {#turn-spoken-approval-off}

**認証方法**のVoiceIDのスイッチが、音声による承認を無効にします。VoiceIDが無効または未設定の場合、音声リクエストは理由`voiceid_unavailable`の`unavailable`を返し、アプリは確認画面を使います。

アプリに`spoken`の記述子がある場合、Walletは先に、Seamsのサーバーを通して検証者の所有者の声のテンプレートを削除します。所有者がVoiceIDを無効にしたときと、VoiceIDの方法を削除したときに行います。
Seamsの共同署名者は、デバイスのスイッチの状態に関係なく判定を受け入れます。そのため、検証者での音声による承認を止めるのは、この削除だけです。
削除が失敗した場合、VoiceIDは有効のままで、所有者はもう一度試せます。検証者のないレーンや別のバックエンドのレーンには削除するテンプレートがないため、変更はそのまま進みます。

## 音声によるコミュニティノート {#spoken-community-notes}

同じ流れで、コミュニティノートやノートの評価にも署名できます。ノートのコントラクトには
`add_note({ post_id, text, summary })` と
`rate_note({ note_id, rating })` が必要です。
作成者はノートを入力し、その短い要約だけを読み上げます。アプリが渡すのはノートだけで、要約は渡しません。

1. WalletはSeamsサーバーに要約を求めます(`POST /speak-to-sign/v1/summary`)。サーバーは、NEAR AIのチャットモデルでノートから要約を書きます。
2. カードは、ノートを要約の上に表示します。作成者は要約を話します。
3. 判定は、ノートをSHA-256で結び付けます。要約がノートの要点を述べているかを、SaySoは確認しません。作成者は、カードに表示され、自分で話す要約を承認します。

そのため、アプリは作成者が話す言葉を選べません。
Wallet coreが呼び出しを1件作り、デポジットも確認もなしで署名します。
SaySoの判定を確認するコントラクトはないため、ノート、評価、ベットの呼び出しは判定を運びません。
判定を運ぶこのような呼び出しは、共同署名者が拒否します。

```ts [部分的な実装例]
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
- 評価は「this note is helpful」「this note is somewhat helpful」「this note is not helpful」のどれかを話します。
- 要約または評価の文字起こしは、その言葉と完全に同じである必要があります。大文字と小文字、句読点、数の単語の代わりの数字は違っていてもかまいません。似た音の語の規則は送金だけに適用します。

### 音声リクエストの準備 {#prepare-a-spoken-request}

要約には0.5〜2秒かかり、Walletは最初のリクエストのためにSpeak-to-Signのコードを読み込みます。カードを早く表示するには、フォームが画面に出た時点で、所有者がボタンを押す前に`prepare`を呼びます。

```ts [部分的な実装例]
// ノートがフォームに入ったとき、そして本文が変わったときにもう一度。
void seams.near.spoken?.prepare({ note: { text: noteText } });
```

- WalletはSpeak-to-Signのコードを読み込み、VoiceIDの状態を読みます。`note`がある場合は、その本文の要約もSeamsサーバーに求めます。
- Walletは、ノートの本文ごとに1つの要約を5分間保持します。同じ本文の`spoken.note`の呼び出しは、新しいリクエストなしでその要約を表示します。ノートの2回目の試行でも同じ文が表示されます。
- `prepare`はカードを表示せず、録音も署名もしません。結果は`{ kind: 'ready' }`または`{ kind: 'unavailable', reason }`です。結果を使う必要はありません。後に続くリクエストが同じ手順を自分で行います。
- ノートのない`prepare()`は、送金、評価、ベットを準備します。
- アプリケーションは引き続き要約を渡しません。Seamsサーバーが`@seams/voice-sign/server`の`writeSummary`で要約を書き、Walletが`@seams/voice-sign/summary`の`createSummarySource`で保持します。Seams Walletを使わないアプリケーションも、この2つの部品を使えます。

## Walletホストの準備 {#prepare-the-wallet-host}

Speak-to-Signのために、Walletホストで行う専用の手順はありません。流れは`@seams/mpc-wallet`の中にあります。録音にはVoiceIDの画面を使うため、`walletOrigin`の運用者は`@seams/host`をインストールし、VoiceIDのホストと同じようにVoiceIDを構成します。

```sh
npx --no-install seams-voiceid-host ./wallet-with-voiceid
```

Walletは、SaySoの文字起こしを`/sdk/workers/spoken_intent_bg.wasm`で読みます。構成したアセットに含まれています。`/sdk/*`のほかのWASMファイルと同じように提供してください。

0.67.0までは、ホストにプラグイン`@seams/wallet-voice-sign`もインストールし、`seams-speak-to-sign-host`で構成していました。両方とも削除してください。

## Seamsサーバーの設定 {#configure-the-seams-server}

Seamsのサーバーは、レーンが検証者のバックエンドを指定した場合だけ`POST /speak-to-sign/v1/verify`を追加します。SaySoでは、レーンのGateway Workerに次が必要です。

| 設定                    | 値                                                                            |
| ----------------------- | ----------------------------------------------------------------------------- |
| `SPEAK_TO_SIGN_BACKEND` | `sayso`                                                                       |
| `SAYSO`                 | レーンのSaySo Workerへのサービスバインディング                                |
| `SAYSO_API_KEY`         | そのSaySo Workerの`SAYSO_API_KEY`です。シークレットストアに保管してください。 |

- `SPEAK_TO_SIGN_BACKEND`もバックエンドの設定もない場合、サーバーには検証のルートがありません。
- `SPEAK_TO_SIGN_BACKEND`のないバックエンドの設定があると、サーバーは起動時に停止します。レーンはバックエンドを指定する必要があります。鍵またはバインディングのない`sayso`、および`sayso`と`outlayer`以外の値でも停止します。
- レーンごとに専用のSaySoのデプロイを使ってください。1つのデプロイは、1つの判定の鍵と、その所有者の声のテンプレートを持ちます。
- SaySo Workerは`POST /v1/template/delete`を提供する必要があります。提供しない場合、削除は404になり、そのレーンではVoiceIDを無効にできません。

このルートは、呼び出し元のウォレットセッションを本人確認として読みます。セッションがない場合は401 `unauthorized`、
セッションストアが失敗した場合は503 `session_unavailable`を返し、署名の使用回数は消費しません。
本文は最大1,100 KBの`{ backend, input }`です。Wallet coreは、入力を作ったバックエンドを指定します。レーンのものと違うバックエンドは409 `backend_mismatch`になります。
別の所有者の声のリクエストは拒否します(403 `owner_mismatch`)。SaySoでは、操作`verify`、`enroll`、`delete`を扱います(ほかの操作は400 `unsupported_operation`)。
検証者を呼ぶ前の拒否はJSONのエラーです。

確認の後、ルートは`text/event-stream`で応答します。すぐに`verifier_running`イベントを送り、次に検証者の出力をそのまま含む`verdict`イベントか、固定のコードを含む`failed`イベントを1つ送ります。SaySoでは次のとおりです。

- ルートは`Authorization: Bearer SAYSO_API_KEY`でバインディングを呼び、最長20秒待ちます(`verifier_timeout`)。
- SaySoのインテントは、セッションの所有者から作ります。ユーザー`near:<network>:<accountId>`、アクション`seams.near.<kind>`、リクエストのダイジェスト、文です。
  インテントは文字起こしだけのものです。SaySoは話者と録音を確認して文字起こしに署名し、言葉はWalletと共同署名者が判断します。
- 登録には、パスキーまたはEmail OTPの承認が過去120秒以内に発行したウォレットセッションが必要です。VoiceIDのセッションは数えません。ほかのセッションは`fresh_approval_required`の`failed`になります。
- SaySoのエラーの本文は、応答にもログにも出ません。ステータスが固定のコードになります: `verifier_unauthorized`、`verifier_busy`、`verifier_rejected_request`、`verifier_failed`、`verifier_unreachable`。
- `verdict`には`attestationUrl: null`、`transcriber`(`workers_ai_whisper_large_v3_turbo`)、`saysoMs`と`serverMs`を含む`timing`があります。

ルート`POST /speak-to-sign/v1/summary`は、音声によるコミュニティノートの要約を書きます。サーバーがこのルートを追加するのは、検証者のバックエンドと、NEAR AIの鍵`SPEAK_TO_SIGN_NEAR_AI_API_KEY`があるときだけです。鍵はシークレットストアに保管してください。
`SPEAK_TO_SIGN_SUMMARY_MODEL`は任意で、既定は`Qwen/Qwen3.8-27B`です。ルートはこのモデルを思考なしで呼びます。ルートは、verifyのルートと同じくウォレットセッションを読みます。
`{ text }`(1〜280文字)を受け取り、`{ ok: true, summary }`を返します。モデルが要約の規則を破った場合は、もう一度だけ尋ねます。
失敗は固定のコードを含むJSONのエラーです:`summary_unreachable`、`summary_failed`、`summary_not_speakable`。鍵がないと、Walletは音声によるノートに署名できません。

同じバックエンドの設定で、共同署名者による判定の確認も有効になります。共同署名者は、レーンのバックエンドの判定の種類だけを受け入れます。SaySoでは`sayso_verdict_v1`です。
共同署名者は、受け入れた判定を署名者データベースのテーブル`speak_to_sign_voice_verdicts`(署名用D1マイグレーションが作るテーブル)に記録します。
新しい記録を追加するたびに、そのウォレットの期限切れの判定の記録を削除します。サーバーのログには、拒否のたびに理由、ウォレット、署名のリクエストを含む警告が1行出ます。
バックエンドのないSeamsのサーバーは、判定を含む署名のリクエストをすべて理由`unavailable`で拒否します。

### OutLayerのバックエンド {#the-outlayer-backend}

資金の提供が止まったため、OutLayerを動かすレーンはありません。コードは`@seams/host`に残り、`SPEAK_TO_SIGN_BACKEND=outlayer`と6つの`SPEAK_TO_SIGN_OUTLAYER_*`変数で有効になります。
ただし、このリリースのWalletはSaySoの入力を作るため、そのようなサーバーはすべての検証のリクエストに409 `backend_mismatch`で応答します。
OutLayerの変数があり`SPEAK_TO_SIGN_BACKEND`がないサーバーは、起動時に停止します。変数を削除するか、バックエンドを設定してください。
OutLayerの変数とTDXクォートの確認は、[この節の0.76.0の文書](https://github.com/seams-tech/seams-wallet/blob/7123e190b/apps/docs/src/ja/concepts/auth-methods/speak-to-sign.md#configure-the-seams-server)にあります。

## 検証者の鍵 {#the-verifier-key}

各SaySoのデプロイは、専用のEd25519の鍵で判定に署名します。秘密鍵は、運用者のCloudflareアカウントにある、そのデプロイのWorkerのシークレットです。
同じアカウントが、Seamsのサーバーと共同署名者も動かしています。

Walletと共同署名者は、公開鍵を自身のコードに固定します。アプリがSeamsのサーバーのURLを選ぶため、鍵をアプリから受け取ることはありません。
新しい鍵を古い鍵より先に追加できるように、ネットワークごとに鍵の一覧があります。

| ネットワーク | 固定したSaySoの鍵                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `testnet`    | `3d96c3d21be6b7864cadfe1d5e57366e45774d7513972710e2569aa33a0d6895`(`staging-testnet`のデプロイ) |
| `mainnet`    | なし。メインネットのリクエストには検証者がありません。                                          |

Walletと共同署名者は、リリース(`sayso/x.y.z`)以外のSaySoのビルド(モックのビルドなど)の判定も拒否します。
Walletは、1つの流れで最大1回だけ、同じ流れで録音した音声に対してだけ支払います。

## 信頼モデル {#trust-model}

- Walletは、固定した鍵がこのリクエスト(ネットワーク、所有者、リクエストのダイジェスト、この流れの録音、期限)に署名した判定の後でだけ署名します。
  判定の文字起こしは、リクエストの言葉と完全に同じである必要があります。ウォレットセッションとSeamsの共同署名者は、すべての署名に引き続き参加します。
- 声は、パスキーのステップアップが承認するものを承認します。Walletと共同署名者は声に金額の上限を設けず、SaySoにはポリシーの手順がありません。
  音声リクエストの上限は、通常の署名と同じく、Walletのポリシーのルールです。
- Seamsの共同署名者は、署名の自分の部分を加える前に判定をもう一度確認します。確認するのは、判定を含む署名のリクエストだけです。
  通常の署名のリクエストは判定を含まず、共同署名者はこれまでどおりに扱います。共同署名者は次の項目を確認します。
  - 署名。同じ固定したSaySoの鍵で確認し、リリースのビルドであることも確認します。
  - 期限。SaySoの署名から最長120秒です。
  - リクエスト。共同署名者は、署名を求められた未署名の取引またはメッセージを読み、リクエストを作り直します。送金先と金額を持つ1つの送金、型付きの種類の1つの呼び出し、
    または話した要約を持つ取引全体かメッセージです。作り直したリクエストのインテントは、判定のインテントのダイジェストになる必要があります。
  - 言葉。共同署名者は、リクエストの送金先だけを連絡先として、`spoken-intent`で文字起こしを読みます。リクエストの言葉と完全に同じである必要があります。
  - 運ばれる判定がないこと。ノート、評価、ベットの呼び出しは、コントラクトに判定を運んではいけません。
  - 所有者。取引の署名者は、ウォレットセッションのNEARアカウントである必要があります。
  - 1回だけの使用。共同署名者は受け入れた各判定を記録し、別の署名のリクエストでは拒否します。
- 共同署名者の確認は、WalletのSpeak-to-Signの経路の障害から守り、1回だけの使用をサーバーで保ちます。
  判定を省く`walletOrigin`のコードは止めません。そのようなコードは、開いているウォレットセッションですでに署名できるためです。
- SaySoにはTEEもアテステーションもありません。Walletと共同署名者は、運用者のCloudflareの基盤(SaySo Worker、Workers AI、話者のコンテナー)を信頼します。
  判定の鍵は共同署名者と同じCloudflareアカウントにあります。そのため、共同署名者の確認は、運用者や、そのアカウントのデプロイ用トークンを持つ人からは守りません。
- 文字起こしはWorkers AIが作り、SaySoはそのまま署名します。文字起こし自体には署名がないため、SaySoはWorkers AIを信頼します。
- `walletOrigin`のコードは、所有者が話した後にリクエストを変更できません。変更するとリクエストのダイジェストが一致しなくなります。
- 任意の名前付きアカウントが音声による支払いを受け取れます。声の確認が所有者の声の複製または再生を受け入れた場合、
  支払いは任意の名前付きアカウントに任意の金額で送られる可能性があります。SaySoは以前に見た録音を拒否します。音声による承認を止めるには、VoiceIDを無効にしてください。
- Walletと共同署名者は、リクエストの送金先に似た音の名前を受け入れます。音のキーが同じ名前と、最初の2文字が同じで音が1つだけ異なるキーの名前です(`alice.testnet`に対する`alicia.testnet`など)。
  区切りとネットワークの接尾辞のない名前も受け入れます。そのため、声では`bob.testnet`と`bobb.testnet`、`bob-1.testnet`と`bob1.testnet`のような2つのアカウントを区別できません。所有者は、話す前にカードのアカウントを読んでください。

## 音声と検証者が保存するもの {#the-audio-and-what-the-verifier-keeps}

[VoiceID](/ja/concepts/auth-methods/voiceid)のアンロックと異なり、音声はブラウザーの外に送られます。

- Walletは各録音をWAVとしてSeamsのサーバーに送り、サーバーはレーンのSaySo Workerに渡します。
- SaySoは、文字起こしのためにCloudflare Workers AIのWhisper large-v3-turboに、声の確認のために話者のコンテナー(Cloudflare ContainerのReDimNet B1)に録音を送ります。
- 最初の文字起こしが遅い場合または失敗した場合、SaySoは同じ録音をWorkers AIにもう一度送ることがあります。最初の答えを使います。
- これらのサービスは、運用者のCloudflareアカウントで動作します。音声がCloudflareの外のサービスに送られることはありません。

SaySoは録音も文字起こしも保存しません。所有者ごとに次のものを保存します。

- 声のテンプレート。登録の3つの録音から作った話者埋め込みで、音声ではありません。新しい登録が置き換えます。
- 確認した各録音のSHA-256のダイジェスト。録音を1回だけ数えるために、7日間保存します。
- 所有者の最近のリクエストの時刻。レート制限のためです。

判定は文字起こしを含み、Walletと共同署名者がそれを読みます。共同署名者は、受け入れた各判定のIDをウォレットと署名のリクエストと一緒に記録しますが、文字起こしは記録しません。

声のテンプレートを削除するには、所有者がVoiceIDを無効にするか、削除します([音声による承認を無効にする](#turn-spoken-approval-off)を参照)。
使用済みの録音のダイジェストは、7日間が終わるまで残ります。そのため、録音は引き続き1回だけ数えます。

次に読むページ:

- [VoiceID](/ja/concepts/auth-methods/voiceid)
- [Wallet iframe](/ja/concepts/custody/wallet-iframe)

---
title: '実験的機能: Speak-to-Sign'
description: 証明付きの検証者が所有者の声と言葉を確認した後でだけ、ボールトのコントラクトが支払う、実験的な音声によるNEARの支払いです。テストネット専用です。
---

# 実験的機能: Speak-to-Sign {#experimental-speak-to-sign}

::: warning 実験的機能
Speak-to-Signは実験的機能です。**NEARテストネットだけ**で動作します。リリース0.54.0が最初のリリースで、0.56.0で`enroll`を追加しました。
パッケージ、ルート、コントラクトは予告なく変わることがあります。実際の資金では使わないでください。
:::

Speak-to-Signでは、ウォレットの所有者が声で支払えます。所有者は「Send 2 NEAR to alice dot testnet」のような文を話します。
証明付きの検証者が、所有者の声でリクエストと同じ文が話されたことを確認した後でだけ、NEAR上のボールトのコントラクトが支払います。

Speak-to-Signは取引機能であり、認証方法ではありません。ウォレットのアンロックやセッションの開始には使いません。
[VoiceID](/ja/concepts/auth-methods/voiceid)の登録が必要で、VoiceIDの録音画面を使います。

## 音声による支払いの流れ {#how-a-spoken-payment-works}

1. Walletがボールトを読み取ります。次のノンス、連絡先、固定された検証者の鍵です。
2. WalletがVoiceIDの画面に話すべき文を表示し、最長8秒の音声を1回録音します。
3. Seamsのサーバーが、録音をOutLayer上の検証者に送ります。OutLayerは、TEE(信頼できる実行環境)でコードを実行するNEARのオフチェーン計算サービスです。
4. 検証者は、Phala Cloud上のサービスから話者埋め込みを、NEAR AIから文字起こしを同時に受け取ります。
   声は所有者が登録したテンプレートと、言葉は検証者自身が作ったリクエストの文と比較します。
5. 検証者が署名付きの判定を返します。Walletは、ボールトが固定した鍵で署名を確認します。
6. Walletが`transfer_with_verdict`を1回呼び出します。ボールトは自身の状態からリクエストを作り直し、判定、ノンス、連絡先、上限、音声の再利用を確認してから支払います。

テストネットでは、発話の終わりからボールトの受理まで8.7秒でした。この時間は参照用クライアントの測定であり、Walletでの測定ではありません。

## インストール {#install}

3つのパッケージを同じバージョンでインストールします。

```sh
pnpm add @seams/wallet@0.56.0 @seams/voiceid@0.56.0 @seams/speak-to-sign@0.56.0
```

VoiceIDの認証方法と一緒に、記述子を`transactionFeatures`に追加します。

```ts [部分的な実装例]
import { SeamsWeb } from '@seams/wallet';
import { voiceIdAuthMethod } from '@seams/voiceid';
import { speakToSign } from '@seams/speak-to-sign';

const seams = new SeamsWeb({
  // ...the rest of your configuration
  authMethods: [voiceIdAuthMethod()],
  transactionFeatures: [speakToSign({ vault: 'seams-wallet.testnet', network: 'testnet' })],
});

if (seams.speakToSign) {
  const result = await seams.speakToSign.requestTransfer({
    walletId,
    receiver: 'alice.testnet',
    amount: '2',
  });
}
```

`seams.speakToSign`は、設定に記述子がある場合だけ存在します。送金先は、ボールトの有効な連絡先である必要があります。
金額は小数点以下2桁までのNEARの10進数です。結果の`kind`は、`sent`、`refused`、`cancelled`、`unavailable`のいずれかです。
`requestTransfer`と`enroll`は、同じ`unavailable`の理由を使います。

| `unavailable`の理由    | 意味                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `owner_not_speakable`  | 所有者のアカウントが暗黙的アカウントか`0x`アカウントです。録音も送信もしていません。   |
| `voiceid_unavailable`  | ウォレットでVoiceIDが有効でないか、録音できませんでした。                              |
| `vault_missing`        | 所有者のボールトがまだありません。                                                     |
| `verifier_unavailable` | ボールトの読み取りかSeamsの検証ルートが、有効な応答を返しませんでした。                |
| `not_submitted`        | Walletはボールトのトランザクションを送信していません。支払いはありません。             |
| `submission_unknown`   | ボールトのトランザクションが送信された可能性があります。再試行の前に確認してください。 |

記述子を設定しないアプリは、Speak-to-Signのコード、WASM、アセットを一切ダウンロードしません。
記述子を設定したアプリも、音声による支払いを始めるまでは何も追加で読み込みません。

## 所有者の準備 {#set-up-the-owner}

### 所有者には名前付きのNEARアカウントが必要です {#the-owner-needs-a-named-near-account}

所有者には、`alice.testnet`のような名前付きのNEARアカウントが必要です。
暗黙的アカウント(64文字の16進数)と`0x`で始まるアカウントでは、Speak-to-Signを使えません。
所有者のアカウントは音声によるリクエストの一部として読み上げられるため、ボールトのコントラクトは、
言葉で読み上げられるアカウントにだけボールトを作成します。読み上げられるアカウントは全体が2〜64文字で、
`.`で区切った各部分は`a-z`と`0-9`からなり、英数字の間に`-`か`_`を1つずつ置けます。
暗黙的アカウントでは、`create_vault`は所有者がガス代を支払った後で失敗します。

新しいウォレットに名前付きのアカウントを持たせるには、リレーヤーのアカウントの名前付きサブアカウントとして登録します。
たとえば、`alice`は`alice.<relayerAccount>`になります([リレーヤーの設定](/ja/reference/configuration#relayer-branch)を参照)。

- SDKの設定では、
  `registration: { nearAccountProvisioning: { kind: 'relayer_named_subaccount' } }`を指定します。
- `HostedSeamsAuthMenu`では、`registrationAccountInput: 'sponsored_named_near_account'`を指定します。

読み上げられないアカウントの所有者に対して、`enroll`と`requestTransfer`は
`{ kind: 'unavailable', reason: 'owner_not_speakable' }`を返します。
録音、ボールトの読み取り、検証者の呼び出し、トランザクションのどれよりも前に返します。

### 所有者の準備の手順 {#owner-setup-steps}

最初の音声による支払いの前に、所有者には次のものが必要です。

1. ウォレットでVoiceIDが有効であること:
   `seams.registration.activateAuthMethod({ walletId, method: 'voiceid' })`。
2. 有効な連絡先が1つ以上あるボールト。所有者は入金付きで`create_vault`を呼び出し(ボールトは保管用に0.1 NEARを保持します)、
   `add_contact`を呼び出します。たとえば`seams.near.signAndSendTransaction`を使います。
3. 検証者での声のテンプレート:

```ts [部分的な実装例]
const enrollment = await seams.speakToSign.enroll({ walletId });
if (enrollment.kind === 'enrolled') {
  console.log('template', enrollment.templateEpoch, 'tx', enrollment.transactionHash);
}
```

`enroll`は、VoiceIDの画面に短い文を3つ表示します。その後、所有者は、これらの録音だけのダイジェストに対する
`authorize_enrollment`の呼び出しを1回承認します。検証者は、ボールトが10分間許可した音声だけを登録します。
新しい登録は以前のテンプレートを置き換えます。結果の`kind`は、`enrolled`、`refused`、`cancelled`、`unavailable`のいずれかです。

ボールトと連絡先は、ボールトのコントラクトに対する所有者の2回の呼び出しで作成します。
たとえば`useSeams()`の`wallet.near`を使います。各呼び出しでウォレットの確認画面が開きます。

```ts [部分的な実装例]
import { functionCall, type BoundNearSigner } from '@seams/wallet/react';

const VAULT = 'seams-wallet.testnet';
const GAS = '30000000000000';

async function setUpVault(near: BoundNearSigner, contact: string): Promise<void> {
  // 0.15 NEAR: ボールトは保管用に0.1 NEARを保持します。
  await near.signAndSendTransaction({
    receiverId: VAULT,
    actions: [
      functionCall({
        method: 'create_vault',
        args: {},
        gas: GAS,
        deposit: '150000000000000000000000',
      }),
    ],
  });
  await near.signAndSendTransaction({
    receiverId: VAULT,
    actions: [
      functionCall({
        method: 'add_contact',
        args: { account_id: contact },
        gas: GAS,
        deposit: '0',
      }),
    ],
  });
}
```

テストネットでは、所有者のアカウントに約0.3 NEARが必要です。`create_vault`は0.15 NEARを使い、
NEARは前払いのガスを先に請求します。30 Tgasの呼び出しごとに約0.03 NEAR、音声による支払いごとに0.051 NEARです。

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
| `SPEAK_TO_SIGN_OUTLAYER_VERSION_KEY`        | `1e79327b0afa2a0f026aee519bd0d1801272e21cb21205d31788e4d1452231f0` |
| `SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY`        | OutLayerの支払い用の鍵です。シークレットストアに保管してください。 |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_PROFILE`    | `main`                                                             |
| `SPEAK_TO_SIGN_OUTLAYER_SECRETS_ACCOUNT_ID` | `cyan-loong.testnet`                                               |

このルートは、呼び出し元のウォレットセッションを本人確認として読みます。セッションがない場合は401 `unauthorized`、
セッションストアが失敗した場合は503 `session_unavailable`を返し、署名の使用回数は消費しません。
別の所有者の声のリクエストは拒否します。検証者の`verify`と`enroll`の両方の操作を扱い、本文は最大1,100 KBです。
検証者の出力は変更せずに返します。

## ボールトのコントラクト {#the-vault-contract}

テストネットのボールトは`seams-wallet.testnet`です。初期化時に検証者の鍵
`ed25519:E8E53ydtc9LRvVz9xBCRrSzyBa5nh1gK1ts53Aoo751U`を固定しました。

| メソッド                 | 用途                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| `create_vault`           | 添付した入金で所有者のボールトを作成します(0.1 NEARは保管用に残ります)。 |
| `add_contact`            | 音声による支払いの宛先にできる連絡先(`account_id`)を追加します。         |
| `transfer_with_verdict`  | 固定された鍵が署名した判定に基づき、有効な連絡先に支払います。           |
| `authorize_enrollment`   | 所有者が、これらの録音だけによる登録を10分間に1回だけ許可します。        |
| `get_pending_enrollment` | 検証者が読む、所有者の有効な登録の許可です。                             |
| `get_vault`              | 所有者の残高、上限、次のノンスです。                                     |
| `get_contacts`           | 所有者の連絡先と、それぞれが有効かどうかです。                           |
| `get_verifier`           | 固定された検証者の鍵です。                                               |

新しい連絡先は、ボールトが初期化時に設定した待ち時間の後に有効になります。所有者は、10分待てば声なしで引き出せます。

## 信頼モデル {#trust-model}

- ボールトは、固定された鍵がこのリクエスト(ネットワーク、ボールト、所有者、送金先、金額、ノンス)に署名した判定でだけ支払います。
- 検証者はOutLayerのTEEで動作します。OutLayerのプロジェクトの所有者は、同じ鍵で署名する新しいバージョンをデプロイできます。
- 話者の確認は、鍵を固定したPhalaのdstack CVMで動作します。Phalaのアプリの所有者は、その鍵を保ったままコードを変更できます。
- 文字起こしはNEAR AIが作ります。文字起こしには署名がないため、検証者はNEAR AIのゲートウェイを信頼します。
- `walletOrigin`のコードは、所有者が話した後にリクエストを変更できません。変更すると言葉が一致しなくなります。

[VoiceID](/ja/concepts/auth-methods/voiceid)のアンロックと異なり、音声はブラウザーの外に送られます。
音声はOutLayer、Phala、NEAR AIに送られ、声のテンプレートはOutLayerのストレージに保存されます。

次に読むページ:

- [VoiceID](/ja/concepts/auth-methods/voiceid)
- [Wallet iframe](/ja/concepts/custody/wallet-iframe)

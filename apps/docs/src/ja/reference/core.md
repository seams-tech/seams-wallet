---
title: ブラウザーSDKの基本API
description: メインの@seams/walletエントリーポイントが公開するクラス、機能、ビルダー、結果の型。
---

# ブラウザーSDKの基本API {#core-browser-sdk}

フレームワークに依存しないブラウザーAPIを、`@seams/wallet`からインポートします。

```ts [インポート例]
import { SeamsWeb, type SeamsConfigsInput } from '@seams/wallet';
```

## 主なAPI {#primary-surface}

`SeamsWeb`はブラウザークライアントです。メソッドは機能別に分かれています。

| 機能           | 役割                                                                  |
| -------------- | --------------------------------------------------------------------- |
| `connection`   | 接続、準備状態の監視、クライアントの破棄。                            |
| `events`       | SDKのライフサイクルイベントの購読。                                   |
| `authMenu`     | ホストする認証UIのコード準備、表示、キャンセル、外部認証の提供。      |
| `config`       | 表示設定の更新と、設定済みチェーン対象の選択。                        |
| `registration` | ウォレット登録、署名機能の追加、NEARのプロビジョニング待機。          |
| `auth`         | ウォレットセッションのアンロック、ロック、復元、確認。                |
| `near`         | NEARトランザクション、委任アクション、NEP-413メッセージの署名と送信。 |
| `evm`          | 設定済みEVMチェーンでのEIP-1559トランザクションの署名と実行。         |
| `tempo`        | EIP-2718 Tempoトランザクションの署名と実行、手数料トークンの管理。    |
| `recovery`     | 復元の設定、アカウント状態の同期、復元素材のローテーション。          |
| `devices`      | デバイス連携フローの開始、承認、確認。                                |
| `keys`         | 新たな承認を伴うエクスポート処理。                                    |
| `placement`    | ウォレットのリージョンの取得と、所有者が選ぶリージョンへの移動。      |

`evm`と`tempo`は、どちらも`signTransaction`、`signAndSendTransaction`、ブロードキャスト後の報告用`advanced`を提供します。
トランザクション形式は異なります。TempoはEIP-2718を使い、署名結果に`senderHashHex`を返します。
EVMはEIP-1559を使い、`txHashHex`を返します。

設定の呼び出しは、共通の名前空間を使います。

```ts [部分的な実装例]
seams.config.setTheme('dark');
seams.config.setAppearance({ theme: { id: 'brand', mode: 'light' } });
const target = seams.config.chainTarget('tempo-testnet');
const targets = seams.config.configuredChainTargets();
```

接続状態と認証状態は独立しています。接続前に購読してください。

```ts [部分的な実装例]
const stop = seams.connection.onChange((state) => {
  if (state.kind === 'failed') console.error(state.error);
});
await seams.connection.connect();
const ready = seams.connection.getState().kind === 'ready';
// When the client owner releases this instance:
stop();
seams.connection.dispose();
```

`onChange`は、現在のスナップショットを直ちに通知します。
状態は`idle`、`connecting`、`ready`、`failed`、`disposed`です。
準備完了には、セッションと設定の初期照合を含みます。同時の呼び出しは、1回の接続試行を共有します。
失敗した試行を再実行するには、`connect`を呼びます。
破棄は最終状態で、クライアントのリソースを解放します。ウォレットのロックや永続的な事前署名の削除は行いません。

## 対象ウォレットとチェーンの指定 {#naming-the-subject-and-the-chain}

各操作は、承認対象のウォレットを指定します。EVM系の呼び出しでは、対象チェーンも指定します。

- `walletSession`を省略すると、**認証済み**ウォレットを特定します。複数のウォレットを管理するアプリでは、`WalletSessionRef`またはウォレットIDで対象を明示してください。
- `nearAccount`を省略すると、NEARの呼び出しは認証済みウォレットのアカウントを特定します。アカウントIDだけを渡すこともできます。
- `chainTarget`は、`'tempo-testnet'`など設定済みネットワークのスラッグを受け取ります。EVM系の署名とエクスポートには必須です。一致する設定は1つである必要があります。曖昧な選択子は、一致した対象を示すエラーを送出します。

正確な参照を作るビルダー（`walletSessionRefFromSession`、`nearAccountRefFromAccountId`、`thresholdEcdsaChainTargetFromConfig`）は、
このエントリーポイントと`@seams/wallet/react`から公開されます。

## 公開する値と型 {#public-values-and-types}

メインのエントリーポイントには、次のものを含みます。

- `SeamsWeb`、`PASSKEY_MANAGER_DEFAULT_CONFIGS`、`buildConfigsFromEnv`。
- アプリに必要な値を受け取り、残りに既定値を設定する`defineSeamsConfig`と`seamsTestnetConfig`。
- 境界で使う参照ビルダーと、その型（`WalletSessionRef`、`NearAccountRef`、`ThresholdEcdsaChainTarget`、`WalletId`）。
- アクションビルダー：`functionCall`、`transfer`、`stake`、`addKey`、`deleteKey`、`deleteAccount`、`createAccount`、`deployContract`。
- 金額：`transfer`は`NearAmount`を受け取ります。例は`'1 NEAR'`、`'1000 yoctoNEAR'`、`parseNear('1')`または`yoctoNear('…')`が返す`YoctoNear`です。`parseEther('0.5')`はEVMの`value`用にweiを返します。その他のトークンの小数桁数には`parseUnits(amount, decimals)`を使います。これらはすべて`AmountError`を送出する場合があります。
- そのまま使える`onEvent`ハンドラーの`logWalletEvents`。
- 登録意図と署名機能の選択に関する型。
- `RegistrationResult`、`LoginResult`、`LoginAndCreateSessionResult`、`WalletSession`、`ActionResult`。
- `toAccountId`、`ActionType`などのアカウント・アクションの型。
- ウォレットフローのイベントコンストラクター、フェーズ、イベントユニオン。
- GoogleとメールOTPによるウォレット認証フローの型。
- デバイス連携とNEP-413の結果の型。
- ウォレットのリージョンに関する型（`WalletPlacementCapability`、`WalletRegion`、`WalletMoveRequest`、`WalletPlacement`、`WalletPlacementResult`、`WalletMoveStatus`、`WalletMoveStatusResult`、`WalletMoveId`）と`parseWalletMoveId`。
- ホストする認証メニューのリクエストビルダーと、境界で安全に扱えるメッセージの型。

## セッションの呼び出し {#session-calls}

```ts [部分的な実装例]
await seams.auth.unlock(walletId);
const session = await seams.auth.getSession();
const hasPasskey = await seams.auth.hasPasskey(walletId);
const recent = await seams.auth.getRecentUnlocks();
const unsubscribe = seams.auth.onSessionChange(renderSession);
await seams.auth.lock();
```

ロックは署名権限を終了し、揮発性の素材を消去します。
後の承認済みアンロックに使える、有効な保存済み事前署名は保持します。
Reactの`useWalletAuth()`とコンテキストも、`getSession`を公開します。

`onSessionChange`は、認証、識別情報、機能の状態を含む完全な`WalletSession`を受け取ります。
`connection.connect()`の前後どちらでも購読できます。
接続すると現在の照合済み状態を通知し、その後の観測結果も通知します。同じ状態を繰り返し通知する場合があります。
購読自体は接続を開きません。購読は再接続後も存続します。
通知を止めるには、購読解除またはクライアントの破棄を行ってください。接続の失敗には`connection.onChange`を使います。

## ウォレットのリージョン {#wallet-region}

リージョン別のデプロイでは、ウォレットごとに1つのホームリージョンを持ちます。
`seams.placement`は、そのリージョンを取得し、所有者が選ぶリージョンへウォレットを移動します。
移動を開始できるのは所有者だけです。デプロイ環境が移動先リージョンを提供する必要があります。

| 呼び出し                       | 目的                                                 |
| ------------------------------ | ---------------------------------------------------- |
| `get(walletId)`                | 現在のリージョン、または進行中の移動を取得。         |
| `move(request)`                | 移動の開始、または同じ移動の再開。                   |
| `getMove(walletId, moveId)`    | 指定した移動の進行状況を取得。                       |
| `getLastMoveRequest(walletId)` | このブラウザーが最後に送信した移動リクエストを取得。 |

```ts [部分的な実装例]
import { parseWalletMoveId, toWalletId } from '@seams/wallet';
import { base64UrlEncode } from '@seams/wallet/advanced';

const id = toWalletId(walletId);
const current = await seams.placement.get(id);
if (!current.ok || current.placement.state !== 'settled') return;

const random = crypto.getRandomValues(new Uint8Array(32));
const moved = await seams.placement.move({
  walletId: id,
  moveId: parseWalletMoveId(`wmove_${base64UrlEncode(random)}`),
  destinationRegion: 'WEUR',
  expectedGeneration: current.placement.generation,
});
if (moved.ok && moved.status.state === 'moving') {
  const progress = await seams.placement.getMove(id, moved.status.move.moveId);
}
```

### 配置を取得する {#read-placement}

`get`と`getMove`には、アンロック済みウォレットが必要です。ロック中はリクエストを送信しません。
`get`は`WalletPlacementResult`を返します。`ok: true`の場合は、`placement.state`を確認してください。

- `settled`は、`region`、`generation`、`nextMoveAtMs`を含みます。`WalletRegion`は`'US'`、`'WEUR'`、`'APAC'`、`'OC'`です。
- `moving`は`move`を含みます。その内容は、`moveId`、移動元と移動先のリージョンと世代、`admittedAtMs`、`nextMoveAtMs`、`progress`です。
- `unavailable`は、`not_found`または`wallet_not_established`のコードを含みます。

`ok: false`の場合は、`code`を確認してください。`move`と`getMove`も同じコードを返します。

| コード                   | 意味                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| `wallet_unlock_required` | ウォレットがアンロックされていないか、呼び出し中にセッションが変わった。 |
| `unauthorized`           | サービスが、このセッションの認証情報を拒否した。                         |
| `transport_unavailable`  | リクエストが失敗したか、サービスにこのリクエストの結果がない。           |
| `invalid_response`       | 応答が、リクエストまたは期待する形式に一致しない。                       |

### ウォレットを移動する {#move-the-wallet}

`move`は`WalletMoveRequest`を受け取ります。

- `moveId`は、`wmove_`に続く43文字のbase64urlで、32バイトの乱数を符号化します。新しい移動ごとに1つのIDを作成してください。不正なIDを渡すと、`parseWalletMoveId`は例外を送出します。
- `destinationRegion`は、現在のリージョンと異なる必要があります。
- `expectedGeneration`は、`settled`の配置の`generation`です。

直接のユーザー操作から`move`を呼んでください。
新しい移動では、ウォレットフレームが所有者に新たなパスキーまたはメールコードによる承認を求めます。
アプリは、この証明を受け取りません。`settled.nextMoveAtMs`は、新しい移動を開始できる最も早い時刻です。

`move`と`getMove`は、`WalletMoveStatusResult`を返します。
`ok: true`の場合は、`status.state`を確認してください。

- `moving`は、配置の`moving`と同じ形式です。
- `completed`は、`moveId`、移動元と移動先のリージョンと世代、`admittedAtMs`、`completedAtMs`を含みます。

`moving`の結果では、`progress`が段階とウォレットの利用可否を示します。

| `progress.state`                                | `availability` | ウォレットへの書き込み           |
| ----------------------------------------------- | -------------- | -------------------------------- |
| `freezing`、`copying`、`verified`、`activating` | `paused`       | すべてのデバイスで停止。         |
| `cleanup`                                       | `active`       | 新たにアンロックすると利用可能。 |

`progress.execution.state`は、`ready`、`running`、`retry_wait`、`blocked`です。
`retry_wait`は`retryAtMs`を含み、サービス自身がその段階を再試行します。
`blocked`は、移動にサービス側の復旧が必要な状態です。ウォレットのデータは保持されます。

受理された移動はキャンセルできません。
ユーザーがウォレットをロックしたり、ページを閉じたりしても、サービス側で移動を継続します。
所有者が承認をキャンセルした場合などに、`move`のPromiseが拒否されることもあります。
失敗コードやPromiseの拒否だけでは、サービスが移動を受理しなかったとは判断できません。
同じリクエストを再送するか、`getMove`で確認してください。
受理済みのリクエストは、再承認なしで進行状況を返します。結果が不明な場合は、新しい`moveId`を作成しないでください。

`getLastMoveRequest`は、保存済みの`WalletMoveRequest`または`null`を返します。
アンロックもサービスへの接続も不要なため、ロック後や再読み込み後にも使えます。
サービスによる移動の受理を示すものではありません。

### 移動中と移動後 {#during-and-after-a-move}

`availability`が`paused`の間は、すべてのデバイスで、そのウォレットの署名、エクスポート、復元、認証方法の変更、デバイスの変更が失敗します。
これらの操作を無効にし、現在の段階を表示してください。`getMove`をポーリングして進行状況を取得します。
ロックは引き続き使えます。

移動は、すべてのデバイスのウォレット署名セッションを終了します。移動後は、次の手順に従ってください。

1. `wallet_unlock_required`を想定してください。移動先リージョンが有効になったことを検知すると、ウォレットフレームが古いセッションをロックします。
2. ユーザー操作から`seams.auth.unlock(walletId)`を呼び、再度アンロックしてください。各デバイスで、署名前にこの操作が必要です。
3. `getMove`または`get`を再取得してください。`cleanup`かつ`active`なら署名できます。新たな移動は、`get`が`settled`を返すまで待つ必要があります。

移動しても、ウォレットID、署名鍵、認証方法、リンク済みデバイス、復元設定は変わりません。
Reactの`WalletSettingsPage`は、[ウォレットのリージョン設定](/ja/reference/react#components)としてこのフローを提供します。

## 接続と準備 {#connection-and-preparation}

Reactプロバイダーは、マウント時にウォレットフレームへ接続します。
クライアントを直接管理するアプリは、操作前に`await seams.connection.connect()`を呼べます。
ウォレットオリジンにウォレットが保存されていない場合、接続時の読み取りは起動コードを使います。
ウォレットランタイムの読み込みやデータベースの作成は行いません。各操作が必要なリソースを読み込みます。
`authMenu.prepare()`は、サインイン用コードのダウンロードを早めに開始し、例外を送出しません。
クリック後にメニューをマウントする場合は、ポインター操作、フォーカス、タッチの時点で呼んでください。
マウント済みのホストメニューは、自身でダウンロードを開始します。

コードの準備は、ウォレットの予約やパスキーのチャレンジの作成を行いません。
ホストする登録画面が、開いている間に登録の準備を実行します。
独立した公開の登録準備ハンドルや、プロバイダーの`eager`フラグはありません。

## ライフサイクルの規則 {#lifecycle-rule}

登録やログインの成功結果の`walletId`を保持してください。後の操作に使う安定した識別子です。
署名呼び出しは、認証済みウォレットを自動的に特定します。
複数のウォレットを管理する場合は、対象を明示してください。
各公開結果の`kind`や`success`などの判別子を確認し、すべての結果分岐を処理してください。

[結果と対処可能なエラー](/ja/reference/results-and-errors)、または[最初の署名ガイド](/ja/getting-started/sign-with-policy)へ進んでください。

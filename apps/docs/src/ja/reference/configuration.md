---
title: 設定
description: Seams SDKの明確な設定分岐で、ホストするウォレットの分離、登録、リレー、チェーン、表示を設定します。
---

# 設定 {#configuration}

アプリの境界で`defineSeamsConfig`を使って設定を構築します。
NEARとTempoのテストネットには、`seamsTestnetConfig`を使います。
どちらもウォレットの開始に必要な値を必須とし、残りには既定値を設定します。
型は、次の必須値の指定を要求します。

```ts [部分的な実装例]
import { seamsTestnetConfig } from '@seams/wallet/react';

const config = seamsTestnetConfig({
  walletOrigin: import.meta.env.VITE_WALLET_ORIGIN,
  relayerUrl: import.meta.env.VITE_RELAYER_URL,
  publishableKey: import.meta.env.VITE_SEAMS_PUBLISHABLE_KEY,
});
```

独自にオブジェクトを作成する場合は、`SeamsConfigsInput`を使えます。すべてのフィールドは任意です。
独自ランタイムの部分設定が必要な場合を除き、ヘルパーを優先してください。

## 外部NEARウォレットの選択 {#external-near-wallet-selection}

開発プレビューの外部NEARコネクターは、専用の`ExternalNearConfig`を使用します。
`network`、`rpcUrl`、`wallets`を`ExternalNearController`に直接渡してください。
Seamsのプロバイダー設定は不要です。バージョン`0.26.0`には、このコネクターが含まれます。

| 設定                                   | 動作                                                     |
| -------------------------------------- | -------------------------------------------------------- |
| `wallets: ['meteor']`                  | Meteorだけを有効化。デモと実装例の設定です。             |
| `wallets: ['meteor', 'hot']`           | MeteorとHOTをこの順序で表示。HOTはメインネット専用です。 |
| `wallets: ['meteor', 'hot', 'intear']` | 3つすべてを明示的に有効化。                              |
| `wallets: []`                          | 外部NEARウォレットをすべて無効化。                       |

`wallets`は必須です。省略して全ウォレットを有効にする既定動作はありません。
実行中は`controller.setWallets(...)`で変更します。セレクターも同じリストから更新されます。
接続済みまたは接続処理中のウォレットを無効にすると、ローカルで切断します。
無効なウォレットへの接続要求は、アダプターを読み込まずに`unavailable`を返します。

[簡潔な実装例と再試行のルール](/ja/guides/external-near-wallets#choose-supported-wallets)を参照してください。

## ホストするウォレットの設定 {#hosted-wallet-branch}

分離したウォレットオリジンには、`iframeWallet`を使います。HTTPSの`walletOrigin`を設定してください。
`walletServicePath`と`sdkBasePath`を、そのオリジンにデプロイしたアセットへ合わせてください。
`rpIdOverride`は認証情報の範囲を変更するため、明示的なセキュリティレビューが必要です。

## 任意のVoiceID {#optional-voiceid}

SDK 0.26.0では、`authMethods: [voiceIdAuthMethod()]`を設定できます。
記述子は`@seams/voiceid`からインポートします。Walletホストにも、このパッケージのアセットが必要です。
記述子は利用可能な方法を定めます。所有者は、登録とVoiceIDでのアンロックを別に選びます。
パスキーやメールOTPの処理中は、エンジンやモデルを読み込みません。
インストールとコード例は[VoiceIDの設定](/ja/concepts/auth-methods/voiceid)を参照してください。

## 登録の設定 {#registration-branch}

管理型の登録には、現在のオリジン用に発行した`publishableKey`が必要です。
キーのレコードが環境を識別します。Router APIは、認証済みキーからランタイムポリシーの範囲を構築します。

`projectEnvironmentId`は、任意の照合項目です。
同じビルドをステージングや本番に向けられる設定では、指定してください。
Routerは、異なる環境に属するキーを拒否します。

環境の識別情報は公開情報として扱い、サーバーや鍵管理の秘密情報はブラウザー設定に含めないでください。

## ネットワークの設定 {#network-branch}

各チェーンレコードは、対応するネットワークを1つ選択します。`rpcUrl`と`explorerUrl`は任意です。
SDKの既定値は、テストネットのエンドポイントとNEARのRPCフェイルオーバーを提供します。
EVM系チェーンには、数値のチェーン識別子も必要です。

署名時は、この設定にあるチェーンをネットワークのスラッグで指定します。
実行時のRPCエンドポイントは、設定済みチェーンから取得します。署名呼び出しからは取得しません。

## リレーヤーの設定 {#relayer-branch}

選択した登録・リレーフローが利用する場合だけ、リレーヤーを設定します。
アプリのURLはサービスを識別します。リクエスト認証と鍵管理の秘密情報は、サーバーの境界内に保持します。

`relayerAccount`を省略すると、SDKがリレーヤーの`/healthz`応答から取得し、サーバーとの一致を保ちます。
この値は、名前付きサブアカウントを作成するNEAR親アカウントを識別します。
例えば、`alice`は`alice.<relayerAccount>`になります。アカウント名の入力欄は、この接尾辞を表示します。
これは委任署名の認証情報ではありません。

`relayerAccount`を設定すると、SDKは自動取得を省略します。指定値はサーバーと一致させてください。

## 表示の設定 {#appearance-branch}

SDK 0.18.0で、`appearance.locale: 'en' | 'ja'`が追加されました。既定は英語です。
設定前に`@seams/wallet`の`normalizeWalletLocale`で、生の言語タグを正規化してください。
例えば、`ja-JP`は`ja`を選びます。非対応のタグは`en`を選びます。
言語設定は、表示設定を通じてSDKのReact部品とホストするウォレットiframeへ伝わります。
言語は、署名や認証の状態に影響しません。

初期の表示設定は、構成に含めます。実行中のテーマ変更には、`seams.config.setAppearance`を使います。
アプリ側のReactテーマとウォレット側のiframe表示設定で、同じ意味を持つ色の体系を使ってください。

ブラウザーとサーバーの管理範囲は、[環境変数](/ja/deploy-and-operate/environment)を参照してください。

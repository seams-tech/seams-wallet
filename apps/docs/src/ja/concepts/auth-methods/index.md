---
title: 認証方法
description: 共通の鍵管理、ポリシー、セッションのライフサイクルにおける、パスキー、メールOTP、VoiceID、その他の証明を比較します。
---

# 認証方法 {#auth-methods}

所有者認証は、鍵管理と署名を制御します。Google BYO認証は、関連付けたウォレットの設定セッションを別に作成します。

| 方法      | 提供状況     | 役割                                                                 |
| --------- | ------------ | -------------------------------------------------------------------- |
| パスキー  | リリース済み | 暗号学的な認証器と、ユーザーの存在確認の要素                         |
| メールOTP | リリース済み | サーバーが検証する経路のチャレンジと、Workerが管理する秘密情報の処理 |
| Google BYO認証 | 0.28.0 | 所有者が承認した関連付けを使い、アプリのログインを設定の読み取りに再利用 |
| VoiceID   | 0.28.0・任意のパッケージ | ローカルでの話者・発話確認と、デバイスに紐づくアンロック・操作承認 |

VoiceIDには、アプリとWalletホストの両方で任意の`@seams/voiceid`パッケージが必要です。
[VoiceIDのページ](/ja/concepts/auth-methods/voiceid)に、インストール、登録、アンロックのコード例を示します。

次に読むページ：

- [認証の境界](/ja/concepts/auth-planes)
- [パスキー](/ja/concepts/auth-methods/passkeys)
- [メールOTP](/ja/concepts/auth-methods/email-otp)
- [VoiceID](/ja/concepts/auth-methods/voiceid)

---
title: 認証方法
description: 共通の鍵管理、ポリシー、セッションのライフサイクルにおける、パスキー、メールOTP、VoiceID、その他の証明を比較します。
---

# 認証方法 {#auth-methods}

認証方法は、共通の鍵管理、ポリシー、署名レーン、セッションのモデルを使います。

| 方法      | 提供状況     | 役割                                                                 |
| --------- | ------------ | -------------------------------------------------------------------- |
| パスキー  | リリース済み | 暗号学的な認証器と、ユーザーの存在確認の要素                         |
| メールOTP | リリース済み | サーバーが検証する経路のチャレンジと、Workerが管理する秘密情報の処理 |
| VoiceID   | 提案段階     | デバイスに紐づくフローの、所有者の存在と音声による操作意図の証明     |

公開済みSDKは、VoiceIDの登録・認証APIを提供しません。
[VoiceIDのページ](/ja/concepts/auth-methods/voiceid)は、提案するモデルを説明します。

次に読むページ：

- [認証の境界](/ja/concepts/auth-planes)
- [パスキー](/ja/concepts/auth-methods/passkeys)
- [メールOTP](/ja/concepts/auth-methods/email-otp)
- [VoiceID](/ja/concepts/auth-methods/voiceid)

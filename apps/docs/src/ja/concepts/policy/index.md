---
title: ポリシー
description: 証明済みの実行者が、現在の範囲とリスク規則の下で、特定の型付き操作意図を実行できるか判断します。
---

# ポリシー {#policy}

ポリシー層は、検証済みの証明を持つ実行者が、今、特定のアクションを実行できるか判断します。

```text
証明 + 委任条件 + 型付き操作意図 + ポリシーのエポック + 利用枠 + 取り消し状態
  -> 許可、拒否、追加確認、または人による承認
```

次に読むページ：

- [委任条件](/ja/concepts/policy/mandates)
- [認証情報と証明](/ja/concepts/policy/credentials-and-proofs)
- [権限を委任したエージェント](/ja/concepts/delegation/delegated-agents)

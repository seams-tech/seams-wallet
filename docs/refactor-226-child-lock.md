# Refactor 226: child lock, user-authored limits on the user's own wallet

Status: plan, 2026-11-08. Nothing is built. It follows
[Refactor 225](refactor-225-jev-policy-engine.md) and uses its rule model: deterministic
rules underneath, and Jev rules that only tighten.

## Result

- A wallet owner writes limits for their own wallet in plain English, for example:
  - "No gambling sites."
  - "Nothing over $100 a day."
  - "Only shops on this list."
  - "Ask me again for any NFT purchase."
- The lock only restricts this wallet. A lock rule can deny, escalate or require a passkey
  tap. It never allows more than the org policy allows.
- Adding or tightening a rule takes effect at once. Removing or loosening a rule takes
  effect only after a delay that the owner can cancel, or after a second approval.
- A parent or guardian can hold the removal right for a child's wallet. Then the child
  cannot remove the lock.
- A stolen or phished session cannot remove the lock at once. It can only start a delayed
  change, which the owner sees and can cancel.

## Context

- Prior assessment from the owner's session: novelty about 5/10, usefulness about 6/10.
- Self-imposed limits already exist: bank card controls, and smart wallets with daily
  limits and guardians (for example Argent).
- The new parts are plain-English authoring with Jev, and the same lock on voice payments.
- The consumer value is clear and the security risk is low. Demand is not proven.

## Facts this plan builds on

- **Refactor 225.** Org policies compile to deterministic rules plus semantic Jev rules.
  Semantic results have no `allow` member. The strictest result wins. One batched Jev call
  runs per transaction, on NEAR AI (`typesafe/jev-1.13`). No signing-time evaluator for
  deterministic rules exists in `packages/wallet-server/src` today; Refactor 225 Slice 2
  adds it.
- **The Speak-to-Sign vault already has delayed loosening**
  (`seams-voice-intents/voice-vault/src/lib.rs` and `state.rs`):
  - `Limits` has `per_transfer` and `daily` (testnet default 5 and 20 NEAR). The vault
    counts `spent_today`.
  - `set_limits`: lower limits apply at once. Higher limits apply after `LIMITS_DELAY_NS`
    (10 minutes on testnet). `cancel_limits_change` drops a pending change.
  - `add_contact`: a contact becomes active after `CONTACT_DELAY_SECONDS` (120 s on
    testnet). `remove_contact` acts at once.
  - `request_withdrawal` waits `WITHDRAWAL_DELAY_NS` (10 minutes). `cancel_withdrawal`
    drops it.
  - The owner is `env::predecessor_account_id()`. The vault has no second approver.
- **Speak-to-Sign** is experimental and testnet only. Release 0.54.0 was its first release
  (`apps/docs/src/concepts/auth-methods/speak-to-sign.md`).
- **Recovery** keeps the wallet's public keys and addresses. It adds a new method, and
  existing methods, linked devices and Wallet Sessions stay active
  (`apps/docs/src/concepts/custody/recovery-and-export.md`).
- **Export** reveals key material. It needs fresh operation-scoped authorization and route
  policy approval (same page). A user with exported keys can sign without the Seams
  co-signer, so no server lock applies to those keys.
- **Linked devices.** A second device gets its own credential, and an existing device
  approves the link (`apps/docs/src/guides/linked-devices.md`).
- **Console actions.** The Console policy actions include `add_key` and `export_key`
  (seams-monorepo `PolicyEngineWorkspace.tsx`). The only spend counter in Console policy
  today is the gas sponsorship cap (weekly or monthly).
- **No guardian concept** exists in seams-wallet today.

## Terms

- **lock** — the set of rules that a wallet owner writes for their own wallet. It has
  versions, like an org policy in Refactor 225.
- **self mode** — the owner holds the removal right. A loosening waits for the delay, or
  for a second approval.
- **guardian mode** — one or more guardians hold the removal right. A loosening needs a
  guardian's approval. Waiting does not help.
- **guardian** — another Seams wallet that approves loosenings with its own passkey.
- **change** — a new lock version that the owner submits. Removing the lock is a change to
  an empty version.
- **pending change** — a change that waits for its delay or for its approval.

## Design

### 1. One rule makes tightening immediate and loosening slow

During a pending change, **both the active version and the pending version apply**, and the
strictest result wins.

- The rules that a change adds apply at once, because the pending version applies at once.
- The rules that a change removes or loosens still apply, because the active version still
  applies.
- When the delay ends (self mode) or a guardian approves (guardian mode), the pending
  version becomes the only active version.
- Cancel drops the pending version. Only a loosening is lost; a cancel never loosens
  anything.

So code never has to decide whether a change, or a semantic rule, is tighter or looser.
The vault's `set_limits` rule is a special case of this rule.

Changes that remove the lock in effect are loosenings in every mode:

- removing the lock;
- `export_key` and `add_key` while a lock is active;
- adding a guardian, and removing a guardian;
- switching from guardian mode to self mode.

### 2. Lock record

```ts
type LockMode =
  | {
      readonly kind: 'self';
      readonly delaySeconds: number;
      readonly secondApprover: 'none' | 'linked_device' | 'guardian';
    }
  | { readonly kind: 'guardian'; readonly guardianWalletIds: readonly [string, ...string[]] };

type LockVersion = Readonly<{
  walletId: string;
  version: number;
  sourceText: string;
  deterministic: LockDeterministicRules; // recipients, per-transfer and daily limits, blocked actions
  semantic: readonly JevPolicyRule[]; // Refactor 225, scope 'user_lock'
  jevModel: 'typesafe/jev-1.13';
  digest: `sha256:${string}`;
}>;

type WalletLock = Readonly<{
  mode: LockMode;
  active: LockVersion | null;
  pending: null | {
    readonly version: LockVersion | null; // null removes the lock
    readonly submittedAt: string;
    readonly effectiveAt: string | 'on_approval';
  };
}>;
```

The lock is keyed by `walletId`, not by a device or an auth method.

### 3. Authoring in the Wallet

The owner authors the lock in the Wallet settings, not in the Console.

1. The owner writes the sentences.
2. A Seams server route sends them to the authoring model of Refactor 225 (Decision 5). The
   model returns deterministic rules, semantic rules and example cases.
3. The Wallet shows:
   - the deterministic rules in plain words, rendered by code;
   - each semantic rule with its question, marked "checked by an AI classifier";
   - the example decisions, from the deterministic evaluator and one Jev call;
   - which parts apply at once and which parts wait (Section 1).
4. The owner confirms with a passkey. The change goes live, or becomes pending.

The four examples compile as follows:

| Sentence                            | Deterministic part                                                       | Semantic part                                                               | Action                   |
| ----------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------ |
| "No gambling sites"                 | None, unless the owner names origins or contracts                        | `noul`: is the app origin, contract or market a gambling or betting service | `deny`                   |
| "Nothing over $100 a day"           | Daily spend limit, valued in USD (price source: Refactor 225 question 6) | None                                                                        | `deny`                   |
| "Only shops on this list"           | Recipient, origin or contract allowlist; the owner picks the entries     | None                                                                        | `deny`                   |
| "Ask me again for any NFT purchase" | NFT transfer or mint, where the review decoder knows the standard        | `noul`: does this transaction buy an NFT                                    | `require_human_approval` |

The app origin is a trusted field: the Wallet knows which origin sent the request.

### 4. Denials

Each denial shows the owner:

- the rule's source sentence, as a short reason;
- one path forward:
  - `require_human_approval`: a passkey tap now;
  - `deny` in self mode: **Ask to unlock**, which submits a change without that rule and
    shows when it takes effect;
  - `deny` in guardian mode: **Ask my guardian**, which sends the request to the guardian.

The app gets only the outcome and the rule id (Refactor 225, Section 7.6).

### 5. Where the lock lives and who enforces it

| Path                                                  | Lock state                                                                 | Enforcer                                                                               | Who could skip the delay                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Speak-to-Sign vault                                   | Vault contract: limits, contacts, the active and pending lock digests      | The vault on chain; the OutLayer verifier evaluates the semantic rules of both digests | Nobody. The delay is in contract code                                             |
| Normal signing (passkey, VoiceID session, agent lane) | wallet-server D1, keyed by `walletId`, apart from the Console org policies | The Seams co-signer: it holds its last signing message until the decision is `allow`   | Seams, which runs the co-signer. Not the operator: no Console route writes a lock |

- **Vault.** The vault stores the lock digest and a pending digest with its effective time,
  as it stores limits today. The verdict carries the digests that the verifier evaluated.
  The vault refuses a verdict whose digests differ from its own. The rule texts live in the
  verifier's OutLayer storage under those digests.
- **wallet-server.** Each lock change, cancel and approval is a route that needs fresh
  authentication of the owner or guardian. The server clock decides when a delay ends.
- **Notice.** A pending loosening is useful against a stolen session only if the owner sees
  it. The Wallet shows each pending change at sign-in, with **Cancel**. If the wallet has
  Email OTP, the owner also gets an email.

### 6. Guardians and children

- **Who.** A guardian is another Seams wallet. It approves with its own passkey.
- **Add.** The owner invites; the guardian accepts with a passkey. With no lock, the
  guardian is added at once. With an active lock, adding a guardian is a loosening
  (Section 1).
- **Child wallet.** A parent sets up the lock in guardian mode, with themselves as the
  guardian. The child can add rules, but every loosening, `export_key`, `add_key` and
  every guardian change needs the guardian's approval.
- **Guardian recovery.** A guardian who loses a device recovers their own wallet. Recovery
  keeps the guardian's wallet, so the link stays. A guardian whose wallet is gone needs
  another path (open question 3).

### 7. Org policies and recovery

- **Org policy.** The org policy and the lock both apply. The strictest result wins. The
  org cannot remove a lock, and a lock cannot loosen an org policy. One Jev call carries
  the semantic rules of both.
- **Recovery.** Recovery keeps the wallet and its addresses, so it keeps the lock and the
  pending change. A recovery is not a lock change.

## Slices

### Slice 1: self lock on the Speak-to-Sign vault (testnet)

- **Vault.** Add the lock digest, the pending digest, the delay, cancel and the verdict
  check (Section 5). Keep `set_limits`, contacts and withdrawals as they are.
- **Verifier.** Load the rules for both digests and evaluate both in the one Jev call.
- **Wallet.** Authoring (Section 3) with the vault limits, contacts and semantic rules;
  the pending change with **Cancel**; denials with **Ask to unlock** (Section 4).
- **Spoken purpose.** The vault only pays NEAR to contacts, so the semantic rules judge
  the spoken purpose of Refactor 225 Slice 1. A lock such as "no gambling" denies "send
  five near to bob for poker night".
- **Acceptance:**
  - A tightening applies to the next transfer.
  - A loosening applies only after the delay. Cancel during the delay keeps the old rules.
  - A verdict with a stale lock digest is refused by the vault.
  - A denial shows the source sentence and **Ask to unlock**.

### Later slices

| Slice | Content                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------- |
| 2     | Guardian mode on the vault: a guardian account approves or cancels pending changes                                     |
| 3     | Self lock on normal signing in wallet-server, after Refactor 225 Slices 2–3; `export_key` and `add_key` under the lock |
| 4     | Guardian mode on normal signing, guardian recovery and the daily USD limit                                             |

## Open questions for the owner

1. **Delay.** What is the default: 24 h, 48 h, or the owner's choice? Testnet demos use
   minutes.
2. **Second approval in self mode.** A linked device, a guardian, or both?
3. **Lost guardian.** If a guardian's wallet is gone, who can replace the guardian: a
   second guardian, or the operator after a long delay?
4. **Guardian scope.** May any Seams wallet be a guardian, or only a wallet in the same app?
5. **Export under a lock.** Do `export_key` and `add_key` wait for the delay (this plan),
   or does export stay available at once as a self-custody promise? A lock without this
   rule is easy to remove by export.
6. **Jev cost.** Who pays for the Jev calls of a user's lock: the operator, or Seams?

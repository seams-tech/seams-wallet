---
title: Concepts
description: Learn the architecture, custody, authentication, policy, session, delegation, and threshold concepts behind Seams.
---

# Concepts

Seams is wallet, credential, and policy infrastructure for applications that provision
persistent wallets for users or shopping agents. It helps applications prove who is
acting and record what they approved as a typed intent. Applications enforce policy
before execution and retain an audit trail afterward.

```text
Prove who is acting.
Prove what they approved.
Enforce what they can do.
```

Wallet signing is the first way this model executes an approved action. The same model
extends to payment rails, merchant APIs, marketplace APIs, agent tools, and delegated
device actions.

The primary use cases are [platform wallets](/use-cases/platform-wallets),
[shopping wallet apps](/use-cases/shopping-wallet-apps), and [shopping
agents](/use-cases/ecommerce-agents). Seams provides self-hostable threshold
wallet infrastructure that deploys to Cloudflare.

The published SDK ships wallet lifecycle, signing, and owner-selected region moves.
SDK 0.26.0 adds optional [VoiceID](/concepts/auth-methods/voiceid) enrollment, unlock, and reviewed transfer approval.
Delegated-agent issuance and virtual cards are planned capabilities. Their concept pages do not imply a released API.

See [release status](/releases) for the published baseline and upgrade boundaries.
The layer map below also describes proposed uses. Passkeys and Email OTP are
the released owner authentication methods.

## System layers

| Layer                    | Role                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Proof layer              | Passkeys, Email OTP, VoiceID, device proof, org proof, wallet proof, and configured external credentials.     |
| Policy and mandate layer | Signed mandates, typed intent digests, policy epochs, budgets, expiry, revocation, and audit state.           |
| Key infrastructure       | Holder shares, server shares, Router A/B, SigningWorker, export, recovery, delegation, and rotation.          |
| Enforcement gateway      | Allows, denies, escalates, or requires human approval before money, authority, inventory, or API state moves. |
| Execution adapters       | Wallet signatures, payments, merchant APIs, marketplaces, agent tools, and future device actions.             |

## Reading order

1. [Architecture](/concepts/architecture) for the main component map.
2. [Wallet Infrastructure Comparison](/concepts/wallet-infrastructure-comparison) for deployment and cost tradeoffs.
3. [Policy](/concepts/policy/) for mandates, proofs, and authorization.
4. [Custody](/concepts/custody/) for who can hold or open key material.
5. [Threshold Signing](/concepts/threshold-signing/) for Router A/B, Streaming Yao, and signing shares.
6. [Sessions](/concepts/sessions/) for signing lanes and bounded runtime authority.
7. [Auth Methods](/concepts/auth-methods/) for passkeys, Email OTP, and VoiceID.
8. [Delegation](/concepts/delegation/) for linked devices, agents, and rotation.

## Shopping-agent short version

Give agents permission to act without giving them unlimited authority.

Define what an agent may do. Bind it to signed intent. Enforce it before money,
inventory, or authority moves.

---
title: VoiceID
description: Treat VoiceID as a consented owner-presence signal within threshold signing and policy enforcement.
---

# VoiceID

This page describes a proposed authorization method. Wallet SDK 0.10.0 does not
expose VoiceID enrollment or authentication APIs.

VoiceID is an owner-presence signal. Threshold signing and policy are the
signing controls.

VoiceID verifies an enrolled speaker, spoken command, device context, freshness, and
policy constraints. It can issue a short-lived authorization result that permits one
specific signing flow to continue.

VoiceID is an authorization signal for a specific flow. It is not a wallet
private key, signing secret, recovery secret, account credential, or standalone
signing authority.

## Flow

```text
SDK transaction request
  -> canonical intent digest
  -> VoiceID command capture on enrolled device
  -> speaker, phrase, freshness, and device checks
  -> wallet policy decision
  -> one-use owner-presence capability grant
  -> normal Router A/B signing continuation
```

## Policy modes

Direct capability grants are appropriate only for low-risk, one-use, intent-bound
actions.

Riskier tasks should use VoiceID as the first check. They should then require a passkey,
Email OTP, phone, watch, or another method for fresh authentication. This applies before
export, recovery, new device enrollment, high-value signing, signing for a new
recipient, or unusual sessions.

## Requirements

1. Voice matching is separated from phrase or intent transcription.
2. The spoken command binds to the same `intentDigest` as the transaction.
3. The security model requires binding the proof to a device.
4. Voice templates and raw audio need explicit retention rules.
5. High-risk flows require step-up authentication.

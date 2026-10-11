---
title: Wallet iframe
description: Keep credential prompts, workers, signing state, and key export inside an isolated wallet-origin iframe.
---

# Wallet iframe

The wallet iframe is the browser isolation boundary. It runs at a wallet origin separate
from the app origin. It manages wallet UI, encrypted local records, workers, and
wallet-origin session state.

## Boundary

| Boundary             | Responsibility                                                     |
| -------------------- | ------------------------------------------------------------------ |
| App origin           | Calls the SDK, renders app UI, and passes public operation inputs. |
| Wallet iframe origin | Owns wallet UI, wallet IndexedDB, auth-method flows, and workers.  |
| Browser workers      | Own hot holder material and operation-local secret state.          |

App-origin JavaScript receives public results and non-secret flow state. Holder shares,
PRF output, Email OTP secret material, VoiceID templates, and server shares stay outside
the app origin. Authorized key export displays material in the wallet-origin viewer.
`keys.exportKey` returns an outcome to the app. It does not return the private key.

In 0.9.0, WebAuthn credential creation and assertions execute on the wallet origin. The
SDK delegates iframe permissions to that origin. There is no application-origin WebAuthn
fallback. Use a supported browser and a compatible wallet-origin relying party ID (RP
ID).

## Why it matters

The iframe keeps wallet authority independent from the app page. A compromised app page
must still pass wallet-origin checks, policy, and authentication requirements. Wallet
Session admission, replay checks, and signing budget admission must also pass before a
signing lane can participate.

## Configure the boundary

Set the wallet origin explicitly when mounting the React provider. The wallet
service and SDK paths resolve against that dedicated origin.

::: details Runnable React example

<<< ../../examples/setup.tsx

:::

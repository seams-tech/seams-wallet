---
title: Linked devices
description: Create a distinct device credential and signing lane through short-lived linking and explicit approval.
---

# Linked devices

Device linking creates a distinct signing lane for another user-controlled
device.

## Flow

1. A new device presents a QR link session with a link public key.
2. An existing owner device authenticates the user and approves permissions.
3. The owner worker creates a distinct holder share for the linked device.
4. The server creates the matching server share for the linked-device lane.
5. The linked device receives an encrypted holder-share package.
6. The lane activates after delivery receipt and address parity checks.

The linked device has its own `laneId`, `laneShareEpoch`, holder-share envelope,
permission policy, revocation status, and audit history.

Version 0.8.0 links owner-controlled devices to the same wallet and fixed
regional home. Local user presence and server admission remain required by the
selected operation. Scoped mandate-based device or agent delegation is a
separate planned capability.

## Link from the app

The new device displays a short-lived QR payload. An authenticated owner device
scans and approves it through the linking hook.

::: details Runnable React example

<<< ../../examples/device-linking.tsx

:::

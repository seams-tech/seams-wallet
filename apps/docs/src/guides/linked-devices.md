---
title: Linked devices
description: Link a second user-controlled device through a short-lived QR session and explicit approval on the existing device.
---

# Linked devices

Start with [Advanced wallet operations](/examples/advanced-wallet-operations) to see the
device-linking flow. Linking gives a new device its own credential and lane. The
existing device approves the relationship. It never transfers its credential.

## Flow at a glance

1. The new device starts a short-lived session and displays a QR code.
2. The existing device scans the code, shows the exact wallet and device
   request, and approves it with fresh authentication.
3. Both devices observe the final result and the new device stores its own
   credential.

Expire abandoned sessions. Cancel polling when the UI unmounts. Ensure repeated scans
have the same effect as one scan. After success, display the device name and creation
time so the user can recognize and revoke it later.

Handle every linking result branch. Keep QR payloads limited to public bootstrap data.
Wallet identity, sessions, and key material stay behind the authenticated wallet
boundary.

See [linked devices](/concepts/delegation/linked-devices) for protocol and
revocation detail.

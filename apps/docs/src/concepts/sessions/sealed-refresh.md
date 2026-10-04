---
title: Sealed refresh
description: Restore sealed signing material after interruption without weakening wallet-session or custody boundaries.
---

# Sealed refresh

Sealed refresh restores encrypted signing material after an accidental iframe or page
reload. It keeps plaintext signing material out of browser storage.

The persisted artifact is a sealed session secret stored in wallet-origin
IndexedDB. It is useful only with live server participation and valid
server-side signing-session state.

## Rules

1. Store sealed refresh records in the wallet iframe origin.
2. Bind records to exact material activation and the browser-session marker.
3. Delete records on lock, account switch, revocation, expiry, and
   remaining-use exhaustion.
4. Restore only transaction signing capability.
5. Require fresh operation auth for export, linked-device creation, key
   rotation, and delegated-agent issuance.

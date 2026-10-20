# Refactor 126: durable encrypted ECDSA presignature cache

Status: implementation completed; the original record left release validation and production latency measurement as operational follow-ups.

## Why

Reloading a page discarded completed client presignatures. The next signature then waited
for preprocessing even when matching server material still existed.

## What changed

- Persisted encrypted client presignatures in the existing wallet IndexedDB database.
- Restored material lazily inside the ECDSA worker and retained the existing encrypted server storage.
- Separated short ceremony deadlines from completed-material expiry, with a 90-day maximum.
- Kept five available entries per exact pool identity, with atomic one-use claims.
- Scheduled discovery and refill after unlock without delaying successful unlock.

Existing lifecycle owners continued to enforce reservation, consumption, retirement,
and replay safety. This work introduced no replacement signing protocol or server-store migration.

## Scope limits

Persistence did not establish live authority or a production latency guarantee.
Cross-tab refill leadership and infrastructure changes were outside this refactor.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/archive/refactor-126-durable-presignature-cache.md).

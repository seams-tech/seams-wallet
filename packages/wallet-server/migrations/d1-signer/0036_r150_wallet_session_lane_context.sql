-- R150 Wallet Session lane-epoch binding.
--
-- Sessions issued before regional Home lanes have no trusted lane context.
-- Give those durable records their deployment's original APAC context and
-- retire them in the same update so every 0.6.3 reader can parse them while
-- requiring the owner to mint a fresh session against the directory.

UPDATE wallet_session_authorizations_v2
SET record_json = json_set(
      record_json,
      '$.laneContext',
      json_object(
        'walletId', wallet_id,
        'laneId', 'managed-apac-v1',
        'laneEpoch', 1,
        'directoryRevision', 1
      )
    ),
    retired_at_ms = COALESCE(retired_at_ms, issued_at_ms)
WHERE json_type(record_json, '$.laneContext') IS NULL;

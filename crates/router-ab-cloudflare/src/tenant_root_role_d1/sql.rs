//! SQL statements of the role-private D1 store.

use super::*;

pub(super) const LOAD_EPOCH_SQL: &str = "SELECT tenant_identity_digest_hex, custody_lineage_b64u, \
    tenant_root_share_epoch, role, lifecycle, ciphertext_json, revision, created_at_ms, \
    updated_at_ms FROM tenant_root_role_shares WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND tenant_root_share_epoch = $3 AND role = $4";

pub(super) const LOAD_ACTIVE_SQL: &str = "SELECT tenant_identity_digest_hex, custody_lineage_b64u, \
    tenant_root_share_epoch, role, lifecycle, ciphertext_json, revision, created_at_ms, \
    updated_at_ms FROM tenant_root_role_shares WHERE tenant_identity_digest_hex = $1 \
    AND lifecycle = 'active'";

pub(super) const INSERT_SQL: &str = "INSERT INTO tenant_root_role_shares \
    (tenant_identity_digest_hex, custody_lineage_b64u, tenant_root_share_epoch, role, \
    lifecycle, ciphertext_json, revision, created_at_ms, updated_at_ms) \
    VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8) \
    ON CONFLICT(tenant_identity_digest_hex, custody_lineage_b64u, \
    tenant_root_share_epoch, role) DO NOTHING";

/// Inserts a creation's pending row, refused for a lineage an abandonment
/// tombstoned, so a creation command admitted before its window closed cannot
/// write after the abandoned ceremony was cleaned. Only creation uses it.
pub(super) const INSERT_INITIAL_CREATION_SQL: &str = "INSERT INTO tenant_root_role_shares \
    (tenant_identity_digest_hex, custody_lineage_b64u, tenant_root_share_epoch, role, \
    lifecycle, ciphertext_json, revision, created_at_ms, updated_at_ms) \
    SELECT $1, $2, $3, $4, $5, $6, 1, $7, $8 \
    WHERE NOT EXISTS (SELECT 1 FROM tenant_root_creation_tombstones \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 AND role = $4) \
    ON CONFLICT(tenant_identity_digest_hex, custody_lineage_b64u, \
    tenant_root_share_epoch, role) DO NOTHING";

/// Removes an abandoned ceremony's pending initial row, if one exists. Only a
/// pending row: active material is never cleaned this way.
pub(super) const DELETE_ABANDONED_CEREMONY_PENDING_SQL: &str = "DELETE FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
    AND tenant_root_share_epoch = 1 AND role = $3 AND lifecycle = 'pending'";

pub(super) const INSERT_CREATION_TOMBSTONE_SQL: &str = "INSERT INTO tenant_root_creation_tombstones \
    (tenant_identity_digest_hex, custody_lineage_b64u, role, session_id_hex, created_at_ms) \
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING";

pub(super) const ADMIT_ROOT_USE_SQL: &str = "INSERT INTO tenant_root_root_use_admissions \
    (tenant_identity_digest_hex, custody_lineage_b64u, role, attempt_kind, attempt_key_hex, \
    tenant_root_share_epoch, activation_receipt_digest_hex, attempt_digest_hex, \
    first_binding_digest_hex, issued_at_ms, expires_at_ms, status, admitted_at_ms, \
    pair_object_id, preparation_digest_hex) \
    SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'admitted', $12, $13, $14 \
    WHERE EXISTS (SELECT 1 FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
    AND tenant_root_share_epoch = $6 AND role = $3 AND lifecycle = 'active') \
    ON CONFLICT DO NOTHING";

pub(super) const LOAD_ROOT_USE_ADMISSION_SQL: &str = "SELECT tenant_root_share_epoch, \
    activation_receipt_digest_hex, attempt_digest_hex, status, pair_object_id, preparation_digest_hex \
    FROM tenant_root_root_use_admissions \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 AND role = $3 \
    AND attempt_kind = $4 AND attempt_key_hex = $5";

/// Records Deriver A's claim of its pair: the last durable step before its
/// first protocol message to Deriver B. Only an `admitted` row moves, so a
/// cancelled attempt cannot claim, and recovery never cancels a claimed one.
/// Parameters: the role, the attempt kind and the attempt key. A pair store
/// runs it in the transaction that claims the pair, and requires one change.
pub const TENANT_ROOT_CLAIM_ROOT_USE_ADMISSION_SQL_V1: &str =
    "UPDATE tenant_root_root_use_admissions \
    SET status = 'claimed' WHERE role = $1 AND attempt_kind = $2 AND attempt_key_hex = $3 \
    AND status = 'admitted' AND preparation_digest_hex IS NULL";

/// Settles one attempt's admission when its pair completes here. A cancelled
/// row does not move, so the pair store, which requires one change, refuses
/// to complete a cancelled attempt. Parameters as for the claim.
pub const TENANT_ROOT_SETTLE_ROOT_USE_ADMISSION_SQL_V1: &str =
    "UPDATE tenant_root_root_use_admissions \
    SET status = 'settled' WHERE role = $1 AND attempt_kind = $2 AND attempt_key_hex = $3 \
    AND status IN ('admitted', 'claimed')";

/// Settles the admission of one pair session held in a wallet object, once
/// that object reports the pair completed. Bound to the exact object and
/// attempt; replaying it changes nothing. Parameters: the role, the attempt
/// kind, the attempt key and the object's name.
pub(crate) const TENANT_ROOT_SETTLE_WALLET_OBJECT_ADMISSION_SQL_V1: &str =
    "UPDATE tenant_root_root_use_admissions \
    SET status = 'settled' WHERE role = $1 AND attempt_kind = $2 AND attempt_key_hex = $3 \
    AND pair_object_id = $4 AND status IN ('admitted', 'claimed')";

/// Cancels the admission of one pair session held in a wallet object, once
/// that object has fenced the pair. Parameters as for the settlement.
pub(super) const CANCEL_WALLET_OBJECT_ADMISSION_SQL: &str = "UPDATE tenant_root_root_use_admissions \
    SET status = 'cancelled' WHERE role = $1 AND attempt_kind = $2 AND attempt_key_hex = $3 \
    AND pair_object_id = $4 AND status = 'admitted'";

/// Deriver A's claimed admissions on one epoch whose pairs are in this role
/// store and that are still unsettled at or before a cutoff.
pub(super) const LIST_CLAIMED_ROOT_USE_ADMISSIONS_SQL: &str = "SELECT attempt_key_hex \
    FROM tenant_root_root_use_admissions WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND role = $3 AND tenant_root_share_epoch = $4 \
    AND attempt_kind = $5 AND status = 'claimed' AND pair_object_id IS NULL \
    AND admitted_at_ms <= $6 ORDER BY admitted_at_ms, attempt_key_hex";

/// Ends one claimed attempt whose peer can no longer complete it. Its
/// completion here, which needs the admission live, is refused from then on.
pub(super) const CANCEL_CLAIMED_ROOT_USE_ADMISSION_SQL: &str = "UPDATE tenant_root_root_use_admissions \
    SET status = 'cancelled' WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND role = $3 AND attempt_kind = $4 \
    AND attempt_key_hex = $5 AND status = 'claimed' AND pair_object_id IS NULL";

/// Cancels one attempt that was only admitted here and whose pair, if any,
/// is in this role store. Its start and completion here are then refused.
pub(super) const CANCEL_ADMITTED_ROOT_USE_ADMISSION_SQL: &str = "UPDATE tenant_root_root_use_admissions \
    SET status = 'cancelled' WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND role = $3 AND attempt_kind = $4 \
    AND attempt_key_hex = $5 AND status = 'admitted' AND pair_object_id IS NULL";

/// The unsettled admissions on one epoch here whose pairs wallet objects hold.
pub(super) const LIST_WALLET_OBJECT_ADMISSIONS_SQL: &str = "SELECT attempt_key_hex, pair_object_id, \
    admitted_at_ms FROM tenant_root_root_use_admissions WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND role = $3 AND tenant_root_share_epoch = $4 \
    AND status IN ('admitted', 'claimed') AND pair_object_id IS NOT NULL \
    ORDER BY admitted_at_ms, attempt_key_hex";

/// The status of one attempt's admission, for a pair store's own checks.
/// Parameters as for the claim.
pub const TENANT_ROOT_ROOT_USE_ADMISSION_STATUS_SQL_V1: &str =
    "SELECT status FROM tenant_root_root_use_admissions \
    WHERE role = $1 AND attempt_kind = $2 AND attempt_key_hex = $3";

/// Settles one exact attempt: its full key and the binding it was admitted
/// under. Zero changed rows means another commit won, and the caller reads
/// which one.
pub(super) const SETTLE_EXACT_ROOT_USE_ADMISSION_SQL: &str = "UPDATE tenant_root_root_use_admissions \
    SET status = 'settled' WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND role = $3 AND attempt_kind = $4 \
    AND attempt_key_hex = $5 AND attempt_digest_hex = $6 AND status = 'admitted'";

/// The attempt kind of an Ed25519 Yao pair session's admission.
pub const TENANT_ROOT_YAO_PAIR_SESSION_ATTEMPT_KIND_V1: &str = "ed25519_yao_pair_session";

/// The epoch active at this role for one lineage, if any.
pub(super) const LOAD_LINEAGE_ACTIVE_EPOCH_SQL: &str = "SELECT tenant_root_share_epoch \
    FROM tenant_root_role_shares WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND role = $3 AND lifecycle = 'active'";

pub(super) const LOAD_CREATION_TOMBSTONE_SQL: &str = "SELECT session_id_hex FROM \
    tenant_root_creation_tombstones WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND role = $3";

pub(super) const ACTIVATE_INITIAL_PENDING_SQL: &str = "UPDATE tenant_root_role_shares SET \
    lifecycle = 'active', ciphertext_json = $1, revision = revision + 1, updated_at_ms = $2 \
    WHERE tenant_identity_digest_hex = $3 AND custody_lineage_b64u = $4 \
    AND tenant_root_share_epoch = $5 AND CAST($5 AS BIGINT) = 1 \
    AND role = $6 AND lifecycle = 'pending' \
    AND revision = $7 AND NOT EXISTS (SELECT 1 FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = $3 AND role = $6 AND lifecycle = 'active')";

pub(super) const RETIRE_ACTIVE_FOR_SWAP_SQL: &str = "UPDATE tenant_root_role_shares SET \
    lifecycle = 'retired', ciphertext_json = $8, revision = revision + 1, updated_at_ms = $10 \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 AND role = $4 \
    AND CAST($6 AS BIGINT) = CAST($3 AS BIGINT) + 1 \
    AND tenant_root_share_epoch = $3 AND lifecycle = 'active' AND revision = $5 \
    AND EXISTS (SELECT 1 FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
    AND tenant_root_share_epoch = $6 AND role = $4 AND lifecycle = 'pending' \
    AND revision = $7)";

pub(super) const ACTIVATE_PENDING_FOR_SWAP_SQL: &str = "UPDATE tenant_root_role_shares SET \
    lifecycle = 'active', ciphertext_json = $9, revision = revision + 1, updated_at_ms = $10 \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 AND role = $4 \
    AND tenant_root_share_epoch = $6 AND lifecycle = 'pending' AND revision = $7 \
    AND EXISTS (SELECT 1 FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
    AND tenant_root_share_epoch = $3 AND role = $4 AND lifecycle = 'retired' \
    AND revision = CAST($5 AS BIGINT) + 1 AND updated_at_ms = $10)";

pub(super) const DELETE_MANAGED_RESTORE_FORWARD_REFRESH_PENDING_SQL: &str =
    "DELETE FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
    AND tenant_root_share_epoch = $3 AND role = $4 AND lifecycle = 'pending' \
    AND revision = $5";

pub(super) const ACTIVATE_MANAGED_RESTORE_FORWARD_REFRESH_PENDING_SQL: &str =
    "UPDATE tenant_root_role_shares SET \
    lifecycle = 'active', ciphertext_json = $1, revision = revision + 1, updated_at_ms = $2 \
    WHERE tenant_identity_digest_hex = $3 AND custody_lineage_b64u = $4 \
    AND tenant_root_share_epoch = $5 AND role = $6 AND lifecycle = 'pending' \
    AND revision = $7 AND CAST($5 AS BIGINT) = CAST($8 AS BIGINT) + 1 \
    AND NOT EXISTS (SELECT 1 FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = $3 AND custody_lineage_b64u = $4 \
    AND tenant_root_share_epoch = $8 AND role = $6)";

pub(super) const CLEANUP_PENDING_SQL: &str = "DELETE FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
    AND tenant_root_share_epoch = $3 AND role = $4 AND lifecycle = 'pending' \
    AND revision = $5";

/// Erases one retired row, only while its active successor holds the bound
/// revision and no root-use admission on the retired epoch is still
/// unsettled here. Settlement is what makes erasure safe; time never is.
pub(super) const CLEANUP_RETIRED_SQL: &str = "DELETE FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
    AND tenant_root_share_epoch = $3 AND role = $4 AND lifecycle = 'retired' \
    AND revision = $5 AND EXISTS (SELECT 1 FROM tenant_root_role_shares \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
    AND tenant_root_share_epoch = $6 AND role = $4 AND lifecycle = 'active' \
    AND revision = $7) AND NOT EXISTS (SELECT 1 FROM tenant_root_root_use_admissions \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
    AND role = $4 AND tenant_root_share_epoch = $3 AND status IN ('admitted', 'claimed'))";

pub(super) const COUNT_UNSETTLED_ROOT_USE_ADMISSIONS_SQL: &str = "SELECT COUNT(*) AS admissions \
    FROM tenant_root_root_use_admissions WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND role = $3 AND tenant_root_share_epoch = $4 \
    AND status IN ('admitted', 'claimed')";

pub(super) const COUNT_CANCELLED_ROOT_USE_ADMISSIONS_SQL: &str = "SELECT COUNT(*) AS admissions \
    FROM tenant_root_root_use_admissions WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND role = $3 AND tenant_root_share_epoch = $4 \
    AND status = 'cancelled'";

/// Recovery's cancellation: only admissions still `admitted` at or before a
/// cutoff whose pair, if any, is in this role store. Every later step of such
/// an attempt is fenced in this store: Deriver A's claim and each role's
/// completion require the admission, and an ECDSA read is used only if its
/// settlement wins. A claimed admission waits for its pair to complete. A
/// wallet object's pair is fenced there, not here.
pub(super) const CANCEL_UNCLAIMED_ROOT_USE_ADMISSIONS_SQL: &str = "UPDATE tenant_root_root_use_admissions \
    SET status = 'cancelled' WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND role = $3 AND tenant_root_share_epoch = $4 \
    AND status = 'admitted' AND pair_object_id IS NULL AND admitted_at_ms <= $5";

pub(super) const LOAD_COMMAND_REPLAY_SQL: &str = "SELECT replay_key_digest_hex, \
    tenant_identity_digest_hex, custody_lineage_b64u, session_id_hex, nonce_hex, role, \
    command_digest_hex, admission_digest_hex, status, receipt_b64u, \
    receipt_digest_hex, reserved_at_ms, executed_at_ms, terminal_at_ms, \
    refresh_state_b64u, refresh_state_digest_hex \
    FROM tenant_root_command_replays WHERE replay_key_digest_hex = $1 \
    AND role = $2";

pub(super) const INSERT_COMMAND_RESERVATION_SQL: &str = "INSERT INTO tenant_root_command_replays \
    (replay_key_digest_hex, tenant_identity_digest_hex, custody_lineage_b64u, \
    session_id_hex, nonce_hex, role, command_digest_hex, admission_digest_hex, \
    status, reserved_at_ms) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'reserved', $9) \
    ON CONFLICT(replay_key_digest_hex) DO NOTHING";

pub(super) const INSERT_REFRESH_ADMISSION_SQL: &str = "INSERT INTO tenant_root_command_replays \
    (replay_key_digest_hex, tenant_identity_digest_hex, custody_lineage_b64u, \
    session_id_hex, nonce_hex, role, command_digest_hex, admission_digest_hex, \
    status, reserved_at_ms, refresh_state_b64u, refresh_state_digest_hex) \
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'reserved', $9, $10, $11) \
    ON CONFLICT(replay_key_digest_hex) DO NOTHING";

/// A refresh attempt's own checkpoints refuse once a later attempt of its
/// transition superseded it, so it cannot write back what that attempt replaced.
pub(super) const MARK_REFRESH_EXECUTED_SQL: &str = "UPDATE tenant_root_command_replays SET \
    status = 'executed', command_digest_hex = $7, executed_at_ms = $8, \
    refresh_state_b64u = $9, refresh_state_digest_hex = $10 \
    WHERE replay_key_digest_hex = $1 AND tenant_identity_digest_hex = $2 \
    AND custody_lineage_b64u = $3 AND session_id_hex = $4 AND nonce_hex = $5 \
    AND role = $6 AND command_digest_hex = $11 AND admission_digest_hex = $12 \
    AND reserved_at_ms = $13 AND status = 'reserved' \
    AND refresh_state_b64u = $14 AND refresh_state_digest_hex = $15 \
    AND NOT EXISTS (SELECT 1 FROM tenant_root_refresh_supersessions \
    WHERE replay_key_digest_hex = $1)";

pub(super) const ATTACH_REFRESH_ARTIFACTS_SQL: &str = "UPDATE tenant_root_command_replays SET \
    refresh_state_b64u = $1, refresh_state_digest_hex = $2 \
    WHERE replay_key_digest_hex = $3 AND tenant_identity_digest_hex = $4 \
    AND custody_lineage_b64u = $5 AND session_id_hex = $6 AND nonce_hex = $7 \
    AND role = $8 AND command_digest_hex = $9 AND admission_digest_hex = $10 \
    AND reserved_at_ms = $11 AND executed_at_ms = $12 AND status = 'executed' \
    AND refresh_state_b64u = $13 AND refresh_state_digest_hex = $14 \
    AND NOT EXISTS (SELECT 1 FROM tenant_root_refresh_supersessions \
    WHERE replay_key_digest_hex = $3)";

pub(super) const COMMIT_REFRESH_TERMINAL_SQL: &str = "UPDATE tenant_root_command_replays SET \
    status = 'completed', receipt_b64u = $1, receipt_digest_hex = $2, terminal_at_ms = $3 \
    WHERE replay_key_digest_hex = $4 AND tenant_identity_digest_hex = $5 \
    AND custody_lineage_b64u = $6 AND session_id_hex = $7 AND nonce_hex = $8 \
    AND role = $9 AND command_digest_hex = $10 AND admission_digest_hex = $11 \
    AND reserved_at_ms = $12 AND executed_at_ms = $13 AND status = 'executed' \
    AND refresh_state_b64u = $14 AND refresh_state_digest_hex = $15 \
    AND NOT EXISTS (SELECT 1 FROM tenant_root_refresh_supersessions \
    WHERE replay_key_digest_hex = $4)";

/// The refresh replay rows of one lineage at this role, split by whether a
/// later attempt superseded them.
pub(super) const LIST_UNSUPERSEDED_REFRESH_REPLAYS_SQL: &str = "SELECT replay_key_digest_hex, \
    tenant_identity_digest_hex, custody_lineage_b64u, session_id_hex, nonce_hex, role, \
    command_digest_hex, admission_digest_hex, status, receipt_b64u, \
    receipt_digest_hex, reserved_at_ms, executed_at_ms, terminal_at_ms, \
    refresh_state_b64u, refresh_state_digest_hex \
    FROM tenant_root_command_replays AS replay WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND role = $3 AND refresh_state_b64u IS NOT NULL \
    AND NOT EXISTS (SELECT 1 FROM tenant_root_refresh_supersessions AS superseded \
    WHERE superseded.replay_key_digest_hex = replay.replay_key_digest_hex)";

pub(super) const LIST_SUPERSEDED_REFRESH_REPLAYS_SQL: &str = "SELECT replay_key_digest_hex, \
    tenant_identity_digest_hex, custody_lineage_b64u, session_id_hex, nonce_hex, role, \
    command_digest_hex, admission_digest_hex, status, receipt_b64u, \
    receipt_digest_hex, reserved_at_ms, executed_at_ms, terminal_at_ms, \
    refresh_state_b64u, refresh_state_digest_hex \
    FROM tenant_root_command_replays AS replay WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND role = $3 AND refresh_state_b64u IS NOT NULL \
    AND EXISTS (SELECT 1 FROM tenant_root_refresh_supersessions AS superseded \
    WHERE superseded.replay_key_digest_hex = replay.replay_key_digest_hex)";

/// Records that a later attempt superseded one refresh attempt, only while the
/// attempt's replay row still holds the exact state it was loaded with.
pub(super) const INSERT_REFRESH_SUPERSESSION_SQL: &str = "INSERT INTO tenant_root_refresh_supersessions \
    (replay_key_digest_hex, tenant_identity_digest_hex, custody_lineage_b64u, role, \
    superseded_by_replay_key_digest_hex, superseded_at_ms) \
    SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (SELECT 1 FROM tenant_root_command_replays \
    WHERE replay_key_digest_hex = $1 AND role = $4 AND status = $7 \
    AND refresh_state_digest_hex = $8) \
    ON CONFLICT(replay_key_digest_hex) DO NOTHING";

pub(super) const MARK_COMMAND_EXECUTED_SQL: &str = "UPDATE tenant_root_command_replays SET \
    status = 'executed', executed_at_ms = $9 \
    WHERE replay_key_digest_hex = $1 AND tenant_identity_digest_hex = $2 \
    AND custody_lineage_b64u = $3 AND session_id_hex = $4 AND nonce_hex = $5 \
    AND role = $6 AND command_digest_hex = $7 AND reserved_at_ms = $8 \
    AND status = 'reserved'";

pub(super) const COMMIT_COMMAND_TERMINAL_SQL: &str = "UPDATE tenant_root_command_replays SET \
    status = $1, receipt_b64u = $2, receipt_digest_hex = $3, terminal_at_ms = $4 \
    WHERE replay_key_digest_hex = $5 AND tenant_identity_digest_hex = $6 \
    AND custody_lineage_b64u = $7 AND session_id_hex = $8 AND nonce_hex = $9 \
    AND role = $10 AND command_digest_hex = $11 AND reserved_at_ms = $12 \
    AND status = $13 AND (status = 'reserved' OR executed_at_ms = $14)";

pub(super) const LOAD_RESTORE_IMPORT_KEY_BY_REPLAY_SQL: &str = "SELECT \
    tenant_identity_digest_hex, custody_lineage_b64u, restore_session_id_hex, role, generation, \
    import_key_id, replay_key_digest_hex, command_digest_hex, operation_digest_hex, recovery_set_id_b64u, \
    manifest_digest_hex, stable_root_commitment_b64u, share_commitment_b64u, \
    destination_fingerprint_hex, public_key_b64u, encrypted_ikm_json, envelope_digest_hex, \
    encrypted_imported_share_json, issued_at_ms, expires_at_ms, lifecycle, installed_at_ms, \
    receipt_digest_hex, created_at_ms, updated_at_ms \
    FROM tenant_root_restore_import_keys WHERE replay_key_digest_hex = $1";

pub(super) const LOAD_RESTORE_IMPORT_KEY_CURRENT_SQL: &str = "SELECT \
    tenant_identity_digest_hex, custody_lineage_b64u, restore_session_id_hex, role, generation, \
    import_key_id, replay_key_digest_hex, command_digest_hex, operation_digest_hex, recovery_set_id_b64u, \
    manifest_digest_hex, stable_root_commitment_b64u, share_commitment_b64u, \
    destination_fingerprint_hex, public_key_b64u, encrypted_ikm_json, envelope_digest_hex, \
    encrypted_imported_share_json, issued_at_ms, expires_at_ms, lifecycle, installed_at_ms, \
    receipt_digest_hex, created_at_ms, updated_at_ms \
    FROM tenant_root_restore_import_keys WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND restore_session_id_hex = $3 AND role = $4 \
    ORDER BY generation DESC LIMIT 1";

pub(super) const LOAD_RESTORE_IMPORT_SESSION_TOMBSTONE_SQL: &str = "SELECT closed_at_ms, role, \
    activation_operation, activation_receipt_b64u, activation_receipt_digest_hex, \
    cleanup_receipt_b64u, cleanup_receipt_digest_hex \
    FROM tenant_root_restore_import_sessions WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND restore_session_id_hex = $3";

pub(super) const LOAD_RESTORE_IMPORT_SESSION_CLOSED_SQL: &str = "SELECT closed_at_ms \
    FROM tenant_root_restore_import_sessions WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND restore_session_id_hex = $3";

pub(super) const INSERT_RESTORE_IMPORT_KEY_SQL: &str = "INSERT INTO tenant_root_restore_import_keys (\
    tenant_identity_digest_hex, custody_lineage_b64u, restore_session_id_hex, role, generation, \
    import_key_id, replay_key_digest_hex, command_digest_hex, operation_digest_hex, recovery_set_id_b64u, \
    manifest_digest_hex, stable_root_commitment_b64u, share_commitment_b64u, \
    destination_fingerprint_hex, public_key_b64u, encrypted_ikm_json, issued_at_ms, \
    expires_at_ms, lifecycle, created_at_ms, updated_at_ms) SELECT \
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, \
    'issued', $17, $17 WHERE NOT EXISTS (SELECT 1 FROM tenant_root_restore_import_sessions \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
    AND restore_session_id_hex = $3) ON CONFLICT(replay_key_digest_hex) DO NOTHING";

pub(super) const SUPERSEDE_RESTORE_IMPORT_KEY_SQL: &str = "UPDATE tenant_root_restore_import_keys \
    SET lifecycle = 'superseded', updated_at_ms = $6 WHERE tenant_identity_digest_hex = $1 \
    AND custody_lineage_b64u = $2 AND restore_session_id_hex = $3 AND role = $4 \
    AND generation = $5 AND lifecycle IN ('issued', 'expired')";

pub(super) const INSERT_RESTORE_IMPORT_SESSION_TOMBSTONE_SQL: &str = "INSERT INTO \
    tenant_root_restore_import_sessions (tenant_identity_digest_hex, custody_lineage_b64u, \
    restore_session_id_hex, closed_at_ms, role, activation_operation, \
    activation_receipt_b64u, activation_receipt_digest_hex, cleanup_receipt_b64u, \
    cleanup_receipt_digest_hex) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
    ON CONFLICT DO NOTHING";

pub(super) const CLOSE_RESTORE_IMPORT_KEYS_SQL: &str = "UPDATE tenant_root_restore_import_keys SET \
    lifecycle = 'closed', encrypted_ikm_json = NULL, installed_at_ms = NULL, \
    envelope_digest_hex = NULL, encrypted_imported_share_json = NULL, receipt_digest_hex = NULL, \
    updated_at_ms = $4 \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
    AND restore_session_id_hex = $3 AND role = $5 AND lifecycle <> 'closed'";

pub(super) const ACCEPT_RESTORE_IMPORT_KEY_SQL: &str = "UPDATE tenant_root_restore_import_keys SET \
    lifecycle = 'installed', envelope_digest_hex = $1, encrypted_imported_share_json = $2, \
    installed_at_ms = $3, receipt_digest_hex = $4, updated_at_ms = $5 \
    WHERE tenant_identity_digest_hex = $6 AND custody_lineage_b64u = $7 \
    AND restore_session_id_hex = $8 AND role = $9 AND generation = $10 \
    AND import_key_id = $11 AND replay_key_digest_hex = $12 \
    AND command_digest_hex = $13 AND operation_digest_hex = $14 \
    AND lifecycle = 'issued' AND encrypted_ikm_json IS NOT NULL \
    AND CAST($5 AS BIGINT) < expires_at_ms \
    AND NOT EXISTS (SELECT 1 FROM tenant_root_restore_import_sessions \
        WHERE tenant_identity_digest_hex = $6 AND custody_lineage_b64u = $7 \
        AND restore_session_id_hex = $8)";

pub(super) const LOAD_RESTORE_REFRESH_ATTEMPT_SQL: &str = "SELECT \
    tenant_identity_digest_hex, custody_lineage_b64u, restore_session_id_hex, role, generation, \
    import_key_id, import_replay_key_digest_hex, import_command_digest_hex, \
    import_operation_digest_hex, recovery_set_id_b64u, manifest_digest_hex, \
    stable_root_commitment_b64u, share_commitment_b64u, destination_fingerprint_hex, \
    import_public_key_b64u, import_issued_at_ms, import_expires_at_ms, \
    refresh_command_digest_hex, refresh_issued_at_ms, refresh_expires_at_ms, \
    admitted_at_ms, encrypted_seed_json, \
    encrypted_refreshed_share_json, installation_evidence_b64u, \
    installation_evidence_digest_hex, lifecycle, refreshed_at_ms, created_at_ms, updated_at_ms \
    , promotion_lifecycle, promotion_reserved_at_ms, encrypted_online_role_share_json, \
    provider_canary_receipt_b64u, promotion_completed_at_ms \
    FROM tenant_root_restore_refresh_attempts \
    WHERE import_replay_key_digest_hex = $1";

pub(super) const LOAD_RESTORE_REFRESH_ATTEMPT_BY_COMMAND_SQL: &str = "SELECT \
    tenant_identity_digest_hex, custody_lineage_b64u, restore_session_id_hex, role, generation, \
    import_key_id, import_replay_key_digest_hex, import_command_digest_hex, \
    import_operation_digest_hex, recovery_set_id_b64u, manifest_digest_hex, \
    stable_root_commitment_b64u, share_commitment_b64u, destination_fingerprint_hex, \
    import_public_key_b64u, import_issued_at_ms, import_expires_at_ms, \
    refresh_command_digest_hex, refresh_issued_at_ms, refresh_expires_at_ms, \
    admitted_at_ms, encrypted_seed_json, \
    encrypted_refreshed_share_json, installation_evidence_b64u, \
    installation_evidence_digest_hex, lifecycle, refreshed_at_ms, created_at_ms, updated_at_ms, \
    promotion_lifecycle, promotion_reserved_at_ms, encrypted_online_role_share_json, \
    provider_canary_receipt_b64u, promotion_completed_at_ms \
    FROM tenant_root_restore_refresh_attempts \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
      AND restore_session_id_hex = $3 AND role = $4 AND refresh_command_digest_hex = $5";

pub(super) const INSERT_RESTORE_REFRESH_ATTEMPT_SQL: &str = "INSERT INTO \
    tenant_root_restore_refresh_attempts (tenant_identity_digest_hex, custody_lineage_b64u, \
    restore_session_id_hex, role, generation, import_key_id, import_replay_key_digest_hex, \
    import_command_digest_hex, import_operation_digest_hex, recovery_set_id_b64u, \
    manifest_digest_hex, stable_root_commitment_b64u, share_commitment_b64u, \
    destination_fingerprint_hex, import_public_key_b64u, import_issued_at_ms, \
    import_expires_at_ms, refresh_command_digest_hex, refresh_issued_at_ms, \
    refresh_expires_at_ms, admitted_at_ms, encrypted_seed_json, lifecycle, \
    created_at_ms, updated_at_ms) SELECT \
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, \
    $17, $18, $19, $20, $21, $22, 'pending', $21, $21 \
    WHERE NOT EXISTS (SELECT 1 FROM tenant_root_restore_import_sessions \
      WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
        AND restore_session_id_hex = $3) \
    ON CONFLICT(import_replay_key_digest_hex) DO NOTHING";

pub(super) const FINALIZE_RESTORE_REFRESH_ATTEMPT_SQL: &str = "UPDATE \
    tenant_root_restore_refresh_attempts SET lifecycle = 'refreshed', \
    encrypted_refreshed_share_json = $1, \
    installation_evidence_b64u = $2, installation_evidence_digest_hex = $3, \
    refreshed_at_ms = $4, updated_at_ms = $4 \
    WHERE tenant_identity_digest_hex = $5 AND custody_lineage_b64u = $6 \
      AND restore_session_id_hex = $7 AND role = $8 AND generation = $9 \
      AND import_key_id = $10 AND import_replay_key_digest_hex = $11 \
      AND import_command_digest_hex = $12 AND refresh_command_digest_hex = $13 \
      AND refresh_issued_at_ms = $14 AND refresh_expires_at_ms = $15 \
      AND lifecycle = 'pending' AND NOT EXISTS (SELECT 1 \
        FROM tenant_root_restore_import_sessions \
        WHERE tenant_identity_digest_hex = $5 AND custody_lineage_b64u = $6 \
          AND restore_session_id_hex = $7)";

pub(super) const CLOSE_RESTORE_REFRESH_ATTEMPTS_SQL: &str = "UPDATE \
    tenant_root_restore_refresh_attempts SET lifecycle = 'closed', \
    encrypted_seed_json = NULL, encrypted_refreshed_share_json = NULL, \
    installation_evidence_b64u = NULL, installation_evidence_digest_hex = NULL, \
    refreshed_at_ms = NULL, promotion_lifecycle = 'unstarted', \
    promotion_reserved_at_ms = NULL, encrypted_online_role_share_json = NULL, \
    provider_canary_receipt_b64u = NULL, promotion_completed_at_ms = NULL, updated_at_ms = $4 \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
      AND restore_session_id_hex = $3 AND role = $5 AND lifecycle <> 'closed'";

pub(super) const RESERVE_RESTORE_REFRESH_PROMOTION_SQL: &str = "UPDATE \
    tenant_root_restore_refresh_attempts SET promotion_lifecycle = 'reserved', \
    promotion_reserved_at_ms = $6, updated_at_ms = $6 \
    WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
      AND restore_session_id_hex = $3 AND role = $4 AND refresh_command_digest_hex = $5 \
      AND lifecycle = 'refreshed' AND promotion_lifecycle = 'unstarted' \
      AND promotion_reserved_at_ms IS NULL AND encrypted_online_role_share_json IS NULL \
      AND provider_canary_receipt_b64u IS NULL AND promotion_completed_at_ms IS NULL \
      AND NOT EXISTS (SELECT 1 FROM tenant_root_restore_import_sessions \
        WHERE tenant_identity_digest_hex = $1 AND custody_lineage_b64u = $2 \
          AND restore_session_id_hex = $3)";

pub(super) const COMPLETE_RESTORE_REFRESH_PROMOTION_SQL: &str = "UPDATE \
    tenant_root_restore_refresh_attempts SET encrypted_online_role_share_json = $1, \
    provider_canary_receipt_b64u = $2, promotion_completed_at_ms = $3, \
    promotion_lifecycle = 'completed', updated_at_ms = $3 \
    WHERE tenant_identity_digest_hex = $4 AND custody_lineage_b64u = $5 \
      AND restore_session_id_hex = $6 AND role = $7 AND refresh_command_digest_hex = $8 \
      AND lifecycle = 'refreshed' AND promotion_lifecycle = 'reserved' \
      AND promotion_reserved_at_ms = $9 AND encrypted_online_role_share_json IS NULL \
      AND provider_canary_receipt_b64u IS NULL AND promotion_completed_at_ms IS NULL";

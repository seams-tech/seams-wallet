//! Destination bootstrap authority, restore admission, and role import keys.

use core::num::NonZeroU64;

use rand_chacha_09::ChaCha20Rng;
use rand_core_09::SeedableRng;
use router_ab_core::{
    authenticate_destination_bootstrap_v1, issue_role_import_key_v1,
    restore_session_binding_digest_v1, restore_session_expired_v1, role_import_key_is_current_v1,
    DestinationBootstrapAuthorityV1, DestinationBootstrapTokenV1, RoleImportKeyIssueRefusalV1,
    TenantRootRestoreDestinationFingerprintV1, TenantRootRestoreSessionIdV1,
    TENANT_ROOT_RESTORE_ADMIN_SESSION_MS_V1, TENANT_ROOT_RESTORE_SESSION_MS_V1,
    TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1,
};
use threshold_prf::TwoPartyDeriverRole;

const NOW_MS: i64 = 1_788_000_000_000;

fn fingerprint(seed: u8) -> TenantRootRestoreDestinationFingerprintV1 {
    TenantRootRestoreDestinationFingerprintV1::from_bytes([seed; 32]).expect("fingerprint")
}

fn initialize(
    seed: u8,
    destination: u8,
) -> (DestinationBootstrapAuthorityV1, DestinationBootstrapTokenV1) {
    DestinationBootstrapAuthorityV1::initialize(
        fingerprint(destination),
        &mut ChaCha20Rng::from_seed([seed; 32]),
    )
    .expect("bootstrap authority")
}

#[test]
fn the_authority_stores_a_digest_and_verifies_in_place() {
    let (authority, token) = initialize(0x11, 0x66);
    assert_eq!(authority.deployment_fingerprint(), fingerprint(0x66));
    assert!(authority.verify(fingerprint(0x66), &token).is_ok());

    // The stored digest is not the token.
    assert_ne!(authority.token_digest().as_slice(), token.expose_once());
    // Nothing in the debug rendering leaks the token.
    assert!(!format!("{token:?}").contains("expose"));
    assert!(format!("{token:?}").contains("[redacted]"));
}

#[test]
fn a_digest_from_another_deployment_cannot_be_replayed() {
    let (authority, token) = initialize(0x11, 0x66);

    // The same token against a different deployment fingerprint.
    assert!(authority.verify(fingerprint(0x67), &token).is_err());

    // Another deployment's authority with this token.
    let (other_authority, _other_token) = initialize(0x12, 0x67);
    assert!(other_authority.verify(fingerprint(0x67), &token).is_err());

    // A wrong token against the right deployment.
    let wrong = DestinationBootstrapTokenV1::from_bytes([0x22; 32]).expect("token");
    assert!(authority.verify(fingerprint(0x66), &wrong).is_err());
    assert!(DestinationBootstrapTokenV1::from_bytes([0; 32]).is_err());
}

#[test]
fn a_session_is_live_for_thirty_minutes_but_activates_for_only_five() {
    let (authority, token) = initialize(0x11, 0x66);
    let session =
        authenticate_destination_bootstrap_v1(&authority, fingerprint(0x66), &token, NOW_MS)
            .expect("session");

    assert!(session.is_live_at(NOW_MS));
    assert!(session.is_live_at(NOW_MS + TENANT_ROOT_RESTORE_ADMIN_SESSION_MS_V1 - 1));
    assert!(!session.is_live_at(NOW_MS + TENANT_ROOT_RESTORE_ADMIN_SESSION_MS_V1));

    // Activation needs recent reauthentication, not merely a live session.
    assert!(session.permits_activation_at(NOW_MS));
    assert!(session.permits_activation_at(NOW_MS + 300_000));
    assert!(!session.permits_activation_at(NOW_MS + 300_001));
    assert!(session.is_live_at(NOW_MS + 300_001));
}

#[test]
fn reissuing_a_role_import_key_invalidates_its_predecessor() {
    let (authority, token) = initialize(0x11, 0x66);
    let session =
        authenticate_destination_bootstrap_v1(&authority, fingerprint(0x66), &token, NOW_MS)
            .expect("session");

    let first = issue_role_import_key_v1(
        &session,
        TwoPartyDeriverRole::DeriverA,
        "import-key-a-1",
        None,
        false,
        NOW_MS,
    )
    .expect("first key");
    assert_eq!(first.generation().get(), 1);
    assert!(first.is_live_at(NOW_MS + TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1 - 1));
    assert!(!first.is_live_at(NOW_MS + TENANT_ROOT_ROLE_IMPORT_KEY_MS_V1));

    let second = issue_role_import_key_v1(
        &session,
        TwoPartyDeriverRole::DeriverA,
        "import-key-a-2",
        Some(&first),
        false,
        NOW_MS + 1_000,
    )
    .expect("second key");
    assert_eq!(second.generation().get(), 2);

    // The predecessor is invalid immediately, well inside its own lifetime.
    assert!(!role_import_key_is_current_v1(
        &second,
        first.key_id(),
        first.generation(),
        NOW_MS + 1_000
    ));
    assert!(role_import_key_is_current_v1(
        &second,
        second.key_id(),
        second.generation(),
        NOW_MS + 1_000
    ));
    // A live key with the right id but a stale generation is still refused.
    assert!(!role_import_key_is_current_v1(
        &second,
        second.key_id(),
        NonZeroU64::new(1).unwrap(),
        NOW_MS + 1_000
    ));
}

#[test]
fn no_key_is_issued_for_a_role_that_already_installed_its_share() {
    let (authority, token) = initialize(0x11, 0x66);
    let session =
        authenticate_destination_bootstrap_v1(&authority, fingerprint(0x66), &token, NOW_MS)
            .expect("session");

    assert_eq!(
        issue_role_import_key_v1(
            &session,
            TwoPartyDeriverRole::DeriverB,
            "import-key-b-1",
            None,
            true,
            NOW_MS,
        ),
        Err(RoleImportKeyIssueRefusalV1::RoleAlreadyInstalled)
    );

    assert_eq!(
        issue_role_import_key_v1(
            &session,
            TwoPartyDeriverRole::DeriverB,
            "import-key-b-1",
            None,
            false,
            NOW_MS + TENANT_ROOT_RESTORE_ADMIN_SESSION_MS_V1,
        ),
        Err(RoleImportKeyIssueRefusalV1::SessionExpired)
    );
}

#[test]
fn a_restore_session_expires_after_twenty_four_hours() {
    assert!(!restore_session_expired_v1(NOW_MS, NOW_MS));
    assert!(!restore_session_expired_v1(
        NOW_MS,
        NOW_MS + TENANT_ROOT_RESTORE_SESSION_MS_V1 - 1
    ));
    assert!(restore_session_expired_v1(
        NOW_MS,
        NOW_MS + TENANT_ROOT_RESTORE_SESSION_MS_V1
    ));
}

#[test]
fn a_session_binding_is_specific_to_its_destination() {
    let session_id = TenantRootRestoreSessionIdV1::from_bytes([0x68; 16]).expect("session id");
    let here = restore_session_binding_digest_v1(fingerprint(0x66), session_id);
    let elsewhere = restore_session_binding_digest_v1(fingerprint(0x67), session_id);
    assert_ne!(here, elsewhere);
    assert_eq!(
        here,
        restore_session_binding_digest_v1(fingerprint(0x66), session_id)
    );
}

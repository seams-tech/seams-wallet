//! Destination bootstrap authority, restore admission, and role import keys.

use rand_chacha_09::ChaCha20Rng;
use rand_core_09::SeedableRng;
use router_ab_core::{
    restore_session_expired_v1, DestinationBootstrapAuthorityV1, DestinationBootstrapTokenV1,
    TenantRootRestoreDestinationFingerprintV1, TENANT_ROOT_RESTORE_SESSION_MS_V1,
};

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

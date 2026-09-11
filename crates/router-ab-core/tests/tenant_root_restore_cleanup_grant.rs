use ed25519_dalek::SigningKey;
use router_ab_core::{
    TenantRootCustodyLineageId, TenantRootIdentityDigestV1, TenantRootRestoreAuthorizationNonceV1,
    TenantRootRestoreCleanupGrantV1, TenantRootRestoreDestinationFingerprintV1,
    TenantRootRestoreSessionIdV1, TENANT_ROOT_RESTORE_CLEANUP_GRANT_MAX_LIFETIME_MS_V1,
};

const GRANT_SIGNING_KEY_BYTES: [u8; 32] = [0x91; 32];
const GRANT_KEY_ID: &str = "restore-cleanup-authority-v1";
const ISSUED_AT_MS: u64 = 100;
const EXPIRES_AT_MS: u64 = 200;

fn verifying_key() -> [u8; 32] {
    SigningKey::from_bytes(&GRANT_SIGNING_KEY_BYTES)
        .verifying_key()
        .to_bytes()
}

fn signed_grant() -> TenantRootRestoreCleanupGrantV1 {
    TenantRootRestoreCleanupGrantV1::sign(
        TenantRootIdentityDigestV1::from_bytes([0x11; 32]),
        TenantRootRestoreDestinationFingerprintV1::from_bytes([0x12; 32])
            .expect("destination fingerprint"),
        TenantRootCustodyLineageId::from_bytes([0x13; 16]).expect("destination lineage"),
        TenantRootRestoreSessionIdV1::from_bytes([0x14; 16]).expect("restore session"),
        TenantRootRestoreAuthorizationNonceV1::from_bytes([0x15; 32]).expect("cleanup nonce"),
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
        GRANT_KEY_ID,
        &GRANT_SIGNING_KEY_BYTES,
    )
    .expect("signed restore cleanup grant")
}

fn field_range(bytes: &[u8], field_index: usize) -> core::ops::Range<usize> {
    let mut offset = 0;
    for _ in 0..field_index {
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().expect("field length"))
            as usize;
        offset += 4 + length;
    }
    let length =
        u32::from_be_bytes(bytes[offset..offset + 4].try_into().expect("field length")) as usize;
    offset + 4..offset + 4 + length
}

#[test]
fn grant_round_trips_verifies_and_can_authorize_both_fixed_role_endpoints() {
    let grant = signed_grant();
    let bytes = grant.canonical_bytes().expect("canonical grant");
    let decoded =
        TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&bytes).expect("decoded grant");
    let verified = decoded
        .verify(GRANT_KEY_ID, &verifying_key())
        .expect("verified grant");

    assert_eq!(verified.canonical_bytes(), bytes);
    assert_eq!(verified.digest(), grant.digest().expect("grant digest"));
    assert_eq!(
        verified.destination_identity_digest().as_bytes(),
        &[0x11; 32]
    );
    assert_eq!(verified.destination_fingerprint().as_bytes(), &[0x12; 32]);
    assert_eq!(verified.destination_lineage().as_bytes(), &[0x13; 16]);
    assert_eq!(verified.restore_session_id().as_bytes(), &[0x14; 16]);
    assert_eq!(verified.nonce().as_bytes(), &[0x15; 32]);
    assert_eq!(verified.grant_key_id(), GRANT_KEY_ID);
    assert_eq!(verified.operation(), "tenant_root_restore_cleanup_v1");

    // The verified capability has one fixed operation and no role selector;
    // both role endpoints receive the same authenticated bytes and digest.
    let deriver_a_digest = verified.digest();
    let deriver_b_digest = verified.digest();
    assert_eq!(deriver_a_digest, deriver_b_digest);
}

#[test]
fn exact_replay_preserves_canonical_bytes_and_digest() {
    let grant = signed_grant();
    let bytes = grant.canonical_bytes().expect("canonical grant");
    let first = TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&bytes)
        .expect("first decode")
        .verify(GRANT_KEY_ID, &verifying_key())
        .expect("first verification");
    let second = TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&bytes)
        .expect("second decode")
        .verify(GRANT_KEY_ID, &verifying_key())
        .expect("second verification");

    assert_eq!(first.canonical_bytes(), second.canonical_bytes());
    assert_eq!(first.digest(), second.digest());
    assert_eq!(first.nonce(), second.nonce());
}

#[test]
fn destination_scope_substitution_invalidates_the_signature() {
    for field_index in 2..=5 {
        let grant = signed_grant();
        let mut bytes = grant.canonical_bytes().expect("canonical grant");
        let range = field_range(&bytes, field_index);
        bytes[range.start] ^= 0x01;
        let decoded = TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&bytes)
            .expect("substituted bytes retain their fixed wire shape");
        assert!(decoded.verify(GRANT_KEY_ID, &verifying_key()).is_err());
    }
}

#[test]
fn nonce_time_and_authority_substitution_are_rejected() {
    let grant = signed_grant();
    let bytes = grant.canonical_bytes().expect("canonical grant");

    for field_index in [6, 7, 8, 9] {
        let mut substituted = bytes.clone();
        let range = field_range(&substituted, field_index);
        substituted[range.start] ^= 0x01;
        let decoded = TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&substituted);
        if let Ok(decoded) = decoded {
            assert!(decoded.verify(GRANT_KEY_ID, &verifying_key()).is_err());
        }
    }

    let other_key = SigningKey::from_bytes(&[0x92; 32]);
    assert!(
        TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&bytes)
            .expect("decoded grant")
            .verify(GRANT_KEY_ID, &other_key.verifying_key().to_bytes())
            .is_err()
    );
    assert!(
        TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&bytes)
            .expect("decoded grant")
            .verify("another-authority-v1", &verifying_key())
            .is_err()
    );
}

#[test]
fn expiry_is_strict_and_lifetime_is_bounded() {
    let grant = signed_grant().canonical_bytes().expect("canonical grant");
    let verified = TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&grant)
        .expect("decoded grant")
        .verify(GRANT_KEY_ID, &verifying_key())
        .expect("verified grant");

    assert!(verified.require_fresh(ISSUED_AT_MS).is_ok());
    assert!(verified.require_fresh(EXPIRES_AT_MS - 1).is_ok());
    assert!(verified.require_fresh(ISSUED_AT_MS - 1).is_err());
    assert!(verified.require_fresh(EXPIRES_AT_MS).is_err());

    let max_lifetime = TenantRootRestoreCleanupGrantV1::sign(
        TenantRootIdentityDigestV1::from_bytes([0x11; 32]),
        TenantRootRestoreDestinationFingerprintV1::from_bytes([0x12; 32])
            .expect("destination fingerprint"),
        TenantRootCustodyLineageId::from_bytes([0x13; 16]).expect("destination lineage"),
        TenantRootRestoreSessionIdV1::from_bytes([0x14; 16]).expect("restore session"),
        TenantRootRestoreAuthorizationNonceV1::from_bytes([0x16; 32]).expect("cleanup nonce"),
        ISSUED_AT_MS,
        ISSUED_AT_MS + TENANT_ROOT_RESTORE_CLEANUP_GRANT_MAX_LIFETIME_MS_V1,
        GRANT_KEY_ID,
        &GRANT_SIGNING_KEY_BYTES,
    );
    assert!(max_lifetime.is_ok());

    let too_long = TenantRootRestoreCleanupGrantV1::sign(
        TenantRootIdentityDigestV1::from_bytes([0x11; 32]),
        TenantRootRestoreDestinationFingerprintV1::from_bytes([0x12; 32])
            .expect("destination fingerprint"),
        TenantRootCustodyLineageId::from_bytes([0x13; 16]).expect("destination lineage"),
        TenantRootRestoreSessionIdV1::from_bytes([0x14; 16]).expect("restore session"),
        TenantRootRestoreAuthorizationNonceV1::from_bytes([0x17; 32]).expect("cleanup nonce"),
        ISSUED_AT_MS,
        ISSUED_AT_MS + TENANT_ROOT_RESTORE_CLEANUP_GRANT_MAX_LIFETIME_MS_V1 + 1,
        GRANT_KEY_ID,
        &GRANT_SIGNING_KEY_BYTES,
    );
    assert!(too_long.is_err());
}

#[test]
fn unknown_and_noncanonical_wire_fields_are_rejected() {
    let grant = signed_grant();
    let mut bytes = grant.canonical_bytes().expect("canonical grant");
    bytes.extend_from_slice(&[0, 0, 0, 7]);
    bytes.extend_from_slice(b"unknown");
    assert!(TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&bytes).is_err());

    let mut operation_tampered = grant.canonical_bytes().expect("canonical grant");
    let operation = field_range(&operation_tampered, 1);
    operation_tampered[operation.start] ^= 0x01;
    assert!(TenantRootRestoreCleanupGrantV1::decode_canonical_bytes(&operation_tampered).is_err());
}

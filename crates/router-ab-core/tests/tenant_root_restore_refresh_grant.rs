use ed25519_dalek::SigningKey;
use router_ab_core::{
    tenant_root_restore_refresh_ceremony_session_id_v1, TenantRootCustodyLineageId,
    TenantRootIdentityDigestV1, TenantRootLifecycleReceiptDigestV1, TenantRootProtocolDigestV1,
    TenantRootRestoreAuthorizationNonceV1, TenantRootRestoreDestinationFingerprintV1,
    TenantRootRestoreRefreshGrantV1, TenantRootRestoreSessionIdV1,
};

const GRANT_SIGNING_KEY_BYTES: [u8; 32] = [0x71; 32];
const GRANT_KEY_ID: &str = "restore-refresh-authority-v1";

fn signed_grant() -> TenantRootRestoreRefreshGrantV1 {
    TenantRootRestoreRefreshGrantV1::sign(
        TenantRootProtocolDigestV1::from_bytes([0x11; 32]).expect("operation digest"),
        TenantRootIdentityDigestV1::from_bytes([0x12; 32]),
        TenantRootRestoreDestinationFingerprintV1::from_bytes([0x13; 32])
            .expect("destination fingerprint"),
        TenantRootCustodyLineageId::from_bytes([0x14; 16]).expect("destination lineage"),
        TenantRootRestoreSessionIdV1::from_bytes([0x15; 16]).expect("restore session"),
        [0x16; 32],
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x17; 32]).expect("Deriver A receipt"),
        TenantRootLifecycleReceiptDigestV1::from_bytes([0x18; 32]).expect("Deriver B receipt"),
        TenantRootRestoreAuthorizationNonceV1::from_bytes([0x19; 32])
            .expect("restore refresh nonce"),
        100,
        200,
        GRANT_KEY_ID,
        &GRANT_SIGNING_KEY_BYTES,
    )
    .expect("signed restore refresh grant")
}

#[test]
fn grant_round_trips_verifies_and_checks_freshness() {
    let grant = signed_grant();
    let bytes = grant.canonical_bytes().expect("canonical grant");
    let decoded =
        TenantRootRestoreRefreshGrantV1::decode_canonical_bytes(&bytes).expect("decoded grant");
    let signing_key = SigningKey::from_bytes(&GRANT_SIGNING_KEY_BYTES);
    let verified = decoded
        .verify(GRANT_KEY_ID, signing_key.verifying_key().as_bytes())
        .expect("verified grant");

    assert_eq!(verified.canonical_bytes(), bytes);
    assert_eq!(verified.digest(), grant.digest().expect("grant digest"));
    assert_eq!(verified.operation_digest().as_bytes(), &[0x11; 32]);
    assert_eq!(
        verified.destination_identity_digest(),
        TenantRootIdentityDigestV1::from_bytes([0x12; 32])
    );
    assert_eq!(verified.manifest_digest(), &[0x16; 32]);
    assert_eq!(
        verified.deriver_a_acceptance_receipt_digest().as_bytes(),
        &[0x17; 32]
    );
    assert_eq!(
        verified.deriver_b_acceptance_receipt_digest().as_bytes(),
        &[0x18; 32]
    );
    assert!(verified.require_fresh(100).is_ok());
    assert!(verified.require_fresh(199).is_ok());
    assert!(verified.require_fresh(99).is_err());
    assert!(verified.require_fresh(200).is_err());
}

#[test]
fn tampering_invalidates_the_signed_grant() {
    let grant = signed_grant();
    let mut bytes = grant.canonical_bytes().expect("canonical grant");
    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    let decoded = TenantRootRestoreRefreshGrantV1::decode_canonical_bytes(&bytes)
        .expect("tampered bytes retain a valid wire shape");
    let signing_key = SigningKey::from_bytes(&GRANT_SIGNING_KEY_BYTES);

    assert!(decoded
        .verify(GRANT_KEY_ID, signing_key.verifying_key().as_bytes())
        .is_err());
}

#[test]
fn deterministic_ceremony_session_reproduces_from_the_verified_bytes() {
    let grant = signed_grant();
    let bytes = grant.canonical_bytes().expect("canonical grant");
    let signing_key = SigningKey::from_bytes(&GRANT_SIGNING_KEY_BYTES);
    let verified = TenantRootRestoreRefreshGrantV1::decode_canonical_bytes(&bytes)
        .expect("decoded grant")
        .verify(GRANT_KEY_ID, signing_key.verifying_key().as_bytes())
        .expect("verified grant");

    let session_a = tenant_root_restore_refresh_ceremony_session_id_v1(&verified)
        .expect("Deriver A ceremony session");
    let session_b = tenant_root_restore_refresh_ceremony_session_id_v1(&verified)
        .expect("Deriver B ceremony session");
    assert_eq!(session_a, session_b);
    assert_eq!(
        session_a,
        verified.ceremony_session_id().expect("session method")
    );
}

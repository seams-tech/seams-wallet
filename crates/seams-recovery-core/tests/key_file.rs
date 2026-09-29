use rand_chacha_09::ChaCha20Rng;
use rand_core_09::SeedableRng;
use router_ab_core::TwoPartyDeriverRole;
use seams_recovery_core::{RecoveryKeyFileV1, RECOVERY_KEY_FILE_MAX_BYTES};

fn key_file(role: TwoPartyDeriverRole, seed: u8) -> RecoveryKeyFileV1 {
    RecoveryKeyFileV1::create(role, &mut ChaCha20Rng::from_seed([seed; 32]))
        .expect("key file")
        .0
}

#[test]
fn a_saved_key_opens_without_a_password_and_preserves_its_public_identity() {
    let original = key_file(TwoPartyDeriverRole::DeriverA, 0x21);
    let bytes = original.to_bytes().unwrap();
    assert_eq!(bytes.len(), RECOVERY_KEY_FILE_MAX_BYTES);
    let restored = RecoveryKeyFileV1::decode(&bytes).unwrap();
    assert_eq!(restored.role(), original.role());
    assert_eq!(
        restored.open().unwrap().fingerprint(),
        original.fingerprint()
    );
    assert_eq!(restored.to_bytes().unwrap(), bytes);
}

#[test]
fn malformed_files_and_inconsistent_public_metadata_are_rejected() {
    let bytes = key_file(TwoPartyDeriverRole::DeriverA, 0x26)
        .to_bytes()
        .unwrap();
    for offset in [0, 9, 41, 73] {
        let mut corrupted = bytes.clone();
        corrupted[offset] ^= 1;
        assert!(RecoveryKeyFileV1::decode(&corrupted).is_err());
    }
    let mut invalid_role = bytes.clone();
    invalid_role[8] = 0;
    assert!(RecoveryKeyFileV1::decode(&invalid_role).is_err());
    assert!(RecoveryKeyFileV1::decode(&[]).is_err());
    assert!(RecoveryKeyFileV1::decode(&bytes[..bytes.len() - 1]).is_err());
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(RecoveryKeyFileV1::decode(&trailing).is_err());
}

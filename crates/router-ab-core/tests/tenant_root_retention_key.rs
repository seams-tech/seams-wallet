//! Role- and set-isolated retention keys: what destroying one version means.

use core::num::NonZeroU64;

use rand_chacha_09::ChaCha20Rng;
use rand_core_09::SeedableRng;
use router_ab_core::{
    TenantRootRecoverySetId, TenantRootRetainedPackageV1, TenantRootRetentionKeyIdV1,
    TenantRootRetentionKeySecretV1,
};
use threshold_prf::TwoPartyDeriverRole;

const PACKAGE: &[u8] = b"SEAMSRB1 already encrypted to the tenant recipient key";

fn rng(seed: u8) -> ChaCha20Rng {
    ChaCha20Rng::from_seed([seed; 32])
}

fn set(seed: u8) -> TenantRootRecoverySetId {
    TenantRootRecoverySetId::from_bytes([seed; 16]).expect("recovery set id")
}

fn version(value: u64) -> NonZeroU64 {
    NonZeroU64::new(value).expect("version")
}

fn key_id(
    set_seed: u8,
    role: TwoPartyDeriverRole,
    version_value: u64,
) -> TenantRootRetentionKeyIdV1 {
    TenantRootRetentionKeyIdV1::new(set(set_seed), role, version(version_value))
}

#[test]
fn a_wrapped_package_opens_only_under_its_own_key_version() {
    let id = key_id(0x41, TwoPartyDeriverRole::DeriverA, 1);
    let secret = TenantRootRetentionKeySecretV1::provision(id, &mut rng(0x11));
    let retained = secret.wrap(PACKAGE, &mut rng(0x12)).expect("wrap");

    assert_eq!(retained.retention_key_id(), id);
    assert_ne!(retained.ciphertext(), PACKAGE);
    assert_eq!(
        secret.unwrap(&retained).expect("unwrap").as_slice(),
        PACKAGE
    );

    // The other role's key cannot open it, even in the same recovery set.
    let other_role = TenantRootRetentionKeySecretV1::provision(
        key_id(0x41, TwoPartyDeriverRole::DeriverB, 1),
        &mut rng(0x13),
    );
    assert!(other_role.unwrap(&retained).is_err());

    // Nor can the same role's key in another recovery set.
    let other_set = TenantRootRetentionKeySecretV1::provision(
        key_id(0x42, TwoPartyDeriverRole::DeriverA, 1),
        &mut rng(0x14),
    );
    assert!(other_set.unwrap(&retained).is_err());

    // Nor a later version of the same role and set.
    let next_version = TenantRootRetentionKeySecretV1::provision(
        key_id(0x41, TwoPartyDeriverRole::DeriverA, 2),
        &mut rng(0x15),
    );
    assert!(next_version.unwrap(&retained).is_err());
}

#[test]
fn the_key_identity_is_authenticated_not_merely_recorded() {
    let id = key_id(0x41, TwoPartyDeriverRole::DeriverA, 1);
    let secret = TenantRootRetentionKeySecretV1::provision(id, &mut rng(0x21));
    let retained = secret.wrap(PACKAGE, &mut rng(0x22)).expect("wrap");

    // Relabelling a stored package for another role does not make it openable:
    // the identity is authenticated data, not a field beside the ciphertext.
    let relabelled = TenantRootRetainedPackageV1::from_parts(
        key_id(0x41, TwoPartyDeriverRole::DeriverB, 1),
        *retained.nonce(),
        retained.ciphertext().to_vec(),
    )
    .expect("relabelled");
    let deriver_b = TenantRootRetentionKeySecretV1::provision(
        key_id(0x41, TwoPartyDeriverRole::DeriverB, 1),
        &mut rng(0x23),
    );
    assert!(deriver_b.unwrap(&relabelled).is_err());

    // A flipped ciphertext byte fails authentication rather than decrypting.
    let mut mutated = retained.ciphertext().to_vec();
    let last = mutated.len() - 1;
    mutated[last] ^= 0x01;
    let tampered =
        TenantRootRetainedPackageV1::from_parts(id, *retained.nonce(), mutated).expect("tampered");
    assert!(secret.unwrap(&tampered).is_err());
}

#[test]
fn a_zero_key_and_an_empty_package_are_refused() {
    let id = key_id(0x41, TwoPartyDeriverRole::DeriverA, 1);
    assert!(TenantRootRetentionKeySecretV1::from_provider_bytes(id, [0; 32]).is_err());

    let secret = TenantRootRetentionKeySecretV1::provision(id, &mut rng(0x51));
    assert!(secret.wrap(b"", &mut rng(0x52)).is_err());
    assert!(TenantRootRetainedPackageV1::from_parts(id, [0; 12], Vec::new()).is_err());
}

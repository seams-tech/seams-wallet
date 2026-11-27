use super::*;
use ed25519_dalek::SigningKey;
use rand_chacha::ChaCha20Rng;
use rand_core_06::SeedableRng;
use router_ab_core::{
    TenantRootCeremonyContextV1, TenantRootCeremonyEpochsV1, TenantRootCeremonyNonceV1,
    TenantRootCeremonySessionIdV1, TenantRootCreationJournalV1, TenantRootCustodyLineageId,
    TenantRootIdentityV1, TenantRootRoleCreationCommandV1,
};

pub(crate) const ISSUER_KEY: [u8; 32] = [0x41; 32];
pub(crate) const ISSUER_KEY_ID: &str = "tenant-root-issuer-v1";
const FOREIGN_ISSUER_KEY: [u8; 32] = [0x42; 32];
pub(crate) const ISSUED_AT_MS: u64 = 1_000_000;
const EXPIRES_AT_MS: u64 = 1_030_000;
const AUTHORITY: [u8; 32] = [0x44; 32];

pub(crate) fn authority() -> TenantRootControlPlaneAuthorityIdV1 {
    TenantRootControlPlaneAuthorityIdV1::from_bytes(AUTHORITY)
}

pub(crate) fn identity() -> TenantRootIdentityV1 {
    TenantRootIdentityV1::new("org-1", "project-2", "production", "root-main", "v3")
        .expect("identity")
}

pub(crate) fn role_key(role: TwoPartyDeriverRole) -> SigningKey {
    SigningKey::from_bytes(&match role {
        TwoPartyDeriverRole::DeriverA => [0xa1; 32],
        TwoPartyDeriverRole::DeriverB => [0xb1; 32],
    })
}

pub(crate) fn signing_key_id(role: TwoPartyDeriverRole) -> &'static str {
    match role {
        TwoPartyDeriverRole::DeriverA => "deriver-a-signing-key-7",
        TwoPartyDeriverRole::DeriverB => "deriver-b-signing-key-9",
    }
}

pub(crate) fn context() -> TenantRootCeremonyContextV1 {
    TenantRootCeremonyContextV1::new(
        identity().digest().expect("identity digest"),
        TenantRootCustodyLineageId::from_bytes([0x22; 16]).expect("lineage"),
        TenantRootCeremonyEpochsV1::create(),
        TenantRootCeremonySessionIdV1::from_bytes([0x11; 16]).expect("session"),
        TenantRootCeremonyNonceV1::from_bytes([0x33; 32]).expect("nonce"),
        ISSUED_AT_MS,
        EXPIRES_AT_MS,
        signing_key_id(TwoPartyDeriverRole::DeriverA),
        signing_key_id(TwoPartyDeriverRole::DeriverB),
    )
    .expect("context")
}

/// A package exactly as it reaches a Deriver over the wire.
pub(crate) fn package_bytes(role: TwoPartyDeriverRole, issuer_seed: &[u8; 32]) -> Vec<u8> {
    let context = context();
    let journal = TenantRootCreationJournalV1::started(
        identity(),
        context.custody_lineage(),
        context.clone(),
    )
    .expect("journal");
    let command = TenantRootRoleCreationCommandV1::sign(
        &journal,
        &context,
        role,
        authority(),
        ISSUED_AT_MS + 1,
        EXPIRES_AT_MS - 1,
        ISSUER_KEY_ID,
        issuer_seed,
    )
    .expect("signed command");
    TenantRootRoleCreationCommandPackageV1::new(journal, command)
        .expect("package")
        .canonical_bytes()
        .expect("package bytes")
}

pub(crate) fn trusted_issuer_keys() -> CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1 {
    let hex: String = SigningKey::from_bytes(&ISSUER_KEY)
        .verifying_key()
        .to_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    CloudflareTenantRootControlPlaneIssuerVerifyingKeysV1::decode(&format!(
        "{{\"keys\":[{{\"issuer_key_id\":\"{ISSUER_KEY_ID}\",\"verifying_key_hex\":\"{hex}\"}}]}}"
    ))
    .expect("trusted issuer keys")
}

pub(crate) fn signer(role: TwoPartyDeriverRole) -> CloudflareTenantRootCreationRoleSignerV1 {
    crate::env::test_support_tenant_root_creation_role_signer_v1(
        role,
        signing_key_id(role),
        role_key(role),
    )
}

/// Admits a package for `role`.
///
/// The seed is role-specific because each Deriver draws from its own RNG in
/// production; a shared seed would make both roles commit to the same point,
/// which the pair type correctly rejects as duplicate.
pub(crate) fn admit_for(role: TwoPartyDeriverRole) -> PendingTenantRootInitialRoleAttemptV1 {
    admit_for_with_rng(
        role,
        match role {
            TwoPartyDeriverRole::DeriverA => 0x77,
            TwoPartyDeriverRole::DeriverB => 0x88,
        },
    )
}

/// Admits a package for `role` with an explicit RNG seed, so two runs of the
/// same ceremony produce different shares.
pub(crate) fn admit_for_with_rng(
    role: TwoPartyDeriverRole,
    seed: u8,
) -> PendingTenantRootInitialRoleAttemptV1 {
    admit_tenant_root_role_creation_package_v1(
        &package_bytes(role, &ISSUER_KEY),
        role,
        authority(),
        &trusted_issuer_keys(),
        &signer(role),
        ISSUED_AT_MS + 2,
        &mut ChaCha20Rng::from_seed([seed; 32]),
    )
    .expect("admitted")
}

pub(crate) fn test_context() -> TenantRootCeremonyContextV1 {
    context()
}

pub(crate) fn test_role_key(role: TwoPartyDeriverRole) -> SigningKey {
    role_key(role)
}

/// The published role keyset, matching the ceremony context's key IDs.
pub(crate) fn test_role_keys() -> TenantRootCreationRoleVerifyingKeysV1 {
    let hex = |role: TwoPartyDeriverRole| -> String {
        role_key(role)
            .verifying_key()
            .to_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    };
    crate::env::decode_role_verifying_keys(&format!(
        "{{\"active_deriver_a_signing_key_id\":\"{}\",\"active_deriver_b_signing_key_id\":\"{}\",\"keys\":[{{\"role\":\"deriver_a\",\"signing_key_id\":\"{}\",\"verifying_key_hex\":\"{}\"}},{{\"role\":\"deriver_b\",\"signing_key_id\":\"{}\",\"verifying_key_hex\":\"{}\"}}]}}",
        signing_key_id(TwoPartyDeriverRole::DeriverA),
        signing_key_id(TwoPartyDeriverRole::DeriverB),
        signing_key_id(TwoPartyDeriverRole::DeriverA),
        hex(TwoPartyDeriverRole::DeriverA),
        signing_key_id(TwoPartyDeriverRole::DeriverB),
        hex(TwoPartyDeriverRole::DeriverB),
    ))
    .expect("role keyset")
}

pub(crate) fn admit(
    bytes: &[u8],
    worker_role: TwoPartyDeriverRole,
    authority_id: TenantRootControlPlaneAuthorityIdV1,
    now_ms: u64,
) -> RouterAbProtocolResult<PendingTenantRootInitialRoleAttemptV1> {
    admit_tenant_root_role_creation_package_v1(
        bytes,
        worker_role,
        authority_id,
        &trusted_issuer_keys(),
        &signer(worker_role),
        now_ms,
        &mut ChaCha20Rng::from_seed([0x77; 32]),
    )
}

/// The Deriver admits its own command and commits to a live share.
#[test]
fn a_deriver_admits_its_own_command_and_commits_to_a_share() {
    for role in [TwoPartyDeriverRole::DeriverA, TwoPartyDeriverRole::DeriverB] {
        let pending = admit(
            &package_bytes(role, &ISSUER_KEY),
            role,
            authority(),
            ISSUED_AT_MS + 2,
        )
        .expect("admitted");
        assert_eq!(pending.role(), role);
        // Only the signed public commitment leaves this process.
        assert!(!pending.commitment_bytes().is_empty());
        assert_eq!(pending.commitment().role(), role);
    }
}

/// The expected role comes from the Worker, so a Deriver cannot execute its
/// peer's command even though both are issuer-signed.
#[test]
fn a_deriver_refuses_its_peers_command() {
    for (packaged, worker) in [
        (TwoPartyDeriverRole::DeriverA, TwoPartyDeriverRole::DeriverB),
        (TwoPartyDeriverRole::DeriverB, TwoPartyDeriverRole::DeriverA),
    ] {
        assert!(
            admit(
                &package_bytes(packaged, &ISSUER_KEY),
                worker,
                authority(),
                ISSUED_AT_MS + 2,
            )
            .is_err(),
            "{worker:?} must refuse a {packaged:?} command"
        );
    }
}

/// Internal-service auth proves only "inside the deployment"; authorization
/// comes from the issuer signature checked against this Worker's anchor.
#[test]
fn a_deriver_refuses_a_package_from_an_untrusted_issuer() {
    let role = TwoPartyDeriverRole::DeriverA;
    assert_eq!(
        admit(
            &package_bytes(role, &FOREIGN_ISSUER_KEY),
            role,
            authority(),
            ISSUED_AT_MS + 2,
        )
        .expect_err("foreign issuer")
        .code(),
        RouterAbProtocolErrorCode::MalformedWirePayload
    );
}

#[test]
fn a_deriver_refuses_a_foreign_authority_and_a_stale_command() {
    let role = TwoPartyDeriverRole::DeriverA;
    let bytes = package_bytes(role, &ISSUER_KEY);

    // An authority this Worker did not derive.
    assert!(admit(
        &bytes,
        role,
        TenantRootControlPlaneAuthorityIdV1::from_bytes([0x45; 32]),
        ISSUED_AT_MS + 2,
    )
    .is_err());

    // Outside the command's freshness window, at both edges.
    assert!(admit(&bytes, role, authority(), ISSUED_AT_MS).is_err());
    assert!(admit(&bytes, role, authority(), EXPIRES_AT_MS).is_err());
    assert!(admit(&bytes, role, authority(), ISSUED_AT_MS + 2).is_ok());
}

/// A Worker whose signer does not match its role, or whose role signing key
/// the ceremony does not name, may not execute the ceremony.
#[test]
fn a_deriver_refuses_a_ceremony_that_does_not_name_its_signing_key() {
    let role = TwoPartyDeriverRole::DeriverA;
    let bytes = package_bytes(role, &ISSUER_KEY);
    let mismatched = crate::env::test_support_tenant_root_creation_role_signer_v1(
        role,
        "deriver-a-signing-key-rotated",
        role_key(role),
    );
    assert_eq!(
        admit_tenant_root_role_creation_package_v1(
            &bytes,
            role,
            authority(),
            &trusted_issuer_keys(),
            &mismatched,
            ISSUED_AT_MS + 2,
            &mut ChaCha20Rng::from_seed([0x77; 32]),
        )
        .expect_err("ceremony names a different signing key")
        .code(),
        RouterAbProtocolErrorCode::ForbiddenLocalBinding
    );

    // A signer belonging to the peer role is refused before anything else.
    assert_eq!(
        admit_tenant_root_role_creation_package_v1(
            &bytes,
            role,
            authority(),
            &trusted_issuer_keys(),
            &signer(TwoPartyDeriverRole::DeriverB),
            ISSUED_AT_MS + 2,
            &mut ChaCha20Rng::from_seed([0x77; 32]),
        )
        .expect_err("peer-role signer")
        .code(),
        RouterAbProtocolErrorCode::ForbiddenLocalBinding
    );
}

#[test]
fn every_package_wire_mutation_is_refused_at_the_deriver() {
    let role = TwoPartyDeriverRole::DeriverA;
    let bytes = package_bytes(role, &ISSUER_KEY);
    for index in (0..bytes.len()).step_by(7) {
        let mut mutated = bytes.clone();
        mutated[index] ^= 0xff;
        assert!(
            admit(&mutated, role, authority(), ISSUED_AT_MS + 2).is_err(),
            "mutated byte {index} must be refused"
        );
    }
    assert!(admit(&[], role, authority(), ISSUED_AT_MS + 2).is_err());
}

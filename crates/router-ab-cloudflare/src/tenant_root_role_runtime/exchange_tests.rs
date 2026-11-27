use super::admission_tests::*;
use super::*;
use rand_chacha::ChaCha20Rng;
use rand_core_06::SeedableRng;

fn rng(seed: u8) -> ChaCha20Rng {
    ChaCha20Rng::from_seed([seed; 32])
}

/// Both roles admit, exchange commitments, and finalize independently.
fn run_exchange() -> (
    PendingTenantRootInitialRoleAttemptV1,
    PendingTenantRootInitialRoleAttemptV1,
    TenantRootCreationCommitmentPairWiresV1,
) {
    let a = admit_for(TwoPartyDeriverRole::DeriverA);
    let b = admit_for(TwoPartyDeriverRole::DeriverB);
    let wires = TenantRootCreationCommitmentPairWiresV1 {
        deriver_a_signed_commitment: a.commitment_bytes().to_vec(),
        deriver_b_signed_commitment: b.commitment_bytes().to_vec(),
    };
    (a, b, wires)
}

#[test]
fn both_roles_finalize_against_the_same_commitment_pair() {
    let (a, b, wires) = run_exchange();
    for (pending, role) in [
        (a, TwoPartyDeriverRole::DeriverA),
        (b, TwoPartyDeriverRole::DeriverB),
    ] {
        let finalized = finalize_tenant_root_role_attempt_v1(
            pending,
            &wires,
            &test_context(),
            &test_role_keys(),
            &signer(role),
            &mut rng(0x91),
        )
        .expect("finalized");
        let (command, _share, evidence) = finalized.into_parts();
        assert_eq!(command.role(), role);
        assert!(!evidence.canonical_bytes().is_empty());
    }
}

/// A Deriver trusts the two role signatures, not the object's assembly, so
/// a pair it did not participate in is refused.
#[test]
fn a_role_refuses_a_pair_that_does_not_contain_its_own_commitment() {
    let (a, _b, _wires) = run_exchange();
    // A second, independent ceremony run produces different commitments.
    let (other_a, other_b, _) = {
        let a2 = admit_for_with_rng(TwoPartyDeriverRole::DeriverA, 0x33);
        let b2 = admit_for_with_rng(TwoPartyDeriverRole::DeriverB, 0x44);
        let w = TenantRootCreationCommitmentPairWiresV1 {
            deriver_a_signed_commitment: a2.commitment_bytes().to_vec(),
            deriver_b_signed_commitment: b2.commitment_bytes().to_vec(),
        };
        (a2, b2, w)
    };
    let foreign = TenantRootCreationCommitmentPairWiresV1 {
        deriver_a_signed_commitment: other_a.commitment_bytes().to_vec(),
        deriver_b_signed_commitment: other_b.commitment_bytes().to_vec(),
    };
    assert!(
        finalize_tenant_root_role_attempt_v1(
            a,
            &foreign,
            &test_context(),
            &test_role_keys(),
            &signer(TwoPartyDeriverRole::DeriverA),
            &mut rng(0x91),
        )
        .is_err(),
        "a pair without this role's own commitment must be refused"
    );
}

#[test]
fn swapped_or_duplicated_roles_in_the_pair_fail_closed() {
    let (a, _b, wires) = run_exchange();
    // Roles swapped: A's commitment presented as B's and vice versa.
    let swapped = TenantRootCreationCommitmentPairWiresV1 {
        deriver_a_signed_commitment: wires.deriver_b_signed_commitment.clone(),
        deriver_b_signed_commitment: wires.deriver_a_signed_commitment.clone(),
    };
    assert!(finalize_tenant_root_role_attempt_v1(
        a,
        &swapped,
        &test_context(),
        &test_role_keys(),
        &signer(TwoPartyDeriverRole::DeriverA),
        &mut rng(0x91),
    )
    .is_err());

    // One role's commitment duplicated into both positions.
    let (a2, _b2, wires2) = run_exchange();
    let duplicated = TenantRootCreationCommitmentPairWiresV1 {
        deriver_a_signed_commitment: wires2.deriver_a_signed_commitment.clone(),
        deriver_b_signed_commitment: wires2.deriver_a_signed_commitment.clone(),
    };
    assert!(finalize_tenant_root_role_attempt_v1(
        a2,
        &duplicated,
        &test_context(),
        &test_role_keys(),
        &signer(TwoPartyDeriverRole::DeriverA),
        &mut rng(0x91),
    )
    .is_err());
}

#[test]
fn every_commitment_wire_mutation_fails_closed() {
    let (a, _b, wires) = run_exchange();
    let bytes = wires.deriver_b_signed_commitment.clone();
    for index in (0..bytes.len()).step_by(5) {
        let mut mutated = bytes.clone();
        mutated[index] ^= 0xff;
        let tampered = TenantRootCreationCommitmentPairWiresV1 {
            deriver_a_signed_commitment: wires.deriver_a_signed_commitment.clone(),
            deriver_b_signed_commitment: mutated,
        };
        assert!(
            finalize_tenant_root_role_attempt_v1(
                admit_for(TwoPartyDeriverRole::DeriverA),
                &tampered,
                &test_context(),
                &test_role_keys(),
                &signer(TwoPartyDeriverRole::DeriverA),
                &mut rng(0x91),
            )
            .is_err(),
            "mutated peer commitment byte {index} must be refused"
        );
    }
    drop(a);
}

/// Behavioural proof that no scalar reaches any wire that leaves a Deriver.
///
/// Rather than scanning source text, this reconstructs the exact bytes that
/// cross each boundary and asserts the secret share does not appear in any
/// of them: the signed commitment sent to the object, the pair wires
/// returned to the peer, and the signed installation evidence.
#[test]
fn no_wire_leaving_a_deriver_contains_the_secret_share() {
    let (a, b, wires) = run_exchange();

    // Recover each role's raw scalar bytes from the finalized attempt.
    let mut scalars: Vec<Vec<u8>> = Vec::new();
    let mut outbound: Vec<Vec<u8>> = vec![
        wires.deriver_a_signed_commitment.clone(),
        wires.deriver_b_signed_commitment.clone(),
    ];
    for (pending, role) in [
        (a, TwoPartyDeriverRole::DeriverA),
        (b, TwoPartyDeriverRole::DeriverB),
    ] {
        let finalized = finalize_tenant_root_role_attempt_v1(
            pending,
            &wires,
            &test_context(),
            &test_role_keys(),
            &signer(role),
            &mut rng(0x91),
        )
        .expect("finalized");
        let (_command, share_wire, evidence) = finalized.into_parts();
        scalars.push(share_wire.to_bytes().to_vec());
        // The signed installation evidence crosses to the object.
        outbound.push(evidence.canonical_bytes().to_vec());
    }

    assert_eq!(scalars.len(), 2);
    assert_ne!(scalars[0], scalars[1], "roles must hold distinct scalars");
    for share_wire_bytes in &scalars {
        // The share wire is a 2-byte share id followed by the 32-byte
        // scalar; search for the full wire AND the bare scalar, so a leak
        // that drops the prefix is still caught.
        assert_eq!(share_wire_bytes.len(), 34);
        let scalar = &share_wire_bytes[2..];
        assert_eq!(scalar.len(), 32);
        assert!(
            scalar.iter().any(|byte| *byte != 0),
            "a zero scalar would make this test vacuous"
        );
        for needle in [share_wire_bytes.as_slice(), scalar] {
            for (index, wire) in outbound.iter().enumerate() {
                assert!(
                    !wire.windows(needle.len()).any(|window| window == needle),
                    "outbound wire {index} contains secret share material"
                );
            }
        }
    }
}

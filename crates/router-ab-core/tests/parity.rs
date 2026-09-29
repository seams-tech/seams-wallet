use router_ab_core::{QuorumPolicy, RouterAbDerivationErrorCode, SignerSetBinding};

fn sample_signer_set() -> SignerSetBinding {
    SignerSetBinding::v1_all2(
        "signer-set-v1",
        "role:signer-a:local:sha256-a",
        "key-epoch-a-1",
        "role:signer-b:local:sha256-b",
        "key-epoch-b-1",
    )
    .expect("signer set")
}

#[test]
fn transcript_rejects_duplicate_signer_identities() {
    let err = SignerSetBinding::v1_all2(
        "signer-set-v1",
        "same-signer",
        "key-epoch-a-1",
        "same-signer",
        "key-epoch-b-1",
    )
    .expect_err("duplicate signers should fail");

    assert_eq!(
        err.code(),
        RouterAbDerivationErrorCode::DuplicateSignerIdentity
    );
}

#[test]
fn transcript_rejects_non_all2_quorum_policy() {
    let err = SignerSetBinding::from_indexed_v1(
        "signer-set-v1",
        QuorumPolicy::All { signer_count: 3 },
        sample_signer_set().signers().to_vec(),
    )
    .expect_err("v1 should reject non-all2 quorum");

    assert_eq!(err.code(), RouterAbDerivationErrorCode::MalformedInput);
}

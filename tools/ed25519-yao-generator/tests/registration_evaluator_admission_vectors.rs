mod support {
    pub mod cli;
}

use std::fs;
use std::path::PathBuf;

use ed25519_yao_generator::{
    canonical_registration_evaluator_admission_vector_corpus_json_bytes_v1,
    canonical_registration_evaluator_admission_vector_corpus_v1,
    parse_canonical_registration_evaluator_admission_vector_corpus_json_v1,
    REGISTRATION_EVALUATOR_ADMISSION_VECTOR_CORPUS_SCHEMA_V1,
    REGISTRATION_EVALUATOR_ADMISSION_VECTOR_EVIDENCE_SCOPE_V1,
};

use support::cli::assert_emit_and_check;

fn corpus_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("vectors/ed25519-yao-registration-evaluator-admission-v1.json")
}

#[test]
fn canonical_corpus_has_one_narrow_registration_case() {
    let corpus = canonical_registration_evaluator_admission_vector_corpus_v1();
    assert_eq!(
        corpus.schema(),
        REGISTRATION_EVALUATOR_ADMISSION_VECTOR_CORPUS_SCHEMA_V1
    );
    assert_eq!(corpus.protocol_id(), ed25519_yao::PROTOCOL_ID_STR);
    assert_eq!(
        corpus.evidence_scope(),
        REGISTRATION_EVALUATOR_ADMISSION_VECTOR_EVIDENCE_SCOPE_V1
    );
    assert_eq!(corpus.case_count(), 1);
}

#[test]
fn committed_corpus_equals_exact_canonical_bytes_and_rejects_drift() {
    let committed = fs::read(corpus_path()).expect("committed corpus");
    let canonical = canonical_registration_evaluator_admission_vector_corpus_json_bytes_v1();
    assert_eq!(committed, canonical);
    parse_canonical_registration_evaluator_admission_vector_corpus_json_v1(&committed)
        .expect("canonical corpus parses");
    let mut mutated = canonical.clone();
    let index = mutated
        .iter()
        .position(|byte| *byte == b'a')
        .expect("canonical corpus contains ASCII a");
    mutated[index] = b'b';
    assert!(
        parse_canonical_registration_evaluator_admission_vector_corpus_json_v1(&mutated).is_err()
    );
    let mut trailing = canonical;
    trailing.push(b'\n');
    assert!(
        parse_canonical_registration_evaluator_admission_vector_corpus_json_v1(&trailing).is_err()
    );
}

#[test]
fn corpus_commits_exact_admission_candidate_and_cross_links() {
    let encoded = fs::read(corpus_path()).expect("committed corpus");
    let value: serde_json::Value = serde_json::from_slice(&encoded).expect("valid JSON");
    let case = &value["cases"][0];
    assert_eq!(
        case["case_id"],
        "registration_admitted_evaluation_output_committed_v1"
    );
    assert_eq!(case["request_kind"], "registration");
    assert_eq!(
        case["source_references"]["ceremony_context_case_id"],
        "ceremony-registration-v1"
    );
    assert_eq!(
        case["source_references"]["provenance_case_id"],
        "registration_provenance_outer_v1"
    );
    assert_eq!(case["evaluation"]["yao_evaluations"], 1);
    assert_eq!(case["evaluation"]["deriver_a_invocations"], 1);
    assert_eq!(case["evaluation"]["deriver_b_invocations"], 1);
    assert_eq!(case["evaluation"]["contribution_derivations"], 0);
    assert_eq!(case["evaluation"]["output_share_samples"], 2);
    assert_eq!(
        case["admission"]["digest_hex"],
        case["evaluation"]["output_committed_evaluation_evidence_digest_hex"]
    );
    assert_eq!(
        case["evaluation"]["output_committed_receipt_digest_hex"],
        case["evaluation"]["candidate_output_committed_receipt_digest_hex"]
    );
}

#[test]
fn vector_cli_emits_and_checks_exact_corpus() {
    assert_emit_and_check(
        "registration-evaluator-admission",
        &canonical_registration_evaluator_admission_vector_corpus_json_bytes_v1(),
    );
}

#[test]
fn corpus_freezes_terminal_retry_and_explicit_nonclaims() {
    let canonical = canonical_registration_evaluator_admission_vector_corpus_json_bytes_v1();
    let value: serde_json::Value = serde_json::from_slice(&canonical).expect("valid JSON");
    let case = &value["cases"][0];
    assert_eq!(case["admission"]["selection_state"], "accepted_terminal");
    assert_eq!(case["retry"]["accepted_selection_is_terminal"], true);
    assert_eq!(
        case["retry"]["evaluator_abort_retains_terminal_selection"],
        true
    );
    assert_eq!(case["retry"]["retry_requires_fresh_execution"], true);
    assert_eq!(case["retry"]["retry_may_resample_selection"], false);
    assert_eq!(
        case["claim_boundary"]["unregistered_scope_claim"],
        "public_identity_scope_only"
    );
    let exclusions = case["claim_boundary"]["excluded_claims"]
        .as_array()
        .expect("excluded claims array");
    for required in [
        "authenticated_absence",
        "durable_uniqueness",
        "input_opening_consistency",
        "profile_security",
        "production_constant_time",
    ] {
        assert!(exclusions.iter().any(|value| value == required));
    }
    for forbidden in [
        "signature_hex",
        "proof_hex",
        "security_profile",
        "seed_output_hex",
    ] {
        assert!(!value["cases"][0]
            .as_object()
            .expect("case object")
            .contains_key(forbidden));
    }
    assert_eq!(
        canonical,
        canonical_registration_evaluator_admission_vector_corpus_json_bytes_v1()
    );
}

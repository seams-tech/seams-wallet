//! Fixture records shared by the recovery and refresh evaluator-admission corpora.

use serde::Serialize;

use crate::authenticated_store::AuthenticatedRegisteredStoreResolutionV1;
use crate::ceremony_context::{CeremonyPublicRequestContextV1, CeremonyValidatedDagV1};
use crate::provenance::RoleInputProvenancePairV1;

/// Public view of the authenticated store resolution an admission consumes.
#[derive(Serialize)]
pub(crate) struct StoreResolutionVectorV1 {
    signing_bytes_hex: String,
    signing_bytes_sha256_hex: String,
    authority_key_epoch: u64,
    authority_verifying_key_hex: String,
    authority_key_digest_hex: String,
    authority_signature_hex: String,
    active_state_version: u64,
    pub(crate) registered_public_key_hex: String,
    pub(crate) active_credential_binding_digest_hex: String,
    pub(crate) stable_scope_encoding_hex: String,
    active_activation_epoch: u64,
    deriver_a_root_record_digest_hex: String,
    deriver_a_root_binding_artifact_digest_hex: String,
    deriver_a_root_epoch: u64,
    deriver_a_input_state_record_digest_hex: String,
    pub(crate) deriver_a_input_state_epoch: u64,
    deriver_b_root_record_digest_hex: String,
    deriver_b_root_binding_artifact_digest_hex: String,
    deriver_b_root_epoch: u64,
    deriver_b_input_state_record_digest_hex: String,
    pub(crate) deriver_b_input_state_epoch: u64,
}

impl StoreResolutionVectorV1 {
    pub(crate) fn new(state: &AuthenticatedRegisteredStoreResolutionV1) -> Self {
        let projection = state.state();
        let authority = state.trusted_transition_authority();
        Self {
            signing_bytes_hex: encode_hex(
                &state
                    .signed_resolution_bytes()
                    .expect("store signing bytes"),
            ),
            signing_bytes_sha256_hex: encode_hex(
                &state.signed_resolution_digest().expect("store digest"),
            ),
            authority_key_epoch: authority.key_epoch().value(),
            authority_verifying_key_hex: encode_hex(&authority.verifying_key_bytes()),
            authority_key_digest_hex: encode_hex(&authority.key_digest()),
            authority_signature_hex: encode_hex(state.authority_signature().as_bytes()),
            active_state_version: state.active_state_version().value(),
            registered_public_key_hex: encode_hex(projection.registered_public_key.as_bytes()),
            active_credential_binding_digest_hex: encode_hex(
                projection.active_credential_binding_digest.as_bytes(),
            ),
            stable_scope_encoding_hex: encode_hex(
                &projection
                    .stable_scope
                    .encode()
                    .expect("stable scope encoding"),
            ),
            active_activation_epoch: projection.active_activation_epoch.value(),
            deriver_a_root_record_digest_hex: encode_hex(
                projection.deriver_a_root_record.as_bytes(),
            ),
            deriver_a_root_binding_artifact_digest_hex: encode_hex(
                projection.deriver_a_root_binding.as_bytes(),
            ),
            deriver_a_root_epoch: projection.deriver_a_root_epoch.value(),
            deriver_a_input_state_record_digest_hex: encode_hex(
                projection.deriver_a_state_record.as_bytes(),
            ),
            deriver_a_input_state_epoch: projection.deriver_a_input_state_epoch.value(),
            deriver_b_root_record_digest_hex: encode_hex(
                projection.deriver_b_root_record.as_bytes(),
            ),
            deriver_b_root_binding_artifact_digest_hex: encode_hex(
                projection.deriver_b_root_binding.as_bytes(),
            ),
            deriver_b_root_epoch: projection.deriver_b_root_epoch.value(),
            deriver_b_input_state_record_digest_hex: encode_hex(
                projection.deriver_b_state_record.as_bytes(),
            ),
            deriver_b_input_state_epoch: projection.deriver_b_input_state_epoch.value(),
        }
    }
}

/// Request, DAG and provenance bindings that open every admission vector.
#[derive(Serialize)]
pub(crate) struct AdmissionRequestVectorV1 {
    relation: String,
    durable_identity_scope_encoding_hex: String,
    request_id: String,
    replay_nonce_hex: String,
    request_expiry_unix_ms: u64,
    checked_at_unix_ms: u64,
    request_context_digest_hex: String,
    authorization_digest_hex: String,
    transcript_digest_hex: String,
    provenance_pair_digest_hex: String,
    deriver_a_statement_digest_hex: String,
    deriver_b_statement_digest_hex: String,
}

impl AdmissionRequestVectorV1 {
    pub(crate) fn new(
        request: &CeremonyPublicRequestContextV1,
        dag: CeremonyValidatedDagV1,
        provenance: &RoleInputProvenancePairV1,
        checked_at_unix_ms: u64,
    ) -> Self {
        Self {
            relation: "construction_independent_ideal_acceptance".to_owned(),
            durable_identity_scope_encoding_hex: encode_hex(
                &request
                    .durable_store_identity_scope()
                    .encode()
                    .expect("durable identity encoding"),
            ),
            request_id: request.request_id().as_str().to_owned(),
            replay_nonce_hex: encode_hex(request.replay_nonce().as_bytes()),
            request_expiry_unix_ms: request.request_expiry().value(),
            checked_at_unix_ms,
            request_context_digest_hex: encode_hex(dag.request_context_digest().as_bytes()),
            authorization_digest_hex: encode_hex(dag.authorization_digest().as_bytes()),
            transcript_digest_hex: encode_hex(dag.transcript_digest().as_bytes()),
            provenance_pair_digest_hex: encode_hex(
                provenance.digest().expect("pair digest").as_bytes(),
            ),
            deriver_a_statement_digest_hex: encode_hex(
                provenance
                    .deriver_a()
                    .digest()
                    .expect("A digest")
                    .as_bytes(),
            ),
            deriver_b_statement_digest_hex: encode_hex(
                provenance
                    .deriver_b()
                    .digest()
                    .expect("B digest")
                    .as_bytes(),
            ),
        }
    }
}

pub(crate) fn encode_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use core::fmt::Write as _;
        write!(&mut output, "{byte:02x}").expect("writing to String cannot fail");
    }
    output
}

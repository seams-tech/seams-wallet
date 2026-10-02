use serde::{Deserialize, Serialize};

use crate::derivation::context::{RequestKind, RootShareEpoch};
use crate::derivation::ecdsa_threshold_prf::MpcPrfOutputRequestV1;
use crate::derivation::error::{
    require_non_empty, RouterAbDerivationError, RouterAbDerivationErrorCode,
    RouterAbDerivationResult,
};
use crate::derivation::material::{OpenedShareKind, PublicDigest32, Role};

const SIGNER_INPUT_PLAINTEXT_VERSION_V1: &[u8] = b"router-ab-derivation/signer-input-plaintext/v1";
const FIXED_ECDSA_THRESHOLD_PRF_SUITE_LABEL_V1: &[u8] = b"threshold_prf_ristretto255_sha512";

/// V1 quorum policy carried by decrypted signer-input plaintext.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignerInputQuorumPolicyV1 {
    /// Router A/B v1 requires both configured signers.
    All2,
}

impl SignerInputQuorumPolicyV1 {
    /// Returns the canonical quorum-policy label.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::All2 => "all_2",
        }
    }
}

/// Strict post-decryption plaintext accepted from Router-to-signer envelopes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignerInputPlaintextV1 {
    /// Primitive request kind.
    pub request_kind: RequestKind,
    /// Router lifecycle id.
    pub lifecycle_id: String,
    /// Signer-set id.
    pub signer_set_id: String,
    /// V1 quorum policy.
    pub quorum_policy: SignerInputQuorumPolicyV1,
    /// Recipient signer role.
    pub recipient_role: Role,
    /// Recipient signer identity.
    pub recipient_signer_id: String,
    /// Recipient signer key epoch.
    pub recipient_key_epoch: String,
    /// Signer-local root-share epoch.
    pub root_share_epoch: RootShareEpoch,
    /// Selected server identity.
    pub selected_server_id: String,
    /// Selected server key epoch.
    pub selected_server_key_epoch: String,
    /// Public transcript digest.
    pub transcript_digest: PublicDigest32,
    /// Router public request digest.
    pub router_request_digest: PublicDigest32,
    /// Role-envelope associated-data digest.
    pub aad_digest: PublicDigest32,
    /// Output requests this signer may evaluate.
    pub output_requests: Vec<MpcPrfOutputRequestV1>,
}

impl SignerInputPlaintextV1 {
    /// Creates validated signer-input plaintext.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        request_kind: RequestKind,
        lifecycle_id: impl Into<String>,
        signer_set_id: impl Into<String>,
        quorum_policy: SignerInputQuorumPolicyV1,
        recipient_role: Role,
        recipient_signer_id: impl Into<String>,
        recipient_key_epoch: impl Into<String>,
        root_share_epoch: RootShareEpoch,
        selected_server_id: impl Into<String>,
        selected_server_key_epoch: impl Into<String>,
        transcript_digest: PublicDigest32,
        router_request_digest: PublicDigest32,
        aad_digest: PublicDigest32,
        output_requests: Vec<MpcPrfOutputRequestV1>,
    ) -> RouterAbDerivationResult<Self> {
        let plaintext = Self {
            request_kind,
            lifecycle_id: lifecycle_id.into(),
            signer_set_id: signer_set_id.into(),
            quorum_policy,
            recipient_role,
            recipient_signer_id: recipient_signer_id.into(),
            recipient_key_epoch: recipient_key_epoch.into(),
            root_share_epoch,
            selected_server_id: selected_server_id.into(),
            selected_server_key_epoch: selected_server_key_epoch.into(),
            transcript_digest,
            router_request_digest,
            aad_digest,
            output_requests,
        };
        plaintext.validate()?;
        Ok(plaintext)
    }

    /// Validates the strict public metadata and output-request allowlist.
    pub fn validate(&self) -> RouterAbDerivationResult<()> {
        require_signer_role(self.recipient_role)?;
        require_non_empty("lifecycle_id", &self.lifecycle_id)?;
        require_non_empty("signer_set_id", &self.signer_set_id)?;
        require_non_empty("recipient_signer_id", &self.recipient_signer_id)?;
        require_non_empty("recipient_key_epoch", &self.recipient_key_epoch)?;
        require_non_empty("root_share_epoch", self.root_share_epoch.as_str())?;
        require_non_empty("selected_server_id", &self.selected_server_id)?;
        require_non_empty("selected_server_key_epoch", &self.selected_server_key_epoch)?;
        if self.output_requests.is_empty() {
            return Err(RouterAbDerivationError::new(
                RouterAbDerivationErrorCode::MalformedInput,
                "signer input plaintext requires at least one output request",
            ));
        }
        for (index, request) in self.output_requests.iter().enumerate() {
            request.validate()?;
            if request.opened_share_kind == OpenedShareKind::XServerBase
                && (request.recipient_role != Role::Server
                    || request.recipient_identity != self.selected_server_id)
            {
                return Err(RouterAbDerivationError::new(
                    RouterAbDerivationErrorCode::RecipientMismatch,
                    "signer input plaintext server output recipient mismatch",
                ));
            }
            for prior in &self.output_requests[..index] {
                if prior.opened_share_kind == request.opened_share_kind
                    && prior.recipient_role == request.recipient_role
                    && prior.recipient_identity == request.recipient_identity
                {
                    return Err(RouterAbDerivationError::new(
                        RouterAbDerivationErrorCode::MalformedInput,
                        "signer input plaintext contains duplicate output request",
                    ));
                }
            }
        }
        Ok(())
    }

    /// Returns canonical signer-input plaintext bytes.
    pub fn canonical_bytes(&self) -> RouterAbDerivationResult<Vec<u8>> {
        encode_signer_input_plaintext_v1(self)
    }
}

/// Encodes signer-input plaintext with fixed field order.
pub fn encode_signer_input_plaintext_v1(
    plaintext: &SignerInputPlaintextV1,
) -> RouterAbDerivationResult<Vec<u8>> {
    plaintext.validate()?;
    let mut out = Vec::new();
    push_len32(&mut out, SIGNER_INPUT_PLAINTEXT_VERSION_V1);
    push_len32(&mut out, FIXED_ECDSA_THRESHOLD_PRF_SUITE_LABEL_V1);
    push_len32(&mut out, plaintext.request_kind.as_str().as_bytes());
    push_string(&mut out, &plaintext.lifecycle_id);
    push_string(&mut out, &plaintext.signer_set_id);
    push_len32(&mut out, plaintext.quorum_policy.as_str().as_bytes());
    push_len32(&mut out, plaintext.recipient_role.as_str().as_bytes());
    push_string(&mut out, &plaintext.recipient_signer_id);
    push_string(&mut out, &plaintext.recipient_key_epoch);
    push_string(&mut out, plaintext.root_share_epoch.as_str());
    push_string(&mut out, &plaintext.selected_server_id);
    push_string(&mut out, &plaintext.selected_server_key_epoch);
    push_digest(&mut out, plaintext.transcript_digest);
    push_digest(&mut out, plaintext.router_request_digest);
    push_digest(&mut out, plaintext.aad_digest);
    push_u32(&mut out, plaintext.output_requests.len() as u32);
    for request in &plaintext.output_requests {
        push_len32(&mut out, request.opened_share_kind.as_str().as_bytes());
        push_len32(&mut out, request.recipient_role.as_str().as_bytes());
        push_string(&mut out, &request.recipient_identity);
    }
    Ok(out)
}

fn require_signer_role(role: Role) -> RouterAbDerivationResult<()> {
    match role {
        Role::SignerA | Role::SignerB => Ok(()),
        _ => Err(RouterAbDerivationError::new(
            RouterAbDerivationErrorCode::MalformedInput,
            "signer input plaintext recipient role must be a signer",
        )),
    }
}

fn push_string(out: &mut Vec<u8>, value: &str) {
    push_len32(out, value.as_bytes());
}

fn push_digest(out: &mut Vec<u8>, digest: PublicDigest32) {
    push_len32(out, digest.as_bytes());
}

fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn push_len32(out: &mut Vec<u8>, value: &[u8]) {
    out.extend_from_slice(&(value.len() as u32).to_be_bytes());
    out.extend_from_slice(value);
}

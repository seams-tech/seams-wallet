//! The derivation context, transcript, output requests and signer inputs that the
//! `ecdsa_threshold_prf` tests evaluate.
//!
//! Each test file declares this module `pub`, so the helpers a file does not call
//! are not reported as dead code.

use base64ct::{Base64UrlUnpadded, Encoding};
use rand_chacha::ChaCha20Rng;
use rand_core::SeedableRng;
use router_ab_core::{
    AccountScope, DerivationContext, MpcPrfOutputRequestV1, MpcPrfSignerPartialInputV1,
    OpenedShareKind, RequestKind, Role, RootShareEpoch, SignerSetBinding, TranscriptBinding,
};
use threshold_prf::ThresholdPolicy;

pub fn context() -> DerivationContext {
    context_for_ceremony_and_epoch("ceremony-1", "epoch-1")
}

pub fn context_for_ceremony_and_epoch(ceremony_id: &str, epoch: &str) -> DerivationContext {
    let application_binding_digest_b64u = Base64UrlUnpadded::encode_string(&[0x42; 32]);
    DerivationContext::new(
        RequestKind::Registration,
        AccountScope::new(
            "near-testnet",
            "alice.testnet",
            application_binding_digest_b64u,
        )
        .expect("account scope"),
        RootShareEpoch::new(epoch).expect("epoch"),
        ceremony_id,
    )
    .expect("context")
}

pub fn transcript(context: DerivationContext) -> TranscriptBinding {
    transcript_for_client_recipient(context, "x25519:client-ephemeral-public-key")
}

pub fn transcript_for_client_recipient(
    context: DerivationContext,
    client_ephemeral_public_key: &str,
) -> TranscriptBinding {
    TranscriptBinding::new(
        context,
        "role:router:local:sha256-router",
        SignerSetBinding::v1_all2(
            "signer-set-v1",
            "role:signer-a:local:sha256-a",
            "key-epoch-a-1",
            "role:signer-b:local:sha256-b",
            "key-epoch-b-1",
        )
        .expect("signer set"),
        "role:server:local:sha256-r",
        "x25519:1111111111111111111111111111111111111111111111111111111111111111",
        "role:client:local:sha256-c",
        client_ephemeral_public_key,
    )
    .expect("transcript")
}

pub fn output_request(opened_share_kind: OpenedShareKind) -> MpcPrfOutputRequestV1 {
    match opened_share_kind {
        OpenedShareKind::XClientBase => MpcPrfOutputRequestV1::new(
            OpenedShareKind::XClientBase,
            Role::Client,
            "role:client:local:sha256-c",
        ),
        OpenedShareKind::XServerBase => MpcPrfOutputRequestV1::new(
            OpenedShareKind::XServerBase,
            Role::Server,
            "role:server:local:sha256-r",
        ),
    }
    .expect("output request")
}

pub fn signer_input(
    role: Role,
    identity: &str,
    output_requests: Vec<MpcPrfOutputRequestV1>,
) -> MpcPrfSignerPartialInputV1 {
    let context = context();
    let transcript = transcript(context.clone());
    MpcPrfSignerPartialInputV1::new(
        context,
        transcript,
        role,
        identity,
        RootShareEpoch::new("epoch-1").expect("epoch"),
        output_requests,
    )
    .expect("signer input")
}

pub fn seeded_rng(seed: u8) -> ChaCha20Rng {
    ChaCha20Rng::from_seed([seed; 32])
}

pub fn policy() -> ThresholdPolicy {
    ThresholdPolicy::from_u16s(2, 2).expect("2-of-2 policy")
}

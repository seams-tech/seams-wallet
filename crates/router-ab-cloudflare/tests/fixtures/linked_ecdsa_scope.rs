use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use router_ab_cloudflare::{
    CloudflareSigningWorkerLaneKeyFamilyV1, CloudflareSigningWorkerLaneMaterialIdentityV1,
    CloudflareSigningWorkerNormalSigningLaneMaterialLookupV1,
    CloudflareSigningWorkerNormalSigningMaterialSourceV1,
};
use router_ab_core::parse_router_ab_ecdsa_derivation_linked_device_normal_signing_scope_v1_json;
use router_ab_ecdsa_derivation::ecdsa_lane_client_public_key_from_share32_v1;
use serde_json::json;
use sha2::{Digest, Sha256};

pub fn digest(seed: u8) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest([seed; 32]))
}

pub fn point() -> String {
    URL_SAFE_NO_PAD
        .encode(ecdsa_lane_client_public_key_from_share32_v1([1; 32]).expect("valid secp share"))
}

pub fn scope() -> router_ab_core::RouterAbEcdsaDerivationLinkedDeviceNormalSigningScopeV1 {
    let digest = digest(7);
    let point = point();
    let value = json!({
        "kind": "linked_device_ecdsa_normal_signing_scope_v1",
        "keyFamily": "ecdsa_secp256k1",
        "laneKind": "linked_device",
        "walletId": "wallet:r103",
        "walletKeyId": "wallet-key:r103",
        "enrollmentId": "enrollment:r103",
        "operationId": "operation:r103",
        "laneId": "lane:r103",
        "laneShareEpoch": "epoch:r103",
        "revocationEpoch": 0,
        "targetMaterialActivationId": "activation:r103",
        "materialActivation": {
            "kind": "mpc_material_activation_ref",
            "activationId": "activation:r103",
            "capability": "capability:r103",
            "materialOwner": "material-owner:r103",
            "keyBinding": "key-binding:r103",
            "lifecycleBinding": "lifecycle:r103",
            "signingWorker": "worker:r103"
        },
        "targetCapability": {
            "manifestId": "manifest:r103",
            "manifestRevision": 1,
            "ecdsaThresholdKeyId": "threshold-key:r103",
            "orderedThresholdSessions": [{
                "chainTarget": {
                    "kind": "evm",
                    "namespace": "eip155",
                    "chainId": 1,
                    "networkSlug": "mainnet"
                },
                "thresholdSessionId": "threshold-session:r103",
                "participantBindingDigestB64u": digest
            }]
        },
        "thresholdPublicKey33B64u": point,
        "evmAddress": "0x0000000000000000000000000000000000000001",
        "publicIdentityDigestB64u": digest,
        "targetHolderPublicCommitmentB64u": point,
        "targetServerPublicCommitmentB64u": point,
        "holderParticipantId": "holder:r103",
        "signingWorkerParticipantId": "worker:r103",
        "holderParticipantBindingDigestB64u": digest,
        "signingWorkerParticipantBindingDigestB64u": digest,
        "holderRecipientKeyDigestB64u": digest,
        "serverRecipientKeyDigestB64u": digest,
        "signingWorkerRecipientKeyId": "worker-key:r103",
        "signingWorkerHpkePublicKeyB64u": digest,
        "transcriptHashB64u": digest,
        "protocolCommitReceiptDigestB64u": digest
    });
    parse_router_ab_ecdsa_derivation_linked_device_normal_signing_scope_v1_json(
        &serde_json::to_vec(&value).expect("scope JSON"),
    )
    .expect("scope parses")
}

pub fn material_source(
    scope: &router_ab_core::RouterAbEcdsaDerivationLinkedDeviceNormalSigningScopeV1,
) -> CloudflareSigningWorkerNormalSigningMaterialSourceV1 {
    let identity = CloudflareSigningWorkerLaneMaterialIdentityV1 {
        operation_id: scope.operation_id.clone(),
        enrollment_id: scope.enrollment_id.clone(),
        wallet_id: scope.wallet_id.clone(),
        wallet_key_id: scope.wallet_key_id.clone(),
        target_lane_id: scope.lane_id.clone(),
        target_lane_share_epoch: scope.lane_share_epoch.clone(),
        target_material_activation_id: scope.target_material_activation_id.clone(),
        key_family: CloudflareSigningWorkerLaneKeyFamilyV1::EcdsaSecp256k1,
        holder_participant_binding_digest_b64u: scope
            .holder_participant_binding_digest_b64u
            .clone(),
        signing_worker_participant_binding_digest_b64u: scope
            .signing_worker_participant_binding_digest_b64u
            .clone(),
        holder_recipient_key_digest_b64u: scope.holder_recipient_key_digest_b64u.clone(),
        server_recipient_key_digest_b64u: scope.server_recipient_key_digest_b64u.clone(),
        transcript_hash_b64u: scope.transcript_hash_b64u.clone(),
        protocol_commit_receipt_digest_b64u: scope.protocol_commit_receipt_digest_b64u.clone(),
    };
    let admitted_lane_identity_digest_b64u = identity.digest_b64u().expect("identity digest");
    CloudflareSigningWorkerNormalSigningMaterialSourceV1::RotatableLane {
        lookup: CloudflareSigningWorkerNormalSigningLaneMaterialLookupV1 {
            identity,
            admitted_lane_identity_digest_b64u,
        },
        group_public_key: scope.threshold_public_key33_b64u.clone(),
    }
}

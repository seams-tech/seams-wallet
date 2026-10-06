use base64::Engine;
use router_ab_cloudflare::{
    CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    CloudflareRouterEd25519AcceptedCapabilityBindingV1,
    CloudflareRouterEd25519AuthorizedOperationV1, CloudflareRouterEd25519CapabilityKindV1,
    CloudflareRouterEd25519OperationKindV1,
};
use router_ab_core::{
    NormalSigningAuthorizationV1, NormalSigningEd25519TwoPartyFrostCommitmentsV1,
    NormalSigningRound1PrepareResponseV1, NormalSigningScopeV1, PublicDigest32,
    RouterAbEd25519NormalSigningFinalizeProtocolV2, RouterAbEd25519NormalSigningFinalizeRequestV2,
    RouterAbEd25519NormalSigningIntentV2, RouterAbEd25519NormalSigningPrepareBindingV2,
    RouterAbEd25519NormalSigningPrepareRequestV2, RouterAbEd25519SigningPayloadV2,
    RouterAbEd25519TwoPartyFrostFinalizeProtocolV2, RouterAbEd25519YaoActivationResultV1,
    RouterAbNearNetworkIdV2, RouterAbNearTransactionIntentV1, TenantRootIdentityV1,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use signer_core::near_threshold_ed25519::{
    build_signing_package, client_round1_commit, client_round2_signature_share,
    key_package_from_signing_share_bytes, signature_share_to_b64u,
};
use std::collections::BTreeMap;

/// A Gateway-forwarded body: the signing request with the Gateway's
/// authorized operation attached, as the TS Gateway proxy sends it.
pub fn gateway_signing_body<T: Serialize>(
    request: &T,
    authorized_operation: &CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let mut body = serde_json::to_value(request)?;
    let object = body
        .as_object_mut()
        .ok_or("signing request must be a JSON object")?;
    object.insert(
        "authorized_operation".to_owned(),
        serde_json::to_value(authorized_operation)?,
    );
    Ok(body)
}

pub fn product_near_prepare_request(
    activation: &RouterAbEd25519YaoActivationResultV1,
    expires_at_ms: u64,
    ownership_generation: u64,
) -> Result<(RouterAbEd25519NormalSigningPrepareRequestV2, Vec<u8>), Box<dyn std::error::Error>> {
    let binding = activation.binding();
    let account_id = &binding.lifecycle.account_id;
    // One signing operation per wallet.
    let scope = NormalSigningScopeV1::new(
        format!("product-near-sign-{account_id}-{ownership_generation}"),
        account_id,
        NormalSigningAuthorizationV1::reusable_wallet_session(format!(
            "wallet-session-{account_id}-{ownership_generation}"
        ))?,
        binding.material_activation.clone(),
        &binding.material_activation.signing_worker,
    )?;
    let unsigned = product_near_unsigned_transaction(
        account_id,
        &activation.public_receipt().registered_public_key(),
    );
    let unsigned_b64u = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&unsigned);
    let action_fingerprint = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
        Sha256::digest(
            r#"[{"action_type":"FunctionCall","args":"{\"amount\":\"1\"}","deposit":"0","gas":"30000000000000","method_name":"transfer"}]"#
                .as_bytes(),
        ),
    );
    let intent = RouterAbEd25519NormalSigningIntentV2::NearTransactionV1 {
        operation_id: format!("product-near-operation-{ownership_generation}"),
        operation_fingerprint: format!("product-near-fingerprint-{ownership_generation}"),
        near_account_id: account_id.clone(),
        near_network_id: RouterAbNearNetworkIdV2::Testnet,
        transactions: vec![RouterAbNearTransactionIntentV1::new(
            "receiver.near",
            action_fingerprint,
        )?],
        unsigned_transaction_borsh_b64u: unsigned_b64u.clone(),
    };
    let signing_payload = RouterAbEd25519SigningPayloadV2::NearUnsignedTransactionBorshV1 {
        unsigned_transaction_borsh_b64u: unsigned_b64u,
        expected_signing_digest_b64u: base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(Sha256::digest(&unsigned)),
    };
    let request = RouterAbEd25519NormalSigningPrepareRequestV2::new(
        scope,
        expires_at_ms,
        PublicDigest32::new([0x91; 32]),
        intent,
        signing_payload,
    )?;
    Ok((request, unsigned))
}

/// The authorized operation the Gateway attaches after consuming the owner's
/// grant and quota. In the full VM product path the Node Gateway produces it;
/// here the test acts as that Gateway with its dedicated credential.
pub fn product_near_gateway_authorized_operation(
    activation: &RouterAbEd25519YaoActivationResultV1,
    root_identity: &TenantRootIdentityV1,
    request: &RouterAbEd25519NormalSigningPrepareRequestV2,
    expires_at_ms: u64,
    ownership_generation: u64,
) -> Result<CloudflareRouterEd25519AcceptedAuthorizedOperationV1, Box<dyn std::error::Error>> {
    let material = request.admission_material()?;
    Ok(CloudflareRouterEd25519AcceptedAuthorizedOperationV1 {
        binding: CloudflareRouterEd25519AcceptedCapabilityBindingV1::GatewayOwnerWalletSession {
            ownership_generation,
            subject_id: "product-user-1".to_owned(),
            account_id: activation.binding().lifecycle.account_id.clone(),
            authorization_id: format!("authorization-{}-{ownership_generation}", activation.binding().lifecycle.account_id),
            wallet_session_id: request.scope.authorization.reusable_wallet_session_id()?.to_owned(),
            quota_id: format!("quota-{}-{ownership_generation}", activation.binding().lifecycle.account_id),
            threshold_session_id: format!(
                "threshold-session-{}",
                activation.binding().lifecycle.account_id
            ),
            org_id: root_identity.org_id().to_owned(),
            project_id: root_identity.project_id().to_owned(),
            environment: "dev".to_owned(),
            project_environment_id: root_identity.env_id().to_owned(),
            signing_worker_id: request.scope.signing_worker_id.clone(),
            expires_at_ms,
        },
        authorized_operation:
            CloudflareRouterEd25519AuthorizedOperationV1::ReusableWalletSessionAuthorizedOperationV1 {
                authorized_operation_id: format!("authorized-operation-product-{ownership_generation}"),
                operation_id: format!("product-near-operation-{ownership_generation}"),
                capability_kind: CloudflareRouterEd25519CapabilityKindV1::NearEd25519MpcSigning,
                operation_kind: CloudflareRouterEd25519OperationKindV1::SignTransaction,
                lane_digest_b64u: b64u(&Sha256::digest(b"product-near-owner-lane")),
                intent_digest_b64u: b64u(material.intent_digest.as_bytes()),
                display_digest_b64u: b64u(request.display_digest.as_bytes()),
                operation_fingerprint_digest: b64u(&Sha256::digest(format!("product-near-fingerprint-{ownership_generation}").as_bytes())),
            },
    })
}

fn product_near_unsigned_transaction(account_id: &str, public_key: &[u8; 32]) -> Vec<u8> {
    let mut out = Vec::new();
    push_borsh_string(&mut out, account_id);
    out.push(0);
    out.extend_from_slice(public_key);
    out.extend_from_slice(&7_u64.to_le_bytes());
    push_borsh_string(&mut out, "receiver.near");
    out.extend_from_slice(&[0x44; 32]);
    out.extend_from_slice(&1_u32.to_le_bytes());
    out.push(2);
    push_borsh_string(&mut out, "transfer");
    push_borsh_bytes(&mut out, br#"{"amount":"1"}"#);
    out.extend_from_slice(&30_000_000_000_000_u64.to_le_bytes());
    out.extend_from_slice(&0_u128.to_le_bytes());
    out
}

fn push_borsh_string(out: &mut Vec<u8>, value: &str) {
    push_borsh_bytes(out, value.as_bytes());
}

fn push_borsh_bytes(out: &mut Vec<u8>, value: &[u8]) {
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value);
}

pub fn product_near_finalize_request(
    activation: &RouterAbEd25519YaoActivationResultV1,
    client_share: &[u8; 32],
    prepare: &RouterAbEd25519NormalSigningPrepareRequestV2,
    response: &NormalSigningRound1PrepareResponseV1,
    expires_at_ms: u64,
) -> Result<RouterAbEd25519NormalSigningFinalizeRequestV2, Box<dyn std::error::Error>> {
    let material = prepare.admission_material()?;
    let client_id = frost_ed25519::Identifier::try_from(1_u16)?;
    let server_id = frost_ed25519::Identifier::try_from(2_u16)?;
    let public_key = activation.public_receipt().registered_public_key();
    let key_package = key_package_from_signing_share_bytes(client_share, &public_key, client_id)?;
    let client_round1 = client_round1_commit(&key_package)?;
    let server_hiding = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(&response.server_commitments.hiding)?;
    let server_binding = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(&response.server_commitments.binding)?;
    let server_commitments = frost_ed25519::round1::SigningCommitments::new(
        frost_ed25519::round1::NonceCommitment::deserialize(&server_hiding)?,
        frost_ed25519::round1::NonceCommitment::deserialize(&server_binding)?,
    );
    let signing_package = build_signing_package(
        material.admitted_signing_digest.as_bytes(),
        BTreeMap::from([
            (client_id, client_round1.commitments),
            (server_id, server_commitments),
        ]),
    );
    let client_signature_share =
        client_round2_signature_share(&signing_package, &client_round1.nonces, &key_package)?;
    let client_verifying_share =
        signer_core::near_threshold_ed25519::verifying_share_bytes_from_signing_share_bytes(
            client_share,
        );
    let protocol = RouterAbEd25519NormalSigningFinalizeProtocolV2::Ed25519TwoPartyFrostFinalizeV1(
        RouterAbEd25519TwoPartyFrostFinalizeProtocolV2::new(
            NormalSigningEd25519TwoPartyFrostCommitmentsV1::new(
                client_round1.commitments_wire.hiding,
                client_round1.commitments_wire.binding,
            )?,
            response.server_commitments.clone(),
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(client_verifying_share),
            response.server_verifying_share_b64u.clone(),
            signature_share_to_b64u(&client_signature_share)?,
        )?,
    );
    let binding = RouterAbEd25519NormalSigningPrepareBindingV2::new(
        response.server_round1_handle.clone(),
        response.round1_binding_digest,
        material.intent_digest,
        material.signing_payload_digest,
    )?;
    Ok(RouterAbEd25519NormalSigningFinalizeRequestV2::new(
        prepare.scope.clone(),
        expires_at_ms,
        binding,
        protocol,
    )?)
}

fn b64u(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

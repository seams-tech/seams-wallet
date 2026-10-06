#[path = "../../tests/fixtures/ed25519_signing.rs"]
mod fixture;

use base64::Engine;
use router_ab_cloudflare::CloudflareRouterEd25519AcceptedAuthorizedOperationV1;
use router_ab_core::{
    NormalSigningRound1PrepareResponseV1, RouterAbEd25519NormalSigningPrepareRequestV2,
    RouterAbEd25519YaoActivationResultV1, TenantRootIdentityV1,
};
use router_ab_dev::derive_local_ed25519_yao_recipient_key_pair_v1;
use router_ab_ed25519_yao_client::complete_client_activation_packages_v1;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "command", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Prepare {
        activation: RouterAbEd25519YaoActivationResultV1,
        identity: TenantRootIdentityV1,
        ownership_generation: u64,
        expires_at_ms: u64,
    },
    Finalize {
        activation: RouterAbEd25519YaoActivationResultV1,
        client_recipient_seed: [u8; 32],
        prepare: RouterAbEd25519NormalSigningPrepareRequestV2,
        prepared: NormalSigningRound1PrepareResponseV1,
        authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    },
}

#[derive(Serialize)]
struct PrepareFixture {
    prepare: RouterAbEd25519NormalSigningPrepareRequestV2,
    authorized_operation: CloudflareRouterEd25519AcceptedAuthorizedOperationV1,
    signing_digest_b64u: String,
}

pub(super) fn run() -> Result<(), Box<dyn std::error::Error>> {
    let request: Request = serde_json::from_reader(std::io::stdin().lock())?;
    match request {
        Request::Prepare {
            activation,
            identity,
            ownership_generation,
            expires_at_ms,
        } => {
            let (prepare, _) = fixture::product_near_prepare_request(
                &activation,
                expires_at_ms,
                ownership_generation,
            )?;
            let authorized_operation = fixture::product_near_gateway_authorized_operation(
                &activation,
                &identity,
                &prepare,
                expires_at_ms,
                ownership_generation,
            )?;
            let signing_digest_b64u = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
                prepare
                    .admission_material()?
                    .admitted_signing_digest
                    .as_bytes(),
            );
            serde_json::to_writer(
                std::io::stdout().lock(),
                &PrepareFixture {
                    prepare,
                    authorized_operation,
                    signing_digest_b64u,
                },
            )?;
        }
        Request::Finalize {
            activation,
            client_recipient_seed,
            prepare,
            prepared,
            authorized_operation,
        } => {
            let recipient = derive_local_ed25519_yao_recipient_key_pair_v1(&client_recipient_seed)?;
            let (client_share, _) = complete_client_activation_packages_v1(
                activation.binding(),
                [1, 2],
                activation.public_receipt(),
                recipient.private_key.as_bytes(),
                activation.deriver_a_client_package(),
                activation.deriver_b_client_package(),
            )?;
            let finalize = fixture::product_near_finalize_request(
                &activation,
                &client_share,
                &prepare,
                &prepared,
                prepare.expires_at_ms,
            )?;
            serde_json::to_writer(
                std::io::stdout().lock(),
                &fixture::gateway_signing_body(&finalize, &authorized_operation)?,
            )?;
        }
    }
    Ok(())
}

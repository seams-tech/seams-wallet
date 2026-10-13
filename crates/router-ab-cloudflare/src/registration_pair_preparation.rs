//! Input-free registration admission. This context cannot execute a protocol.

use router_ab_core::{
    Ed25519YaoCeremonyBindingV1, Ed25519YaoInputPairBindingV1, Ed25519YaoOperationV1,
    PublicDigest32, RouterAbEd25519YaoApplicationBindingFactsV1, RouterAbProtocolError,
    RouterAbProtocolErrorCode, RouterAbProtocolResult, TenantRootCustodyBindingV1,
    TenantRootProtocolDigestV1,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    CloudflareEnvReaderV1, CloudflareRouterEd25519YaoTenantRootV1,
    CloudflareTenantRootCustodyBindingWireV1, WalletObjectRoute,
};

pub(crate) const ROUTER_PATH: &str = "/router-ab/router/ed25519-yao/registration/prepare";
pub(crate) const ROLE_PATH: &str = "/router-ab/internal/ed25519-yao/registration/prepare";
pub(crate) const SOCKET_PATH: &str = "/router-ab/internal/ed25519-yao/registration/connect";
pub(crate) const PREPARATION_HEADER: &str = "x-yao-registration-preparation";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RegistrationPreparationRequest {
    pub tenant_root: CloudflareRouterEd25519YaoTenantRootV1,
    pub application: RouterAbEd25519YaoApplicationBindingFactsV1,
    pub participant_ids: [u16; 2],
    pub binding: Ed25519YaoCeremonyBindingV1,
    pub ownership_generation: u64,
    pub expires_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RegistrationPreparation {
    pub request: RegistrationPreparationRequest,
    pub wallet_route: WalletObjectRoute,
    pub custody_binding: CloudflareTenantRootCustodyBindingWireV1,
}

impl RegistrationPreparationRequest {
    pub(crate) fn validate(&self, now_ms: u64) -> RouterAbProtocolResult<()> {
        self.tenant_root.resolve()?;
        self.binding.validate()?;
        crate::router_wallet::validate_wallet_ownership_generation(self.ownership_generation)?;
        let stable = router_ab_ed25519_yao::stable_key_derivation_context_v1(
            &self.application,
            self.participant_ids,
        )
        .map_err(|_| invalid("Registration preparation has an invalid application"))?;
        if self.binding.operation != Ed25519YaoOperationV1::Registration
            || self.binding.lifecycle.account_id != self.application.wallet_id()
            || self.tenant_root.identity.signing_root_id() != self.application.signing_root_id()
            || self.binding.stable_key_context_binding.into_bytes() != stable.binding_digest()
            || self.expires_at_ms <= now_ms
        {
            return Err(invalid(
                "Registration preparation scope or deadline is invalid",
            ));
        }
        Ok(())
    }
}

impl RegistrationPreparation {
    pub(crate) fn session(&self) -> [u8; 32] {
        self.request.binding.session_id.into_bytes()
    }

    pub(crate) fn digest(&self) -> RouterAbProtocolResult<[u8; 32]> {
        let mut hash = Sha256::new();
        hash.update(b"seams/yao/registration-preparation/v1");
        hash.update(
            serde_json::to_vec(&(&self.request, self.wallet_route))
                .map_err(|_| invalid("Registration preparation could not be encoded"))?,
        );
        Ok(hash.finalize().into())
    }

    pub(crate) fn authenticate(
        &self,
        env: &impl CloudflareEnvReaderV1,
        now_ms: u64,
    ) -> RouterAbProtocolResult<TenantRootCustodyBindingV1> {
        self.request.validate(now_ms)?;
        self.custody_binding.validate()?;
        if self.custody_binding.expires_at_ms > self.request.expires_at_ms {
            return Err(invalid("Registration admission exceeds its setup deadline"));
        }
        let keys = crate::parse_cloudflare_tenant_root_control_plane_issuer_verifying_keys_v1(env)?;
        let receipt = self.custody_binding.verify_activation_receipt(&keys)?;
        let (identity, lineage) = self.request.tenant_root.resolve()?;
        if receipt.identity_digest() != identity || receipt.custody_lineage() != lineage {
            return Err(invalid("Registration preparation has another tenant root"));
        }
        let binding = TenantRootCustodyBindingV1::from_verified_activation_receipt_with_stable_context_digest(
            &receipt,
            crate::parse_cloudflare_tenant_root_creation_role_verifying_keys_v1(env)?.deriver_identities()?,
            self.custody_binding.operation_id,
            self.custody_binding.session_id,
            self.custody_binding.nonce,
            self.custody_binding.issued_at_ms,
            self.custody_binding.expires_at_ms,
            TenantRootProtocolDigestV1::from_bytes(self.request.binding.stable_key_context_binding.into_bytes())
                .map_err(crate::map_root_share_to_protocol)?,
            TenantRootProtocolDigestV1::from_bytes(self.digest()?).map_err(crate::map_root_share_to_protocol)?,
        ).map_err(crate::map_root_share_to_protocol)?;
        binding
            .validate_at(now_ms)
            .map_err(crate::map_root_share_to_protocol)?;
        Ok(binding)
    }

    pub(crate) fn matches_execution(
        &self,
        context: &crate::CloudflareEd25519YaoTenantRootContextV2,
        pair: &Ed25519YaoInputPairBindingV1,
    ) -> bool {
        &self.request.binding == pair.binding()
            && self.request.tenant_root.identity == context.identity
            && self.request.application == context.application
            && self.request.participant_ids == context.participant_ids
            && self.request.ownership_generation == context.ownership_generation
            && self.wallet_route == context.wallet_route
            && self.custody_binding.activation_receipt_b64u
                == context.custody_binding.activation_receipt_b64u
    }
}

#[cfg(feature = "strict-worker-router-entrypoint")]
pub(crate) async fn prepare_pair(
    env: &worker::Env,
    route: WalletObjectRoute,
    request: RegistrationPreparationRequest,
) -> RouterAbProtocolResult<()> {
    let now_ms = crate::cloudflare_now_unix_ms_v1()?;
    request.validate(now_ms)?;
    let (identity, lineage) = request.tenant_root.resolve()?;
    let receipt = crate::tenant_root_refresh_coordinator::execute_cloudflare_router_tenant_root_admission_receipt_v1(
        env, identity, lineage,
    ).await?;
    let mut hash = Sha256::new();
    hash.update(b"seams/yao/registration-preparation-scope/v1");
    hash.update(
        serde_json::to_vec(&(&request, route)).map_err(|_| invalid("Invalid preparation scope"))?,
    );
    let digest = PublicDigest32::new(hash.finalize().into());
    let (operation, session, nonce) = crate::derive_cloudflare_tenant_root_ecdsa_scope_v1(
        digest,
        b"seams/yao/registration-preparation/operation/v1",
        b"seams/yao/registration-preparation/session/v1",
        b"seams/yao/registration-preparation/nonce/v1",
    )?;
    let custody_binding =
        CloudflareTenantRootCustodyBindingWireV1::from_verified_activation_receipt(
            &receipt,
            operation,
            session,
            nonce,
            now_ms,
            request.expires_at_ms.min(now_ms.saturating_add(30_000)),
        )?;
    let preparation = RegistrationPreparation {
        request,
        wallet_route: route,
        custody_binding,
    };
    let (a, b) = futures::join!(
        send_role(env, "DERIVER_A", &preparation),
        send_role(env, "DERIVER_B", &preparation)
    );
    a?;
    b?;
    Ok(())
}

#[cfg(feature = "strict-worker-router-entrypoint")]
async fn send_role(
    env: &worker::Env,
    role: &str,
    preparation: &RegistrationPreparation,
) -> RouterAbProtocolResult<()> {
    let response = crate::router_coordinator::post_role_request(
        env,
        role,
        "https://router-ab-preparation.internal",
        ROLE_PATH,
        "Registration pair preparation",
        preparation,
        None,
    )
    .await?;
    if response.status_code() != 200 {
        return Err(invalid("Registration pair preparation failed"));
    }
    Ok(())
}

fn invalid(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::InvalidLifecycleState, message)
}

#[cfg(any(
    feature = "strict-worker-deriver-a-entrypoint",
    feature = "strict-worker-deriver-b-entrypoint"
))]
pub(crate) async fn forward_role_request(
    mut request: worker::Request,
    env: &worker::Env,
    role: crate::CloudflareWorkerRoleV1,
) -> worker::Result<worker::Response> {
    let preparation: RegistrationPreparation = if request.path() == SOCKET_PATH {
        if role != crate::CloudflareWorkerRoleV1::DeriverB
            || request.method() != worker::Method::Get
        {
            return worker::Response::error("Registration peer connection requires Deriver B", 405);
        }
        let encoded = request
            .headers()
            .get(PREPARATION_HEADER)?
            .filter(|value| value.len() <= 16384)
            .ok_or_else(|| worker::Error::RustError("Registration peer scope is missing".into()))?;
        serde_json::from_str(&encoded)
            .map_err(|error| worker::Error::RustError(error.to_string()))?
    } else {
        if request.method() != worker::Method::Post {
            return worker::Response::error("Registration admission requires POST", 405);
        }
        crate::durable_object::tenant_root_creation::decode_bounded_json_request(
            &mut request,
            16384,
        )
        .await
        .map_err(|error| worker::Error::RustError(error.to_string()))?
    };
    preparation
        .authenticate(
            &crate::CloudflareWorkerEnvReaderV1::new(env),
            worker::Date::now().as_millis(),
        )
        .map_err(|error| worker::Error::RustError(error.to_string()))?;
    let (binding, address) = match role {
        crate::CloudflareWorkerRoleV1::DeriverA => (
            "DERIVER_A_WALLET_DO",
            preparation.wallet_route.addresses.deriver_a,
        ),
        crate::CloudflareWorkerRoleV1::DeriverB => (
            "DERIVER_B_WALLET_DO",
            preparation.wallet_route.addresses.deriver_b,
        ),
        _ => return worker::Response::error("Registration role is unavailable", 400),
    };
    let forwarded = if request.path() == SOCKET_PATH {
        request
    } else {
        worker::Request::new_with_init(
            &format!("https://router-ab-do.internal{ROLE_PATH}"),
            worker::RequestInit::new()
                .with_method(worker::Method::Post)
                .with_body(Some(
                    serde_json::to_string(&preparation)
                        .map_err(|error| worker::Error::RustError(error.to_string()))?
                        .into(),
                )),
        )?
    };
    address
        .stub(&env.durable_object(binding)?, preparation.wallet_route.home)?
        .fetch_with_request(forwarded)
        .await
}

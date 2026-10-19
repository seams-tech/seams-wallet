use super::*;
use crate::durable_object::tenant_root_creation::{
    decode_bounded_json_request, renewal_call, RENEWAL_PATH,
};
use crate::tenant_root_creation_coordinator::CloudflareRouterTenantRootCreationHostV1;
use crate::{
    CloudflareTenantRootControlPlaneCreateTenantRootRequestV1,
    TENANT_ROOT_CONTROL_PLANE_CREATE_TENANT_ROOT_REQUEST_MAX_BYTES_V1,
};

pub(super) async fn handle(mut request: Request, env: Env) -> worker::Result<Response> {
    if let Err(error) = require_cloudflare_internal_service_auth_request_v1(&request, &env) {
        return cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("Tenant-root creation routes require POST", 405);
    }
    let runtime = match CloudflareRouterWorkerRuntimeV1::from_worker_env(&env) {
        Ok(runtime) => runtime,
        Err(error) => return cloudflare_protocol_error_response_v1(error),
    };
    let parsed: CloudflareTenantRootControlPlaneCreateTenantRootRequestV1 =
        match decode_bounded_json_request(
            &mut request,
            TENANT_ROOT_CONTROL_PLANE_CREATE_TENANT_ROOT_REQUEST_MAX_BYTES_V1,
        )
        .await
        {
            Ok(parsed) => parsed,
            Err(error) => return cloudflare_protocol_error_response_v1(error),
        };
    if request.path() == RENEWAL_PATH {
        return match renewal_call(&env, &parsed).await {
            Ok(outcome) => Response::from_json(&outcome),
            Err(error) => cloudflare_protocol_error_response_v1(error),
        };
    }
    match crate::tenant_root_router_coordinate_creation_v1(
        &CloudflareRouterTenantRootCreationHostV1::new(&env, &runtime),
        parsed,
    )
    .await
    {
        Ok(outcome) => Response::from_json(&outcome),
        Err(error) => cloudflare_protocol_error_response_v1(error),
    }
}

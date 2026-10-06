use crate::{
    SigningWorkerEd25519FenceCommandV1, SigningWorkerEd25519SettlementV1,
    SigningWorkerEd25519SnapshotCommandV1, SigningWorkerEd25519SnapshotResponseV1,
};
use worker::{Env, Method, Request, Response};

pub(crate) async fn handle(mut request: Request, env: &Env) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("SigningWorker relocation requires POST", 405);
    }
    let path = request.path();
    if path == crate::SIGNING_WORKER_ED25519_SNAPSHOT_PATH_V1 {
        let command: SigningWorkerEd25519SnapshotCommandV1 =
            match crate::durable_object::tenant_root_creation::decode_bounded_json_request(
                &mut request,
                32768,
            )
            .await
            {
                Ok(command) => command,
                Err(error) => return crate::router_coordinator::protocol_error_response(error),
            };
        if let Err(error) = command.source().validate() {
            return crate::router_coordinator::protocol_error_response(error);
        }
        forward::<_, SigningWorkerEd25519SnapshotResponseV1>(env, &path, &command).await
    } else {
        let command: SigningWorkerEd25519FenceCommandV1 =
            match crate::durable_object::tenant_root_creation::decode_bounded_json_request(
                &mut request,
                8192,
            )
            .await
            {
                Ok(command) => command,
                Err(error) => return crate::router_coordinator::protocol_error_response(error),
            };
        if let Err(error) = command.validate() {
            return crate::router_coordinator::protocol_error_response(error);
        }
        forward::<_, SigningWorkerEd25519SettlementV1>(env, &path, &command).await
    }
}

async fn forward<T: serde::Serialize, R: serde::de::DeserializeOwned + serde::Serialize>(
    env: &Env,
    path: &str,
    command: &T,
) -> worker::Result<Response> {
    match crate::post_service_json_with_router_to_signing_worker_ecdsa_auth::<T, R>(
        env,
        "SIGNING_WORKER",
        &format!("https://signing-worker.router-ab.internal{path}"),
        "SigningWorker relocation",
        command,
    )
    .await
    {
        Ok(response) => Response::from_json(&response),
        Err(error) => crate::router_coordinator::protocol_error_response(error),
    }
}

use crate::{
    SigningWorkerEcdsaExportRequestV1, SigningWorkerEcdsaSnapshotChunkV1,
    SigningWorkerEcdsaTransferRequestV1, SigningWorkerEcdsaTransferResponseV1,
    SigningWorkerEd25519FenceCommandV1, SigningWorkerEd25519SettlementV1,
    SigningWorkerEd25519SnapshotCommandV1, SigningWorkerEd25519SnapshotResponseV1,
    SigningWorkerPoolFreezeCommandV1, SigningWorkerPoolFreezeResponseV1,
    SIGNING_WORKER_ECDSA_EXPORT_PATH_V1, SIGNING_WORKER_ECDSA_TRANSFER_PATH_V1,
    SIGNING_WORKER_ED25519_SETTLE_PATH_V1, SIGNING_WORKER_ED25519_SNAPSHOT_PATH_V1,
    SIGNING_WORKER_POOL_FREEZE_PATH_V1,
};
use worker::{Env, Method, Request, Response};

const CONTROL_REQUEST_BYTES: usize = 8192;
const ED25519_SEGMENT_REQUEST_BYTES: usize = 32768;
// One 65,536-byte ECDSA chunk, base64 encoding, and its receipt.
const ECDSA_CHUNK_REQUEST_BYTES: usize = 131072;

pub(crate) fn handles(path: &str) -> bool {
    matches!(
        path,
        SIGNING_WORKER_ED25519_SNAPSHOT_PATH_V1
            | SIGNING_WORKER_ED25519_SETTLE_PATH_V1
            | SIGNING_WORKER_POOL_FREEZE_PATH_V1
            | SIGNING_WORKER_ECDSA_EXPORT_PATH_V1
            | SIGNING_WORKER_ECDSA_TRANSFER_PATH_V1
    )
}

pub(crate) async fn handle(request: Request, env: &Env) -> worker::Result<Response> {
    if let Err(error) = crate::require_cloudflare_gateway_to_router_auth_request_v1(&request, env) {
        return crate::cloudflare_private_service_auth_error_response_v1(error);
    }
    if request.method() != Method::Post {
        return Response::error("SigningWorker relocation requires POST", 405);
    }
    match request.path().as_str() {
        SIGNING_WORKER_ED25519_SNAPSHOT_PATH_V1 => forward::<
            SigningWorkerEd25519SnapshotCommandV1,
            SigningWorkerEd25519SnapshotResponseV1,
        >(
            request, env, ED25519_SEGMENT_REQUEST_BYTES
        )
        .await,
        SIGNING_WORKER_ED25519_SETTLE_PATH_V1 => {
            forward::<SigningWorkerEd25519FenceCommandV1, SigningWorkerEd25519SettlementV1>(
                request,
                env,
                CONTROL_REQUEST_BYTES,
            )
            .await
        }
        SIGNING_WORKER_POOL_FREEZE_PATH_V1 => {
            forward::<SigningWorkerPoolFreezeCommandV1, SigningWorkerPoolFreezeResponseV1>(
                request,
                env,
                CONTROL_REQUEST_BYTES,
            )
            .await
        }
        SIGNING_WORKER_ECDSA_EXPORT_PATH_V1 => {
            forward::<SigningWorkerEcdsaExportRequestV1, SigningWorkerEcdsaSnapshotChunkV1>(
                request,
                env,
                CONTROL_REQUEST_BYTES,
            )
            .await
        }
        SIGNING_WORKER_ECDSA_TRANSFER_PATH_V1 => {
            forward::<SigningWorkerEcdsaTransferRequestV1, SigningWorkerEcdsaTransferResponseV1>(
                request,
                env,
                ECDSA_CHUNK_REQUEST_BYTES,
            )
            .await
        }
        _ => Response::error("SigningWorker relocation route is absent", 404),
    }
}

async fn forward<T, R>(mut request: Request, env: &Env, max_bytes: usize) -> worker::Result<Response>
where
    T: serde::de::DeserializeOwned + serde::Serialize,
    R: serde::de::DeserializeOwned + serde::Serialize,
{
    let path = request.path();
    let command: T = match crate::durable_object::tenant_root_creation::decode_bounded_json_request(
        &mut request,
        max_bytes,
    )
    .await
    {
        Ok(command) => command,
        Err(error) => return crate::router_coordinator::protocol_error_response(error),
    };
    match crate::post_service_json_with_router_to_signing_worker_ecdsa_auth::<T, R>(
        env,
        "SIGNING_WORKER",
        &format!("https://signing-worker.router-ab.internal{path}"),
        "SigningWorker relocation",
        &command,
    )
    .await
    {
        Ok(response) => Response::from_json(&response),
        Err(error) => crate::router_coordinator::protocol_error_response(error),
    }
}

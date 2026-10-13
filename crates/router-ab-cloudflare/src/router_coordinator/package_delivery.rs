use super::*;
use crate::ed25519_yao_signing_worker::package_delivery::{DeliveryAddress, ADDRESS_HEADER};
use futures::channel::oneshot;
use worker::{wasm_bindgen::JsValue, ResponseBody};

const LABEL: &str = "SigningWorker Yao package delivery";

pub(super) enum Delivery {
    Ready,
    Pending {
        body: oneshot::Sender<CloudflareScopedEd25519YaoPackagePairDeliveryV1>,
        receipt: oneshot::Receiver<SigningWorkerReceiptV1>,
    },
}

pub(super) struct Exchange {
    body: oneshot::Receiver<CloudflareScopedEd25519YaoPackagePairDeliveryV1>,
    receipt: oneshot::Sender<SigningWorkerReceiptV1>,
}

pub(super) fn channel() -> (Delivery, Exchange) {
    let (send_body, body) = oneshot::channel();
    let (receipt, receive_receipt) = oneshot::channel();
    (
        Delivery::Pending {
            body: send_body,
            receipt: receive_receipt,
        },
        Exchange { body, receipt },
    )
}

impl Delivery {
    pub(super) async fn send(
        self,
        env: &Env,
        runtime: &CloudflareRouterWorkerRuntimeV1,
        delivery: CloudflareScopedEd25519YaoPackagePairDeliveryV1,
        trace_id: Option<crate::CloudflareTraceIdV1>,
    ) -> RouterAbProtocolResult<SigningWorkerReceiptV1> {
        delivery.validate()?;
        match self {
            Self::Pending { body, receipt } => {
                body.send(delivery).map_err(|_| {
                    delivery_error("SigningWorker delivery closed before packages were ready")
                })?;
                receipt
                    .await
                    .map_err(|_| delivery_error("SigningWorker delivery receipt was lost"))
            }
            Self::Ready => {
                let address = DeliveryAddress::from_delivery(&delivery);
                let body = cloudflare_service_json_request_body_v1(LABEL, &delivery)?;
                send_request(env, runtime, address, JsValue::from_str(&body), trace_id).await
            }
        }
    }
}

impl Exchange {
    pub(super) async fn run(
        self,
        env: &Env,
        runtime: &CloudflareRouterWorkerRuntimeV1,
        address: DeliveryAddress,
        trace_id: Option<crate::CloudflareTraceIdV1>,
    ) -> RouterAbProtocolResult<()> {
        let receipt = send_stream(env, runtime, address, self.body, trace_id).await?;
        // The coordinator observes delivery failures even before packages are ready.
        let _ = self.receipt.send(receipt);
        Ok(())
    }
}

async fn send_stream(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    address: DeliveryAddress,
    body: oneshot::Receiver<CloudflareScopedEd25519YaoPackagePairDeliveryV1>,
    trace_id: Option<crate::CloudflareTraceIdV1>,
) -> RouterAbProtocolResult<SigningWorkerReceiptV1> {
    let stream = Response::from_stream(futures::stream::once(receive_body(body)))
        .map_err(|_| delivery_error("SigningWorker delivery stream failed"))?;
    let ResponseBody::Stream(stream) = stream.body() else {
        return Err(delivery_error(
            "SigningWorker delivery body is not a stream",
        ));
    };
    send_request(env, runtime, address, stream.clone().into(), trace_id).await
}

async fn receive_body(
    body: oneshot::Receiver<CloudflareScopedEd25519YaoPackagePairDeliveryV1>,
) -> worker::Result<Vec<u8>> {
    let delivery = body
        .await
        .map_err(|_| worker::Error::RustError("Yao ceremony ended without packages".to_owned()))?;
    serde_json::to_vec(&delivery).map_err(worker::Error::from)
}

async fn send_request(
    env: &Env,
    runtime: &CloudflareRouterWorkerRuntimeV1,
    address: DeliveryAddress,
    body: JsValue,
    trace_id: Option<crate::CloudflareTraceIdV1>,
) -> RouterAbProtocolResult<SigningWorkerReceiptV1> {
    address.validate()?;
    let headers = worker::Headers::new();
    let encoded_address = serde_json::to_string(&address)
        .map_err(|_| delivery_error("SigningWorker delivery address encoding failed"))?;
    headers
        .set(ADDRESS_HEADER, &encoded_address)
        .and_then(|()| headers.set("content-type", "application/json"))
        .map_err(|_| delivery_error("SigningWorker delivery headers failed"))?;
    set_cloudflare_internal_service_auth_header_v1(env, &headers, LABEL)?;
    if let Some(trace_id) = trace_id {
        set_cloudflare_trace_id_header_v1(&headers, trace_id)?;
    }
    let request = Request::new_with_init(
        &format!(
            "{SIGNING_WORKER_SERVICE_URL}{CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_PACKAGES_PATH}"
        ),
        RequestInit::new()
            .with_method(Method::Post)
            .with_headers(headers)
            .with_body(Some(body)),
    )
    .map_err(|_| delivery_error("SigningWorker delivery request failed"))?;
    let fetcher = env
        .service(runtime.signing_worker_peer().binding_name.as_str())
        .map_err(|_| delivery_error("SigningWorker delivery binding is missing"))?;
    let started = cloudflare_now_unix_ms_v1()?;
    let mut response = fetcher
        .fetch_request(request)
        .await
        .map_err(|_| delivery_error("SigningWorker delivery request failed"))?;
    emit_span(
        trace_id,
        "router.signing_worker_delivery_exchange",
        "activation",
        started,
        if response.status_code() == 200 {
            "success"
        } else {
            "failure"
        },
    );
    role_transport::read_role_json_response(&mut response, LABEL, trace_id).await
}

fn delivery_error(message: &str) -> RouterAbProtocolError {
    RouterAbProtocolError::new(
        RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
        message,
    )
}

/// A superseded attempt ends terminally, including an early delivery refusal.
pub(super) fn failure_outcome(
    error: RouterAbProtocolError,
) -> RouterAbProtocolResult<RouterCeremonyOutcomeV1> {
    if error.code() == RouterAbProtocolErrorCode::SupersededAttempt {
        return Ok(RouterCeremonyOutcomeV1::Standard(
            RouterEd25519YaoExecuteResultV1::rejected(
                router_ab_core::RouterEd25519YaoExecuteFailureCodeV1::AttemptSuperseded,
            ),
        ));
    }
    Err(error)
}

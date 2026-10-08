use super::*;
use crate::ed25519_yao_signing_worker::package_delivery::DeliveryAddress;
use futures::future::{select, Either};

const MAX_DELIVERY_BYTES: usize = 1_048_576;
const DELIVERY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

pub(crate) async fn forward(
    request: Request,
    env: &Env,
) -> Result<Response, RouterAbProtocolError> {
    if request.method() != worker::Method::Post {
        return Err(wallet_error("SigningWorker package delivery requires POST"));
    }
    let address = DeliveryAddress::read(&request)?;
    let name = crate::wallet_object::physical_wallet_object_name(
        &object_name(&address.scope)?,
        address.ownership_generation,
    )?;
    let namespace = env
        .durable_object(BINDING)
        .map_err(|_| wallet_error("SigningWorker wallet binding is missing"))?;
    let stub = address
        .wallet_home
        .wallet_stub(&namespace, &name, "signing_worker")
        .map_err(|_| wallet_error("SigningWorker delivery wallet identity is invalid"))?;
    stub.fetch_with_request(request)
        .await
        .map_err(|_| wallet_error("SigningWorker package delivery failed"))
}

impl RouterAbSigningWorkerWalletDurableObject {
    pub(super) async fn receive_package_delivery(
        &self,
        mut request: Request,
    ) -> worker::Result<Response> {
        let result = self.install_streamed_packages(&mut request).await;
        match result {
            Ok(response) => Ok(response),
            Err(error) => Response::error(
                format!("{:?}: {}", error.code(), error.message()),
                crate::cloudflare_router_error_status(error.code()),
            ),
        }
    }

    async fn install_streamed_packages(
        &self,
        request: &mut Request,
    ) -> Result<Response, RouterAbProtocolError> {
        if request.method() != worker::Method::Post {
            return Err(wallet_error("SigningWorker package delivery requires POST"));
        }
        let address = DeliveryAddress::read(request)?;
        let trace_id = crate::parse_cloudflare_trace_id_from_request_v1(request)?;
        let wait_started = crate::cloudflare_now_unix_ms_v1()?;
        let body = Box::pin(
            crate::durable_object::tenant_root_creation::decode_bounded_json_request::<
                CloudflareScopedEd25519YaoPackagePairDeliveryV1,
            >(request, MAX_DELIVERY_BYTES),
        );
        let timeout = Box::pin(worker::Delay::from(DELIVERY_TIMEOUT));
        let delivery = match select(body, timeout).await {
            Either::Left((result, _)) => result?,
            Either::Right(_) => {
                return Err(wallet_error("SigningWorker package delivery timed out"))
            }
        };
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "router_ab_yao_delivery_v1",
                "trace_id": trace_id.map(crate::CloudflareTraceIdV1::as_hex),
                "stage": "body_wait",
                "duration_ms": crate::cloudflare_now_unix_ms_v1()?.saturating_sub(wait_started),
            })
        );
        delivery.validate()?;
        if DeliveryAddress::from_delivery(&delivery) != address {
            return Err(wallet_error(
                "SigningWorker packages do not match the delivery address",
            ));
        }
        self.initialize_schema().map_err(sql_error)?;
        self.execute(SigningWorkerWalletDoRequestV1::DeliverPackages(delivery))
            .await
    }
}

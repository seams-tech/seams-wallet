use super::*;
use crate::ed25519_yao_signing_worker::reissue::check_signing_worker_yao_reissue_v1;

impl RouterAbSigningWorkerWalletDurableObject {
    /// Checks a reissue delivery against this wallet's active registration
    /// material and writes nothing. The answer is the active receipt at the
    /// current state epoch, which the Router needs before it releases the
    /// Client packages. A fenced wallet releases nothing.
    pub(super) fn check_reissue(
        &self,
        request: CloudflareScopedEd25519YaoPackagePairDeliveryV1,
    ) -> Result<Response, RouterAbProtocolError> {
        self.require_ed25519_unfenced(&request.scope)?;
        let registration_key = registration_key(&request.delivery.deriver_a.binding);
        let stored = self.read_registration(&request.scope, &registration_key)?;
        let runtime = CloudflareSigningWorkerRuntimeV1::from_worker_env(&self.env)?;
        let receipt = check_signing_worker_yao_reissue_v1(
            &self.env,
            &runtime,
            &request.delivery,
            stored.as_ref().map(|stored| &stored.lifecycle),
        )?;
        Response::from_json(&http_active_receipt(receipt)).map_err(sql_error)
    }
}

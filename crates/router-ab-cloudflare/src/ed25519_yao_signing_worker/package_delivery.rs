use super::*;

pub(crate) const ADDRESS_HEADER: &str = "x-seams-yao-delivery-address";

/// Authenticated routing facts sent before the sealed packages become available.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DeliveryAddress {
    pub wallet_route: crate::WalletObjectRoute,
    pub ownership_generation: u64,
    pub scope: crate::CloudflareSigningWorkerWalletScopeV1,
}

impl DeliveryAddress {
    pub(crate) fn from_delivery(
        delivery: &CloudflareScopedEd25519YaoPackagePairDeliveryV1,
    ) -> Self {
        Self {
            wallet_route: delivery.wallet_route,
            ownership_generation: delivery.ownership_generation,
            scope: delivery.scope.clone(),
        }
    }

    pub(crate) fn validate(&self) -> RouterAbProtocolResult<()> {
        self.scope.validate()?;
        crate::router_wallet::validate_wallet_ownership_generation(self.ownership_generation)
    }

    pub(crate) fn read(request: &worker::Request) -> RouterAbProtocolResult<Self> {
        let raw = request
            .headers()
            .get(ADDRESS_HEADER)
            .map_err(|_| invalid_lifecycle("SigningWorker delivery address is unreadable"))?
            .ok_or_else(|| invalid_lifecycle("SigningWorker delivery address is missing"))?;
        if raw.len() > 4096 {
            return Err(invalid_lifecycle(
                "SigningWorker delivery address is too large",
            ));
        }
        let address: Self = serde_json::from_str(&raw)
            .map_err(|_| invalid_lifecycle("SigningWorker delivery address is malformed"))?;
        address.validate()?;
        Ok(address)
    }
}

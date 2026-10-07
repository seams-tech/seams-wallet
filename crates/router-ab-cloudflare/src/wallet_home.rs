use serde::{Deserialize, Serialize};

/// Placement supplied by the authenticated wallet-home Gateway, never the client.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WalletHomeRegion {
    US,
    WEUR,
    APAC,
    OC,
}

impl WalletHomeRegion {
    pub fn location_hint(self) -> &'static str {
        match self {
            Self::US => "enam",
            Self::WEUR => "weur",
            Self::APAC => "apac",
            Self::OC => "oc",
        }
    }

    #[cfg(feature = "workers-rs")]
    pub(crate) fn wallet_stub(
        self,
        namespace: &worker::ObjectNamespace,
        name: &str,
        role: &'static str,
    ) -> worker::Result<worker::Stub> {
        let hint = self.location_hint();
        let stub = namespace.get_by_name_with_location_hint(name, hint)?;
        let event = serde_json::json!({
            "event": "wallet_do_placement_requested",
            "role": role,
            "wallet_home": self,
            "location_hint": hint,
            "object_id": namespace.id_from_name(name)?.to_string(),
        });
        worker::console_log!("{event}");
        Ok(stub)
    }

    /// Call only after verifying the private Gateway-to-Router credential.
    #[cfg(feature = "workers-rs")]
    pub(crate) fn from_gateway_request(
        request: &worker::Request,
    ) -> router_ab_core::RouterAbProtocolResult<Self> {
        let raw = request
            .headers()
            .get("x-seams-wallet-home-region")
            .ok()
            .flatten();
        match raw.as_deref() {
            Some("US") => Ok(Self::US),
            Some("WEUR") => Ok(Self::WEUR),
            Some("APAC") => Ok(Self::APAC),
            Some("OC") => Ok(Self::OC),
            _ => Err(router_ab_core::RouterAbProtocolError::new(
                router_ab_core::RouterAbProtocolErrorCode::MalformedWirePayload,
                "Authenticated wallet home region is missing or invalid",
            )),
        }
    }
}

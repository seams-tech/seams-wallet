use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// A namespace-issued address, separate from the stable identity in protocol records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WalletObjectId([u8; 64]);

impl WalletObjectId {
    pub fn parse(value: &str) -> Result<Self, &'static str> {
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("Wallet object address is not a Durable Object ID");
        }
        let mut bytes = [0; 64];
        bytes.copy_from_slice(value.as_bytes());
        Ok(Self(bytes))
    }

    pub fn as_str(&self) -> &str {
        // Only validated ASCII can construct this value.
        std::str::from_utf8(&self.0).expect("validated object ID")
    }

    #[cfg(feature = "workers-rs")]
    pub(crate) fn stub(
        &self,
        namespace: &worker::ObjectNamespace,
        home: crate::WalletHomeRegion,
    ) -> worker::Result<worker::Stub> {
        namespace
            .id_from_string(self.as_str())?
            .get_stub_with_location_hint(home.location_hint())
    }
}

impl Serialize for WalletObjectId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for WalletObjectId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Self::parse(&raw).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WalletObjectAddresses {
    pub router: WalletObjectId,
    pub deriver_a: WalletObjectId,
    pub deriver_b: WalletObjectId,
    pub signing_worker: WalletObjectId,
}

/// Routing metadata supplied by the authenticated home Gateway.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WalletObjectRoute {
    pub home: crate::WalletHomeRegion,
    pub addresses: WalletObjectAddresses,
}

#[cfg(feature = "workers-rs")]
impl WalletObjectRoute {
    pub(crate) fn wallet_stub(
        self,
        namespace: &worker::ObjectNamespace,
        logical_name: &str,
        role: &'static str,
    ) -> worker::Result<worker::Stub> {
        let address = match role {
            "router" => self.addresses.router,
            "deriver_a" => self.addresses.deriver_a,
            "deriver_b" => self.addresses.deriver_b,
            "signing_worker" => self.addresses.signing_worker,
            _ => {
                return Err(worker::Error::RustError(
                    "Unknown wallet object role".into(),
                ))
            }
        };
        let stub = address.stub(namespace, self.home)?;
        worker::console_log!(
            "{}",
            serde_json::json!({
                "event": "wallet_do_placement_requested",
                "role": role,
                "wallet_home": self.home,
                "location_hint": self.home.location_hint(),
                "object_name": logical_name,
                "object_id": address,
            })
        );
        Ok(stub)
    }

    pub(crate) fn set_headers(
        self,
        headers: &worker::Headers,
    ) -> router_ab_core::RouterAbProtocolResult<()> {
        let addresses = serde_json::to_string(&self.addresses)
            .map_err(|_| invalid_addresses("Wallet object addresses cannot be encoded"))?;
        let home = match self.home {
            crate::WalletHomeRegion::US => "US",
            crate::WalletHomeRegion::WEUR => "WEUR",
            crate::WalletHomeRegion::APAC => "APAC",
            crate::WalletHomeRegion::OC => "OC",
        };
        headers
            .set("x-seams-wallet-home-region", home)
            .and_then(|()| headers.set("x-seams-wallet-object-addresses", &addresses))
            .map_err(|_| invalid_addresses("Wallet object route headers cannot be set"))
    }

    pub(crate) fn from_gateway_request(
        request: &worker::Request,
    ) -> router_ab_core::RouterAbProtocolResult<Self> {
        let home = crate::WalletHomeRegion::from_gateway_request(request)?;
        let raw = request
            .headers()
            .get("x-seams-wallet-object-addresses")
            .ok()
            .flatten()
            .filter(|value| value.len() <= 512)
            .ok_or_else(|| invalid_addresses("Wallet object addresses are missing"))?;
        let addresses = serde_json::from_str(&raw)
            .map_err(|_| invalid_addresses("Wallet object addresses are malformed"))?;
        Ok(Self { home, addresses })
    }
}

#[cfg(feature = "workers-rs")]
fn invalid_addresses(message: &str) -> router_ab_core::RouterAbProtocolError {
    router_ab_core::RouterAbProtocolError::new(
        router_ab_core::RouterAbProtocolErrorCode::MalformedWirePayload,
        message,
    )
}

use serde::{Deserialize, Serialize};

/// WebAuthn authentication data for contract verification
#[derive(Serialize, Deserialize, Debug)]
pub struct WebAuthnAuthenticationCredential {
    pub id: String,
    #[serde(rename = "rawId")]
    pub raw_id: String,
    pub response: WebAuthnAuthenticationResponse,
    #[serde(rename = "authenticatorAttachment")]
    pub authenticator_attachment: Option<String>,
    #[serde(rename = "type")]
    pub auth_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WebAuthnAuthenticationResponse {
    #[serde(rename = "clientDataJSON")]
    pub client_data_json: String,
    #[serde(rename = "authenticatorData")]
    pub authenticator_data: String,
    pub signature: String,
    #[serde(rename = "userHandle")]
    pub user_handle: Option<String>,
}

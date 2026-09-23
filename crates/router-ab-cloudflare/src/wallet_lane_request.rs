use crate::{
    decode_base64url_fixed_32_v1, decode_base64url_fixed_64_v1, decode_base64url_json_v1,
    require_no_ascii_whitespace, require_non_empty, verify_ed25519_signature_v1,
    CloudflareRouterEd25519JwksJwtVerifierV1,
};
use router_ab_core::{RouterAbProtocolError, RouterAbProtocolErrorCode, RouterAbProtocolResult};
use serde::{Deserialize, Serialize};

/// Header carrying a Gateway-signed regional lane request.
pub const WALLET_LANE_INTERNAL_REQUEST_HEADER_V1: &str = "x-seams-wallet-lane-request";

const WALLET_LANE_INTERNAL_REQUEST_TOKEN_TYPE_V1: &str = "wallet-lane-request+jwt";
const MAX_WALLET_LANE_INTERNAL_REQUEST_LIFETIME_MS_V1: u64 = 30_000;

/// Regional private Worker role named by a signed lane request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WalletLaneInternalServiceRoleV1 {
    /// Regional Router.
    Router,
    /// Regional Deriver A.
    DeriverA,
    /// Regional Deriver B.
    DeriverB,
    /// Regional SigningWorker.
    SigningWorker,
}

/// Exact active authority copied into each regional lane's admission store.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveWalletLaneAuthorityV1 {
    wallet_id: String,
    lane_id: String,
    lane_epoch: u64,
    directory_revision: u64,
}

impl ActiveWalletLaneAuthorityV1 {
    /// Builds a validated active lane authority.
    pub fn new(
        wallet_id: impl Into<String>,
        lane_id: impl Into<String>,
        lane_epoch: u64,
        directory_revision: u64,
    ) -> RouterAbProtocolResult<Self> {
        let authority = Self {
            wallet_id: wallet_id.into(),
            lane_id: lane_id.into(),
            lane_epoch,
            directory_revision,
        };
        authority.validate()?;
        Ok(authority)
    }

    fn validate(&self) -> RouterAbProtocolResult<()> {
        require_identifier("wallet lane authority wallet id", &self.wallet_id)?;
        require_identifier("wallet lane authority lane id", &self.lane_id)?;
        require_positive("wallet lane authority epoch", self.lane_epoch)?;
        require_positive(
            "wallet lane authority directory revision",
            self.directory_revision,
        )
    }

    /// Wallet governed by this authority record.
    pub fn wallet_id(&self) -> &str {
        &self.wallet_id
    }

    /// Regional lane currently authorized for the wallet.
    pub fn lane_id(&self) -> &str {
        &self.lane_id
    }

    /// Current wallet lane epoch.
    pub const fn lane_epoch(&self) -> u64 {
        self.lane_epoch
    }

    /// Directory revision that installed this authority.
    pub const fn directory_revision(&self) -> u64 {
        self.directory_revision
    }
}

/// Expected request facts supplied by the receiving Worker boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalletLaneInternalRequestExpectationV1 {
    /// Worker role receiving the request.
    pub service_role: WalletLaneInternalServiceRoleV1,
    /// Uppercase HTTP method.
    pub request_method: String,
    /// URL path and query beginning with `/`.
    pub request_target: String,
    /// SHA-256 of the exact request body bytes.
    pub request_body_sha256: [u8; 32],
}

impl WalletLaneInternalRequestExpectationV1 {
    /// Builds a validated request expectation.
    pub fn new(
        service_role: WalletLaneInternalServiceRoleV1,
        request_method: impl Into<String>,
        request_target: impl Into<String>,
        request_body_sha256: [u8; 32],
    ) -> RouterAbProtocolResult<Self> {
        let expectation = Self {
            service_role,
            request_method: request_method.into(),
            request_target: request_target.into(),
            request_body_sha256,
        };
        expectation.validate()?;
        Ok(expectation)
    }

    fn validate(&self) -> RouterAbProtocolResult<()> {
        require_uppercase_method(&self.request_method)?;
        require_request_target(&self.request_target)
    }
}

/// Trusted signing configuration for regional lane request tokens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalletLaneInternalRequestVerifierV1 {
    issuer: String,
    audience: String,
    verifier: CloudflareRouterEd25519JwksJwtVerifierV1,
}

impl WalletLaneInternalRequestVerifierV1 {
    /// Parses a strict Ed25519 JWKS and binds it to one issuer and audience.
    pub fn new(
        issuer: impl Into<String>,
        audience: impl Into<String>,
        jwks_json: &str,
    ) -> RouterAbProtocolResult<Self> {
        let verifier = Self {
            issuer: issuer.into(),
            audience: audience.into(),
            verifier: CloudflareRouterEd25519JwksJwtVerifierV1::from_jwks_json(jwks_json)?,
        };
        verifier.validate()?;
        Ok(verifier)
    }

    fn validate(&self) -> RouterAbProtocolResult<()> {
        require_identifier("wallet lane request issuer", &self.issuer)?;
        require_identifier("wallet lane request audience", &self.audience)?;
        self.verifier.validate()
    }

    fn key_for_id(
        &self,
        key_id: &str,
    ) -> RouterAbProtocolResult<&crate::CloudflareRouterEd25519JwkV1> {
        require_identifier("wallet lane request key id", key_id)?;
        self.verifier
            .keys
            .iter()
            .find(|key| key.key_id == key_id)
            .ok_or_else(|| {
                RouterAbProtocolError::new(
                    RouterAbProtocolErrorCode::MalformedWirePayload,
                    "wallet lane request key id is not trusted",
                )
            })
    }
}

/// Process-local proof that a signed token matches the exact receiving request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedWalletLaneInternalRequestV1 {
    wallet_id: String,
    lane_id: String,
    lane_epoch: u64,
    directory_revision: u64,
    service_role: WalletLaneInternalServiceRoleV1,
}

impl AuthenticatedWalletLaneInternalRequestV1 {
    /// Wallet named by the authenticated request.
    pub fn wallet_id(&self) -> &str {
        &self.wallet_id
    }

    /// Regional lane named by the authenticated request.
    pub fn lane_id(&self) -> &str {
        &self.lane_id
    }

    /// Lane epoch named by the authenticated request.
    pub const fn lane_epoch(&self) -> u64 {
        self.lane_epoch
    }

    /// Directory revision named by the authenticated request.
    pub const fn directory_revision(&self) -> u64 {
        self.directory_revision
    }

    /// Receiving Worker role authenticated by the token.
    pub const fn service_role(&self) -> WalletLaneInternalServiceRoleV1 {
        self.service_role
    }
}

/// Process-local proof that the authenticated request and active lane authority agree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedWalletLaneInternalRequestV1 {
    wallet_id: String,
    lane_id: String,
    lane_epoch: u64,
    directory_revision: u64,
    service_role: WalletLaneInternalServiceRoleV1,
}

impl VerifiedWalletLaneInternalRequestV1 {
    /// Wallet authorized by the lane directory proof.
    pub fn wallet_id(&self) -> &str {
        &self.wallet_id
    }

    /// Active regional lane.
    pub fn lane_id(&self) -> &str {
        &self.lane_id
    }

    /// Active lane epoch.
    pub const fn lane_epoch(&self) -> u64 {
        self.lane_epoch
    }

    /// Directory revision used for this request.
    pub const fn directory_revision(&self) -> u64 {
        self.directory_revision
    }

    /// Regional Worker role authorized by the token.
    pub const fn service_role(&self) -> WalletLaneInternalServiceRoleV1 {
        self.service_role
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WalletLaneInternalRequestHeaderV1 {
    alg: String,
    kid: String,
    typ: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WalletLaneInternalRequestContextWireV1 {
    wallet_id: String,
    lane_id: String,
    lane_epoch: u64,
    directory_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WalletLaneInternalRequestClaimsV1 {
    iss: String,
    aud: String,
    iat_ms: u64,
    exp_ms: u64,
    wallet_lane_context: WalletLaneInternalRequestContextWireV1,
    service_role: WalletLaneInternalServiceRoleV1,
    request_method: String,
    request_target: String,
    request_body_sha256_b64u: String,
}

struct WalletLaneCompactTokenV1 {
    signing_input: String,
    header: WalletLaneInternalRequestHeaderV1,
    claims: WalletLaneInternalRequestClaimsV1,
    signature: [u8; 64],
}

impl WalletLaneCompactTokenV1 {
    fn parse(token: &str) -> RouterAbProtocolResult<Self> {
        require_non_empty("wallet lane request token", token)?;
        require_no_ascii_whitespace("wallet lane request token", token)?;
        let mut parts = token.split('.');
        let header_segment = parts.next().ok_or_else(token_segment_error)?;
        let claims_segment = parts.next().ok_or_else(token_segment_error)?;
        let signature_segment = parts.next().ok_or_else(token_segment_error)?;
        if parts.next().is_some() {
            return Err(token_segment_error());
        }
        Ok(Self {
            signing_input: format!("{header_segment}.{claims_segment}"),
            header: decode_base64url_json_v1("wallet lane request header", header_segment)?,
            claims: decode_base64url_json_v1("wallet lane request claims", claims_segment)?,
            signature: decode_base64url_fixed_64_v1(
                "wallet lane request signature",
                signature_segment,
            )?,
        })
    }
}

/// Verifies a signed request against the receiving Worker and its lane-local authority.
pub fn verify_wallet_lane_internal_request_v1(
    token: &str,
    verifier: &WalletLaneInternalRequestVerifierV1,
    expectation: &WalletLaneInternalRequestExpectationV1,
    authority: &ActiveWalletLaneAuthorityV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<VerifiedWalletLaneInternalRequestV1> {
    let authenticated =
        authenticate_wallet_lane_internal_request_v1(token, verifier, expectation, now_unix_ms)?;
    admit_wallet_lane_internal_request_authority_v1(authenticated, authority)
}

/// Authenticates the token and exact Worker request before its wallet authority is loaded.
pub fn authenticate_wallet_lane_internal_request_v1(
    token: &str,
    verifier: &WalletLaneInternalRequestVerifierV1,
    expectation: &WalletLaneInternalRequestExpectationV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<AuthenticatedWalletLaneInternalRequestV1> {
    verifier.validate()?;
    expectation.validate()?;
    require_positive("wallet lane request verification time", now_unix_ms)?;

    let token = WalletLaneCompactTokenV1::parse(token)?;
    if token.header.alg != "EdDSA" || token.header.typ != WALLET_LANE_INTERNAL_REQUEST_TOKEN_TYPE_V1
    {
        return Err(malformed("wallet lane request header is invalid"));
    }
    let key = verifier.key_for_id(&token.header.kid)?;
    verify_ed25519_signature_v1(
        "wallet lane request",
        &token.signing_input,
        &token.signature,
        key,
    )?;
    authenticate_claims(token.claims, verifier, expectation, now_unix_ms)
}

/// Admits an authenticated request against the exact active lane authority loaded from D1.
pub fn admit_wallet_lane_internal_request_authority_v1(
    authenticated: AuthenticatedWalletLaneInternalRequestV1,
    authority: &ActiveWalletLaneAuthorityV1,
) -> RouterAbProtocolResult<VerifiedWalletLaneInternalRequestV1> {
    authority.validate()?;
    if authenticated.wallet_id != authority.wallet_id
        || authenticated.lane_id != authority.lane_id
        || authenticated.lane_epoch != authority.lane_epoch
        || authenticated.directory_revision != authority.directory_revision
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
            "wallet lane request does not match the active lane authority",
        ));
    }

    Ok(VerifiedWalletLaneInternalRequestV1 {
        wallet_id: authenticated.wallet_id,
        lane_id: authenticated.lane_id,
        lane_epoch: authenticated.lane_epoch,
        directory_revision: authenticated.directory_revision,
        service_role: authenticated.service_role,
    })
}

fn authenticate_claims(
    claims: WalletLaneInternalRequestClaimsV1,
    verifier: &WalletLaneInternalRequestVerifierV1,
    expectation: &WalletLaneInternalRequestExpectationV1,
    now_unix_ms: u64,
) -> RouterAbProtocolResult<AuthenticatedWalletLaneInternalRequestV1> {
    if claims.iss != verifier.issuer || claims.aud != verifier.audience {
        return Err(malformed(
            "wallet lane request issuer or audience is invalid",
        ));
    }
    require_positive("wallet lane request issued-at time", claims.iat_ms)?;
    require_positive("wallet lane request expiry time", claims.exp_ms)?;
    if claims.iat_ms > now_unix_ms {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidTimeRange,
            "wallet lane request issued-at time is in the future",
        ));
    }
    if claims.exp_ms <= now_unix_ms {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::ExpiredLocalRequest,
            "wallet lane request is expired",
        ));
    }
    let lifetime_ms = claims.exp_ms.checked_sub(claims.iat_ms).ok_or_else(|| {
        RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidTimeRange,
            "wallet lane request expiry precedes issuance",
        )
    })?;
    if lifetime_ms == 0 || lifetime_ms > MAX_WALLET_LANE_INTERNAL_REQUEST_LIFETIME_MS_V1 {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidTimeRange,
            "wallet lane request lifetime exceeds policy",
        ));
    }

    let context = claims.wallet_lane_context;
    require_identifier("wallet lane request wallet id", &context.wallet_id)?;
    require_identifier("wallet lane request lane id", &context.lane_id)?;
    require_positive("wallet lane request epoch", context.lane_epoch)?;
    require_positive(
        "wallet lane request directory revision",
        context.directory_revision,
    )?;
    require_uppercase_method(&claims.request_method)?;
    require_request_target(&claims.request_target)?;
    let body_digest = decode_base64url_fixed_32_v1(
        "wallet lane request body digest",
        &claims.request_body_sha256_b64u,
    )?;

    if claims.service_role != expectation.service_role
        || claims.request_method != expectation.request_method
        || claims.request_target != expectation.request_target
        || body_digest != expectation.request_body_sha256
    {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalHttpRequest,
            "wallet lane request does not match the receiving Worker request",
        ));
    }
    Ok(AuthenticatedWalletLaneInternalRequestV1 {
        wallet_id: context.wallet_id,
        lane_id: context.lane_id,
        lane_epoch: context.lane_epoch,
        directory_revision: context.directory_revision,
        service_role: claims.service_role,
    })
}

fn require_identifier(field: &str, value: &str) -> RouterAbProtocolResult<()> {
    require_non_empty(field, value)?;
    require_no_ascii_whitespace(field, value)?;
    if value.bytes().any(|byte| byte.is_ascii_control()) {
        return Err(malformed(format!("{field} contains control characters")));
    }
    Ok(())
}

fn require_uppercase_method(value: &str) -> RouterAbProtocolResult<()> {
    require_identifier("wallet lane request method", value)?;
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_uppercase() || byte == b'-')
    {
        return Err(malformed("wallet lane request method is invalid"));
    }
    Ok(())
}

fn require_request_target(value: &str) -> RouterAbProtocolResult<()> {
    require_non_empty("wallet lane request target", value)?;
    if !value.starts_with('/') || value.bytes().any(|byte| byte.is_ascii_control()) {
        return Err(malformed("wallet lane request target is invalid"));
    }
    Ok(())
}

fn require_positive(field: &str, value: u64) -> RouterAbProtocolResult<()> {
    if value == 0 {
        return Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidTimeRange,
            format!("{field} must be greater than zero"),
        ));
    }
    Ok(())
}

fn malformed(message: impl Into<String>) -> RouterAbProtocolError {
    RouterAbProtocolError::new(RouterAbProtocolErrorCode::MalformedWirePayload, message)
}

fn token_segment_error() -> RouterAbProtocolError {
    malformed("wallet lane request token must use compact three-segment serialization")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encode_base64url_bytes_v1;
    use ed25519_dalek::{Signer, SigningKey};
    use sha2::{Digest, Sha256};

    const TEST_SIGNING_KEY: [u8; 32] = [7; 32];
    const TYPESCRIPT_ISSUED_TOKEN_V1: &str = "eyJhbGciOiJFZERTQSIsImtpZCI6IndhbGxldC1sYW5lLXRlc3Qta2V5IiwidHlwIjoid2FsbGV0LWxhbmUtcmVxdWVzdCtqd3QifQ.eyJpc3MiOiJodHRwczovL3dhbGxldC1nYXRld2F5LnRlc3QiLCJhdWQiOiJ3YWxsZXQtbGFuZS13b3JrZXJzIiwiaWF0X21zIjoyMDAwMCwiZXhwX21zIjozMDAwMCwid2FsbGV0X2xhbmVfY29udGV4dCI6eyJ3YWxsZXRfaWQiOiJ3YWxsZXQ6cmVnaW9uLWZpeHR1cmUiLCJsYW5lX2lkIjoibWFuYWdlZC1uYS12MSIsImxhbmVfZXBvY2giOjEsImRpcmVjdG9yeV9yZXZpc2lvbiI6M30sInNlcnZpY2Vfcm9sZSI6InJvdXRlciIsInJlcXVlc3RfbWV0aG9kIjoiUE9TVCIsInJlcXVlc3RfdGFyZ2V0IjoiL2NvbW1hbmRzP3BoYXNlPXByZXBhcmUiLCJyZXF1ZXN0X2JvZHlfc2hhMjU2X2I2NHUiOiJaOUJzUHJtbkV3ZUFvMXZkS1ZIU08zck9jazMxa3RJVlN3SWYyTnlsNTRzIn0.UOY3yQ9QuifS0z6TtBBrxr4FFJHqlAhrl_EoL3a6ffMLECr3jC-PPk23UqPMlsWxCwjjmd8D613Dpjp6N1gZCg";

    fn verifier() -> WalletLaneInternalRequestVerifierV1 {
        let public_key = SigningKey::from_bytes(&TEST_SIGNING_KEY)
            .verifying_key()
            .to_bytes();
        WalletLaneInternalRequestVerifierV1::new(
            "https://wallet-gateway.test",
            "wallet-lane-workers",
            &serde_json::json!({
                "keys": [{
                    "kty": "OKP",
                    "crv": "Ed25519",
                    "alg": "EdDSA",
                    "use": "sig",
                    "kid": "wallet-lane-test-key",
                    "x": encode_base64url_bytes_v1(&public_key),
                }]
            })
            .to_string(),
        )
        .expect("verifier")
    }

    fn authority() -> ActiveWalletLaneAuthorityV1 {
        ActiveWalletLaneAuthorityV1::new("wallet:region-fixture", "managed-na-v1", 1, 3)
            .expect("authority")
    }

    fn expectation(body: &[u8]) -> WalletLaneInternalRequestExpectationV1 {
        WalletLaneInternalRequestExpectationV1::new(
            WalletLaneInternalServiceRoleV1::Router,
            "POST",
            "/commands?phase=prepare",
            Sha256::digest(body).into(),
        )
        .expect("expectation")
    }

    fn token(overrides: impl FnOnce(&mut serde_json::Value)) -> String {
        let header = serde_json::json!({
            "alg": "EdDSA",
            "kid": "wallet-lane-test-key",
            "typ": "wallet-lane-request+jwt",
        });
        let mut claims = serde_json::json!({
            "iss": "https://wallet-gateway.test",
            "aud": "wallet-lane-workers",
            "iat_ms": 20_000,
            "exp_ms": 30_000,
            "wallet_lane_context": {
                "wallet_id": "wallet:region-fixture",
                "lane_id": "managed-na-v1",
                "lane_epoch": 1,
                "directory_revision": 3,
            },
            "service_role": "router",
            "request_method": "POST",
            "request_target": "/commands?phase=prepare",
            "request_body_sha256_b64u": encode_base64url_bytes_v1(
                &Sha256::digest(br#"{"command":"prepare"}"#)
            ),
        });
        overrides(&mut claims);
        let signing_input = format!(
            "{}.{}",
            encode_base64url_bytes_v1(serde_json::to_string(&header).expect("header").as_bytes()),
            encode_base64url_bytes_v1(serde_json::to_string(&claims).expect("claims").as_bytes()),
        );
        let signature = SigningKey::from_bytes(&TEST_SIGNING_KEY).sign(signing_input.as_bytes());
        format!(
            "{signing_input}.{}",
            encode_base64url_bytes_v1(&signature.to_bytes())
        )
    }

    #[test]
    fn verifies_exact_request_and_active_lane_authority() {
        let verified = verify_wallet_lane_internal_request_v1(
            &token(|_| {}),
            &verifier(),
            &expectation(br#"{"command":"prepare"}"#),
            &authority(),
            25_000,
        )
        .expect("verified request");

        assert_eq!(verified.wallet_id(), "wallet:region-fixture");
        assert_eq!(verified.lane_id(), "managed-na-v1");
        assert_eq!(verified.lane_epoch(), 1);
        assert_eq!(verified.directory_revision(), 3);
        assert_eq!(
            verified.service_role(),
            WalletLaneInternalServiceRoleV1::Router
        );
    }

    #[test]
    fn accepts_the_typescript_issued_wire_token() {
        let typescript_verifier = WalletLaneInternalRequestVerifierV1::new(
            "https://wallet-gateway.test",
            "wallet-lane-workers",
            &serde_json::json!({
                "keys": [{
                    "kty": "OKP",
                    "crv": "Ed25519",
                    "alg": "EdDSA",
                    "use": "sig",
                    "kid": "wallet-lane-test-key",
                    "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
                }]
            })
            .to_string(),
        )
        .expect("TypeScript verifier");

        verify_wallet_lane_internal_request_v1(
            TYPESCRIPT_ISSUED_TOKEN_V1,
            &typescript_verifier,
            &expectation(br#"{"command":"prepare"}"#),
            &authority(),
            25_000,
        )
        .expect("TypeScript-issued token");
    }

    #[test]
    fn authenticates_request_before_loading_its_wallet_authority() {
        let authenticated = authenticate_wallet_lane_internal_request_v1(
            &token(|_| {}),
            &verifier(),
            &expectation(br#"{"command":"prepare"}"#),
            25_000,
        )
        .expect("authenticated request");

        assert_eq!(authenticated.wallet_id(), "wallet:region-fixture");
        assert_eq!(authenticated.lane_id(), "managed-na-v1");
        assert_eq!(authenticated.lane_epoch(), 1);
        assert_eq!(authenticated.directory_revision(), 3);
        assert_eq!(
            authenticated.service_role(),
            WalletLaneInternalServiceRoleV1::Router
        );

        admit_wallet_lane_internal_request_authority_v1(authenticated, &authority())
            .expect("admitted request");
    }

    #[test]
    fn rejects_body_tampering_and_stale_lane_epochs() {
        let body_mismatch = verify_wallet_lane_internal_request_v1(
            &token(|_| {}),
            &verifier(),
            &expectation(br#"{"command":"finalize"}"#),
            &authority(),
            25_000,
        )
        .expect_err("body mismatch");
        assert_eq!(
            body_mismatch.code(),
            RouterAbProtocolErrorCode::InvalidLocalHttpRequest
        );

        let stale_epoch = verify_wallet_lane_internal_request_v1(
            &token(|_| {}),
            &verifier(),
            &expectation(br#"{"command":"prepare"}"#),
            &ActiveWalletLaneAuthorityV1::new("wallet:region-fixture", "managed-na-v1", 2, 4)
                .expect("authority"),
            25_000,
        )
        .expect_err("stale epoch");
        assert_eq!(
            stale_epoch.code(),
            RouterAbProtocolErrorCode::InvalidLocalHttpRequest
        );
    }

    #[test]
    fn rejects_expired_and_oversized_token_windows() {
        let expired = verify_wallet_lane_internal_request_v1(
            &token(|_| {}),
            &verifier(),
            &expectation(br#"{"command":"prepare"}"#),
            &authority(),
            30_000,
        )
        .expect_err("expired token");
        assert_eq!(
            expired.code(),
            RouterAbProtocolErrorCode::ExpiredLocalRequest
        );

        let oversized = verify_wallet_lane_internal_request_v1(
            &token(|claims| claims["exp_ms"] = serde_json::json!(60_001)),
            &verifier(),
            &expectation(br#"{"command":"prepare"}"#),
            &authority(),
            25_000,
        )
        .expect_err("oversized window");
        assert_eq!(
            oversized.code(),
            RouterAbProtocolErrorCode::InvalidTimeRange
        );
    }
}

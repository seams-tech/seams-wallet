//! Role-private delivery of material whose consumption already committed.
use super::*;
use futures::StreamExt;

const CONTENT_TYPE: &str = "application/octet-stream";
const MAX_METADATA_BYTES: usize = 128 * 1024;
const MAX_CIPHERTEXT_BYTES: usize = 16 * 1024 * 1024 + 16;
const MAX_FRAME_BYTES: usize = 4 + MAX_METADATA_BYTES + 32 + MAX_CIPHERTEXT_BYTES;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SigningMetadata {
    pub material: material::Record,
    pub batch: [u8; 32],
    pub binding: Binding,
}
pub(super) struct SigningInputs {
    pub metadata: SigningMetadata,
    pub sealed: Sealed,
}
pub(super) enum RoleOutput {
    Json(serde_json::Value),
    Taken { binding: Binding, sealed: Sealed },
    SigningInputs(SigningInputs),
}
impl RoleOutput {
    pub(super) fn into_json(self) -> Result<serde_json::Value> {
        match self {
            Self::Json(value) => Ok(value),
            Self::Taken { .. } | Self::SigningInputs(_) => {
                Err(invalid("ML-DSA metadata command returned private material"))
            }
        }
    }
    pub(super) fn into_response(self) -> worker::Result<Response> {
        match self {
            Self::Json(value) => Response::from_json(&value),
            Self::Taken { binding, sealed } => binary_response(&binding, sealed),
            Self::SigningInputs(inputs) => binary_response(&inputs.metadata, inputs.sealed),
        }
    }
}
pub(super) fn json<T: Serialize>(value: T) -> Result<RoleOutput> {
    super::json(value).map(RoleOutput::Json)
}
fn binary_response(metadata: &impl Serialize, sealed: Sealed) -> worker::Result<Response> {
    sealed.validate().map_err(protocol_error)?;
    let metadata = serde_json::to_vec(metadata)
        .map_err(|_| protocol_error(invalid("ML-DSA material metadata encoding failed")))?;
    if metadata.is_empty() || metadata.len() > MAX_METADATA_BYTES {
        return Err(protocol_error(invalid(
            "ML-DSA material metadata exceeds its bound",
        )));
    }
    let mut bytes = Vec::with_capacity(4 + metadata.len() + 32 + sealed.ciphertext.len());
    bytes.extend_from_slice(&(metadata.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&metadata);
    bytes.extend_from_slice(&sealed.encapsulated_key);
    bytes.extend_from_slice(&sealed.ciphertext);
    let mut response = Response::from_bytes(bytes)?;
    response.headers_mut().set("content-type", CONTENT_TYPE)?;
    Ok(response)
}
pub(super) async fn take(response: &mut Response) -> Result<(Binding, Sealed)> {
    decode(response).await
}
pub(super) async fn signing_inputs(response: &mut Response) -> Result<SigningInputs> {
    let (metadata, sealed) = decode(response).await?;
    Ok(SigningInputs { metadata, sealed })
}
async fn decode<T: serde::de::DeserializeOwned>(response: &mut Response) -> Result<(T, Sealed)> {
    if response
        .headers()
        .get("content-type")
        .map_err(storage_error)?
        .as_deref()
        != Some(CONTENT_TYPE)
    {
        return Err(invalid(
            "ML-DSA material response has an invalid content type",
        ));
    }
    let mut stream = response.stream().map_err(storage_error)?;
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(storage_error)?;
        if chunk.len() > MAX_FRAME_BYTES.saturating_sub(bytes.len()) {
            return Err(invalid("ML-DSA material response exceeds its bound"));
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() < 4 + 32 + 16 || bytes.len() > MAX_FRAME_BYTES {
        return Err(invalid("ML-DSA material response exceeds its bound"));
    }
    let prefix: [u8; 4] = bytes[..4]
        .try_into()
        .map_err(|_| invalid("ML-DSA material metadata length is absent"))?;
    let metadata_bytes = u32::from_le_bytes(prefix) as usize;
    if metadata_bytes == 0 || metadata_bytes > MAX_METADATA_BYTES {
        return Err(invalid("ML-DSA material metadata exceeds its bound"));
    }
    let encapsulation_at = 4 + metadata_bytes;
    let ciphertext_at = encapsulation_at + 32;
    if ciphertext_at + 16 > bytes.len() {
        return Err(invalid("ML-DSA material response is truncated"));
    }
    let metadata = serde_json::from_slice(&bytes[4..encapsulation_at])
        .map_err(|_| invalid("ML-DSA material metadata is invalid"))?;
    let encapsulated_key = bytes[encapsulation_at..ciphertext_at]
        .try_into()
        .map_err(|_| invalid("ML-DSA material encapsulation is invalid"))?;
    let ciphertext = bytes.split_off(ciphertext_at);
    let sealed = Sealed {
        encapsulated_key,
        ciphertext,
    };
    sealed.validate()?;
    Ok((metadata, sealed))
}

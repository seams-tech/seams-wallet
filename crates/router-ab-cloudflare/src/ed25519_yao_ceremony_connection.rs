//! A bounded, single-ceremony connection between the Router and Deriver A.
use futures::{
    future::{select, Either},
    StreamExt,
};
use router_ab_core::Ed25519YaoRoleReadinessReceiptV1;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;
use worker::{Delay, EventStream, Headers, Request, WebSocket, WebsocketEvent};

use crate::{CloudflareEd25519YaoPairExecuteResponseV1, CloudflareEd25519YaoRoleFailureResponseV1};

pub(crate) const PATH: &str = "/router-ab/deriver-a/ed25519-yao/ceremony";
pub(crate) const PREPARATION_HEADER: &str = "x-seams-yao-preparation";
pub(crate) const READINESS_HEADER: &str = "x-seams-yao-readiness";
const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const MESSAGE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Start {
    pub local_receipt: Ed25519YaoRoleReadinessReceiptV1,
    pub peer_receipt: Ed25519YaoRoleReadinessReceiptV1,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Outcome {
    Completed {
        execution: CloudflareEd25519YaoPairExecuteResponseV1,
    },
    Failed {
        failure: CloudflareEd25519YaoRoleFailureResponseV1,
    },
}

pub(crate) fn require_upgrade(request: &Request) -> worker::Result<()> {
    if request.method() != worker::Method::Get
        || request.headers().get("Upgrade")?.as_deref() != Some("websocket")
    {
        return Err(error("Ceremony connection requires a WebSocket upgrade"));
    }
    Ok(())
}

pub(crate) fn read_header<T: DeserializeOwned>(headers: &Headers, name: &str) -> worker::Result<T> {
    let text = headers
        .get(name)?
        .ok_or_else(|| error("Ceremony connection header is missing"))?;
    decode(&text)
}

pub(crate) fn write_header<T: Serialize>(
    headers: &Headers,
    name: &str,
    value: &T,
) -> worker::Result<()> {
    headers.set(name, &encode(value)?)
}

pub(crate) fn send<T: Serialize>(socket: &WebSocket, value: &T) -> worker::Result<()> {
    socket.send_with_str(&encode(value)?)
}

pub(crate) async fn receive<T: DeserializeOwned>(
    events: &mut EventStream<'_>,
) -> worker::Result<T> {
    let event = match select(
        Box::pin(events.next()),
        Box::pin(Delay::from(MESSAGE_TIMEOUT)),
    )
    .await
    {
        Either::Left((event, _)) => event,
        Either::Right(_) => return Err(error("Ceremony connection timed out")),
    };
    match event {
        Some(Ok(WebsocketEvent::Message(message))) => {
            let text = message
                .text()
                .ok_or_else(|| error("Ceremony connection requires a JSON message"))?;
            decode(&text)
        }
        _ => Err(error("Ceremony connection closed before its result")),
    }
}

fn decode<T: DeserializeOwned>(text: &str) -> worker::Result<T> {
    if text.len() > MAX_MESSAGE_BYTES {
        return Err(error("Ceremony connection message is too large"));
    }
    serde_json::from_str(text).map_err(|_| error("Ceremony connection message is malformed"))
}

fn encode<T: Serialize>(value: &T) -> worker::Result<String> {
    let text =
        serde_json::to_string(value).map_err(|_| error("Ceremony connection encoding failed"))?;
    if text.len() > MAX_MESSAGE_BYTES {
        return Err(error("Ceremony connection message is too large"));
    }
    Ok(text)
}

fn error(message: &str) -> worker::Error {
    worker::Error::RustError(message.into())
}

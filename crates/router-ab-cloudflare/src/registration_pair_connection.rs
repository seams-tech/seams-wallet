//! An idle peer connection carries no protocol material before execution is claimed.

use futures::{
    future::{select, Either},
    StreamExt,
};
use router_ab_core::Ed25519YaoExecutionIdV1;
use serde::{Deserialize, Serialize};
use worker::{Env, EventStream, Method, Request, WebsocketEvent};

use crate::ed25519_yao_websocket::CloudflareDeriverBPairStartScopeV1;
use crate::registration_pair_preparation::{
    RegistrationPreparation, PREPARATION_HEADER, SOCKET_PATH,
};
use crate::{CloudflareEd25519YaoPairStartConnectionV1, CloudflareEd25519YaoPairStartRefusalV1};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Start {
    pub execution_id: Ed25519YaoExecutionIdV1,
    pub scope: CloudflareDeriverBPairStartScopeV1,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Reply {
    Started {
        session: [u8; 32],
        pair_digest: [u8; 32],
        execution_id: Ed25519YaoExecutionIdV1,
    },
    Refused {
        refusal: CloudflareEd25519YaoPairStartRefusalV1,
    },
}

pub(crate) struct PreparedConnection {
    pub preparation: RegistrationPreparation,
    pub connection: CloudflareEd25519YaoPairStartConnectionV1,
}

pub(crate) async fn connect(
    env: &Env,
    preparation: RegistrationPreparation,
) -> worker::Result<PreparedConnection> {
    let mut request = Request::new(
        &format!("https://deriver-b.router-ab.internal{SOCKET_PATH}"),
        Method::Get,
    )?;
    let headers = request.headers_mut()?;
    headers.set("Upgrade", "websocket")?;
    headers.set(
        PREPARATION_HEADER,
        &serde_json::to_string(&preparation).map_err(error)?,
    )?;
    crate::set_cloudflare_internal_service_auth_header_v1(
        env,
        headers,
        "Registration peer connection",
    )
    .map_err(error)?;
    let service = env.service(crate::DERIVER_B_BINDING)?;
    let remaining = preparation
        .custody_binding
        .expires_at_ms
        .saturating_sub(worker::Date::now().as_millis());
    let timeout = worker::Delay::from(std::time::Duration::from_millis(remaining));
    let response = match select(Box::pin(service.fetch_request(request)), Box::pin(timeout)).await {
        Either::Left((response, _)) => response?,
        Either::Right(_) => return Err(error("Registration peer connection expired")),
    };
    if response.status_code() != 101 {
        return Err(error("Registration peer connection was refused"));
    }
    let socket = response
        .websocket()
        .ok_or_else(|| error("Registration peer socket is missing"))?;
    // A accepts the socket when execute installs the input-bound transport.
    Ok(PreparedConnection {
        preparation,
        connection: CloudflareEd25519YaoPairStartConnectionV1 { socket },
    })
}

pub(crate) async fn read_control<T: serde::de::DeserializeOwned>(
    events: &mut EventStream<'_>,
    deadline_ms: u64,
) -> worker::Result<T> {
    let timeout = worker::Delay::from(std::time::Duration::from_millis(
        deadline_ms.saturating_sub(worker::Date::now().as_millis()),
    ));
    let event = match select(Box::pin(events.next()), Box::pin(timeout)).await {
        Either::Left((Some(Ok(WebsocketEvent::Message(message))), _)) => message,
        _ => {
            return Err(error(
                "Registration peer startup ended before a control message",
            ))
        }
    };
    let text = event
        .text()
        .filter(|text| text.len() <= 16384)
        .ok_or_else(|| error("Registration peer control message is invalid"))?;
    serde_json::from_str(&text).map_err(error)
}

fn error(value: impl std::fmt::Display) -> worker::Error {
    worker::Error::RustError(value.to_string())
}

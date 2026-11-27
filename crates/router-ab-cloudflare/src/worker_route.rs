//! The checks that open a Worker or Durable Object route (its method, its
//! path and its JSON body) and the response that closes it. A check that
//! fails gives, as its `Err`, the response that the route sends, so each
//! route keeps its own refusal texts and status codes. A route matches
//! `Err(response) => return response`.

use serde::{de::DeserializeOwned, Serialize};
use worker::{Method, Request, Response};

use crate::durable_object::tenant_root_creation::decode_bounded_json_request;
use crate::RouterAbProtocolResult;

/// The response that a route sends for a request that it refuses.
pub(crate) type RouteRefusalV1 = worker::Result<Response>;

/// Refuses every method except POST with 405 and `refusal`.
pub(crate) fn require_post_v1(request: &Request, refusal: &str) -> Result<(), RouteRefusalV1> {
    if request.method() != Method::Post {
        return Err(Response::error(refusal, 405));
    }
    Ok(())
}

/// Reads a JSON body of at most `max_bytes`. A body that does not decode is
/// refused with its protocol error.
pub(crate) async fn read_json_v1<T: DeserializeOwned>(
    request: &mut Request,
    max_bytes: usize,
) -> Result<T, RouteRefusalV1> {
    decode_bounded_json_request(request, max_bytes)
        .await
        .map_err(|error| crate::cloudflare_protocol_error_response_v1(&error))
}

/// [`require_post_v1`], then [`read_json_v1`].
pub(crate) async fn read_post_json_v1<T: DeserializeOwned>(
    request: &mut Request,
    method_refusal: &str,
    max_bytes: usize,
) -> Result<T, RouteRefusalV1> {
    require_post_v1(request, method_refusal)?;
    read_json_v1(request, max_bytes).await
}

/// The 400 response for a body that `Request::json` cannot parse.
#[derive(Clone, Copy)]
pub(crate) enum BodyRefusalV1 {
    /// "{subject} JSON parse failed: {error}".
    ParseFailed(&'static str),
    /// The text as given.
    Text(&'static str),
}

/// Parses the JSON body. A body that does not parse is refused with 400.
pub(crate) async fn parse_json_v1<T: DeserializeOwned>(
    request: &mut Request,
    refusal: BodyRefusalV1,
) -> Result<T, RouteRefusalV1> {
    request.json::<T>().await.map_err(|error| match refusal {
        BodyRefusalV1::ParseFailed(subject) => {
            Response::error(format!("{subject} JSON parse failed: {error}"), 400)
        }
        BodyRefusalV1::Text(text) => Response::error(text, 400),
    })
}

/// The 404 response for a request to another path.
#[derive(Clone, Copy)]
pub(crate) enum PathRefusalV1 {
    /// "{subject} must be served at {path}".
    ServedAt(&'static str),
    /// The text as given. Only SigningWorker private routes use it.
    #[cfg_attr(
        not(feature = "strict-worker-signing-worker-entrypoint"),
        allow(dead_code)
    )]
    Text(&'static str),
}

/// A POST route that serves one path, with the texts of its refusals.
pub(crate) struct PostRouteV1 {
    pub(crate) path: &'static str,
    /// The 405 text for another method.
    pub(crate) method_refusal: &'static str,
    pub(crate) path_refusal: PathRefusalV1,
    pub(crate) body_refusal: BodyRefusalV1,
}

impl PostRouteV1 {
    /// Refuses another method with 405, then another path with 404.
    pub(crate) fn require(&self, request: &Request) -> Result<(), RouteRefusalV1> {
        require_post_v1(request, self.method_refusal)?;
        if request.path() != self.path {
            return Err(match self.path_refusal {
                PathRefusalV1::ServedAt(subject) => {
                    Response::error(format!("{subject} must be served at {}", self.path), 404)
                }
                PathRefusalV1::Text(text) => Response::error(text, 404),
            });
        }
        Ok(())
    }

    /// Parses the JSON body, refused with the route's 400 text.
    pub(crate) async fn parse<T: DeserializeOwned>(
        &self,
        request: &mut Request,
    ) -> Result<T, RouteRefusalV1> {
        parse_json_v1(request, self.body_refusal).await
    }

    /// [`Self::require`], then [`Self::parse`].
    pub(crate) async fn read<T: DeserializeOwned>(
        &self,
        request: &mut Request,
    ) -> Result<T, RouteRefusalV1> {
        self.require(request)?;
        self.parse(request).await
    }
}

/// The JSON of a handler's value, or the response for its protocol error.
pub(crate) fn protocol_json_response_v1<T: Serialize>(
    result: RouterAbProtocolResult<T>,
) -> worker::Result<Response> {
    match result {
        Ok(value) => Response::from_json(&value),
        Err(error) => crate::cloudflare_protocol_error_response_v1(&error),
    }
}

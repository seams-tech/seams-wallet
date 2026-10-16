use router_ab_dev::LocalLoopbackOriginV1;
use serde::Serialize;
use std::net::TcpListener;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LocalWorkerUrls {
    pub router: String,
    pub deriver_a: String,
    pub deriver_b: String,
    pub signing_worker: String,
    pub control_plane: String,
}

pub fn free_loopback_origin() -> Result<LocalLoopbackOriginV1, Box<dyn std::error::Error>> {
    let port = TcpListener::bind("127.0.0.1:0")?.local_addr()?.port();
    Ok(LocalLoopbackOriginV1::on_port(port))
}

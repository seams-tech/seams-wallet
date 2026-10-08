//! Keep the authenticated wallet object alive through preparation and execution.
use super::*;
use crate::ed25519_yao_ceremony_connection as connection;
use worker::{Headers, WebSocket, WebSocketPair};

impl RouterAbDeriverAWalletDurableObject {
    pub(crate) async fn forward_ceremony_connection(
        request: Request,
        env: &Env,
    ) -> worker::Result<Response> {
        connection::require_upgrade(&request)?;
        let work: CloudflareEd25519YaoPairPrepareRequestV1 =
            connection::read_header(request.headers(), connection::PREPARATION_HEADER)?;
        // Placement occurs only after the activation receipt authenticates this exact home.
        let owner =
            DeriverAWalletOwnerV1::from_context(env, &work.tenant_root, &work.pair_binding)?;
        let namespace = env.durable_object(PAIR_DO_BINDING)?;
        let physical_name = relocation::WalletOwner::physical_object_name(
            &owner,
            work.tenant_root.ownership_generation,
        )?;
        let stub =
            work.tenant_root
                .wallet_home
                .wallet_stub(&namespace, &physical_name, "deriver_a")?;
        stub.fetch_with_request(request).await
    }

    pub(super) async fn open_ceremony_connection(
        &self,
        request: Request,
    ) -> worker::Result<Response> {
        connection::require_upgrade(&request)?;
        let work: CloudflareEd25519YaoPairPrepareRequestV1 =
            connection::read_header(request.headers(), connection::PREPARATION_HEADER)?;
        let receipt = self.prepare_work(work.clone()).await?;
        let headers = Headers::new();
        connection::write_header(&headers, connection::READINESS_HEADER, &receipt)?;
        let pair = WebSocketPair::new()?;
        let object = self.clone();
        self.state.wait_until(async move {
            let socket = pair.server;
            if let Err(error) = object.complete_ceremony_connection(&socket, work).await {
                let message = error.to_string();
                let protocol_error = router_ab_core::RouterAbProtocolError::new(
                    crate::router_ab_peer_error_code_v1(&message),
                    message,
                );
                let failure = crate::CloudflareEd25519YaoRoleFailureResponseV1::from_protocol_error(
                    &protocol_error,
                );
                let _ = connection::send(&socket, &connection::Outcome::Failed { failure });
            }
            let _ = socket.close(Some(1000), Some("Ceremony connection finished"));
        });
        Response::from_websocket(pair.client).map(|response| response.with_headers(headers))
    }

    async fn complete_ceremony_connection(
        &self,
        socket: &WebSocket,
        work: CloudflareEd25519YaoPairPrepareRequestV1,
    ) -> worker::Result<()> {
        let mut events = socket.events()?;
        socket.accept()?;
        let start: connection::Start = connection::receive(&mut events).await?;
        // The object may have been fenced while its caller waited for B's receipt.
        relocation::require_open::<DeriverAWalletOwnerV1>(&self.sql)?;
        let execution = self
            .execute_work(CloudflareEd25519YaoPairExecuteRequestV1 {
                pair_binding: work.pair_binding,
                tenant_root: work.tenant_root,
                work: work.work,
                input: work.input,
                local_receipt: start.local_receipt,
                peer_receipt: start.peer_receipt,
            })
            .await?;
        // execute_work commits before returning. A lost connection can replay that outcome.
        connection::send(socket, &connection::Outcome::Completed { execution })
    }
}

use super::*;

impl RouterAbSigningWorkerWalletDurableObject {
    pub(super) async fn fetch_wallet_request(
        &self,
        mut request: Request,
    ) -> worker::Result<Response> {
        if request.path() == crate::CLOUDFLARE_SIGNING_WORKER_ED25519_YAO_PACKAGES_PATH {
            return self.receive_package_delivery(request).await;
        }

        if request.method() == worker::Method::Post
            && request.path() == super::super::wallet_startup::PATH
        {
            self.initialize_schema()?;
            return Response::from_json(&true);
        }
        #[cfg(debug_assertions)]
        if request.method() == worker::Method::Post && request.path() == HARNESS_FAULT_PATH {
            return self.record_harness_activation_fault(request.json().await?);
        }
        if request.method() != worker::Method::Post || request.path() != PATH {
            return Response::error("Unknown SigningWorker wallet object request", 404);
        }
        let command: SigningWorkerWalletDoRequestV1 = request.json().await?;
        if let Err(error) = command.validate() {
            return Response::error(error.message(), 400);
        }
        self.initialize_schema()?;
        match self.execute(command).await {
            Ok(response) => Ok(response),
            Err(error) => Response::error(
                format!("{:?}: {}", error.code(), error.message()),
                crate::cloudflare_router_error_status(error.code()),
            ),
        }
    }

    pub(super) fn initialize_schema(&self) -> worker::Result<()> {
        self.sql
            .exec(crate::SIGNING_WORKER_WALLET_OWNER_SCHEMA_V1, None)?;
        self.sql.exec(REGISTRATION_SCHEMA, None)?;
        self.sql.exec(RETIRED_ACTIVATION_SCHEMA, None)?;
        self.sql.exec(LINKED_ED25519_SCHEMA, None)?;
        self.sql.exec(ROUND1_SCHEMA, None)?;
        self.sql
            .exec(crate::SIGNING_WORKER_ED25519_EXECUTION_SCHEMA_V1, None)?;
        self.sql
            .exec(crate::SIGNING_WORKER_ED25519_FENCE_SCHEMA_V1, None)?;
        self.sql
            .exec(crate::SIGNING_WORKER_ED25519_SETTLEMENT_SCHEMA_V1, None)?;
        self.sql.exec(ed25519_snapshot::STATE_SCHEMA, None)?;
        self.sql.exec(ed25519_snapshot::SEGMENT_SCHEMA, None)?;
        self.sql.exec(ed25519_snapshot::IMPORT_SCHEMA, None)?;
        self.sql
            .exec(ed25519_snapshot::IMPORT_SEGMENT_SCHEMA, None)?;
        for schema in crate::SIGNING_WORKER_WALLET_ECDSA_SCHEMA_V1 {
            self.sql.exec(schema, None)?;
        }
        Ok(())
    }
}

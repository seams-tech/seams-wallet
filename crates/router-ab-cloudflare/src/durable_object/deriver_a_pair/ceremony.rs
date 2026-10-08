use super::{
    pair_error, DeriverAWalletOwnerV1, PairRecord, RolePairCipherV1,
    RouterAbDeriverAWalletDurableObject,
};
use crate::{
    CloudflareEd25519YaoPairCeremonyRequestV1, CloudflareEd25519YaoPairExecuteRequestV1,
    CloudflareEd25519YaoPairPrepareRequestV1, CloudflareEd25519YaoPairWorkV1,
    CLOUDFLARE_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH,
};
use router_ab_core::Ed25519YaoRoleReadinessReceiptV1;
use worker::Response;

impl RouterAbDeriverAWalletDurableObject {
    pub(super) async fn execute_ceremony(
        &self,
        request: CloudflareEd25519YaoPairCeremonyRequestV1,
    ) -> worker::Result<Response> {
        let (local, peer) = request.into_preparations().map_err(pair_error)?;
        if !matches!(local.work, CloudflareEd25519YaoPairWorkV1::Ceremony) {
            return Err(pair_error(
                "Deriver A wallet DO lane execution is unavailable",
            ));
        }
        if let Some(response) = self.replay_ceremony(&local)? {
            return Ok(response);
        }

        // Await both preparations even when one fails. Neither readiness receipt
        // permits protocol output until execute_work verifies both signatures.
        let (local_result, peer_result) = futures::join!(
            self.prepare_work(local.clone()),
            crate::router_coordinator::post_role_request(
                &self.env,
                "DERIVER_B",
                "https://router-ab-deriver-b.internal",
                CLOUDFLARE_DERIVER_B_ED25519_YAO_PREPARE_PAIR_PATH,
                "Deriver B pair preparation",
                &peer,
                None,
            ),
        );
        let local_receipt = local_result?;
        let mut peer_response = peer_result.map_err(pair_error)?;
        if !(200..300).contains(&peer_response.status_code()) {
            return Ok(peer_response);
        }
        let peer_receipt: Ed25519YaoRoleReadinessReceiptV1 = peer_response.json().await?;
        let outcome = self
            .execute_work(CloudflareEd25519YaoPairExecuteRequestV1 {
                pair_binding: local.pair_binding,
                tenant_root: local.tenant_root,
                work: local.work,
                input: local.input,
                local_receipt,
                peer_receipt,
            })
            .await?;
        Response::from_json(&outcome)
    }

    fn replay_ceremony(
        &self,
        request: &CloudflareEd25519YaoPairPrepareRequestV1,
    ) -> worker::Result<Option<Response>> {
        let owner = DeriverAWalletOwnerV1::from_context(
            &self.env,
            &request.tenant_root,
            &request.pair_binding,
        )?;
        let cipher = RolePairCipherV1::from_env_for_wallet_do(&self.env)?;
        let selected = self.read_scoped(
            &owner,
            &cipher,
            &request.pair_binding,
            &request.tenant_root.identity,
        )?;
        let Some(selected) = selected else {
            return Ok(None);
        };
        self.check_owner(&owner, false)?;
        match selected.record {
            PairRecord::Completed {
                payload, outcome, ..
            } if payload.tenant_root == request.tenant_root
                && payload.work == request.work
                && payload.input == request.input =>
            {
                Response::from_json(&outcome).map(Some)
            }
            PairRecord::Prepared {
                payload,
                expires_at_ms,
                ..
            } if payload.tenant_root == request.tenant_root
                && payload.work == request.work
                && payload.input == request.input
                && crate::cloudflare_now_unix_ms_v1().map_err(pair_error)? < expires_at_ms =>
            {
                Ok(None)
            }
            _ => Err(pair_error("Deriver A pair is conflicting or unavailable")),
        }
    }
}

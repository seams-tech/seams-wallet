use super::*;

impl RouterAbSigningWorkerWalletDurableObject {
    /// Reserves a linked device's Ed25519 material from this wallet's source
    /// activation, which must be the wallet's active registration material
    /// or an active linked device's. This object is the one the request's
    /// wallet scope names, so the source activation it finds is that
    /// wallet's. The same request answers again.
    pub(super) fn reserve_linked_ed25519(
        &self,
        request: CloudflareEd25519YaoSourcePreservingInactiveReservationRequestV1,
    ) -> Result<Response, RouterAbProtocolError> {
        let delivery = &request.delivery;
        let record_key = reservation_record_key_from_binding_v1(&delivery.deriver_a.binding)?;
        let reservation_id =
            source_preserving_reservation_id_v1(&request.source_binding, delivery)?;
        let stored = self.read_linked_ed25519(&request.scope, &record_key)?;
        if let LinkedEd25519ReservationV1::Answer(answer) = settle_linked_ed25519_reservation_v1(
            stored.as_ref().map(|stored| &stored.state),
            &reservation_id,
            delivery,
            request.participant_ids,
            &request.deriver_a_client_package,
            &request.deriver_b_client_package,
        )? {
            return Response::from_json(&answer).map_err(sql_error);
        }
        self.require_ed25519_unfenced(&request.scope)?;
        let source =
            self.linked_ed25519_source_material(&request.scope, &request.source_binding)?;
        let (candidate, receipt) = combine_signing_worker_yao_packages_v1(
            &self.env,
            &CloudflareSigningWorkerRuntimeV1::from_worker_env(&self.env)?,
            delivery,
            Some(&source),
        )?
        .into_parts();
        let state = SigningWorkerYaoReservationStateV1::Inactive {
            delivery: delivery.clone(),
            participant_ids: request.participant_ids,
            deriver_a_client_package: request.deriver_a_client_package.clone(),
            deriver_b_client_package: request.deriver_b_client_package.clone(),
            candidate,
            receipt: receipt.clone(),
            reservation_id: reservation_id.clone(),
        };
        state.validate()?;
        let owner_json = serde_json::to_string(&request.scope).map_err(|error| {
            wallet_error(format!("SigningWorker wallet owner is invalid: {error}"))
        })?;
        let ciphertext = self.seal_linked_ed25519(
            &request.scope,
            &record_key,
            &WalletLinkedEd25519V1 {
                state,
                activation: None,
            },
        )?;
        let inserted = self.sql.exec(
            "INSERT INTO wallet_linked_ed25519 (record_key, active_key, owner_json, ciphertext_json)
             VALUES (?, NULL, ?, ?) ON CONFLICT DO NOTHING RETURNING record_key AS registration_key",
            vec![
                SqlStorageValue::String(record_key.clone()),
                SqlStorageValue::String(owner_json),
                SqlStorageValue::String(ciphertext),
            ],
        ).map_err(sql_error)?.to_array::<InsertedRowV1>().map_err(sql_error)?;
        if inserted.len() != 1 {
            return Err(wallet_error(
                "SigningWorker linked Ed25519 reservation write is uncertain",
            ));
        }
        Response::from_json(&CloudflareEd25519YaoInactiveReservationResponseV1 {
            state: "inactive".to_owned(),
            reservation_id,
            participant_ids: request.participant_ids,
            activation_receipt: public_activation_receipt_v1(
                &delivery.deriver_a.binding,
                &receipt,
            )?,
            deriver_a_client_package: request.deriver_a_client_package,
            deriver_b_client_package: request.deriver_b_client_package,
        })
        .map_err(sql_error)
    }

    /// Activates a linked device's reserved Ed25519 material. In one write
    /// its row becomes active and names the activation normal signing finds.
    /// A retired activation never activates, and an active one answers again.
    pub(super) fn activate_linked_ed25519(
        &self,
        request: CloudflareEd25519YaoActivateReservationRequestV1,
    ) -> Result<Response, RouterAbProtocolError> {
        let record_key = reservation_record_key_from_binding_v1(&request.binding)?;
        let stored = self
            .read_linked_ed25519(&request.scope, &record_key)?
            .ok_or_else(|| lifecycle_error("ordinary Ed25519 material reservation is missing"))?;
        let receipt = match settle_linked_ed25519_activation_v1(&stored.state, &request)? {
            LinkedEd25519ActivationV1::Answer(receipt) => receipt,
            LinkedEd25519ActivationV1::Activate => {
                self.require_ed25519_unfenced(&request.scope)?;
                let SigningWorkerYaoReservationStateV1::Inactive {
                    delivery,
                    participant_ids,
                    deriver_a_client_package,
                    deriver_b_client_package,
                    candidate,
                    receipt,
                    reservation_id,
                } = stored.state
                else {
                    return Err(wallet_error(
                        "SigningWorker linked Ed25519 reservation is in a state this object never writes",
                    ));
                };
                let runtime = CloudflareSigningWorkerRuntimeV1::from_worker_env(&self.env)?;
                let activation = build_output_activation_record(&runtime, &candidate, &receipt)?;
                let next_active_key = active_key(activation.active_signing_worker_state());
                if self.activation_retired(&next_active_key)? {
                    return Err(signing_worker_activation_retired_error_v1());
                }
                let next = WalletLinkedEd25519V1 {
                    state: SigningWorkerYaoReservationStateV1::Active {
                        delivery,
                        participant_ids,
                        deriver_a_client_package,
                        deriver_b_client_package,
                        candidate,
                        receipt: receipt.clone(),
                        reservation_id,
                    },
                    activation: Some(activation),
                };
                let ciphertext = self.seal_linked_ed25519(&request.scope, &record_key, &next)?;
                let updated = self.sql.exec(
                    "UPDATE wallet_linked_ed25519 SET active_key = ?, ciphertext_json = ?
                     WHERE record_key = ? AND active_key IS NULL RETURNING record_key AS registration_key",
                    vec![
                        SqlStorageValue::String(next_active_key),
                        SqlStorageValue::String(ciphertext),
                        SqlStorageValue::String(record_key),
                    ],
                ).map_err(sql_error)?.to_array::<InsertedRowV1>().map_err(sql_error)?;
                if updated.len() != 1 {
                    return Err(wallet_error(
                        "SigningWorker linked Ed25519 reservation changed while it was activated",
                    ));
                }
                receipt
            }
        };
        Response::from_json(&CloudflareEd25519YaoReservationActivationResponseV1 { receipt })
            .map_err(sql_error)
    }

    /// Revokes a linked device's Ed25519 material. In one write its row is
    /// revoked, its activation dropped and its key retired, so no delayed
    /// request signs with it again. The same revocation answers again.
    pub(super) fn deactivate_linked_ed25519(
        &self,
        request: CloudflareEd25519YaoDeactivateReservationRequestV1,
    ) -> Result<Response, RouterAbProtocolError> {
        let record_key =
            reservation_record_key_from_material_activation_v1(&request.material_activation)?;
        let stored = self
            .read_linked_ed25519(&request.scope, &record_key)?
            .ok_or_else(|| lifecycle_error("ordinary Ed25519 material reservation is missing"))?;
        let (binding, reservation_id, revoked_at_ms, revoke) =
            match settle_linked_ed25519_deactivation_v1(
                &stored.state,
                &request.material_activation,
            )? {
                LinkedEd25519DeactivationV1::Revoked {
                    binding,
                    reservation_id,
                    revoked_at_ms,
                } => (binding, reservation_id, revoked_at_ms, false),
                LinkedEd25519DeactivationV1::Resume {
                    binding,
                    reservation_id,
                    revoked_at_ms,
                } => (binding, reservation_id, revoked_at_ms, true),
                LinkedEd25519DeactivationV1::Revoke {
                    binding,
                    reservation_id,
                } => (
                    binding,
                    reservation_id,
                    crate::cloudflare_now_unix_ms_v1()?,
                    true,
                ),
            };
        if revoke {
            self.require_ed25519_unfenced(&request.scope)?;
            let next = WalletLinkedEd25519V1 {
                state: SigningWorkerYaoReservationStateV1::Revoked {
                    binding: binding.clone(),
                    reservation_id: reservation_id.clone(),
                    revoked_at_ms,
                },
                activation: None,
            };
            let ciphertext = self.seal_linked_ed25519(&request.scope, &record_key, &next)?;
            self.sql.exec(
                "UPDATE wallet_linked_ed25519 SET active_key = NULL, ciphertext_json = ? WHERE record_key = ?",
                vec![
                    SqlStorageValue::String(ciphertext),
                    SqlStorageValue::String(record_key.clone()),
                ],
            ).map_err(sql_error)?;
            self.sql
                .exec(
                    "INSERT INTO wallet_retired_activations (active_key, registration_key)
                 VALUES (?, ?) ON CONFLICT DO NOTHING",
                    vec![
                        SqlStorageValue::String(active_output_key_v1(&request.material_activation)),
                        SqlStorageValue::String(record_key),
                    ],
                )
                .map_err(sql_error)?;
        }
        Response::from_json(&CloudflareEd25519YaoReservationDeactivationResponseV1 {
            state: "revoked",
            reservation_id,
            material_activation: binding.material_activation,
            revoked_at_ms,
        })
        .map_err(sql_error)
    }
}

use super::*;

impl DeriverBYaoSessionD1V1 {
    pub(super) async fn handle_pair_command(
        &self,
        command: DeriverBYaoSessionCommandV1,
    ) -> worker::Result<Response> {
        match command {
            DeriverBYaoSessionCommandV1::PreparePair {
                pair_binding,
                tenant_root,
                work,
                input,
            } => {
                self.handle_prepare_pair(*pair_binding, *tenant_root, work, *input)
                    .await
            }
            DeriverBYaoSessionCommandV1::BeginPair {
                session,
                pair_digest,
                execution_id,
                outer_binding,
            } => {
                self.handle_begin_pair(session, pair_digest, execution_id, *outer_binding)
                    .await
            }
            DeriverBYaoSessionCommandV1::CompletePair {
                pair_digest,
                execution,
            } => self.handle_complete_pair(pair_digest, *execution).await,
            DeriverBYaoSessionCommandV1::FailPair { pair_binding } => {
                self.handle_fail_pair(*pair_binding).await
            }
            DeriverBYaoSessionCommandV1::ReadPairStatus {
                session,
                pair_digest,
            } => self.handle_read_pair_status(session, pair_digest).await,
        }
    }

    async fn handle_prepare_pair(
        &self,
        pair_binding: Ed25519YaoInputPairBindingV1,
        tenant_root: crate::CloudflareEd25519YaoTenantRootContextV2,
        work: crate::CloudflareEd25519YaoPairWorkV1,
        input: Ed25519YaoEncryptedInputV1,
    ) -> worker::Result<Response> {
        let request = CloudflareEd25519YaoPairPrepareRequestV1 {
            pair_binding,
            tenant_root,
            work,
            input,
        };
        let expected_kind = input_kind_for_circuit(request.pair_binding.binding().circuit_family());
        let (pair_digest, input_digest) = request
            .validate_for_role(Ed25519YaoDeriverRoleV1::DeriverB, expected_kind)
            .map_err(|error| worker::Error::RustError(error.message().to_owned()))?;
        let session = request.input.session();
        if let Some(answer) = self
            .stored_preparation_answer(&request, pair_digest, input_digest)
            .await?
        {
            return Response::from_json(&answer);
        }
        let (_, role_share, _, root_metadata_digest) = self
            .load_role_share_for_preparation(&request)
            .await?
            .map_err(|error| worker::Error::RustError(error.to_string()))?;
        drop(role_share);
        // The root read yielded. Another request may have prepared, claimed
        // or burned this pair meanwhile: answer from what is stored now.
        if let Some(answer) = self
            .stored_preparation_answer(&request, pair_digest, input_digest)
            .await?
        {
            return Response::from_json(&answer);
        }
        let storage = self.storage(session)?;
        storage.bind_creation_scope(
            &request.pair_binding.binding().lifecycle.signer_set_id,
            request
                .pair_binding
                .binding()
                .lifecycle
                .root_share_epoch
                .as_str(),
            root_metadata_digest,
        )?;
        let prepared_at_ms = cloudflare_yao_now_unix_ms()?;
        let expires_at_ms = yao_expiry_from_now(prepared_at_ms, YAO_PREPARED_INPUT_LIFETIME_MS)?;
        let prepared_record = PairYaoSessionRecordV1::Prepared {
            pair_digest,
            input_digest,
            root_metadata_digest,
            expires_at_ms,
            pair_binding: Box::new(request.pair_binding),
            tenant_root: Box::new(request.tenant_root),
            input: Box::new(request.input),
            work: request.work,
        };
        storage
            .transaction(move |transaction| async move {
                match transaction
                    .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
                    .await
                {
                    // An earlier Router run's preparation, which no
                    // connection claimed, gives way to this run's.
                    Ok(PairYaoSessionRecordV1::Prepared {
                        pair_digest: stored_pair,
                        input_digest: stored_input,
                        ..
                    }) if stored_pair == pair_digest && stored_input == input_digest => {}
                    Err(worker::Error::JsError(message))
                        if message == "No such value in storage." => {}
                    Ok(_) => {
                        return Err(worker::Error::RustError(
                            "Deriver B pair changed while preparing".into(),
                        ))
                    }
                    Err(error) => return Err(error),
                }
                transaction
                    .put(PAIR_SESSION_RECORD_STORAGE_KEY, prepared_record)
                    .await
            })
            .await?;
        Response::from_json(&DeriverBYaoSessionResponseV1::PairPrepared {
            session,
            pair_digest,
        })
    }

    /// Answers a preparation from the record the session already holds, or
    /// `None` when this request must prepare: no record yet, or only an
    /// earlier Router run's preparation.
    ///
    /// A Router run stamps a new window into the tenant-root context it sends
    /// both roles. A preparation stored for an earlier run cannot serve this
    /// one, and nothing has claimed it, so this run's replaces it.
    async fn stored_preparation_answer(
        &self,
        request: &CloudflareEd25519YaoPairPrepareRequestV1,
        pair_digest: [u8; 32],
        input_digest: [u8; 32],
    ) -> worker::Result<Option<DeriverBYaoSessionResponseV1>> {
        let session = request.input.session();
        let storage = self.storage(session)?;
        let Some(existing) = storage
            .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
            .await?
        else {
            return Ok(None);
        };
        if existing.pair_digest() != pair_digest || existing.input_digest() != input_digest {
            return Ok(Some(DeriverBYaoSessionResponseV1::PairConflict {
                session,
                pair_digest,
            }));
        }
        Ok(Some(match existing {
            PairYaoSessionRecordV1::Prepared {
                expires_at_ms,
                pair_binding,
                tenant_root,
                work,
                ..
            } => {
                if *pair_binding != request.pair_binding || work != request.work {
                    DeriverBYaoSessionResponseV1::PairConflict {
                        session,
                        pair_digest,
                    }
                } else if *tenant_root != request.tenant_root {
                    return Ok(None);
                } else {
                    let now_ms = cloudflare_yao_now_unix_ms()?;
                    if now_ms < expires_at_ms {
                        DeriverBYaoSessionResponseV1::PairPrepared {
                            session,
                            pair_digest,
                        }
                    } else if expire_prepared_pair_if_current(
                        &storage,
                        pair_digest,
                        input_digest,
                        now_ms,
                    )
                    .await?
                    {
                        DeriverBYaoSessionResponseV1::PairExpired {
                            session,
                            pair_digest,
                        }
                    } else {
                        return Err(worker::Error::RustError(
                            "Deriver B pair expiry state changed".into(),
                        ));
                    }
                }
            }
            PairYaoSessionRecordV1::Running { .. } => DeriverBYaoSessionResponseV1::PairRunning {
                session,
                pair_digest,
            },
            PairYaoSessionRecordV1::Completed { .. } => {
                DeriverBYaoSessionResponseV1::PairCompleted {
                    session,
                    pair_digest,
                }
            }
            PairYaoSessionRecordV1::Burned { .. } => DeriverBYaoSessionResponseV1::PairBurned {
                session,
                pair_digest,
            },
            PairYaoSessionRecordV1::Expired { .. } => DeriverBYaoSessionResponseV1::PairExpired {
                session,
                pair_digest,
            },
        }))
    }

    async fn handle_complete_pair(
        &self,
        pair_digest: [u8; 32],
        execution: Ed25519YaoRoleExecutionV1,
    ) -> worker::Result<Response> {
        let session = execution.session();
        let storage = self.storage(session)?;
        let record = storage
            .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
            .await?
            .ok_or_else(|| worker::Error::RustError("Deriver B pair is missing".into()))?;
        let expected_execution = execution.clone();
        match record {
            PairYaoSessionRecordV1::Running {
                pair_digest: stored_pair,
                input_digest,
                input,
                ..
            } if stored_pair == pair_digest && input.session() == session => {
                storage
                    .transaction(move |transaction| async move {
                        let current = match transaction
                            .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
                            .await
                        {
                            Ok(record) => record,
                            Err(worker::Error::JsError(message))
                                if message == "No such value in storage." =>
                            {
                                return Ok(())
                            }
                            Err(error) => return Err(error),
                        };
                        let now_unix_ms = cloudflare_yao_now_unix_ms()?;
                        if let Some(next) = completed_pair_record_if_running(
                            &current,
                            pair_digest,
                            input_digest,
                            &execution,
                            now_unix_ms,
                        ) {
                            transaction
                                .put(PAIR_SESSION_RECORD_STORAGE_KEY, next)
                                .await?;
                        }
                        Ok(())
                    })
                    .await?;
                let current = storage
                    .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
                    .await?;
                match current {
                    Some(PairYaoSessionRecordV1::Completed {
                        pair_digest: stored_pair,
                        execution: existing,
                        ..
                    }) if stored_pair == pair_digest
                        && existing.session() == session
                        && *existing == expected_execution =>
                    {
                        Response::from_json(&DeriverBYaoSessionResponseV1::PairCompleted {
                            session,
                            pair_digest,
                        })
                    }
                    Some(PairYaoSessionRecordV1::Burned {
                        pair_digest: stored_pair,
                        ..
                    }) if stored_pair == pair_digest => {
                        Response::from_json(&DeriverBYaoSessionResponseV1::PairBurned {
                            session,
                            pair_digest,
                        })
                    }
                    Some(PairYaoSessionRecordV1::Completed { .. }) => {
                        Response::error("conflicting Deriver B execution", 409)
                    }
                    _ => Response::error("Deriver B pair completion is invalid", 409),
                }
            }
            PairYaoSessionRecordV1::Completed {
                pair_digest: stored_pair,
                execution: existing,
                ..
            } if stored_pair == pair_digest && *existing == expected_execution => {
                Response::from_json(&DeriverBYaoSessionResponseV1::PairCompleted {
                    session,
                    pair_digest,
                })
            }
            PairYaoSessionRecordV1::Burned {
                pair_digest: stored_pair,
                ..
            } if stored_pair == pair_digest => {
                Response::from_json(&DeriverBYaoSessionResponseV1::PairBurned {
                    session,
                    pair_digest,
                })
            }
            _ => Response::error("Deriver B pair completion is invalid", 409),
        }
    }

    async fn handle_fail_pair(
        &self,
        pair_binding: Ed25519YaoInputPairBindingV1,
    ) -> worker::Result<Response> {
        let session = pair_binding.session();
        let pair_digest = pair_binding.pair_digest().bytes;
        let storage = self.storage(session)?;
        let Some(record) = storage
            .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
            .await?
        else {
            return self.burn_unprepared_pair(&storage, &pair_binding).await;
        };
        let response = match record {
            PairYaoSessionRecordV1::Running {
                pair_digest: stored_pair,
                input_digest,
                input,
                ..
            } if stored_pair == pair_digest && input.session() == session => {
                storage
                    .transaction(move |transaction| async move {
                        let current = match transaction
                            .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
                            .await
                        {
                            Ok(record) => record,
                            Err(worker::Error::JsError(message))
                                if message == "No such value in storage." =>
                            {
                                return Ok(())
                            }
                            Err(error) => return Err(error),
                        };
                        if let PairYaoSessionRecordV1::Running {
                            pair_digest: current_pair,
                            input: current_input,
                            execution_id,
                            ..
                        } = current
                        {
                            if current_pair == pair_digest && current_input.session() == session {
                                transaction
                                    .put(
                                        PAIR_SESSION_RECORD_STORAGE_KEY,
                                        PairYaoSessionRecordV1::Burned {
                                            pair_digest,
                                            input_digest,
                                            execution_id,
                                        },
                                    )
                                    .await?;
                            }
                        }
                        Ok(())
                    })
                    .await?;
                let current = storage
                    .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
                    .await?;
                match current {
                    Some(PairYaoSessionRecordV1::Burned {
                        pair_digest: current_pair,
                        ..
                    }) if current_pair == pair_digest => DeriverBYaoSessionResponseV1::PairBurned {
                        session,
                        pair_digest,
                    },
                    Some(PairYaoSessionRecordV1::Completed {
                        pair_digest: current_pair,
                        execution,
                        ..
                    }) if current_pair == pair_digest && execution.session() == session => {
                        DeriverBYaoSessionResponseV1::PairCompleted {
                            session,
                            pair_digest,
                        }
                    }
                    _ => return Response::error("Deriver B pair failure state changed", 409),
                }
            }
            PairYaoSessionRecordV1::Burned {
                pair_digest: stored_pair,
                ..
            } if stored_pair == pair_digest => DeriverBYaoSessionResponseV1::PairBurned {
                session,
                pair_digest,
            },
            PairYaoSessionRecordV1::Completed {
                pair_digest: stored_pair,
                execution,
                ..
            } if stored_pair == pair_digest && execution.session() == session => {
                DeriverBYaoSessionResponseV1::PairCompleted {
                    session,
                    pair_digest,
                }
            }
            _ => return Response::error("Deriver B pair cannot be burned", 409),
        };
        Response::from_json(&response)
    }

    /// Records a pair burned before this role prepared it. Its executor at
    /// Deriver A is gone, so a preparation that arrives afterwards is refused
    /// before it admits a root use. No root was read for the pair: the record
    /// is sealed under an all-zero root metadata digest.
    async fn burn_unprepared_pair(
        &self,
        storage: &role_d1::RolePairD1StorageV1,
        pair_binding: &Ed25519YaoInputPairBindingV1,
    ) -> worker::Result<Response> {
        let session = pair_binding.session();
        let pair_digest = pair_binding.pair_digest().bytes;
        let lifecycle = &pair_binding.binding().lifecycle;
        storage.bind_creation_scope(
            &lifecycle.signer_set_id,
            lifecycle.root_share_epoch.as_str(),
            [0_u8; 32],
        )?;
        let burned = PairYaoSessionRecordV1::Burned {
            pair_digest,
            input_digest: pair_binding.deriver_b_input_digest().bytes,
            execution_id: pair_digest,
        };
        storage
            .transaction(move |transaction| async move {
                transaction
                    .put(PAIR_SESSION_RECORD_STORAGE_KEY, burned)
                    .await
            })
            .await?;
        Response::from_json(&DeriverBYaoSessionResponseV1::PairBurned {
            session,
            pair_digest,
        })
    }

    async fn handle_read_pair_status(
        &self,
        session: [u8; 32],
        pair_digest: [u8; 32],
    ) -> worker::Result<Response> {
        let storage = self.storage(session)?;
        let Some(record) = storage
            .get::<PairYaoSessionRecordV1>(PAIR_SESSION_RECORD_STORAGE_KEY)
            .await?
        else {
            return Response::from_json(&DeriverBYaoSessionResponseV1::PairMissing {
                session,
                pair_digest,
            });
        };
        let response = match record {
            PairYaoSessionRecordV1::Prepared {
                pair_digest: stored_pair,
                input,
                expires_at_ms,
                input_digest,
                ..
            } if stored_pair == pair_digest && input.session() == session => {
                let now_ms = cloudflare_yao_now_unix_ms()?;
                if now_ms >= expires_at_ms {
                    if !expire_prepared_pair_if_current(&storage, pair_digest, input_digest, now_ms)
                        .await?
                    {
                        return Response::error("Deriver B pair expiry state changed", 409);
                    }
                    DeriverBYaoSessionResponseV1::PairExpired {
                        session,
                        pair_digest,
                    }
                } else {
                    DeriverBYaoSessionResponseV1::PairPrepared {
                        session,
                        pair_digest,
                    }
                }
            }
            PairYaoSessionRecordV1::Running {
                pair_digest: stored_pair,
                input_digest,
                execution_id,
                started_at_ms,
                input,
                ..
            } if stored_pair == pair_digest && input.session() == session => {
                if burn_running_pair_if_expired(
                    &storage,
                    pair_digest,
                    input_digest,
                    execution_id,
                    started_at_ms,
                    cloudflare_yao_now_unix_ms()?,
                )
                .await?
                {
                    DeriverBYaoSessionResponseV1::PairBurned {
                        session,
                        pair_digest,
                    }
                } else {
                    DeriverBYaoSessionResponseV1::PairRunning {
                        session,
                        pair_digest,
                    }
                }
            }
            PairYaoSessionRecordV1::Completed {
                pair_digest: stored_pair,
                execution,
                ..
            } if stored_pair == pair_digest && execution.session() == session => {
                DeriverBYaoSessionResponseV1::PairRoleExecution { execution }
            }
            PairYaoSessionRecordV1::Burned {
                pair_digest: stored_pair,
                ..
            } if stored_pair == pair_digest => DeriverBYaoSessionResponseV1::PairBurned {
                session,
                pair_digest,
            },
            PairYaoSessionRecordV1::Expired {
                pair_digest: stored_pair,
                ..
            } if stored_pair == pair_digest => DeriverBYaoSessionResponseV1::PairExpired {
                session,
                pair_digest,
            },
            _ => return Response::error("Deriver B pair identity mismatch", 409),
        };
        Response::from_json(&response)
    }
}

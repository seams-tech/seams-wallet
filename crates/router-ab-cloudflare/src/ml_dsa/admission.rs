//! One service-wide transaction admits an exact operation and charges its wallet.
use super::{policy::Policy, *};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Permit {
    pub request: SigningRequest,
    pub expires_at_ms: u64,
    pub batches: Vec<[u8; 32]>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case", deny_unknown_fields)]
pub enum Status {
    Preparing { claim: Claim },
    Running { permit: Permit },
    Succeeded { signature: Vec<u8> },
    Failed,
    Declined,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    request: SigningRequest,
    status: Status,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Slot {
    record_key: String,
    wallet: WalletScope,
    expires_at_ms: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum Decision {
    Claimed {
        claim: Claim,
    },
    Admitted {
        permit: Permit,
    },
    Existing {
        operation: Status,
    },
    Unavailable {
        reason: UnavailableReason,
        retry_at_ms: u64,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnavailableReason {
    WalletCooldown,
    ServiceCapacity,
    EmptyPool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Claim {
    pub request: SigningRequest,
    pub token: [u8; 32],
    pub expires_at_ms: u64,
}

/// Exact custody completion asserted by the authenticated Gateway boundary.
/// This records authorization; it is not a replacement for custody verification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyActivation {
    pub key: KeyScope,
    pub ceremony_id: [u8; 32],
    pub manifest_digest: [u8; 32],
}
fn activation_key(key: &KeyScope) -> Result<String> {
    Ok(format!(
        "activation/{}",
        hex(&digest(b"ml-dsa-key-slot", &(&key.wallet, &key.key_id))?)
    ))
}
pub async fn active_key(store: &impl Store, key: &KeyScope) -> Result<Option<KeyActivation>> {
    store.get(&activation_key(key)?).await
}
pub async fn authorize_key(store: &impl Store, activation: KeyActivation) -> Result<()> {
    if activation.ceremony_id == [0; 32]
        || activation.manifest_digest == [0; 32]
        || activation.key.epoch == 0
    {
        return Err(invalid(
            "ML-DSA activation requires a custody completion identity",
        ));
    }
    if let Some(current) = active_key(store, &activation.key).await? {
        if current == activation {
            return Ok(());
        }
        if activation.key.public_key_digest != current.key.public_key_digest {
            return Err(invalid(
                "ML-DSA recovery must preserve the canonical public key",
            ));
        }
        if activation.key.epoch <= current.key.epoch {
            return Err(invalid("ML-DSA activation must advance its epoch"));
        }
        let mut active = store.get::<Vec<Slot>>("active").await?.unwrap_or_default();
        let mut retained = Vec::new();
        for slot in active.drain(..) {
            let mut record = store
                .get::<Record>(&slot.record_key)
                .await?
                .ok_or_else(|| invalid("Missing ML-DSA active operation"))?;
            if record.request.key.wallet == activation.key.wallet
                && record.request.key.key_id == activation.key.key_id
            {
                record.status = Status::Failed;
                store.put(&slot.record_key, &record).await?;
            } else {
                retained.push(slot);
            }
        }
        store.put("active", &retained).await?;
    }
    store
        .put(&activation_key(&activation.key)?, &activation)
        .await
}

pub async fn lookup(
    store: &impl Store,
    request: &SigningRequest,
    now_ms: u64,
) -> Result<Option<Status>> {
    let key = request.record_key()?;
    let Some(mut record) = store.get::<Record>(&key).await? else {
        return Ok(None);
    };
    if record.request != *request {
        return Err(invalid(
            "ML-DSA operation ID was reused for another request",
        ));
    }
    let expired = match &record.status {
        Status::Preparing { claim } => now_ms >= claim.expires_at_ms,
        Status::Running { permit } => now_ms >= permit.expires_at_ms,
        Status::Succeeded { .. } | Status::Failed | Status::Declined => false,
    };
    if expired {
        record.status = match record.status {
            Status::Preparing { .. } => Status::Declined,
            _ => Status::Failed,
        };
        store.put(&key, &record).await?;
    }
    Ok(Some(record.status))
}
/// Claims one coordinator execution before it contacts either role.
/// Duplicate callers never acquire authority to release another run's reservations.
pub async fn begin(
    store: &impl Store,
    policy: &Policy,
    request: SigningRequest,
    now_ms: u64,
) -> Result<Decision> {
    if let Some(operation) = lookup(store, &request, now_ms).await? {
        return Ok(Decision::Existing { operation });
    }
    if active_key(store, &request.key)
        .await?
        .map(|value| value.key)
        .as_ref()
        != Some(&request.key)
    {
        return Err(invalid(
            "ML-DSA key is not authorized by custody completion",
        ));
    }
    let wallet_key = format!("cooldown/{}", hex(&digest(b"wallet", &request.key.wallet)?));
    let next = store.get::<u64>(&wallet_key).await?.unwrap_or(0);
    if !matches!(policy.wallet_cooldown, policy::WalletCooldown::Disabled) && now_ms < next {
        return Ok(Decision::Unavailable {
            reason: UnavailableReason::WalletCooldown,
            retry_at_ms: next,
        });
    }
    let mut active = store.get::<Vec<Slot>>("active").await?.unwrap_or_default();
    active.retain(|slot| slot.expires_at_ms > now_ms);
    if active.len() >= policy.max_active_operations
        || active.iter().any(|slot| slot.wallet == request.key.wallet)
    {
        let retry_at_ms = active
            .iter()
            .map(|slot| slot.expires_at_ms)
            .min()
            .ok_or_else(|| invalid("ML-DSA capacity state is invalid"))?;
        return Ok(Decision::Unavailable {
            reason: UnavailableReason::ServiceCapacity,
            retry_at_ms,
        });
    }
    let mut token = [0; 32];
    getrandom::getrandom(&mut token).map_err(|_| invalid("ML-DSA claim randomness failed"))?;
    let claim = Claim {
        request: request.clone(),
        token,
        expires_at_ms: policy.deadline(now_ms)?,
    };
    let record_key = request.record_key()?;
    active.push(Slot {
        record_key: record_key.clone(),
        wallet: request.key.wallet.clone(),
        expires_at_ms: claim.expires_at_ms,
    });
    store.put("active", &active).await?;
    store
        .put(
            &record_key,
            &Record {
                request,
                status: Status::Preparing {
                    claim: claim.clone(),
                },
            },
        )
        .await?;
    Ok(Decision::Claimed { claim })
}

/// Charges the cooldown only after the claimed coordinator reserved both roles.
pub async fn admit(
    store: &impl Store,
    policy: &Policy,
    claim: Claim,
    batches: Vec<[u8; 32]>,
    now_ms: u64,
) -> Result<Decision> {
    let key = claim.request.record_key()?;
    let record = store
        .get::<Record>(&key)
        .await?
        .ok_or_else(|| invalid("Missing ML-DSA admission claim"))?;
    if record.request != claim.request
        || !matches!(record.status, Status::Preparing { claim: current } if current == claim)
        || now_ms >= claim.expires_at_ms
    {
        return Err(invalid("ML-DSA admission claim expired or changed"));
    }
    if batches.len() < policy.minimum_ready_batches
        || batches.len() > 20
        || batches
            .iter()
            .enumerate()
            .any(|(i, id)| batches[..i].contains(id))
    {
        cancel(store, &claim).await?;
        return Ok(Decision::Unavailable {
            reason: UnavailableReason::EmptyPool,
            retry_at_ms: now_ms.saturating_add(1_000),
        });
    }
    let wallet_key = format!(
        "cooldown/{}",
        hex(&digest(b"wallet", &claim.request.key.wallet)?)
    );
    let permit = Permit {
        request: claim.request.clone(),
        expires_at_ms: claim.expires_at_ms,
        batches,
    };
    store
        .put(&wallet_key, &policy.next_admission(now_ms)?)
        .await?;
    store
        .put(
            &key,
            &Record {
                request: claim.request,
                status: Status::Running {
                    permit: permit.clone(),
                },
            },
        )
        .await?;
    Ok(Decision::Admitted { permit })
}
pub async fn cancel(store: &impl Store, claim: &Claim) -> Result<()> {
    let key = claim.request.record_key()?;
    let mut record = store
        .get::<Record>(&key)
        .await?
        .ok_or_else(|| invalid("Missing ML-DSA admission claim"))?;
    if record.request != claim.request
        || !matches!(&record.status, Status::Preparing { claim: current } if current == claim)
    {
        return Err(invalid("ML-DSA cancellation does not own the claim"));
    }
    record.status = Status::Declined;
    let mut active = store.get::<Vec<Slot>>("active").await?.unwrap_or_default();
    active.retain(|slot| slot.record_key != key);
    store.put("active", &active).await?;
    store.put(&key, &record).await
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case", deny_unknown_fields)]
pub enum Completion {
    Succeeded {
        public_key: Vec<u8>,
        message: Vec<u8>,
        context: Vec<u8>,
        signature: Vec<u8>,
    },
    Failed,
}

/// Completion accepts a verified signature from the authenticated coordinator.
/// Expired work cannot complete, and failure never refunds the wallet cooldown.
pub async fn finish(
    store: &impl Store,
    permit: &Permit,
    completion: Completion,
    now_ms: u64,
) -> Result<Status> {
    let key = permit.request.record_key()?;
    let mut record = store
        .get::<Record>(&key)
        .await?
        .ok_or_else(|| invalid("Unknown ML-DSA operation"))?;
    if record.request != permit.request {
        return Err(invalid("ML-DSA completion binding changed"));
    }
    let current = match &record.status {
        Status::Running { permit } => permit,
        Status::Preparing { .. } => return Err(invalid("ML-DSA signing has not been admitted")),
        Status::Succeeded { .. } | Status::Failed | Status::Declined => return Ok(record.status),
    };
    if current != permit {
        return Err(invalid("ML-DSA permit changed"));
    }
    record.status = match completion {
        Completion::Succeeded {
            public_key,
            message,
            context,
            signature,
        } => {
            if now_ms >= permit.expires_at_ms
                || message.len() > 16384
                || context.len() > 255
                || <[u8; 32]>::from(Sha256::digest(&public_key))
                    != permit.request.key.public_key_digest
                || <[u8; 32]>::from(Sha256::digest(&message)) != permit.request.message_digest
                || <[u8; 32]>::from(Sha256::digest(&context)) != permit.request.context_digest
            {
                return Err(invalid("ML-DSA completion inputs differ from admission"));
            }
            let key: ml_dsa::EncodedVerifyingKey<ml_dsa::MlDsa65> = public_key
                .as_slice()
                .try_into()
                .map_err(|_| invalid("Invalid ML-DSA public key"))?;
            let encoded: ml_dsa::EncodedSignature<ml_dsa::MlDsa65> = signature
                .as_slice()
                .try_into()
                .map_err(|_| invalid("Invalid ML-DSA signature length"))?;
            let decoded = ml_dsa::Signature::<ml_dsa::MlDsa65>::decode(&encoded)
                .ok_or_else(|| invalid("Invalid ML-DSA signature encoding"))?;
            if !ml_dsa::VerifyingKey::<ml_dsa::MlDsa65>::decode(&key)
                .verify_with_context(&message, &context, &decoded)
            {
                return Err(invalid("ML-DSA signature verification failed"));
            }
            Status::Succeeded { signature }
        }
        Completion::Failed => Status::Failed,
    };
    let mut active = store.get::<Vec<Slot>>("active").await?.unwrap_or_default();
    active.retain(|slot| slot.record_key != key);
    store.put("active", &active).await?;
    store.put(&key, &record).await?;
    Ok(record.status)
}

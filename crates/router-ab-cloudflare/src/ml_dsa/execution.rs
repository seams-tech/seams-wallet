//! Runs one admitted operation. Each batch leaves durable storage exactly once.
use super::{admission::Permit, sealing, *};
use ed25519_yao::{
    ml_dsa_runtime::{
        boolean_comparison::{prepared::PublicTopologies, Transport as BooleanTransport},
        prepared::Transport,
        TrustedMlDsaSchedule,
    },
    ml_dsa_signing::{
        prepared_signing::gmw::{GmwBatchResult, PreparedGmwReservation},
        OwnSigningShare, SigningRole,
    },
};
use zeroize::Zeroizing;

/// The host checks live admission and commits consumption before returning bytes.
/// A failed or lost response must never restore the reservation to Ready.
#[allow(async_fn_in_trait)]
pub trait Host {
    fn now_ms(&self) -> Result<u64>;
    fn note_stage(&self, _: ExecutionStage) {}
    fn public_topologies(&self) -> PublicTopologies {
        PublicTopologies::default()
    }
    fn retain_public_topologies(&self, _: &PublicTopologies) {}
    async fn take(
        &self,
        permit: &Permit,
        batch: [u8; 32],
    ) -> Result<(sealing::Binding, sealing::Sealed)>;
}

/// Public execution milestones. Clock readings can include CPU and I/O work.
#[derive(Clone, Copy, Serialize)]
#[serde(tag = "stage", rename_all = "snake_case")]
pub enum ExecutionStage {
    Bound,
    Taking {
        batch: usize,
    },
    Taken {
        batch: usize,
    },
    Restored {
        batch: usize,
        topology_builds: usize,
        topology_hits: usize,
    },
    Activated {
        batch: usize,
    },
    Checked {
        batch: usize,
    },
}

/// Public inputs received with the exact Router permit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub permit: Permit,
    pub message: Vec<u8>,
    pub context: Vec<u8>,
}
impl Request {
    pub fn validate(&self, now_ms: u64) -> Result<()> {
        let permit = &self.permit;
        if now_ms >= permit.expires_at_ms
            || self.message.len() > 16384
            || self.context.len() > 255
            || permit.batches.is_empty()
            || permit.batches.len() > 20
            || <[u8; 32]>::from(Sha256::digest(&self.message)) != permit.request.message_digest
            || <[u8; 32]>::from(Sha256::digest(&self.context)) != permit.request.context_digest
        {
            return Err(invalid("ML-DSA execution differs from live admission"));
        }
        for (index, batch) in permit.batches.iter().enumerate() {
            if permit.batches[..index].contains(batch) {
                return Err(invalid("ML-DSA execution repeats a reserved batch"));
            }
        }
        Ok(())
    }
}

/// Only public outputs leave the role executor.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case", deny_unknown_fields)]
pub enum Outcome {
    Signed {
        signature: Vec<u8>,
        consumed_batches: usize,
        evaluated_candidates: usize,
    },
    Exhausted {
        consumed_batches: usize,
        evaluated_candidates: usize,
    },
}

/// Role-local private inputs. No field contains the other participant's share.
pub struct RoleSecrets {
    pub role: Participant,
    pub material: Zeroizing<Vec<u8>>,
    pub wrapping_seed: Zeroizing<[u8; 32]>,
    pub wrapping_key_version: Identifier,
}

/// Executes internal retries under one operation ID and one cooldown charge.
/// Transport implementations must bound stalled reads by the permit deadline.
pub async fn run<T: Transport + BooleanTransport>(
    request: &Request,
    public_key: &[u8; 1952],
    secrets: RoleSecrets,
    candidates: u16,
    schedules: &[TrustedMlDsaSchedule<'_>],
    host: &impl Host,
    transport: &mut T,
) -> Result<Outcome> {
    request.validate(host.now_ms()?)?;
    let key = &request.permit.request.key;
    if <[u8; 32]>::from(Sha256::digest(public_key)) != key.public_key_digest
        || schedule_digest(schedules) != key.schedule_digest
        || candidates == 0
        || candidates > 32
    {
        return Err(invalid("ML-DSA execution key or schedule changed"));
    }
    // Parse before consumption, then drop the expanded copy. The source stays wiped.
    drop(OwnSigningShare::parse(&secrets.material).map_err(protocol_failure)?);
    let role = match secrets.role {
        Participant::A => SigningRole::A,
        Participant::B => SigningRole::B,
    };
    let binding = digest(
        b"seams/ml-dsa/durable-execution/v1",
        &(&request.permit, candidates),
    )?;
    agree(role, &binding, transport).await?;
    host.note_stage(ExecutionStage::Bound);
    let epoch = digest(b"seams/ml-dsa/material-epoch/v1", key)?;
    let mut topologies = host.public_topologies();
    let mut evaluated_candidates = 0;
    for (index, batch) in request.permit.batches.iter().enumerate() {
        request.validate(host.now_ms()?)?;
        host.note_stage(ExecutionStage::Taking { batch: index });
        let (stored, sealed) = host.take(&request.permit, *batch).await?;
        host.note_stage(ExecutionStage::Taken { batch: index });
        if stored.key != *key
            || stored.role != secrets.role
            || stored.batch != *batch
            || stored.wrapping_key_version != secrets.wrapping_key_version
            || stored.expires_at_ms < request.permit.expires_at_ms
        {
            return Err(invalid("ML-DSA consumed material binding changed"));
        }
        let bytes = sealing::open(sealed, &stored, &secrets.wrapping_seed)?;
        let reservation = PreparedGmwReservation::from_consumed_storage(
            role,
            *batch,
            candidates,
            schedules,
            &mut topologies,
            bytes,
        )
        .map_err(protocol_failure)?;
        host.retain_public_topologies(&topologies);
        let (topology_builds, topology_hits) = topologies.cache_statistics();
        host.note_stage(ExecutionStage::Restored {
            batch: index,
            topology_builds,
            topology_hits,
        });
        request.validate(host.now_ms()?)?;
        let own = OwnSigningShare::parse(&secrets.material).map_err(protocol_failure)?;
        let signer = reservation
            .activate(own, public_key, epoch, transport)
            .await
            .map_err(protocol_failure)?;
        host.note_stage(ExecutionStage::Activated { batch: index });
        let result = signer
            .sign(
                &request.message,
                &request.context,
                &request.permit.request.operation,
                transport,
            )
            .await
            .map_err(protocol_failure)?;
        host.note_stage(ExecutionStage::Checked { batch: index });
        request.validate(host.now_ms()?)?;
        evaluated_candidates += usize::from(candidates);
        if let GmwBatchResult::Signed(value) = result {
            return Ok(Outcome::Signed {
                signature: value.signature.to_vec(),
                consumed_batches: index + 1,
                evaluated_candidates,
            });
        }
    }
    Ok(Outcome::Exhausted {
        consumed_batches: request.permit.batches.len(),
        evaluated_candidates,
    })
}

pub fn schedule_digest(schedules: &[TrustedMlDsaSchedule<'_>]) -> [u8; 32] {
    let mut hash = Sha256::new();
    for schedule in schedules {
        hash.update(schedule.schedule_digest());
    }
    hash.finalize().into()
}
async fn agree(
    role: SigningRole,
    binding: &[u8; 32],
    transport: &mut impl Transport,
) -> Result<()> {
    let peer = match role {
        SigningRole::A => {
            transport.send(binding).await.map_err(protocol_failure)?;
            transport.receive(32).await.map_err(protocol_failure)?
        }
        SigningRole::B => {
            let peer = transport.receive(32).await.map_err(protocol_failure)?;
            transport.send(binding).await.map_err(protocol_failure)?;
            peer
        }
    };
    if peer != binding {
        return Err(invalid("ML-DSA peer operation differs"));
    }
    Ok(())
}
fn protocol_failure(_: impl core::fmt::Display) -> RouterAbProtocolError {
    invalid("ML-DSA role protocol failed")
}

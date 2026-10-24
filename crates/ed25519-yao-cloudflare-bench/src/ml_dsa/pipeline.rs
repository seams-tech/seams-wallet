//! Canonical fixture key generation and independent signature verification.

use super::{drive_runtime, failure, runtime_failure, Duplex};
use std::collections::BTreeSet;

use ml_dsa_threshold::{
    ml_dsa_runtime::TrustedMlDsaSchedule,
    ml_dsa_signing::{
        keygen::{KeygenOutput, KeygenStep},
        SigningRole, PUBLIC_KEY_BYTES, SIGNATURE_BYTES,
    },
};
use ml_dsa::{EncodedSignature, EncodedVerifyingKey, MlDsa65, Signature, VerifyingKey};

pub(super) async fn generate_wallet_key(
    root: &[u8; 32],
    schedules: &[TrustedMlDsaSchedule<'static>],
    transport: &mut Duplex<'_>,
) -> worker::Result<Box<KeygenOutput>> {
    let wallet = ml_dsa_threshold::ml_dsa_signing::wallet_seed::prepare_wallet_keygen(
        super::prepared::role(),
        root,
    )
    .map_err(runtime_failure)?;
    let output = drive_runtime(
        wallet
            .begin(find_schedule(schedules, 0x91)?)
            .map_err(runtime_failure)?,
        transport,
    )
    .await?;
    let (keygen, _) = wallet.accept(output).map_err(runtime_failure)?;
    finish_keygen(keygen, schedules, transport).await
}

async fn finish_keygen(
    mut keygen: KeygenStep,
    schedules: &[TrustedMlDsaSchedule<'static>],
    transport: &mut Duplex<'_>,
) -> worker::Result<Box<KeygenOutput>> {
    let mut bindings = BTreeSet::new();
    loop {
        keygen = match keygen {
            KeygenStep::Circuit(request) => {
                let kernel = request.kernel();
                let schedule = find_schedule(schedules, kernel.circuit_id())?;
                let output =
                    drive_runtime(request.begin(schedule).map_err(runtime_failure)?, transport)
                        .await?;
                if !bindings.insert(output.metrics.execution_binding_sha256) {
                    return Err(failure(
                        "The runtime reused a key-generation execution binding.",
                    ));
                }
                request.accept(output).map_err(runtime_failure)?
            }
            KeygenStep::OpenPublicT(opening) => {
                let own = opening.own_message();
                let peer = match super::prepared::role() {
                    SigningRole::A => {
                        transport.send(&own).await?;
                        transport.receive(own.len()).await?
                    }
                    SigningRole::B => {
                        let peer = transport.receive(own.len()).await?;
                        transport.send(&own).await?;
                        peer
                    }
                };
                opening.accept(&peer).map_err(runtime_failure)?
            }
            KeygenStep::Complete(key) => return Ok(key),
        };
    }
}

fn find_schedule<'a>(
    schedules: &'a [TrustedMlDsaSchedule<'static>],
    circuit_id: u8,
) -> worker::Result<&'a TrustedMlDsaSchedule<'static>> {
    for schedule in schedules {
        if schedule.circuit_id() == circuit_id {
            return Ok(schedule);
        }
    }
    Err(failure(
        "The complete pipeline has no schedule for its next circuit.",
    ))
}

pub(super) fn verify_standard_signature(
    public_key: &[u8; PUBLIC_KEY_BYTES],
    message: &[u8; 32],
    signature: &[u8; SIGNATURE_BYTES],
) -> worker::Result<()> {
    let encoded_key: EncodedVerifyingKey<MlDsa65> =
        public_key.as_slice().try_into().map_err(runtime_failure)?;
    let encoded_signature: EncodedSignature<MlDsa65> =
        signature.as_slice().try_into().map_err(runtime_failure)?;
    let decoded =
        Signature::<MlDsa65>::decode(&encoded_signature).ok_or_else(invalid_standard_signature)?;
    if !VerifyingKey::<MlDsa65>::decode(&encoded_key).verify_with_context(message, b"", &decoded) {
        return Err(invalid_standard_signature());
    }
    Ok(())
}

fn invalid_standard_signature() -> worker::Error {
    failure("An independent standard verifier rejected the threshold signature.")
}

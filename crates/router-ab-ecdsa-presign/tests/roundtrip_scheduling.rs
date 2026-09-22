use k256::{elliptic_curve::sec1::ToEncodedPoint, ProjectivePoint, Scalar};
use rand_chacha::{rand_core::SeedableRng, ChaCha20Rng};
use router_ab_ecdsa_presign::{
    session::{
        derive_presign_pair_context, ClientPresignSession, PresignSessionStage,
        SigningWorkerPresignSession,
    },
    AdditiveKeyShare,
};
use router_ab_ecdsa_wire::{CompressedPointBytes, ScalarBytes};

#[derive(Clone, Copy)]
enum Schedule {
    Current,
    ContinuousPhases,
    ClientMessageInInit,
}

struct Run {
    requests: usize,
    client_messages: Vec<Vec<u8>>,
    worker_messages: Vec<Vec<u8>>,
    client_output: Vec<u8>,
    worker_output: Vec<u8>,
}

fn key_share(value: u64) -> AdditiveKeyShare {
    AdditiveKeyShare::from_bytes(ScalarBytes::new(Scalar::from(value).to_bytes().into())).unwrap()
}

fn triples_complete(stage: PresignSessionStage) -> bool {
    stage != PresignSessionStage::Triples
}

fn run(schedule: Schedule, iteration: u64) -> Run {
    let mut client_seed = [0x71; 32];
    let mut worker_seed = [0x72; 32];
    client_seed[24..].copy_from_slice(&iteration.to_be_bytes());
    worker_seed[24..].copy_from_slice(&iteration.to_be_bytes());
    let mut client_rng = ChaCha20Rng::from_seed(client_seed);
    let mut worker_rng = ChaCha20Rng::from_seed(worker_seed);
    let point = (ProjectivePoint::GENERATOR * Scalar::from(18u64)).to_affine();
    let key =
        CompressedPointBytes::new(point.to_encoded_point(true).as_bytes().try_into().unwrap());
    let context =
        derive_presign_pair_context(key, &format!("roundtrip-benchmark-{iteration}")).unwrap();
    let mut client =
        ClientPresignSession::new(context, key_share(7), key, &mut client_rng).unwrap();
    let mut worker =
        SigningWorkerPresignSession::new(context, key_share(11), key, &mut worker_rng).unwrap();
    let continuous = !matches!(schedule, Schedule::Current);
    let mut client_pending = client.poll().outgoing;
    let mut worker_pending = worker.poll().outgoing;
    let mut client_messages = Vec::new();
    let mut worker_messages = worker_pending.clone();
    let mut requests = 1;
    let mut candidate_big_r = None;

    if matches!(schedule, Schedule::ClientMessageInInit) {
        for message in client_pending.drain(..) {
            worker.message(&message, &mut worker_rng).unwrap();
            client_messages.push(message);
        }
        let progress = worker.poll();
        worker_messages.extend(progress.outgoing.clone());
        worker_pending.extend(progress.outgoing);
    }

    for _ in 0..32 {
        for message in worker_pending.drain(..) {
            client.message(&message, &mut client_rng).unwrap();
            if let Ok(candidate) = client.candidate_big_r() {
                candidate_big_r = Some(candidate);
                assert!(client.take_presignature_97().is_err());
            }
            if continuous && client.stage() == PresignSessionStage::TriplesDone {
                client.start_presign().unwrap();
            }
        }
        if !continuous
            && client.stage() == PresignSessionStage::TriplesDone
            && triples_complete(worker.stage())
        {
            client.start_presign().unwrap();
        }
        client_pending.extend(client.poll().outgoing);
        if client.stage() == PresignSessionStage::Done
            && worker.stage() == PresignSessionStage::Done
        {
            break;
        }

        requests += 1;
        if !continuous
            && worker.stage() == PresignSessionStage::TriplesDone
            && triples_complete(client.stage())
        {
            worker.start_presign().unwrap();
        }
        for message in client_pending.drain(..) {
            worker.message(&message, &mut worker_rng).unwrap();
            if continuous && worker.stage() == PresignSessionStage::TriplesDone {
                worker.start_presign().unwrap();
            }
            client_messages.push(message);
        }
        let progress = worker.poll();
        worker_messages.extend(progress.outgoing.clone());
        worker_pending.extend(progress.outgoing);
    }

    assert_eq!(client.stage(), PresignSessionStage::Done);
    assert_eq!(worker.stage(), PresignSessionStage::Done);
    let client_output = client.take_presignature_97().unwrap();
    let worker_output = worker.take_presignature_97().unwrap();
    assert_eq!(candidate_big_r.unwrap().as_bytes(), &client_output[..33]);
    assert!(client.candidate_big_r().is_err());
    assert!(client.take_presignature_97().is_err());
    assert!(worker.take_presignature_97().is_err());
    Run {
        requests,
        client_messages,
        worker_messages,
        client_output,
        worker_output,
    }
}

fn equivalent(reference: &Run, candidate: &Run) {
    assert_eq!(reference.client_messages, candidate.client_messages);
    assert_eq!(reference.worker_messages, candidate.worker_messages);
    assert_eq!(reference.client_output, candidate.client_output);
    assert_eq!(reference.worker_output, candidate.worker_output);
}

fn reject_invalid_messages() {
    let mut client_rng = ChaCha20Rng::from_seed([0x71; 32]);
    let mut worker_rng = ChaCha20Rng::from_seed([0x72; 32]);
    let point = (ProjectivePoint::GENERATOR * Scalar::from(18u64)).to_affine();
    let key =
        CompressedPointBytes::new(point.to_encoded_point(true).as_bytes().try_into().unwrap());
    let context = derive_presign_pair_context(key, "negative-schedule-check").unwrap();
    let other_context = derive_presign_pair_context(key, "different-ceremony").unwrap();
    let mut client =
        ClientPresignSession::new(context, key_share(7), key, &mut client_rng).unwrap();
    let mut worker =
        SigningWorkerPresignSession::new(context, key_share(11), key, &mut worker_rng).unwrap();
    let client_first = client.poll().outgoing.remove(0);
    let worker_first = worker.poll().outgoing.remove(0);
    worker.message(&client_first, &mut worker_rng).unwrap();
    assert!(worker.message(&client_first, &mut worker_rng).is_err());

    client.message(&worker_first, &mut client_rng).unwrap();
    let client_second = client.poll().outgoing.remove(0);
    let mut fresh_worker =
        SigningWorkerPresignSession::new(context, key_share(11), key, &mut worker_rng).unwrap();
    assert!(fresh_worker
        .message(&client_second, &mut worker_rng)
        .is_err());

    let mut other_worker =
        SigningWorkerPresignSession::new(other_context, key_share(11), key, &mut worker_rng)
            .unwrap();
    assert!(other_worker
        .message(&client_first, &mut worker_rng)
        .is_err());
}

#[test]
fn batched_schedules_preserve_every_protocol_message_and_single_use_output() {
    for seed in 0..25 {
        let reference = run(Schedule::Current, seed);
        let continuous = run(Schedule::ContinuousPhases, seed);
        let combined_init = run(Schedule::ClientMessageInInit, seed);
        assert_eq!(
            (
                reference.requests,
                continuous.requests,
                combined_init.requests
            ),
            (8, 7, 6)
        );
        equivalent(&reference, &continuous);
        equivalent(&reference, &combined_init);
    }
    reject_invalid_messages();
}

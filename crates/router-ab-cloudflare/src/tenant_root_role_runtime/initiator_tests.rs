use super::admission_tests::*;
use super::live_execution_tests::test_provider_config;
use super::tests::InMemoryProvider;
use super::*;
use rand_chacha::ChaCha20Rng;
use rand_core_06::SeedableRng;

/// A peer that runs the real second leg against whatever commitment it is
/// actually handed.
///
/// It deliberately does NOT recompute the initiator's commitment. An
/// earlier version did, using the same deterministic seed, which hid that
/// production B has no way to obtain it.
struct RealPeer {
    role: TwoPartyDeriverRole,
    received_initiator_commitment: Option<Vec<u8>>,
    withhold_receipt: bool,
    calls: usize,
}

impl RealPeer {
    fn new(role: TwoPartyDeriverRole) -> Self {
        Self {
            role,
            received_initiator_commitment: None,
            withhold_receipt: false,
            calls: 0,
        }
    }
}

/// Mints the receipt B's role key would actually sign for its insertion.
///
/// Signed over B's real replay key and the exact installation evidence, so
/// the tests exercise the verifier rather than a placeholder.
pub(crate) fn peer_terminal_receipt(
    peer_role: TwoPartyDeriverRole,
    peer_package: &[u8],
    evidence_bytes: &[u8],
    signing_key: &[u8; 32],
) -> Vec<u8> {
    let package = TenantRootRoleCreationCommandPackageV1::decode_canonical_bytes(peer_package)
        .expect("peer package");
    let command = package
        .verify(
            peer_role,
            authority(),
            ISSUER_KEY_ID,
            &ed25519_dalek::SigningKey::from_bytes(&ISSUER_KEY)
                .verifying_key()
                .to_bytes(),
        )
        .expect("verified peer command")
        .into_command();
    router_ab_core::TenantRootCommandTerminalReceiptV1::sign_success(
        *command.scope().key(),
        command.digest(),
        evidence_bytes.to_vec(),
        ISSUED_AT_MS + 3,
        signing_key_id(peer_role),
        signing_key,
    )
    .expect("terminal receipt")
    .canonical_bytes()
    .expect("receipt bytes")
}

impl TenantRootPeerRoleDriverV1 for RealPeer {
    async fn drive_peer(
        &mut self,
        peer_package_bytes: &[u8],
        initiator_signed_commitment: &[u8],
    ) -> RouterAbProtocolResult<TenantRootPeerRoleOutcomeV1> {
        self.calls += 1;
        self.received_initiator_commitment = Some(initiator_signed_commitment.to_vec());

        let mut online = InMemoryProvider::new();
        let mut backup = InMemoryProvider::new();
        let progress = execute_tenant_root_role_creation_v1(
            peer_package_bytes,
            Some(initiator_signed_commitment),
            self.role,
            authority(),
            &trusted_issuer_keys(),
            &test_role_keys(),
            &signer(self.role),
            &test_provider_config(),
            &mut online,
            &mut backup,
            ISSUED_AT_MS + 2,
            &mut ChaCha20Rng::from_seed([0x88; 32]),
        )
        .await?;
        let TenantRootRoleCreationProgressV1::Sealed {
            signed_commitment,
            signed_installation_evidence,
            managed_backup,
            completion:
                TenantRootRoleCreationCompletionV1::RoleOnly {
                    provider_canary_receipt,
                },
            ..
        } = progress
        else {
            panic!("the peer leg must seal")
        };
        let signed_managed_backup = managed_backup.canonical_bytes().to_vec();
        // The receipt B's role key would really sign for this insertion.
        let terminal_receipt = if self.withhold_receipt {
            b"not-a-receipt-at-all".to_vec()
        } else {
            peer_terminal_receipt(
                self.role,
                peer_package_bytes,
                &signed_installation_evidence,
                &role_key(self.role).to_bytes(),
            )
        };
        Ok(TenantRootPeerRoleOutcomeV1 {
            signed_commitment,
            signed_installation_evidence,
            signed_managed_backup,
            provider_canary_receipt,
            terminal_receipt,
        })
    }
}

/// A peer that fails, standing in for a lost or refused service call.
struct FailingPeer;
impl TenantRootPeerRoleDriverV1 for FailingPeer {
    async fn drive_peer(
        &mut self,
        _: &[u8],
        _: &[u8],
    ) -> RouterAbProtocolResult<TenantRootPeerRoleOutcomeV1> {
        Err(RouterAbProtocolError::new(
            RouterAbProtocolErrorCode::InvalidLocalServiceConfig,
            "peer unavailable",
        ))
    }
}

/// A peer that returns another ceremony's installation evidence.
struct ForeignEvidencePeer {
    role: TwoPartyDeriverRole,
}
impl TenantRootPeerRoleDriverV1 for ForeignEvidencePeer {
    async fn drive_peer(
        &mut self,
        peer_package_bytes: &[u8],
        initiator_signed_commitment: &[u8],
    ) -> RouterAbProtocolResult<TenantRootPeerRoleOutcomeV1> {
        let mut honest = RealPeer::new(self.role);
        let mut outcome = honest
            .drive_peer(peer_package_bytes, initiator_signed_commitment)
            .await?;
        // Corrupt the evidence so its signature no longer verifies.
        outcome.signed_installation_evidence[0] ^= 0xff;
        Ok(outcome)
    }
}

async fn drive<P: TenantRootPeerRoleDriverV1>(
    peer: &mut P,
) -> RouterAbProtocolResult<TenantRootRoleCreationProgressV1> {
    let mut online = InMemoryProvider::new();
    let mut backup = InMemoryProvider::new();
    drive_tenant_root_role_creation_as_initiator_v1(
        &package_bytes(TwoPartyDeriverRole::DeriverA, &ISSUER_KEY),
        &package_bytes(TwoPartyDeriverRole::DeriverB, &ISSUER_KEY),
        TwoPartyDeriverRole::DeriverA,
        authority(),
        &trusted_issuer_keys(),
        &test_role_keys(),
        &signer(TwoPartyDeriverRole::DeriverA),
        &test_provider_config(),
        &mut online,
        &mut backup,
        peer,
        ISSUED_AT_MS + 2,
        &mut ChaCha20Rng::from_seed([0x77; 32]),
    )
    .await
}

fn block_on<F: core::future::Future>(future: F) -> F::Output {
    futures::executor::block_on(future)
}

/// The peer is handed the initiator's exact commitment and package.
///
/// This is the property the earlier test masked: B cannot derive A's
/// commitment, so the orchestration must transport it.
#[test]
fn the_peer_receives_the_initiators_exact_commitment() {
    let mut peer = RealPeer::new(TwoPartyDeriverRole::DeriverB);
    let progress = block_on(drive(&mut peer)).expect("initiator sealed");
    assert_eq!(peer.calls, 1, "the peer is driven exactly once");

    let received = peer
        .received_initiator_commitment
        .expect("the peer must receive a commitment");
    let TenantRootRoleCreationProgressV1::Sealed {
        signed_commitment, ..
    } = progress
    else {
        panic!("expected a sealed initiator")
    };
    assert_eq!(
        received, signed_commitment,
        "the peer must receive the initiator's exact commitment"
    );
}

/// A failed peer call abandons the attempt. Nothing durable was written for
/// the initiator, so returning the error IS the cleanup.
#[test]
fn a_failed_peer_call_abandons_the_initiator_attempt() {
    assert!(
        block_on(drive(&mut FailingPeer)).is_err(),
        "a failed peer call must abandon rather than park a scalar"
    );
}

/// Non-empty garbage is refused. The earlier check only required bytes to
/// be present, which is the same trust problem as a boolean.
#[test]
fn a_non_empty_garbage_receipt_is_refused() {
    let mut peer = RealPeer::new(TwoPartyDeriverRole::DeriverB);
    peer.withhold_receipt = true;
    assert!(
        block_on(drive(&mut peer)).is_err(),
        "non-empty bytes must not stand in for a receipt"
    );
}

/// A validly signed receipt for DIFFERENT evidence is refused: the payload
/// must be exactly the installation it attests.
#[test]
fn a_valid_receipt_for_other_evidence_is_refused() {
    struct WrongPayloadPeer(TwoPartyDeriverRole);
    impl TenantRootPeerRoleDriverV1 for WrongPayloadPeer {
        async fn drive_peer(
            &mut self,
            peer_package_bytes: &[u8],
            initiator_signed_commitment: &[u8],
        ) -> RouterAbProtocolResult<TenantRootPeerRoleOutcomeV1> {
            let mut honest = RealPeer::new(self.0);
            let mut outcome = honest
                .drive_peer(peer_package_bytes, initiator_signed_commitment)
                .await?;
            // A real signature over a real replay key, but attesting other bytes.
            outcome.terminal_receipt = peer_terminal_receipt(
                self.0,
                peer_package_bytes,
                b"some other evidence",
                &role_key(self.0).to_bytes(),
            );
            Ok(outcome)
        }
    }
    assert!(
        block_on(drive(&mut WrongPayloadPeer(TwoPartyDeriverRole::DeriverB))).is_err(),
        "a receipt attesting other evidence must be refused"
    );
}

/// A receipt signed by the wrong role key is refused.
#[test]
fn a_receipt_signed_by_the_wrong_role_is_refused() {
    struct WrongSignerPeer(TwoPartyDeriverRole);
    impl TenantRootPeerRoleDriverV1 for WrongSignerPeer {
        async fn drive_peer(
            &mut self,
            peer_package_bytes: &[u8],
            initiator_signed_commitment: &[u8],
        ) -> RouterAbProtocolResult<TenantRootPeerRoleOutcomeV1> {
            let mut honest = RealPeer::new(self.0);
            let mut outcome = honest
                .drive_peer(peer_package_bytes, initiator_signed_commitment)
                .await?;
            outcome.terminal_receipt = peer_terminal_receipt(
                self.0,
                peer_package_bytes,
                &outcome.signed_installation_evidence,
                // The initiator's key, not the peer's.
                &role_key(TwoPartyDeriverRole::DeriverA).to_bytes(),
            );
            Ok(outcome)
        }
    }
    assert!(
        block_on(drive(&mut WrongSignerPeer(TwoPartyDeriverRole::DeriverB))).is_err(),
        "a receipt signed by the wrong role must be refused"
    );
}

/// A peer whose evidence is validly signed over a DIFFERENT commitment pair
/// is refused.
///
/// This is the case a signature-only check cannot catch: every signature
/// verifies, the role and ceremony match, but the transcript attests a pair
/// the initiator is not part of.
#[test]
fn valid_evidence_over_a_different_commitment_pair_is_refused() {
    struct OtherPairPeer(TwoPartyDeriverRole);
    impl TenantRootPeerRoleDriverV1 for OtherPairPeer {
        async fn drive_peer(
            &mut self,
            peer_package_bytes: &[u8],
            _initiator_signed_commitment: &[u8],
        ) -> RouterAbProtocolResult<TenantRootPeerRoleOutcomeV1> {
            // Build a SECOND initiator commitment the real initiator never
            // produced, and have the peer finalize against that instead.
            let other_initiator = admit_for_with_rng(TwoPartyDeriverRole::DeriverA, 0x5a);
            let other_commitment = other_initiator.commitment_bytes().to_vec();
            let mut honest = RealPeer::new(self.0);
            honest
                .drive_peer(peer_package_bytes, &other_commitment)
                .await
        }
    }
    let err = block_on(drive(&mut OtherPairPeer(TwoPartyDeriverRole::DeriverB)))
        .expect_err("evidence over another pair");
    assert_eq!(err.code(), RouterAbProtocolErrorCode::ForbiddenLocalBinding);
}

/// The exact receipt and the exact pair are accepted.
#[test]
fn the_exact_receipt_and_commitment_pair_are_accepted() {
    let mut peer = RealPeer::new(TwoPartyDeriverRole::DeriverB);
    assert!(matches!(
        block_on(drive(&mut peer)).expect("accepted"),
        TenantRootRoleCreationProgressV1::Sealed { .. }
    ));
}

/// The peer's installation evidence is verified, not taken on trust.
#[test]
fn the_initiator_verifies_the_peers_installation_evidence() {
    let mut peer = ForeignEvidencePeer {
        role: TwoPartyDeriverRole::DeriverB,
    };
    assert!(
        block_on(drive(&mut peer)).is_err(),
        "unverifiable peer evidence must be refused"
    );
}

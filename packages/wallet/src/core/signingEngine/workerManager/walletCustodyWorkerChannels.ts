import type {
  PasskeyCustodyEnvelopeRecord,
  WalletCustodyCeremonyCommitPayload,
  WalletCustodyEvmFamilyActivationCompletion,
} from '@shared/passkey-custody';
import type {
  RouterAbEd25519YaoApplicationBindingFactsV1,
  RouterAbEd25519YaoActivationAdmissionReceiptV1,
} from '@shared/utils/routerAbEd25519Yao';
import type { WalletRecoverySetRotationWorkerResultV1 } from '@shared/wallet-recovery/walletRecoveryRotation';
import type { Variant } from '@shared/utils/variant';
import type {
  MlDsaCustodyCommit,
  MlDsaCustodyProtocolInputs,
} from '@shared/passkey-custody/mlDsaCustody';

/**
 * The public reference to an unlocked wallet Ed25519 export-root capability.
 *
 * The worker owns the opened custody-seed handle; this reference carries only
 * the opaque handle id and the binding facts the worker will re-verify before
 * sealing: exact wallet, issuing auth method, owner Wallet Session, and
 * expiry. It is volatile by construction — nothing here can be used to reopen
 * an envelope after the worker destroys the handle, so persisting it grants
 * nothing.
 */
export type UnlockedWalletEd25519ExportRootCapabilityV1 = {
  readonly kind: 'unlocked_wallet_ed25519_export_root_capability_v1';
  readonly capabilityHandleId: string;
  readonly walletId: string;
  readonly walletAuthMethodId: string;
  readonly walletSessionId: string;
  readonly expiresAtMs: number;
  /**
   * Present only when this unlock opened an unbound envelope and resealed it
   * under the method that authenticated. The caller persists it; until it does,
   * the old row stands and the next unlock produces the upgrade again, so a
   * failed write costs a retry rather than access.
   */
  readonly upgradedEnvelope?: PasskeyCustodyEnvelopeRecord;
};

/**
 * A linked device's unlocked export-root capability: the Ed25519 Yao Client
 * root that device opened from its own envelope at an unlock. It carries the
 * same public binding facts as the seed-backed reference. Only linking
 * accepts it — never a seed reseal or an auth-method addition.
 */
type UnlockedLinkedDeviceEd25519ClientRootCapabilityV1 = {
  readonly kind: 'unlocked_linked_device_ed25519_client_root_capability_v1';
  readonly capabilityHandleId: string;
  readonly walletId: string;
  readonly walletAuthMethodId: string;
  readonly walletSessionId: string;
  readonly expiresAtMs: number;
};

/** The unlocked capability a device approving a link seals the export root from. */
export type UnlockedEd25519ExportRootLinkingCapabilityV1 =
  | UnlockedWalletEd25519ExportRootCapabilityV1
  | UnlockedLinkedDeviceEd25519ClientRootCapabilityV1
  | {
      readonly kind: 'unlocked_linked_device_ml_dsa_roots_capability_v1';
      readonly capabilityHandleId: string;
      readonly walletId: string;
      readonly walletAuthMethodId: string;
      readonly walletSessionId: string;
      readonly expiresAtMs: number;
    };

/**
 * What a destroy call invalidates. Lock destroys by wallet, session
 * retirement or replacement by Wallet Session, failed activation by capability
 * handle, and worker reset or page teardown destroys all.
 */
export type UnlockedWalletEd25519ExportRootCapabilityDestroyScopeV1 =
  | { readonly kind: 'capability'; readonly capabilityHandleId: string }
  | { readonly kind: 'wallet'; readonly walletId: string }
  | { readonly kind: 'wallet_session'; readonly walletSessionId: string }
  | { readonly kind: 'all' };

/**
 * One wallet custody ceremony run, one operation per step.
 *
 * A run provisions exactly one key set. It either *establishes* custody — the
 * wallet's first key set, where the seed is generated, its envelope sealed and
 * the recovery set issued — or *joins* custody that already exists, reaching the
 * same seed by opening that envelope and writing nothing but its own manifest.
 *
 * The run's state lives in the worker between these calls, keyed by
 * `ceremonyId`, because it holds the seed and the in-flight protocol state.
 * Nothing here carries custody material in either direction: `protocolInputs`
 * and `protocolResult` are public protocol messages, and the finish returns
 * ciphertext and public records.
 *
 * `factorSecret` is the one secret that crosses inbound — a passkey PRF result
 * or the Email OTP factor key. An establishing run sends it at the finish, to
 * seal; a joining run sends it at the begin, to open. The worker clears its own
 * copy either way.
 */
type MlDsaRecoveryProtocolInputs = Omit<MlDsaCustodyProtocolInputs, 'continuity'> & {
  readonly continuity: Variant<MlDsaCustodyProtocolInputs['continuity'], 'kind', 'recover'>;
};
type MlDsaCreateProtocolInputs = Omit<MlDsaCustodyProtocolInputs, 'continuity'> & {
  readonly continuity: Variant<MlDsaCustodyProtocolInputs['continuity'], 'kind', 'create'>;
};
type MlDsaBeginPayload = { readonly ceremonyId: string; readonly keySet: 'near_ml_dsa_65_v1' } & (
  | {
      readonly custody: { readonly origin: 'establish'; readonly walletId: string };
      readonly protocolInputs: MlDsaCreateProtocolInputs;
    }
  | {
      readonly custody: {
        readonly origin: 'join';
        readonly custodyJson: string;
        readonly factorSecret: ArrayBuffer;
      };
      readonly protocolInputs: MlDsaCustodyProtocolInputs;
    }
  | {
      readonly custody: {
        readonly origin: 'recover';
        readonly custodyJson: string;
        readonly recoveryCode: ArrayBuffer;
      };
      readonly protocolInputs: MlDsaRecoveryProtocolInputs;
    }
);

export interface WalletCustodyCeremonyWorkerOperationMap {
  openEd25519YaoLaneSource: {
    payload:
      | {
          kind: 'factor';
          factorSecret: ArrayBuffer;
          envelope: PasskeyCustodyEnvelopeRecord;
          applicationBindingDigestB64u: string;
        }
      | {
          kind: 'unlocked_ed25519_export_root_capability';
          capability: UnlockedEd25519ExportRootLinkingCapabilityV1;
          applicationBindingDigestB64u: string;
          walletKeyId: string;
          enrollmentId: string;
          revocationEpoch: number;
          registeredPublicKeyB64u: string;
        };
    result: { sourceHandle: string };
  };
  prepareEd25519YaoSourcePreservingRegistration: {
    payload: {
      sourceHandle: string;
      targetAdmission: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;
      applicationBinding: RouterAbEd25519YaoApplicationBindingFactsV1;
      participantIds: readonly [number, number];
      expectedRegisteredPublicKeyB64u: string;
      targetClientRecipientPublicKeyB64u: string;
    };
    result: { requestJson: string };
  };
  discardEd25519YaoLaneSource: {
    payload: { sourceHandle: string };
    result: { discarded: boolean };
  };
  checkpointNearRegistration: {
    payload: { ceremonyId: string };
    result: { checkpointJson: string };
  };
  restoreNearRegistration: {
    payload: {
      ceremonyId: string;
      custodyJson: string;
      factorSecret: ArrayBuffer;
      checkpointJson: string;
      walletCustodySeed?: never;
      recipientPrivateKey?: never;
      protocolInputsJson?: never;
    };
    result: { ceremonyId: string; yaoExecuteRequestJson: string };
  };
  beginWalletCustodyKeySetRun: {
    payload:
      | MlDsaBeginPayload
      | {
          ceremonyId: string;
          keySet: 'near_ed25519_v1';
          custody:
            | { origin: 'establish'; walletId: string }
            | { origin: 'join'; custodyJson: string; factorSecret: ArrayBuffer }
            | { origin: 'recover'; custodyJson: string; recoveryCode: ArrayBuffer }
            | {
                origin: 'recover_and_reseal';
                custodyJson: string;
                recoveryCode: ArrayBuffer;
                replacementFactorJson: string;
                replacementFactorSecret: ArrayBuffer;
              };
          protocolInputsJson: string;
        }
      | {
          ceremonyId: string;
          keySet: 'evm_family_ecdsa_v1';
          custody:
            | {
                origin: 'establish';
                walletId: string;
                factorJson: string;
                factorSecret: ArrayBuffer;
                recoveryCodesJson: string;
              }
            | { origin: 'join'; custodyJson: string; factorSecret: ArrayBuffer }
            | { origin: 'recover'; custodyJson: string; recoveryCode: ArrayBuffer }
            | {
                origin: 'recover_and_reseal';
                custodyJson: string;
                recoveryCode: ArrayBuffer;
                replacementFactorJson: string;
                replacementFactorSecret: ArrayBuffer;
              };
          protocolInputsJson: string;
          evmFamilySigningKeySlotId: string;
          recordedKeyManifestDigestB64u?: string;
        };
    result:
      | { ceremonyId: string; keySet: 'near_ml_dsa_65_v1'; roleInputsJson: string }
      | {
          ceremonyId: string;
          keySet: 'near_ed25519_v1';
          yaoExecuteRequestJson: string;
        }
      | {
          ceremonyId: string;
          keySet: 'evm_family_ecdsa_v1';
          ecdsaContextBinding32B64u: string;
          ecdsaClientSharePublicKey33B64u: string;
          ecdsaClientShareRetryCounter: number;
          preActivationCommitPayload: WalletCustodyCeremonyCommitPayload;
        };
  };
  completeWalletCustodyKeySetRun: {
    payload:
      | { ceremonyId: string; keySet: 'near_ml_dsa_65_v1'; protocolResultJson: string }
      | {
          ceremonyId: string;
          keySet: 'near_ed25519_v1';
          protocolResultJson: string;
          nearEd25519SigningKeyId: string;
          recordedKeyManifestDigestB64u?: string;
        }
      | {
          ceremonyId: string;
          keySet: 'evm_family_ecdsa_v1';
          protocolResultJson: string;
        };
    result:
      | { ceremonyId: string; keySet: 'near_ml_dsa_65_v1' }
      | { ceremonyId: string; keySet: 'near_ed25519_v1' }
      | {
          ceremonyId: string;
          keySet: 'evm_family_ecdsa_v1';
          activation: WalletCustodyEvmFamilyActivationCompletion;
        };
  };
  finishWalletCustodyKeySetRun: {
    payload: {
      ceremonyId: string;
      finish:
        | { kind: 'existing' }
        | {
            kind: 'establish';
            factorJson: string;
            factorSecret: ArrayBuffer;
            recoveryCodesJson: string;
          }
        | {
            kind: 'recover_reseal';
            replacementFactorJson: string;
            replacementFactorSecret: ArrayBuffer;
          };
    };
    result: WalletCustodyCeremonyCommitPayload;
  };
  finishMlDsaCustodyKeySetRun: {
    payload: WalletCustodyCeremonyWorkerOperationMap['finishWalletCustodyKeySetRun']['payload'];
    result: MlDsaCustodyCommit;
  };
  linkWalletCustodyPasskey: {
    payload: {
      existingEnvelope: PasskeyCustodyEnvelopeRecord;
      existingFactorSecret: ArrayBuffer;
      replacementEnvelopeBindingJson: string;
      replacementFactorSecret: ArrayBuffer;
    };
    result: {
      nonceB64u: string;
      sealedCustodySecretB64u: string;
      aadHashB64u: string;
      ciphertextDigestB64u: string;
    };
  };
  /**
   * Device 2: generates the X25519 recipient key Device 1 will seal the wallet
   * custody seed to. The private half stays inside this worker under the
   * returned handle; only the public key crosses back.
   */
  createLinkedDeviceEd25519ExportRootRecipient: {
    payload: Record<string, never>;
    result: { recipientHandleId: string; recipientPublicKeyB64u: string };
  };
  /**
   * Opens the wallet custody seed envelope with the factor secret already
   * present in registration or ordinary unlock, and parks the opened handle
   * inside this worker for the lifetime of the owner Wallet Session that
   * authorized it. The result is the public reference only — no seed bytes,
   * and no serializable secret.
   *
   * A linked device's unlock opens its own Ed25519 Yao Client-root envelope
   * the same way, into the distinct linked-device capability that only
   * linking accepts.
   *
   * At most one capability exists per wallet and owner Wallet Session;
   * establishing a new one destroys the previous handle first.
   */
  readMlDsaExportEnvelope: {
    payload: {
      capability: UnlockedEd25519ExportRootLinkingCapabilityV1;
      signingKeyId: string;
      publicKeyB64u: string;
    };
    result: PasskeyCustodyEnvelopeRecord;
  };
  sealMlDsaExportRootForLinkedDevice: {
    payload: {
      capability: UnlockedEd25519ExportRootLinkingCapabilityV1;
      binding: import('@shared/device-linking/mlDsaExportRoot').MlDsaRootTransferBindingV1;
    };
    result: import('@shared/device-linking/mlDsaExportRoot').SealedMlDsaRootTransferV1;
  };
  establishUnlockedWalletEd25519ExportRootCapability: {
    payload: {
      existingEnvelopes: readonly PasskeyCustodyEnvelopeRecord[];
      existingFactorSecret: ArrayBuffer;
      walletId: string;
      walletAuthMethodId: string;
      walletSessionId: string;
      expiresAtMs: number;
    };
    result: UnlockedEd25519ExportRootLinkingCapabilityV1;
  };
  /**
   * Destroys unlocked Ed25519 export-root capabilities. Wired into lock,
   * wallet switch, Wallet Session retirement or replacement, expiry, failed
   * activation, and page teardown; `all` is the worker-reset scope.
   */
  destroyUnlockedWalletEd25519ExportRootCapabilities: {
    payload: { scope: UnlockedWalletEd25519ExportRootCapabilityDestroyScopeV1 };
    result: { destroyedCount: number };
  };
  /**
   * Device 1: seals the wallet custody seed for one approved linked device
   * from the worker-held unlocked capability. The seed and the derived
   * transfer key never leave the worker; a wallet, auth-method, Wallet
   * Session, or expiry mismatch fails before any ciphertext exists. Each call
   * draws a fresh X25519 ephemeral key and nonce.
   */
  /**
   * Reseals this wallet's seed under a new factor, from the capability an
   * unlock already opened.
   *
   * For an addition whose source is Email OTP. The source factor secret is
   * already in the worker, so the addition costs no factor release and no
   * second one-time code — the fresh code the user typed authorized the
   * ceremony, and the seed comes from the handle unlock opened.
   */
  resealWalletCustodyFromUnlockedCapability: {
    payload: {
      capability: UnlockedWalletEd25519ExportRootCapabilityV1;
      replacementEnvelopeBindingJson: string;
      replacementFactorSecret: ArrayBuffer;
    };
    result: {
      nonceB64u: string;
      sealedCustodySecretB64u: string;
      aadHashB64u: string;
      ciphertextDigestB64u: string;
    };
  };
  sealEd25519ExportRootForLinkedDevice: {
    payload: {
      capability: UnlockedEd25519ExportRootLinkingCapabilityV1;
      transferBindingJson: string;
    };
    result: {
      ephemeralPublicKeyB64u: string;
      nonceB64u: string;
      sealedExportRootB64u: string;
      bindingDigestB64u: string;
      ciphertextDigestB64u: string;
    };
  };
  /**
   * Device 2: opens the transfer with its recipient handle and immediately
   * reseals the seed under the passkey it just created. One operation rather
   * than two so the opened seed never sits in a handle JavaScript could hold
   * across a turn.
   */
  acceptLinkedDeviceEd25519ExportRoot: {
    payload: {
      recipientHandleId: string;
      transferBindingJson: string;
      ephemeralPublicKeyB64u: string;
      nonceB64u: string;
      sealedExportRootB64u: string;
      bindingDigestB64u: string;
      ciphertextDigestB64u: string;
      replacementEnvelopeBindingJson: string;
      replacementFactorSecret: ArrayBuffer;
    };
    result: {
      nonceB64u: string;
      sealedExportRootB64u: string;
      aadHashB64u: string;
      ciphertextDigestB64u: string;
    };
  };
  /** Zeroizes a recipient handle on cancel, failure, or page teardown. */
  discardLinkedDeviceEd25519ExportRootRecipient: {
    payload: { recipientHandleId: string };
    result: { recipientHandleId: string; discarded: boolean };
  };
  rotateWalletRecoverySet: {
    payload: {
      custodyJson: string;
      factorSecret: ArrayBuffer;
      recoveryCodesJson: string;
    };
    result: WalletRecoverySetRotationWorkerResultV1;
  };
  discardWalletCustodyCeremony: {
    payload: { ceremonyId: string };
    result: { ceremonyId: string; discarded: boolean };
  };
}

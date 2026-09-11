import type { TenantRootIdentityV1 } from './tenantRootIdentity';

/**
 * Console-facing state for one tenant derivation root (Refactor 121).
 *
 * The console and CLI render these branches directly rather than deriving
 * local booleans from them. Two distinctions are structural on purpose:
 *
 * - a rotation that activated but has not proved both retirements is its own
 *   branch, so no surface can claim compromise healing from activation alone;
 * - a browser response and a CLI durability check are different download
 *   evidence branches, so a returned HTTP 200 is never presented as durable.
 */

/** Which of the three trust results a verification actually obtained. */
export type TenantRootTrustLevelV1 =
  | { readonly kind: 'cryptographically_valid_offline' }
  | {
      readonly kind: 'valid_at_trust_snapshot';
      readonly snapshotVersion: number;
      readonly snapshotIssuedAt: string;
    }
  | {
      readonly kind: 'current_trust_confirmed';
      readonly snapshotVersion: number;
      readonly snapshotIssuedAt: string;
      readonly checkedAt: string;
    };

/**
 * What this deployment is permitted to claim about retired share material.
 *
 * `operational_rotation_v1` reports removal from the active service path only.
 * `managed_healing_v1` additionally proves each role's outer retention-key
 * version was destroyed, so storage history cannot reopen the inner package.
 */
export type TenantRootDeploymentSecurityProfileV1 =
  | 'operational_rotation_v1'
  | 'managed_healing_v1';

/**
 * Evidence that one artifact reached the tenant.
 *
 * A browser download can only ever record that a response was issued. Only the
 * native CLI, after a restrictive write, sync, reopen, digest, and signature
 * check, records durable verification.
 */
export type TenantRootDownloadEvidenceV1 =
  | { readonly kind: 'never_downloaded' }
  | {
      readonly kind: 'download_issued';
      readonly issuedAt: string;
      readonly actorUserId: string;
      readonly contentDigestB64u: string;
    }
  | {
      readonly kind: 'durable_verified';
      readonly verifiedAt: string;
      readonly actorUserId: string;
      readonly contentDigestB64u: string;
      readonly trustLevel: TenantRootTrustLevelV1;
    };

/** The tenant's recovery governance policy. */
export type TenantRootRecoveryGovernanceV1 =
  | {
      readonly kind: 'single_owner_v1';
      readonly acknowledgedByOwnerId: string;
      readonly acknowledgedAt: string;
      readonly warningVersion: 'tenant_root_single_owner_v1';
    }
  | {
      readonly kind: 'two_person_v1';
      readonly selectedByOwnerId: string;
      readonly selectedAt: string;
    };

/** One receipt digest per Deriver. Both are required by construction. */
export type TenantRootRoleReceiptsV1 = {
  readonly deriverA: string;
  readonly deriverB: string;
};

/** Material a failed or expired operation still has to remove. */
export type TenantRootOutstandingCleanupV1 = {
  readonly roles: readonly ('deriver_a' | 'deriver_b')[];
  readonly description: string;
};

/** Exhaustive state of one operational-share rotation job. */
export type TenantRootRotationJobV1 =
  | { readonly status: 'preparing'; readonly jobId: string; readonly requestedAt: string }
  | { readonly status: 'installing'; readonly jobId: string; readonly requestedAt: string }
  | { readonly status: 'verifying'; readonly jobId: string; readonly requestedAt: string }
  | { readonly status: 'activating'; readonly jobId: string; readonly requestedAt: string }
  | {
      readonly status: 'retiring';
      readonly jobId: string;
      readonly requestedAt: string;
      readonly activatedEpoch: number;
      readonly activationReceiptDigestB64u: string;
    }
  | {
      readonly status: 'complete';
      readonly jobId: string;
      readonly requestedAt: string;
      readonly completedAt: string;
      readonly activatedEpoch: number;
      readonly activationReceiptDigestB64u: string;
      readonly retirementReceipts: TenantRootRoleReceiptsV1;
    }
  | {
      readonly status: 'failed_before_activation';
      readonly jobId: string;
      readonly requestedAt: string;
      readonly failureCode: string;
      readonly cleanupReceipts: TenantRootRoleReceiptsV1;
    }
  | {
      readonly status: 'cleanup_incomplete';
      readonly jobId: string;
      readonly requestedAt: string;
      readonly failureCode: string;
      readonly outstanding: TenantRootOutstandingCleanupV1;
    }
  | {
      readonly status: 'retirement_incomplete';
      readonly jobId: string;
      readonly requestedAt: string;
      readonly activatedEpoch: number;
      readonly activationReceiptDigestB64u: string;
      readonly outstanding: TenantRootOutstandingCleanupV1;
    };

/** Which recovery recipients have proved control of their keys. */
export type TenantRootRecipientEnrolmentV1 =
  | { readonly kind: 'neither_enrolled' }
  | { readonly kind: 'deriver_a_enrolled'; readonly deriverAFingerprintB64u: string }
  | { readonly kind: 'deriver_b_enrolled'; readonly deriverBFingerprintB64u: string };

/** One verified Deriver A and Deriver B recipient pair. */
export type TenantRootRecipientPairV1 = {
  readonly deriverAFingerprintB64u: string;
  readonly deriverBFingerprintB64u: string;
};

/** One complete service-held recovery set the tenant can download. */
export type TenantRootRecoverySetStateV1 = {
  readonly recoverySetId: string;
  readonly recipientPair: TenantRootRecipientPairV1;
  readonly createdAt: string;
  readonly rootCommitmentFingerprintB64u: string;
  readonly deriverAPackage: TenantRootDownloadEvidenceV1;
  readonly deriverBPackage: TenantRootDownloadEvidenceV1;
  readonly manifest: TenantRootDownloadEvidenceV1;
};

/** Exhaustive state of the tenant-controlled recovery backup. */
export type TenantRootRecoveryBackupV1 =
  | { readonly status: 'not_configured' }
  | {
      readonly status: 'recipients_pending';
      readonly governance: TenantRootRecoveryGovernanceV1;
      readonly enrolled: TenantRootRecipientEnrolmentV1;
    }
  | {
      readonly status: 'preparing_initial';
      readonly governance: TenantRootRecoveryGovernanceV1;
      readonly recipientPair: TenantRootRecipientPairV1;
      /** The exact set being generated; activation must produce this id. */
      readonly pendingRecoverySetId: string;
    }
  | {
      readonly status: 'ready';
      readonly governance: TenantRootRecoveryGovernanceV1;
      readonly active: TenantRootRecoverySetStateV1;
    }
  | {
      readonly status: 'replacing';
      readonly governance: TenantRootRecoveryGovernanceV1;
      readonly active: TenantRootRecoverySetStateV1;
      readonly pendingRecipientPair: TenantRootRecipientPairV1;
      /** The exact replacement set being generated; never the active id. */
      readonly pendingRecoverySetId: string;
    }
  | {
      readonly status: 'failed_initial';
      readonly governance: TenantRootRecoveryGovernanceV1;
      readonly failureCode: string;
      readonly cleanupReceipts: TenantRootRoleReceiptsV1;
    }
  | {
      readonly status: 'failed_replacement';
      readonly governance: TenantRootRecoveryGovernanceV1;
      readonly active: TenantRootRecoverySetStateV1;
      readonly failureCode: string;
      readonly cleanupReceipts: TenantRootRoleReceiptsV1;
    }
  | {
      readonly status: 'cleanup_incomplete';
      readonly governance: TenantRootRecoveryGovernanceV1;
      readonly active: TenantRootRecoverySetStateV1 | null;
      readonly outstanding: TenantRootOutstandingCleanupV1;
    }
  | {
      readonly status: 'tenant_held_external';
      readonly governance: TenantRootRecoveryGovernanceV1;
      readonly recoverySetId: string;
      readonly manifestDigestB64u: string;
    };

/** How the source deployment was left after a destination activated. */
export type TenantRootSourceCustodyDispositionV1 =
  | {
      readonly kind: 'verified_retired';
      readonly destructionReceipts: TenantRootRoleReceiptsV1;
      readonly decryptProbeReceipts: TenantRootRoleReceiptsV1;
      readonly credentialRevocationReceiptDigestB64u: string;
      readonly endpointCanaryReceiptDigestB64u: string;
      readonly recordedByUserId: string;
      readonly recordedAt: string;
    }
  | {
      readonly kind: 'unavailable_retirement_unverified';
      readonly attemptedChecks: readonly string[];
      readonly recordedByUserId: string;
      readonly recordedAt: string;
    }
  | {
      readonly kind: 'retained_as_backup';
      readonly acknowledgedByUserId: string;
      readonly incidentResponseNote: string;
      readonly recordedAt: string;
    };

/** Which role shares a restore session has installed. */
export type TenantRootRoleImportProgressV1 =
  | { readonly kind: 'neither_installed' }
  | { readonly kind: 'deriver_a_installed'; readonly deriverAReceiptDigestB64u: string }
  | { readonly kind: 'deriver_b_installed'; readonly deriverBReceiptDigestB64u: string };

/** Source recovery artifacts verified during restore and held only by the tenant. */
export type TenantRootTenantHeldExternalRecoverySetV1 = {
  readonly recoverySetId: string;
  readonly manifestDigestB64u: string;
};

/** Evidence produced before cleanup can be completed after activation. */
export type TenantRootRestoreActivationEvidenceV1 = {
  readonly rootCommitmentB64u: string;
  readonly activationReceiptB64u: string;
  readonly destinationFingerprintB64u: string;
  readonly destinationLineageId: string;
  readonly activatedEpoch: number;
  readonly activationReceiptDigestB64u: string;
  /** Proof the mandatory forward refresh produced the activated epoch. */
  readonly forwardRefreshReceiptDigestB64u: string;
  /** Proof the continuity canaries passed against the restored root. */
  readonly continuityCanaryReceiptDigestB64u: string;
  readonly sourceDisposition: TenantRootSourceCustodyDispositionV1;
  readonly tenantHeldRecoverySet: TenantRootTenantHeldExternalRecoverySetV1;
};

/** Whether bootstrap material was destroyed during activation cleanup. */
export type TenantRootRestoreBootstrapCleanupV1 =
  | {
      readonly kind: 'destroyed';
      readonly receiptDigestB64u: string;
    }
  | {
      readonly kind: 'outstanding';
      readonly outstanding: TenantRootOutstandingCleanupV1;
    };

/** Exact progress of both role-share cleanup operations. */
export type TenantRootRestoreRoleCleanupV1 =
  | {
      readonly kind: 'both_roles_incomplete';
      readonly outstanding: TenantRootOutstandingCleanupV1;
    }
  | {
      readonly kind: 'deriver_a_incomplete';
      readonly deriverBReceiptDigestB64u: string;
      readonly outstanding: TenantRootOutstandingCleanupV1;
    }
  | {
      readonly kind: 'deriver_b_incomplete';
      readonly deriverAReceiptDigestB64u: string;
      readonly outstanding: TenantRootOutstandingCleanupV1;
    }
  | {
      readonly kind: 'complete';
      readonly receipts: TenantRootRoleReceiptsV1;
    };

/** Cleanup evidence returned by activation and by cleanup-only retries. */
export type TenantRootRestoreCleanupEvidenceV1 = {
  readonly bootstrap: TenantRootRestoreBootstrapCleanupV1;
  readonly roles: TenantRootRestoreRoleCleanupV1;
};

/** Exhaustive state of one destination restore session. */
export type TenantRootRestoreSessionV1 =
  | {
      readonly status: 'awaiting_manifest';
      readonly sessionId: string;
      readonly expiresAt: string;
      readonly destinationFingerprintB64u: string;
    }
  | {
      readonly status: 'awaiting_role_imports';
      readonly sessionId: string;
      readonly expiresAt: string;
      readonly destinationFingerprintB64u: string;
      readonly recoverySetId: string;
      readonly installed: TenantRootRoleImportProgressV1;
    }
  | {
      readonly status: 'verifying';
      readonly sessionId: string;
      readonly expiresAt: string;
      readonly destinationFingerprintB64u: string;
      readonly recoverySetId: string;
      readonly installationReceipts: TenantRootRoleReceiptsV1;
    }
  | {
      readonly status: 'ready_to_activate';
      readonly sessionId: string;
      readonly expiresAt: string;
      readonly destinationFingerprintB64u: string;
      readonly recoverySetId: string;
      readonly installationReceipts: TenantRootRoleReceiptsV1;
      readonly trustLevel: TenantRootTrustLevelV1;
    }
  | {
      readonly status: 'refreshing';
      readonly sessionId: string;
      readonly expiresAt: string;
      readonly destinationFingerprintB64u: string;
      readonly recoverySetId: string;
      readonly installationReceipts: TenantRootRoleReceiptsV1;
    }
  | {
      readonly status: 'active';
      readonly rootCommitmentB64u: string;
      readonly sessionId: string;
      readonly destinationFingerprintB64u: string;
      readonly destinationLineageId: string;
      readonly activatedEpoch: number;
      readonly activationReceiptDigestB64u: string;
      /** Proof the mandatory forward refresh produced the activated epoch. */
      readonly forwardRefreshReceiptDigestB64u: string;
      /** Proof the continuity canaries passed against the restored root. */
      readonly continuityCanaryReceiptDigestB64u: string;
      readonly bootstrapDestructionReceiptDigestB64u: string;
      readonly sourceDisposition: TenantRootSourceCustodyDispositionV1;
      readonly tenantHeldRecoverySet: TenantRootTenantHeldExternalRecoverySetV1;
    }
  | {
      readonly status: 'failed_before_activation';
      readonly sessionId: string;
      readonly failureCode: string;
      readonly cleanupReceipts: TenantRootRoleReceiptsV1;
    }
  | {
      readonly status: 'cleanup_incomplete';
      readonly phase: 'pre_activation';
      readonly sessionId: string;
      readonly expiresAt: string;
      readonly destinationFingerprintB64u: string;
      readonly outstanding: TenantRootOutstandingCleanupV1;
    }
  | {
      readonly status: 'cleanup_incomplete';
      readonly phase: 'post_activation';
      readonly sessionId: string;
      readonly activationEvidence: TenantRootRestoreActivationEvidenceV1;
      readonly bootstrapCleanup: TenantRootRestoreBootstrapCleanupV1;
      readonly roleCleanup: TenantRootRestoreRoleCleanupV1;
    }
  | {
      readonly status: 'expired';
      readonly sessionId: string;
      readonly expiredAt: string;
      readonly cleanupReceipts: TenantRootRoleReceiptsV1;
    };

/**
 * Reported health of one Deriver.
 *
 * `unknown` is a real answer, not a placeholder: a deployment whose control
 * plane exposes no health read must say so rather than report `healthy`, which
 * would be a claim nothing checked.
 */
export type TenantRootDeriverHealthV1 = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

/** Operational-share health for the selected environment. */
export type TenantRootOperationalSharesV1 = {
  /** Zero when the active epoch has not been read from the control plane. */
  readonly activeEpoch: number;
  readonly rootCommitmentFingerprintB64u: string;
  readonly deriverAStatus: TenantRootDeriverHealthV1;
  readonly deriverBStatus: TenantRootDeriverHealthV1;
  readonly lastCompletedRotationAt: string | null;
  readonly nextScheduledRotationAt: string | null;
  readonly securityProfile: TenantRootDeploymentSecurityProfileV1;
  readonly job: TenantRootRotationJobV1 | null;
};

/** The complete Derivation root security page response. */
export type TenantRootSecurityStatusV1 = {
  readonly identity: TenantRootIdentityV1;
  readonly custodyLineageId: string;
  readonly lifecycleRevision: number;
  readonly operationalShares: TenantRootOperationalSharesV1;
  readonly recoveryBackup: TenantRootRecoveryBackupV1;
  readonly restore: TenantRootRestoreSessionV1 | null;
  readonly trustLevel: TenantRootTrustLevelV1;
};

/**
 * Returns true only when a rotation proved both retirement receipts.
 *
 * Compromise-healing copy is gated on this and on the deployment security
 * profile; activation alone is never sufficient.
 */
export function tenantRootRotationPermitsHealingClaimV1(
  profile: TenantRootDeploymentSecurityProfileV1,
  job: TenantRootRotationJobV1 | null,
): boolean {
  return profile === 'managed_healing_v1' && job?.status === 'complete';
}

/**
 * Returns the recovery set a tenant can download right now, if any.
 *
 * A restored `tenant_held_external` set is deliberately absent: this deployment
 * never stored those packages and cannot serve them.
 */
export function tenantRootDownloadableRecoverySetV1(
  backup: TenantRootRecoveryBackupV1,
): TenantRootRecoverySetStateV1 | null {
  switch (backup.status) {
    case 'ready':
    case 'replacing':
    case 'failed_replacement':
      return backup.active;
    case 'cleanup_incomplete':
      return backup.active;
    case 'not_configured':
    case 'recipients_pending':
    case 'preparing_initial':
    case 'failed_initial':
    case 'tenant_held_external':
      return null;
  }
}

/**
 * Returns true while an operation holds the single tenant-root operation lock.
 *
 * Downloads of an already-complete set deliberately do not take the lock.
 */
export function tenantRootOperationLockHeldV1(status: TenantRootSecurityStatusV1): boolean {
  const rotationInFlight =
    status.operationalShares.job !== null &&
    (['preparing', 'installing', 'verifying', 'activating', 'retiring'] as const).some(
      (inFlight) => inFlight === status.operationalShares.job?.status,
    );
  const backupInFlight =
    status.recoveryBackup.status === 'preparing_initial' ||
    status.recoveryBackup.status === 'replacing';
  const restoreInFlight =
    status.restore !== null &&
    (
      [
        'awaiting_manifest',
        'awaiting_role_imports',
        'verifying',
        'ready_to_activate',
        'refreshing',
      ] as const
    ).some((inFlight) => inFlight === status.restore?.status);
  return rotationInFlight || backupInFlight || restoreInFlight;
}

// Local authority activation: the installation receipt, the activation result and its final
// acknowledgement.
import {
  parseWalletAuthorityV1,
  parseWalletSignerActivationSetV1,
} from '../authorization/walletAuthority';
import { parseWalletAuthMethodRecordV2 } from '../utils/walletAuthMethodRecord';
import {
  parseLinkedDeviceWalletSessionCredentialDeliveryBindingV1,
  parseLinkedDeviceWalletSessionCredentialDeliveryV1,
} from './walletSessionCredentialDelivery';
import { parseActiveWalletSessionV1 } from './activeWalletSession';
import {
  type ActivateInstalledAuthorityResultV1,
  type ActivationRetryReasonV1,
  type LinkIntegrityFailureV1,
  type LocalAuthorityActivationFinalAckV1,
  type LocalAuthorityInstallationReceiptV1,
} from './contracts';
import { requireRecord } from '../utils/validation';
import { rejectUnknownFields } from '../utils/exactRecord';
import {
  wireLiteral,
  wireObject,
  wireUnion,
  type AllTrue,
  type ParsesExactly,
} from '../utils/wireSchema';
import {
  authorizationDeviceId,
  digest,
  keyLabeled,
  parseUnixTime,
  sessionId,
  walletAuthMethodId,
  walletAuthorityId,
  walletId,
  walletSessionAuthorizationId,
  walletSessionId,
} from './wireFields';

// The message interpolates the activation set's error object, not its message.
function parseInstalledActivationRefs(raw: unknown, label: string) {
  const result = parseWalletSignerActivationSetV1(raw);
  if (!result.ok) throw new Error(`${label} ${result.error}`);
  return result.value;
}

function localAuthorityInstallationReceiptV1() {
  return wireObject({
    kind: wireLiteral('local_authority_installation_receipt_v1'),
    authorityId: keyLabeled(walletAuthorityId),
    walletId: keyLabeled(walletId),
    authMethodId: keyLabeled(walletAuthMethodId),
    deviceId: keyLabeled(authorizationDeviceId),
    packageSetDigestB64u: keyLabeled(digest),
    installedActivationRefs: parseInstalledActivationRefs,
    installedRecordSetDigestB64u: keyLabeled(digest),
    targetFactorVerificationDigestB64u: keyLabeled(digest),
    installedAtMs: keyLabeled(parseUnixTime),
  });
}

export function parseLocalAuthorityInstallationReceiptV1(
  raw: unknown,
): LocalAuthorityInstallationReceiptV1 {
  return localAuthorityInstallationReceiptV1()(raw, 'LocalAuthorityInstallationReceiptV1');
}

function localAuthorityActivationFinalAckV1() {
  return wireObject({
    kind: wireLiteral('local_authority_activation_final_ack_v1'),
    linkSessionId: keyLabeled(sessionId),
    authorityId: keyLabeled(walletAuthorityId),
    packageSetDigestB64u: keyLabeled(digest),
    authorizationId: keyLabeled(walletSessionAuthorizationId),
    walletSessionId: keyLabeled(walletSessionId),
    credentialDigestB64u: keyLabeled(digest),
    installationReceiptDigestB64u: keyLabeled(digest),
    acknowledgedAtMs: keyLabeled(parseUnixTime),
  });
}

export function parseLocalAuthorityActivationFinalAckV1(
  raw: unknown,
): LocalAuthorityActivationFinalAckV1 {
  return localAuthorityActivationFinalAckV1()(raw, 'LocalAuthorityActivationFinalAckV1');
}

// Hand-written: a missing field reaches its parser rather than failing as missing.
export function parseActivateInstalledAuthorityResultV1(
  raw: unknown,
): ActivateInstalledAuthorityResultV1 {
  const record = requireRecord(raw, 'ActivateInstalledAuthorityResultV1');
  switch (record.kind) {
    case 'active': {
      rejectUnknownFields(
        record,
        ['kind', 'authority', 'authMethod', 'walletSession', 'deliveryBinding', 'sealedDelivery'],
        'ActivateInstalledAuthorityResultV1',
      );
      const authorityResult = parseWalletAuthorityV1(record.authority);
      if (!authorityResult.ok || authorityResult.value.state !== 'active') {
        throw new Error('ActivateInstalledAuthorityResultV1.authority must be active');
      }
      const authMethod = parseWalletAuthMethodRecordV2(record.authMethod);
      if (!authMethod || authMethod.status !== 'active') {
        throw new Error('ActivateInstalledAuthorityResultV1.authMethod must be active');
      }
      const walletSession = parseActiveWalletSessionV1(record.walletSession);
      const deliveryBinding =
        parseLinkedDeviceWalletSessionCredentialDeliveryBindingV1(record.deliveryBinding);
      const sealedDelivery = parseLinkedDeviceWalletSessionCredentialDeliveryV1(
        record.sealedDelivery,
      );
      if (
        authorityResult.value.walletId !== authMethod.walletId ||
        authorityResult.value.authorityId !== authMethod.walletAuthorityId ||
        walletSession.walletId !== authorityResult.value.walletId ||
        walletSession.authorityId !== authorityResult.value.authorityId ||
        walletSession.authMethodId !== authMethod.walletAuthMethodId ||
        walletSession.authorityDigestB64u !== authorityResult.value.authorityDigestB64u ||
        walletSession.authorityRevocationEpoch !== authorityResult.value.revocationEpoch ||
        deliveryBinding.namespace !== sealedDelivery.aad.namespace ||
        deliveryBinding.orgId !== sealedDelivery.aad.orgId ||
        deliveryBinding.projectId !== sealedDelivery.aad.projectId ||
        deliveryBinding.envId !== sealedDelivery.aad.envId ||
        deliveryBinding.tenantId !== sealedDelivery.aad.tenantId ||
        deliveryBinding.principalId !== sealedDelivery.aad.principalId ||
        sealedDelivery.aad.walletId !== walletSession.walletId ||
        sealedDelivery.aad.authorityId !== walletSession.authorityId ||
        sealedDelivery.aad.walletAuthMethodId !== walletSession.authMethodId ||
        sealedDelivery.aad.authorizationId !== walletSession.authorizationId ||
        sealedDelivery.aad.quotaId !== walletSession.quotaId ||
        sealedDelivery.aad.issuedAtMs !== walletSession.issuedAtMs ||
        sealedDelivery.aad.expiresAtMs !== walletSession.expiresAtMs
      ) {
        throw new Error('ActivateInstalledAuthorityResultV1 identities do not match');
      }
      return {
        kind: 'active',
        authority: authorityResult.value,
        authMethod,
        walletSession,
        deliveryBinding,
        sealedDelivery,
      };
    }
    case 'pending_local_install':
      rejectUnknownFields(
        record,
        ['kind', 'authorityId', 'reason'],
        'ActivateInstalledAuthorityResultV1',
      );
      return {
        kind: 'pending_local_install',
        authorityId: walletAuthorityId(record.authorityId, 'authorityId'),
        reason: activationRetryReasonV1()(record.reason, 'ActivationRetryReasonV1'),
      };
    case 'integrity_error':
      rejectUnknownFields(record, ['kind', 'reason'], 'ActivateInstalledAuthorityResultV1');
      return {
        kind: 'integrity_error',
        reason: parseLinkIntegrityFailureV1(record.reason),
      };
    default:
      throw new Error('ActivateInstalledAuthorityResultV1.kind is invalid');
  }
}

function activationRetryReasonV1() {
  return wireUnion('kind', [
    wireObject({ kind: wireLiteral('installation_receipt_not_found') }),
    wireObject({ kind: wireLiteral('server_worker_activation_pending') }),
    wireObject({ kind: wireLiteral('wallet_session_issuance_pending') }),
  ]);
}

// Hand-written: a missing field reaches its parser rather than failing as missing.
function parseLinkIntegrityFailureV1(raw: unknown): LinkIntegrityFailureV1 {
  const record = requireRecord(raw, 'LinkIntegrityFailureV1');
  switch (record.kind) {
    case 'authority_id_mismatch':
      rejectUnknownFields(
        record,
        ['kind', 'expectedAuthorityId', 'actualAuthorityId'],
        'LinkIntegrityFailureV1',
      );
      return {
        kind: 'authority_id_mismatch',
        expectedAuthorityId: walletAuthorityId(record.expectedAuthorityId, 'expectedAuthorityId'),
        actualAuthorityId: walletAuthorityId(record.actualAuthorityId, 'actualAuthorityId'),
      };
    case 'package_set_digest_mismatch':
      rejectUnknownFields(
        record,
        ['kind', 'expectedPackageSetDigestB64u', 'actualPackageSetDigestB64u'],
        'LinkIntegrityFailureV1',
      );
      return {
        kind: 'package_set_digest_mismatch',
        expectedPackageSetDigestB64u: digest(
          record.expectedPackageSetDigestB64u,
          'expectedPackageSetDigestB64u',
        ),
        actualPackageSetDigestB64u: digest(
          record.actualPackageSetDigestB64u,
          'actualPackageSetDigestB64u',
        ),
      };
    case 'installation_receipt_mismatch':
      rejectUnknownFields(record, ['kind', 'field'], 'LinkIntegrityFailureV1');
      if (
        record.field !== 'walletId' &&
        record.field !== 'authMethodId' &&
        record.field !== 'deviceId' &&
        record.field !== 'targetFactorVerificationDigestB64u' &&
        record.field !== 'installedActivationRefs'
      ) {
        throw new Error('LinkIntegrityFailureV1.field is invalid');
      }
      return { kind: 'installation_receipt_mismatch', field: record.field };
    default:
      throw new Error('LinkIntegrityFailureV1.kind is invalid');
  }
}

// Each schema parses exactly its declared wire type. Ambient, so it costs nothing.
declare const schemasParseTheirDeclaredTypes: AllTrue<
  [
    ParsesExactly<typeof localAuthorityInstallationReceiptV1, LocalAuthorityInstallationReceiptV1>,
    ParsesExactly<typeof localAuthorityActivationFinalAckV1, LocalAuthorityActivationFinalAckV1>,
    ParsesExactly<typeof activationRetryReasonV1, ActivationRetryReasonV1>,
  ]
>;

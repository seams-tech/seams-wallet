import type { ActiveWalletSessionV1, WalletCapabilitySubjectV1 } from './contracts';
import { mpcMaterialActivationRefsEqual } from '../utils/domainIds';

export function activeWalletSessionV1RecordsEqual(
  left: ActiveWalletSessionV1,
  right: ActiveWalletSessionV1,
): boolean {
  if (
    left.kind !== right.kind ||
    left.walletId !== right.walletId ||
    left.authorityId !== right.authorityId ||
    left.authMethodId !== right.authMethodId ||
    left.authorizationId !== right.authorizationId ||
    left.quotaId !== right.quotaId ||
    left.authorityDigestB64u !== right.authorityDigestB64u ||
    left.authorityRevocationEpoch !== right.authorityRevocationEpoch ||
    left.issuedAtMs !== right.issuedAtMs ||
    left.expiresAtMs !== right.expiresAtMs ||
    left.capabilitySubjects.length !== right.capabilitySubjects.length
  ) {
    return false;
  }
  for (let index = 0; index < left.capabilitySubjects.length; index += 1) {
    const leftSubject = left.capabilitySubjects[index];
    const rightSubject = right.capabilitySubjects[index];
    if (
      !leftSubject ||
      !rightSubject ||
      !walletCapabilitySubjectsEqual(leftSubject, rightSubject)
    ) {
      return false;
    }
  }
  return true;
}

export function walletCapabilitySubjectsEqual(
  left: WalletCapabilitySubjectV1,
  right: WalletCapabilitySubjectV1,
): boolean {
  switch (left.kind) {
    case 'link_devices':
    case 'revoke_devices':
      return right.kind === left.kind;
    case 'sign':
    case 'export_keys':
      return (
        right.kind === left.kind &&
        right.keyFamily === left.keyFamily &&
        mpcMaterialActivationRefsEqual(left.materialActivation, right.materialActivation)
      );
    default:
      left satisfies never;
      return false;
  }
}

export function walletSessionPreservesCapabilities(
  previous: ActiveWalletSessionV1,
  next: ActiveWalletSessionV1,
): boolean {
  for (const subject of previous.capabilitySubjects) {
    let retained = false;
    for (const candidate of next.capabilitySubjects) {
      if (walletCapabilitySubjectsEqual(subject, candidate)) {
        retained = true;
        break;
      }
    }
    if (!retained) return false;
  }
  return true;
}

import type {
  ActiveWalletSessionV1,
  WalletCapabilitySubjectV1,
  WalletSessionOperationCredentialV1,
} from './contracts';
import { mpcMaterialActivationRefsEqual } from '../utils/domainIds';
import { requireRecord } from '../utils/validation';
import { rejectUnknownFields } from '../utils/exactRecord';
import { wireLiteral, wireObject, type AllTrue, type ParsesExactly } from '../utils/wireSchema';
import {
  digest,
  keyLabeled,
  materialActivation,
  parseNonNegativeSafeInteger,
  parseUnixTime,
  quotaId,
  walletAuthMethodId,
  walletAuthorityId,
  walletId,
  walletSessionAuthorizationId,
  walletSessionId,
} from './wireFields';

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

function walletCapabilitySubjectsEqual(
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

function walletSessionOperationCredentialV1() {
  return wireObject(
    {
      kind: wireLiteral('opaque_wallet_session_operation_credential_v1'),
      token: (raw, label): string => {
        if (typeof raw !== 'string' || raw.length > 8192) throw new Error(`${label} is invalid`);
        return raw;
      },
      walletSessionId: keyLabeled(walletSessionId),
    },
    (credential, label) => {
      if (!/^wst_[A-Za-z0-9_-]{43}$/.test(credential.token)) {
        throw new Error(`${label} opaque token is invalid`);
      }
    },
  );
}

export function parseWalletSessionOperationCredentialV1(
  raw: unknown,
): WalletSessionOperationCredentialV1 {
  return walletSessionOperationCredentialV1()(raw, 'WalletSessionOperationCredentialV1');
}

function capabilitySubjectKey(subject: WalletCapabilitySubjectV1): string {
  return subject.kind === 'sign' || subject.kind === 'export_keys'
    ? `${subject.kind}:${subject.keyFamily}:${subject.materialActivation.activationId}`
    : subject.kind;
}

function activeWalletSessionV1() {
  return wireObject(
    {
      kind: wireLiteral('active_wallet_session_v1'),
      walletId: keyLabeled(walletId),
      authorityId: keyLabeled(walletAuthorityId),
      authMethodId: keyLabeled(walletAuthMethodId),
      authorizationId: keyLabeled(walletSessionAuthorizationId),
      quotaId: keyLabeled(quotaId),
      authorityDigestB64u: keyLabeled(digest),
      authorityRevocationEpoch: keyLabeled(parseNonNegativeSafeInteger),
      capabilitySubjects: (
        raw,
        label,
      ): [WalletCapabilitySubjectV1, ...WalletCapabilitySubjectV1[]] => {
        if (!Array.isArray(raw) || raw.length === 0) throw new Error(`${label} must be non-empty`);
        const subjects: WalletCapabilitySubjectV1[] = [];
        for (const [index, subject] of raw.entries()) {
          subjects.push(parseWalletCapabilitySubjectV1(subject, `capabilitySubjects[${index}]`));
        }
        const first = subjects[0];
        if (!first) throw new Error(`${label} must be non-empty`);
        return [first, ...subjects.slice(1)];
      },
      issuedAtMs: keyLabeled(parseUnixTime),
      expiresAtMs: keyLabeled(parseUnixTime),
    },
    (session, label) => {
      const keys = session.capabilitySubjects.map(capabilitySubjectKey);
      if (new Set(keys).size !== keys.length) {
        throw new Error(`${label} capability subjects repeat`);
      }
    },
  );
}

export function parseActiveWalletSessionV1(raw: unknown): ActiveWalletSessionV1 {
  return activeWalletSessionV1()(raw, 'ActiveWalletSessionV1');
}

// Hand-written: a missing field reaches its parser rather than failing as missing.
function parseWalletCapabilitySubjectV1(raw: unknown, label: string): WalletCapabilitySubjectV1 {
  const record = requireRecord(raw, label);
  if (record.kind === 'link_devices' || record.kind === 'revoke_devices') {
    rejectUnknownFields(record, ['kind'], label);
    return { kind: record.kind };
  }
  if (record.kind !== 'sign' && record.kind !== 'export_keys') {
    throw new Error(`${label}.kind is invalid`);
  }
  rejectUnknownFields(record, ['kind', 'keyFamily', 'materialActivation'], label);
  if (record.keyFamily !== 'ed25519' && record.keyFamily !== 'ecdsa_secp256k1') {
    throw new Error(`${label}.keyFamily is invalid`);
  }
  return {
    kind: record.kind,
    keyFamily: record.keyFamily,
    materialActivation: materialActivation(
      record.materialActivation,
      `${label}.materialActivation`,
    ),
  };
}

// Each schema parses exactly its declared wire type. Ambient, so it costs nothing.
declare const schemasParseTheirDeclaredTypes: AllTrue<
  [
    ParsesExactly<typeof walletSessionOperationCredentialV1, WalletSessionOperationCredentialV1>,
    ParsesExactly<typeof activeWalletSessionV1, ActiveWalletSessionV1>,
  ]
>;

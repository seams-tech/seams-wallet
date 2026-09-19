import { parseRootShareEpoch, type RootShareEpoch } from '@shared/utils/domainIds';

export const FIXED_ECDSA_PRESIGN_PROTOCOL_ID =
  'seams/router-ab-ecdsa-presign/fixed-2of2/v1' as const;

export type EcdsaClientPresignPoolIdentity = {
  readonly relayerUrl: string;
  readonly materialActivationB64u: string;
  readonly materialActivationId: string;
  readonly capability: string;
  readonly keyBinding: string;
  readonly walletId: string;
  readonly signingScopeB64u: string;
  readonly pairRole: 'client';
  readonly keyEpoch: string;
  readonly activationEpoch: RootShareEpoch;
  readonly protocolId: typeof FIXED_ECDSA_PRESIGN_PROTOCOL_ID;
};

function requireIdentityString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is required`);
  if (value.trim() !== value) throw new Error(`${label} must be canonical`);
  return value;
}

export function parseEcdsaClientPresignPoolIdentity(
  value: unknown,
): EcdsaClientPresignPoolIdentity {
  if (typeof value !== 'object' || value === null) {
    throw new Error('poolIdentity is required');
  }
  const raw = value as Record<string, unknown>;
  if (raw.pairRole !== 'client') throw new Error('poolIdentity.pairRole must be client');
  if (raw.protocolId !== FIXED_ECDSA_PRESIGN_PROTOCOL_ID) {
    throw new Error('poolIdentity.protocolId is unsupported');
  }
  const relayerUrl = requireIdentityString(raw.relayerUrl, 'poolIdentity.relayerUrl');
  if (relayerUrl.replace(/\/+$/g, '') !== relayerUrl) {
    throw new Error('poolIdentity.relayerUrl must be canonical');
  }
  return {
    relayerUrl,
    materialActivationB64u: requireIdentityString(
      raw.materialActivationB64u,
      'poolIdentity.materialActivationB64u',
    ),
    materialActivationId: requireIdentityString(
      raw.materialActivationId,
      'poolIdentity.materialActivationId',
    ),
    capability: requireIdentityString(raw.capability, 'poolIdentity.capability'),
    keyBinding: requireIdentityString(raw.keyBinding, 'poolIdentity.keyBinding'),
    walletId: requireIdentityString(raw.walletId, 'poolIdentity.walletId'),
    signingScopeB64u: requireIdentityString(raw.signingScopeB64u, 'poolIdentity.signingScopeB64u'),
    pairRole: 'client',
    keyEpoch: requireIdentityString(raw.keyEpoch, 'poolIdentity.keyEpoch'),
    activationEpoch: requirePoolRootShareEpoch(raw.activationEpoch),
    protocolId: FIXED_ECDSA_PRESIGN_PROTOCOL_ID,
  };
}

function requirePoolRootShareEpoch(value: unknown): RootShareEpoch {
  const parsed = parseRootShareEpoch(value);
  if (!parsed.ok) throw new Error('poolIdentity.activationEpoch is invalid');
  return parsed.value;
}

export function equalEcdsaClientPresignPoolIdentity(
  left: EcdsaClientPresignPoolIdentity,
  right: EcdsaClientPresignPoolIdentity,
): boolean {
  return (
    left.relayerUrl === right.relayerUrl &&
    left.materialActivationB64u === right.materialActivationB64u &&
    left.materialActivationId === right.materialActivationId &&
    left.capability === right.capability &&
    left.keyBinding === right.keyBinding &&
    left.walletId === right.walletId &&
    left.signingScopeB64u === right.signingScopeB64u &&
    left.pairRole === right.pairRole &&
    left.keyEpoch === right.keyEpoch &&
    left.activationEpoch === right.activationEpoch &&
    left.protocolId === right.protocolId
  );
}

export function ecdsaClientPresignPoolKey(identity: EcdsaClientPresignPoolIdentity): string {
  return [
    identity.protocolId,
    identity.relayerUrl,
    identity.signingScopeB64u,
    identity.materialActivationB64u,
  ].join('|');
}

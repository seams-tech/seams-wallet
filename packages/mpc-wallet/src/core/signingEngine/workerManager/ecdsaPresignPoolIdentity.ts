import { base64UrlEncode } from '@shared/utils/base64';
import {
  parseRouterAbEcdsaDerivationNormalSigningScopeV1,
  routerAbEcdsaDerivationNormalSigningScopeCanonicalBytesV1,
  type RouterAbEcdsaDerivationNormalSigningScopeV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import {
  canonicalRouterAbMpcMaterialActivationRefBytes,
  type RouterAbMpcMaterialActivationRefWire,
} from '@shared/utils/routerAbNormalSigningIdentity';
import { parseRootShareEpoch, type RootShareEpoch } from '@shared/utils/domainIds';

export const FIXED_ECDSA_PRESIGN_PROTOCOL_ID =
  'seams/router-ab-ecdsa-presign/fixed-2of2/v1' as const;

export type EcdsaClientPresignPoolIdentity = {
  readonly ownershipGeneration: number;
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
  if (!Number.isSafeInteger(raw.ownershipGeneration) || Number(raw.ownershipGeneration) < 1) {
    throw new Error('poolIdentity.ownershipGeneration must be a positive safe integer');
  }
  if (raw.pairRole !== 'client') throw new Error('poolIdentity.pairRole must be client');
  if (raw.protocolId !== FIXED_ECDSA_PRESIGN_PROTOCOL_ID) {
    throw new Error('poolIdentity.protocolId is unsupported');
  }
  const relayerUrl = requireIdentityString(raw.relayerUrl, 'poolIdentity.relayerUrl');
  if (relayerUrl.replace(/\/+$/g, '') !== relayerUrl) {
    throw new Error('poolIdentity.relayerUrl must be canonical');
  }
  return {
    ownershipGeneration: Number(raw.ownershipGeneration),
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
    left.ownershipGeneration === right.ownershipGeneration &&
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
    identity.ownershipGeneration,
  ].join('|');
}

export function makeClientPresignPoolIdentity(args: {
  ownershipGeneration: number;
  relayerUrl: string;
  scope: RouterAbEcdsaDerivationNormalSigningScopeV1;
  materialActivation: RouterAbMpcMaterialActivationRefWire;
}): EcdsaClientPresignPoolIdentity {
  const parsedScope = parseRouterAbEcdsaDerivationNormalSigningScopeV1(args.scope);
  const materialActivation = args.materialActivation;
  const relayerUrl = String(args.relayerUrl || '')
    .trim()
    .replace(/\/+$/g, '');
  return {
    ownershipGeneration: args.ownershipGeneration,
    relayerUrl,
    materialActivationB64u: base64UrlEncode(
      canonicalRouterAbMpcMaterialActivationRefBytes(materialActivation),
    ),
    materialActivationId: materialActivation.activation_id,
    capability: materialActivation.capability,
    keyBinding: materialActivation.key_binding,
    walletId: parsedScope.wallet_id,
    signingScopeB64u: base64UrlEncode(
      routerAbEcdsaDerivationNormalSigningScopeCanonicalBytesV1(parsedScope),
    ),
    pairRole: 'client',
    keyEpoch: parsedScope.signing_worker.key_epoch,
    activationEpoch: parsedScope.activation_epoch,
    protocolId: FIXED_ECDSA_PRESIGN_PROTOCOL_ID,
  };
}

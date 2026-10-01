import type { EcdsaAdditiveLaneHolderPreparationV1 } from '@shared/signing-lanes/rotation';
import {
  parseEcdsaAdditiveLaneHolderRoundV1,
  parseLaneHolderPackageWireV1,
} from '@shared/signing-lanes/rotationProtocolParsers';

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

export function parseEcdsaAdditiveLaneHolderPreparationV1(
  value: unknown,
): EcdsaAdditiveLaneHolderPreparationV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ECDSA holder preparation must be an object');
  }
  const allowed = new Set(['kind', 'holderRound', 'holderPackage', 'encryptedDeltaPackageJson']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`ECDSA holder preparation.${key} is not allowed`);
  }
  const kind = Reflect.get(value, 'kind');
  if (kind !== 'ecdsa_additive_lane_holder_preparation_v1') {
    throw new Error('ECDSA holder preparation kind is invalid');
  }
  const holderPackage = parseLaneHolderPackageWireV1(Reflect.get(value, 'holderPackage'));
  if (holderPackage.kind !== 'ecdsa_additive_lane_holder_package_v1') {
    throw new Error('ECDSA holder preparation returned the wrong package family');
  }
  return {
    kind,
    holderRound: parseEcdsaAdditiveLaneHolderRoundV1(Reflect.get(value, 'holderRound')),
    holderPackage,
    encryptedDeltaPackageJson: nonEmpty(
      Reflect.get(value, 'encryptedDeltaPackageJson'),
      'encryptedDeltaPackageJson',
    ),
  };
}

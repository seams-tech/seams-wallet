import {
  buildMpcMaterialActivationRef,
  parseCapabilityInstanceRef,
  parseMpcKeyBindingRef,
  parseMpcLifecycleBindingRef,
  parseMpcMaterialActivationId,
  parseMpcMaterialOwnerRef,
  parseMpcSigningWorkerRef,
  type DomainIdParseResult,
  type MpcMaterialActivationRef,
} from '@shared/utils/domainIds';

function unwrapDomainId<T>(result: DomainIdParseResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function buildMpcMaterialActivationRefFixture(
  label: string,
  materialOwner?: string,
  signingWorker?: string,
  keyBinding?: string,
): MpcMaterialActivationRef {
  return buildMpcMaterialActivationRef({
    activationId: unwrapDomainId(parseMpcMaterialActivationId(`activation:${label}`)),
    capability: unwrapDomainId(parseCapabilityInstanceRef(`capability:${label}`)),
    materialOwner: unwrapDomainId(parseMpcMaterialOwnerRef(materialOwner ?? `owner:${label}`)),
    keyBinding: unwrapDomainId(parseMpcKeyBindingRef(keyBinding ?? `key:${label}`)),
    lifecycleBinding: unwrapDomainId(parseMpcLifecycleBindingRef(`lifecycle:${label}`)),
    signingWorker: unwrapDomainId(parseMpcSigningWorkerRef(signingWorker ?? `worker:${label}`)),
  });
}

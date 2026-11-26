import type { EvmSigningRequest } from '@/core/signingEngine/chains/evm/evmSigning.types';
import type { TempoSigningRequest } from '@/core/signingEngine/chains/tempo/tempoSigning.types';

export function requiredEvmFamilyRequestSignatureUses(
  request: EvmSigningRequest | TempoSigningRequest,
): number {
  switch (request.kind) {
    case 'eip1559':
    case 'tempoTransaction':
      return 1;
    default: {
      const unreachable: never = request;
      return unreachable;
    }
  }
}


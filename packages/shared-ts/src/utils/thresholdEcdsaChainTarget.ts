// The chain a threshold ECDSA key signs for, in its own small module so that importing the shapes
// or the key does not pull in a larger one.

export type EvmEip155ChainTarget = {
  kind: 'evm';
  namespace: 'eip155';
  chainId: number;
  networkSlug: string;
};

export type TempoChainTarget = {
  kind: 'tempo';
  chainId: number;
  networkSlug: string;
};

export type ThresholdEcdsaChainTarget = EvmEip155ChainTarget | TempoChainTarget;

/** A chain target as requests carry it: the network slug may still be unresolved. */
export type ThresholdEcdsaChainTargetWire =
  | {
      kind: 'evm';
      namespace: 'eip155';
      chainId: number;
      networkSlug?: string;
    }
  | {
      kind: 'tempo';
      chainId: number;
      networkSlug?: string;
    };

// Equal keys name the same chain; the network slug is not part of the key.
export function thresholdEcdsaChainTargetKey(target: ThresholdEcdsaChainTargetWire): string {
  if (target.kind === 'evm') return `evm:eip155:${target.chainId}`;
  return `tempo:${target.chainId}`;
}

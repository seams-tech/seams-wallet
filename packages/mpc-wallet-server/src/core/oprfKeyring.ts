import { evaluateOprf, oprfPublicKey } from './oprfWasm';
import { deriveSealRootBytes } from './sealRootKey';

/**
 * The server keys of one RFC 9497 POPRF purpose. Each key version has its own
 * key: its seed is derived from the seal root under the purpose's context and
 * the version. A version outside the accepted list is refused.
 */
export type OprfKeyring = {
  readonly currentKeyVersion: string;
  readonly publicKey: (keyVersion: string) => Promise<Uint8Array>;
  readonly evaluate: (input: {
    readonly keyVersion: string;
    readonly blindedElement: Uint8Array;
    readonly info: Uint8Array;
  }) => Promise<{ readonly evaluatedElement: Uint8Array; readonly proof: Uint8Array }>;
};

export class UnknownOprfKeyVersionError extends Error {}

export function createOprfKeyring(input: {
  readonly label: string;
  readonly rootSecretB64u: string;
  readonly seedContext: readonly string[];
  readonly keyInfo: Uint8Array;
  readonly currentKeyVersion: string;
  readonly acceptedKeyVersions: readonly string[];
}): OprfKeyring {
  const accepted = new Set(input.acceptedKeyVersions);
  if (!accepted.has(input.currentKeyVersion)) {
    throw new Error(`The accepted ${input.label} key versions must include the current version`);
  }
  const withSeed = async <T>(keyVersion: string, use: (seed32: Uint8Array) => Promise<T>) => {
    if (!accepted.has(keyVersion)) {
      throw new UnknownOprfKeyVersionError(`Unknown ${input.label} key version "${keyVersion}"`);
    }
    const seed32 = await deriveSealRootBytes(input.rootSecretB64u, [
      ...input.seedContext,
      keyVersion,
    ]);
    try {
      return await use(seed32);
    } finally {
      seed32.fill(0);
    }
  };
  return {
    currentKeyVersion: input.currentKeyVersion,
    publicKey: (keyVersion) =>
      withSeed(keyVersion, (seed32) => oprfPublicKey({ seed32, keyInfo: input.keyInfo })),
    evaluate: ({ keyVersion, blindedElement, info }) =>
      withSeed(keyVersion, (seed32) =>
        evaluateOprf({ seed32, keyInfo: input.keyInfo, blindedElement, info }),
      ),
  };
}

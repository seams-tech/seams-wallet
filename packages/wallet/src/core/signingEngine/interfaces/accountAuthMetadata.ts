import { type SignerAuthMethod } from '@shared/utils/signerDomain';

export type AccountAuthMetadata = {
  primaryAuthMethod: SignerAuthMethod;
  linkedAuthMethods: SignerAuthMethod[];
  email?: string;
  passkeyCredentialIds?: string[];
};

export function resolveAccountAuthMetadataForSignerAuthMethod(args: {
  authMethod: SignerAuthMethod;
  email?: string;
  passkeyCredentialIds?: string[];
}): AccountAuthMetadata {
  const primaryAuthMethod = args.authMethod;
  return {
    primaryAuthMethod,
    linkedAuthMethods: [primaryAuthMethod],
    ...(args.email ? { email: args.email } : {}),
    ...(args.passkeyCredentialIds?.length
      ? { passkeyCredentialIds: args.passkeyCredentialIds }
      : {}),
  };
}

export interface PasskeyCredentialClaims {
  claim(input: {
    readonly walletId: string;
    readonly rpId: string;
    readonly credentialIdB64u: string;
  }): Promise<boolean>;
}

export async function reservePasskeyCredential(
  claims: PasskeyCredentialClaims | undefined,
  input: Parameters<PasskeyCredentialClaims['claim']>[0],
): Promise<void> {
  if (claims && !(await claims.claim(input))) {
    throw new Error('Passkey credential belongs to another wallet or home');
  }
}

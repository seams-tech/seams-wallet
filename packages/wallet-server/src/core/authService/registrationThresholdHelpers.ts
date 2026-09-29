import { ActionType, type ActionArgsWasm } from '@shared/near/actions';
import { ensureEd25519Prefix, toOptionalTrimmedString } from '@shared/utils/validation';

export function buildFullAccessAddKeyAction(publicKey: string): ActionArgsWasm {
  return {
    action_type: ActionType.AddKey,
    public_key: publicKey,
    access_key: JSON.stringify({
      nonce: 0,
      permission: { FullAccess: {} },
    }),
  };
}

export function normalizeBootstrapPublicKeys(args: {
  publicKey: string;
  recoveryPublicKey?: string;
}): {
  publicKey: string;
  recoveryPublicKey?: string;
  expectedPublicKeys: string[];
} {
  const publicKey = ensureEd25519Prefix(toOptionalTrimmedString(args.publicKey) || '');
  if (!publicKey) {
    throw new Error('Missing or invalid bootstrap operational public key');
  }
  const recoveryPublicKey = ensureEd25519Prefix(
    toOptionalTrimmedString(args.recoveryPublicKey) || '',
  );
  if (recoveryPublicKey && recoveryPublicKey === publicKey) {
    throw new Error('Bootstrap recovery public key must differ from the operational public key');
  }
  return {
    publicKey,
    ...(recoveryPublicKey ? { recoveryPublicKey } : {}),
    expectedPublicKeys: recoveryPublicKey ? [publicKey, recoveryPublicKey] : [publicKey],
  };
}


/**
 * The internal contract for same-device auth-method addition.
 *
 * One product action ("Add authentication method") has exactly two branches:
 * a Passkey-only authority adds Email OTP, or an Email-OTP-only authority adds
 * a Passkey. Both fill the missing factor family on an authority that already
 * exists; neither creates an authority, signer activation, share, public key,
 * export root, or key manifest.
 *
 * Same-family addition is not expressible here. There is no branch for it, so
 * an attempt to add a family the authority already has is resolved as
 * `already_configured` at admission — before any target verification or local
 * write — rather than travelling through the operation as a rejected case.
 */

import { type WalletAuthMethodId } from './domainIds';
import type {
  ActiveWalletAuthMethodRecordV2,
  WalletAuthMethodRecordV2,
} from './walletAuthMethodRecord';
import type { WalletAuthMethod } from './signerDomain';

/**
 * The factor family a method belongs to.
 *
 * This is the repo's existing `WalletAuthMethod`, not a new type: a
 * hand-written `'passkey' | 'email_otp'` would be a second, unversioned
 * declaration of the same domain fact, which is what the auth-method domain
 * guard fails on. The alias exists only to name the role the value plays in an
 * addition — which family a branch fills in — and the assertion below keeps it
 * from drifting from the canonical record's own discriminant.
 */
export type WalletAuthMethodFamilyV1 = WalletAuthMethod;

type FamilyMatchesRecordKind = WalletAuthMethodRecordV2['kind'] extends WalletAuthMethodFamilyV1
  ? WalletAuthMethodFamilyV1 extends WalletAuthMethodRecordV2['kind']
    ? true
    : never
  : never;
const familyMatchesRecordKind: FamilyMatchesRecordKind = true;
void familyMatchesRecordKind;

/**
 * The two exhaustive branches. The name reads source-to-target, which is the
 * order every stage of the operation uses: resolve the source, then verify the
 * target.
 */
export type AddWalletAuthMethodBranchV1 = 'passkey_to_email_otp' | 'email_otp_to_passkey';

/**
 * Admission: what the operation does before it verifies anything.
 *
 * `already_configured` is a first-class outcome rather than a failure, because
 * a user whose wallet already has both families asked for a state that already
 * holds. Resolving it here is what keeps the promise that a present family
 * never reaches target verification or a local write.
 */
type AddWalletAuthMethodAdmissionV1 =
  | { readonly kind: 'proceed'; readonly branch: AddWalletAuthMethodBranchV1 }
  | {
      readonly kind: 'already_configured';
      readonly family: WalletAuthMethodFamilyV1;
      readonly existingWalletAuthMethodId: WalletAuthMethodId;
    };

function unreachableAuthMethodFamily(value: never): never {
  throw new Error(`Unhandled wallet auth-method family: ${String(value)}`);
}

/**
 * Resolves the branch from the exact active inventory of one authority.
 *
 * The selected session's method decides the source, and the requested target
 * family decides the rest. Both same-family cases — the target family is the
 * source's own, or a sibling already holds it — land on `already_configured`,
 * which is why the operation needs no same-family rejection of its own.
 */
export function admitAddWalletAuthMethod(input: {
  readonly sourceMethod: ActiveWalletAuthMethodRecordV2;
  readonly targetFamily: WalletAuthMethodFamilyV1;
  readonly activeMethodsOnAuthority: readonly ActiveWalletAuthMethodRecordV2[];
}): AddWalletAuthMethodAdmissionV1 {
  const present = input.activeMethodsOnAuthority.find(
    (method) => method.kind === input.targetFamily,
  );
  if (present) {
    return {
      kind: 'already_configured',
      family: input.targetFamily,
      existingWalletAuthMethodId: present.walletAuthMethodId,
    };
  }
  switch (input.sourceMethod.kind) {
    case 'passkey':
      return { kind: 'proceed', branch: 'passkey_to_email_otp' };
    case 'email_otp':
      return { kind: 'proceed', branch: 'email_otp_to_passkey' };
    default:
      return unreachableAuthMethodFamily(input.sourceMethod);
  }
}

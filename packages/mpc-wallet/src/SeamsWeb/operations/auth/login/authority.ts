import type { WalletAuthMethod } from '@/core/types/seams';
import type { WebAuthnAuthenticationCredential } from '@/core/types';
import type {
  ActiveWalletAuthorityV1,
  WalletAuthorityV1,
} from '@shared/authorization/walletAuthority';
import type { ActiveWalletSessionV1, WalletCapabilitySubjectV1 } from '@shared/device-linking';
import {
  mpcMaterialActivationRefsEqual,
  parseWalletId,
  type MpcMaterialActivationRef,
} from '@shared/utils/domainIds';
import {
  parseEmailOtpWalletAuthAuthority,
  parseWalletAuthAuthorityRef,
  walletAuthAuthorityRef,
  type EmailOtpWalletAuthAuthority,
  type EmailOtpProvider,
  type PasskeyWalletAuthAuthority,
  type WalletAuthAuthority,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import type {
  ActiveEmailOtpWalletAuthMethodRecordV2,
  ActivePasskeyWalletAuthMethodRecordV2,
  ActiveWalletAuthMethodRecordV2,
  WalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
import { IndexedDBManager } from '@/core/indexedDB';
import {
  IndexedDbEd25519YaoPublicCapabilityReferenceStore,
  type Ed25519YaoPublicCapabilityLaneReferenceV1,
} from '@/core/signingEngine/threshold/ed25519/yaoPublicCapabilityReferences';
import type {
  LocalWalletAuthMethodRecordV2,
  WalletAuthorityExportRootRecordV1,
  WalletAuthoritySignerMaterialRecordV1,
  WalletSelectionRecordV1,
} from '@/core/indexedDB/passkeyClientDB.types';
import {
  openWalletAuthorityLinkedSignerMaterialV1,
  type OpenWalletAuthorityLinkedSignerMaterialResultV1,
} from '@/core/indexedDB/linkedAuthoritySignerMaterial';
import { parseSignerSlot } from '@/core/signingEngine/webauthnAuth/device/signerSlot';
import { type WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { SIGNER_AUTH_METHODS } from '@shared/utils/signerDomain';
import {
  buildEmailOtpWalletAuthMethodBinding,
  buildVoiceIdWalletAuthMethodBinding,
  buildPasskeyAuthScope,
  buildPasskeyWalletAuthMethodBinding,
  buildWalletIdentity,
  parseRpId,
  type WalletAuthMethodBinding,
} from '@shared/utils/walletCapabilityBindings';
import { passkeyPrfFirstB64uFromCredential } from '@/SeamsWeb/operations/authMethods/passkey/ecdsaBootstrap';
import { base64UrlDecode } from '@shared/utils/base64';
import { type WalletUnlockSubject, type WalletUnlockSubjectSet } from '../walletUnlockSubject';
import { assertNeverLoginState } from './identity';

function walletAuthMethodBindingFromRecord(
  record: LocalWalletAuthMethodRecordV2,
): WalletAuthMethodBinding | null {
  const wallet = buildWalletIdentity({ walletId: record.walletId });
  switch (record.kind) {
    case 'passkey': {
      const rpId = parseRpId(record.rpId);
      if (!rpId.ok) return null;
      return buildPasskeyWalletAuthMethodBinding({
        walletAuthMethodId: record.walletAuthMethodId,
        scope: buildPasskeyAuthScope({ wallet, rpId: rpId.value }),
        credentialIdB64u: record.credentialIdB64u,
      });
    }
    case 'email_otp':
      return buildEmailOtpWalletAuthMethodBinding({
        walletAuthMethodId: record.walletAuthMethodId,
        wallet,
        emailHashHex: record.emailHashHex,
        registrationAuthorityId: record.registrationAuthorityId,
      });
    case 'voiceid':
      return buildVoiceIdWalletAuthMethodBinding({
        walletAuthMethodId: record.walletAuthMethodId,
        wallet,
        deviceKeyId: record.deviceKeyId,
      });
    default:
      record satisfies never;
      return null;
  }
}

function walletAuthAuthorityForSelectedPasskeyMethod(
  record: ActivePasskeyWalletAuthMethodRecordV2,
): PasskeyWalletAuthAuthority {
  return {
    walletId: record.walletId,
    factor: {
      kind: 'passkey',
      credentialIdB64u: record.credentialIdB64u,
    },
    verifier: {
      kind: 'webauthn',
      rpId: record.rpId,
    },
    bindingId: record.walletAuthMethodId,
  };
}

async function walletAuthAuthorityRefForSelectedPasskeyMethod(
  record: ActivePasskeyWalletAuthMethodRecordV2,
): Promise<WalletAuthAuthorityRef> {
  return await walletAuthAuthorityRef({
    authority: walletAuthAuthorityForSelectedPasskeyMethod(record),
  });
}

export async function resolveExactLinkedEmailOtpAuthority(args: {
  readonly authMethod: ActiveEmailOtpWalletAuthMethodRecordV2;
  readonly provider: EmailOtpProvider;
  readonly providerSubjectId: string;
}): Promise<EmailOtpWalletAuthAuthority> {
  const authority = parseEmailOtpWalletAuthAuthority({
    walletId: args.authMethod.walletId,
    factor: {
      kind: 'email_otp',
      provider: args.provider,
      providerUserId: args.providerSubjectId,
    },
    verifier: {
      kind: 'email_otp_wallet_auth_method',
      emailHashHex: args.authMethod.emailHashHex,
    },
    bindingId: args.authMethod.walletAuthMethodId,
  });
  if (!authority) {
    throw new Error('[login] linked Email OTP provider identity does not match selected authority');
  }
  return authority;
}

export async function walletAuthAuthorityForLinkedDeviceMethod(args: {
  readonly selection: LinkedDeviceAuthoritySelection;
  readonly providerIdentity?: LinkedDeviceEmailOtpProviderIdentity;
}): Promise<WalletAuthAuthority> {
  if (args.selection.authMethod.kind === 'passkey') {
    return walletAuthAuthorityForSelectedPasskeyMethod(args.selection.authMethod);
  }
  if (args.selection.authMethod.kind === 'voiceid') {
    throw new Error('[login] VoiceID linked-device authority requires its own unlock path');
  }
  const providerIdentity = args.providerIdentity;
  if (!providerIdentity) {
    throw new Error('[login] linked Email OTP authority provider identity is missing');
  }
  return await resolveExactLinkedEmailOtpAuthority({
    authMethod: args.selection.authMethod,
    provider: providerIdentity.provider,
    providerSubjectId: providerIdentity.providerSubjectId,
  });
}

export async function walletAuthAuthorityRefForLinkedDeviceMethod(args: {
  readonly selection: LinkedDeviceAuthoritySelection;
  readonly providerIdentity?: LinkedDeviceEmailOtpProviderIdentity;
}): Promise<WalletAuthAuthorityRef> {
  return await walletAuthAuthorityRef({
    authority: await walletAuthAuthorityForLinkedDeviceMethod(args),
  });
}

function selectedSignerMaterialForActivation(
  materials: readonly WalletAuthoritySignerMaterialRecordV1[],
  authorityId: string,
  walletAuthMethodId: string,
  activation: MpcMaterialActivationRef,
): WalletAuthoritySignerMaterialRecordV1 | null {
  let selected: WalletAuthoritySignerMaterialRecordV1 | null = null;
  for (const material of materials) {
    if (
      material.authorityId !== authorityId ||
      material.walletAuthMethodId !== walletAuthMethodId ||
      material.activationId !== activation.activationId
    ) {
      continue;
    }
    if (selected) return null;
    selected = material;
  }
  return selected;
}

export function linkedDeviceUnlockIdentityMismatchLabels(input: {
  walletId: WalletId;
  selection: WalletSelectionRecordV1;
  authMethod: WalletAuthMethodRecordV2;
  authority: WalletAuthorityV1;
  expectedKind?: WalletAuthMethodRecordV2['kind'];
  /**
   * The caller named the method rather than taking the selected one.
   *
   * The selection still names the sibling that was in use, which is the
   * expected state for an added method rather than corruption - invariant 9
   * keeps the source selected until a lock and unlock moves it. Everything else
   * is still checked, and the move itself remains guarded to members of one
   * authority.
   */
  allowUnselectedSibling?: boolean;
}): readonly string[] {
  const failures: string[] = [];
  if (input.selection.walletId !== input.walletId) failures.push('selection_wallet_id');
  if (
    !input.allowUnselectedSibling &&
    input.selection.walletAuthMethodId !== input.authMethod.walletAuthMethodId
  ) {
    failures.push('selection_auth_method_id');
  }
  if (input.authMethod.walletId !== input.walletId) failures.push('auth_method_wallet_id');
  if (input.authMethod.status !== 'active') failures.push('auth_method_inactive');
  if (input.expectedKind && input.authMethod.kind !== input.expectedKind) {
    failures.push(`auth_method_not_${input.expectedKind}`);
  }
  if (input.authority.walletId !== input.walletId) failures.push('authority_wallet_id');
  if (input.authority.state !== 'active') failures.push('authority_inactive');
  if (input.authority.authorityId !== input.authMethod.walletAuthorityId) {
    failures.push('authority_auth_method_id');
  }
  return failures;
}

export type LinkedDeviceAuthoritySelection = Readonly<{
  readonly walletId: WalletId;
  readonly selection: WalletSelectionRecordV1;
  readonly authMethod: ActiveWalletAuthMethodRecordV2;
  readonly authority: ActiveWalletAuthorityV1;
  readonly signerMaterials: readonly WalletAuthoritySignerMaterialRecordV1[];
  readonly exportRoot: WalletAuthorityExportRootRecordV1 | null;
}>;

export type LinkedDevicePasskeyAuthoritySelection = LinkedDeviceAuthoritySelection &
  Readonly<{
    readonly kind: 'linked_device_passkey_authority_selection_v1';
    readonly walletId: WalletId;
    readonly selection: WalletSelectionRecordV1;
    readonly authMethod: ActivePasskeyWalletAuthMethodRecordV2;
    readonly authority: ActiveWalletAuthorityV1;
    readonly signerMaterials: readonly WalletAuthoritySignerMaterialRecordV1[];
    readonly exportRoot: WalletAuthorityExportRootRecordV1 | null;
  }>;

export type LinkedDeviceEmailOtpAuthoritySelection = LinkedDeviceAuthoritySelection &
  Readonly<{
    readonly kind: 'linked_device_email_otp_authority_selection_v1';
    readonly authMethod: ActiveEmailOtpWalletAuthMethodRecordV2;
  }>;

type LinkedDeviceEmailOtpAuthorityResolution =
  | { readonly kind: 'none' }
  | { readonly kind: 'selected'; readonly selection: LinkedDeviceEmailOtpAuthoritySelection }
  | { readonly kind: 'rejected'; readonly message: string };

export type LinkedDevicePasskeyOpenedMaterial = Extract<
  OpenWalletAuthorityLinkedSignerMaterialResultV1,
  { readonly kind: 'opened_wallet_authority_linked_signer_material_v1' }
>;

export async function resolveLinkedDevicePasskeyAuthoritySelection(
  walletIdInput: string,
): Promise<LinkedDevicePasskeyAuthoritySelection | null> {
  const parsedWalletId = parseWalletId(walletIdInput);
  if (!parsedWalletId.ok) return null;
  const walletId = parsedWalletId.value;
  try {
    const resolved = await IndexedDBManager.resolveSelectedWalletAuthority(String(walletId));
    if (resolved.kind !== 'resolved') return null;
    const { selection, authMethod, authority } = resolved;
    const identityMismatchLabels = linkedDeviceUnlockIdentityMismatchLabels({
      walletId,
      selection,
      authMethod,
      authority,
      expectedKind: 'passkey',
    });
    if (identityMismatchLabels.length > 0) return null;
    if (authMethod.status !== 'active' || authMethod.kind !== 'passkey') return null;
    if (authority.state !== 'active') return null;
    if (authority.provenance.kind !== 'device_link') return null;
    return {
      kind: 'linked_device_passkey_authority_selection_v1',
      walletId,
      selection,
      authMethod,
      authority,
      signerMaterials: resolved.signerMaterials,
      exportRoot: resolved.exportRoot,
    };
  } catch {
    return null;
  }
}

export async function resolveLinkedDeviceEmailOtpAuthoritySelection(args: {
  readonly walletIdInput: string;
  readonly emailHashHex: string;
  readonly provider: EmailOtpProvider;
  readonly providerSubjectId: string;
  /**
   * Resolve as this method rather than as the selected one.
   *
   * An added sibling is not selected yet - invariant 9 leaves the source
   * selected until a lock and unlock - so resolving through the selection would
   * refuse the very method being unlocked. The unlock moves the selection
   * afterwards, and that move is still guarded to members of one authority.
   */
  readonly walletAuthMethodId?: string;
}): Promise<LinkedDeviceEmailOtpAuthorityResolution> {
  const parsedWalletId = parseWalletId(args.walletIdInput);
  const emailHashHex = String(args.emailHashHex || '')
    .trim()
    .toLowerCase();
  const providerSubjectId = String(args.providerSubjectId || '').trim();
  if (!parsedWalletId.ok || !emailHashHex || !providerSubjectId) return { kind: 'none' };
  const walletId = parsedWalletId.value;
  let resolved: Awaited<ReturnType<typeof IndexedDBManager.resolveSelectedWalletAuthority>>;
  try {
    resolved = args.walletAuthMethodId
      ? await IndexedDBManager.resolveWalletAuthorityForMethod(
          String(walletId),
          args.walletAuthMethodId,
        )
      : await IndexedDBManager.resolveSelectedWalletAuthority(String(walletId));
  } catch (error: unknown) {
    return {
      kind: 'rejected',
      message:
        error instanceof Error ? error.message : 'Selected Email OTP authority is unavailable',
    };
  }
  if (resolved.kind === 'missing_selection') return { kind: 'none' };
  if (resolved.kind !== 'resolved') {
    return { kind: 'rejected', message: 'Selected Email OTP authority is unavailable' };
  }
  const { selection, authMethod, authority } = resolved;
  if (authMethod.kind !== 'email_otp') return { kind: 'none' };
  const mismatchLabels = linkedDeviceUnlockIdentityMismatchLabels({
    walletId,
    selection,
    authMethod,
    authority,
    expectedKind: 'email_otp',
    allowUnselectedSibling: Boolean(args.walletAuthMethodId),
  });
  if (mismatchLabels.length > 0 || authMethod.emailHashHex.toLowerCase() !== emailHashHex) {
    return {
      kind: 'rejected',
      message: 'Selected Email OTP authority is inactive or does not match the verified email',
    };
  }
  if (authMethod.status !== 'active' || authority.state !== 'active') {
    return { kind: 'rejected', message: 'Selected Email OTP authority is inactive' };
  }
  try {
    await resolveExactLinkedEmailOtpAuthority({
      authMethod,
      provider: args.provider,
      providerSubjectId,
    });
  } catch (error: unknown) {
    return {
      kind: 'rejected',
      message:
        error instanceof Error
          ? error.message
          : 'Selected Email OTP provider identity does not match the local authority',
    };
  }
  if (authority.provenance.kind === 'device_link' && resolved.signerMaterials.length === 0) {
    return {
      kind: 'rejected',
      message: 'Selected linked Email OTP authority has no signer material',
    };
  }
  if (
    resolved.signerMaterials.some(
      (material) => material.kind !== 'wallet_authority_linked_signer_material_v1',
    )
  ) {
    return {
      kind: 'rejected',
      message: 'Selected Email OTP authority has an invalid linked signer material set',
    };
  }
  return {
    kind: 'selected',
    selection: {
      kind: 'linked_device_email_otp_authority_selection_v1',
      walletId,
      selection,
      authMethod,
      authority,
      signerMaterials: resolved.signerMaterials,
      exportRoot: resolved.exportRoot,
    },
  };
}

function linkedDeviceActivationForCapability(
  authority: ActiveWalletAuthorityV1,
  subject: Extract<WalletCapabilitySubjectV1, { kind: 'sign' | 'export_keys' }>,
): MpcMaterialActivationRef {
  const activation =
    subject.keyFamily === 'ed25519'
      ? authority.signerActivations.ed25519
      : authority.signerActivations.ecdsa;
  if (!activation) {
    throw new Error(
      `[login] linked Wallet Session requested unavailable ${subject.keyFamily} material`,
    );
  }
  if (!mpcMaterialActivationRefsEqual(activation.materialActivation, subject.materialActivation)) {
    throw new Error('[login] linked Wallet Session material activation does not match authority');
  }
  return activation.materialActivation;
}

export function assertLinkedDeviceWalletSessionExact(
  selection: LinkedDeviceAuthoritySelection,
  walletSession: ActiveWalletSessionV1,
): void {
  if (
    walletSession.walletId !== selection.walletId ||
    walletSession.authorityId !== selection.authority.authorityId ||
    walletSession.authMethodId !== selection.authMethod.walletAuthMethodId ||
    walletSession.authorityDigestB64u !== selection.authority.authorityDigestB64u ||
    walletSession.authorityRevocationEpoch !== selection.authority.revocationEpoch
  ) {
    throw new Error('[login] linked Wallet Session identity does not match selected authority');
  }
  for (const subject of walletSession.capabilitySubjects) {
    switch (subject.kind) {
      case 'sign':
      case 'export_keys': {
        const activation = linkedDeviceActivationForCapability(selection.authority, subject);
        const material = selectedSignerMaterialForActivation(
          selection.signerMaterials,
          selection.authority.authorityId,
          selection.authMethod.walletAuthMethodId,
          activation,
        );
        if (!material || material.keyFamily !== subject.keyFamily) {
          throw new Error('[login] linked Wallet Session signer material is unavailable');
        }
        if (
          !mpcMaterialActivationRefsEqual(material.materialActivation, subject.materialActivation)
        ) {
          throw new Error('[login] linked Wallet Session signer material activation is invalid');
        }
        break;
      }
      case 'link_devices':
      case 'revoke_devices':
        break;
      default:
        return assertNeverLoginState(subject);
    }
  }
}

function assertLinkedPasskeyMaterialTargetFactor(
  material: Extract<
    WalletAuthoritySignerMaterialRecordV1,
    { readonly kind: 'wallet_authority_linked_signer_material_v1' }
  >,
  selection: LinkedDevicePasskeyAuthoritySelection,
): void {
  const target = material.targetFactor;
  if (
    target.kind !== 'passkey' ||
    target.walletAuthMethodId !== selection.authMethod.walletAuthMethodId ||
    target.rpId !== selection.authMethod.rpId ||
    target.credentialIdB64u !== selection.authMethod.credentialIdB64u
  ) {
    throw new Error('[login] linked passkey signer material target factor does not match V2 auth');
  }
}

export async function openLinkedDevicePasskeySignerMaterials(args: {
  readonly selection: LinkedDevicePasskeyAuthoritySelection;
  readonly credential: WebAuthnAuthenticationCredential;
}): Promise<readonly [LinkedDevicePasskeyOpenedMaterial, ...LinkedDevicePasskeyOpenedMaterial[]]> {
  const prfFirstB64u = passkeyPrfFirstB64uFromCredential(args.credential);
  if (!prfFirstB64u) {
    throw new Error('[login] linked passkey unlock requires WebAuthn PRF.first output');
  }
  let factorSecret: Uint8Array;
  try {
    factorSecret = base64UrlDecode(prfFirstB64u);
  } catch {
    throw new Error('[login] linked passkey unlock returned an invalid PRF.first output');
  }
  try {
    if (factorSecret.byteLength !== 32) {
      throw new Error('[login] linked passkey unlock requires a 32-byte PRF.first output');
    }
    return await openLinkedDeviceSignerMaterialsWithFactorSecret({
      selection: args.selection,
      factorSecret32: factorSecret,
    });
  } finally {
    factorSecret.fill(0);
  }
}

export async function openLinkedDeviceSignerMaterialsWithFactorSecret(args: {
  readonly selection:
    | LinkedDevicePasskeyAuthoritySelection
    | LinkedDeviceEmailOtpAuthoritySelection;
  readonly factorSecret32: Uint8Array;
}): Promise<readonly [LinkedDevicePasskeyOpenedMaterial, ...LinkedDevicePasskeyOpenedMaterial[]]> {
  if (args.factorSecret32.byteLength !== 32) {
    throw new Error('[login] linked signer material requires a 32-byte factor secret');
  }
  const factorSecret = args.factorSecret32.slice();
  try {
    const opened: LinkedDevicePasskeyOpenedMaterial[] = [];
    for (const material of args.selection.signerMaterials) {
      if (material.kind !== 'wallet_authority_linked_signer_material_v1') {
        throw new Error('[login] linked signer material is not a linked sealed record');
      }
      if (args.selection.kind === 'linked_device_passkey_authority_selection_v1') {
        assertLinkedPasskeyMaterialTargetFactor(material, args.selection);
      } else {
        assertLinkedEmailOtpMaterialTargetFactor(material, args.selection);
      }
      const result = await openWalletAuthorityLinkedSignerMaterialV1({
        record: material,
        factorSecret,
        expected: {
          authorityId: args.selection.authority.authorityId,
          walletId: args.selection.walletId,
          walletAuthMethodId: args.selection.authMethod.walletAuthMethodId,
          packageSetDigestB64u: material.packageSetDigestB64u,
          targetFactor: material.targetFactor,
          materialActivation: material.materialActivation,
          keyFamily: material.keyFamily,
        },
      });
      if (result.kind !== 'opened_wallet_authority_linked_signer_material_v1') {
        throw new Error(`[login] linked signer material open failed: ${result.reason}`);
      }
      opened.push(result);
    }
    const [first, ...rest] = opened;
    if (!first) throw new Error('[login] linked signer material set is empty');
    return [first, ...rest];
  } finally {
    factorSecret.fill(0);
  }
}

function assertLinkedEmailOtpMaterialTargetFactor(
  material: Extract<
    WalletAuthoritySignerMaterialRecordV1,
    { readonly kind: 'wallet_authority_linked_signer_material_v1' }
  >,
  selection: LinkedDeviceEmailOtpAuthoritySelection,
): void {
  const target = material.targetFactor;
  if (
    target.kind !== 'email_otp' ||
    target.walletAuthMethodId !== selection.authMethod.walletAuthMethodId ||
    target.emailHashHex.toLowerCase() !== selection.authMethod.emailHashHex.toLowerCase() ||
    target.registrationAuthorityId !== selection.authMethod.registrationAuthorityId
  ) {
    throw new Error(
      '[login] linked Email OTP signer material target factor does not match V2 auth',
    );
  }
}

export async function openLinkedDeviceEmailOtpSignerMaterials(args: {
  readonly selection: LinkedDeviceEmailOtpAuthoritySelection;
  readonly factorSecret32: Uint8Array;
}): Promise<readonly [LinkedDevicePasskeyOpenedMaterial, ...LinkedDevicePasskeyOpenedMaterial[]]> {
  if (args.factorSecret32.byteLength !== 32) {
    throw new Error('[login] linked Email OTP unlock requires a 32-byte factor secret');
  }
  return await openLinkedDeviceSignerMaterialsWithFactorSecret({
    selection: args.selection,
    factorSecret32: args.factorSecret32,
  });
}

export async function readWalletAuthMethodBindingsForSession(
  walletId: WalletId | null,
): Promise<readonly WalletAuthMethodBinding[]> {
  if (!walletId) return [];
  const records = await IndexedDBManager.listWalletAuthMethodsV2ForWallet(String(walletId)).catch(
    () => [] as LocalWalletAuthMethodRecordV2[],
  );
  return records
    .filter((record) => record.status === 'active')
    .map(walletAuthMethodBindingFromRecord)
    .filter((binding): binding is WalletAuthMethodBinding => Boolean(binding));
}

function selectThresholdWarmupAuthMethodBinding(args: {
  authMethods: readonly WalletAuthMethodBinding[];
  authMethod: WalletAuthMethod;
  walletId: WalletId;
}): WalletAuthMethodBinding | null {
  if (args.authMethod === SIGNER_AUTH_METHODS.passkey) return null;
  if (args.authMethod !== SIGNER_AUTH_METHODS.emailOtp) {
    throw new Error(`[login] unsupported wallet auth method for warm-up: ${args.authMethod}`);
  }
  const matches = args.authMethods.filter((binding) => binding.kind === 'email_otp');
  if (matches.length !== 1) {
    throw new Error('[login] Email OTP warm-up requires one active wallet auth-method binding');
  }
  const binding = matches[0];
  if (String(binding.wallet.walletId) !== String(args.walletId)) {
    throw new Error('[login] Email OTP warm-up auth-method binding wallet mismatch');
  }
  return binding;
}

export async function readThresholdWarmupAuthMethodBinding(args: {
  walletId: WalletId;
  authMethod: WalletAuthMethod;
}): Promise<WalletAuthMethodBinding | null> {
  return selectThresholdWarmupAuthMethodBinding({
    authMethods: await readWalletAuthMethodBindingsForSession(args.walletId),
    authMethod: args.authMethod,
    walletId: args.walletId,
  });
}

type LinkedDeviceNearUnlockSubjectResolution =
  | { readonly kind: 'absent' }
  | {
      readonly kind: 'resolved';
      readonly subject: Extract<WalletUnlockSubject, { readonly kind: 'near_ed25519_wallet' }>;
    }
  | { readonly kind: 'invalid' };

export async function resolveLinkedDeviceNearUnlockSubject(args: {
  readonly walletId: WalletId;
  readonly authMethod: ActiveWalletAuthMethodRecordV2;
  readonly authority: ActiveWalletAuthorityV1;
  readonly signerMaterials: readonly WalletAuthoritySignerMaterialRecordV1[];
}): Promise<LinkedDeviceNearUnlockSubjectResolution> {
  const activation = args.authority.signerActivations.ed25519;
  if (!activation) return { kind: 'absent' };
  const material = selectedSignerMaterialForActivation(
    args.signerMaterials,
    args.authority.authorityId,
    args.authMethod.walletAuthMethodId,
    activation.materialActivation,
  );
  if (
    !material ||
    material.kind !== 'wallet_authority_linked_signer_material_v1' ||
    material.keyFamily !== 'ed25519' ||
    !mpcMaterialActivationRefsEqual(material.materialActivation, activation.materialActivation)
  ) {
    return { kind: 'invalid' };
  }
  const application = material.publicFacts.applicationBinding;
  if (application.wallet_id !== String(args.walletId)) return { kind: 'invalid' };
  let match: Ed25519YaoPublicCapabilityLaneReferenceV1 | null = null;
  const references = await new IndexedDbEd25519YaoPublicCapabilityReferenceStore(
    IndexedDBManager,
  ).listLanes();
  for (const reference of references) {
    /* The factor comparison differs by kind: a Passkey lane is named by its
       exact RP and credential, while an Email OTP lane carries a provider
       subject the local auth method does not store. The remaining comparisons
       — this authority's exact material activation, threshold session, signing
       key, and slot — already identify one device's lane. */
    let factorMatches: boolean;
    switch (args.authMethod.kind) {
      case SIGNER_AUTH_METHODS.passkey:
        factorMatches =
          reference.auth.kind === SIGNER_AUTH_METHODS.passkey &&
          String(reference.auth.rpId) === String(args.authMethod.rpId) &&
          String(reference.auth.credentialIdB64u) === String(args.authMethod.credentialIdB64u);
        break;
      case SIGNER_AUTH_METHODS.emailOtp:
        factorMatches = reference.auth.kind === SIGNER_AUTH_METHODS.emailOtp;
        break;
      case 'voiceid':
        return { kind: 'invalid' };
      default:
        return assertNeverLoginState(args.authMethod);
    }
    if (
      !factorMatches ||
      String(reference.walletId) !== String(args.walletId) ||
      reference.signerSlot !== application.key_creation_signer_slot ||
      String(reference.nearEd25519SigningKeyId) !== application.near_ed25519_signing_key_id ||
      String(reference.thresholdSessionId) !==
        material.publicFacts.targetBinding.lifecycle.session_id ||
      !mpcMaterialActivationRefsEqual(reference.materialActivation, activation.materialActivation)
    ) {
      continue;
    }
    if (match) return { kind: 'invalid' };
    match = reference;
  }
  if (!match) return { kind: 'invalid' };
  const signerSlot = parseSignerSlot(match.signerSlot, { min: 1 });
  if (!signerSlot) return { kind: 'invalid' };
  return {
    kind: 'resolved',
    subject: {
      kind: 'near_ed25519_wallet',
      walletId: args.walletId,
      nearAccountId: match.nearAccountId,
      nearEd25519SigningKeyId: match.nearEd25519SigningKeyId,
      signerSlot,
    },
  };
}

/**
 * The exact authority reference for a linked device whose factor carries no
 * local credential. It names the authority by its own digest and the exact
 * auth method, so it cannot be reconstructed from factor fields several
 * methods may share.
 */
function requireLinkedDeviceWalletAuthAuthorityRef(input: {
  readonly authority: ActiveWalletAuthorityV1;
  readonly authMethod: ActiveWalletAuthMethodRecordV2;
}): WalletAuthAuthorityRef {
  const authorityRef = parseWalletAuthAuthorityRef({
    kind: 'wallet_auth_authority_ref',
    walletId: input.authority.walletId,
    authorityDigest: input.authority.authorityDigestB64u,
    walletAuthMethodId: input.authMethod.walletAuthMethodId,
  });
  if (!authorityRef) {
    throw new Error('[login] linked device wallet authority reference is invalid');
  }
  return authorityRef;
}

export async function resolveLinkedDeviceUnlockSubjectSet(
  walletIdInput: string,
): Promise<WalletUnlockSubjectSet | null> {
  const parsedWalletId = parseWalletId(walletIdInput);
  if (!parsedWalletId.ok) return null;
  const walletId = parsedWalletId.value;
  try {
    const resolved = await IndexedDBManager.resolveSelectedWalletAuthority(String(walletId));
    if (resolved.kind !== 'resolved') return null;
    const { selection, authMethod, authority } = resolved;
    const identityMismatchLabels = linkedDeviceUnlockIdentityMismatchLabels({
      walletId,
      selection,
      authMethod,
      authority,
    });
    if (identityMismatchLabels.length > 0) return null;
    /* Both supported factors install linked devices, so this resolver must not
       be Passkey-only: an Email OTP linked device otherwise resolves no
       subjects, and its wallet then reports no NEAR account after unlock. */
    if (authMethod.status !== 'active') return null;
    if (authority.state !== 'active') return null;
    const subjects: WalletUnlockSubject[] = [];
    const nearSubject = await resolveLinkedDeviceNearUnlockSubject({
      walletId,
      authMethod,
      authority,
      signerMaterials: resolved.signerMaterials,
    });
    if (nearSubject.kind === 'invalid') return null;
    if (nearSubject.kind === 'resolved') subjects.push(nearSubject.subject);
    const ecdsaActivation = authority.signerActivations.ecdsa;
    if (ecdsaActivation) {
      const ecdsaMaterial = selectedSignerMaterialForActivation(
        resolved.signerMaterials,
        authority.authorityId,
        authMethod.walletAuthMethodId,
        ecdsaActivation.materialActivation,
      );
      if (!ecdsaMaterial || ecdsaMaterial.keyFamily !== 'ecdsa_secp256k1') return null;
      if (
        !mpcMaterialActivationRefsEqual(
          ecdsaMaterial.materialActivation,
          ecdsaActivation.materialActivation,
        )
      )
        return null;
      let authorityRef: WalletAuthAuthorityRef;
      try {
        /* A Passkey ref is derived from its exact credential; an Email OTP
           method has no local credential, so its ref carries the authority's
           own digest and exact method id. */
        authorityRef =
          authMethod.kind === SIGNER_AUTH_METHODS.passkey
            ? await walletAuthAuthorityRefForSelectedPasskeyMethod(authMethod)
            : requireLinkedDeviceWalletAuthAuthorityRef({ authority, authMethod });
      } catch {
        return null;
      }
      subjects.push({
        kind: 'evm_family_ecdsa_wallet',
        walletId,
        capability: ecdsaActivation.materialActivation.capability,
        authority: authorityRef,
        ecdsaThresholdKeyId: ecdsaMaterial.ecdsaThresholdKeyId,
      });
    }
    const firstSubject = subjects[0];
    if (!firstSubject) return null;
    return {
      kind: 'wallet_unlock_subject_set',
      walletId,
      subjects: [firstSubject, ...subjects.slice(1)],
    };
  } catch {
    return null;
  }
}

export type LinkedDeviceEmailOtpProviderIdentity = Readonly<{
  readonly provider: 'google' | 'email';
  readonly providerSubjectId: string;
}>;

export function linkedDeviceEmailOtpProviderSubjectId(
  providerIdentity: LinkedDeviceEmailOtpProviderIdentity | undefined,
): string {
  const providerSubjectId = String(providerIdentity?.providerSubjectId || '').trim();
  if (!providerSubjectId) {
    throw new Error('[login] linked Email OTP lane provider identity is missing');
  }
  return providerSubjectId;
}

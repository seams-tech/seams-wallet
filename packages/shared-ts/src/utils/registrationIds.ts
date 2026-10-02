// The wallet ids and NEAR Ed25519 signing-key ids that registration allocates or derives.
import { alphabetizeStringify, sha256BytesUtf8 } from './digests';
import {
  type EmailOtpProviderUserId,
  parseEmailOtpProviderUserId,
  parseWalletId,
  type WalletId,
  type WebAuthnRpId,
} from './domainIds';
import { base64UrlEncode } from './base64';
import type { RegistrationAuthority } from './registrationAuthMethodInput';
import type { ThresholdEd25519RegistrationSpec } from './registrationSignerPlan';
import type { EmailOtpProvider } from './walletAuthAuthority';

export type ServerAllocatedWalletId = WalletId & {
  readonly __serverAllocatedWalletIdBrand: unique symbol;
};

export type NearEd25519SigningKeyId = string & {
  readonly __nearEd25519SigningKeyIdBrand: unique symbol;
};

export function walletIdFromString(value: string): WalletId {
  const parsed = parseWalletId(value);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
}

type ServerAllocatedWalletIdParseResult =
  | { ok: true; value: ServerAllocatedWalletId }
  | {
      ok: false;
      error: { message: string };
    };

const SERVER_ALLOCATED_WALLET_ADJECTIVES = [
  'alpine',
  'amber',
  'azure',
  'brisk',
  'bright',
  'calm',
  'cedar',
  'cobalt',
  'copper',
  'coral',
  'crimson',
  'crystal',
  'dawn',
  'deep',
  'dusky',
  'evergreen',
  'fair',
  'fern',
  'frost',
  'gentle',
  'glacier',
  'glowing',
  'golden',
  'harbor',
  'humble',
  'indigo',
  'ivory',
  'jade',
  'keen',
  'lunar',
  'maple',
  'misty',
  'mossy',
  'noble',
  'ocean',
  'opal',
  'polar',
  'quiet',
  'rapid',
  'redwood',
  'river',
  'royal',
  'sage',
  'scarlet',
  'serene',
  'silver',
  'solar',
  'steady',
  'stone',
  'swift',
  'tranquil',
  'twilight',
  'umber',
  'verdant',
  'vibrant',
  'violet',
  'vivid',
  'warm',
  'wild',
  'willow',
  'winter',
  'woodland',
  'young',
  'zephyr',
] as const;

const SERVER_ALLOCATED_WALLET_NOUNS = [
  'anchor',
  'arbor',
  'atlas',
  'aurora',
  'badger',
  'beacon',
  'bloom',
  'brook',
  'canyon',
  'cascade',
  'comet',
  'cove',
  'crane',
  'delta',
  'dune',
  'eagle',
  'ember',
  'falcon',
  'feather',
  'fjord',
  'forest',
  'galaxy',
  'garden',
  'giant',
  'grove',
  'harvest',
  'heron',
  'horizon',
  'island',
  'lagoon',
  'lantern',
  'lark',
  'meadow',
  'meteor',
  'monolith',
  'nebula',
  'oasis',
  'orchid',
  'otter',
  'peak',
  'pebble',
  'phoenix',
  'pine',
  'prism',
  'quartz',
  'raven',
  'reef',
  'ridge',
  'sable',
  'sequoia',
  'shore',
  'solstice',
  'sparrow',
  'star',
  'summit',
  'tempo',
  'thunder',
  'tundra',
  'valley',
  'vermillion',
  'voyage',
  'wave',
  'wren',
  'zenith',
] as const;

const SERVER_ALLOCATED_WALLET_SUFFIX_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const SERVER_ALLOCATED_WALLET_ID_PATTERN = /^([a-z]+)-([a-z]+)-([a-z0-9]{6})$/;
const SERVER_ALLOCATED_WALLET_ADJECTIVE_SET = new Set<string>(SERVER_ALLOCATED_WALLET_ADJECTIVES);
const SERVER_ALLOCATED_WALLET_NOUN_SET = new Set<string>(SERVER_ALLOCATED_WALLET_NOUNS);

export function createServerAllocatedWalletId(): ServerAllocatedWalletId {
  return requireServerAllocatedWalletId(
    [
      randomServerAllocatedWalletWord(SERVER_ALLOCATED_WALLET_ADJECTIVES),
      randomServerAllocatedWalletWord(SERVER_ALLOCATED_WALLET_NOUNS),
      randomServerAllocatedWalletSuffix(6),
    ].join('-'),
  );
}

export function createReadableWalletId(): WalletId {
  return walletIdFromString(
    [
      randomServerAllocatedWalletWord(SERVER_ALLOCATED_WALLET_ADJECTIVES),
      randomServerAllocatedWalletWord(SERVER_ALLOCATED_WALLET_NOUNS),
      randomServerAllocatedWalletSuffix(6),
    ].join('-'),
  );
}

function parseServerAllocatedWalletId(raw: unknown): ServerAllocatedWalletIdParseResult {
  const parsed = parseWalletId(raw);
  if (!parsed.ok) return parsed;
  const value = String(parsed.value);
  const match = SERVER_ALLOCATED_WALLET_ID_PATTERN.exec(value);
  const adjective = match?.[1] || '';
  const noun = match?.[2] || '';
  const suffix = match?.[3] || '';
  if (
    !match ||
    !SERVER_ALLOCATED_WALLET_ADJECTIVE_SET.has(adjective) ||
    !SERVER_ALLOCATED_WALLET_NOUN_SET.has(noun) ||
    !serverAllocatedWalletSuffixIsValid(suffix)
  ) {
    return {
      ok: false,
      error: {
        message:
          'server-allocated walletId must match the approved readable word-word-suffix allocation format',
      },
    };
  }
  return { ok: true, value: parsed.value as ServerAllocatedWalletId };
}

function requireServerAllocatedWalletId(value: unknown): ServerAllocatedWalletId {
  const parsed = parseServerAllocatedWalletId(value);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
}

function serverAllocatedRandomIndex(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 256) {
    throw new Error('Invalid server-allocated wallet random bound');
  }
  const limit = 256 - (256 % maxExclusive);
  const byte = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(byte);
    if (byte[0] < limit) return byte[0] % maxExclusive;
  }
}

function randomServerAllocatedWalletWord(words: readonly string[]): string {
  return words[serverAllocatedRandomIndex(words.length)]!;
}

function randomServerAllocatedWalletSuffix(length: number): string {
  let suffix = '';
  for (let index = 0; index < length; index += 1) {
    suffix +=
      SERVER_ALLOCATED_WALLET_SUFFIX_ALPHABET[
        serverAllocatedRandomIndex(SERVER_ALLOCATED_WALLET_SUFFIX_ALPHABET.length)
      ];
  }
  return suffix;
}

function serverAllocatedWalletSuffixIsValid(suffix: string): boolean {
  if (suffix.length !== 6) return false;
  for (const character of suffix) {
    if (!SERVER_ALLOCATED_WALLET_SUFFIX_ALPHABET.includes(character)) return false;
  }
  return true;
}

export function nearEd25519SigningKeyIdFromString(value: string): NearEd25519SigningKeyId {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error('nearEd25519SigningKeyId is required');
  }
  return normalized as NearEd25519SigningKeyId;
}

export function parseNearEd25519SigningKeyId(value: unknown): NearEd25519SigningKeyId {
  if (typeof value !== 'string') {
    throw new Error('nearEd25519SigningKeyId must be a string');
  }
  return nearEd25519SigningKeyIdFromString(value);
}

function nearEd25519SigningKeyIdFromWalletId(walletId: WalletId): NearEd25519SigningKeyId {
  return nearEd25519SigningKeyIdFromString(String(walletId));
}

type GeneratedImplicitNearEd25519SigningKeyDigestInput = {
  kind: 'generated_implicit_near_ed25519_signing_key_v1';
  walletId: ServerAllocatedWalletId;
  authorityScope: RegistrationEd25519AuthorityScope;
  signingRootId: string;
  signingRootVersion: string;
  signerSlot: number;
  participantIds: readonly number[];
  keyPurpose: string;
  keyVersion: string;
  derivationVersion: number;
};

async function computeGeneratedImplicitNearEd25519SigningKeyId(
  input: GeneratedImplicitNearEd25519SigningKeyDigestInput,
): Promise<NearEd25519SigningKeyId> {
  const canonical = alphabetizeStringify({
    kind: input.kind,
    walletId: String(input.walletId),
    authorityScope: input.authorityScope,
    signingRootId: input.signingRootId,
    signingRootVersion: input.signingRootVersion,
    signerSlot: input.signerSlot,
    participantIds: [...input.participantIds],
    keyPurpose: input.keyPurpose,
    keyVersion: input.keyVersion,
    derivationVersion: input.derivationVersion,
  });
  const digest = base64UrlEncode(await sha256BytesUtf8(canonical));
  return nearEd25519SigningKeyIdFromString(`ed25519ks_${digest}`);
}

export async function computeAddSignerNearEd25519SigningKeyId(input: {
  kind: 'wallet_add_signer_implicit_near_ed25519_key_v1';
  walletId: WalletId;
  signingRootId: string;
  signingRootVersion: string;
  signerSlot: number;
  participantIds: readonly number[];
  keyPurpose: string;
  keyVersion: string;
  derivationVersion: number;
}): Promise<NearEd25519SigningKeyId> {
  const canonical = alphabetizeStringify({
    kind: input.kind,
    walletId: String(input.walletId),
    signingRootId: input.signingRootId,
    signingRootVersion: input.signingRootVersion,
    signerSlot: input.signerSlot,
    participantIds: [...input.participantIds],
    keyPurpose: input.keyPurpose,
    keyVersion: input.keyVersion,
    derivationVersion: input.derivationVersion,
  });
  const digest = base64UrlEncode(await sha256BytesUtf8(canonical));
  return nearEd25519SigningKeyIdFromString(`ed25519ks_${digest}`);
}

export type RegistrationEd25519AuthorityScope =
  | {
      kind: 'passkey';
      rpId: WebAuthnRpId;
      proofKind?: never;
      email?: never;
      challengeId?: never;
      googleEmailOtpRegistrationAttemptId?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
    }
  | {
      kind: 'email_otp';
      provider: EmailOtpProvider;
      providerUserId: EmailOtpProviderUserId;
      proofKind?: never;
      rpId?: never;
      email?: never;
      challengeId?: never;
      googleEmailOtpRegistrationAttemptId?: never;
      googleEmailOtpRegistrationOfferId?: never;
      googleEmailOtpRegistrationCandidateId?: never;
    };

function emailOtpProviderUserIdFromRegistrationAuthority(
  authority: Extract<RegistrationAuthority, { kind: 'email_otp' }>,
): EmailOtpProviderUserId {
  const parsed = parseEmailOtpProviderUserId(authority.providerSubject);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

export function registrationEd25519AuthorityScopeFromAuthority(
  authority: RegistrationAuthority,
): RegistrationEd25519AuthorityScope {
  switch (authority.kind) {
    case 'passkey':
      return {
        kind: 'passkey',
        rpId: authority.rpId,
      };
    case 'email_otp':
      return {
        kind: 'email_otp',
        provider: authority.proofKind === 'google_sso_registration' ? 'google' : 'email',
        providerUserId: emailOtpProviderUserIdFromRegistrationAuthority(authority),
      };
    default: {
      const exhaustive: never = authority;
      return exhaustive;
    }
  }
}

export async function computeRegistrationNearEd25519SigningKeyId(input: {
  walletId: WalletId;
  authorityScope: RegistrationEd25519AuthorityScope;
  signingRootId: string;
  signingRootVersion: string;
  ed25519: ThresholdEd25519RegistrationSpec;
}): Promise<NearEd25519SigningKeyId> {
  switch (input.ed25519.accountProvisioning.kind) {
    case 'implicit_account':
      return await computeGeneratedImplicitNearEd25519SigningKeyId({
        kind: 'generated_implicit_near_ed25519_signing_key_v1',
        walletId: requireServerAllocatedWalletId(input.walletId),
        authorityScope: input.authorityScope,
        signingRootId: input.signingRootId,
        signingRootVersion: input.signingRootVersion,
        signerSlot: input.ed25519.signerSlot,
        participantIds: input.ed25519.participantIds,
        keyPurpose: input.ed25519.keyPurpose,
        keyVersion: input.ed25519.keyVersion,
        derivationVersion: input.ed25519.derivationVersion,
      });
    case 'sponsored_named_account':
      return nearEd25519SigningKeyIdFromWalletId(input.walletId);
    default: {
      const exhaustive: never = input.ed25519.accountProvisioning;
      return exhaustive;
    }
  }
}

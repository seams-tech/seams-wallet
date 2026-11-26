import {
  isWalletCustodySeedBinding,
  parsePasskeyCustodyEnvelopeRecord,
  type PasskeyCustodySecretBinding,
  type PasskeyCustodyEnvelopeRecord,
} from '@shared/passkey-custody';

export type PasskeyCustodySessionCachePersistencePort = {
  readonly readCacheEntry: (key: string) => Promise<unknown | undefined>;
  readonly writeCacheEntry: (key: string, value: unknown) => Promise<void>;
};

type PasskeyCustodySessionCachePersistenceState =
  | { readonly kind: 'unconfigured' }
  | {
      readonly kind: 'configured';
      readonly persistence: PasskeyCustodySessionCachePersistencePort;
    };

type PasskeyCustodySessionKey = `${string}:${string}`;

const PASSKEY_CUSTODY_ENVELOPE_CACHE_KEY = 'passkeyCustodyEnvelopeCacheV1';
const PASSKEY_CUSTODY_ENVELOPE_CACHE_KIND = 'passkey_custody_envelope_cache_v1' as const;
const MAX_CACHED_PASSKEY_CUSTODY_ENVELOPES = 32;

let persistenceState: PasskeyCustodySessionCachePersistenceState = {
  kind: 'unconfigured',
};

type PasskeyCustodyEnvelopeCacheV1 = {
  readonly kind: typeof PASSKEY_CUSTODY_ENVELOPE_CACHE_KIND;
  readonly envelopes: readonly PasskeyCustodyEnvelopeRecord[];
};

export type Ed25519YaoClientRootEnvelopeRecordV1 = PasskeyCustodyEnvelopeRecord & {
  readonly binding: Extract<
    PasskeyCustodySecretBinding,
    {
      readonly kind: 'ed25519_yao_client_root_v1';
    }
  >;
};

const activePasskeyCustodyEnvelopes = new Map<
  PasskeyCustodySessionKey,
  PasskeyCustodyEnvelopeRecord
>();

function assertNeverPersistenceState(value: never): never {
  throw new Error(`unknown passkey custody session cache persistence state: ${String(value)}`);
}

function requirePersistence(): PasskeyCustodySessionCachePersistencePort {
  switch (persistenceState.kind) {
    case 'configured':
      return persistenceState.persistence;
    case 'unconfigured':
      throw new Error('passkey custody session cache persistence is not configured');
    default:
      return assertNeverPersistenceState(persistenceState);
  }
}

export function configurePasskeyCustodySessionCachePersistence(
  persistence: PasskeyCustodySessionCachePersistencePort,
): void {
  persistenceState = { kind: 'configured', persistence };
}

function sessionKey(walletId: string, credentialIdB64u: string): PasskeyCustodySessionKey {
  const wallet = String(walletId || '').trim();
  const credential = String(credentialIdB64u || '').trim();
  if (!wallet || !credential) {
    throw new Error('passkey custody session identity is required');
  }
  return `${wallet}:${credential}`;
}

function emptyEnvelopeCache(): PasskeyCustodyEnvelopeCacheV1 {
  return { kind: PASSKEY_CUSTODY_ENVELOPE_CACHE_KIND, envelopes: [] };
}

function parseEnvelopeCache(value: unknown): PasskeyCustodyEnvelopeCacheV1 {
  if (value === undefined || value === null) return emptyEnvelopeCache();
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('passkey custody envelope cache is invalid');
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== PASSKEY_CUSTODY_ENVELOPE_CACHE_KIND || !Array.isArray(record.envelopes)) {
    throw new Error('passkey custody envelope cache has an invalid shape');
  }
  return {
    kind: PASSKEY_CUSTODY_ENVELOPE_CACHE_KIND,
    envelopes: record.envelopes.map((envelope) => {
      const parsed = parsePasskeyCustodyEnvelopeRecord(envelope);
      if (!isWalletCustodySeedBinding(parsed.binding)) {
        throw new Error('generic passkey custody cache cannot contain an Ed25519 export root');
      }
      return parsed;
    }),
  };
}

async function readEnvelopeCache(): Promise<PasskeyCustodyEnvelopeCacheV1> {
  return parseEnvelopeCache(
    await requirePersistence().readCacheEntry(PASSKEY_CUSTODY_ENVELOPE_CACHE_KEY),
  );
}

async function writeEnvelopeCache(cache: PasskeyCustodyEnvelopeCacheV1): Promise<void> {
  await requirePersistence().writeCacheEntry(PASSKEY_CUSTODY_ENVELOPE_CACHE_KEY, cache);
}

/**
 * Keeps the opaque envelope returned by the authenticated session exchange in
 * this page's memory. The export worker receives it only for the matching
 * wallet/credential and opens it with the fresh PRF output it collected.
 */
export async function rememberPasskeyCustodySessionEnvelope(args: {
  readonly walletId: string;
  readonly credentialIdB64u: string;
  readonly envelope: PasskeyCustodyEnvelopeRecord;
}): Promise<void> {
  if (args.envelope.lifecycle.state !== 'active') {
    throw new Error('passkey custody session envelope is not active');
  }
  if (!isWalletCustodySeedBinding(args.envelope.binding)) {
    throw new Error('generic passkey custody cache accepts wallet custody seeds only');
  }
  if (
    String(args.envelope.walletId) !== String(args.walletId) ||
    args.envelope.factor.kind !== 'passkey' ||
    String(args.envelope.factor.credentialIdB64u) !== String(args.credentialIdB64u)
  ) {
    throw new Error('passkey custody session envelope identity changed');
  }
  const key = sessionKey(String(args.walletId), String(args.credentialIdB64u));
  activePasskeyCustodyEnvelopes.set(key, args.envelope);
  const current = await readEnvelopeCache();
  const envelopes = current.envelopes.filter(
    (envelope) =>
      envelope.factor.kind !== 'passkey' ||
      sessionKey(String(envelope.walletId), String(envelope.factor.credentialIdB64u)) !== key,
  );
  envelopes.push(args.envelope);
  await writeEnvelopeCache({
    kind: PASSKEY_CUSTODY_ENVELOPE_CACHE_KIND,
    envelopes: envelopes.slice(-MAX_CACHED_PASSKEY_CUSTODY_ENVELOPES),
  });
}

export async function readPasskeyCustodySessionEnvelope(args: {
  readonly walletId: string;
  readonly credentialIdB64u: string;
}): Promise<PasskeyCustodyEnvelopeRecord | null> {
  const key = sessionKey(String(args.walletId), String(args.credentialIdB64u));
  const active = activePasskeyCustodyEnvelopes.get(key);
  if (active) return active;
  const cached = (await readEnvelopeCache()).envelopes.find(
    (envelope) =>
      envelope.lifecycle.state === 'active' &&
      envelope.factor.kind === 'passkey' &&
      sessionKey(String(envelope.walletId), String(envelope.factor.credentialIdB64u)) === key,
  );
  if (cached) {
    activePasskeyCustodyEnvelopes.set(key, cached);
    return cached;
  }
  return null;
}

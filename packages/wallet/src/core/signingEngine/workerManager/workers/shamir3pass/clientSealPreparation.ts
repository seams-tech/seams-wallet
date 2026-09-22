import {
  SIGNING_SESSION_SEAL_GROUP_ID,
  decodeSigningSessionSecret32,
} from '@shared/utils/signingSessionSeal';
import { base64UrlDecode } from '@shared/utils/base64';
import { bytesToHex } from '../../../chains/evm/bytes';
import type { Shamir3PassRuntime } from './runtime';

export type PreparedClientSeal = {
  runtime: Shamir3PassRuntime;
  secretDigest: string;
  keyHandle: string;
  ciphertext: string;
  runtimeSetupMs: number;
  clientSealMs: number;
};

type PreparationResult =
  | { kind: 'ready'; seal: PreparedClientSeal }
  | { kind: 'failed'; error: unknown };

type Preparation = {
  id: string;
  result: Promise<PreparationResult>;
  expiry: ReturnType<typeof setTimeout>;
};

async function secretDigest(secret: string): Promise<string> {
  const bytes = decodeSigningSessionSecret32(base64UrlDecode(secret));
  if (!bytes) throw new Error('Invalid client seal secret');
  try {
    return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  } finally {
    bytes.fill(0);
  }
}

function sameSecretDigest(left: string, right: string): boolean {
  let difference = 0;
  // Both values are fixed-size SHA-256 hex digests produced inside this module.
  for (let index = 0; index < 64; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function createClientSeal(
  getRuntime: () => Promise<Shamir3PassRuntime>,
  secret: string,
): Promise<PreparedClientSeal> {
  const digest = await secretDigest(secret);
  const started = performance.now();
  const runtime = await getRuntime();
  const key = await runtime.createClientKeyHandle({ groupId: SIGNING_SESSION_SEAL_GROUP_ID });
  const runtimeSetupMs = performance.now() - started;
  try {
    const sealStarted = performance.now();
    const ciphertext = await runtime.addClientSealWithKeyHandle({
      ciphertextB64u: secret,
      keyHandle: key.keyHandle,
    });
    return {
      runtime,
      secretDigest: digest,
      keyHandle: key.keyHandle,
      ciphertext,
      runtimeSetupMs,
      clientSealMs: performance.now() - sealStarted,
    };
  } catch (error: unknown) {
    await runtime.destroyClientKeyHandle(key);
    throw error;
  }
}

async function prepareClientSeal(
  getRuntime: () => Promise<Shamir3PassRuntime>,
  secret: string,
): Promise<PreparationResult> {
  try {
    return { kind: 'ready', seal: await createClientSeal(getRuntime, secret) };
  } catch (error: unknown) {
    return { kind: 'failed', error };
  }
}

async function destroyPreparation(result: Promise<PreparationResult>): Promise<void> {
  const prepared = await result;
  if (prepared.kind === 'ready')
    await prepared.seal.runtime.destroyClientKeyHandle({ keyHandle: prepared.seal.keyHandle });
}

function ignoreCleanupFailure(): void {}

/** Owns temporary keys until one exact session consumes them or cleanup destroys them. */
export class ClientSealPreparations {
  private readonly entries = new Map<string, Preparation>();

  constructor(private readonly getRuntime: () => Promise<Shamir3PassRuntime>) {}

  async prepare(sessionId: string, preparationId: string, secret: string): Promise<void> {
    if (this.entries.has(sessionId)) throw new Error('Client seal preparation already exists');
    if (this.entries.size >= 32) throw new Error('Too many client seal preparations');
    const entry: Preparation = {
      id: preparationId,
      result: prepareClientSeal(this.getRuntime, secret),
      expiry: setTimeout(this.expire.bind(this), 30_000, sessionId, preparationId),
    };
    this.entries.set(sessionId, entry);
    const result = await entry.result;
    if (this.entries.get(sessionId) !== entry)
      throw new Error('Client seal preparation was discarded');
    if (result.kind === 'failed') {
      await this.discard(sessionId, entry.id);
      throw result.error;
    }
  }

  async take(sessionId: string, secret: string): Promise<PreparedClientSeal> {
    const entry = this.entries.get(sessionId);
    if (!entry) return createClientSeal(this.getRuntime, secret);
    const digest = await secretDigest(secret);
    const result = await entry.result;
    if (this.entries.get(sessionId) !== entry)
      throw new Error('Client seal preparation was discarded');
    if (result.kind === 'ready' && !sameSecretDigest(digest, result.seal.secretDigest)) {
      await this.discard(sessionId, entry.id);
      throw new Error('Client seal preparation factor mismatch');
    }
    this.entries.delete(sessionId);
    clearTimeout(entry.expiry);
    if (result.kind === 'failed') throw result.error;
    return result.seal;
  }

  async discard(sessionId: string, preparationId: string): Promise<void> {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.id !== preparationId) return;
    this.entries.delete(sessionId);
    clearTimeout(entry.expiry);
    await destroyPreparation(entry.result);
  }

  clearSession(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) this.expire(sessionId, entry.id);
  }

  clear(): void {
    for (const [sessionId, entry] of this.entries) this.expire(sessionId, entry.id);
  }

  private expire(sessionId: string, preparationId: string): void {
    void this.discard(sessionId, preparationId).catch(ignoreCleanupFailure);
  }
}

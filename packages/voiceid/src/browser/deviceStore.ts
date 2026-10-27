import { IndexedDBManager } from '@seams/wallet/voiceid-host';
import { requireRecord } from '@seams/wallet/voiceid-host';
import { base64UrlEncode, base64UrlDecode } from '@seams/wallet/voiceid-host';
import { parseVoiceIdDevicePublicKeyB64u } from '@seams/wallet/voiceid-host';
import { sha256DigestB64u, type DigestB64u } from '@seams/wallet/voiceid-host';
import type { WalletId, WalletAuthMethodId } from '@seams/wallet/voiceid-host';

export type BrowserVoiceDevice = Readonly<{
  kind: 'browser_voiceid_device_v1';
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
  privateKey: CryptoKey;
  publicKeyB64u: ReturnType<typeof parseVoiceIdDevicePublicKeyB64u>;
  deviceKeyId: DigestB64u;
  wrappingKey: CryptoKey;
  nonce: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}>;

export function deviceKey(walletId: WalletId, methodId: WalletAuthMethodId): string {
  return `voiceid-browser-device-v1:${encodeURIComponent(walletId)}:${encodeURIComponent(methodId)}`;
}

function deviceAad(
  walletId: WalletId,
  methodId: WalletAuthMethodId,
  deviceKeyId: DigestB64u,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    JSON.stringify([
      'seams-voiceid-browser-factor-v1',
      location.origin,
      walletId,
      methodId,
      deviceKeyId,
    ]),
  );
}

export async function readBrowserVoiceDevice(
  walletId: WalletId,
  methodId: WalletAuthMethodId,
): Promise<BrowserVoiceDevice | null> {
  const raw = await IndexedDBManager.getAppState(deviceKey(walletId, methodId));
  if (raw === undefined) return null;
  const record = requireRecord(raw, 'VoiceID device record');
  if (
    record.kind !== 'browser_voiceid_device_v1' ||
    record.walletId !== walletId ||
    record.walletAuthMethodId !== methodId
  ) {
    throw new Error('VoiceID device belongs to another wallet method.');
  }
  const { privateKey, wrappingKey, nonce, ciphertext } = record;
  if (
    !(privateKey instanceof CryptoKey) ||
    privateKey.type !== 'private' ||
    privateKey.extractable ||
    privateKey.algorithm.name !== 'Ed25519' ||
    !privateKey.usages.includes('sign') ||
    !(wrappingKey instanceof CryptoKey) ||
    wrappingKey.type !== 'secret' ||
    wrappingKey.extractable ||
    wrappingKey.algorithm.name !== 'AES-GCM' ||
    !wrappingKey.usages.includes('decrypt') ||
    !(nonce instanceof Uint8Array) ||
    nonce.length !== 12 ||
    !(ciphertext instanceof ArrayBuffer) ||
    ciphertext.byteLength !== 48
  ) {
    throw new Error('VoiceID device storage is invalid.');
  }
  const publicKeyB64u = parseVoiceIdDevicePublicKeyB64u(record.publicKeyB64u);
  const deviceKeyId = await sha256DigestB64u(base64UrlDecode(publicKeyB64u));
  if (record.deviceKeyId !== deviceKeyId) throw new Error('VoiceID device key binding is invalid.');
  return {
    kind: 'browser_voiceid_device_v1',
    walletId,
    walletAuthMethodId: methodId,
    privateKey,
    wrappingKey,
    nonce: new Uint8Array(nonce),
    ciphertext,
    publicKeyB64u,
    deviceKeyId,
  };
}

export async function createBrowserVoiceDevice(
  walletId: WalletId,
  methodId: WalletAuthMethodId,
): Promise<BrowserVoiceDevice> {
  return await navigator.locks.request(
    deviceKey(walletId, methodId),
    createDeviceUnderLock.bind(null, walletId, methodId),
  );
}

async function createDeviceUnderLock(
  walletId: WalletId,
  methodId: WalletAuthMethodId,
): Promise<BrowserVoiceDevice> {
  const existing = await readBrowserVoiceDevice(walletId, methodId);
  if (existing) return existing;
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const publicKeyB64u = parseVoiceIdDevicePublicKeyB64u(
    base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))),
  );
  const deviceKeyId = await sha256DigestB64u(base64UrlDecode(publicKeyB64u));
  const wrappingKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const factor = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: deviceAad(walletId, methodId, deviceKeyId) },
      wrappingKey,
      factor,
    );
    const device: BrowserVoiceDevice = {
      kind: 'browser_voiceid_device_v1',
      walletId,
      walletAuthMethodId: methodId,
      privateKey: keys.privateKey,
      publicKeyB64u,
      deviceKeyId,
      wrappingKey,
      nonce,
      ciphertext,
    };
    await IndexedDBManager.setAppState(deviceKey(walletId, methodId), device);
    return device;
  } finally {
    factor.fill(0);
  }
}

export async function openBrowserVoiceFactor(
  device: BrowserVoiceDevice,
): Promise<Uint8Array<ArrayBuffer>> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: device.nonce,
      additionalData: deviceAad(device.walletId, device.walletAuthMethodId, device.deviceKeyId),
    },
    device.wrappingKey,
    device.ciphertext,
  );
  return new Uint8Array(plaintext);
}

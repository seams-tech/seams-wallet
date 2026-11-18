import { openDB } from 'idb';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import {
  EMAIL_OTP_DEVICE_FACTOR_LIMIT,
  emailOtpFactorOprfInfo,
  type EmailOtpDeviceFactorBlindV1,
  type EmailOtpFactorEvaluationV1,
} from '@shared/utils/emailOtpDomain';
import { encodeSigningSessionHkdfTuple } from '@shared/utils/signingSessionSeal';
import {
  blindOprfInput,
  discardOprfBlind,
  finalizeOprf,
  importOprfOutputKey,
  type OprfBlindedInput,
} from '../oprf/runtime';

/**
 * The Email OTP device factor. The device keeps a random OPRF input x for each
 * enrollment. The server keeps the factor nonce and S encrypted under a key
 * from the POPRF output F(k, x, info). Neither side alone can compute that key,
 * so neither side alone can open S. Only this worker reads or writes the store.
 */

const DB_NAME = 'seams_email_otp_device_factors';
const STORE = 'factors';
const WRAP_LABEL = 'seams/email-otp/device-factor-wrap/v1';
const WRAP_NONCE_BYTES = 12;
const FACTOR_SECRET_BYTES = 32;

type DeviceFactorRecord = {
  readonly walletId: string;
  readonly factorNonceB64u: string;
  readonly enrollmentId: string;
  readonly inputB64u: string;
  readonly createdAtMs: number;
};

function openFactorStore() {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      const store = database.createObjectStore(STORE, {
        keyPath: ['walletId', 'factorNonceB64u'],
      });
      store.createIndex('walletId', 'walletId');
    },
  });
}

/** The factors of a wallet on this device, newest first. */
async function listFactors(walletId: string): Promise<DeviceFactorRecord[]> {
  const database = await openFactorStore();
  try {
    const records = (await database.getAllFromIndex(STORE, 'walletId', walletId)) as
      DeviceFactorRecord[] | undefined;
    return (records ?? []).sort((left, right) => right.createdAtMs - left.createdAtMs);
  } finally {
    database.close();
  }
}

/** Stores a factor and keeps only the newest `EMAIL_OTP_DEVICE_FACTOR_LIMIT` for the wallet. */
async function putFactor(record: DeviceFactorRecord): Promise<void> {
  const database = await openFactorStore();
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    await transaction.store.put(record);
    const all = ((await transaction.store.index('walletId').getAll(record.walletId)) ??
      []) as DeviceFactorRecord[];
    all.sort((left, right) => right.createdAtMs - left.createdAtMs);
    for (const stale of all.slice(EMAIL_OTP_DEVICE_FACTOR_LIMIT)) {
      await transaction.store.delete([stale.walletId, stale.factorNonceB64u]);
    }
    await transaction.done;
  } finally {
    database.close();
  }
}

/** After a successful open, the other factors of the wallet can never match again. */
async function deleteOtherFactors(walletId: string, keepNonceB64u: string): Promise<void> {
  const database = await openFactorStore();
  try {
    const transaction = database.transaction(STORE, 'readwrite');
    const all = ((await transaction.store.index('walletId').getAll(walletId)) ??
      []) as DeviceFactorRecord[];
    for (const record of all) {
      if (record.factorNonceB64u !== keepNonceB64u) {
        await transaction.store.delete([record.walletId, record.factorNonceB64u]);
      }
    }
    await transaction.done;
  } finally {
    database.close();
  }
}

function wrapAssociatedData(input: {
  readonly walletId: string;
  readonly enrollmentId: string;
  readonly factorNonceB64u: string;
}): Uint8Array<ArrayBuffer> {
  const encoded = encodeSigningSessionHkdfTuple([
    WRAP_LABEL,
    input.walletId,
    input.enrollmentId,
    input.factorNonceB64u,
  ]);
  return new Uint8Array(encoded);
}

function readEvaluationField(value: Record<string, unknown>, field: string): string {
  const text = value[field];
  if (typeof text !== 'string' || !text) {
    throw new Error(`Email OTP factor evaluation ${field} is missing`);
  }
  return text;
}

async function finalizeFactorKey(input: {
  readonly blind: OprfBlindedInput;
  readonly oprfInput: Uint8Array;
  readonly walletId: string;
  readonly enrollmentId: string;
  readonly factorNonceB64u: string;
  readonly publicKeyB64u: string;
  readonly evaluatedElementB64u: string;
  readonly proofB64u: string;
  readonly usage: KeyUsage;
}): Promise<CryptoKey> {
  const output = await finalizeOprf({
    blind: input.blind,
    input: input.oprfInput,
    evaluatedElement: base64UrlDecode(input.evaluatedElementB64u),
    proof: base64UrlDecode(input.proofB64u),
    publicKey: base64UrlDecode(input.publicKeyB64u),
    info: emailOtpFactorOprfInfo(input),
  });
  try {
    return await importOprfOutputKey(output, WRAP_LABEL, [input.usage]);
  } finally {
    output.fill(0);
  }
}

/**
 * Enrolls a new device factor for S. `evaluate` posts the blinded element to
 * the enrollment route and returns its response. The new input is stored
 * before this returns, so a reload after the server commit still finds it.
 */
export async function enrollEmailOtpDeviceFactor(args: {
  readonly walletId: string;
  readonly enrollmentId: string;
  readonly factorSecret32: Uint8Array;
  readonly evaluate: (blindedElementB64u: string) => Promise<Record<string, unknown>>;
}): Promise<{
  readonly enrollmentSealKeyVersion: string;
  readonly factorNonceB64u: string;
  readonly wrappedFactorB64u: string;
}> {
  if (args.factorSecret32.length !== FACTOR_SECRET_BYTES) {
    throw new Error('Email OTP factor secret must be 32 bytes');
  }
  const oprfInput = crypto.getRandomValues(new Uint8Array(32));
  const blind = await blindOprfInput(oprfInput);
  try {
    const response = await args.evaluate(base64UrlEncode(blind.blindedElement));
    const factorNonceB64u = readEvaluationField(response, 'factorNonceB64u');
    const enrollmentSealKeyVersion = readEvaluationField(response, 'enrollmentSealKeyVersion');
    const scope = { walletId: args.walletId, enrollmentId: args.enrollmentId, factorNonceB64u };
    const key = await finalizeFactorKey({
      blind,
      oprfInput,
      ...scope,
      publicKeyB64u: readEvaluationField(response, 'publicKeyB64u'),
      evaluatedElementB64u: readEvaluationField(response, 'evaluatedElementB64u'),
      proofB64u: readEvaluationField(response, 'proofB64u'),
      usage: 'encrypt',
    });
    const nonce = crypto.getRandomValues(new Uint8Array(WRAP_NONCE_BYTES));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: wrapAssociatedData(scope) },
        key,
        new Uint8Array(args.factorSecret32),
      ),
    );
    const wrapped = new Uint8Array(WRAP_NONCE_BYTES + ciphertext.length);
    wrapped.set(nonce, 0);
    wrapped.set(ciphertext, WRAP_NONCE_BYTES);
    await putFactor({
      ...scope,
      inputB64u: base64UrlEncode(oprfInput),
      createdAtMs: Date.now(),
    });
    return {
      enrollmentSealKeyVersion,
      factorNonceB64u,
      wrappedFactorB64u: base64UrlEncode(wrapped),
    };
  } finally {
    discardOprfBlind(blind);
    oprfInput.fill(0);
  }
}

/** The blinded inputs of every factor this device holds for one wallet. */
type EmailOtpDeviceFactorBlinds = {
  readonly walletId: string;
  readonly deviceFactors: readonly EmailOtpDeviceFactorBlindV1[];
  readonly pending: ReadonlyMap<
    string,
    {
      readonly enrollmentId: string;
      readonly oprfInput: Uint8Array;
      readonly blind: OprfBlindedInput;
    }
  >;
};

export async function blindEmailOtpDeviceFactors(
  walletId: string,
): Promise<EmailOtpDeviceFactorBlinds> {
  const records = (await listFactors(walletId)).slice(0, EMAIL_OTP_DEVICE_FACTOR_LIMIT);
  const deviceFactors: EmailOtpDeviceFactorBlindV1[] = [];
  const pending = new Map<
    string,
    { enrollmentId: string; oprfInput: Uint8Array; blind: OprfBlindedInput }
  >();
  for (const record of records) {
    const oprfInput = base64UrlDecode(record.inputB64u);
    const blind = await blindOprfInput(oprfInput);
    pending.set(record.factorNonceB64u, {
      enrollmentId: record.enrollmentId,
      oprfInput,
      blind,
    });
    deviceFactors.push({
      factorNonceB64u: record.factorNonceB64u,
      blindedElementB64u: base64UrlEncode(blind.blindedElement),
    });
  }
  return { walletId, deviceFactors, pending };
}

/** Drops every blind and zeroes every input. Safe to call more than once. */
export function discardEmailOtpDeviceFactorBlinds(blinds: EmailOtpDeviceFactorBlinds): void {
  for (const entry of blinds.pending.values()) {
    discardOprfBlind(entry.blind);
    entry.oprfInput.fill(0);
  }
}

/**
 * Opens S from the server's evaluation of one of this device's factors. The
 * blinds are discarded afterwards, and the wallet's other factors are deleted.
 */
export async function openEmailOtpFactorEvaluation(args: {
  readonly blinds: EmailOtpDeviceFactorBlinds;
  readonly evaluation: EmailOtpFactorEvaluationV1;
}): Promise<Uint8Array> {
  try {
    const entry = args.blinds.pending.get(args.evaluation.factorNonceB64u);
    if (!entry || entry.enrollmentId !== args.evaluation.enrollmentId) {
      throw new Error('Email OTP factor evaluation does not match a factor on this device');
    }
    const scope = {
      walletId: args.blinds.walletId,
      enrollmentId: entry.enrollmentId,
      factorNonceB64u: args.evaluation.factorNonceB64u,
    };
    const key = await finalizeFactorKey({
      blind: entry.blind,
      oprfInput: entry.oprfInput,
      ...scope,
      publicKeyB64u: args.evaluation.publicKeyB64u,
      evaluatedElementB64u: args.evaluation.evaluatedElementB64u,
      proofB64u: args.evaluation.proofB64u,
      usage: 'decrypt',
    });
    const wrapped = base64UrlDecode(args.evaluation.wrappedFactorB64u);
    const factorSecret32 = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: wrapped.slice(0, WRAP_NONCE_BYTES),
          additionalData: wrapAssociatedData(scope),
        },
        key,
        wrapped.slice(WRAP_NONCE_BYTES),
      ),
    );
    if (factorSecret32.length !== FACTOR_SECRET_BYTES) {
      factorSecret32.fill(0);
      throw new Error('Email OTP factor secret must be 32 bytes');
    }
    await deleteOtherFactors(scope.walletId, scope.factorNonceB64u);
    return factorSecret32;
  } finally {
    discardEmailOtpDeviceFactorBlinds(args.blinds);
  }
}

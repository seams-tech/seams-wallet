import {
  prepareMlDsaNearSigning,
  executeMlDsaNearSigning,
  submitMlDsaNearTransaction,
  serializeMlDsaWebAuthnApproval,
} from '../../packages/wallet/src/advanced';
import { exactRecord } from '../../packages/shared-ts/src/utils/exactRecord';
import {
  requireCanonicalString,
  requireRecord,
} from '../../packages/shared-ts/src/utils/validation';
import {
  parseMlDsaTransactionInspection,
  type MlDsaSignedTransaction,
  type MlDsaSigningOutcome,
} from '../../packages/shared-ts/src/near/mlDsaSigning';
import type { Variant } from '../../packages/shared-ts/src/utils/variant';
import { base64UrlDecode } from '../../packages/shared-ts/src/utils/base64';

const status = document.querySelector('#status');
const display = document.querySelector('#display');
const runButton = document.querySelector('#run');
if (
  !(status instanceof HTMLElement) ||
  !(display instanceof HTMLElement) ||
  !(runButton instanceof HTMLButtonElement)
)
  throw new Error('Qualification page is incomplete');
Reflect.set(self, 'WASM_BASE_URL', new URL('/wasm/', location.href).href);
runButton.addEventListener('click', run);

async function api(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw: unknown = await response.json();
  if (!response.ok) throw new Error('Qualification request failed');
  return raw;
}
function wait(milliseconds: number, resolve: () => void) {
  setTimeout(resolve, milliseconds);
}
async function pause(milliseconds: number) {
  await new Promise<void>(wait.bind(undefined, milliseconds));
}
async function run() {
  if (
    !(runButton instanceof HTMLButtonElement) ||
    !(status instanceof HTMLElement) ||
    !(display instanceof HTMLElement)
  )
    return;
  runButton.disabled = true;
  const samples: BrowserSigningSample[] = [];
  try {
    const config = parseConfig(await api('/fixture/config', {}));
    for (let index = 0; index < 3; index += 1) {
      status.textContent = `Preparing transaction ${index + 1}/3`;
      const encoded = exactRecord(
        await api('/fixture/transaction', {}),
        ['unsignedTransactionBorshB64u', 'inspection'],
        'transaction fixture',
      );
      const unsignedTransactionBorshB64u = requireCanonicalString(
        encoded.unsignedTransactionBorshB64u,
        'unsigned transaction',
      );
      const inspection = parseMlDsaTransactionInspection(encoded.inspection);
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const operation = encode(bytes);
      const started = performance.now();
      const prepared = await prepareMlDsaNearSigning({
        relayerUrl: config.gatewayUrl,
        publicKeyB64u: config.publicKeyB64u,
        request: {
          walletId: config.walletId,
          signingKeyId: config.signingKeyId,
          operationIdB64u: operation,
          unsignedTransactionBorshB64u,
          rpId: 'wallet.example.test',
          credentialIdB64u: config.credentialIdB64u,
        },
      });
      if (prepared.kind !== 'prepared') throw new Error(JSON.stringify(prepared));
      const prepareMs = performance.now() - started;
      display.textContent = prepared.preparation.transaction.displayJson;
      status.textContent = `Approve transaction ${index + 1}/3`;
      const approvalStart = performance.now();
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: Uint8Array.from(base64UrlDecode(prepared.preparation.challengeB64u)),
          rpId: 'wallet.example.test',
          allowCredentials: [
            { type: 'public-key', id: Uint8Array.from(base64UrlDecode(config.credentialIdB64u)) },
          ],
          userVerification: 'required',
          timeout: 60_000,
        },
      });
      if (!(credential instanceof PublicKeyCredential))
        throw new Error('Passkey approval was cancelled');
      const serialized = serializeMlDsaWebAuthnApproval(credential);
      const approvalMs = performance.now() - approvalStart;
      const signingStart = performance.now();
      const request = {
        relayerUrl: config.gatewayUrl,
        preparation: prepared.preparation,
        authorization: { kind: 'passkey' as const, credential: serialized },
      };
      let result = await executeMlDsaNearSigning(request);
      const retries: Variant<MlDsaSigningOutcome, 'kind', 'retry'>[] = [];
      while (result.kind === 'retry') {
        retries.push(result);
        if (result.retryAtMs >= prepared.preparation.expiresAtMs)
          throw new Error('Signing material outlives the approval');
        status.textContent = `Waiting for material or cooldown (${index + 1}/3)`;
        await pause(Math.max(100, result.retryAtMs - Date.now()));
        result = await executeMlDsaNearSigning(request);
      }
      if (result.kind !== 'signed') throw new Error(JSON.stringify(result));
      const signingMs = performance.now() - signingStart;
      const replay = await executeMlDsaNearSigning(request);
      if (
        replay.kind !== 'signed' ||
        replay.transaction.signatureB64u !== result.transaction.signatureB64u
      )
        throw new Error('Exact browser replay differs');
      await api('/fixture/checkpoint', {
        operationIdB64u: operation,
        transaction: result.transaction,
        inspection,
      });
      status.textContent = `Submitting transaction ${index + 1}/3`;
      const submitStart = performance.now();
      const outcome = await submitMlDsaNearTransaction({
        rpcUrl: 'https://rpc.testnet.near.org',
        preparation: prepared.preparation,
        transaction: result.transaction,
      });
      samples.push({
        operationIdB64u: operation,
        prepareMs,
        approvalMs,
        signingMs,
        submitMs: performance.now() - submitStart,
        retries,
        transaction: result.transaction,
        outcome,
        exactReplay: true,
      });
      status.textContent = `Confirmed submission ${index + 1}/3`;
      if (index < 2) await pause(60_000);
    }
    const report = requireRecord(
      await api('/fixture/complete', { browser: navigator.userAgent, samples }),
      'qualification report',
    );
    if (typeof report.passed !== 'boolean') throw new Error('Invalid qualification result');
    status.textContent = report.passed
      ? 'PASS: public browser signing and testnet finality'
      : 'FAIL';
    document.documentElement.dataset.result = report.passed ? 'passed' : 'failed';
  } catch (error: unknown) {
    status.textContent = `FAIL: ${String(error)}`;
    document.documentElement.dataset.result = 'failed';
    await api('/fixture/failure', { message: String(error), samples });
  }
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

type BrowserSigningSample = {
  readonly operationIdB64u: string;
  readonly prepareMs: number;
  readonly approvalMs: number;
  readonly signingMs: number;
  readonly submitMs: number;
  readonly retries: readonly Variant<MlDsaSigningOutcome, 'kind', 'retry'>[];
  readonly transaction: MlDsaSignedTransaction;
  readonly outcome: Awaited<ReturnType<typeof submitMlDsaNearTransaction>>;
  readonly exactReplay: true;
};
function parseConfig(raw: unknown) {
  const r = exactRecord(
    raw,
    ['gatewayUrl', 'publicKeyB64u', 'walletId', 'signingKeyId', 'credentialIdB64u'],
    'browser qualification config',
  );
  return {
    gatewayUrl: requireCanonicalString(r.gatewayUrl, 'gateway URL'),
    publicKeyB64u: requireCanonicalString(r.publicKeyB64u, 'public key'),
    walletId: requireCanonicalString(r.walletId, 'walletId'),
    signingKeyId: requireCanonicalString(r.signingKeyId, 'signing key'),
    credentialIdB64u: requireCanonicalString(r.credentialIdB64u, 'credential ID'),
  };
}

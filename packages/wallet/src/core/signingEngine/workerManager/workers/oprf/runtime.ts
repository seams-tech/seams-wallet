import { initializeWasm, resolveWasmUrl } from '@/core/walletRuntimePaths/wasm-loader';
import initOprfRuntime, {
  init_oprf_runtime,
  oprf_client_blind,
  oprf_client_discard,
  oprf_client_finalize,
} from '../../../../../../../../wasm/oprf_runtime/pkg/oprf_runtime.js';

/**
 * The client half of the RFC 9497 POPRF (ristretto255-SHA512). The worker that
 * holds a device secret runs it in process: the blind stays inside the WASM
 * module under a numeric handle until the worker finalizes or discards it.
 */

const oprfRuntimeWasmUrl = resolveWasmUrl('oprf_runtime_bg.wasm', 'OPRF Runtime');
let initialization: Promise<void> | null = null;

function ensureOprfRuntime(): Promise<void> {
  if (!initialization) {
    initialization = initializeWasm({
      workerName: 'OPRF Runtime',
      wasmUrl: oprfRuntimeWasmUrl,
      initFunction: initOprfRuntime as unknown as (wasmModule?: unknown) => Promise<void>,
      validateFunction: init_oprf_runtime,
    }).catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

export type OprfBlindedInput = {
  readonly handle: number;
  readonly blindedElement: Uint8Array;
};

export async function blindOprfInput(input: Uint8Array): Promise<OprfBlindedInput> {
  await ensureOprfRuntime();
  const blinded = oprf_client_blind(input);
  try {
    return { handle: blinded.handle, blindedElement: blinded.blindedElement };
  } finally {
    blinded.free();
  }
}

/**
 * Checks the server's proof against its public key and `info`, removes the
 * blind and returns the 64-byte output. The handle is gone afterwards.
 */
export async function finalizeOprf(input: {
  readonly blind: OprfBlindedInput;
  readonly input: Uint8Array;
  readonly evaluatedElement: Uint8Array;
  readonly proof: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly info: Uint8Array;
}): Promise<Uint8Array> {
  await ensureOprfRuntime();
  return oprf_client_finalize(
    input.blind.handle,
    input.input,
    input.evaluatedElement,
    input.proof,
    input.publicKey,
    input.info,
  );
}

export function discardOprfBlind(blind: OprfBlindedInput): void {
  oprf_client_discard(blind.handle);
}

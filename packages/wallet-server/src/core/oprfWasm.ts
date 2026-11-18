import initOprfRuntime, {
  init_oprf_runtime,
  oprf_server_evaluate,
  oprf_server_public_key,
} from '../../../../wasm/oprf_runtime/pkg/oprf_runtime.js';
import { initializeServerWasm } from './serverWasmLoader';

const OPRF_WASM_PATHS = [
  '../wasm/oprf_runtime/pkg/oprf_runtime_bg.wasm',
  '../../wasm/oprf_runtime/pkg/oprf_runtime_bg.wasm',
  '../../../../wasm/oprf_runtime/pkg/oprf_runtime_bg.wasm',
];

let initialization: Promise<void> | null = null;

function ensureOprfWasm(): Promise<void> {
  if (!initialization) {
    initialization = initializeServerWasm({
      label: 'oprf',
      baseUrl: import.meta.url,
      paths: OPRF_WASM_PATHS,
      loadBundled: () => import('../../../../wasm/oprf_runtime/pkg/oprf_runtime_bg.wasm'),
      initialize: async (moduleOrPath) => {
        await initOprfRuntime({ module_or_path: moduleOrPath });
        init_oprf_runtime();
      },
    }).catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

/**
 * The server step of the RFC 9497 POPRF (ristretto255-SHA512). The key comes
 * from `seed32` and `keyInfo`; `info` selects the function for one value.
 */
export async function evaluateOprf(input: {
  readonly seed32: Uint8Array;
  readonly keyInfo: Uint8Array;
  readonly blindedElement: Uint8Array;
  readonly info: Uint8Array;
}): Promise<{ readonly evaluatedElement: Uint8Array; readonly proof: Uint8Array }> {
  await ensureOprfWasm();
  const evaluation = oprf_server_evaluate(
    input.seed32,
    input.keyInfo,
    input.blindedElement,
    input.info,
  );
  try {
    return { evaluatedElement: evaluation.evaluatedElement, proof: evaluation.proof };
  } finally {
    evaluation.free();
  }
}

export async function oprfPublicKey(input: {
  readonly seed32: Uint8Array;
  readonly keyInfo: Uint8Array;
}): Promise<Uint8Array> {
  await ensureOprfWasm();
  return oprf_server_public_key(input.seed32, input.keyInfo);
}

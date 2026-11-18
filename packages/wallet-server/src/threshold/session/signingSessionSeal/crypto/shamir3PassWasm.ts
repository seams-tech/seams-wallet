import initShamir3PassWasm, {
  init_shamir3pass_runtime,
  shamir3pass_add_lock,
  shamir3pass_derive_lock_key_handle,
  shamir3pass_destroy_lock_key_handle,
  shamir3pass_remove_lock,
} from '../../../../../../../wasm/shamir3pass_runtime/pkg/shamir3pass_runtime.js';
import { SIGNING_SESSION_SEAL_GROUP_ID } from '@shared/utils/signingSessionSeal';

import { initializeServerWasm } from '../../../../core/serverWasmLoader';

const SHAMIR3PASS_WASM_PATHS = [
  '../../wasm/shamir3pass_runtime/pkg/shamir3pass_runtime_bg.wasm',
  '../wasm/shamir3pass_runtime/pkg/shamir3pass_runtime_bg.wasm',
  '../../../../../../../wasm/shamir3pass_runtime/pkg/shamir3pass_runtime_bg.wasm',
];

let initialization: Promise<void> | null = null;

async function ensureSigningSessionSealShamir3PassWasm(): Promise<void> {
  if (!initialization) {
    initialization = initializeServerWasm({
      label: 'shamir3pass',
      baseUrl: import.meta.url,
      paths: SHAMIR3PASS_WASM_PATHS,
      loadBundled: () =>
        import('../../../../../../../wasm/shamir3pass_runtime/pkg/shamir3pass_runtime_bg.wasm'),
      initialize: async (moduleOrPath) => {
        await initShamir3PassWasm({ module_or_path: moduleOrPath });
        init_shamir3pass_runtime();
      },
    });
  }
  await initialization;
}

/** The group element 2, the smallest value the lock operations accept. */
const WARM_UP_ELEMENT_B64U = 'Ag';
const WARM_UP_CONTEXT = new TextEncoder().encode('seams/signing-session-seal/warm-up/v1');

/**
 * Starts the module and runs one lock round under a key derived from zero
 * bytes, so the first seal in this isolate runs warm code. It uses no secret,
 * and its result is discarded.
 */
export async function warmSigningSessionSealRuntime(): Promise<void> {
  await ensureSigningSessionSealShamir3PassWasm();
  const handle = shamir3pass_derive_lock_key_handle(
    SIGNING_SESSION_SEAL_GROUP_ID,
    new Uint8Array(32),
    WARM_UP_CONTEXT.slice(),
  );
  try {
    shamir3pass_remove_lock(handle, shamir3pass_add_lock(handle, WARM_UP_ELEMENT_B64U));
  } finally {
    shamir3pass_destroy_lock_key_handle(handle);
  }
}

export async function deriveSigningSessionSealLockKeyHandle(input: {
  readonly groupId: string;
  readonly rootSecret32: Uint8Array;
  readonly context: Uint8Array;
}): Promise<number> {
  await ensureSigningSessionSealShamir3PassWasm();
  const rootSecret32 = input.rootSecret32.slice();
  const context = input.context.slice();
  try {
    return shamir3pass_derive_lock_key_handle(input.groupId, rootSecret32, context);
  } finally {
    rootSecret32.fill(0);
    context.fill(0);
  }
}

export async function addSigningSessionSealLock(input: {
  readonly handle: number;
  readonly ciphertextB64u: string;
}): Promise<string> {
  await ensureSigningSessionSealShamir3PassWasm();
  return shamir3pass_add_lock(input.handle, input.ciphertextB64u);
}

export async function removeSigningSessionSealLock(input: {
  readonly handle: number;
  readonly ciphertextB64u: string;
}): Promise<string> {
  await ensureSigningSessionSealShamir3PassWasm();
  return shamir3pass_remove_lock(input.handle, input.ciphertextB64u);
}

export function destroySigningSessionSealLockKeyHandle(handle: number): boolean {
  return shamir3pass_destroy_lock_key_handle(handle);
}

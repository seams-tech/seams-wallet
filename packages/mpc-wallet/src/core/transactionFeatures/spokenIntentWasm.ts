// How Wallet core loads the `spoken-intent` transcript reader (`wasm/spoken_intent`): from the
// SDK's workers folder, beside the other WASM modules. Only a SaySo verdict needs it.

import { resolveWasmUrl } from '@/core/walletRuntimePaths/wasm-loader';
import type { HeardWordsStart } from '@shared/speakToSign/heardWords';

export const WALLET_HEARD_WORDS_START: HeardWordsStart = (init) =>
  init(resolveWasmUrl('spoken_intent_bg.wasm', 'Spoken Intent'));

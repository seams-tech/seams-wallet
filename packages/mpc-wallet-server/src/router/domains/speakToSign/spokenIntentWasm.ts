// How the server loads the `spoken-intent` transcript reader (`wasm/spoken_intent`): Node reads
// the file, and a Cloudflare Worker uses the module that the bundler embedded.

import type { HeardWordsStart } from '@shared/speakToSign/heardWords';
import { initializeServerWasm } from '../../../core/serverWasmLoader';

const SPOKEN_INTENT_WASM_PATHS = [
  '../../../wasm/spoken_intent/pkg/spoken_intent_bg.wasm',
  '../../../../../../wasm/spoken_intent/pkg/spoken_intent_bg.wasm',
];

export const SERVER_HEARD_WORDS_START: HeardWordsStart = (init) =>
  initializeServerWasm({
    label: 'spoken-intent',
    baseUrl: import.meta.url,
    paths: SPOKEN_INTENT_WASM_PATHS,
    loadBundled: () => import('../../../../../../wasm/spoken_intent/pkg/spoken_intent_bg.wasm'),
    initialize: init,
  });

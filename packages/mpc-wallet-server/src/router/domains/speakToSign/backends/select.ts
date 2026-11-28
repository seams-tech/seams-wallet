// The verifier backend of the lane: the one that `SPEAK_TO_SIGN_BACKEND` names, built from its own
// settings. This is the one place that knows every backend module.

import {
  readSpeakToSignBackendId,
  SPEAK_TO_SIGN_BACKEND_ENV,
  type SpeakToSignBackend,
} from '../backend';
import {
  createOutLayerBackend,
  readOutLayerVerifierConfig,
  type OutLayerEnvName,
} from './outlayer/outlayerBackend';
import {
  createSaySoBackend,
  readSaySoBackendConfig,
  type SaySoEnvName,
  type SaySoServiceBinding,
} from './sayso/saysoBackend';

export type { SaySoServiceBinding };

export type SpeakToSignBackendEnvName =
  | typeof SPEAK_TO_SIGN_BACKEND_ENV
  | OutLayerEnvName
  | SaySoEnvName;

export type SpeakToSignBackendDependencies = Readonly<{
  fetch: typeof fetch;
  /** The NEAR AI key of the summary route, or null when the server has none. OutLayer reads it. */
  nearAiApiKey: string | null;
  /** The service binding `SAYSO`, or null when the lane has none. */
  saysoBinding: SaySoServiceBinding | null;
}>;

/**
 * Null when the lane sets none of the backend's settings: the server then has no verify route.
 * The settings of a backend without `SPEAK_TO_SIGN_BACKEND`, or a backend without its settings,
 * stop the server at start: two backends exist, so the lane must name one.
 */
export function createSpeakToSignBackend(
  read: (name: SpeakToSignBackendEnvName) => string | undefined,
  dependencies: SpeakToSignBackendDependencies,
): SpeakToSignBackend | null {
  const id = readSpeakToSignBackendId(read);
  const outlayer = readOutLayerVerifierConfig(read);
  const sayso = readSaySoBackendConfig(read, dependencies.saysoBinding);
  if (id === null) {
    if (outlayer || sayso) throw new Error(`${SPEAK_TO_SIGN_BACKEND_ENV} must name the backend`);
    return null;
  }
  switch (id) {
    case 'sayso':
      if (!sayso) throw new Error('Speak-to-Sign SaySo needs SAYSO_API_KEY and the SAYSO binding');
      return createSaySoBackend(sayso);
    case 'outlayer':
      if (!outlayer) throw new Error('Speak-to-Sign OutLayer needs its settings');
      return createOutLayerBackend(outlayer, dependencies);
  }
}

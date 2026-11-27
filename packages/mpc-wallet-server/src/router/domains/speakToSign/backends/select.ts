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

export type SpeakToSignBackendEnvName = typeof SPEAK_TO_SIGN_BACKEND_ENV | OutLayerEnvName;

export type SpeakToSignBackendDependencies = Readonly<{
  fetch: typeof fetch;
  /** The NEAR AI key of the summary route, or null when the server has none. */
  nearAiApiKey: string | null;
}>;

/** Null when the lane sets none of the backend's settings: the server then has no verify route. */
export function createSpeakToSignBackend(
  read: (name: SpeakToSignBackendEnvName) => string | undefined,
  dependencies: SpeakToSignBackendDependencies,
): SpeakToSignBackend | null {
  switch (readSpeakToSignBackendId(read)) {
    case 'outlayer': {
      const config = readOutLayerVerifierConfig(read);
      return config ? createOutLayerBackend(config, dependencies) : null;
    }
  }
}

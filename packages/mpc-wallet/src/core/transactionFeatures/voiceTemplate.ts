// The delete of the owner's voice template at the lane's verifier. The Wallet runs it when the
// owner turns VoiceID off or removes it, so the verifier keeps no voice of an owner who stopped
// spoken approvals. It goes through the Seams verify route with the session's credential.

import type { SpeakToSignNetwork } from '@shared/speakToSign/spokenRequest';
import { isPlainObject } from '@shared/utils/validation';
import {
  SPEAK_TO_SIGN_VERIFIER_BACKEND,
  type SpeakToSignVerifierBackend,
} from './verifiers/backend';
import { readVerifyStream } from './verifyStream';

const VERIFY_PATH = '/speak-to-sign/v1/verify';

export type VoiceTemplateDeletion =
  /** The verifier deleted a template, or had none. */
  | Readonly<{ kind: 'deleted'; hadTemplate: boolean }>
  /**
   * Nothing to delete here: the backend keeps its templates where the Wallet cannot reach them,
   * the lane has no verify route (404), or its verifier is another backend (409).
   */
  | Readonly<{ kind: 'unsupported' }>
  | Readonly<{ kind: 'failed'; code: string }>;

export async function deleteVoiceTemplate(
  input: Readonly<{
    serverUrl: string;
    operationCredential: string;
    network: SpeakToSignNetwork;
    owner: string;
    fetch: typeof fetch;
    backend?: SpeakToSignVerifierBackend;
  }>,
): Promise<VoiceTemplateDeletion> {
  const backend = input.backend ?? SPEAK_TO_SIGN_VERIFIER_BACKEND;
  const deleteInput = backend.templateDeleteInput(input.network, input.owner);
  if (!deleteInput) return { kind: 'unsupported' };
  let response: Response;
  try {
    response = await input.fetch(new URL(VERIFY_PATH, input.serverUrl), {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
        authorization: `Bearer ${input.operationCredential}`,
      },
      body: JSON.stringify({ backend: backend.id, input: deleteInput }),
      credentials: 'omit',
    });
  } catch (error) {
    return { kind: 'failed', code: error instanceof Error ? error.name : 'network' };
  }
  if (response.status === 404 || response.status === 409) return { kind: 'unsupported' };
  if (!response.ok || !response.body) return { kind: 'failed', code: `http_${response.status}` };
  let reply: Awaited<ReturnType<typeof readVerifyStream>>;
  try {
    reply = await readVerifyStream(response.body, () => {});
  } catch {
    return { kind: 'failed', code: 'verify_stream' };
  }
  if (reply.kind === 'failed') return reply;
  const { output } = reply;
  return isPlainObject(output) && typeof output.deleted === 'boolean'
    ? { kind: 'deleted', hadTemplate: output.deleted }
    : { kind: 'failed', code: 'invalid_output' };
}

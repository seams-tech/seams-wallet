// The `text/event-stream` answer of the Seams verify route: `verifier_running` at once, then one
// `verdict` with the verifier output or one `failed` with a code.

import { isPlainObject } from '@shared/utils/validation';
import type { SpeakToSignVerifyReply } from './hostPlugin';

/** Reads the stream until its last event. `onVerifierRunning` runs when the verifier starts. */
export async function readVerifyStream(
  body: ReadableStream<Uint8Array>,
  onVerifierRunning: () => void,
): Promise<SpeakToSignVerifyReply> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { kind: 'failed', code: 'verify_stream_ended' };
      buffer += decoder.decode(value, { stream: true });
      for (let end = buffer.indexOf('\n\n'); end >= 0; end = buffer.indexOf('\n\n')) {
        const event = readEvent(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event === 'verifier_running') onVerifierRunning();
        else if (event) return event;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** The OutLayer attestation record of the call: an HTTPS URL of a call's record, else null. */
function attestationUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const record = /^\/(?:.*\/)?attestations\/by-call\/[0-9a-f-]{1,64}$/;
    return url.protocol === 'https:' && record.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}

function readEvent(block: string): SpeakToSignVerifyReply | 'verifier_running' | null {
  let name = '';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) name = line.slice('event: '.length);
    else if (line.startsWith('data: ')) data += line.slice('data: '.length);
  }
  if (name === 'verifier_running') return name;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (name === 'verdict' && isPlainObject(parsed) && parsed.ok === true && 'output' in parsed) {
    return {
      kind: 'output',
      output: parsed.output,
      attestationUrl: attestationUrl(parsed.attestationUrl),
    };
  }
  if (name !== 'failed') return null;
  const code = isPlainObject(parsed) && typeof parsed.code === 'string' ? parsed.code : '';
  return { kind: 'failed', code: code || 'verifier_failed' };
}

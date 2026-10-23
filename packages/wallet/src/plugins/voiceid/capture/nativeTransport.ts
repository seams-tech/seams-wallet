const LOCAL_BRIDGE_URL = 'http://127.0.0.1:4318/voiceid';
const MAXIMUM_PENDING_BYTES = 2 * 4096 + 16;

/** One NDJSON exchange with the local VoiceID host. The caller owns its deadline. */
export async function streamVoiceIdNative(
  request: unknown,
  signal: AbortSignal,
  receive: (value: unknown) => boolean,
): Promise<void> {
  const response = await fetch(LOCAL_BRIDGE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-voiceid-protocol': 'v1',
    },
    body: JSON.stringify(request),
    cache: 'no-store',
    credentials: 'omit',
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error('VoiceID local service rejected the Wallet request.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      if (pending.length > MAXIMUM_PENDING_BYTES) {
        throw new Error('VoiceID returned an invalid message.');
      }
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        let value: unknown;
        try {
          value = JSON.parse(pending.slice(0, newline));
        } catch {
          throw new Error('VoiceID returned an invalid message.');
        }
        pending = pending.slice(newline + 1);
        if (receive(value)) return;
        newline = pending.indexOf('\n');
      }
    }
    throw new Error('VoiceID local service closed before a result.');
  } finally {
    reader.releaseLock();
  }
}

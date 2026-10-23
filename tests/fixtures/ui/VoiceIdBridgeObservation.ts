import { isPlainObject } from '@shared/utils/validation';

type VoiceOutcome = 'approved' | 'cancelled' | 'rejected' | 'failed';
const BRIDGE_URL = 'http://127.0.0.1:4318/voiceid';
const outcomes: VoiceOutcome[] = [];
let installed = false;
let originalFetch: typeof window.fetch;

function install(): void {
  if (installed) return;
  originalFetch = window.fetch.bind(window);
  window.fetch = observeFetch;
  installed = true;
}

async function observeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await originalFetch(input, init);
  if (requestUrl(input) === BRIDGE_URL && init?.method === 'POST') {
    void observeResponse(response.clone());
  }
  return response;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function observeResponse(response: Response): Promise<void> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    return;
  }
  for (const line of body.trim().split('\n')) {
    if (!line) continue;
    const message: unknown = JSON.parse(line);
    if (!isPlainObject(message) || message.kind !== 'result') continue;
    switch (message.outcome) {
      case 'approved':
      case 'cancelled':
      case 'rejected':
      case 'failed':
        outcomes.push(message.outcome);
        break;
      default:
        throw new Error('VoiceID returned an unknown outcome.');
    }
  }
}

function readOutcomes(): readonly VoiceOutcome[] {
  return [...outcomes];
}

declare global {
  interface Window {
    voiceBridgeObservation: { install: typeof install; outcomes: typeof readOutcomes };
  }
}
window.voiceBridgeObservation = { install, outcomes: readOutcomes };

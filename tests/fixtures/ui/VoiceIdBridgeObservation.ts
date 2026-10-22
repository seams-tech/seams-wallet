import { isPlainObject } from '@shared/utils/validation';

type VoiceOutcome = 'approved' | 'cancelled' | 'rejected' | 'failed';
type ObservedPort = { onMessage: { addListener(listener: (message: unknown) => void): void } };
type Connect = (...args: unknown[]) => ObservedPort;
const outcomes: VoiceOutcome[] = [];

function install(): void {
  const runtime = Reflect.get(Reflect.get(window, 'chrome'), 'runtime');
  const connect: Connect = runtime.connect.bind(runtime);
  runtime.connect = observeConnection.bind(null, connect);
}

function observeConnection(connect: Connect, ...args: unknown[]): ObservedPort {
  const port = connect(...args);
  port.onMessage.addListener(observeReply);
  return port;
}

function observeReply(message: unknown): void {
  if (!isPlainObject(message) || message.kind !== 'result') return;
  switch (message.outcome) {
    case 'approved':
    case 'cancelled':
    case 'rejected':
    case 'failed':
      outcomes.push(message.outcome);
      return;
    default:
      throw new Error('VoiceID returned an unknown outcome.');
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

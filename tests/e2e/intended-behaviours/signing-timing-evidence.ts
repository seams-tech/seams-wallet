import { expect, type ConsoleMessage } from '@playwright/test';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';

export class IntendedActionTiming {
  readonly startedAt = performance.now();
  pageReadyAt = this.startedAt;
  actionObservedAt = this.startedAt;
  completedAt: number | null = null;
  automationFinishedAt: number | null = null;
  settledAt: number | null = null;

  complete<T>(result: T): T {
    this.completedAt = performance.now();
    return result;
  }

  evidence() {
    if (this.completedAt === null || this.automationFinishedAt === null || this.settledAt === null) {
      throw new Error('Expected completed action timing');
    }
    return {
      pageSetupMs: this.pageReadyAt - this.startedAt,
      clickAndStartObservationMs: this.actionObservedAt - this.pageReadyAt,
      actionCompletionObservedMs: this.completedAt - this.startedAt,
      automationDrainMs: this.automationFinishedAt - this.completedAt,
      confirmationSettlementMs: this.settledAt - this.automationFinishedAt,
      totalMs: this.settledAt - this.startedAt,
    };
  }
}

type TimingEvent = {
  readonly receivedAtMs: number;
  readonly stage: string;
  readonly durationMs: number;
};

export class SigningTimingEvidence {
  private readonly events: TimingEvent[] = [];

  record(message: ConsoleMessage): void {
    const text = message.text();
    const prefix = text.startsWith('[SigningFlow][evm-family] ')
      ? '[SigningFlow][evm-family] '
      : '[Intended ECDSA benchmark] ';
    if (!text.startsWith(prefix)) return;
    const event: unknown = JSON.parse(text.slice(prefix.length));
    if (!isPlainObject(event) ||
        (event.event !== 'ecdsa_signing_timing' && event.event !== 'ecdsa_sdk_call')) return;
    if (typeof event.durationMs !== 'number' || !Number.isFinite(event.durationMs) ||
        event.durationMs < 0) throw new Error('Invalid ECDSA diagnostic duration');
    const stage = event.event === 'ecdsa_sdk_call' ? 'public_sdk_call' : event.stage;
    if (typeof stage !== 'string') throw new Error('Missing ECDSA timing stage');
    this.events.push({ receivedAtMs: performance.now(), stage, durationMs: event.durationMs });
  }

  window(startedAt: number, endedAt: number) {
    const events = [];
    for (const event of this.events) {
      if (event.receivedAtMs < startedAt || event.receivedAtMs > endedAt) continue;
      events.push({
        stage: event.stage,
        durationMs: event.durationMs,
        receivedOffsetMs: event.receivedAtMs - startedAt,
      });
    }
    const sdk = events.filter(isPublicSdkCall);
    expect(sdk).toHaveLength(1);
    expect(events.some(isCommitTotal)).toBe(true);
    const sdkMs = sdk[0].durationMs;
    expect(sdkMs).toBeLessThanOrEqual(endedAt - startedAt);
    return {
      publicSdkCallMs: sdkMs,
      outsidePublicSdkCallMs: endedAt - startedAt - sdkMs,
      stages: events,
      accounting: 'Stages overlap; receive offsets use the observer clock. Public SDK time includes confirmation.',
    };
  }
}

function isPublicSdkCall(event: { readonly stage: string }): boolean {
  return event.stage === 'public_sdk_call';
}

function isCommitTotal(event: { readonly stage: string }): boolean {
  return event.stage === 'commit_total';
}

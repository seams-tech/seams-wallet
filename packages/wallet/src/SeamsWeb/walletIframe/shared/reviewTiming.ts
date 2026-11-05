/**
 * User Timing measures for the reviewed transaction path, named `seams:review:<step>`.
 * They show in the browser's performance panel for the frame that records them, and
 * `performance.getEntriesByName('seams:review:<step>')` reads them in that frame.
 * They record durations only, never transaction contents.
 */

export type ReviewTimingStep =
  | 'review_open'
  | 'continue_session_read'
  | 'owner_connection_check'
  | 'owner_affordability'
  | 'host_until_card_ready';

export type ReviewTiming = { end(): void };

const PREFIX = 'seams:review:';
let sequence = 0;

export function startReviewTiming(step: ReviewTimingStep): ReviewTiming {
  const performance = globalThis.performance;
  if (!performance?.mark || !performance.measure) return NO_TIMING;
  sequence += 1;
  const start = `${PREFIX}${step}:start:${sequence}`;
  try {
    performance.mark(start);
  } catch {
    return NO_TIMING;
  }
  return new MeasuredReviewTiming(`${PREFIX}${step}`, start);
}

class MeasuredReviewTiming implements ReviewTiming {
  private ended = false;

  constructor(
    private readonly name: string,
    private readonly start: string,
  ) {}

  end(): void {
    if (this.ended) return;
    this.ended = true;
    try {
      performance.measure(this.name, this.start);
      performance.clearMarks(this.start);
    } catch {}
  }
}

const NO_TIMING: ReviewTiming = { end() {} };

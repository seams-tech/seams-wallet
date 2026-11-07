/**
 * User Timing measures for the reviewed and the direct approval paths, named
 * `seams:review:<step>`. They show in the browser's performance panel for the frame that
 * records them, and `performance.getEntriesByName('seams:review:<step>')` reads them in
 * that frame. They record durations only, never transaction contents.
 */

export type ReviewTimingStep =
  | 'review_open'
  | 'continue_session_read'
  | 'host_runtime_load'
  | 'owner_connection_check'
  | 'owner_affordability'
  | 'owner_admission'
  | 'owner_card_preparation'
  | 'host_until_card_ready';

export type ReviewTiming = { end(): void };

/** A measure that ends when a confirmation card first shows its final content. */
export type CardTiming = ReviewTiming & { discard(): void };

const awaitingCard = new Set<CardTiming>();

export function startCardTiming(step: ReviewTimingStep): CardTiming {
  const timing = new PendingCardTiming(startReviewTiming(step));
  awaitingCard.add(timing);
  return timing;
}

/** The confirmation surface calls this when its card first shows final content. */
export function endCardTimings(): void {
  for (const timing of awaitingCard) timing.end();
}

class PendingCardTiming implements CardTiming {
  constructor(private readonly timing: ReviewTiming) {}

  end(): void {
    if (!awaitingCard.delete(this)) return;
    this.timing.end();
  }

  /** A request that ends before its card shows records nothing. */
  discard(): void {
    awaitingCard.delete(this);
  }
}

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

import type { RouterAbEcdsaDerivationClientPresignatureRefillScheduleResult } from './presignaturePool';

const scheduled: RouterAbEcdsaDerivationClientPresignatureRefillScheduleResult = {
  scheduled: true,
  reason: 'scheduled',
  depth: 0,
  targetDepth: 2,
};

const skipped: RouterAbEcdsaDerivationClientPresignatureRefillScheduleResult = {
  scheduled: false,
  reason: 'in_flight_for_pool_key',
  depth: 0,
  targetDepth: 2,
};

void scheduled;
void skipped;

// @ts-expect-error A scheduled refill cannot carry an unscheduled reason.
const scheduledWithSkippedReason: RouterAbEcdsaDerivationClientPresignatureRefillScheduleResult = {
  scheduled: true,
  reason: 'in_flight_for_pool_key',
  depth: 0,
  targetDepth: 2,
};

// @ts-expect-error A skipped refill cannot carry the scheduled reason.
const skippedWithScheduledReason: RouterAbEcdsaDerivationClientPresignatureRefillScheduleResult = {
  scheduled: false,
  reason: 'scheduled',
  depth: 0,
  targetDepth: 2,
};

void scheduledWithSkippedReason;
void skippedWithScheduledReason;

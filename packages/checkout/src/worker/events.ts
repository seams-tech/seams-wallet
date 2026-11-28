import { SIGNATURE_HEADER } from '../shared/events';
import { signTimestamped } from '../shared/signature';
import { eventSecretSlot, projectConfig, type CheckoutContext } from './context';
import { getProject, listDueEvents, recordEventDelivery, type EventRow } from './store';
import { unseal } from './vault';

const DELIVERY_TIMEOUT_MS = 10_000;
const FIRST_RETRY_MS = 30_000;
const LONGEST_RETRY_MS = 60 * 60_000;
const BATCH = 25;

/** The wait before the next delivery: it doubles from 30 seconds up to one hour. */
function retryDelayMs(attempts: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** Math.min(attempts, 10), LONGEST_RETRY_MS);
}

async function deliver(context: CheckoutContext, event: EventRow): Promise<boolean> {
  const project = await getProject(context.db, event.project_id);
  const url = project ? projectConfig(project).eventUrl : null;
  if (!project || !url) return false;
  const secret = await unseal(
    context.keys.events,
    eventSecretSlot(event.project_id),
    project.event_secret_sealed,
  );
  try {
    const response = await context.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: await signTimestamped(secret, event.payload_json, context.now()),
      },
      body: event.payload_json,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Sends each due event to its merchant, signed. An event stays due until the merchant's server
 * answers 2xx, and the wait between two tries grows up to one hour.
 */
export async function deliverDueEvents(context: CheckoutContext): Promise<void> {
  for (const event of await listDueEvents(context.db, context.now(), BATCH)) {
    const delivered = await deliver(context, event);
    const nowMs = context.now();
    const next = delivered ? null : nowMs + retryDelayMs(event.delivery_attempts);
    await recordEventDelivery(context.db, event.event_id, nowMs, next);
  }
}

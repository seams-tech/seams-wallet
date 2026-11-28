import { hasExactKeys } from '@shared/utils/exactKeys';
import { isPlainObject, isString } from '@shared/utils/validation';
import { isCheckoutMethod, type CheckoutMethod } from '../shared/methods';
import type { D1 } from './d1';
import type { PaymentRail, RailAccount, RailModule } from './rails/rail';
import { getRailAccount, type ProjectRow } from './store';
import { unseal } from './vault';

/** The Worker's own secrets. None of them is a provider key, an account key or a wallet key. */
export type CheckoutKeys = {
  /** Makes the client tokens of the orders. */
  readonly clientToken: string;
  /** Encrypts the secrets that sign the events for the merchants. 32 bytes, base64url. */
  readonly events: string;
  /**
   * One encryption key for each rail, 32 bytes, base64url. A provider key opens only with the
   * key of its own rail.
   */
  readonly rails: Readonly<Record<string, string>>;
};

export type CheckoutContext = {
  readonly db: D1;
  readonly rails: ReadonlyMap<string, RailModule>;
  readonly keys: CheckoutKeys;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  /** The origin of the checkout frame. A provider sends the customer back to a page of it. */
  readonly checkoutOrigin: string;
};

/** The configuration of one project. It lives on the server: the browser cannot change it. */
export type ProjectConfig = {
  /** The rail of each method. A method with no rail does not appear. */
  readonly routing: Readonly<Partial<Record<CheckoutMethod, string>>>;
  /** Where the merchant's server receives the order events. */
  readonly eventUrl: string | null;
};

function isEventUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return url.protocol === 'https:' || (url.protocol === 'http:' && local);
}

/** Checks a configuration from the operator against the rails that this Worker loads. */
export function parseProjectConfig(
  input: unknown,
  rails: ReadonlyMap<string, RailModule>,
): ProjectConfig {
  if (!hasExactKeys(input, ['routing', 'eventUrl']) || !isPlainObject(input.routing)) {
    throw new Error('A project configuration has a routing table and an eventUrl');
  }
  const routing: Partial<Record<CheckoutMethod, string>> = {};
  for (const [method, railId] of Object.entries(input.routing)) {
    if (!isCheckoutMethod(method)) throw new Error(`Unknown method ${method}`);
    const rail = isString(railId) ? rails.get(railId) : undefined;
    if (!rail?.methods.has(method)) {
      throw new Error(`No loaded rail ${String(railId)} takes the method ${method}`);
    }
    routing[method] = rail.id;
  }
  const { eventUrl } = input;
  if (eventUrl !== null && !(isString(eventUrl) && isEventUrl(eventUrl))) {
    throw new Error('The eventUrl is an https URL, or null');
  }
  return { routing, eventUrl };
}

export function projectConfig(project: ProjectRow): ProjectConfig {
  return JSON.parse(project.config_json) as ProjectConfig;
}

export function railAccountSlot(projectId: string, railId: string): string {
  return `rail-account:${projectId}:${railId}`;
}

export function eventSecretSlot(projectId: string): string {
  return `event-secret:${projectId}`;
}

export function railModule(context: CheckoutContext, railId: string): RailModule {
  const rail = context.rails.get(railId);
  if (!rail) throw new Error(`The Worker does not load the rail ${railId}`);
  return rail;
}

export function railEncryptionKey(context: CheckoutContext, railId: string): string {
  const key = context.keys.rails[railModule(context, railId).id];
  if (!key) throw new Error(`The Worker has no encryption key for the rail ${railId}`);
  return key;
}

/** The rail of a project, connected to the merchant's account. Null when no account is set. */
export async function connectRail(
  context: CheckoutContext,
  projectId: string,
  railId: string,
): Promise<PaymentRail | null> {
  const row = await getRailAccount(context.db, projectId, railId);
  if (!row) return null;
  const secrets = await unseal(
    railEncryptionKey(context, railId),
    railAccountSlot(projectId, railId),
    row.secrets_sealed,
  );
  const account: RailAccount = { public: JSON.parse(row.public_json), secrets: JSON.parse(secrets) };
  return railModule(context, railId).connect(account, { fetch: context.fetch, now: context.now });
}

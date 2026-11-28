import { CHECKOUT_ROUTES } from '../shared/api';
import { projectConfig, type CheckoutContext } from './context';
import { CheckoutError, loadOrder, orderView, settleOrder } from './payments';
import { refundOrder } from './refunds';
import {
  clearReview,
  getOrder,
  getProject,
  listProjectOrderIds,
  listRailAccounts,
  listUnexpectedPayments,
} from './store';

const PAGE = 50;

/**
 * What the operator's screens read and do for one project: the configuration, the connected
 * accounts with their webhook URLs, the orders, and the review of unexpected payments. No
 * answer holds a provider key.
 */
export async function operatorRead(
  context: CheckoutContext,
  projectId: string,
  segments: readonly string[],
  query: URLSearchParams,
): Promise<unknown> {
  const project = await getProject(context.db, projectId);
  if (!project) throw new CheckoutError('not_found', 'No such project');
  const [area, orderId] = segments;
  if (!area) {
    const accounts = await listRailAccounts(context.db, projectId);
    return {
      projectId,
      config: projectConfig(project),
      // Each rail that this Worker loads, with the methods that a route can send to it.
      rails: [...context.rails.values()].map((rail) => ({ rail: rail.id, methods: [...rail.methods] })),
      accounts: accounts.map((account) => ({
        rail: account.rail_id,
        public: JSON.parse(account.public_json),
        // The merchant gives this URL to the provider.
        webhookUrl: `${context.checkoutOrigin}${CHECKOUT_ROUTES.webhooks}/${account.rail_id}/${projectId}`,
      })),
    };
  }
  if (area !== 'orders') throw new CheckoutError('not_found', 'No such route');
  if (!orderId) {
    const before = Number(query.get('before')) || Number.MAX_SAFE_INTEGER;
    const ids = await listProjectOrderIds(context.db, projectId, {
      needsReview: query.get('needsReview') === '1',
      beforeMs: before,
      limit: PAGE,
    });
    const orders = [];
    for (const id of ids) orders.push(orderView(await settleOrder(context, id)));
    return { orders };
  }
  const order = await projectOrder(context, projectId, orderId);
  return {
    order: orderView(await settleOrder(context, order)),
    unexpectedPayments: await listUnexpectedPayments(context.db, order),
  };
}

async function projectOrder(context: CheckoutContext, projectId: string, orderId: string): Promise<string> {
  const order = await getOrder(context.db, orderId);
  if (order?.project_id !== projectId) throw new CheckoutError('not_found', 'No such order');
  return orderId;
}

/** An action of the operator on one order: a refund, or the end of a review. */
export async function operatorAct(
  context: CheckoutContext,
  projectId: string,
  segments: readonly string[],
  body: unknown,
): Promise<unknown> {
  const [area, orderId, action] = segments;
  if (area !== 'orders' || !orderId) throw new CheckoutError('not_found', 'No such route');
  const order = await projectOrder(context, projectId, orderId);
  if (action === 'refunds') return orderView(await refundOrder(context, order, body));
  if (action === 'review') {
    // The merchant refunded or accepted the unexpected payments. The records stay.
    await clearReview(context.db, order);
    const loaded = await loadOrder(context, order);
    if (loaded) return orderView(loaded);
  }
  throw new CheckoutError('not_found', 'No such route');
}

import { LaneAggregateRevocationApplicationService } from '../../../core/signingLanes/LaneAggregateRevocationApplicationService';
import { LaneEnrollmentRevocation } from '../../../core/signingLanes/LaneEnrollmentRevocation';
import {
  LaneLifecycleApplicationService,
  type LaneLifecycleAuthorizationPortV1,
  type LaneLifecycleCurveExecutionPortsV1,
} from '../../../core/signingLanes/LaneLifecycleApplicationService';
import type { CloudflareDurableObjectNamespaceLike } from '../../../core/types';
import { WalletLaneEnrollmentGateway } from '../../../core/signingLanes/walletLanes/walletLaneEnrollmentGateway';
import type { WalletLaneOwnerV1 } from '../../../core/signingLanes/walletLanes/walletLaneRecords';
import {
  createRemoteWalletLaneStoresV1,
  type WalletLaneStoresV1,
} from '../../../core/signingLanes/walletLanes/walletLaneStoreProtocol';
import { createCloudflareRouterWalletLaneTransportV1 } from '../durableObjects/routerWalletLaneDurableObject';
import {
  LaneLifecycleStoreEcdsaLanePrivateBindingResolverV1,
  type EcdsaLanePrivateBindingResolverPortV1,
  type EcdsaOwnerSourceSignerContinuityPortV1,
} from './cloudflareLaneCurveExecution';
import {
  CloudflareLaneProtocolCommitterV1,
  type CloudflareLaneProtocolCommitterOptionsV1,
} from './cloudflareLaneProtocolCommitter';

/**
 * One wallet's Router lane stores, held by its Router wallet-lane Durable
 * Object. The namespace binding belongs to the Router lane composition; the
 * object name comes from the authenticated owner.
 */
export function createCloudflareRouterWalletLaneStoresV1(input: {
  readonly namespace: CloudflareDurableObjectNamespaceLike;
  readonly owner: WalletLaneOwnerV1;
}): WalletLaneStoresV1 {
  return createRemoteWalletLaneStoresV1({
    owner: input.owner,
    transport: createCloudflareRouterWalletLaneTransportV1(input.namespace),
  });
}

export type WalletLaneLifecycleApplicationServiceOptionsV1 = {
  readonly walletLanes: WalletLaneStoresV1;
  readonly authorization: LaneLifecycleAuthorizationPortV1;
  readonly execution: LaneLifecycleCurveExecutionPortsV1;
};

/**
 * Builds the authenticated server-internal lane lifecycle boundary for one
 * wallet. Routes receive it from their private composition and never expose
 * the receipt methods as a public raw-receipt endpoint.
 */
export function createWalletLaneLifecycleApplicationServiceV1(
  options: WalletLaneLifecycleApplicationServiceOptionsV1,
): LaneLifecycleApplicationService {
  return new LaneLifecycleApplicationService({
    gateway: new WalletLaneEnrollmentGateway({ lifecycleStore: options.walletLanes.lifecycle }),
    authorization: options.authorization,
    execution: options.execution,
  });
}

export function createWalletLaneAggregateRevocationApplicationServiceV1(
  options: WalletLaneLifecycleApplicationServiceOptionsV1,
): LaneAggregateRevocationApplicationService {
  const lifecycleStore = options.walletLanes.lifecycle;
  return new LaneAggregateRevocationApplicationService({
    lifecycleStore,
    laneLifecycle: createWalletLaneLifecycleApplicationServiceV1(options),
    enrollmentRevocation: new LaneEnrollmentRevocation(lifecycleStore),
  });
}

export function createWalletLaneProtocolCommitterV1(
  options: { readonly walletLanes: WalletLaneStoresV1 } & Omit<
    CloudflareLaneProtocolCommitterOptionsV1,
    'gateway'
  >,
): CloudflareLaneProtocolCommitterV1 {
  return new CloudflareLaneProtocolCommitterV1({
    gateway: new WalletLaneEnrollmentGateway({ lifecycleStore: options.walletLanes.lifecycle }),
    authorization: options.authorization,
    execution: options.execution,
    ed25519Transport: options.ed25519Transport,
  });
}

export function createWalletLaneEcdsaLanePrivateBindingResolverV1(
  options: { readonly walletLanes: WalletLaneStoresV1 } & EcdsaOwnerSourceSignerContinuityPortV1,
): EcdsaLanePrivateBindingResolverPortV1 {
  return new LaneLifecycleStoreEcdsaLanePrivateBindingResolverV1(
    options.walletLanes.lifecycle,
    options,
  );
}

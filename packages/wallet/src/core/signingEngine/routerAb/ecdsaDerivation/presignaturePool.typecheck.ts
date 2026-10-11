import type { RouterAbEcdsaDerivationClientPresignatureRefillScheduleResult } from './presignaturePool';
import type { RouterAbEcdsaPresignCredential } from '@/core/rpcClients/relayer/routerAbNormalSigning';
import type { EcdsaClientPresignPoolIdentity } from '../../workerManager/ecdsaPresignPoolIdentity';
import type { Variant } from '@shared/utils/variant';

declare const credentialWithoutGeneration: Omit<
  Variant<RouterAbEcdsaPresignCredential, 'kind', 'wallet_session_opaque'>,
  'ownershipGeneration'
>;
declare const poolWithoutGeneration: Omit<EcdsaClientPresignPoolIdentity, 'ownershipGeneration'>;
// @ts-expect-error Refills must retain the admitted credential generation.
const unboundCredential: RouterAbEcdsaPresignCredential = { ...credentialWithoutGeneration };
// @ts-expect-error Worker pool identity must retain the ownership generation.
const unboundPool: EcdsaClientPresignPoolIdentity = { ...poolWithoutGeneration };
void unboundCredential;
void unboundPool;

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

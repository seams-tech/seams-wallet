import type { RouterAbEd25519YaoHttpTransportConfigV1 } from '../../packages/wallet/src/core/signingEngine/threshold/ed25519/yaoClient';

declare const config: RouterAbEd25519YaoHttpTransportConfigV1;
declare const withoutRouting: Omit<RouterAbEd25519YaoHttpTransportConfigV1, 'routing'>;
// @ts-expect-error Callers must choose a known home or explicit discovery.
const missing: RouterAbEd25519YaoHttpTransportConfigV1 = withoutRouting;
const erased: RouterAbEd25519YaoHttpTransportConfigV1 = {
  ...config,
  // @ts-expect-error A spread cannot erase required routing context.
  routing: undefined,
};
const invalidRegion: RouterAbEd25519YaoHttpTransportConfigV1 = {
  ...config,
  // @ts-expect-error A regional route requires a supported region.
  routing: { kind: 'regional', region: 'unknown' },
};
void missing;
void erased;
void invalidRegion;

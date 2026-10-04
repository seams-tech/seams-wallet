import type { WalletSession } from '@/core/types/seams';

export function buildAnonymousWalletSession(): WalletSession {
  return {
    appIdentity: { kind: 'anonymous' },
    authentication: { kind: 'signed_out' },
    capabilityProjection: { kind: 'not_requested' },
    nonceDiagnostics: null,
  };
}

import type { SeamsConfigsReadonly } from '@/core/types/seams';

type EmailOtpRuntimeConfigPorts = {
  configs: SeamsConfigsReadonly;
  getRpId: () => string | null;
};

export class EmailOtpRuntimeConfig {
  constructor(private readonly ports: EmailOtpRuntimeConfigPorts) {}

  requireRelayUrl(): string {
    const relayUrl = String(this.ports.configs.network.relayer?.url || '').trim();
    if (!relayUrl) {
      throw new Error('Missing relayer url (configs.network.relayer.url)');
    }
    return relayUrl;
  }

  requireRpId(operation: string): string {
    const rpId = String(this.ports.getRpId() || '').trim();
    if (!rpId) {
      throw new Error(`${operation} requires an RP ID for ECDSA bootstrap`);
    }
    return rpId;
  }
}

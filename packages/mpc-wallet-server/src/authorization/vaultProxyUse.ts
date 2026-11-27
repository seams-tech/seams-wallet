import {
  type CapabilityId,
  type TenantId,
  type VaultId,
  type VaultItemId,
} from '@shared/authorization/capabilityKinds';

type VaultProxyDestination = string & {
  readonly __vaultProxyDestination: true;
};

export type VaultProxySecretRef = {
  readonly tenantId: TenantId;
  readonly capabilityId: CapabilityId;
  readonly vaultId: VaultId;
  readonly itemId: VaultItemId;
  readonly destination: VaultProxyDestination;
};

export interface VaultProxySecretStore {
  openSecret(input: VaultProxySecretRef): Promise<Uint8Array | null>;
}

export function parseVaultProxyDestination(value: unknown): VaultProxyDestination {
  if (typeof value !== 'string' || value.trim() !== value) {
    throw new Error('vault proxy destination must be a canonical HTTPS URL');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('vault proxy destination must be a canonical HTTPS URL');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.href !== value ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error('vault proxy destination must be a canonical HTTPS URL');
  }
  return value as VaultProxyDestination;
}

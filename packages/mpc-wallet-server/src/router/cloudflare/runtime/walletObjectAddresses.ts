import { isPlainObject } from '@shared/utils/validation';
import type { WalletId } from '@shared/utils/domainIds';
import { parseWalletId } from '@shared/utils/domainIds';

export const WALLET_OBJECT_IDENTITY_HEADER = 'x-seams-wallet-object-identity';
export const WALLET_OBJECT_ADDRESSES_HEADER = 'x-seams-wallet-object-addresses';

/** Opaque addresses select custody objects. They confer no execution authority. */
export class WalletObjectAddresses {
  private constructor(
    private readonly values: {
      readonly router: string;
      readonly deriver_a: string;
      readonly deriver_b: string;
      readonly signing_worker: string;
    },
  ) {}

  get router(): string {
    return this.values.router;
  }
  get deriver_a(): string {
    return this.values.deriver_a;
  }
  get deriver_b(): string {
    return this.values.deriver_b;
  }
  get signing_worker(): string {
    return this.values.signing_worker;
  }
  toJSON() {
    return this.values;
  }

  static parse(raw: unknown): WalletObjectAddresses {
    if (!isPlainObject(raw)) throw new Error('Wallet object addresses are missing');
    return new WalletObjectAddresses({
      router: parseObjectId(raw.router),
      deriver_a: parseObjectId(raw.deriver_a),
      deriver_b: parseObjectId(raw.deriver_b),
      signing_worker: parseObjectId(raw.signing_worker),
    });
  }
}

export type WalletObjectTenant = {
  readonly orgId: string;
  readonly projectId: string;
  readonly envId: string;
};

export type WalletObjectIdentity = WalletObjectTenant & {
  readonly walletId: WalletId;
  readonly ownershipGeneration: number;
};

/** A request-local read of immutable addresses for one wallet generation. */
export class WalletObjectAddressSnapshot {
  private constructor(
    private readonly namespace: string,
    private readonly identity: WalletObjectIdentity,
    private readonly addresses: WalletObjectAddresses,
  ) {}

  static parse(
    raw: unknown,
    namespace: string,
    tenant: WalletObjectTenant,
  ): WalletObjectAddressSnapshot {
    if (!isPlainObject(raw)) throw new Error('Wallet object address snapshot is missing');
    return new WalletObjectAddressSnapshot(
      tenantPart(namespace),
      walletObjectIdentity(raw.wallet_id, raw.ownership_generation, tenant),
      WalletObjectAddresses.parse(raw),
    );
  }

  resolve(namespace: string, identity: WalletObjectIdentity): WalletObjectAddresses | null {
    const observed = this.identity;
    if (
      namespace !== this.namespace ||
      identity.walletId !== observed.walletId ||
      identity.ownershipGeneration !== observed.ownershipGeneration ||
      identity.orgId !== observed.orgId ||
      identity.projectId !== observed.projectId ||
      identity.envId !== observed.envId
    ) {
      return null;
    }
    return this.addresses;
  }
}

export function walletObjectIdentity(
  wallet: unknown,
  generation: unknown,
  tenant: { readonly [Key in keyof WalletObjectTenant]: unknown },
): WalletObjectIdentity {
  const parsed = parseWalletId(wallet);
  if (
    !parsed.ok ||
    typeof generation !== 'number' ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  ) {
    throw new Error('Wallet object identity requires a wallet and ownership generation');
  }
  return {
    walletId: parsed.value,
    ownershipGeneration: generation,
    orgId: tenantPart(tenant.orgId),
    projectId: tenantPart(tenant.projectId),
    envId: tenantPart(tenant.envId),
  };
}

export function walletObjectIdentityHeaders(
  identity: WalletObjectIdentity,
): Record<string, string> {
  return { [WALLET_OBJECT_IDENTITY_HEADER]: JSON.stringify(identity) };
}

export function readWalletObjectIdentityHeader(headers: Headers): WalletObjectIdentity | null {
  const raw = headers.get(WALLET_OBJECT_IDENTITY_HEADER);
  if (raw === null) return null;
  if (raw.length > 1024) throw new Error('Wallet object identity is too large');
  const value: unknown = JSON.parse(raw);
  if (!isPlainObject(value)) throw new Error('Wallet object identity is malformed');
  return walletObjectIdentity(value.walletId, value.ownershipGeneration, {
    orgId: value.orgId,
    projectId: value.projectId,
    envId: value.envId,
  });
}

function parseObjectId(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/u.test(raw)) {
    throw new Error('Wallet object address must be a Durable Object ID');
  }
  return raw;
}

function tenantPart(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value)
    throw new Error('Wallet object tenant is invalid');
  return value;
}

export function walletObjectIdentityFromWireScope(
  scope: unknown,
  generation: unknown,
): WalletObjectIdentity {
  if (!isPlainObject(scope)) throw new Error('Wallet object scope is missing');
  return walletObjectIdentity(scope.wallet_id, generation, {
    orgId: scope.org_id,
    projectId: scope.project_id,
    envId: scope.project_environment_id,
  });
}

export function walletRelocationObjectIdentity(
  wallet: Record<string, unknown>,
  generation: unknown,
): WalletObjectIdentity {
  return walletObjectIdentity(wallet.walletId, generation, {
    orgId: wallet.organizationId,
    projectId: wallet.projectId,
    envId: wallet.environmentId,
  });
}

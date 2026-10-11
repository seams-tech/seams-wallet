import { WalletObjectAddresses, WalletObjectAddressSnapshot } from '../../packages/wallet-server/src/router/cloudflare/runtime/walletObjectAddresses';

const raw = {
  router: 'untrusted',
  deriver_a: 'untrusted',
  deriver_b: 'untrusted',
  signing_worker: 'untrusted',
};

// Addresses enter the domain only through the boundary parser.
// @ts-expect-error A raw object is not a validated address set.
const fromLiteral: WalletObjectAddresses = raw;
// @ts-expect-error The constructor is private.
const fromConstructor = new WalletObjectAddresses(raw);
const parsed = WalletObjectAddresses.parse(raw);
// @ts-expect-error Spreading validated addresses loses their private state.
const fromSpread: WalletObjectAddresses = { ...parsed };
// @ts-expect-error One role cannot be omitted.
const incomplete: WalletObjectAddresses = { router: parsed.router };
void [fromLiteral, fromConstructor, fromSpread, incomplete];

// @ts-expect-error A snapshot cannot be supplied as a raw record.
const rawSnapshot: WalletObjectAddressSnapshot = { ...raw, wallet_id: 'wallet:a', ownership_generation: 1 };
const snapshot = WalletObjectAddressSnapshot.parse(raw, 'namespace', { orgId: 'org', projectId: 'project', envId: 'env' });
// @ts-expect-error A spread loses the snapshot's private identity binding.
const copiedSnapshot: WalletObjectAddressSnapshot = { ...snapshot };
void [rawSnapshot, copiedSnapshot];

import { expect, test } from '@playwright/test';
import type { NearClient } from '@/core/rpcClients/near/NearClient';
import type { EvmClient } from '@/core/rpcClients/evm/EvmClient';
import { assetsForChain, listedErc20Token, listedNearToken } from '@/core/assets/assetList';
import { nearSpendableBalance } from '@/core/assets/nearBalance';
import { readAssetBalances } from '@/core/assets/readAssetBalances';
import {
  maxSendBaseUnits,
  nearSendTransaction,
  parseSendAmount,
  parseSendRecipient,
  prepareSend,
} from '@/core/assets/send';
import {
  createAssetsCapability,
  registerAssetScreens,
  type AssetScreenRequest,
} from '@/SeamsWeb/publicApi/assets';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import { ownerNearShortfall } from '@/SeamsWeb/walletIframe/host/ownerNearAffordability';
import { formatAssetAmount } from '@/react/components/AccountMenuButton/assets/assetFormat';

const NEAR = 10n ** 24n;
const STORAGE_BYTE = 10n ** 19n;

type FakeNearReads = {
  account?: { amount: string; locked: string; storage_usage: number } | 'missing' | 'down';
  tokens?: Readonly<Record<string, unknown>>;
  storage?: Readonly<Record<string, unknown>>;
  existing?: readonly string[];
};

function fakeNearClient(reads: FakeNearReads): NearClient {
  const client = {
    async viewAccount(accountId: string) {
      if (reads.existing && !reads.existing.includes(accountId)) {
        throw new Error(`[UNKNOWN_ACCOUNT] account ${accountId} does not exist`);
      }
      if (reads.account === 'missing') {
        throw new Error(`[UNKNOWN_ACCOUNT] account ${accountId} does not exist`);
      }
      if (reads.account === 'down') throw new Error('socket hang up');
      return reads.account ?? { amount: '0', locked: '0', storage_usage: 0 };
    },
    async view(params: {
      account: string;
      method: string;
      args: unknown;
      decodeResult: (value: unknown) => unknown;
    }) {
      if (params.method === 'ft_balance_of') {
        const value = reads.tokens?.[params.account];
        if (value instanceof Error) throw value;
        return params.decodeResult(value ?? '0');
      }
      const value = reads.storage?.[`${params.account}:${params.method}`];
      if (value instanceof Error) throw value;
      return params.decodeResult(value);
    },
  };
  return client as unknown as NearClient;
}

function fakeEvmClient(results: Readonly<Record<string, unknown>>): EvmClient {
  return {
    async request(args: { method: string; params: unknown[] }) {
      const key =
        args.method === 'eth_call'
          ? `eth_call:${(args.params[0] as { to: string }).to}`
          : args.method;
      const value = results[key];
      if (value instanceof Error) throw value;
      return value;
    },
  } as unknown as EvmClient;
}

test('the spendable NEAR balance keeps the storage that the locked stake does not cover', () => {
  const account = { amount: (5n * NEAR).toString(), locked: '0', storage_usage: 1_000 };
  const balance = nearSpendableBalance(account);
  expect(balance.storageReserve).toBe(1_000n * STORAGE_BYTE);
  expect(balance.spendable).toBe(5n * NEAR - 1_000n * STORAGE_BYTE);
  expect(balance.reserved).toBe(1_000n * STORAGE_BYTE);
  expect(balance.shortOfStorage).toBe(false);

  const staked = nearSpendableBalance({ ...account, locked: (1n * NEAR).toString() });
  expect(staked.spendable).toBe(5n * NEAR);
  expect(staked.reserved).toBe(0n);

  const short = nearSpendableBalance({ amount: '1', locked: '0', storage_usage: 1_000 });
  expect(short.spendable).toBe(0n);
  expect(short.shortOfStorage).toBe(true);
});

test('the owner shortfall check keeps both NEAR balance rules after the shared math', async () => {
  const transaction = {
    receiverId: 'bob.near',
    actions: [{ action_type: 'Transfer', deposit: (1n * NEAR).toString() }],
  } as unknown as Parameters<typeof ownerNearShortfall>[2];
  const client = (amount: bigint, storageUsage: number) =>
    ({
      async viewAccount() {
        return { amount: amount.toString(), locked: '0', storage_usage: storageUsage };
      },
      async gasPurchasePrice() {
        return 100_000_000n;
      },
    }) as unknown as Parameters<typeof ownerNearShortfall>[0];

  expect(await ownerNearShortfall(client(2n * NEAR, 1_000), 'alice.near', transaction)).toBeNull();
  const shortfall = await ownerNearShortfall(client(1n * NEAR, 1_000), 'alice.near', transaction);
  expect(shortfall?.storageReserve).toBe((1_000n * STORAGE_BYTE).toString());
  expect(shortfall?.balance).toBe((1n * NEAR).toString());
});

test('the transfer review still reads token names from the shared asset list', () => {
  expect(listedNearToken('mainnet', 'usdt.tether-token.near')).toEqual({
    symbol: 'USDt',
    decimals: 6,
  });
  expect(listedNearToken('mainnet', 'zec.omft.near')).toEqual({ symbol: 'ZEC', decimals: 8 });
  expect(listedNearToken('testnet', 'zec.omft.near')).toBeUndefined();
  expect(listedErc20Token(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toEqual({
    symbol: 'USDC',
    decimals: 6,
  });
  expect(listedErc20Token(8453, '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')?.symbol).toBe('USDC');
});

test('Settings lists the eight main assets on NEAR mainnet and the testnet subset', () => {
  const mainnet = assetsForChain({ network: 'near-mainnet' }).filter((asset) => asset.primary);
  expect(mainnet.map((asset) => asset.symbol)).toEqual([
    'NEAR',
    'stNEAR',
    'USDC',
    'USDt',
    'ETH',
    'BTC',
    'SOL',
    'ZEC',
  ]);
  const testnet = assetsForChain({ network: 'near-testnet' }).filter((asset) => asset.primary);
  expect(testnet.map((asset) => asset.symbol)).toEqual(['NEAR', 'stNEAR', 'USDC']);
  // Arc pays gas in USDC, so its native balance is not listed a second time.
  const arc = assetsForChain({ network: 'arc-testnet', chainId: 5042002 });
  expect(arc.map((asset) => `${asset.kind}:${asset.symbol}`)).toEqual(['erc20:USDC']);
  expect(assetsForChain({ network: 'tempo-testnet', chainId: 42431 })).toEqual([]);
});

test('a failed balance read is unavailable, never zero', async () => {
  const balances = await readAssetBalances(
    {
      chains: [
        { network: 'near-testnet', rpcUrl: 'https://near.invalid' },
        { network: 'arc-testnet', rpcUrl: 'https://arc.invalid', chainId: 5042002 },
      ],
      nearClient: fakeNearClient({
        account: { amount: (3n * NEAR).toString(), locked: '0', storage_usage: 500 },
        tokens: {
          '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af': '2500000',
          'meta-v2.pool.testnet': new Error('rpc down'),
        },
      }),
      createEvmClient: () =>
        fakeEvmClient({ 'eth_call:0x3600000000000000000000000000000000000000': 'not hex' }),
      now: () => 7,
    },
    { nearAccount: 'alice.testnet', evmAddress: `0x${'1'.repeat(40)}` },
  );
  const byId = new Map(balances.balances.map((balance) => [balance.asset.id, balance]));
  expect(balances.readAtMs).toBe(7);
  expect(byId.get('near-testnet:native')).toEqual(
    expect.objectContaining({
      kind: 'read',
      available: (3n * NEAR - 500n * STORAGE_BYTE).toString(),
      reserved: (500n * STORAGE_BYTE).toString(),
    }),
  );
  expect(
    byId.get('near-testnet:3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af'),
  ).toEqual(expect.objectContaining({ kind: 'read', available: '2500000' }));
  expect(byId.get('near-testnet:meta-v2.pool.testnet')).toEqual(
    expect.objectContaining({ kind: 'unavailable', reason: 'rpc_failed' }),
  );
  expect(byId.get('arc-testnet:0x3600000000000000000000000000000000000000')).toEqual(
    expect.objectContaining({ kind: 'unavailable', reason: 'invalid_response' }),
  );
});

test('a NEAR account without state holds zero of every asset; an unreachable node holds no number', async () => {
  const chains = [{ network: 'near-testnet' as const, rpcUrl: 'https://near.invalid' }];
  const missing = await readAssetBalances(
    { chains, nearClient: fakeNearClient({ account: 'missing' }) },
    { nearAccount: 'a'.repeat(64) },
  );
  expect(
    missing.balances.every((balance) => balance.kind === 'read' && balance.available === '0'),
  ).toBe(true);

  const down = await readAssetBalances(
    { chains, nearClient: fakeNearClient({ account: 'down' }) },
    { nearAccount: 'alice.testnet' },
  );
  expect(down.balances[0]).toEqual(expect.objectContaining({ kind: 'unavailable' }));
});

test('send amounts and recipients are checked before any transaction is built', () => {
  expect(parseSendAmount('1.5', 6)).toEqual({ kind: 'valid', baseUnits: 1_500_000n });
  expect(parseSendAmount('.25', 2)).toEqual({ kind: 'valid', baseUnits: 25n });
  expect(parseSendAmount('1,000', 0)).toEqual({ kind: 'valid', baseUnits: 1_000n });
  expect(parseSendAmount('0.0000001', 6)).toEqual({ kind: 'invalid', reason: 'decimals' });
  expect(parseSendAmount('0', 6)).toEqual({ kind: 'invalid', reason: 'zero' });
  expect(parseSendAmount('-1', 6)).toEqual({ kind: 'invalid', reason: 'format' });
  expect(parseSendAmount(' ', 6)).toEqual({ kind: 'invalid', reason: 'empty' });

  const [near] = assetsForChain({ network: 'near-mainnet' });
  const [eth] = assetsForChain({ network: 'ethereum-mainnet', chainId: 1 });
  expect(parseSendRecipient(near, 'Bob.Near')).toEqual({
    kind: 'near',
    accountId: 'bob.near',
    implicit: false,
  });
  expect(parseSendRecipient(near, 'bob near')).toEqual({ kind: 'invalid' });
  expect(parseSendRecipient(eth, 'bob.near')).toEqual({ kind: 'invalid' });
  expect(parseSendRecipient(eth, `0x${'Ab'.repeat(20)}`)).toEqual({
    kind: 'evm',
    address: `0x${'ab'.repeat(20)}`,
  });
});

test('a token send registers a recipient without storage in the same transaction', () => {
  const usdc = assetsForChain({ network: 'near-mainnet' }).find((asset) => asset.symbol === 'USDC');
  if (!usdc || usdc.kind !== 'nep141') throw new Error('USDC is listed');
  const registered = nearSendTransaction({
    asset: usdc,
    recipient: 'bob.near',
    baseUnits: 5_000_000n,
    storage: { kind: 'registered' },
  });
  expect(registered.receiverId).toBe(usdc.contract);
  expect(registered.actions).toHaveLength(1);
  expect(registered.actions[0]).toEqual(
    expect.objectContaining({ methodName: 'ft_transfer', deposit: '1' }),
  );

  const missing = nearSendTransaction({
    asset: usdc,
    recipient: 'bob.near',
    baseUnits: 5_000_000n,
    storage: { kind: 'missing', depositYocto: '1250000000000000000000' },
  });
  expect(
    missing.actions.map((action) => ('methodName' in action ? action.methodName : '')),
  ).toEqual(['storage_deposit', 'ft_transfer']);
  expect(missing.actions[0]).toEqual(
    expect.objectContaining({ deposit: '1250000000000000000000' }),
  );
});

test('prepareSend refuses a named NEAR account that does not exist', async () => {
  const [near] = assetsForChain({ network: 'near-mainnet' });
  const deps = {
    nearClient: fakeNearClient({}),
    accountExists: async (accountId: string) => accountId === 'bob.near',
    evmClientFor: () => null,
  };
  expect(
    await prepareSend(deps, {
      asset: near,
      from: 'alice.near',
      recipient: 'nobody.near',
      amount: '1',
    }),
  ).toEqual({ kind: 'rejected', reason: 'missing_account' });
  const ready = await prepareSend(deps, {
    asset: near,
    from: 'alice.near',
    recipient: 'bob.near',
    amount: '1',
  });
  expect(ready).toEqual(expect.objectContaining({ kind: 'near', receiverId: 'bob.near' }));
});

test('an ERC-20 send encodes transfer(address,uint256) and Max keeps the gas a token pays', async () => {
  const arcUsdc = assetsForChain({ network: 'arc-testnet', chainId: 5042002 })[0];
  if (!arcUsdc || arcUsdc.kind !== 'erc20') throw new Error('Arc USDC is listed');
  const client = fakeEvmClient({
    eth_estimateGas: '0xc350',
    eth_gasPrice: '0x3b9aca00',
    eth_maxPriorityFeePerGas: '0x0',
  });
  const prepared = await prepareSend(
    { nearClient: fakeNearClient({}), accountExists: async () => true, evmClientFor: () => client },
    {
      asset: arcUsdc,
      from: `0x${'1'.repeat(40)}`,
      recipient: `0x${'2'.repeat(40)}`,
      amount: '1.5',
    },
  );
  if (prepared.kind !== 'evm') throw new Error('expected an EVM send');
  expect(prepared.tx.to).toBe(arcUsdc.contract);
  expect(prepared.tx.value).toBe(0n);
  expect(prepared.tx.data).toBe(
    `0xa9059cbb${'0'.repeat(24)}${'2'.repeat(40)}${1_500_000n.toString(16).padStart(64, '0')}`,
  );
  expect(prepared.tx.gasLimit).toBe(60_000n);
  expect(prepared.maxFeeNative).toBe(60_000n * 2_000_000_000n);
  // The fee in 18-decimal native units, rounded up to 6-decimal token units.
  expect(
    maxSendBaseUnits({
      asset: arcUsdc,
      available: 10_000_000n,
      maxFeeNative: prepared.maxFeeNative,
    }),
  ).toBe(10_000_000n - 120n);
  const [near] = assetsForChain({ network: 'near-mainnet' });
  expect(maxSendBaseUnits({ asset: near, available: 1n * NEAR })).toBe(NEAR - 10n ** 22n);
});

test('display amounts truncate, keep two places and never round up', () => {
  expect(formatAssetAmount('250000000', 6)).toBe('250.00');
  expect(formatAssetAmount('4100000000000000000000000', 24)).toBe('4.10');
  expect(formatAssetAmount('12489999', 6)).toBe('12.4899');
  expect(formatAssetAmount('1234567000000', 6)).toBe('1,234,567.00');
  expect(formatAssetAmount('0', 24)).toBe('0');
  expect(formatAssetAmount('1', 24)).toBe('<0.0001');
  expect(formatAssetAmount('42000000000000000', 18)).toBe('0.042');
});

test('openScreen reaches the newest mounted Settings panel and reports when none is mounted', () => {
  const configs = { network: { chains: [] } } as unknown as SeamsConfigsReadonly;
  const assets = createAssetsCapability({ configs, nearClient: fakeNearClient({}) });
  const request: AssetScreenRequest = { screen: 'receive', assetId: 'near-testnet:native' };
  expect(assets.openScreen(request)).toBe(false);

  const first: AssetScreenRequest[] = [];
  const second: AssetScreenRequest[] = [];
  const removeFirst = registerAssetScreens(assets, (opened) => first.push(opened));
  const removeSecond = registerAssetScreens(assets, (opened) => second.push(opened));
  expect(assets.openScreen(request)).toBe(true);
  expect(first).toEqual([]);
  expect(second).toEqual([request]);

  removeSecond();
  expect(assets.openScreen({ screen: 'send' })).toBe(true);
  expect(first).toEqual([{ screen: 'send' }]);
  removeFirst();
  expect(assets.openScreen(request)).toBe(false);

  const other = createAssetsCapability({ configs, nearClient: fakeNearClient({}) });
  registerAssetScreens(other, (opened) => first.push(opened));
  expect(assets.openScreen(request)).toBe(false);
});

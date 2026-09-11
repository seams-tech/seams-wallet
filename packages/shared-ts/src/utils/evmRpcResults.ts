export type EvmTransactionReceipt = {
  blockNumber?: string | null;
  status?: string | null;
  gasUsed?: string | null;
  effectiveGasPrice?: string | null;
  gasPrice?: string | null;
};

export type EvmTransactionByHash = {
  blockNumber?: string | null;
  from?: string | null;
  nonce?: string | null;
  to?: string | null;
  input?: string | null;
  value?: string | null;
  calls?:
    | readonly {
        to?: string | null;
        input?: string | null;
        data?: string | null;
        value?: string | null;
      }[]
    | null;
};

export type EvmBlockHeader = {
  number?: string | null;
  baseFeePerGas?: string | null;
};

export function parseRpcHexQuantity(value: unknown, label: string): bigint {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^0x[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error(`Invalid ${label} quantity`);
  }
  return BigInt(normalized);
}

function optionalRpcString(
  record: Record<string, unknown>,
  key: string,
  operation: string,
): string | null | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`Invalid ${operation} result: ${key}`);
  return value;
}

function optionalRpcHexQuantity(
  record: Record<string, unknown>,
  key: string,
  operation: string,
): string | null | undefined {
  const value = optionalRpcString(record, key, operation);
  if (typeof value === 'string' && !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`Invalid ${operation} result: ${key}`);
  }
  return value;
}

function optionalRpcAddress(
  record: Record<string, unknown>,
  key: string,
  operation: string,
): string | null | undefined {
  const value = optionalRpcString(record, key, operation);
  if (typeof value === 'string' && !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Invalid ${operation} result: ${key}`);
  }
  return value;
}

function optionalRpcHexData(
  record: Record<string, unknown>,
  key: string,
  operation: string,
): string | null | undefined {
  const value = optionalRpcString(record, key, operation);
  if (typeof value === 'string' && !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`Invalid ${operation} result: ${key}`);
  }
  return value;
}

export function decodeEvmTransactionReceipt(value: unknown): EvmTransactionReceipt | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid eth_getTransactionReceipt result');
  }
  const record = value as Record<string, unknown>;
  const blockNumber = optionalRpcHexQuantity(record, 'blockNumber', 'eth_getTransactionReceipt');
  const status = optionalRpcHexQuantity(record, 'status', 'eth_getTransactionReceipt');
  const gasUsed = optionalRpcHexQuantity(record, 'gasUsed', 'eth_getTransactionReceipt');
  const effectiveGasPrice = optionalRpcHexQuantity(
    record,
    'effectiveGasPrice',
    'eth_getTransactionReceipt',
  );
  const gasPrice = optionalRpcHexQuantity(record, 'gasPrice', 'eth_getTransactionReceipt');
  return {
    ...(blockNumber !== undefined ? { blockNumber } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(gasUsed !== undefined ? { gasUsed } : {}),
    ...(effectiveGasPrice !== undefined ? { effectiveGasPrice } : {}),
    ...(gasPrice !== undefined ? { gasPrice } : {}),
  };
}

export function decodeEvmBlockHeader(value: unknown): EvmBlockHeader | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid eth_getBlockByNumber result');
  }
  const record = value as Record<string, unknown>;
  const number = optionalRpcHexQuantity(record, 'number', 'eth_getBlockByNumber');
  const baseFeePerGas = optionalRpcHexQuantity(record, 'baseFeePerGas', 'eth_getBlockByNumber');
  return {
    ...(number !== undefined ? { number } : {}),
    ...(baseFeePerGas !== undefined ? { baseFeePerGas } : {}),
  };
}

export function decodeEvmTransactionCall(
  value: unknown,
): NonNullable<EvmTransactionByHash['calls']>[number] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid eth_getTransactionByHash result: calls');
  }
  const record = value as Record<string, unknown>;
  const to = optionalRpcAddress(record, 'to', 'eth_getTransactionByHash');
  const input = optionalRpcHexData(record, 'input', 'eth_getTransactionByHash');
  const data = optionalRpcHexData(record, 'data', 'eth_getTransactionByHash');
  const callValue = optionalRpcHexQuantity(record, 'value', 'eth_getTransactionByHash');
  return {
    ...(to !== undefined ? { to } : {}),
    ...(input !== undefined ? { input } : {}),
    ...(data !== undefined ? { data } : {}),
    ...(callValue !== undefined ? { value: callValue } : {}),
  };
}

export function decodeEvmTransactionByHash(value: unknown): EvmTransactionByHash | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid eth_getTransactionByHash result');
  }
  const record = value as Record<string, unknown>;
  const blockNumber = optionalRpcHexQuantity(record, 'blockNumber', 'eth_getTransactionByHash');
  const from = optionalRpcAddress(record, 'from', 'eth_getTransactionByHash');
  const nonce = optionalRpcHexQuantity(record, 'nonce', 'eth_getTransactionByHash');
  const to = optionalRpcAddress(record, 'to', 'eth_getTransactionByHash');
  const input = optionalRpcHexData(record, 'input', 'eth_getTransactionByHash');
  const transactionValue = optionalRpcHexQuantity(record, 'value', 'eth_getTransactionByHash');
  const callsValue = record.calls;
  if (callsValue !== undefined && callsValue !== null && !Array.isArray(callsValue)) {
    throw new Error('Invalid eth_getTransactionByHash result: calls');
  }
  const calls = Array.isArray(callsValue) ? callsValue.map(decodeEvmTransactionCall) : callsValue;
  return {
    ...(blockNumber !== undefined ? { blockNumber } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(nonce !== undefined ? { nonce } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(input !== undefined ? { input } : {}),
    ...(transactionValue !== undefined ? { value: transactionValue } : {}),
    ...(calls !== undefined ? { calls } : {}),
  };
}

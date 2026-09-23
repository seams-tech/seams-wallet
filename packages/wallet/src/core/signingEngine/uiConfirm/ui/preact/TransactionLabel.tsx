/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact';
import { ActionType } from '@/core/types/actions';
import type { TreeNode } from '../transaction-display/tree';
import {
  formatCodeSize,
  formatDeposit,
  formatGas,
  shortenPubkey,
} from '../transaction-display/formatters';

export type ExplorerUrls = {
  near: string;
  evm?: string;
  tempo?: string;
};

type LabelProps = { node: TreeNode; explorers: ExplorerUrls };

function addressHref(base: string, address: string): string {
  return `${base.trim().replace(/\/$/, '')}/address/${encodeURIComponent(address)}`;
}

function ReceiverLink(props: { base: string; address: string; children: ComponentChildren }) {
  return (
    <a
      class="highlight-receiver-id"
      href={addressHref(props.base, props.address)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {props.children}
    </a>
  );
}

function shortAddress(address: string): string {
  const normalized = address.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(normalized)
    ? `${normalized.slice(0, 8)}...${normalized.slice(-4)}`
    : normalized;
}

function contractPrefix(node: TreeNode): string | undefined {
  const match = node.label.trim().match(/^(Transaction(?:\s+\d+)?\s+to contract)\b/i);
  return match ? `${match[1]} ` : undefined;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported transaction action: ${String(value)}`);
}

export function transactionLabelTitle(node: TreeNode): string {
  const action = node.action;
  if (action) {
    switch (action.type) {
      case ActionType.FunctionCall:
        return `Calling ${action.methodName} with ${formatDeposit(action.deposit)} using ${formatGas(action.gas)}`;
      case ActionType.Transfer:
        return `Transfer ${formatDeposit(action.amount)}`;
      case ActionType.CreateAccount:
        return 'Creating Account';
      case ActionType.DeleteAccount:
        return 'Deleting Account';
      case ActionType.Stake:
        return `Staking ${formatDeposit(action.stake)}`;
      case ActionType.AddKey:
        return 'Adding Key';
      case ActionType.DeleteKey:
        return 'Deleting Key';
      case ActionType.DeployContract:
        return 'Deploying WASM contract';
      case ActionType.DeployGlobalContract:
        return `Deploy global WASM contract (mode: ${action.deployMode}, size ${formatCodeSize(action.code)})`;
      case ActionType.UseGlobalContract: {
        if (action.accountId) return `Use global contract by account ${action.accountId}`;
        if (action.codeHash) return `Use global contract by hash ${action.codeHash}`;
        return 'Use global contract';
      }
      default:
        return assertNever(action);
    }
  }
  if (node.transaction) {
    const prefix =
      (node.totalTransactions ?? 1) > 1
        ? `Transaction ${(node.transactionIndex ?? 0) + 1}: to `
        : 'Transaction to ';
    return prefix + node.transaction.receiverId;
  }
  const prefix = contractPrefix(node);
  if (node.contractAddress?.trim() && prefix) return prefix + shortAddress(node.contractAddress);
  return node.label;
}

export function TransactionLabel({ node, explorers }: LabelProps): ComponentChildren {
  const action = node.action;
  if (action) {
    switch (action.type) {
      case ActionType.FunctionCall: {
        const gas = formatGas(action.gas);
        const deposit = formatDeposit(action.deposit);
        return (
          <>
            Calling <span class="highlight-method-name">{action.methodName}</span>
            {deposit !== '0 NEAR' && (
              <>
                {' '}
                with <span class="highlight-method-name">{deposit}</span>
              </>
            )}
            {gas && (
              <>
                {' '}
                using <span class="highlight-method-name">{gas}</span>
              </>
            )}
          </>
        );
      }
      case ActionType.Transfer:
        return (
          <>
            Transfer <span class="highlight-amount">{formatDeposit(action.amount)}</span>
          </>
        );
      case ActionType.CreateAccount:
        return 'Creating Account';
      case ActionType.DeleteAccount:
        return 'Deleting Account';
      case ActionType.Stake:
        return `Staking ${formatDeposit(action.stake)}`;
      case ActionType.AddKey:
        return 'Adding Key';
      case ActionType.DeleteKey:
        return 'Deleting Key';
      case ActionType.DeployContract:
        return `Deploying WASM contract (${formatCodeSize(action.code)})`;
      case ActionType.DeployGlobalContract:
        return transactionLabelTitle(node);
      case ActionType.UseGlobalContract: {
        if (action.accountId)
          return (
            <>
              Use global contract{' '}
              <ReceiverLink base={explorers.near} address={action.accountId}>
                {action.accountId}
              </ReceiverLink>
            </>
          );
        if (action.codeHash)
          return (
            <>
              Use global contract by hash{' '}
              <span class="highlight-method-name">
                {shortenPubkey(action.codeHash, { prefix: 10, suffix: 6 })}
              </span>
            </>
          );
        return 'Use global contract';
      }
      default:
        return assertNever(action);
    }
  }
  if (node.transaction) {
    const prefix =
      (node.totalTransactions ?? 1) > 1
        ? `Transaction ${(node.transactionIndex ?? 0) + 1}: to `
        : 'Transaction to ';
    return (
      <>
        {prefix}
        <ReceiverLink base={explorers.near} address={node.transaction.receiverId}>
          {node.transaction.receiverId}
        </ReceiverLink>
      </>
    );
  }
  const prefix = contractPrefix(node);
  const address = node.contractAddress?.trim();
  if (address && prefix) {
    const base = node.chain && node.chain !== 'unknown' ? explorers[node.chain] : undefined;
    return (
      <>
        {prefix}
        {base ? (
          <ReceiverLink base={base} address={address}>
            {shortAddress(address)}
          </ReceiverLink>
        ) : (
          <span class="highlight-receiver-id">{shortAddress(address)}</span>
        )}
      </>
    );
  }
  const label = node.label.trim();
  if (label.toLowerCase().startsWith('calling ')) {
    const rest = label.slice('Calling '.length).trim();
    const index = rest.toLowerCase().indexOf(' using ');
    if (index < 0 && rest)
      return (
        <>
          Calling <span class="highlight-method-name">{rest}</span>
        </>
      );
    const method = rest.slice(0, index).trim();
    const trailing = rest.slice(index + ' using '.length).trim();
    if (index >= 0 && method)
      return (
        <>
          Calling <span class="highlight-method-name">{method}</span>
          {trailing && ` using ${trailing}`}
        </>
      );
  }
  return node.label;
}

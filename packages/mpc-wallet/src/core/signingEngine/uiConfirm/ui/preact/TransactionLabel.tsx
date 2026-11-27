/** @jsxImportSource preact */
import { WalletText } from '@/core/signingEngine/uiConfirm/ui/preact/WalletLocale';
import type { ComponentChildren } from 'preact';
import { ActionType } from '@/core/types/actions';
import { nearActionTitle, type TreeNode } from '../transaction-display/tree';
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

export function contractPrefix(node: TreeNode): string | undefined {
  const match = node.label.trim().match(/^(Transaction(?:\s+\d+)?\s+to contract)\b/i);
  return match ? `${match[1]} ` : undefined;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported transaction action: ${String(value)}`);
}

export function transactionLabelTitle(node: TreeNode): string {
  if (node.action) return nearActionTitle(node.action);
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
            <WalletText message="Calling" />{' '}
            <span class="highlight-method-name">{action.methodName}</span>
            {deposit !== '0 NEAR' && (
              <>
                {' '}
                <WalletText message="with" /> <span class="highlight-method-name">{deposit}</span>
              </>
            )}
            {gas && (
              <>
                {' '}
                <WalletText message="using" /> <span class="highlight-method-name">{gas}</span>
              </>
            )}
          </>
        );
      }
      case ActionType.Transfer:
        return (
          <>
            <WalletText message="Transfer" />{' '}
            <span class="highlight-amount">{formatDeposit(action.amount)}</span>
          </>
        );
      case ActionType.CreateAccount:
        return <WalletText message="Creating Account" />;
      case ActionType.DeleteAccount:
        return <WalletText message="Deleting Account" />;
      case ActionType.Stake:
        return (
          <WalletText message="Staking {value0}" values={{ value0: formatDeposit(action.stake) }} />
        );
      case ActionType.AddKey:
        return <WalletText message="Adding Key" />;
      case ActionType.DeleteKey:
        return <WalletText message="Deleting Key" />;
      case ActionType.DeployContract:
        return (
          <WalletText
            message="Deploying WASM contract ({value0})"
            values={{ value0: formatCodeSize(action.code) }}
          />
        );
      case ActionType.DeployGlobalContract:
        return <WalletText copy={transactionLabelTitle(node)} />;
      case ActionType.UseGlobalContract: {
        if (action.accountId)
          return (
            <>
              <WalletText message="Use global contract" />{' '}
              <ReceiverLink base={explorers.near} address={action.accountId}>
                {action.accountId}
              </ReceiverLink>
            </>
          );
        if (action.codeHash)
          return (
            <>
              <WalletText message="Use global contract by hash" />{' '}
              <span class="highlight-method-name">
                {shortenPubkey(action.codeHash, { prefix: 10, suffix: 6 })}
              </span>
            </>
          );
        return <WalletText message="Use global contract" />;
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
        <WalletText copy={prefix} />
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
        <WalletText copy={prefix} />
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
          <WalletText message="Calling" /> <span class="highlight-method-name">{rest}</span>
        </>
      );
    const method = rest.slice(0, index).trim();
    const trailing = rest.slice(index + ' using '.length).trim();
    if (index >= 0 && method)
      return (
        <>
          <WalletText message="Calling" /> <span class="highlight-method-name">{method}</span>
          {trailing && (
            <>
              <WalletText message="using" /> {trailing}
            </>
          )}
        </>
      );
  }
  if (node.fieldLabel) {
    return (
      <>
        <WalletText copy={node.fieldLabel} />
        {node.label.slice(node.fieldLabel.length)}
      </>
    );
  }
  return <WalletText copy={node.label} />;
}

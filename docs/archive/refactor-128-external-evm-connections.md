# Refactor 128: external EVM wallet connections

Status: desktop connector implemented. The original record retained publication,
private adoption, and post-publication verification as release steps.

## Why

Applications needed existing browser wallets alongside Seams wallets while leaving
private keys and approval prompts with the external provider.

## What changed

- Added EIP-6963 provider discovery and one EIP-1193 integration for MetaMask, Rabby, and Phantom EVM accounts.
- Exposed connection state, account selection, configured-chain switching, and local disconnect.
- Supported message signing, EIP-712 typed data, and transaction submission.
- Added typed external-EVM entry points without changing Seams custody.

Chrome smoke checks discovered all three providers together. MetaMask and Rabby
received approval-flow checks. The owner waived a separate Phantom approval matrix after discovery.

## Scope limits

Solana, mobile transports, WalletConnect, and additional non-EVM integrations were excluded.
Provider discovery did not establish acceptance for every wallet or browser version.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/archive/refactor-128-external-evm-connections.md).

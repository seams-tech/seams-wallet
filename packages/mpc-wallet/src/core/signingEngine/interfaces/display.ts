export type DisplayChain = 'near' | 'evm' | 'tempo' | 'unknown';

type DisplaySeverity = 'info' | 'warning' | 'critical';

export interface TxDisplayModel {
  chain: DisplayChain;
  chainId?: number;
  intentDigest?: string;
  signerAccount?: string;
  title?: string;
  subtitle?: string;
  operations: TxDisplayOperation[];
  warnings?: TxDisplayWarning[];
  totals?: TxDisplayTotals;
  tokenTransfers?: TxDisplayTokenTransfers;
  raw?: { format: string; value: string };
}

export interface TxDisplayWarning {
  code: string;
  severity: DisplaySeverity;
  message: string;
}

interface TxDisplayTotals {
  nativeValue?: string;
  nativeSymbol?: string;
  estimatedFee?: string;
  feeSymbol?: string;
}

export interface TxDisplayTokenTransfer {
  tokenContract: string;
  recipient: string;
  baseUnits: string;
  /** Absent when the wallet could not read the token's metadata. */
  amount?: { value: string; symbol: string; verified: boolean };
}

/**
 * `headline` replaces the native amount, so it is only valid when the request moves nothing else.
 * `rows` sits beside the native amount.
 */
export type TxDisplayTokenTransfers =
  | { layout: 'headline'; transfer: TxDisplayTokenTransfer }
  | { layout: 'rows'; transfers: TxDisplayTokenTransfer[] };

export interface TxDisplayField {
  label: string;
  value: string;
  copyValue?: string;
  renderAs?: 'inline' | 'file-content';
  hideLabel?: boolean;
  hideChevron?: boolean;
  contentVariants?: TxDisplayFileContentVariants;
}

type TxDisplayFileContentMode = 'decoded' | 'raw';

export interface TxDisplayFileContentVariants {
  decoded: string;
  raw: string;
  defaultMode?: TxDisplayFileContentMode;
}

interface TxDisplayAbiDecodeHint {
  dataHex: string;
  abi?: readonly Record<string, unknown>[];
}

interface BaseDisplayOperation {
  id: string;
  kind: string;
  label: string;
  description?: string;
  risk?: DisplaySeverity;
  fields?: TxDisplayField[];
  children?: TxDisplayOperation[];
  abiDecodeHint?: TxDisplayAbiDecodeHint;
}

export interface NearActionOperation extends BaseDisplayOperation {
  kind: 'near.action';
  actionType:
    | 'createAccount'
    | 'transfer'
    | 'functionCall'
    | 'stake'
    | 'addKey'
    | 'deleteKey'
    | 'deployContract'
    | 'deployGlobalContract'
    | 'useGlobalContract'
    | 'deleteAccount'
    | 'signedDelegate';
}

export interface NearMessageOperation extends BaseDisplayOperation {
  kind: 'near.message';
}

export interface TempoTypedOperation extends BaseDisplayOperation {
  kind: 'tempo.eip2718';
  txTypeHex?: string;
  txTypeName?: string;
  to?: string;
  selector?: string;
}

export interface GenericContractCallOperation extends BaseDisplayOperation {
  kind: 'generic.contractCall';
  to?: string;
  value?: string;
  selector?: string;
}

interface RawFallbackOperation extends BaseDisplayOperation {
  kind: 'raw.fallback';
  raw: string;
}

export type TxDisplayOperation =
  | NearActionOperation
  | NearMessageOperation
  | TempoTypedOperation
  | GenericContractCallOperation
  | RawFallbackOperation;

import type { TxDisplayTokenTransfer } from '@/core/signingEngine/interfaces/display';
import { formatTokenBaseUnits } from '../../tokenAmounts';
import { listedErc20Token } from '@/core/assets/assetList';

// transfer(address,uint256): the selector and two 32-byte words, with no trailing data.
const ERC20_TRANSFER_CALLDATA = /^0xa9059cbb0{24}([0-9a-f]{40})([0-9a-f]{64})$/;

/** An unlisted token shows its base units, because a contract's own symbol proves nothing. */
export function parseErc20TransferForDisplay(args: {
  chainId: number;
  to: string | undefined;
  dataHex: string;
}): TxDisplayTokenTransfer | null {
  if (!args.to) return null;
  const match = ERC20_TRANSFER_CALLDATA.exec(args.dataHex.toLowerCase());
  if (!match) return null;
  const tokenContract = args.to.toLowerCase();
  const baseUnits = BigInt(`0x${match[2]}`).toString();
  const token = listedErc20Token(args.chainId, tokenContract);
  return {
    tokenContract,
    recipient: `0x${match[1]}`,
    baseUnits,
    ...(token
      ? {
          amount: {
            value: formatTokenBaseUnits(baseUnits, token.decimals),
            symbol: token.symbol,
            verified: true,
          },
        }
      : {}),
  };
}

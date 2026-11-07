/** @jsxImportSource preact */
import { h, type JSX } from 'preact';
import type { TokenArtworkKey } from '@/core/assets/assetList';
import { TOKEN_ARTWORK, type ArtworkNode } from '@/core/assets/tokenArtwork';

// A contract chooses its own symbol, so callers pass a symbol here only for a token that the
// wallet itself lists, or for the chain's native asset. Anything else uses UnbrandedTokenIcon.
const ARTWORK_BY_SYMBOL: Readonly<Record<string, TokenArtworkKey>> = {
  NEAR: 'NEAR',
  yoctoNEAR: 'NEAR',
  wNEAR: 'NEAR',
  stNEAR: 'stNEAR',
  ETH: 'ETH',
  USDC: 'USDC',
  USDT: 'USDT',
  USDt: 'USDT',
  'USDT.e': 'USDT',
  BTC: 'BTC',
  WBTC: 'BTC',
  cbBTC: 'BTC',
  nBTC: 'BTC',
  SOL: 'SOL',
  ZEC: 'ZEC',
};

function renderNode(artworkNode: ArtworkNode, index: number): JSX.Element {
  return h(
    artworkNode.tag,
    { key: index, ...artworkNode.attrs },
    artworkNode.children?.map(renderNode),
  );
}

function Artwork({ artwork }: { artwork: TokenArtworkKey }) {
  const { viewBox, fill, nodes } = TOKEN_ARTWORK[artwork];
  return (
    <svg class="seams-review-token" viewBox={viewBox} fill={fill} aria-hidden="true">
      {nodes.map(renderNode)}
    </svg>
  );
}

export function UnbrandedTokenIcon({ symbol }: { symbol: string }) {
  return (
    <span class="seams-review-token seams-review-token-fallback" aria-hidden="true">
      {symbol.slice(0, 1)}
    </span>
  );
}

export function TokenIcon({ symbol }: { symbol: string }) {
  const artwork = Object.hasOwn(ARTWORK_BY_SYMBOL, symbol) ? ARTWORK_BY_SYMBOL[symbol] : undefined;
  return artwork ? <Artwork artwork={artwork} /> : <UnbrandedTokenIcon symbol={symbol} />;
}

import React from 'react';
import type { TokenArtworkKey } from '@/core/assets/assetList';
import { TOKEN_ARTWORK, type ArtworkNode } from '@/core/assets/tokenArtwork';

// React takes camelCase SVG attribute names; the shared data keeps SVG attribute names.
function reactAttributeName(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function renderNode(node: ArtworkNode, index: number): React.ReactElement {
  const props: Record<string, string | number> = { key: index };
  for (const [name, value] of Object.entries(node.attrs)) props[reactAttributeName(name)] = value;
  return React.createElement(node.tag, props, node.children?.map(renderNode));
}

/** The wallet's official artwork for a listed asset. Decorative: the row names the asset. */
export function TokenArtwork({
  artwork,
  size = 28,
}: {
  artwork: TokenArtworkKey;
  size?: number;
}): React.JSX.Element {
  const { viewBox, fill, nodes } = TOKEN_ARTWORK[artwork];
  return (
    <svg
      className="seams-assets-token"
      width={size}
      height={size}
      viewBox={viewBox}
      fill={fill}
      aria-hidden="true"
      focusable="false"
    >
      {nodes.map(renderNode)}
    </svg>
  );
}

import React from 'react';
import './HoverArrowIcon.css';
import './Icon.css';

/** A chevron that grows a shaft on its parent's hover (">" to "->"). Place it
 * as a direct child of the row that triggers it (HoverArrowIcon.css). */
export function HoverArrowIcon({ size = 12 }: { size?: number }): React.JSX.Element {
  const style: React.CSSProperties & {
    '--seams-icon-width': string;
    '--seams-icon-height': string;
    '--seams-icon-stroke-width': number;
  } = {
    '--seams-icon-width': `${size}px`,
    '--seams-icon-height': `${size}px`,
    '--seams-icon-stroke-width': 1.5,
  };
  return (
    <svg
      data-seams-root=""
      className="seams-icon seams-hover-arrow"
      width={size}
      height={size}
      style={style}
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <path className="seams-hover-arrow-line" d="M0 5h7" />
      <path className="seams-hover-arrow-tip" d="M1 1l4 4-4 4" />
    </svg>
  );
}

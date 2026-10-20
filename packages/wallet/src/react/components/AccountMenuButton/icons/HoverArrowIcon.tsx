import React from 'react';
import './HoverArrowIcon.css';

/** A chevron that grows a shaft on its parent's hover (">" to "->"). Place it
 * as a direct child of the row that triggers it (HoverArrowIcon.css). */
export function HoverArrowIcon({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      className="seams-hover-arrow"
      width={size}
      height={size}
      viewBox="0 0 10 10"
      aria-hidden="true"
      focusable="false"
    >
      <path className="seams-hover-arrow-line" d="M0 5h7" />
      <path className="seams-hover-arrow-tip" d="M1 1l4 4-4 4" />
    </svg>
  );
}

import React from 'react';

/** A chevron that grows a shaft on its parent's hover (">" to "->"). The
 * parent row owns the hover selectors in Web3AuthProfileButton.css. */
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

/** @jsxImportSource preact */
import { SEAMS_STANDARD_WORDMARK_PATH, SEAMS_WALLET_SITE_URL } from '../seamsWordmarkPaths';

/** The footer wordmark: a link to the Seams Wallet site that opens in a new tab. */
export function SeamsWordmark() {
  return (
    <a
      class="seams-wordmark-link"
      href={SEAMS_WALLET_SITE_URL}
      target="_blank"
      rel="noopener noreferrer"
    >
      <svg class="seams-receipt-wordmark" viewBox="0 0 1428 285" role="img" aria-label="seams">
        <path
          d={SEAMS_STANDARD_WORDMARK_PATH}
          stroke="none"
          fill="currentColor"
          fill-rule="evenodd"
        />
      </svg>
    </a>
  );
}

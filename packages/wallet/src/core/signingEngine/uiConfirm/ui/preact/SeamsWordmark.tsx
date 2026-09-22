/** @jsxImportSource preact */
import { SEAMS_STANDARD_WORDMARK_PATH } from '../seamsWordmarkPaths';
export function SeamsWordmark() {
  return (
    <svg class="seams-receipt-wordmark" viewBox="0 0 1428 285" role="img" aria-label="seams">
      <path d={SEAMS_STANDARD_WORDMARK_PATH} stroke="none" fill="currentColor" fill-rule="evenodd" />
    </svg>
  );
}

// Lit component tag names
// These are rendered as web components:
// e.g. <seams-modal-tx-confirmer></seams-modal-tx-confirmer>, <seams-tx-tree>, etc.

// Transaction confirmer element tags (host-rendered)
// Canonical tag names use the "-tx-confirmer" suffix for consistency.
export const SEAMS_TX_CONFIRMER_ID = 'seams-tx-confirmer';
export const SEAMS_MODAL_TX_CONFIRMER_ID = 'seams-modal-tx-confirmer';
export const SEAMS_DRAWER_TX_CONFIRMER_ID = 'seams-drawer-tx-confirmer';
export const SEAMS_TX_CONFIRM_CONTENT_ID = 'seams-tx-confirm-content';

// Shared building blocks
export const SEAMS_DRAWER_ID = 'seams-drawer';
export const SEAMS_TX_TREE_ID = 'seams-tx-tree';
export const SEAMS_HALO_BORDER_ID = 'seams-halo-border';
export const SEAMS_PASSKEY_HALO_LOADING_ID = 'seams-passkey-halo-loading';

// Unified list of confirmer hosts the wallet may need to target for lifecycle events.
export const CONFIRM_UI_ELEMENT_SELECTORS = [
  SEAMS_TX_CONFIRMER_ID,
  SEAMS_MODAL_TX_CONFIRMER_ID,
  SEAMS_DRAWER_TX_CONFIRMER_ID,
] as const;

// Dedicated portal container to enforce a single confirmer instance.
export const SEAMS_CONFIRM_PORTAL_ID = 'seams-confirm-portal';

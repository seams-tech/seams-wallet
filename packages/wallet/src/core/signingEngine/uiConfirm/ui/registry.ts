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

// Wallet recovery-code backup dialog (direct-mount host + content viewer).
export const SEAMS_RECOVERY_CODE_BACKUP_HOST_ID = 'seams-recovery-code-backup-host';
export const SEAMS_RECOVERY_CODE_BACKUP_VIEWER_ID = 'seams-recovery-code-backup-viewer';

// Consolidated loaders for known SEAMS custom elements that may be used across runtimes.
// This allows dev tooling to auto-ensure definitions for common elements when possible.
export const TAG_LOADERS: Record<string, () => Promise<unknown>> = {
  [SEAMS_TX_CONFIRMER_ID]: () => import('./lit-components/IframeTxConfirmer/tx-confirmer-wrapper'),
  [SEAMS_RECOVERY_CODE_BACKUP_HOST_ID]: () => import('./lit-components/RecoveryCodeBackup/host'),
};

/**
 * Small utility that guarantees a custom element definition exists in the
 * current runtime before creating/using it. If the tag is not yet defined,
 * it runs the provided dynamic import loader to execute the module that calls
 * customElements.define().
 */
export async function ensureDefined(tag: string, loader: () => Promise<unknown>): Promise<void> {
  try {
    if (!customElements.get(tag)) {
      await loader();
    }
  } catch {
    // Best-effort; downstream calls will still throw useful errors if missing.
  }
}

/** Attempt to ensure a known SEAMS element by tag; returns true if a loader ran. */
export async function ensureKnownSeamsElement(tag: string): Promise<boolean> {
  try {
    const t = (tag || '').toLowerCase();
    const loader = TAG_LOADERS[t];
    if (!loader) return false;
    await ensureDefined(t, loader);
    return true;
  } catch {
    return false;
  }
}

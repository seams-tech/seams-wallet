/** @jsxImportSource preact */
import { render } from 'preact';
import {
  RecoveryCodeBackupSurface,
  type RecoveryBackupCloseDetail,
  type RecoveryBackupStage,
  type RecoveryCodeBackupExperience,
} from './RecoveryCodeBackupSurface';

export type RecoveryBackupSurface = 'standalone' | 'wallet-iframe';

type MountRecoveryCodeBackupInput = {
  readonly parent: HTMLElement;
  readonly experience: RecoveryCodeBackupExperience;
  readonly surface: RecoveryBackupSurface;
  readonly onClose: (detail: RecoveryBackupCloseDetail) => void;
  readonly onCancel: () => void;
  readonly onShown: (dialog: HTMLDialogElement) => void;
};

export type RecoveryCodeBackupSurfaceHandle = {
  readonly dialog: HTMLDialogElement;
  readonly element: HTMLElement;
  update(experience: RecoveryCodeBackupExperience): void;
  dispose(): void;
};

let nextRecoverySurfaceId = 0;

class MountedRecoveryCodeBackupSurface implements RecoveryCodeBackupSurfaceHandle {
  readonly element: HTMLElement;
  readonly dialog: HTMLDialogElement;
  private readonly document: Document;
  private readonly input: MountRecoveryCodeBackupInput;
  private state: 'mounted' | 'disposed' = 'mounted';

  constructor(input: MountRecoveryCodeBackupInput) {
    this.input = input;
    this.document = input.parent.ownerDocument;
    ensureRecoveryStyles(this.document);
    this.element = this.document.createElement('div');
    this.element.id = `seams-recovery-surface-${++nextRecoverySurfaceId}`;
    this.element.className = 'seams-wallet-ui seams-recovery-code-backup-host';
    this.element.dataset.seamsRecoverySurface = input.surface;
    this.dialog = this.document.createElement('dialog');
    this.dialog.className = 'seams-host-themed-dialog';
    this.dialog.tabIndex = -1;
    this.dialog.setAttribute('data-seams-wallet-recovery-backup-dialog', '');
    this.dialog.dataset.seamsRecoverySurface = input.surface;
    this.dialog.setAttribute('aria-labelledby', 'seams-wallet-recovery-title');
    this.dialog.setAttribute('aria-describedby', 'seams-wallet-recovery-description');
    this.dialog.addEventListener('cancel', this.handleCancel);
    this.element.appendChild(this.dialog);
    input.parent.appendChild(this.element);
    try {
      this.render(input.experience);
      this.dialog.showModal();
      this.focusTitle();
      input.onShown(this.dialog);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  update(experience: RecoveryCodeBackupExperience): void {
    if (this.state === 'disposed') return;
    this.render(experience);
  }

  dispose(): void {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    this.dialog.removeEventListener('cancel', this.handleCancel);
    render(null, this.dialog);
    if (this.dialog.open) this.dialog.close();
    this.element.remove();
  }

  private render(experience: RecoveryCodeBackupExperience): void {
    if (this.state === 'disposed') return;
    this.element.dataset.seamsRecoveryEntry = experience.kind;
    render(
      <RecoveryCodeBackupSurface
        experience={experience}
        onClose={this.input.onClose}
        onStageChange={this.handleStageChange}
      />,
      this.dialog,
    );
  }

  private readonly handleCancel = (event: Event): void => {
    event.preventDefault();
    this.input.onCancel();
  };

  private readonly handleStageChange = (stage: RecoveryBackupStage): void => {
    if (this.state === 'disposed') return;
    this.dialog.dataset.seamsRecoveryStage = stage;
  };

  private focusTitle(): void {
    this.dialog.querySelector<HTMLElement>('.recovery-backup-title')?.focus();
  }
}

export function mountRecoveryCodeBackupSurface(
  input: MountRecoveryCodeBackupInput,
): RecoveryCodeBackupSurfaceHandle {
  return new MountedRecoveryCodeBackupSurface(input);
}

function ensureRecoveryStyles(document: Document): void {
  for (const marker of [
    'data-seams-components-css',
    'data-seams-recovery-code-backup-css',
    'data-seams-copy-icon-css',
  ]) {
    const link = document.head.querySelector<HTMLLinkElement>(`link[rel="stylesheet"][${marker}]`);
    try {
      if (link?.sheet && !link.disabled && link.sheet.cssRules.length > 0) continue;
    } catch {
      // Failed or inaccessible styles cannot establish a styled first measurement.
    }
    throw new Error(`Wallet recovery-code stylesheet unavailable: ${marker}`);
  }
}

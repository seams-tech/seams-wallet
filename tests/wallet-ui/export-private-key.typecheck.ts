import type {
  ExportKeyMaterial,
  ExportKeyViewModel,
  ExportPrivateKeyViewModel,
} from '@/core/signingEngine/uiConfirm/ui/preact/ExportPrivateKeySurface';

declare function acceptMaterial(material: ExportKeyMaterial): void;
declare function acceptView(model: ExportPrivateKeyViewModel): void;
declare const loadingEntry: ExportKeyViewModel & { material: { kind: 'loading' } };
declare const readyEntry: ExportKeyViewModel & { material: { kind: 'ready'; value: string } };
declare const failed: Extract<ExportPrivateKeyViewModel, { kind: 'failed' }>;

acceptMaterial({ kind: 'loading' });
acceptMaterial({ kind: 'ready', value: 'synthetic' });
// @ts-expect-error Loading material cannot retain a private key.
acceptMaterial({ kind: 'loading', value: 'synthetic' });
// @ts-expect-error Ready material requires its key.
acceptMaterial({ kind: 'ready' });
// @ts-expect-error A ready surface cannot contain unfinished key material.
acceptView({ kind: 'ready', accountId: 'synthetic', entries: [loadingEntry] });
// @ts-expect-error A loading surface cannot contain ready private key material.
acceptView({ kind: 'loading', accountId: 'synthetic', entries: [readyEntry] });
const failedWithRetainedKeys = { ...failed, entries: [readyEntry] };
// @ts-expect-error Error transitions discard key rows even when constructed through a spread.
acceptView(failedWithRetainedKeys);

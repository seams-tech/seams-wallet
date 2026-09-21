import type { WalletRecoveryCodeBackupRequestV1 } from '@/core/types/sdkSentEvents';
import { authBranchFixtures, registration } from '../wallet-ui/auth-menu-fixtures';

const COMPONENTS = 'core/signingEngine/uiConfirm/ui/lit-components/';

export const LIT_COMPONENT_INVENTORY = [
  [
    'seams-auth-menu-surface',
    'SeamsWeb/walletIframe/host/lit-ui/auth-menu/seams-auth-menu-surface.js',
  ],
  ['seams-drawer', `${COMPONENTS}Drawer/index.js`],
  ['seams-tx-tree', `${COMPONENTS}TxTree/index.js`],
  ['seams-halo-border', `${COMPONENTS}HaloBorder/index.js`],
  ['seams-passkey-halo-loading', `${COMPONENTS}PasskeyHaloLoading/index.js`],
  ['seams-padlock-icon', `${COMPONENTS}common/PadlockIcon.js`],
  ['seams-tx-confirm-content', `${COMPONENTS}IframeTxConfirmer/tx-confirm-content.js`],
  ['seams-modal-tx-confirmer', `${COMPONENTS}IframeTxConfirmer/viewer-modal.js`],
  ['seams-drawer-tx-confirmer', `${COMPONENTS}IframeTxConfirmer/viewer-drawer.js`],
  ['seams-tx-confirmer', `${COMPONENTS}IframeTxConfirmer/tx-confirmer-wrapper.js`],
  ['seams-export-key-viewer', `${COMPONENTS}ExportPrivateKey/viewer.js`],
  ['seams-export-viewer-iframe', `${COMPONENTS}ExportPrivateKey/iframe-host.js`],
  ['seams-recovery-code-backup-viewer', `${COMPONENTS}RecoveryCodeBackup/host.js`],
  ['seams-recovery-code-backup-host', `${COMPONENTS}RecoveryCodeBackup/host.js`],
] as const;

export type LitTag = (typeof LIT_COMPONENT_INVENTORY)[number][0];
export type VisualTheme = 'light' | 'dark';
export type LitVisualFixture = {
  tag: LitTag;
  name: string;
  props: Record<string, unknown>;
  attributes: Record<string, string>;
  content: string;
  viewport?: { width: number; height: number };
};

export const SYNTHETIC_BACKUP: WalletRecoveryCodeBackupRequestV1 = {
  kind: 'wallet_recovery_code_backup_request_v1',
  walletId: 'visual-fixture.testnet',
  recoveryCodes: ['TEST-ONLY-0001-AAAA', 'TEST-ONLY-0002-BBBB', 'TEST-ONLY-0003-CCCC'],
  continuation: 'registration_may_defer',
};


function defaultProps(tag: LitTag, theme: VisualTheme): Record<string, unknown> {
  switch (tag) {
    case 'seams-auth-menu-surface':
      return { viewModel: registration(theme) };
    case 'seams-drawer':
      return { theme, open: true };
    case 'seams-tx-tree':
      return {
        theme,
        node: {
          id: 'transaction',
          label: 'Transaction to visual-fixture.testnet',
          type: 'folder',
          open: true,
          children: [{ id: 'amount', label: 'Transfer: 1 NEAR', type: 'file' }],
        },
      };
    case 'seams-halo-border':
      return { theme, animated: false, innerPadding: '24px' };
    case 'seams-passkey-halo-loading':
      return { theme, animated: false, width: 64, height: 64 };
    case 'seams-padlock-icon':
      return { size: '24' };
    case 'seams-tx-confirm-content':
    case 'seams-modal-tx-confirmer':
    case 'seams-drawer-tx-confirmer':
    case 'seams-tx-confirmer':
      return {
        theme,
        nearAccountId: 'visual-fixture.testnet',
        title: 'Review transaction',
        body: 'Synthetic visual fixture',
        loading: false,
        variant: 'modal',
        model: { chain: 'tempo', title: 'Review transaction', operations: [] },
        confirmText: 'Confirm',
        cancelText: 'Cancel',
      };
    case 'seams-export-key-viewer':
    case 'seams-export-viewer-iframe':
      return {
        theme,
        variant: 'drawer',
        accountId: 'visual-fixture.testnet',
        loading: true,
        keys: [
          {
            scheme: 'secp256k1',
            label: 'EVM',
            publicKey: '0x02abcd',
            privateKey: '',
            address: '0x1234',
          },
        ],
      };
    case 'seams-recovery-code-backup-viewer':
      return {};
    case 'seams-recovery-code-backup-host':
      return {
        experience: { kind: 'direct_backup', request: SYNTHETIC_BACKUP },
        surface: 'wallet-iframe',
      };
  }
}

export function litVisualFixtures(theme: VisualTheme): LitVisualFixture[] {
  const fixtures: LitVisualFixture[] = [];
  for (const [tag] of LIT_COMPONENT_INVENTORY) {
    const props = defaultProps(tag, theme);
    const attributes: Record<string, string> = { 'data-theme': theme };
    if (tag.includes('tx-confirmer')) attributes['data-seams-confirm-surface'] = 'wallet-iframe';
    if (tag === 'seams-export-viewer-iframe')
      attributes['data-seams-export-surface'] = 'wallet-iframe';
    const content =
      tag === 'seams-drawer' || tag === 'seams-halo-border' ? 'Synthetic wallet content' : '';
    fixtures.push({ tag, name: 'default', props, attributes, content });
    if (tag === 'seams-auth-menu-surface') {
      for (const { name, model } of authBranchFixtures(theme)) {
        fixtures.push({ tag, name, props: { viewModel: model }, attributes, content });
      }
      const model = registration(theme);
      fixtures.push({
        tag,
        name: 'waiting',
        props: {
          viewModel: { ...model, status: { kind: 'busy', headline: 'Creating passkey wallet…' } },
        },
        attributes,
        content,
      });
      fixtures.push({
        tag,
        name: 'error',
        props: {
          viewModel: {
            ...model,
            status: { kind: 'recoverable', reason: 'error', message: 'Please try again.' },
          },
        },
        attributes,
        content,
      });
    }
    if (tag.includes('tx-confirm')) {
      fixtures.push({
        tag,
        name: 'loading',
        props: { ...props, loading: true },
        attributes,
        content,
      });
      fixtures.push({
        tag,
        name: 'error',
        props: { ...props, errorMessage: 'Unable to prepare transaction.' },
        attributes,
        content,
      });
    }
    if (tag === 'seams-export-key-viewer' || tag === 'seams-export-viewer-iframe') {
      fixtures.push({
        tag,
        name: 'ready-masked',
        props: {
          ...props,
          loading: false,
          keys: [
            {
              scheme: 'secp256k1',
              label: 'EVM',
              publicKey: '0x02abcd',
              privateKey: `0x${'1'.repeat(64)}`,
              address: '0x1234',
            },
          ],
        },
        attributes,
        content,
      });
      fixtures.push({
        tag,
        name: 'error',
        props: { ...props, loading: false, errorMessage: 'Synthetic export error' },
        attributes,
        content,
      });
    }
  }
  const authFixtures = fixtures.filter((fixture) => fixture.tag === 'seams-auth-menu-surface');
  for (const fixture of authFixtures) {
    fixtures.push({
      ...fixture,
      name: `${fixture.name}-narrow`,
      viewport: { width: 360, height: 800 },
    });
  }
  return fixtures;
}

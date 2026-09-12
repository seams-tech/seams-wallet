import { test, expect } from '@playwright/test';
import { setupBasicPasskeyTest, SDK_ESM_PATHS, sdkEsmPath } from '../setup';

const IMPORT_PATHS = {
  confirmUi: SDK_ESM_PATHS.confirmUi,
  evmBuilder: sdkEsmPath('core/signingEngine/chains/evm/display/evmTx.js'),
} as const;

test.describe('confirm-ui mountConfirmUI handle', () => {
  test.beforeEach(async ({ page }) => {
    await setupBasicPasskeyTest(page);
  });

  test('sets wallet surface mode before the confirmer is connected', async ({ page }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        const mod = await import(paths.confirmUi);
        const { mountConfirmUI } =
          mod as typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui');

        const firstConnected = new Promise<{ surface: string | null; variant: string | null }>(
          (resolve) => {
            const observer = new MutationObserver((records) => {
              for (const record of records) {
                for (const node of Array.from(record.addedNodes)) {
                  if (!(node instanceof HTMLElement) || node.tagName !== 'W3A-TX-CONFIRMER') {
                    continue;
                  }
                  observer.disconnect();
                  resolve({
                    surface: node.getAttribute('data-w3a-confirm-surface'),
                    variant: node.getAttribute('data-w3a-confirm-variant'),
                  });
                  return;
                }
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
          },
        );

        const ctx: any = {
          userPreferencesManager: {
            getCurrentWalletId: () => 'alice.testnet',
          },
          surfaceMeasurementBinding: {
            kind: 'wallet_iframe',
            requestId: 'tempo-confirmation-surface',
            postMeasurement: () => {},
          },
        };

        const handle = await mountConfirmUI({
          ctx,
          summary: { title: 'Review transaction', body: 'Review the Tempo transaction' } as any,
          model: {
            chain: 'tempo',
            title: 'Review transaction',
            operations: [],
          } as any,
          loading: false,
          theme: 'light',
          uiMode: 'modal',
          nearAccountIdOverride: 'alice.testnet',
        });

        const connected = await firstConnected;
        handle.close(true);
        return connected;
      },
      { paths: IMPORT_PATHS },
    );

    expect(result).toEqual({ surface: 'wallet-iframe', variant: 'modal' });
  });

  test('mounts from TxDisplayModel without txSigningRequests', async ({ page }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        const mod = await import(paths.confirmUi);
        const { mountConfirmUI } =
          mod as typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui');

        const ctx: any = {
          userPreferencesManager: {
            getCurrentWalletId: () => 'alice.testnet',
          },
          surfaceMeasurementBinding: {
            kind: 'wallet_iframe',
            requestId: 'transparent-wallet-iframe-surface',
            postMeasurement: () => {},
          },
        };

        const model = {
          chain: 'evm',
          intentDigest: '0x11',
          title: 'Model-only Confirmation',
          operations: [
            {
              id: 'op-1',
              kind: 'generic.contractCall',
              label: 'Contract Call',
              fields: [
                { label: 'To', value: `0x${'11'.repeat(20)}` },
                { label: 'Value (wei)', value: '7' },
                { label: 'Selector', value: '0xa9059cbb' },
              ],
            },
          ],
        };

        const handle = await mountConfirmUI({
          ctx,
          summary: { intentDigest: 'digest-model-only' } as any,
          model: model as any,
          securityContext: {
            blockHeight: '1',
            blockHash: 'h',
          } as any,
          loading: false,
          theme: 'dark',
          uiMode: 'modal',
          nearAccountIdOverride: 'alice.testnet',
        });

        const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<void> => {
          const start = Date.now();
          while (!predicate()) {
            if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for UI mount');
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
        };

        await waitFor(() => !!document.querySelector('w3a-tx-confirm-content'));
        await waitFor(() => !!document.querySelector('w3a-tx-tree'));

        const portalChild = document.getElementById('w3a-confirm-portal')?.firstElementChild as any;
        const modalElement = portalChild?.querySelector('w3a-modal-tx-confirmer') as HTMLElement;
        const contentEl = document.querySelector('w3a-tx-confirm-content') as any;
        const treeEl = document.querySelector('w3a-tx-tree') as any;
        const treeNode = contentEl?._treeNode;

        const firstOperation = Array.isArray(treeNode?.children) ? treeNode.children[0] : null;
        const fieldLabels = Array.isArray(firstOperation?.children)
          ? firstOperation.children.map((child: any) => String(child?.label || ''))
          : [];
        const wrapperBackground = getComputedStyle(portalChild).backgroundColor;
        const modalBackground = getComputedStyle(modalElement).backgroundColor;
        const wrapperOutline = getComputedStyle(portalChild).outlineStyle;
        const modalOutline = getComputedStyle(modalElement).outlineStyle;

        handle.close(true);

        return {
          hasPortalChild: !!portalChild,
          hasContentElement: !!contentEl,
          hasTreeElement: !!treeEl,
          hasTreeNode: !!treeNode,
          operationLabel: String(firstOperation?.label || ''),
          operationHideChevron: !!firstOperation?.hideChevron,
          fieldLabels,
          hasIntentDigestValue: !!portalChild?.intentDigest,
          wrapperBackground,
          modalBackground,
          wrapperOutline,
          modalOutline,
        };
      },
      { paths: IMPORT_PATHS },
    );

    expect(result.hasPortalChild).toBe(true);
    expect(result.hasContentElement).toBe(true);
    expect(result.hasTreeElement).toBe(true);
    expect(result.hasTreeNode).toBe(true);
    expect(result.operationLabel).toBe('Contract Call');
    expect(result.operationHideChevron).toBe(true);
    expect(result.fieldLabels.some((label: string) => label.includes('To:'))).toBe(true);
    expect(result.hasIntentDigestValue).toBe(false);
    expect(result.wrapperBackground).toBe('rgba(0, 0, 0, 0)');
    expect(result.modalBackground).toBe('rgba(0, 0, 0, 0)');
    expect(result.wrapperOutline).toBe('none');
    expect(result.modalOutline).toBe('none');
  });

  test('lazily enriches ABI hints in tx-tree rendering', async ({ page }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        const mod = await import(paths.confirmUi);
        const { mountConfirmUI } =
          mod as typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui');

        const ctx: any = {
          userPreferencesManager: {
            getCurrentWalletId: () => 'alice.testnet',
          },
          surfaceMeasurementBinding: { kind: 'disabled' },
        };

        const contractAddress = '0xbb442b54c85efba2d7b81ea52990ad638cdba483';
        const model = {
          chain: 'evm',
          intentDigest: '0x22',
          title: 'Lazy ABI Decode',
          operations: [
            {
              id: 'evm.eip1559',
              kind: 'generic.contractCall',
              label: `Transaction to contract ${contractAddress}`,
              to: contractAddress,
              value: '0',
              children: [
                {
                  id: 'evm.eip1559.call',
                  kind: 'generic.contractCall',
                  label: 'Calling contract function using 200k gas',
                  to: contractAddress,
                  value: '0',
                  selector: '0xa4136862',
                  fields: [
                    {
                      label: 'Data',
                      value:
                        'data: 0xa41368620000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d68656c6c6f2c20776f726c642100000000000000000000000000000000000000',
                      copyValue:
                        '0xa41368620000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d68656c6c6f2c20776f726c642100000000000000000000000000000000000000',
                      renderAs: 'file-content',
                      hideLabel: true,
                      hideChevron: true,
                    },
                  ],
                  abiDecodeHint: {
                    dataHex:
                      '0xa41368620000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000d68656c6c6f2c20776f726c642100000000000000000000000000000000000000',
                    abi: [
                      {
                        type: 'function',
                        name: 'setGreeting',
                        inputs: [{ name: 'greeting', type: 'string' }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        };

        const handle = await mountConfirmUI({
          ctx,
          summary: { intentDigest: 'digest-lazy-abi' } as any,
          model: model as any,
          securityContext: {
            blockHeight: '1',
            blockHash: 'h',
          } as any,
          loading: false,
          theme: 'dark',
          uiMode: 'modal',
          nearAccountIdOverride: 'alice.testnet',
        });

        const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<void> => {
          const start = Date.now();
          while (!predicate()) {
            if (Date.now() - start > timeoutMs) {
              throw new Error('Timed out waiting for lazy ABI enrichment');
            }
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
        };

        const findNode = (node: any, predicate: (candidate: any) => boolean): any => {
          if (!node) return null;
          if (predicate(node)) return node;
          const children = Array.isArray(node.children) ? node.children : [];
          for (const child of children) {
            const found = findNode(child, predicate);
            if (found) return found;
          }
          return null;
        };

        await waitFor(() => !!document.querySelector('w3a-tx-confirm-content'));
        const contentEl = document.querySelector('w3a-tx-confirm-content') as any;
        await waitFor(() => {
          const root = contentEl?._treeNode;
          const callNode = findNode(root, (candidate) =>
            String(candidate?.label || '').includes('Calling setGreeting() using 200k gas'),
          );
          if (!callNode || !Array.isArray(callNode.children)) return false;
          const dataNode = callNode.children.find(
            (child: any) => String(child?.label || '') === 'Data:',
          );
          return String(dataNode?.content || '').includes('"greeting": "hello, world!"');
        });

        const treeNode = contentEl?._treeNode;
        const callNode = findNode(treeNode, (candidate) =>
          String(candidate?.label || '').includes('Calling setGreeting() using 200k gas'),
        );
        const fieldLabels = Array.isArray(callNode?.children)
          ? callNode.children.map((child: any) => String(child?.label || ''))
          : [];
        const dataNode = Array.isArray(callNode?.children)
          ? callNode.children.find((child: any) => String(child?.label || '') === 'Data:')
          : null;

        handle.close(true);

        return {
          callLabel: String(callNode?.label || ''),
          fieldLabels,
          decodedContent: String(dataNode?.content || ''),
          rawContent: String(dataNode?.contentVariants?.raw || ''),
        };
      },
      { paths: IMPORT_PATHS },
    );

    expect(result.callLabel).toContain('Calling setGreeting() using 200k gas');
    expect(result.fieldLabels.some((label: string) => label.includes('Function:'))).toBe(false);
    expect(result.decodedContent).toContain('"greeting": "hello, world!"');
    expect(result.rawContent).toContain('0xa4136862');
  });
  test('same mountConfirmUI API renders NEAR, EVM, and Tempo display models', async ({ page }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        const mod = await import(paths.confirmUi);
        const { mountConfirmUI } =
          mod as typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui');

        const ctx: any = {
          userPreferencesManager: {
            getCurrentWalletId: () => 'alice.testnet',
          },
          surfaceMeasurementBinding: { kind: 'disabled' },
        };

        const models = [
          {
            chain: 'near',
            operations: [
              {
                id: 'near-op',
                kind: 'near.action',
                actionType: 'transfer',
                label: 'NEAR Transfer',
                fields: [{ label: 'Amount (yoctoNEAR)', value: '1' }],
              },
            ],
            expectedLabel: 'NEAR Transfer',
          },
          {
            chain: 'evm',
            operations: [
              {
                id: 'evm-op',
                kind: 'generic.contractCall',
                label: 'EVM Contract Call',
                children: [
                  {
                    id: 'evm-call',
                    kind: 'generic.contractCall',
                    label: 'Call',
                    fields: [{ label: 'Selector', value: '0xa9059cbb' }],
                  },
                ],
              },
            ],
            expectedLabel: 'EVM Contract Call',
          },
          {
            chain: 'tempo',
            operations: [
              {
                id: 'tempo-op',
                kind: 'tempo.eip2718',
                label: 'Tempo Transaction',
                children: [
                  {
                    id: 'tempo-call',
                    kind: 'generic.contractCall',
                    label: 'Call',
                    fields: [{ label: 'Selector', value: '0xabcdef12' }],
                  },
                ],
              },
            ],
            expectedLabel: 'Tempo Transaction',
          },
        ] as const;

        const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<void> => {
          const start = Date.now();
          while (!predicate()) {
            if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for UI');
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
        };

        const checks: Array<{
          chain: string;
          matchesExpected: boolean;
          hasTree: boolean;
          operationHideChevron: boolean;
        }> = [];
        for (const fixture of models) {
          const handle = await mountConfirmUI({
            ctx,
            summary: { intentDigest: `digest-${fixture.chain}` } as any,
            model: fixture as any,
            securityContext: {
              blockHeight: '1',
              blockHash: 'h',
            } as any,
            loading: false,
            theme: 'dark',
            uiMode: 'modal',
            nearAccountIdOverride: 'alice.testnet',
          });

          await waitFor(() => !!document.querySelector('w3a-tx-confirm-content'));
          await waitFor(() => !!document.querySelector('w3a-tx-tree'));

          const contentEl = document.querySelector('w3a-tx-confirm-content') as any;
          const treeNode = contentEl?._treeNode;
          const firstOperation = Array.isArray(treeNode?.children) ? treeNode.children[0] : null;
          const operationLabel = String(firstOperation?.label || '');

          checks.push({
            chain: fixture.chain,
            matchesExpected: operationLabel === fixture.expectedLabel,
            hasTree: !!treeNode && Array.isArray(treeNode.children) && treeNode.children.length > 0,
            operationHideChevron: !!firstOperation?.hideChevron,
          });

          handle.close(true);
          await waitFor(
            () => (document.getElementById('w3a-confirm-portal')?.childElementCount || 0) === 0,
          );
        }

        return { checks };
      },
      { paths: IMPORT_PATHS },
    );

    for (const entry of result.checks) {
      expect(entry.hasTree).toBe(true);
      expect(entry.matchesExpected).toBe(true);
      if (entry.chain === 'evm' || entry.chain === 'tempo') {
        expect(entry.operationHideChevron).toBe(true);
      }
    }
  });
  test('shows chain context when block height is missing and hides zero wei value rows', async ({
    page,
  }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        const mod = await import(paths.confirmUi);
        const { mountConfirmUI } =
          mod as typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui');

        const ctx: any = {
          userPreferencesManager: {
            getCurrentWalletId: () => 'alice.testnet',
          },
          surfaceMeasurementBinding: { kind: 'disabled' },
        };

        const model = {
          chain: 'tempo',
          chainId: 111555,
          operations: [
            {
              id: 'tempo-op',
              kind: 'tempo.eip2718',
              label: 'Tempo Transaction',
              fields: [
                { label: 'Nonce', value: '1' },
                { label: 'Value (wei)', value: '0' },
                { label: 'Input', value: '0x' },
              ],
            },
          ],
        };

        const handle = await mountConfirmUI({
          ctx,
          summary: { intentDigest: 'digest-security-context' } as any,
          model: model as any,
          securityContext: {
            rpId: 'example.localhost',
          } as any,
          loading: false,
          theme: 'dark',
          uiMode: 'modal',
          nearAccountIdOverride: 'alice.testnet',
        });

        const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<void> => {
          const start = Date.now();
          while (!predicate()) {
            if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for UI');
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
        };

        await waitFor(() => !!document.querySelector('.security-details'));
        await waitFor(() => !!document.querySelector('w3a-tx-tree'));

        const securityDetails = document.querySelector('.security-details');
        const securityDetailsText = String(securityDetails?.textContent || '')
          .replace(/\s+/g, ' ')
          .trim();

        const allLabelTexts = Array.from(document.querySelectorAll('w3a-tx-tree .label-text')).map(
          (el) =>
            String(el.textContent || '')
              .replace(/\s+/g, ' ')
              .trim(),
        );
        const hasZeroWeiValueRow = allLabelTexts.some((txt) => txt.includes('Value (wei): 0'));

        handle.close(true);

        return {
          securityDetailsText,
          hasZeroWeiValueRow,
        };
      },
      { paths: IMPORT_PATHS },
    );

    expect(result.securityDetailsText).toContain('Tempo | ChainID: 111555');
    expect(result.hasZeroWeiValueRow).toBe(false);
  });
  test('explorer links resolve by family + chainId across mixed EVM networks', async ({ page }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        const confirmUiMod = await import(paths.confirmUi);
        const evmBuilderMod = await import(paths.evmBuilder);
        const { mountConfirmUI } =
          confirmUiMod as typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui');
        const { buildEvmDisplayModel } =
          evmBuilderMod as typeof import('@/core/signingEngine/chains/evm/display/evmTx');

        const contractAddress = '0x1111111111111111111111111111111111111111' as const;
        const summary = { intentDigest: 'digest-explorer-chainid' } as any;

        const ctx: any = {
          userPreferencesManager: {
            getCurrentWalletId: () => 'alice.testnet',
          },
          surfaceMeasurementBinding: { kind: 'disabled' },
          // Intentionally keep Arc as generic family fallback so chainId-specific override is testable.
          evmExplorerUrl: 'https://arc-explorer.example',
          chains: [
            {
              network: 'near-testnet',
              rpcUrl: 'https://near-rpc.example',
              explorerUrl: 'https://near-explorer.example',
            },
            {
              network: 'tempo-testnet',
              rpcUrl: 'https://tempo-rpc.example',
              explorerUrl: 'https://tempo-explorer.example',
              chainId: 111555,
            },
            {
              network: 'arc-testnet',
              rpcUrl: 'https://arc-rpc.example',
              explorerUrl: 'https://arc-explorer.example',
              chainId: 5042002,
            },
            {
              network: 'ethereum-sepolia',
              rpcUrl: 'https://sepolia-rpc.example',
              explorerUrl: 'https://sepolia-explorer.example',
              chainId: 11155111,
            },
          ],
        };

        const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<void> => {
          const start = Date.now();
          while (!predicate()) {
            if (Date.now() - start > timeoutMs)
              throw new Error('Timed out waiting for explorer link');
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
        };

        const resolveHrefForChainId = async (chainId: number): Promise<string> => {
          const model = buildEvmDisplayModel({
            request: {
              chain: 'evm',
              kind: 'eip1559',
              senderSignatureAlgorithm: 'secp256k1',
              tx: {
                chainId,
                nonce: 1n,
                maxPriorityFeePerGas: 1_500_000_000n,
                maxFeePerGas: 3_000_000_000n,
                gasLimit: 21_000n,
                to: contractAddress,
                value: 1n,
                data: '0x',
                accessList: [],
              },
            },
          });

          const handle = await mountConfirmUI({
            ctx,
            summary,
            model: model as any,
            loading: false,
            theme: 'dark',
            uiMode: 'modal',
            nearAccountIdOverride: 'alice.testnet',
          });

          await waitFor(() => !!document.querySelector('w3a-tx-tree .highlight-receiver-id[href]'));
          const href =
            (
              document.querySelector(
                'w3a-tx-tree .highlight-receiver-id[href]',
              ) as HTMLAnchorElement | null
            )?.href || '';
          handle.close(true);
          return href;
        };

        const sepoliaHref = await resolveHrefForChainId(11155111);
        const arcHref = await resolveHrefForChainId(5042002);
        const fallbackHref = await resolveHrefForChainId(1);

        return {
          sepoliaHref,
          arcHref,
          fallbackHref,
        };
      },
      { paths: IMPORT_PATHS },
    );

    expect(result.sepoliaHref).toContain('/address/0x1111111111111111111111111111111111111111');
    expect(result.sepoliaHref.startsWith('https://sepolia-explorer.example')).toBe(true);

    expect(result.arcHref).toContain('/address/0x1111111111111111111111111111111111111111');
    expect(result.arcHref.startsWith('https://arc-explorer.example')).toBe(true);

    // Unknown chainId falls back to the primary/family-level EVM explorer.
    expect(result.fallbackHref).toContain('/address/0x1111111111111111111111111111111111111111');
    expect(result.fallbackHref.startsWith('https://arc-explorer.example')).toBe(true);
  });

  test('host modal: handle.update and handle.close work', async ({ page }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        const mod = await import(paths.confirmUi);
        const { mountConfirmUI } =
          mod as typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui');

        const ctx: any = {
          userPreferencesManager: {
            getCurrentWalletId: () => 'alice.testnet',
          },
          surfaceMeasurementBinding: { kind: 'disabled' },
        };

        const handle = await mountConfirmUI({
          ctx,
          summary: { intentDigest: 'digest' } as any,
          txSigningRequests: [],
          securityContext: {
            blockHeight: '1',
            blockHash: 'h',
          } as any,
          loading: true,
          theme: 'dark',
          uiMode: 'modal',
          nearAccountIdOverride: 'alice.testnet',
        });

        const portal = document.getElementById('w3a-confirm-portal');
        const initialEl = portal?.firstElementChild as HTMLElement | null;
        const initial = !!initialEl && getComputedStyle(initialEl).display !== 'none';
        const hasTreeBeforeUpdate = !!document.querySelector('w3a-tx-tree');
        const hasNoActionsTextBeforeUpdate = /no actions/i.test(String(portal?.textContent || ''));

        // Update loading to false and set error message
        handle.update({ loading: false, errorMessage: 'Oops' });
        const el = document.getElementById('w3a-confirm-portal')
          ?.firstElementChild as HTMLElement | null;
        const updated = {
          hasPortal: !!portal,
          hasChild: !!el,
          loading: el ? (el as any).loading : undefined,
          errorMessage: el ? (el as any).errorMessage : undefined,
          dataError: el ? el.getAttribute('data-error-message') : undefined,
          hasTree: !!document.querySelector('w3a-tx-tree'),
          hasNoActionsText: /no actions/i.test(
            String(document.getElementById('w3a-confirm-portal')?.textContent || ''),
          ),
        };

        // Close should remove the element
        handle.close(true);
        const afterClose = {
          portalExists: !!document.getElementById('w3a-confirm-portal'),
          childCount: document.getElementById('w3a-confirm-portal')?.childElementCount || 0,
        };

        return { initial, updated, afterClose, hasTreeBeforeUpdate, hasNoActionsTextBeforeUpdate };
      },
      { paths: IMPORT_PATHS },
    );

    expect(result.initial).toBe(true);
    expect(result.updated.hasPortal).toBe(true);
    expect(result.updated.hasChild).toBe(true);
    expect(result.updated.loading).toBe(false);
    expect(result.updated.errorMessage).toBe('Oops');
    expect(result.updated.dataError).toBe('Oops');
    expect(result.hasTreeBeforeUpdate).toBe(false);
    expect(result.hasNoActionsTextBeforeUpdate).toBe(false);
    expect(result.updated.hasTree).toBe(false);
    expect(result.updated.hasNoActionsText).toBe(false);
    expect(result.afterClose.portalExists).toBe(true);
    expect(result.afterClose.childCount).toBe(0);
  });

  test('host modal: a new confirmation cancels and replaces the active modal', async ({ page }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        const mod = await import(paths.confirmUi);
        const { awaitConfirmUIDecision, mountConfirmUI } =
          mod as typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui');

        const ctx: any = {
          userPreferencesManager: {
            getCurrentWalletId: () => 'alice.testnet',
          },
          surfaceMeasurementBinding: { kind: 'disabled' },
        };
        const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<void> => {
          const start = Date.now();
          while (!predicate()) {
            if (Date.now() - start > timeoutMs) {
              throw new Error('Timed out waiting for single-modal replacement');
            }
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
        };

        const firstDecisionPromise = awaitConfirmUIDecision({
          ctx,
          summary: { title: 'First confirmation' } as any,
          txSigningRequests: [],
          loading: false,
          theme: 'light',
          uiMode: 'modal',
          nearAccountIdOverride: 'alice.testnet',
          surface: { kind: 'mount_new' },
        });

        await waitFor(() => document.getElementById('w3a-confirm-portal')?.childElementCount === 1);
        const portal = document.getElementById('w3a-confirm-portal') as HTMLElement;
        const firstElement = portal.firstElementChild as HTMLElement;

        const secondHandle = await mountConfirmUI({
          ctx,
          summary: { title: 'Second confirmation' } as any,
          txSigningRequests: [],
          loading: false,
          theme: 'light',
          uiMode: 'modal',
          nearAccountIdOverride: 'alice.testnet',
        });
        const firstDecision = await firstDecisionPromise;
        const secondElement = secondHandle.element;
        const stateAfterReplacement = {
          firstCancelled: firstDecision.confirmed === false,
          firstRemoved: !firstElement.isConnected,
          onePortalChild: portal.childElementCount === 1,
          secondIsOnlyChild: portal.firstElementChild === secondElement,
        };

        firstDecision.handle.close(false);
        const secondSurvivedOldHandleClose =
          portal.childElementCount === 1 && portal.firstElementChild === secondElement;
        secondHandle.close(true);

        return {
          ...stateAfterReplacement,
          secondSurvivedOldHandleClose,
          portalEmptyAfterClose: portal.childElementCount === 0,
        };
      },
      { paths: IMPORT_PATHS },
    );

    expect(result).toEqual({
      firstCancelled: true,
      firstRemoved: true,
      onePortalChild: true,
      portalEmptyAfterClose: true,
      secondIsOnlyChild: true,
      secondSurvivedOldHandleClose: true,
    });
  });

  test('host modal: transaction tree is open on first paint and stays stable', async ({ page }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        const mod = await import(paths.confirmUi);
        const { mountConfirmUI } =
          mod as typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui');

        const ctx: any = {
          userPreferencesManager: {
            getCurrentWalletId: () => 'alice.testnet',
          },
          surfaceMeasurementBinding: { kind: 'disabled' },
        };
        const waitFor = async (predicate: () => boolean, timeoutMs = 5000): Promise<void> => {
          const start = Date.now();
          while (!predicate()) {
            if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for tx-tree');
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
        };

        const model = {
          chain: 'evm' as const,
          chainId: 42431,
          operations: [
            {
              id: 'evm.eip1559',
              kind: 'generic.contractCall',
              label: 'Contract call',
              to: `0x${'11'.repeat(20)}`,
              fields: [
                { label: 'To', value: `0x${'11'.repeat(20)}` },
                { label: 'Selector', value: '0xa9059cbb' },
              ],
            },
          ],
        };
        const handle = await mountConfirmUI({
          ctx,
          summary: { title: 'Confirm transaction' } as any,
          model,
          securityContext: { rpId: 'staging.sign.seams.sh' } as any,
          loading: true,
          theme: 'light',
          uiMode: 'modal',
          nearAccountIdOverride: 'alice.testnet',
        });

        await waitFor(
          () => !!document.querySelector('w3a-tx-tree details[data-node-id="evm.eip1559"]'),
        );
        const initialTree = document.querySelector('w3a-tx-tree') as HTMLElement | null;
        const initialOperation = initialTree?.querySelector(
          'details[data-node-id="evm.eip1559"]',
        ) as HTMLDetailsElement | null;
        const initialMetadataText = String(
          document.querySelector('.rpid-wrapper')?.textContent || '',
        );
        const initialLoadingEllipses = document.querySelectorAll('.loading-ellipsis').length;
        const initialChainIcon = document.querySelector('.block-height-icon') as HTMLElement | null;
        const initialChainIconStyle = initialChainIcon ? getComputedStyle(initialChainIcon) : null;
        const initialChainIconVisible =
          !!initialChainIcon &&
          initialChainIconStyle?.display !== 'none' &&
          initialChainIconStyle?.visibility !== 'hidden';
        const initialModalHeight = handle.element.getBoundingClientRect().height;

        handle.update({
          model: { ...model, intentDigest: 'prepared-intent-digest' },
          loading: false,
        });

        await waitFor(() => {
          const content = document.querySelector('w3a-tx-confirm-content') as any;
          return content?.model?.intentDigest === 'prepared-intent-digest';
        });
        const tree = document.querySelector('w3a-tx-tree') as HTMLElement | null;
        const hydratedOperation = tree?.querySelector(
          'details[data-node-id="evm.eip1559"]',
        ) as HTMLDetailsElement | null;
        const hydratedModalHeight = handle.element.getBoundingClientRect().height;
        const hydratedMetadataText = String(
          document.querySelector('.rpid-wrapper')?.textContent || '',
        )
          .replace(/\s+/g, ' ')
          .trim();
        const hydratedLoadingEllipses = document.querySelectorAll('.loading-ellipsis').length;
        const loadingCopy = String(tree?.textContent || '').includes('Loading transaction details');
        const hasIndicatorArrow = !!hydratedOperation?.querySelector(':scope > summary .chevron');
        const openedAfterHydration = hydratedOperation?.open === true;
        const usedOpeningAnimation = !!hydratedOperation
          ?.querySelector(':scope > .folder-children')
          ?.classList.contains('anim-h');

        handle.close(true);
        return {
          hasInitialTree: !!initialTree,
          initialOperationOpen: initialOperation?.open === true,
          initialMetadataText,
          initialLoadingEllipses,
          initialChainIconVisible,
          preservedOperation: initialOperation === hydratedOperation,
          hasHydratedOperation: !!hydratedOperation,
          hydratedMetadataText,
          hydratedLoadingEllipses,
          modalHeightShift: Math.abs(hydratedModalHeight - initialModalHeight),
          hasIndicatorArrow,
          loadingCopy,
          openedAfterHydration,
          usedOpeningAnimation,
        };
      },
      { paths: IMPORT_PATHS },
    );

    expect(result.hasInitialTree).toBe(true);
    expect(result.initialOperationOpen).toBe(true);
    expect(result.initialMetadataText).toContain('staging.sign.seams.sh');
    expect(result.initialMetadataText).toContain('EVM | ChainID: 42431');
    expect(result.initialLoadingEllipses).toBe(0);
    expect(result.initialChainIconVisible).toBe(true);
    expect(result.preservedOperation).toBe(true);
    expect(result.hasHydratedOperation).toBe(true);
    expect(result.hydratedMetadataText).toContain('staging.sign.seams.sh');
    expect(result.hydratedMetadataText).toContain('EVM | ChainID: 42431');
    expect(result.hydratedLoadingEllipses).toBe(0);
    expect(result.modalHeightShift).toBeLessThan(1);
    expect(result.hasIndicatorArrow).toBe(false);
    expect(result.loadingCopy).toBe(false);
    expect(result.openedAfterHydration).toBe(true);
    expect(result.usedOpeningAnimation).toBe(false);
  });

  test('host modal: passkey registration renders identity details without transaction tree', async ({
    page,
  }) => {
    await page.evaluate(
      async ({ paths }) => {
        const mod = await import(paths.confirmUi);
        const { mountConfirmUI } =
          mod as typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui');

        const ctx: any = {
          userPreferencesManager: {
            getCurrentWalletId: () => 'alice.testnet',
          },
          surfaceMeasurementBinding: { kind: 'disabled' },
        };

        const handle = await mountConfirmUI({
          ctx,
          summary: { intentDigest: 'register:alice.testnet:1' } as any,
          txSigningRequests: [],
          securityContext: {
            passkeyRegistration: {
              kind: 'passkey_registration_confirm_display_v1',
              intendedUserName: 'alice.testnet',
              accountId: 'alice.testnet',
              rpId: 'wallet.example.test',
              signerSlot: 1,
            },
          } as any,
          loading: false,
          theme: 'dark',
          uiMode: 'modal',
          nearAccountIdOverride: 'alice.testnet',
        });

        (globalThis as any).__passkeyRegistrationHandle = handle;
      },
      { paths: IMPORT_PATHS },
    );

    await page.waitForSelector('.passkey-registration-confirm__identity');

    const identity = page.locator('.passkey-registration-confirm__identity');
    await expect(page.locator('.passkey-registration-confirm .hero-heading')).toHaveText(
      'Create your passkey',
    );
    await expect(identity).toContainText('Account');
    await expect(identity).toContainText('alice.testnet');
    await expect(identity).toContainText('Website');
    await expect(identity).toContainText('wallet.example.test');
    await expect(page.locator('.passkey-registration-confirm__value').first()).toHaveAttribute(
      'title',
      'alice.testnet',
    );
    await expect(page.locator('.passkey-registration-confirm__value').nth(1)).toHaveAttribute(
      'title',
      'wallet.example.test',
    );
    expect(await page.locator('w3a-tx-tree').count()).toBe(0);
    await expect
      .poll(() =>
        page
          .locator('.passkey-registration-confirm w3a-passkey-halo-loading')
          .evaluate((element: any) => element.animated),
      )
      .toBe(true);

    await page.evaluate(() => {
      (globalThis as any).__passkeyRegistrationHandle?.update({ loading: true });
    });

    await expect(page.locator('.passkey-registration-confirm .btn-confirm')).toContainText(
      'Creating passkey...',
    );
    const busyLabel = page.locator('.passkey-registration-confirm__busy-label');
    await expect(busyLabel).toHaveCSS('white-space', 'nowrap');
    expect(
      await busyLabel.evaluate((element) => {
        const labelSize = Number.parseFloat(getComputedStyle(element).fontSize);
        const button = element.closest('button');
        if (!button) throw new Error('Busy label must be rendered inside its button');
        const buttonSize = Number.parseFloat(getComputedStyle(button).fontSize);
        return labelSize < buttonSize;
      }),
    ).toBe(true);
    await expect(page.locator('.passkey-registration-confirm [role="progressbar"]')).toHaveCount(1);

    await page.evaluate(() => {
      (globalThis as any).__passkeyRegistrationHandle?.close(true);
      delete (globalThis as any).__passkeyRegistrationHandle;
    });
  });

  test('host drawer: mount + update theme and loading', async ({ page }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        const mod = await import(paths.confirmUi);
        const { mountConfirmUI } =
          mod as typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui');

        const ctx: any = {
          userPreferencesManager: {
            getCurrentWalletId: () => 'bob.testnet',
          },
          surfaceMeasurementBinding: { kind: 'disabled' },
        };

        const handle = await mountConfirmUI({
          ctx,
          summary: { intentDigest: 'digest' } as any,
          txSigningRequests: [],
          securityContext: {
            blockHeight: '1',
            blockHash: 'h',
          } as any,
          loading: true,
          theme: 'light',
          uiMode: 'drawer',
          nearAccountIdOverride: 'bob.testnet',
        });

        const portal = document.getElementById('w3a-confirm-portal');
        const initialEl = portal?.firstElementChild as any;
        const exists = !!initialEl;
        handle.update({ loading: false, theme: 'dark' });
        const el = document.getElementById('w3a-confirm-portal')?.firstElementChild as any;
        const stillThere = !!el;
        const afterUpdate = {
          loading: el ? el.loading : undefined,
          theme: el ? el.theme : undefined,
        };
        handle.close(false);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const gone = (document.getElementById('w3a-confirm-portal')?.childElementCount || 0) === 0;
        return { exists, stillThere, gone, afterUpdate };
      },
      { paths: IMPORT_PATHS },
    );

    expect(result.exists).toBe(true);
    expect(result.stillThere).toBe(true);
    expect(result.gone).toBe(true);
    expect(result.afterUpdate.loading).toBe(false);
    expect(result.afterUpdate.theme).toBe('dark');
  });

  test('inline drawer: handle.update reflects loading, theme, error message', async ({ page }) => {
    const result = await page.evaluate(
      async ({ paths }) => {
        const mod = await import(paths.confirmUi);
        const { mountConfirmUI } =
          mod as typeof import('@/core/signingEngine/uiConfirm/ui/confirm-ui');

        const ctx: any = {
          userPreferencesManager: {
            getCurrentWalletId: () => 'carol.testnet',
          },
          surfaceMeasurementBinding: { kind: 'disabled' },
        };

        const handle = await mountConfirmUI({
          ctx,
          summary: { intentDigest: 'digest' } as any,
          txSigningRequests: [],
          securityContext: {
            blockHeight: '1',
            blockHash: 'h',
          } as any,
          loading: true,
          theme: 'light',
          uiMode: 'drawer',
          nearAccountIdOverride: 'carol.testnet',
        });

        const portal = document.getElementById('w3a-confirm-portal');
        const initialEl = portal?.firstElementChild as any;
        const exists = !!initialEl;
        handle.update({ loading: false, theme: 'dark', errorMessage: 'Denied' });
        const el = document.getElementById('w3a-confirm-portal')?.firstElementChild as any;
        (el as any)?.requestUpdate?.();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const portalChild = document.getElementById('w3a-confirm-portal')?.firstElementChild as any;
        const afterUpdate = {
          dataError: portalChild ? portalChild.getAttribute?.('data-error-message') : undefined,
        };
        handle.close(true);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const gone = (document.getElementById('w3a-confirm-portal')?.childElementCount || 0) === 0;
        return { exists, afterUpdate, gone };
      },
      { paths: IMPORT_PATHS },
    );

    expect(result.exists).toBe(true);
    expect(result.afterUpdate.dataError).toBe('Denied');
    expect(result.gone).toBe(true);
  });
});

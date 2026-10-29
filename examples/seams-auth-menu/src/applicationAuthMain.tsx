import { createRoot } from 'react-dom/client';
import { SeamsWebProvider } from '@seams/wallet/react';
import '@seams/wallet/react/styles';
import { ApplicationAuthExample } from './ApplicationAuth';
import { exampleConfig, walletOrigin } from './exampleConfig';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
createRoot(root).render(
  <SeamsWebProvider config={exampleConfig}>
    <ApplicationAuthExample walletRpId={new URL(walletOrigin).hostname} />
  </SeamsWebProvider>,
);

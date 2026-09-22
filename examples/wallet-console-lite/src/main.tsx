import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@seams/wallet/react/styles';
import { WalletConsoleLite } from './WalletConsoleLite';
import { WalletSettingsPage } from '@seams/wallet/react';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <WalletConsoleLite>
      {window.location.pathname === '/wallet-settings' ? <WalletSettingsPage /> : undefined}
    </WalletConsoleLite>
  </StrictMode>,
);
